import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  classifyError,
  createWatchdog,
  describeFailure,
  fetchWithTimeout,
  HttpError,
  humanizeError,
  isRetryable,
  OfflineError,
  reconnectDelay,
  sleep,
  TimeoutError,
} from '../src/lib/net'

function namedError(name: string, message = ''): Error {
  const err = new Error(message)
  err.name = name
  return err
}

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('classifyError', () => {
  it('识别用户主动取消', () => {
    expect(classifyError(namedError('AbortError'))).toBe('abort')
    expect(classifyError(new Error('The operation was aborted'))).toBe('abort')
  })

  it('识别超时与离线', () => {
    expect(classifyError(new TimeoutError())).toBe('timeout')
    expect(classifyError(new Error('请求超时，请重试'))).toBe('timeout')
    expect(classifyError(new OfflineError())).toBe('offline')
  })

  it('按状态码区分服务端错误与客户端错误', () => {
    expect(classifyError(new HttpError(500, 'boom'))).toBe('server')
    expect(classifyError(new HttpError(503, 'busy'))).toBe('server')
    expect(classifyError(new HttpError(404, 'not found'))).toBe('client')
    expect(classifyError(new HttpError(429, 'slow down'))).toBe('client')
  })

  it('识别浏览器原生网络错误', () => {
    expect(classifyError(new TypeError('Failed to fetch'))).toBe('network')
    expect(classifyError(new TypeError('Load failed'))).toBe('network')
    expect(classifyError(new Error('NetworkError when attempting to fetch resource.'))).toBe('network')
  })

  it('兜底为 unknown', () => {
    expect(classifyError(null)).toBe('unknown')
    expect(classifyError('随便什么字符串')).toBe('unknown')
  })
})

describe('isRetryable', () => {
  it('瞬时故障可重试', () => {
    expect(isRetryable('timeout')).toBe(true)
    expect(isRetryable('network')).toBe(true)
    expect(isRetryable('server')).toBe(true)
    expect(isRetryable('offline')).toBe(true)
  })

  it('用户取消与参数错误不该重试', () => {
    expect(isRetryable('abort')).toBe(false)
    expect(isRetryable('client')).toBe(false)
    expect(isRetryable('unknown')).toBe(false)
  })
})

describe('reconnectDelay', () => {
  it('按指数增长并在上限封顶', () => {
    expect(reconnectDelay(1, () => 0)).toBe(200)
    expect(reconnectDelay(1, () => 1)).toBe(600)
    expect(reconnectDelay(2, () => 0)).toBe(400)
    expect(reconnectDelay(3, () => 0)).toBe(800)
    // 超过上限后基础间隔固定在 4s，抖动区间 2s~6s
    expect(reconnectDelay(9, () => 0)).toBe(2000)
    expect(reconnectDelay(9, () => 1)).toBe(6000)
  })

  it('抖动让同一尝试次数的间隔不固定', () => {
    const samples = new Set([0.1, 0.3, 0.5, 0.7, 0.9].map((r) => reconnectDelay(2, () => r)))
    expect(samples.size).toBe(5)
  })
})

describe('describeFailure / humanizeError', () => {
  it('每种失败都有标题和下一步建议', () => {
    for (const kind of ['abort', 'offline', 'timeout', 'network', 'server', 'client', 'unknown'] as const) {
      const info = describeFailure(kind)
      expect(info.title.length).toBeGreaterThan(0)
      expect(info.hint.length).toBeGreaterThan(0)
    }
  })

  it('后端给的中文消息原样透出，不被通用文案覆盖', () => {
    expect(humanizeError(new Error('今日额度已用完，请明天再来'))).toBe('今日额度已用完，请明天再来')
  })

  it('浏览器英文原文换成可读解释', () => {
    const message = humanizeError(new TypeError('Failed to fetch'))
    expect(message).toContain('网络中断')
    expect(message).not.toContain('Failed to fetch')
  })
})

describe('createWatchdog', () => {
  it('在静默超过阈值后触发一次', async () => {
    vi.useFakeTimers()
    const onFire = vi.fn()
    createWatchdog(1000, onFire)
    expect(onFire).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(999)
    expect(onFire).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(onFire).toHaveBeenCalledTimes(1)
  })

  it('touch 会重置计时', async () => {
    vi.useFakeTimers()
    const onFire = vi.fn()
    const dog = createWatchdog(1000, onFire)
    await vi.advanceTimersByTimeAsync(800)
    dog.touch()
    await vi.advanceTimersByTimeAsync(800)
    expect(onFire).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(200)
    expect(onFire).toHaveBeenCalledTimes(1)
  })

  it('clear 之后不再触发', async () => {
    vi.useFakeTimers()
    const onFire = vi.fn()
    const dog = createWatchdog(1000, onFire)
    dog.clear()
    await vi.advanceTimersByTimeAsync(5000)
    expect(onFire).not.toHaveBeenCalled()
  })

  it('触发后不会重复触发（避免假死连接反复报告）', async () => {
    vi.useFakeTimers()
    const onFire = vi.fn()
    createWatchdog(100, onFire)
    await vi.advanceTimersByTimeAsync(1000)
    expect(onFire).toHaveBeenCalledTimes(1)
  })
})

describe('sleep', () => {
  it('到点自行唤醒', async () => {
    vi.useFakeTimers()
    let done = false
    const promise = sleep(500).then(() => {
      done = true
    })
    await vi.advanceTimersByTimeAsync(499)
    expect(done).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    await promise
    expect(done).toBe(true)
  })

  it('信号已取消时立即返回，不空等', async () => {
    const controller = new AbortController()
    controller.abort()
    const started = Date.now()
    await sleep(10_000, controller.signal)
    expect(Date.now() - started).toBeLessThan(50)
  })

  it('等待中取消也能提前退出', async () => {
    const controller = new AbortController()
    let done = false
    const promise = sleep(10_000, controller.signal).then(() => {
      done = true
    })
    controller.abort()
    await promise
    expect(done).toBe(true)
  })
})

describe('fetchWithTimeout', () => {
  it('响应及时时正常返回', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('ok')))
    const response = await fetchWithTimeout('/x', {}, 1000)
    expect(await response.text()).toBe('ok')
  })

  it('超时抛出 TimeoutError 而不是 AbortError', async () => {
    vi.useFakeTimers()
    vi.stubGlobal(
      'fetch',
      vi.fn((_url: string, init: RequestInit) => {
        return new Promise((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => {
            reject(namedError('AbortError', 'aborted'))
          })
        })
      }),
    )
    const pending = fetchWithTimeout('/x', {}, 1000)
    const assertion = expect(pending).rejects.toBeInstanceOf(TimeoutError)
    await vi.advanceTimersByTimeAsync(1000)
    await assertion
  })

  it('调用方主动取消时透出 AbortError，不被误判为超时', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((_url: string, init: RequestInit) => {
        return new Promise((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => {
            reject(namedError('AbortError', 'aborted'))
          })
        })
      }),
    )
    const controller = new AbortController()
    const pending = fetchWithTimeout('/x', { signal: controller.signal }, 60_000)
    const assertion = expect(pending).rejects.toSatisfy((err: unknown) => classifyError(err) === 'abort')
    controller.abort()
    await assertion
  })

  it('已经取消的信号不会真的发起请求', async () => {
    const spy = vi.fn()
    vi.stubGlobal('fetch', spy)
    const controller = new AbortController()
    controller.abort()
    await expect(fetchWithTimeout('/x', { signal: controller.signal }, 1000)).rejects.toThrow()
    expect(spy).not.toHaveBeenCalled()
  })
})
