import { describe, expect, it, vi } from 'vitest'
import {
  applyBackup,
  backupFileName,
  BACKUP_VERSION,
  buildBackup,
  parseBackup,
  restoreSummary,
  type BackupFile,
} from '../src/lib/backup'
import { listShelf } from '../src/lib/shelf'
import { listAnnotations } from '../src/lib/annotations'

// backup 的合并走各存储模块引用的全局 localStorage，用内存仓库替换
const storeMap = new Map<string, string>()
vi.stubGlobal('localStorage', {
  getItem: (k: string) => storeMap.get(k) ?? null,
  setItem: (k: string, v: string) => void storeMap.set(k, v),
  removeItem: (k: string) => void storeMap.delete(k),
})
/** 测试里直接造盘面数据的helper（模拟其它版本写入的存量）。 */
const lsSet = (k: string, v: string) => storeMap.set(k, v)

const SHELF_ITEM = {
  id: 'conv-1',
  title: '雪落无声的第七夜',
  markdown: '# 《雪落无声的第七夜》\n\n正文',
  savedAt: 1000,
}

const ANNOTATION = {
  id: 'a1',
  conversationId: 'conv-1',
  messageId: 'm1',
  quote: '怀表快二十分钟',
  note: '伏笔再补一笔',
  createdAt: 1000,
}

function restoreOf(text: string): BackupFile {
  const parsed = parseBackup(text)
  if (!parsed.ok) throw new Error(parsed.error)
  return parsed.data
}

describe('备份导出', () => {
  it('结构完整：应用标识、版本、导出时间、草稿', () => {
    const file = buildBackup('未发送的草稿', new Date('2026-03-01T08:00:00Z'))
    expect(file.app).toBe('trick-designer')
    expect(file.version).toBe(BACKUP_VERSION)
    expect(file.exportedAt).toBe('2026-03-01T08:00:00.000Z')
    expect(file.draft).toBe('未发送的草稿')
    expect(file.shelf).toEqual([])
    expect(file.annotations).toEqual([])
  })

  it('导出能带出本机已有的书架与批注', () => {
    storeMap.clear()
    lsSet('tda_shelf_v1', JSON.stringify([SHELF_ITEM]))
    lsSet('trick-designer-annotations', JSON.stringify([ANNOTATION]))

    const file = buildBackup('')
    expect(file.shelf).toHaveLength(1)
    expect(file.annotations).toHaveLength(1)
  })

  it('文件名带日期', () => {
    expect(backupFileName(new Date('2026-03-01T08:00:00Z'))).toBe(
      'trick-designer-backup-20260301.json',
    )
  })
})

describe('备份解析', () => {
  it('合法文件通过并补齐缺省字段', () => {
    const parsed = parseBackup(
      JSON.stringify({ app: 'trick-designer', version: 1, shelf: [SHELF_ITEM] }),
    )
    expect(parsed.ok).toBe(true)
    if (parsed.ok) {
      expect(parsed.data.shelf).toHaveLength(1)
      expect(parsed.data.annotations).toEqual([])
      expect(parsed.data.draft).toBe('')
    }
  })

  it('不是 JSON 给人话错误', () => {
    expect(parseBackup('{{{')).toMatchObject({ ok: false, error: expect.stringContaining('JSON') })
  })

  it('别的应用的文件被拒之门外', () => {
    expect(parseBackup(JSON.stringify({ app: 'other-app', version: 1 }))).toMatchObject({
      ok: false,
    })
  })

  it('更高版本提示先升级', () => {
    expect(parseBackup(JSON.stringify({ app: 'trick-designer', version: 99 }))).toMatchObject({
      ok: false,
      error: expect.stringContaining('升级'),
    })
  })
})

describe('备份恢复（合并）', () => {
  it('真实往返：本机有数据 → 导出 → 清空 → 恢复回来', () => {
    storeMap.clear()
    lsSet('tda_shelf_v1', JSON.stringify([SHELF_ITEM]))
    lsSet('trick-designer-annotations', JSON.stringify([ANNOTATION]))

    const file = buildBackup('我的草稿')
    expect(file.shelf).toHaveLength(1)
    expect(file.annotations).toHaveLength(1)

    // 模拟换设备：清空后恢复
    storeMap.clear()
    const stats = applyBackup(restoreOf(JSON.stringify(file)))
    expect(stats).toMatchObject({ shelfAdded: 1, annotationsAdded: 1, draftRestored: true })
    expect(listShelf()[0].title).toBe('雪落无声的第七夜')
    expect(listAnnotations('conv-1')[0].note).toBe('伏笔再补一笔')
  })

  it('时间戳新者胜：恢复不会用旧稿盖掉本机新稿', () => {
    storeMap.clear()
    lsSet(
      'tda_shelf_v1',
      JSON.stringify([{ ...SHELF_ITEM, title: '本机的新版', savedAt: 5000 }]),
    )
    const stats = applyBackup(
      restoreOf(
        JSON.stringify({
          app: 'trick-designer',
          version: 1,
          shelf: [{ ...SHELF_ITEM, title: '备份里的旧版', savedAt: 1000 }],
        }),
      ),
    )
    expect(stats.shelfUpdated).toBe(0)
    expect(listShelf()[0].title).toBe('本机的新版')
  })

  it('草稿不为空时不覆盖本机正在写的内容', () => {
    storeMap.clear()
    lsSet('trick-designer-draft', '本机正在写')
    const stats = applyBackup(
      restoreOf(JSON.stringify({ app: 'trick-designer', version: 1, draft: '备份里的草稿' })),
    )
    expect(stats.draftRestored).toBe(false)
  })

  it('结构非法的条目被过滤，不抛错', () => {
    storeMap.clear()
    const stats = applyBackup(
      restoreOf(
        JSON.stringify({
          app: 'trick-designer',
          version: 1,
          shelf: [null, 3, { id: 'x' }],
          annotations: ['bad', null],
        }),
      ),
    )
    expect(stats.shelfAdded).toBe(0)
    expect(stats.annotationsAdded).toBe(0)
  })

  it('重复恢复同一份备份不产生重复数据', () => {
    storeMap.clear()
    const text = JSON.stringify({
      app: 'trick-designer',
      version: 1,
      shelf: [SHELF_ITEM],
      annotations: [ANNOTATION],
    })
    applyBackup(restoreOf(text))
    const second = applyBackup(restoreOf(text))
    expect(second).toMatchObject({ shelfAdded: 0, annotationsAdded: 0 })
    expect(listShelf()).toHaveLength(1)
    expect(listAnnotations('conv-1')).toHaveLength(1)
  })
})

describe('恢复结果文案', () => {
  it('有内容报清单，无内容给明确说法', () => {
    expect(
      restoreSummary({
        shelfAdded: 2,
        shelfUpdated: 1,
        annotationsAdded: 3,
        annotationsUpdated: 0,
        draftRestored: true,
      }),
    ).toBe('已恢复：新增 2 份方案，更新 1 份方案，新增 3 条批注，恢复输入框草稿')
    expect(
      restoreSummary({
        shelfAdded: 0,
        shelfUpdated: 0,
        annotationsAdded: 0,
        annotationsUpdated: 0,
        draftRestored: false,
      }),
    ).toBe('备份里没有需要恢复的新内容')
  })
})
