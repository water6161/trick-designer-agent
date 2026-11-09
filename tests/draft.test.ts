import { describe, expect, it, vi } from 'vitest'
import {
  clearDraft,
  DRAFT_MAX_LENGTH,
  DRAFT_STORAGE_KEY,
  readDraft,
  saveDraft,
} from '../src/lib/draft'

function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial))
  return {
    data,
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      data.set(key, value)
    },
    removeItem: (key: string) => {
      data.delete(key)
    },
  }
}

describe('草稿存取', () => {
  it('写入后能原样读回', () => {
    const store = memoryStorage()
    saveDraft('想写一个暴风雪山庄，六人本，双凶手', store)
    expect(readDraft(store)).toBe('想写一个暴风雪山庄，六人本，双凶手')
  })

  it('读不到时返回空串而不是 null', () => {
    expect(readDraft(memoryStorage())).toBe('')
  })

  it('空内容视为清空，不留一个空 key', () => {
    const store = memoryStorage()
    saveDraft('草稿', store)
    saveDraft('', store)
    expect(store.data.has(DRAFT_STORAGE_KEY)).toBe(false)
  })

  it('clearDraft 能显式清掉', () => {
    const store = memoryStorage()
    saveDraft('草稿', store)
    clearDraft(store)
    expect(readDraft(store)).toBe('')
  })

  it('超长内容按上限截断，避免撑爆 localStorage', () => {
    const store = memoryStorage()
    saveDraft('密'.repeat(DRAFT_MAX_LENGTH + 500), store)
    expect(readDraft(store).length).toBe(DRAFT_MAX_LENGTH)
  })

  it('读取时也做一次截断，兼容历史遗留的超长值', () => {
    const store = memoryStorage({ [DRAFT_STORAGE_KEY]: 'x'.repeat(DRAFT_MAX_LENGTH + 100) })
    expect(readDraft(store).length).toBe(DRAFT_MAX_LENGTH)
  })
})

describe('存储不可用时静默降级', () => {
  it('getItem 抛错时读空串', () => {
    const store = memoryStorage()
    store.getItem = () => {
      throw new Error('SecurityError')
    }
    expect(readDraft(store)).toBe('')
  })

  it('setItem 抛错（配额满/隐私模式）时不影响调用方', () => {
    const store = memoryStorage()
    store.setItem = () => {
      throw new Error('QuotaExceededError')
    }
    expect(() => saveDraft('草稿', store)).not.toThrow()
  })

  it('removeItem 抛错时也不抛出', () => {
    const store = memoryStorage()
    store.removeItem = () => {
      throw new Error('SecurityError')
    }
    expect(() => clearDraft(store)).not.toThrow()
  })
})

describe('真实 localStorage 行为', () => {
  it('在 node 环境没有 localStorage 时直接返回空串，不报错', () => {
    // 沙箱 node 环境无 window/localStorage，正好验证兜底分支
    expect(typeof localStorage).toBe('undefined')
    expect(readDraft()).toBe('')
    expect(() => saveDraft('x')).not.toThrow()
    expect(() => clearDraft()).not.toThrow()
  })
})

describe('与 UI 的约定', () => {
  it('key 固定，升版本时不会误读到旧格式', () => {
    expect(DRAFT_STORAGE_KEY).toBe('trick-designer-draft')
  })

  it('上限足够写清楚一段需求', () => {
    expect(DRAFT_MAX_LENGTH).toBeGreaterThan(1000)
  })
})

// 避免未使用告警：vitest 的 vi 在部分用例中未用到
void vi
