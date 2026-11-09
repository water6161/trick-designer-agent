/**
 * 网络失败的归类与超时工具。
 *
 * 前端最难处理的是「失败了到底该不该重试」——用户点重试但请求本身 401，只是白等；
 * 而一次瞬时抖动却让用户丢掉整段生成。这里把各类异常收敛成有限几种 FailureKind，
 * 重试决策、提示文案、自动重连全都只依赖这个枚举，不再散落各处的字符串判断。
 */

export type FailureKind =
  | 'abort' // 用户主动停止
  | 'offline' // 浏览器离线
  | 'timeout' // 连接或空闲超时
  | 'network' // DNS / 连接重置 / 断流
  | 'server' // 5xx
  | 'client' // 4xx，重试无意义
  | 'unknown'

/** 带 HTTP 状态码的错误，供分类器识别 4xx / 5xx。 */
export class HttpError extends Error {
  readonly status: number

  constructor(status: number, message: string) {
    super(message)
    this.name = 'HttpError'
    this.status = status
  }
}

export class TimeoutError extends Error {
  constructor(message = '请求超时') {
    super(message)
    this.name = 'TimeoutError'
  }
}

export class OfflineError extends Error {
  constructor(message = '网络已断开') {
    super(message)
    this.name = 'OfflineError'
  }
}

export function classifyError(err: unknown): FailureKind {
  if (!err) return 'unknown'

  if (typeof err === 'object' && err !== null) {
    const name = (err as { name?: string }).name
    if (name === 'AbortError') return 'abort'
    if (name === 'TimeoutError') return 'timeout'
    if (name === 'OfflineError') return 'offline'

    const status = (err as { status?: number }).status
    if (typeof status === 'number') {
      if (status >= 500) return 'server'
      if (status >= 400) return 'client'
    }
  }

  const message = err instanceof Error ? err.message : String(err)
  if (/abort/i.test(message)) return 'abort'
  if (/timeout|超时/i.test(message)) return 'timeout'
  if (/offline|网络已断开/i.test(message)) return 'offline'
  if (/failed to fetch|networkerror|network request failed|load failed|网络|断流|connection/i.test(message)) {
    return 'network'
  }
  return 'unknown'
}

/** 可重试 = 瞬时故障。4xx（参数错、额度用完、会话不存在）重试多少次都是一样的结果。 */
export function isRetryable(kind: FailureKind): boolean {
  return kind === 'timeout' || kind === 'network' || kind === 'server' || kind === 'offline'
}

/**
 * 全抖动指数退避：第 n 次重试的基础间隔为 400·2^(n-1)，上限 4s，再乘 0.5~1.5 的随机因子。
 * 抖动的意义是避免多端同时断线后在同一毫秒一起打回后端，形成二次雪崩。
 */
export function reconnectDelay(attempt: number, random: () => number = Math.random): number {
  const base = Math.min(400 * Math.pow(2, Math.max(0, attempt - 1)), 4000)
  return Math.round(base * (0.5 + random()))
}

/** 面向用户的中文提示。首行说发生了什么，第二行说该做什么。 */
export function describeFailure(kind: FailureKind, detail?: string): { title: string; hint: string } {
  switch (kind) {
    case 'abort':
      return { title: '已停止生成', hint: '可点「从断点重试」接着写，已生成的内容不会丢。' }
    case 'offline':
      return { title: '网络已断开', hint: '检查网络后会自动重连；恢复前不必刷新页面。' }
    case 'timeout':
      return { title: detail || '连接超时', hint: '服务可能正在排队，稍等片刻再试一次。' }
    case 'network':
      return { title: detail || '网络中断', hint: '这是连接层的问题，不是你输入的问题；重试通常就能恢复。' }
    case 'server':
      return { title: detail || '服务端异常', hint: '后端这一步失败了，重试大概率有效；持续失败请稍后再来。' }
    case 'client':
      return { title: detail || '请求被拒绝', hint: '重试同样的请求不会有不同结果，请按提示调整需求或会话。' }
    default:
      return { title: detail || '出现了未预期的错误', hint: '可以先重试一次；仍然失败请复制错误详情反馈。' }
  }
}

/**
 * 把异常转成给用户看的一句话。
 * 后端返回的中文消息本身就有信息量（"今日额度已用完"），原样展示；
 * 而 `Failed to fetch` 这类浏览器原文对人没有意义，换成归类后的解释。
 */
export function humanizeError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err || '')
  const kind = classifyError(err)
  if (raw && /[\u4e00-\u9fa5]/.test(raw)) return raw
  const info = describeFailure(kind)
  return `${info.title}。${info.hint}`
}

/**
 * 空闲看门狗：每次收到数据就 touch()，超过 ms 没有任何数据就触发回调。
 * 用途是识别「连接还在但服务端已经不出声」的假死状态——这种连接不会报错，只会一直挂着。
 */
export interface Watchdog {
  touch: () => void
  clear: () => void
}

export function createWatchdog(ms: number, onFire: () => void): Watchdog {
  let timer: ReturnType<typeof setTimeout> | null = null
  let cleared = false

  const arm = () => {
    if (cleared) return
    if (timer !== null) clearTimeout(timer)
    timer = setTimeout(() => {
      timer = null
      if (!cleared) onFire()
    }, ms)
  }

  arm()

  return {
    touch: arm,
    clear: () => {
      cleared = true
      if (timer !== null) {
        clearTimeout(timer)
        timer = null
      }
    },
  }
}

/**
 * 带超时的 fetch：只负责「多久拿不到响应头就算失败」。
 * 流式响应拿到响应头之后还有长时间的数据传输，那部分交给 createWatchdog 管。
 */
export async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  ms: number,
): Promise<Response> {
  const external = init.signal
  if (external?.aborted) throw new DOMException('已取消', 'AbortError')

  const controller = new AbortController()
  let timedOut = false

  const onExternalAbort = () => controller.abort()
  external?.addEventListener('abort', onExternalAbort)

  const timer = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, ms)

  try {
    return await fetch(url, { ...init, signal: controller.signal })
  } catch (err) {
    if (timedOut) throw new TimeoutError(`连接超时（${Math.round(ms / 1000)} 秒内没有响应）`)
    throw err
  } finally {
    clearTimeout(timer)
    external?.removeEventListener('abort', onExternalAbort)
  }
}

/** 可被 abort 打断的 sleep，用于重连前的退避等待。 */
export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) {
      resolve()
      return
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    const onAbort = () => {
      clearTimeout(timer)
      resolve()
    }
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}
