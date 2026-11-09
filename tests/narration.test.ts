import { describe, expect, it } from 'vitest'
import { narrateStage } from '../src/lib/narration'
import type { PlanData } from '../src/types'

const PLAN: PlanData = {
  title: '雪落无声的第七夜',
  tagline: '一场无人可逃的雪夜审判',
  background: '暴雪封山第四天。\n电话线在凌晨被压断。',
  victim: {
    name: '顾寒山',
    identity: '退休法官',
    death_time: '第一幕 21:40',
    cause: '中毒',
    scene: '书房反锁',
    found_by: '管家撞门',
  },
  characters: [
    { name: '沈墨', identity: '管家', suspicion: '与死者争吵' },
    { name: '白棠', identity: '外甥女' },
  ],
  clues_public: [
    { id: 'C1', name: '怀表', content: '快二十分钟' },
    { id: 'C2', name: '细线', content: '门缝里的线' },
  ],
  timeline: [
    { time: '21:40', event: '书房传出倒地声', witness: '走廊的周慈', visibility: '公开' },
    { time: '21:55', event: '陆迟返回书房', witness: '监控', visibility: '深入' },
  ],
  interactions: [
    { title: '雨夜敲门', scene: '门外有人', options: [{ text: '开门' }, { text: '猫眼' }] },
    { title: '只有一项', scene: '无效节点', options: [{ text: '唯一' }] },
  ],
}

describe('narrateStage', () => {
  it('序幕念标题与卖点', () => {
    const out = narrateStage(0, PLAN)
    expect(out).toContain('雪落无声的第七夜。')
    expect(out).toContain('一场无人可逃的雪夜审判。')
  })

  it('背景逐段成句，不把两段粘在一起', () => {
    const out = narrateStage(1, PLAN)
    expect(out).toBe('背景。暴雪封山第四天。电话线在凌晨被压断。')
  })

  it('案发带出五个字段', () => {
    const out = narrateStage(2, PLAN)
    expect(out).toContain('死者，顾寒山。')
    expect(out).toContain('死亡时间，第一幕 21:40。')
    expect(out).toContain('发现，管家撞门。')
  })

  it('人物逐个介绍并带出疑点', () => {
    const out = narrateStage(3, PLAN)
    expect(out).toContain('沈墨，管家。被怀疑的地方是，与死者争吵。')
    expect(out).toContain('白棠，外甥女。')
  })

  it('搜证只报数量，不念线索内容（留给玩家翻开）', () => {
    const out = narrateStage(4, PLAN)
    expect(out).toContain('2条公开线索')
    expect(out).not.toContain('快二十分钟')
  })

  it('时间线跳过「深入」条目', () => {
    const out = narrateStage(5, PLAN)
    expect(out).toContain('21:40，书房传出倒地声')
    expect(out).not.toContain('陆迟返回书房')
  })

  it('抉择只数有效节点（选项 ≥ 2）', () => {
    expect(narrateStage(7, PLAN)).toContain('1个互动节点')
  })

  it('空方案每个分镜都有兜底话术，不返回空串', () => {
    for (const stage of [0, 1, 2, 3, 4, 5, 6, 7]) {
      expect(narrateStage(stage, null).length).toBeGreaterThan(0)
    }
  })

  it('未知分镜返回空串（不瞎念）', () => {
    expect(narrateStage(99, PLAN)).toBe('')
  })

  it('缺标点的字段会被补上句号，保证切块正确', () => {
    const out = narrateStage(2, { victim: { name: '某人', cause: '中毒' } })
    expect(out).toContain('死者，某人。')
    expect(out).toContain('死因，中毒。')
  })
})
