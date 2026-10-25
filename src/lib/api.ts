import type { ChatMessage, DonePayload, MetaPayload, PlanBrief, PlanData, SessionItem, StreamHandlers } from '../types'

const CLIENT_ID_KEY = 'trick-designer-client-id'
const AGENT_URL = '/trick-designer'
const STOP_URL = '/stop'

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
  if (!response.ok) throw new Error(await readError(response))
  const data = (await response.json()) as Record<string, unknown>
  const message = errorFromPayload(data)
  if (message) throw new Error(message)
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

export async function streamChat(
  conversationId: string,
  message: string,
  handlers: StreamHandlers,
  signal: AbortSignal,
): Promise<void> {
  const response = await fetch(AGENT_URL, {
    method: 'POST',
    headers: headers(conversationId),
    body: JSON.stringify({ action: 'chat', message }),
    signal,
  })

  if (!response.ok) {
    throw new Error(await readError(response))
  }
  // 参数校验失败等场景平台可能以 JSON 返回 200，需要显式识别，避免被当成空流
  const contentType = response.headers.get('content-type') || ''
  if (contentType.includes('application/json')) {
    throw new Error(await readError(response))
  }
  if (!response.body) {
    throw new Error('当前浏览器不支持流式响应。')
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

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
    handleEvent(event, data, handlers)
  }

  while (true) {
    const { value, done } = await reader.read()
    if (done) break
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
