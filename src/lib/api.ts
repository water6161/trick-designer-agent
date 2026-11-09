import type {
  ChatMessage,
  DonePayload,
  MetaPayload,
  PlanBrief,
  PlanData,
  PlanRules,
  PlanVersion,
  SessionItem,
  StatsSnapshot,
  StreamHandlers,
} from '../types'

import { createWatchdog, fetchWithTimeout, HttpError } from './net'
import { failureOf, type StreamFailure, type StreamPhase } from './streamPolicy'

const CLIENT_ID_KEY = 'trick-designer-client-id'
const AGENT_URL = '/trick-designer'
const STOP_URL = '/stop'

/** 多久拿不到响应头就判定连接失败（后端有心跳，正常建连远快于此）。 */
const CONNECT_TIMEOUT_MS = 20_000
/** 流式传输中多久没有任何数据判定假死。后端 20s 一次心跳，留一倍余量。 */
const STREAM_IDLE_TIMEOUT_MS = 45_000

/** 带失败归类与阶段信息的错误，供上层决定「原样重发」还是「断点续跑」。 */
export class StreamFailureError extends Error implements StreamFailure {
  readonly kind: StreamFailure['kind']
  readonly phase: StreamPhase

  constructor(failure: StreamFailure) {
    super(failure.message)
    this.name = 'StreamFailureError'
    this.kind = failure.kind
    this.phase = failure.phase
  }
}

function uuid(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (char) => {
    const random = (Math.random() * 16) | 0
    const value = char === 'x' ? random : (random & 0x3) | 0x8
    return value.toString(16)
  })
}

export function newConversationId(): string {
  return uuid()
}

export function getClientId(): string {
  try {
    const existing = localStorage.getItem(CLIENT_ID_KEY)
    if (existing && /^[0-9a-zA-Z._-]{6,64}$/.test(existing)) return existing
    const created = uuid()
    localStorage.setItem(CLIENT_ID_KEY, created)
    return created
  } catch {
    return uuid()
  }
}

function headers(conversationId: string): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    Accept: 'text/event-stream',
    'Makers-Conversation-Id': conversationId,
    'X-Client-Id': getClientId(),
  }
}

function errorFromPayload(data: Record<string, unknown>): string {
  const direct = data.error
  if (typeof direct === 'string' && direct) return direct
  const body = data.body
  if (body && typeof body === 'object') {
    const nested = (body as Record<string, unknown>).error
    if (typeof nested === 'string' && nested) return nested
  }
  return ''
}

async function readError(response: Response): Promise<string> {
  try {
    const data = (await response.json()) as Record<string, unknown>
    return errorFromPayload(data) || `请求失败（HTTP ${response.status}）`
  } catch {
    return `请求失败（HTTP ${response.status}）`
  }
}

async function readJson(response: Response): Promise<Record<string, unknown>> {
  if (!response.ok) throw new HttpError(response.status, await readError(response))
  const data = (await response.json()) as Record<string, unknown>
  const message = errorFromPayload(data)
  if (message) throw new HttpError(response.status, message)
  return data
}

export async function listSessions(): Promise<SessionItem[]> {
  const response = await fetch(AGENT_URL, {
    method: 'POST',
    headers: headers('session-list'),
    body: JSON.stringify({ action: 'sessions' }),
  })
  const data = (await readJson(response)) as { sessions?: SessionItem[] }
  return Array.isArray(data.sessions) ? data.sessions : []
}

export async function getHistory(conversationId: string): Promise<ChatMessage[]> {
  const response = await fetch(AGENT_URL, {
    method: 'POST',
    headers: headers(conversationId),
    body: JSON.stringify({ action: 'history' }),
  })
  const data = (await readJson(response)) as { messages?: Array<Record<string, unknown>> }
  if (!Array.isArray(data.messages)) return []
  return data.messages
    .filter((item) => item.role === 'user' || item.role === 'assistant')
    .map((item) => ({
      id: uuid(),
      role: item.role as 'user' | 'assistant',
      content: typeof item.content === 'string' ? item.content : '',
      createdAt: typeof item.createdAt === 'string' ? item.createdAt : null,
    }))
    .filter((item) => item.content.trim().length > 0)
}

/** 列出当前会话的历史方案版本（来自 checkpointer 的历史快照）。 */
/** 读取后端运行指标（进程内最近 200 条请求的聚合，不含用户原文）。 */
export async function getStats(conversationId: string): Promise<StatsSnapshot> {
  const response = await fetch(AGENT_URL, {
    method: 'POST',
    headers: headers(conversationId),
    body: JSON.stringify({ action: 'stats' }),
  })
  return (await readJson(response)) as unknown as StatsSnapshot
}

export async function listVersions(conversationId: string): Promise<PlanVersion[]> {
  const response = await fetch(AGENT_URL, {
    method: 'POST',
    headers: headers(conversationId),
    body: JSON.stringify({ action: 'versions' }),
  })
  const data = (await readJson(response)) as { versions?: PlanVersion[] }
  return Array.isArray(data.versions) ? data.versions : []
}

