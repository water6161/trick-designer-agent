/**
 * 本地批注：读者在方案正文里划选一段文字，随手记一句「这里再改改」。
 *
 * 存 localStorage，按「会话 + 消息 + 原文片段」锚定——不依赖选中位置的精确偏移，
 * 因为流式重排与版本更新都会让偏移失效，而片段本身足够定位「说的是哪一句」。
 * 与 draft.ts 同样的原则：存储失败不碰主流程，批注丢了也不该让生成挂掉。
 */

export interface Annotation {
  id: string
  conversationId: string
  /** 批注挂在哪条消息下 */
  messageId: string
  /** 划选的原文片段（定位锚点） */
  quote: string
  /** 用户写的批注内容 */
  note: string
  createdAt: number
}

export interface AnnotationInput {
  conversationId: string
  messageId: string
  quote: string
  note: string
}

const KEY = 'trick-designer-annotations'
/** 总量上限：批注是短句，300 条足够用，超了丢最旧的（防止 localStorage 被顶满） */
const MAX_TOTAL = 300
const MAX_NOTE = 1000
/** 片段留头不留尾：定位靠「开头认得出」，不需要整段 */
const MAX_QUOTE = 240

type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

function storageOf(explicit?: StorageLike): StorageLike | null {
  if (explicit) return explicit
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    // 部分浏览器在隐私模式下访问 localStorage 直接抛错
    return null
  }
}

function clamp(text: string, max: number): string {
  return text.length > max ? text.slice(0, max) : text
}

export function readAll(storage?: StorageLike): Annotation[] {
  const store = storageOf(storage)
  if (!store) return []
  try {
    const raw = store.getItem(KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter(
      (item): item is Annotation =>
        !!item &&
        typeof item === 'object' &&
        typeof (item as Annotation).id === 'string' &&
        typeof (item as Annotation).conversationId === 'string' &&
        typeof (item as Annotation).messageId === 'string' &&
        typeof (item as Annotation).quote === 'string' &&
        typeof (item as Annotation).note === 'string',
    )
  } catch {
    return []
  }
}

function writeAll(items: Annotation[], storage?: StorageLike): void {
  const store = storageOf(storage)
  if (!store) return
  try {
    store.setItem(KEY, JSON.stringify(items))
  } catch {
    // 配额满或被禁用：批注是锦上添花，失败就算了
  }
}

export function listAnnotations(conversationId: string, storage?: StorageLike): Annotation[] {
  return readAll(storage)
    .filter((item) => item.conversationId === conversationId)
    .sort((a, b) => a.createdAt - b.createdAt)
}

let seq = 0

function makeId(now: number): string {
  seq += 1
  return `a${now.toString(36)}${seq.toString(36)}${Math.random().toString(36).slice(2, 6)}`
}

/**
 * 新增批注。同一条消息里对同一段原文重复加批注时视为修改：
 * 覆盖旧批注并保留原时间，避免同一个句子下面挂两条「再改改」。
 */
export function addAnnotation(
  input: AnnotationInput,
  storage?: StorageLike,
  now: number = Date.now(),
): Annotation {
  const fresh: Annotation = {
    id: makeId(now),
    conversationId: input.conversationId,
    messageId: input.messageId,
    quote: clamp(input.quote.trim(), MAX_QUOTE),
    note: clamp(input.note.trim(), MAX_NOTE),
    createdAt: now,
  }

  const rest = readAll(storage).filter(
    (item) =>
      !(
        item.conversationId === fresh.conversationId &&
        item.messageId === fresh.messageId &&
        item.quote === fresh.quote
      ),
  )
  // 超总量丢最旧的（刚加的这条不在 rest 里，不会被丢）
  const trimmed = rest.length >= MAX_TOTAL ? rest.slice(rest.length - MAX_TOTAL + 1) : rest
  const items = [...trimmed, fresh].sort((a, b) => a.createdAt - b.createdAt)
  writeAll(items, storage)
  return fresh
}

export function updateNote(id: string, note: string, storage?: StorageLike): boolean {
  const items = readAll(storage)
  const target = items.find((item) => item.id === id)
  if (!target) return false
  const next = items.map((item) => (item.id === id ? { ...item, note: clamp(note.trim(), MAX_NOTE) } : item))
  writeAll(next, storage)
  return true
}

export function removeAnnotation(id: string, storage?: StorageLike): void {
  writeAll(
    readAll(storage).filter((item) => item.id !== id),
    storage,
  )
}

export function clearAnnotations(conversationId: string, storage?: StorageLike): void {
  writeAll(
    readAll(storage).filter((item) => item.conversationId !== conversationId),
    storage,
  )
}

/**
 * 批量合并批注（备份恢复用）：按 id 去重，createdAt 新者胜。
 */
export function mergeAnnotations(items: Annotation[]): { added: number; updated: number } {
  const valid = items.filter(
    (item) =>
      !!item &&
      typeof item.id === 'string' &&
      typeof item.conversationId === 'string' &&
      typeof item.messageId === 'string' &&
      typeof item.quote === 'string' &&
      typeof item.note === 'string',
  )
  if (!valid.length) return { added: 0, updated: 0 }
  const current = new Map(readAll().map((item) => [item.id, item]))
  let added = 0
  let updated = 0
  for (const item of valid) {
    const existing = current.get(item.id)
    if (!existing) {
      current.set(item.id, item)
      added += 1
    } else if ((item.createdAt || 0) > (existing.createdAt || 0)) {
      current.set(item.id, item)
      updated += 1
    }
  }
  writeAll([...current.values()].sort((a, b) => a.createdAt - b.createdAt))
  return { added, updated }
}

/** 导出成带出处的纯文本：贴进备忘录、群里同步修改意见都直接能用。 */
export function annotationsToText(items: Annotation[]): string {
  return items
    .map((item, index) => {
      const quote = item.quote.length > 80 ? `${item.quote.slice(0, 80)}…` : item.quote
      return `${index + 1}. 「${quote}」\n   → ${item.note}`
    })
    .join('\n\n')
}

export const ANNOTATION_STORAGE_KEY = KEY
export const ANNOTATION_MAX_QUOTE = MAX_QUOTE
export const ANNOTATION_MAX_NOTE = MAX_NOTE
