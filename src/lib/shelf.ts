/** 历史方案书架：localStorage 本地留存最近方案，刷新不丢稿。 */

export interface ShelfItem {
  id: string // 会话 id
  title: string
  markdown: string
  savedAt: number
}

const KEY = 'tda_shelf_v1'
const MAX = 12

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
  try {
    const rest = listShelf().filter((it) => it.id !== item.id)
    const next = [item, ...rest].slice(0, MAX)
    localStorage.setItem(KEY, JSON.stringify(next))
  } catch {
    // 存储已满或被禁用时静默放弃，不影响主流程
  }
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
