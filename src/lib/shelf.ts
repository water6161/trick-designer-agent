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

/** 从方案 Markdown 提取标题（# 开头第一行）。 */
export function planTitle(markdown: string, fallback = '未命名方案'): string {
  const m = markdown.match(/^#\s*[《“"]?([^《》\n#]{2,40})[》”"]?/m)
  return m ? m[1].trim() : fallback
}