/** 把会话状态回退到指定版本，返回该版本的方案正文。 */
export async function restoreVersion(conversationId: string, checkpointId: string): Promise<{ markdown: string; title: string }> {
  const response = await fetch(AGENT_URL, {
    method: 'POST',
    headers: headers(conversationId),
    body: JSON.stringify({ action: 'restore', checkpoint_id: checkpointId }),
  })
  const data = (await readJson(response)) as { markdown?: string; title?: string }
  if (!data.markdown) throw new Error('这个版本没有可恢复的方案正文')
  return { markdown: data.markdown, title: data.title || '历史版本' }
}

export async function deleteSession(conversationId: string): Promise<void> {
  const response = await fetch(AGENT_URL, {
    method: 'POST',
    headers: headers(conversationId),
    body: JSON.stringify({ action: 'delete', conversation_id: conversationId }),
  })
  const data = (await readJson(response)) as { ok?: boolean }
  if (data.ok === false) throw new Error('删除会话失败')
}

export async function stopRun(conversationId: string): Promise<void> {
  try {
    await fetch(STOP_URL, {
      method: 'POST',
      headers: headers(conversationId),
      body: JSON.stringify({ conversationId }),
    })
  } catch {
    // 停止是尽力而为，失败不影响前端本地中断
  }
}

export interface ExportPlan {
  title: string
  markdown: string
  lockScore: number | null
  brief?: PlanBrief
  plan?: PlanData | null
}

export type AICoverStyle = 'character' | 'group' | 'scene'

export async function aiCover(conversationId: string, style: AICoverStyle = 'character'): Promise<{ image: string; title: string }> {
  const response = await fetch(AGENT_URL, {
    method: 'POST',
    headers: headers(conversationId),
    body: JSON.stringify({ action: 'ai_cover', cover_style: style }),
  })
  const data = (await readJson(response)) as Record<string, unknown>
  if (data.error) throw new Error(String(data.error))
  if (typeof data.image !== 'string' || !data.image.startsWith('data:image/')) {
    throw new Error('AI 封面返回格式异常。')
  }
  return { image: data.image, title: typeof data.title === 'string' ? data.title : '未命名诡计方案' }
}

export async function exportPlan(conversationId: string): Promise<ExportPlan> {
  const response = await fetch(AGENT_URL, {
    method: 'POST',
    headers: headers(conversationId),
    body: JSON.stringify({ action: 'export' }),
  })
  const data = (await readJson(response)) as Record<string, unknown>
  const markdown = typeof data.markdown === 'string' ? data.markdown : ''
  if (!markdown) throw new Error('当前会话还没有可导出的完整方案。')
  return {
    title: typeof data.title === 'string' && data.title ? data.title : '未命名诡计方案',
    markdown,
    lockScore: typeof data.lockScore === 'number' ? data.lockScore : null,
    brief: (data.brief && typeof data.brief === 'object' ? data.brief : undefined) as PlanBrief | undefined,
    plan: (data.plan && typeof data.plan === 'object' ? data.plan : null) as PlanData | null,
  }
}

export async function streamRetry(
  conversationId: string,
  handlers: StreamHandlers,
  signal: AbortSignal,
): Promise<void> {
  let response: Response
  try {
    response = await fetchWithTimeout(
      AGENT_URL,
      {
        method: 'POST',
        headers: headers(conversationId),
        body: JSON.stringify({ action: 'retry' }),
        signal,
      },
      CONNECT_TIMEOUT_MS,
    )
  } catch (err) {
    throw new StreamFailureError(failureOf(err, 'connect'))
  }
  if (!response.ok) {
    throw new StreamFailureError({ kind: 'client', phase: 'connect', message: await readError(response) })
  }
  const contentType = response.headers.get('content-type') || ''
  if (contentType.includes('application/json')) {
    const data = (await response.json()) as Record<string, unknown>
    throw new StreamFailureError({
      kind: 'client',
      phase: 'connect',
      message:
        (typeof data.error === 'string' && data.error) || '当前没有可恢复的断点，请直接重新发送需求。',
    })
  }
  // 复用流式解析逻辑
  await consumeStream(response, handlers, signal)
}

export async function streamChat(
  conversationId: string,
  message: string,
  handlers: StreamHandlers,
  signal: AbortSignal,
): Promise<void> {
  let response: Response
  try {
    response = await fetchWithTimeout(
      AGENT_URL,
      {
        method: 'POST',
        headers: headers(conversationId),
        body: JSON.stringify({ action: 'chat', message }),
        signal,
      },
      CONNECT_TIMEOUT_MS,
    )
  } catch (err) {
    throw new StreamFailureError(failureOf(err, 'connect'))
  }

  if (!response.ok) {
    throw new StreamFailureError({
      kind: response.status >= 500 ? 'server' : 'client',
      phase: 'connect',
      message: await readError(response),
    })
  }
  // 参数校验失败等场景平台可能以 JSON 返回 200，需要显式识别，避免被当成空流
  const contentType = response.headers.get('content-type') || ''
  if (contentType.includes('application/json')) {
    throw new StreamFailureError({ kind: 'client', phase: 'connect', message: await readError(response) })
  }
  await consumeStream(response, handlers, signal)
}

