import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import EndingTree, { clueIdsOf } from '../src/components/EndingTree'
import type { PlanData } from '../src/types'

function planWith(endings: PlanData['endings']): PlanData {
  return {
    title: '暴雪山庄的密室',
    culprit: { character: '白棠', motive: '继承' },
    clues_public: [{ id: 'C1', name: '怀表', content: 'x', access: '公开' }],
    clues_deep: [{ id: 'D1', name: '药瓶', content: 'y', access: '搜证' }],
    endings,
  }
}

describe('clueIdsOf', () => {
  it('从「C1、D2」里拆出编号并转大写', () => {
    expect(clueIdsOf({ clues: 'C1、d2' })).toEqual(['C1', 'D2'])
  })

  it('去重', () => {
    expect(clueIdsOf({ clues: 'C1、C1、D1' })).toEqual(['C1', 'D1'])
  })

  it('没有编号列时返回空数组', () => {
    expect(clueIdsOf({ clues: '' })).toEqual([])
    expect(clueIdsOf({})).toEqual([])
  })

  it('不会把普通中文误认成编号', () => {
    expect(clueIdsOf({ clues: '怀表与药瓶' })).toEqual([])
  })
})

describe('EndingTree 渲染', () => {
  it('根节点显示本案真相与凶手', () => {
    const html = renderToStaticMarkup(<EndingTree plan={planWith([])} onClose={() => {}} />)
    expect(html).toContain('本案真相')
    expect(html).toContain('凶手：白棠')
  })

  it('每条分支显示名称、触发条件、走向', () => {
    const html = renderToStaticMarkup(
      <EndingTree
        plan={planWith([{ name: '真相大白', condition: '指认白棠', clues: 'C1、D1', outcome: '白棠伏法' }])}
        onClose={() => {}}
      />,
    )
    expect(html).toContain('真相大白')
    expect(html).toContain('触发：指认白棠')
    expect(html).toContain('白棠伏法')
  })

  it('第一条分支是真结局，带「真」徽章', () => {
    const html = renderToStaticMarkup(
      <EndingTree
        plan={planWith([
          { name: '真相大白', clues: 'C1' },
          { name: '替罪羊', clues: 'C1' },
        ])}
        onClose={() => {}}
      />,
    )
    expect(html).toContain('ending-true-badge')
    expect(html).toContain('真</span>')
  })

  it('支撑线索渲染成编号 chips', () => {
    const html = renderToStaticMarkup(
      <EndingTree plan={planWith([{ name: 'A', clues: 'C1、D1', outcome: 'x' }])} onClose={() => {}} />,
    )
    expect((html.match(/ending-clue-chip/g) ?? []).length).toBe(2)
  })

  it('引用了不存在的编号要标红警告', () => {
    const html = renderToStaticMarkup(
      <EndingTree plan={planWith([{ name: 'A', clues: 'C9', outcome: 'x' }])} onClose={() => {}} />,
    )
    expect(html).toContain('unknown')
    expect(html).toContain('不在线索表中')
  })

  it('没有结局时给引导文案而不是空白', () => {
    const html = renderToStaticMarkup(<EndingTree plan={planWith(undefined)} onClose={() => {}} />)
    expect(html).toContain('还没有分支结局')
    expect(html).toContain('加 2 条分支结局')
  })

  it('走向缺失时只显示有的部分，不渲染空标签', () => {
    const html = renderToStaticMarkup(
      <EndingTree plan={planWith([{ name: '沉默', clues: 'C1' }])} onClose={() => {} } />,
    )
    expect(html).toContain('沉默')
    expect(html).not.toContain('ending-outcome')
  })
})
