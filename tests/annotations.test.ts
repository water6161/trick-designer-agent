import { describe, expect, it } from 'vitest'
import {
  addAnnotation,
  ANNOTATION_STORAGE_KEY,
  annotationsToText,
  clearAnnotations,
  listAnnotations,
  readAll,
  removeAnnotation,
  updateNote,
} from '../src/lib/annotations'

/** 每个用例一个独立内存仓库，模拟 localStorage 的读写与抛错。 */
function memoryStore(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial))
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => void map.set(key, value),
    removeItem: (key: string) => void map.delete(key),
  }
}

const INPUT = {
  conversationId: 'conv-1',
  messageId: 'm1',
  quote: '凶手在 21:20 之前把死者怀表调快二十分钟',
  note: '这里补一个怀表谁调的伏笔',
}

describe('本地批注', () => {
  it('新增后能按会话读出来，字段都被规整', () => {
    const store = memoryStore()
    addAnnotation(INPUT, store, 1000)

    const list = listAnnotations('conv-1', store)
    expect(list).toHaveLength(1)
    expect(list[0].quote).toBe(INPUT.quote)
    expect(list[0].note).toBe(INPUT.note)
    expect(list[0].createdAt).toBe(1000)

    // 别的会话读不到
    expect(listAnnotations('conv-2', store)).toHaveLength(0)
  })

  it('片段与批注都截断到上限，防止 localStorage 被一大段复制顶爆', () => {
    const store = memoryStore()
    const created = addAnnotation(
      { ...INPUT, quote: '长'.repeat(500), note: '注'.repeat(2000) },
      store,
    )
    expect(created.quote.length).toBeLessThanOrEqual(240)
    expect(created.note.length).toBeLessThanOrEqual(1000)
  })

  it('同一条消息对同一段原文重复加批注 = 修改，不产生重复条目', () => {
    const store = memoryStore()
    const first = addAnnotation(INPUT, store, 1000)
    const again = addAnnotation({ ...INPUT, note: '改成另一个说法' }, store, 2000)

    expect(listAnnotations('conv-1', store)).toHaveLength(1)
    expect(again.id).not.toBe(first.id)
    expect(listAnnotations('conv-1', store)[0].note).toBe('改成另一个说法')
  })

  it('批注按时间升序排，先加的在前', () => {
    const store = memoryStore()
    addAnnotation({ ...INPUT, messageId: 'm2' }, store, 3000)
    addAnnotation(INPUT, store, 1000)
    addAnnotation({ ...INPUT, messageId: 'm3' }, store, 2000)

    const list = listAnnotations('conv-1', store)
    expect(list.map((item) => item.messageId)).toEqual(['m1', 'm3', 'm2'])
  })

  it('修改批注：存在的改成功，不存在的返回 false', () => {
    const store = memoryStore()
    const created = addAnnotation(INPUT, store)

    expect(updateNote(created.id, '改好了', store)).toBe(true)
    expect(listAnnotations('conv-1', store)[0].note).toBe('改好了')
    expect(updateNote('no-such-id', 'x', store)).toBe(false)
  })

  it('删除单条与清空会话都只动自己的数据', () => {
    const store = memoryStore()
    const a = addAnnotation(INPUT, store)
    addAnnotation({ ...INPUT, conversationId: 'conv-2' }, store)

    removeAnnotation(a.id, store)
    expect(listAnnotations('conv-1', store)).toHaveLength(0)
    expect(listAnnotations('conv-2', store)).toHaveLength(1)

    clearAnnotations('conv-2', store)
    expect(listAnnotations('conv-2', store)).toHaveLength(0)
  })

  it('总量到达上限时丢最旧的，新批注一定落盘', () => {
    const store = memoryStore()
    for (let i = 0; i < 300; i += 1) {
      addAnnotation({ ...INPUT, messageId: `m${i}` }, store, i)
    }
    const newest = addAnnotation({ ...INPUT, messageId: 'm-new' }, store, 9999)

    const all = readAll(store)
    expect(all).toHaveLength(300)
    expect(all.some((item) => item.id === newest.id)).toBe(true)
    // 最旧的 m0 被挤出去了
    expect(all.some((item) => item.messageId === 'm0')).toBe(false)
  })

  it('存储坏了（抛错/内容不是 JSON/结构不对）都返回空，不碰主流程', () => {
    const broken = {
      getItem: () => {
        throw new Error('quota')
      },
      setItem: () => {
        throw new Error('quota')
      },
      removeItem: () => {},
    }
    expect(listAnnotations('conv-1', broken)).toEqual([])
    // 写失败也不抛
    expect(() => addAnnotation(INPUT, broken)).not.toThrow()

    const garbage = memoryStore({ [ANNOTATION_STORAGE_KEY]: 'not-json' })
    expect(readAll(garbage)).toEqual([])

    const wrongShape = memoryStore({
      [ANNOTATION_STORAGE_KEY]: JSON.stringify([null, 3, { id: 'a' }, 'x']),
    })
    expect(readAll(wrongShape)).toEqual([])
  })

  it('导出文本带序号、原文与批注，长原文截断', () => {
    const store = memoryStore()
    addAnnotation(INPUT, store, 1000)
    addAnnotation({ ...INPUT, messageId: 'm2', quote: '长'.repeat(120), note: '第二条' }, store, 2000)

    const text = annotationsToText(listAnnotations('conv-1', store))
    expect(text).toContain('1. 「凶手在 21:20 之前把死者怀表调快二十分钟」')
    expect(text).toContain('→ 这里补一个怀表谁调的伏笔')
    expect(text).toContain('2. 「')
    expect(text).toContain('…」')
    expect(text).toContain('第二条')
  })
})
