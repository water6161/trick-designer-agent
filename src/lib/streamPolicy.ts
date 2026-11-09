import { classifyError, isRetryable, type FailureKind } from './net'

/**
 * 流式生成的失败恢复策略。
 *
 * 这里的取舍是刻意的：**只在「一个字都还没收到」时自动重连**。
 * 一旦已经吐出正文，自动重连会让第二遍的内容接在第一遍后面（重复开头、前后矛盾），
 * 用户看到的是"越修越乱"。这种情况宁可停下来，让人点「从断点重试」——由后端 checkpointer
 * 接着断点跑，而不是从头再来。
 */

export type StreamPhase = 'connect' | 'stream'

export interface StreamProgress {
  /** 已收到的正文字数 */
  chars: number
  /** 是否已收到 done 事件 */
  done: boolean
}

export interface StreamFailure {
  kind: FailureKind
  phase: StreamPhase
  message: string
}

export const MAX_AUTO_RECONNECT = 2

export function failureOf(err: unknown, phase: StreamPhase): StreamFailure {
  return {
    kind: classifyError(err),
    phase,
    message: err instanceof Error ? err.message : String(err || '未知错误'),
  }
}

/**
 * 连接阶段失败说明请求大概率没进到业务逻辑，原样重发是安全的；
 * 流阶段失败说明后端已经在跑了，改走断点续跑（不重复消耗已完成的阶段）。
 */
export function resumeMode(failure: StreamFailure): 'replay' | 'retry' {
  return failure.phase === 'connect' ? 'replay' : 'retry'
}

export function shouldAutoReconnect(
  failure: StreamFailure,
  progress: StreamProgress,
  attempt: number,
  max: number = MAX_AUTO_RECONNECT,
): boolean {
  if (attempt >= max) return false
  if (progress.done) return false
  // 已经有正文：自动重连只会产生重复内容，交给用户手动断点重试
  if (progress.chars > 0) return false
  return isRetryable(failure.kind)
}

export function reconnectStatusText(attempt: number, max: number = MAX_AUTO_RECONNECT): string {
  return `连接中断，正在自动重连（第 ${attempt}/${max} 次）`
}

/** 自动重连全部失败后的收尾提示：告诉用户发生了什么、还剩什么没用完。 */
export function exhaustedNotice(attempts: number): string {
  return `自动重连 ${attempts} 次仍失败。已生成的内容都保留着，可点「从断点重试」接着跑。`
}
