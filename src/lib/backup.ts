/**
 * 会话数据备份：书架 + 批注 + 草稿一键导出 JSON、导入恢复。
 *
 * 这些数据都只存 localStorage——换浏览器、清缓存就全没了。
 * 备份是「能存进去，也要带得走」的闭环：文件归用户自己保管，不经任何服务器。
 *
 * 合并策略：按 id 去重、时间戳新者胜——换设备恢复时不会用旧稿盖掉新稿。
 */

import { listShelf, mergeShelf, type ShelfItem } from './shelf'
import { readAll, mergeAnnotations, type Annotation } from './annotations'
import { saveDraft, readDraft } from './draft'

export interface BackupFile {
  app: 'trick-designer'
  version: 1
  exportedAt: string
  shelf: ShelfItem[]
  annotations: Annotation[]
  draft: string
}

export interface RestoreStats {
  shelfAdded: number
  shelfUpdated: number
  annotationsAdded: number
  annotationsUpdated: number
  draftRestored: boolean
}

export const BACKUP_VERSION = 1

/** 组一份备份文件（纯数据，写文件交给调用方）。 */
export function buildBackup(draft: string = readDraft(), now: Date = new Date()): BackupFile {
  return {
    app: 'trick-designer',
    version: BACKUP_VERSION,
    exportedAt: now.toISOString(),
    shelf: listShelf(),
    annotations: readAll(),
    draft,
  }
}

/** 备份文件名：按日期命名，用户存一堆也能认出。 */
export function backupFileName(now: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `trick-designer-backup-${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}.json`
}

/** 校验并解析备份文件；结构不对就给出人话错误，不吞掉半份数据。 */
export function parseBackup(text: string): { ok: true; data: BackupFile } | { ok: false; error: string } {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return { ok: false, error: '文件不是合法的 JSON，可能下载或传输时损坏了。' }
  }
  if (!raw || typeof raw !== 'object') {
    return { ok: false, error: '文件内容不是预期的备份结构。' }
  }
  const data = raw as Partial<BackupFile>
  if (data.app !== 'trick-designer') {
    return { ok: false, error: '这不是诡计设计师的备份文件。' }
  }
  if (typeof data.version !== 'number' || data.version > BACKUP_VERSION) {
    return { ok: false, error: '备份来自更新版本的应用，请先升级应用再恢复。' }
  }
  return {
    ok: true,
    data: {
      app: 'trick-designer',
      version: BACKUP_VERSION,
      exportedAt: typeof data.exportedAt === 'string' ? data.exportedAt : '',
      shelf: Array.isArray(data.shelf) ? data.shelf : [],
      annotations: Array.isArray(data.annotations) ? data.annotations : [],
      draft: typeof data.draft === 'string' ? data.draft : '',
    },
  }
}

/** 应用备份：按 id 合并、时间戳新者胜；草稿仅在本机为空时才恢复（不覆盖正在写的内容）。 */
export function applyBackup(data: BackupFile): RestoreStats {
  const shelf = mergeShelf(data.shelf)
  const annotations = mergeAnnotations(data.annotations)
  let draftRestored = false
  if (data.draft && !readDraft()) {
    saveDraft(data.draft)
    draftRestored = true
  }
  return {
    shelfAdded: shelf.added,
    shelfUpdated: shelf.updated,
    annotationsAdded: annotations.added,
    annotationsUpdated: annotations.updated,
    draftRestored,
  }
}

/** 把恢复结果说成人话。 */
export function restoreSummary(stats: RestoreStats): string {
  const parts: string[] = []
  if (stats.shelfAdded) parts.push(`新增 ${stats.shelfAdded} 份方案`)
  if (stats.shelfUpdated) parts.push(`更新 ${stats.shelfUpdated} 份方案`)
  if (stats.annotationsAdded) parts.push(`新增 ${stats.annotationsAdded} 条批注`)
  if (stats.annotationsUpdated) parts.push(`更新 ${stats.annotationsUpdated} 条批注`)
  if (stats.draftRestored) parts.push('恢复输入框草稿')
  return parts.length ? `已恢复：${parts.join('，')}` : '备份里没有需要恢复的新内容'
}
