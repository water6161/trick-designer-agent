import { describe, expect, it } from 'vitest'
import {
  exhaustedNotice,
  failureOf,
  MAX_AUTO_RECONNECT,
  reconnectStatusText,
  resumeMode,
  shouldAutoReconnect,
  type StreamFailure,
  type StreamProgress,
} from '../src/lib/streamPolicy'

const idle: StreamProgress = { chars: 0, done: false }

function failure(phase: 'connect' | 'stream', kind: StreamFailure['kind'] = 'network'): StreamFailure {
  return { phase, kind, message: 'x' }
}

describe('failureOf', () => {
  it('把普通异常归类成流失败', () => {
    const result = failureOf(new TypeError('Failed to fetch'), 'connect')
    expect(result.kind).toBe('network')
    expect(result.phase).toBe('connect')
    expect(result.message).toContain('Failed to fetch')
  })

  it('空错误也有兜底文案', () => {
    expect(failureOf(undefined, 'stream').message).toBe('未知错误')
  })
})

describe('resumeMode', () => {
  it('连接阶段失败可以原样重发（请求没进业务逻辑）', () => {
    expect(resumeMode(failure('connect'))).toBe('replay')
  })

  it('流阶段失败走断点续跑，不重复消耗已完成阶段', () => {
    expect(resumeMode(failure('stream'))).toBe('retry')
  })
})

describe('shouldAutoReconnect', () => {
  it('一个字都没收到时，瞬时故障自动重连', () => {
    expect(shouldAutoReconnect(failure('connect', 'network'), idle, 0)).toBe(true)
    expect(shouldAutoReconnect(failure('stream', 'timeout'), idle, 0)).toBe(true)
    expect(shouldAutoReconnect(failure('connect', 'server'), idle, 1)).toBe(true)
  })

  it('已经有正文就绝不自动重连——避免重复内容接在原文后面', () => {
    expect(shouldAutoReconnect(failure('stream', 'network'), { chars: 1, done: false }, 0)).toBe(false)
    expect(shouldAutoReconnect(failure('stream', 'network'), { chars: 5000, done: false }, 0)).toBe(false)
  })

  it('已经收到 done 的收尾断流不重连', () => {
    expect(shouldAutoReconnect(failure('stream', 'network'), { chars: 0, done: true }, 0)).toBe(false)
  })

  it('达到次数上限后停止', () => {
    for (let attempt = 0; attempt < MAX_AUTO_RECONNECT; attempt += 1) {
      expect(shouldAutoReconnect(failure('connect', 'network'), idle, attempt)).toBe(true)
    }
    expect(shouldAutoReconnect(failure('connect', 'network'), idle, MAX_AUTO_RECONNECT)).toBe(false)
  })

  it('用户主动取消和参数错误不重连', () => {
    expect(shouldAutoReconnect(failure('connect', 'abort'), idle, 0)).toBe(false)
    expect(shouldAutoReconnect(failure('connect', 'client'), idle, 0)).toBe(false)
  })

  it('上限可被调用方覆盖', () => {
    expect(shouldAutoReconnect(failure('connect', 'network'), idle, 2, 3)).toBe(true)
    expect(shouldAutoReconnect(failure('connect', 'network'), idle, 3, 3)).toBe(false)
  })
})

describe('提示文案', () => {
  it('重连提示带上第几次', () => {
    expect(reconnectStatusText(2)).toBe('连接中断，正在自动重连（第 2/2 次）')
    expect(reconnectStatusText(1, 5)).toContain('1/5')
  })

  it('重试用尽后告诉用户内容还在、下一步点哪里', () => {
    const message = exhaustedNotice(2)
    expect(message).toContain('2 次')
    expect(message).toContain('断点重试')
  })
})
