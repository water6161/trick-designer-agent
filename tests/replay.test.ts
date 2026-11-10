import { describe, expect, it } from 'vitest'
import { buildFrames, REPLAY_STEP_MS } from '../src/lib/replay'

describe('案件重演帧编排', () => {
  it('事件按原顺序变成事件帧', () => {
    const frames = buildFrames(
      [
        { time: '21:20', event: '怀表被调快', visibility: '公开' },
        { time: '21:40', event: '书房倒地声', witness: '周慈', visibility: '公开' },
      ],
      null,
    )
    expect(frames).toHaveLength(2)
    expect(frames[0]).toMatchObject({ kind: 'event', time: '21:20', event: '怀表被调快' })
    expect(frames[1]).toMatchObject({ kind: 'event', witness: '周慈' })
  })

  it('「深入」标记传递到帧上，其余可见性不标', () => {
    const frames = buildFrames(
      [
        { time: '21:00', event: 'a', visibility: '深入（搜证·书房）' },
        { time: '21:10', event: 'b', visibility: '公开' },
        { time: '21:15', event: 'c' },
      ],
      null,
    )
    expect(frames.map((f) => f.deep)).toEqual([true, false, false])
  })

  it('有凶手才有真相终幕，事件帧在前真相帧收尾', () => {
    const frames = buildFrames([{ time: '21:40', event: '倒地' }], {
      character: '白棠',
      motive: '她才是真正的继承人',
    })
    expect(frames).toHaveLength(2)
    expect(frames[frames.length - 1]).toEqual({
      kind: 'truth',
      culprit: '白棠',
      motive: '她才是真正的继承人',
    })
  })

  it('时间线为空但解析出凶手：只剩真相帧，也能放', () => {
    const frames = buildFrames(undefined, { character: '沈墨', motive: '遗嘱' })
    expect(frames).toEqual([{ kind: 'truth', culprit: '沈墨', motive: '遗嘱' }])
  })

  it('什么都没有返回空数组——UI 据此不进回放', () => {
    expect(buildFrames(undefined, null)).toEqual([])
    expect(buildFrames([], {})).toEqual([])
  })

  it('缺失字段容错：事件帧字段全部可选', () => {
    const frames = buildFrames([{}], null)
    expect(frames).toEqual([{ kind: 'event', time: undefined, event: undefined, witness: undefined, deep: false }])
  })

  it('步进间隔是讲一句话的工夫', () => {
    expect(REPLAY_STEP_MS).toBeGreaterThanOrEqual(2000)
    expect(REPLAY_STEP_MS).toBeLessThanOrEqual(4000)
  })
})
