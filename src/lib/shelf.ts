/** 历史方案书架：localStorage 本地留存最近方案，刷新不丢稿。 */

export interface ShelfItem {
  id: string // 会话 id
  title: string
  markdown: string
  savedAt: number
}

const KEY = 'tda_shelf_v1'
/** 单份方案最多写入的字符数，避免一份超长稿占满整个配额。 */
const MAX_CHARS = 40000

export function listShelf(): ShelfItem[] {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return []
    const items = JSON.parse(raw) as ShelfItem[]
    return Array.isArray(items) ? items.filter((it) => it && it.id && it.markdown) : []
  } catch {
    return []
  }
}

export function saveToShelf(item: ShelfItem): void {
  const trimmed: ShelfItem = {
    ...item,
    markdown: item.markdown.length > MAX_CHARS ? item.markdown.slice(0, MAX_CHARS) : item.markdown,
  }
  const rest = listShelf().filter((it) => it.id !== trimmed.id)

  // 逐份淘汰旧稿重试：配额不足时不会整次写入失败
  for (let keep = rest.length; keep >= 0; keep -= 1) {
    const next = [trimmed, ...rest.slice(0, keep)]
    try {
      localStorage.setItem(KEY, JSON.stringify(next))
      return
    } catch {
      // 配额超限：继续减少保留份数
    }
  }
  // 实在写不进去就放弃缓存，不影响主流程
}

export function removeFromShelf(id: string): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(listShelf().filter((it) => it.id !== id)))
  } catch {
    // 同上
  }
}

/**
 * 批量合并书架（备份恢复用）：按会话 id 去重，savedAt 新者胜。
 * 返回新增/更新条数，让 UI 能报出「恢复了几份」。
 */
export function mergeShelf(items: ShelfItem[]): { added: number; updated: number } {
  const valid = items.filter((it) => it && typeof it.id === 'string' && typeof it.markdown === 'string')
  if (!valid.length) return { added: 0, updated: 0 }
  const current = new Map(listShelf().map((it) => [it.id, it]))
  let added = 0
  let updated = 0
  for (const item of valid) {
    const incoming: ShelfItem = {
      id: item.id,
      title: typeof item.title === 'string' ? item.title : '未命名方案',
      markdown: item.markdown.length > MAX_CHARS ? item.markdown.slice(0, MAX_CHARS) : item.markdown,
      savedAt: typeof item.savedAt === 'number' ? item.savedAt : 0,
    }
    const existing = current.get(item.id)
    if (!existing) {
      current.set(item.id, incoming)
      added += 1
    } else if ((incoming.savedAt || 0) > (existing.savedAt || 0)) {
      current.set(item.id, incoming)
      updated += 1
    }
  }
  try {
    localStorage.setItem(
      KEY,
      JSON.stringify([...current.values()].sort((a, b) => b.savedAt - a.savedAt)),
    )
  } catch {
    // 配额满：恢复失败静默，主流程不受影响
  }
  return { added, updated }
}

/** 从方案 Markdown 提取标题（# 开头第一行）。 */
export function planTitle(markdown: string, fallback = '未命名方案'): string {
  const m = markdown.match(/^#\s*[《“"]?([^《》\n#]{2,40})[》”"]?/m)
  return m ? m[1].trim() : fallback
}

export type ShelfSort = 'recent' | 'oldest' | 'title'

/**
 * 书架筛选与排序。
 *
 * 方案攒到十几份之后，靠滚动找是找不回来的——所以搜索同时匹配标题和正文
 * （用户记得的往往是「那个雪夜的案子」，而不是精确标题）。
 */
export function filterShelf(items: ShelfItem[], query: string, sort: ShelfSort = 'recent'): ShelfItem[] {
  const keyword = query.trim().toLowerCase()
  const matched = keyword
    ? items.filter(
        (item) =>
          item.title.toLowerCase().includes(keyword) || item.markdown.toLowerCase().includes(keyword),
      )
    : items.slice()

  if (sort === 'title') {
    return matched.sort((a, b) => a.title.localeCompare(b.title, 'zh-Hans-CN'))
  }
  if (sort === 'oldest') {
    return matched.sort((a, b) => a.savedAt - b.savedAt)
  }
  return matched.sort((a, b) => b.savedAt - a.savedAt)
}

/** 正文里第一个命中位置附近的片段，用于告诉用户「为什么这条被搜到」。 */
export function snippetAround(markdown: string, query: string, radius = 28): string {
  const keyword = query.trim().toLowerCase()
  if (!keyword) return ''
  const index = markdown.toLowerCase().indexOf(keyword)
  if (index === -1) return ''
  const start = Math.max(0, index - radius)
  const end = Math.min(markdown.length, index + keyword.length + radius)
  const text = markdown.slice(start, end).replace(/\s+/g, ' ').trim()
  return `${start > 0 ? '…' : ''}${text}${end < markdown.length ? '…' : ''}`
}
