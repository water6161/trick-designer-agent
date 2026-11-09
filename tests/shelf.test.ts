import { describe, expect, it } from 'vitest'
import { filterShelf, planTitle, snippetAround, type ShelfItem } from '../src/lib/shelf'

function item(id: string, title: string, markdown: string, savedAt: number): ShelfItem {
  return { id, title, markdown, savedAt }
}

const ITEMS: ShelfItem[] = [
  item('a', '雪落无声的第七夜', '# 雪落无声的第七夜\n\n暴雪封山，书房反锁。', 300),
  item('b', '血色婚礼', '# 血色婚礼\n\n新娘在敬酒时倒下，所有人都在场。', 100),
  item('c', '灯塔守夜人', '# 灯塔守夜人\n\n孤岛灯塔，每夜十二点的钟声。', 200),
]

describe('filterShelf 搜索', () => {
  it('空关键词返回全部', () => {
    expect(filterShelf(ITEMS, '')).toHaveLength(3)
    expect(filterShelf(ITEMS, '   ')).toHaveLength(3)
  })

  it('按标题命中', () => {
    const result = filterShelf(ITEMS, '灯塔')
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('c')
  })

  it('按正文命中——用户记得的是情节而不是标题', () => {
    const result = filterShelf(ITEMS, '敬酒')
    expect(result.map((it) => it.id)).toEqual(['b'])
  })

  it('大小写不敏感', () => {
    const items = [item('x', 'Snow Night', '# Snow Night\n\nbody', 1)]
    expect(filterShelf(items, 'snow')).toHaveLength(1)
    expect(filterShelf(items, 'SNOW')).toHaveLength(1)
  })

  it('无命中返回空数组而不是全部', () => {
    expect(filterShelf(ITEMS, '不存在的关键词')).toEqual([])
  })
})

describe('filterShelf 排序', () => {
  it('默认按时间倒序（最近的在前）', () => {
    expect(filterShelf(ITEMS, '').map((it) => it.id)).toEqual(['a', 'c', 'b'])
  })

  it('可以按最旧优先', () => {
    expect(filterShelf(ITEMS, '', 'oldest').map((it) => it.id)).toEqual(['b', 'c', 'a'])
  })

  it('可以按标题排序（中文拼音序）', () => {
    const titles = filterShelf(ITEMS, '', 'title').map((it) => it.title)
    expect(titles).toEqual([...titles].sort((x, y) => x.localeCompare(y, 'zh-Hans-CN')))
  })

  it('搜索与排序同时生效', () => {
    const result = filterShelf(ITEMS, '的', 'oldest')
    expect(result.every((it) => it.title.includes('的') || it.markdown.includes('的'))).toBe(true)
  })

  it('不修改传入数组（纯函数）', () => {
    const original = [...ITEMS]
    filterShelf(ITEMS, '', 'title')
    expect(ITEMS.map((it) => it.id)).toEqual(original.map((it) => it.id))
  })
})

describe('snippetAround', () => {
  it('截出命中位置附近的文本', () => {
    const text = snippetAround(ITEMS[1].markdown, '敬酒')
    expect(text).toContain('敬酒')
    expect(text.length).toBeLessThan(120)
  })

  it('命中在开头时不加前置省略号', () => {
    expect(snippetAround('# 血色婚礼\n\n正文', '血色')).not.toMatch(/^…/)
  })

  it('末尾截断时加省略号', () => {
    const long = `开头${'内容'.repeat(80)}关键词${'尾巴'.repeat(80)}`
    const text = snippetAround(long, '关键词', 8)
    expect(text.startsWith('…')).toBe(true)
    expect(text.endsWith('…')).toBe(true)
  })

  it('没有命中返回空串，UI 不会显示空摘要', () => {
    expect(snippetAround(ITEMS[0].markdown, '不存在')).toBe('')
    expect(snippetAround(ITEMS[0].markdown, '')).toBe('')
  })
})

describe('planTitle', () => {
  it('取一级标题', () => {
    expect(planTitle('# 《雪落无声的第七夜》\n正文')).toBe('雪落无声的第七夜')
  })

  it('没有标题时用兜底文案', () => {
    expect(planTitle('只有正文', '未命名方案')).toBe('未命名方案')
  })
})
