import { describe, expect, it } from 'vitest'
import { filterSessions, groupSessions } from '../src/lib/sessionFilter'
import type { SessionItem } from '../src/types'

function session(id: string, title: string, updatedAt?: string | null): SessionItem {
  return { id, title, updatedAt }
}

const SESSIONS: SessionItem[] = [
  session('a', '雪落无声的第七夜', '2026-03-10T11:00:00'),
  session('b', '血色婚礼', '2026-03-09T11:00:00'),
  session('c', '灯塔守夜人', '2026-03-05T11:00:00'),
  session('d', 'Snow Night', '2026-01-01T11:00:00'),
]

describe('filterSessions', () => {
  it('空关键词返回全部', () => {
    expect(filterSessions(SESSIONS, '')).toHaveLength(4)
    expect(filterSessions(SESSIONS, '   ')).toHaveLength(4)
  })

  it('按标题命中', () => {
    const result = filterSessions(SESSIONS, '灯塔')
    expect(result.map((it) => it.id)).toEqual(['c'])
  })

  it('大小写不敏感', () => {
    expect(filterSessions(SESSIONS, 'snow').map((it) => it.id)).toEqual(['d'])
    expect(filterSessions(SESSIONS, 'SNOW').map((it) => it.id)).toEqual(['d'])
  })

  it('无命中返回空数组', () => {
    expect(filterSessions(SESSIONS, '不存在的标题')).toEqual([])
  })

  it('标题缺失时不会抛错（后端可能返回 null）', () => {
    const items = [{ id: 'x', title: '', updatedAt: null } as SessionItem]
    expect(filterSessions(items, '雪')).toEqual([])
  })

  it('不修改入参数组', () => {
    const before = SESSIONS.map((it) => it.id)
    filterSessions(SESSIONS, '灯塔')
    expect(SESSIONS.map((it) => it.id)).toEqual(before)
  })
})

describe('groupSessions', () => {
  // 固定「现在」为 2026-03-10 12:00 UTC，避免用例随真实日期漂移
  const NOW = new Date('2026-03-10T12:00:00')

  it('按今天/昨天/最近七天/更早分组', () => {
    const groups = groupSessions(SESSIONS, NOW)
    expect(groups.map((g) => g.group)).toEqual(['今天', '昨天', '最近七天', '更早'])
    expect(groups[0].items.map((it) => it.id)).toEqual(['a'])
    expect(groups[1].items.map((it) => it.id)).toEqual(['b'])
    expect(groups[2].items.map((it) => it.id)).toEqual(['c'])
    expect(groups[3].items.map((it) => it.id)).toEqual(['d'])
  })

  it('空分组不出现在结果里', () => {
    const groups = groupSessions([SESSIONS[0]], NOW)
    expect(groups).toHaveLength(1)
    expect(groups[0].group).toBe('今天')
  })

  it('没有时间戳的会话算今天（刚创建还没落库）', () => {
    const groups = groupSessions([session('fresh', '新剧本', null)], NOW)
    expect(groups[0].group).toBe('今天')
  })

  it('非法时间戳降级为更早而不是抛错', () => {
    const groups = groupSessions([session('bad', '坏时间', 'not-a-date')], NOW)
    expect(groups[0].group).toBe('更早')
  })

  it('刚好七整天前的会话算最近七天', () => {
    const groups = groupSessions([session('edge', '边界', '2026-03-04T01:00:00')], NOW)
    expect(groups[0].group).toBe('最近七天')
  })

  it('空列表返回空数组', () => {
    expect(groupSessions([], NOW)).toEqual([])
  })

  it('组内保持传入顺序，不重排', () => {
    const items = [
      session('1', 'A', '2026-03-10T10:00:00'),
      session('2', 'B', '2026-03-10T09:00:00'),
    ]
    expect(groupSessions(items, NOW)[0].items.map((it) => it.id)).toEqual(['1', '2'])
  })
})
