import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import RulesCard from '../src/components/RulesCard'
import type { PlanRules } from '../src/types'

function makeRules(overrides: Partial<PlanRules> = {}): PlanRules {
  return {
    fairness: {
      score: 88,
      passed: true,
      ready: true,
      blockers: [],
      stats: { clues: 9, public: 6, deep: 3, characters: 6, timeline: 5, steps: 4 },
      checks: [
        {
          code: 'clue_access',
          label: '线索获取方式齐全',
          level: 'error',
          weight: 12,
          ratio: 1,
          status: 'pass',
          detail: '9 条线索均写明获取方式',
        },
        {
          code: 'culprit_on_timeline',
          label: '凶手行动线可验证',
          level: 'error',
          weight: 9,
          ratio: 0,
          status: 'fail',
          detail: '凶手「林昭」没有出现在时间线里',
        },
        {
          code: 'timeline_public',
          label: '公开时间锚点 ≥2 个',
          level: 'warn',
          weight: 5,
          ratio: 0.5,
          status: 'partial',
          detail: '公开时间锚点不足 2 个',
        },
      ],
    },
    trickGraph: {
      category: '密室',
      coverage: 0.75,
      conditions: [
        { key: 'entry', label: '进出方式', matched: ['C1', 'C2'], satisfied: true, sources: 2, inTrick: true, advisory: false },
        { key: 'lock', label: '上锁方式与时机', matched: ['C1'], satisfied: true, sources: 1, inTrick: true, advisory: false },
        { key: 'trace', label: '痕迹处理', matched: [], satisfied: false, sources: 0, inTrick: false, advisory: false },
        { key: 'motive', label: '动机可查', matched: [], satisfied: false, sources: 0, inTrick: false, advisory: true },
      ],
      gaps: [{ key: 'trace', label: '痕迹处理', hint: '没有痕迹类线索，搜证环节会空转' }],
      advisories: [{ key: 'motive', label: '动机可查', hint: '凶手的动机没有线索支撑' }],
      verdict: '密室类诡计有 1 项成立条件找不到玩家可见线索支撑',
    },
    difficulty: {
      score: 52,
      tier: '进阶',
      tierNote: '常规商业本难度，需要 DM 在第二幕给一次提示',
      minutes: { min: 210, max: 270, label: '3.5~4.5 小时' },
      players: '6人',
      factors: [{ label: '嫌疑人数', value: '6 人', points: 15 }],
      note: '按 6 人推算',
    },
    ...overrides,
  }
}

describe('RulesCard', () => {
  it('展示硬规则总分与结论', () => {
    const html = renderToStaticMarkup(<RulesCard rules={makeRules()} />)
    expect(html).toContain('88/100')
    expect(html).toContain('可开本')
  })

  it('未通过的规则会显示原因', () => {
    const html = renderToStaticMarkup(<RulesCard rules={makeRules()} />)
    expect(html).toContain('凶手行动线可验证')
    expect(html).toContain('没有出现在时间线里')
  })

  it('通过的规则不占用列表位置', () => {
    const html = renderToStaticMarkup(<RulesCard rules={makeRules()} />)
    expect(html).not.toContain('9 条线索均写明获取方式')
  })

  it('有待修项时显示统计摘要', () => {
    const html = renderToStaticMarkup(<RulesCard rules={makeRules()} />)
    expect(html).toContain('3 项规则 · 1 项通过 · 2 项待修')
  })

  it('有硬伤时给出对应结论', () => {
    const rules = makeRules()
    rules.fairness!.ready = false
    rules.fairness!.passed = false
    const html = renderToStaticMarkup(<RulesCard rules={rules} />)
    expect(html).toContain('有硬伤')
  })

  it('展示诡计成立条件与覆盖率', () => {
    const html = renderToStaticMarkup(<RulesCard rules={makeRules()} />)
    expect(html).toContain('诡计成立条件 · 密室')
    expect(html).toContain('覆盖 75%')
    expect(html).toContain('✓ 进出方式')
    expect(html).toContain('✕ 痕迹处理')
  })

  it('建议类条件不计入覆盖矩阵', () => {
    const html = renderToStaticMarkup(<RulesCard rules={makeRules()} />)
    expect(html).not.toContain('动机可查')
  })

  it('缺口给出补线索提示', () => {
    const html = renderToStaticMarkup(<RulesCard rules={makeRules()} />)
    expect(html).toContain('没有痕迹类线索')
  })

  it('展示难度档位与建议时长', () => {
    const html = renderToStaticMarkup(<RulesCard rules={makeRules()} />)
    expect(html).toContain('进阶')
    expect(html).toContain('3.5~4.5 小时')
    expect(html).toContain('6人')
    expect(html).toContain('复杂度 52')
  })

  it('规则全部通过时给出全通过文案', () => {
    const rules = makeRules()
    rules.fairness!.checks = rules.fairness!.checks.map((item) => ({ ...item, status: 'pass' as const, ratio: 1 }))
    const html = renderToStaticMarkup(<RulesCard rules={rules} />)
    expect(html).toContain('全部规则通过')
  })

  it('传入回调时给出补齐入口', () => {
    let clicked = 0
    const html = renderToStaticMarkup(<RulesCard rules={makeRules()} onFix={() => { clicked += 1 }} />)
    expect(html).toContain('按缺口补写线索')
  })

  it('没有缺口时不显示补齐按钮', () => {
    const rules = makeRules()
    rules.trickGraph!.gaps = []
    const html = renderToStaticMarkup(<RulesCard rules={rules} onFix={() => {}} />)
    expect(html).not.toContain('按缺口补写线索')
  })

  it('缺少全部字段时不渲染内容', () => {
    const html = renderToStaticMarkup(<RulesCard rules={{}} />)
    expect(html).toBe('')
  })
})
