import { describe, expect, it } from 'vitest'
import {
  diffLines,
  diffSummary,
  foldContext,
  summarizeSections,
  type DiffOp,
} from '../src/lib/diff'

const PLAN_A = `# 雪落无声的第七夜

> 一场无人可逃的雪夜审判

## 一、案件速览

暴雪封山第四天，山庄与外界断联。
顾寒山死在书房。

## 二、角色

- 沈墨：管家
- 白棠：外甥女
`

const PLAN_B = `# 雪落无声的第七夜

> 一场无人可逃的雪夜审判

## 一、案件速览

暴雪封山第四天，山庄与外界断联。
顾寒山死在书房，房门反锁。

## 二、角色

- 沈墨：管家
- 白棠：外甥女
- 周慈：医生
`

describe('diffLines', () => {
  it('完全相同的文本没有任何变化', () => {
    const result = diffLines(PLAN_A, PLAN_A)
    expect(result.stats.added).toBe(0)
    expect(result.stats.removed).toBe(0)
    expect(result.stats.changed).toBe(false)
    expect(result.sections).toEqual([])
  })

  it('识别出「改一行 + 加一行」', () => {
    const result = diffLines(PLAN_A, PLAN_B)
    // 案件速览那行被改写（一增一删），角色表末尾新增一行
    expect(result.stats.added).toBe(2)
    expect(result.stats.removed).toBe(1)
    expect(result.stats.changed).toBe(true)
  })

  it('修改一行 = 一增一删', () => {
    const result = diffLines('a\nb\nc', 'a\nB\nc')
    expect(result.stats.added).toBe(1)
    expect(result.stats.removed).toBe(1)
    expect(result.stats.unchanged).toBe(2)
  })

  it('新增行在 ops 里带正确的行号', () => {
    const result = diffLines('a\nb', 'a\nb\nc')
    const added = result.ops.filter((op) => op.type === 'add')
    expect(added).toHaveLength(1)
    expect(added[0].right).toBe(3)
    expect(added[0].left).toBe(0)
  })

  it('空版本与有内容版本之间是纯新增', () => {
    const result = diffLines('', PLAN_A)
    expect(result.stats.removed).toBe(0)
    expect(result.stats.added).toBeGreaterThan(0)
  })

  it('CRLF 与 LF 不算整篇重写', () => {
    const result = diffLines(PLAN_A.replace(/\n/g, '\r\n'), PLAN_A)
    expect(result.stats.added).toBe(0)
    expect(result.stats.removed).toBe(0)
  })

  it('ops 顺序还原后就是新版本', () => {
    const result = diffLines(PLAN_A, PLAN_B)
    const rebuilt = result.ops.filter((op) => op.type !== 'del').map((op) => op.text)
    expect(rebuilt.join('\n')).toBe(PLAN_B)
  })

  it('ops 去掉新增行后还原成旧版本', () => {
    const result = diffLines(PLAN_A, PLAN_B)
    const rebuilt = result.ops.filter((op) => op.type !== 'add').map((op) => op.text)
    expect(rebuilt.join('\n')).toBe(PLAN_A)
  })
})

describe('summarizeSections', () => {
  it('改动归属到正确的章节', () => {
    const result = diffLines(PLAN_A, PLAN_B)
    const caseFile = result.sections.find((item) => item.title === '一、案件速览')
    const roles = result.sections.find((item) => item.title === '二、角色')
    expect(caseFile?.added).toBe(1)
    expect(roles?.added).toBe(1)
    expect(result.stats.sections).toBe(2)
  })

  it('删除整章时算在该章名下', () => {
    const before = '## 一、开头\n内容\n\n## 二、会被删的一章\n只有这一行\n'
    const after = '## 一、开头\n内容\n'
    const result = diffLines(before, after)
    const removedSection = result.sections.find((item) => item.title === '二、会被删的一章')
    expect(removedSection?.removed).toBeGreaterThan(0)
  })

  it('标题之前的改动归入「开篇」', () => {
    const result = diffLines('旧引言\n\n## 一、正文\nx', '新引言\n\n## 一、正文\nx')
    expect(result.sections[0].title).toBe('（开篇）')
  })

  it('没有改动的章节不出现在汇总里', () => {
    const result = diffLines(PLAN_A, PLAN_B)
    expect(result.sections.some((item) => item.title === '（开篇）')).toBe(false)
  })
})

describe('foldContext', () => {
  const ops: DiffOp[] = []
  for (let i = 1; i <= 30; i += 1) {
    ops.push({ type: i === 15 ? 'add' : 'same', text: `line ${i}`, left: i, right: i })
  }

  it('只保留变化点附近的行，其余折叠成 gap', () => {
    const folded = foldContext(ops, 2)
    const kept = folded.filter((item) => item.type !== 'gap')
    expect(kept.length).toBe(5) // 变化行 + 上下各 2 行
    const gaps = folded.filter((item) => item.type === 'gap') as Array<{ count: number }>
    expect(gaps.reduce((sum, item) => sum + item.count, 0)).toBe(25)
  })

  it('没有变化时全部折叠，不输出逐行内容', () => {
    const same = ops.map((op) => ({ ...op, type: 'same' as const }))
    const folded = foldContext(same, 2)
    expect(folded).toHaveLength(1)
    expect(folded[0]).toEqual({ type: 'gap', count: 30 })
  })

  it('变化在开头时不产生前导 gap', () => {
    const head = [{ type: 'add' as const, text: 'new', left: 0, right: 1 }, ...ops.slice(0, 5)]
    const folded = foldContext(head, 1)
    expect(folded[0].type).toBe('add')
  })
})

describe('diffSummary', () => {
  it('没有差异时的说法', () => {
    expect(diffSummary({ added: 0, removed: 0, unchanged: 10, sections: 0, changed: false })).toBe(
      '与当前版本完全一致',
    )
  })

  it('有差异时列出增删与章节数', () => {
    const text = diffSummary({ added: 12, removed: 3, unchanged: 40, sections: 2, changed: true })
    expect(text).toBe('新增 12 行，删除 3 行，涉及 2 个章节')
  })

  it('只有新增时不提删除', () => {
    expect(diffSummary({ added: 5, removed: 0, unchanged: 1, sections: 1, changed: true })).toBe(
      '新增 5 行，涉及 1 个章节',
    )
  })
})

describe('大文本退化路径', () => {
  it('超长方案不会卡死，仍给出准确的增删行数', () => {
    const before = Array.from({ length: 2100 }, (_, i) => `第 ${i} 行内容`).join('\n')
    const after = `${before}\n新增一行`
    const started = Date.now()
    const result = diffLines(before, after)
    expect(Date.now() - started).toBeLessThan(3000)
    expect(result.stats.added).toBe(1)
  })
})