async function consumeStream(
  response: Response,
  handlers: StreamHandlers,
  signal?: AbortSignal,
): Promise<void> {
  if (!response.body) {
    throw new StreamFailureError({ kind: 'unknown', phase: 'connect', message: '当前浏览器不支持流式响应。' })
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let sawDone = false
  let sawError = false
  let idled = false

  // 假死检测：连接没断但长时间没有任何数据（后端每 20s 一次心跳，45s 静默即为异常）
  const watchdog = createWatchdog(STREAM_IDLE_TIMEOUT_MS, () => {
    idled = true
    void reader.cancel().catch(() => {})
  })

  const onAbort = () => {
    void reader.cancel().catch(() => {})
  }
  signal?.addEventListener('abort', onAbort, { once: true })

  const dispatch = (frame: string) => {
    let event = 'message'
    const dataLines: string[] = []
    for (const line of frame.split('\n')) {
      if (line.startsWith('event:')) {
        event = line.slice(6).trim()
      } else if (line.startsWith('data:')) {
        dataLines.push(line.slice(5).trim())
      }
    }
    if (dataLines.length === 0) return
    const raw = dataLines.join('\n')
    let data: unknown = raw
    try {
      data = JSON.parse(raw)
    } catch {
      data = raw
    }
    if (event === 'done') sawDone = true
    if (event === 'error') sawError = true
    handleEvent(event, data, handlers)
  }

  try {
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      watchdog.touch()
      buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, '\n')
      let index = buffer.indexOf('\n\n')
      while (index !== -1) {
        const frame = buffer.slice(0, index)
        buffer = buffer.slice(index + 2)
        if (frame.trim()) dispatch(frame)
        index = buffer.indexOf('\n\n')
      }
    }
    if (buffer.trim()) dispatch(buffer)
  } finally {
    watchdog.clear()
    signal?.removeEventListener('abort', onAbort)
  }

  if (signal?.aborted) throw new DOMException('已取消', 'AbortError')

  if (idled) {
    throw new StreamFailureError({
      kind: 'timeout',
      phase: 'stream',
      message: `服务端 ${Math.round(STREAM_IDLE_TIMEOUT_MS / 1000)} 秒没有响应，连接被认为已假死`,
    })
  }

  // 后端只在正常跑完时发 done；errored 会走 error 事件并直接结束。
  // 既没 done 也没 error 就结束 = 传输层断流（中间层掐断、网络切换、函数超时）。
  if (!sawDone && !sawError) {
    throw new StreamFailureError({
      kind: 'network',
      phase: 'stream',
      message: '连接在生成完成前中断了',
    })
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
}

function handleEvent(event: string, data: unknown, handlers: StreamHandlers): void {
  const payload = asRecord(data)
  switch (event) {
    case 'session':
      break
    case 'status': {
      const label = payload.label
      if (typeof label === 'string' && label) handlers.onStatus?.(label)
      const stage = payload.stage
      if (typeof stage === 'string' && stage) handlers.onStage?.(stage)
      break
    }
    case 'token': {
      const delta = payload.delta
      if (typeof delta === 'string' && delta) handlers.onToken?.(delta)
      break
    }
    case 'meta': {
      const meta: MetaPayload = {
        title: typeof payload.title === 'string' ? payload.title : undefined,
        genre: typeof payload.genre === 'string' ? payload.genre : undefined,
        lock_score: typeof payload.lock_score === 'number' ? payload.lock_score : null,
        source_count: typeof payload.source_count === 'number' ? payload.source_count : undefined,
        // 质量体检评分：后端 score 节点产出，缺省为 null（极速模式/评分失败时不上卡片）
        quality:
          payload.quality && typeof payload.quality === 'object'
            ? (payload.quality as MetaPayload['quality'])
            : null,
        // 结构化方案：前端工具视图优先用它，缺失时才回退到 parsePlan 兜底解析
        plan: payload.plan && typeof payload.plan === 'object' ? (payload.plan as MetaPayload['plan']) : null,
        // 硬规则校验：后端纯规则计算，缺省为 null（对比模式 / 结构化失败时不上卡片）
        rules: payload.rules && typeof payload.rules === 'object' ? (payload.rules as PlanRules) : null,
      }
      handlers.onMeta?.(meta)
      break
    }
    case 'notice': {
      const message = payload.message
      if (typeof message === 'string' && message) handlers.onNotice?.(message)
      break
    }
    case 'done': {
      handlers.onDone?.(payload as DonePayload)
      break
    }
    case 'error': {
      const message = payload.message
      handlers.onError?.(typeof message === 'string' && message ? message : '生成失败，请重试。')
      break
    }
    default:
      break
  }
}
