import type { SessionItem } from '../types'

export type SessionGroup = '今天' | '昨天' | '最近七天' | '更早'

const GROUP_ORDER: SessionGroup[] = ['今天', '昨天', '最近七天', '更早']

/** 搜索会话标题。空关键词返回全部，且不修改入参（Sidebar 直接渲染结果）。 */
export function filterSessions(sessions: SessionItem[], query: string): SessionItem[] {
  const keyword = query.trim().toLowerCase()
  if (!keyword) return sessions.slice()
  return sessions.filter((session) => (session.title || '').toLowerCase().includes(keyword))
}

/**
 * 按更新时间分组。
 *
 * 会话列表按时间倒序排，但一排「3/1」「3/1」「2/28」的日期看不出远近——
 * 分组标题比反复读日期更快。now 显式传入，方便测试固定时间。
 */
export function groupSessions(
  sessions: SessionItem[],
  now: Date = new Date(),
): { group: SessionGroup; items: SessionItem[] }[] {
  const todayStart = startOfDay(now)
  const yesterdayStart = todayStart - 24 * 3600 * 1000
  const weekStart = todayStart - 6 * 24 * 3600 * 1000

  const buckets = new Map<SessionGroup, SessionItem[]>()
  for (const session of sessions) {
    const at = parseTime(session.updatedAt)
    let group: SessionGroup = '更早'
    if (at === 'missing') {
      // 没有时间戳的排在最前面：新建但还没落库的会话属于「此刻」
      group = '今天'
    } else if (at >= todayStart) {
      group = '今天'
    } else if (at >= yesterdayStart) {
      group = '昨天'
    } else if (at >= weekStart) {
      group = '最近七天'
    }
    const list = buckets.get(group)
    if (list) list.push(session)
    else buckets.set(group, [session])
  }

  const result: { group: SessionGroup; items: SessionItem[] }[] = []
  for (const group of GROUP_ORDER) {
    const items = buckets.get(group)
    if (items && items.length) result.push({ group, items })
  }
  return result
}

function startOfDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
}

/** 缺时间戳（'missing'）与时间戳非法（-Infinity）要区别对待：前者是刚建的会话，后者只能是坏数据。 */
function parseTime(value?: string | null): number | 'missing' {
  if (!value) return 'missing'
  const time = new Date(value).getTime()
  return Number.isNaN(time) ? -Infinity : time
}
