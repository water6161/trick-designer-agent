import { describe, expect, it } from 'vitest'

import { BASE_SECONDS, estimateRun, formatDuration } from '../src/lib/eta'

describe('estimateRun：剩余时间估算', () => {
  it('刚发起、还没收到阶段：按整轮基准给时间', () => {
    const full = estimateRun('', 0, false)
    expect(full.remainingSec).toBe(BASE_SECONDS.full)
    expect(full.remainingSec).toBeGreaterThan(BASE_SECONDS.speed * 3)
    expect(full.slow).toBe(false)
  })

  it('极速模式的基准明显短于完整模式', () => {
    expect(estimateRun('', 0, true).remainingSec).toBe(BASE_SECONDS.speed)
    expect(estimateRun('', 0, false).remainingSec).toBe(BASE_SECONDS.full)
  })

  it('进入 design 阶段时剩余最多：这是最长的一段', () => {
    const design = estimateRun('design', 5, false)
    const extract = estimateRun('extract', 60, false)
    expect(design.remainingSec).toBeGreaterThan(extract.remainingSec)
  })

  it('同一阶段内随时间递减', () => {
    const early = estimateRun('design', 5, false)
    const late = estimateRun('design', 30, false)
    expect(late.remainingSec).toBeLessThan(early.remainingSec)
  })

  it('倒计时永不为 0：超时后仍保留最小余量', () => {
    const overdue = estimateRun('design', 600, false)
    expect(overdue.remainingSec).toBeGreaterThan(0)
    expect(overdue.remainingSec).toBeGreaterThanOrEqual(5)
  })

  it('超过基准 1.8 倍标 slow，之前不标', () => {
    expect(estimateRun('design', BASE_SECONDS.full * 1.7, false).slow).toBe(false)
    expect(estimateRun('design', BASE_SECONDS.full * 1.9, false).slow).toBe(true)
  })

  it('极速模式下的 slow 阈值也按极速基准算', () => {
    expect(estimateRun('design', 20, true).slow).toBe(false)
    expect(estimateRun('design', 30, true).slow).toBe(true)
  })

  it('未知阶段按「刚开始」处理，不会算出负数', () => {
    const unknown = estimateRun('finalize', 3, false)
    expect(unknown.elapsedSec).toBe(3)
    expect(unknown.remainingSec).toBeGreaterThan(0)
  })
})

describe('formatDuration', () => {
  it('一分钟以内用秒', () => {
    expect(formatDuration(12)).toBe('12 秒')
    expect(formatDuration(0)).toBe('0 秒')
  })

  it('超过一分钟用分秒', () => {
    expect(formatDuration(70)).toBe('1 分 10 秒')
    expect(formatDuration(120)).toBe('2 分')
  })

  it('负数兜底为 0 秒', () => {
    expect(formatDuration(-5)).toBe('0 秒')
  })
})
