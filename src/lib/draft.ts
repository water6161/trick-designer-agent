/**
 * 输入框草稿的本地暂存。
 *
 * 写需求常常要写一大段（题材、人数、想要的手法、忌讳），写到一半刷新页面或误关标签就白写了。
 * 这里做最小可用的事：唯一一份草稿、落 localStorage、越界或隐私模式失败都不影响主流程。
 */

const DRAFT_KEY = 'trick-designer-draft'
/** 和 Composer 的限制保持一致，超出的部分不落盘（避免 localStorage 被顶满） */
const MAX_LENGTH = 8000

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

export function readDraft(storage?: StorageLike): string {
  const store = storageOf(storage)
  if (!store) return ''
  try {
    const raw = store.getItem(DRAFT_KEY)
    if (!raw) return ''
    return raw.slice(0, MAX_LENGTH)
  } catch {
    return ''
  }
}

export function saveDraft(text: string, storage?: StorageLike): void {
  const store = storageOf(storage)
  if (!store) return
  try {
    if (!text) {
      store.removeItem(DRAFT_KEY)
      return
    }
    store.setItem(DRAFT_KEY, text.slice(0, MAX_LENGTH))
  } catch {
    // 配额满或被禁用：草稿是锦上添花，失败就算了
  }
}

export function clearDraft(storage?: StorageLike): void {
  const store = storageOf(storage)
  if (!store) return
  try {
    store.removeItem(DRAFT_KEY)
  } catch {
    // 同上
  }
}

export const DRAFT_STORAGE_KEY = DRAFT_KEY
export const DRAFT_MAX_LENGTH = MAX_LENGTH
