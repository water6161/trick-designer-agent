/**
 * 生成耗时预估：给「已用多久 / 还剩多久」提供数据。
 *
 * 基准值来自服务器实测（deepseek-v4.1-flash-1017，2026-11 数据）：
 * - 极速模式约 13 秒（理解 1s + 设计 7s + 提取 5s）
 * - 完整模式约 84 秒（设计占 6 成以上，是最长的一段）
 *
 * 设计取向：宁可估不准也不要让人以为卡死——
 * 倒计时永远不给 0，超时后由界面上「比预计慢，仍在生成中」兜底。
 */

export type RunStage = 'understand' | 'research' | 'design' | 'extract' | 'score' | 'compose'

const ORDER: RunStage[] = ['understand', 'research', 'design', 'extract', 'score', 'compose']

/** 各阶段占整体耗时的比例（按实测均值归一化） */
const WEIGHTS: Record<RunStage, number> = {
  understand: 0.04,
  research: 0.02,
  design: 0.62,
  extract: 0.17,
  score: 0.11,
  compose: 0.04,
}

export const BASE_SECONDS = { speed: 14, full: 84 }

/** 超过基准多少倍开始提示「比预计慢」 */
const SLOW_FACTOR = 1.8
/** 倒计时下限：即使已经超时也留一点余量，避免显示 0 秒像卡住 */
const MIN_REMAINING = 5

export interface RunEstimate {
  elapsedSec: number
  remainingSec: number
  slow: boolean
}

function consumedBefore(index: number): number {
  if (index <= 0) return 0
  let sum = 0
  for (let i = 0; i < index && i < ORDER.length; i += 1) sum += WEIGHTS[ORDER[i]]
  return Math.min(sum, 0.97)
}

/**
 * 按当前阶段与已用时间估算剩余。
 * @param stage 后端 status 事件的 stage；空串表示还没收到第一个阶段
 * @param elapsedSec 本次生成已用时（秒）
 * @param speed 是否极速模式
 */
export function estimateRun(stage: string, elapsedSec: number, speed: boolean): RunEstimate {
  const base = speed ? BASE_SECONDS.speed : BASE_SECONDS.full
  const index = ORDER.indexOf(stage as RunStage)
  const done = consumedBefore(index)
  const stageBudget = base * (1 - done)
  const spentInStage = Math.max(0, elapsedSec - base * done)

  let remaining = stageBudget - spentInStage
  if (remaining < 0) {
    // 已超过该阶段基准：按保守余量续命，交给 slow 提示接管
    remaining = Math.max(stageBudget * 0.35, MIN_REMAINING)
  }

  const elapsed = Math.max(0, Math.round(elapsedSec))
  return {
    elapsedSec: elapsed,
    remainingSec: Math.max(Math.round(remaining), MIN_REMAINING),
    slow: elapsedSec > base * SLOW_FACTOR,
  }
}

/** 70 → "1 分 10 秒"，12 → "12 秒" */
export function formatDuration(sec: number): string {
  const total = Math.max(0, Math.round(sec))
  if (total < 60) return `${total} 秒`
  const minutes = Math.floor(total / 60)
  const seconds = total % 60
  return seconds ? `${minutes} 分 ${seconds} 秒` : `${minutes} 分`
}
