import { describe, expect, it } from 'vitest'
import {
  CHORD_WINDOW_MS,
  resolveShortcut,
  SHORTCUTS,
  type ShortcutContext,
} from '../src/lib/shortcuts'

const base: ShortcutContext = {
  key: 'x',
  inField: false,
  modifier: false,
  chord: false,
  hasPlan: true,
}

describe('resolveShortcut 按键决策', () => {
  it('/ 聚焦输入框', () => {
    expect(resolveShortcut({ ...base, key: '/' })).toBe('focus-input')
  })

  it('? 打开速查卡——无论是否处于 g 序列', () => {
    expect(resolveShortcut({ ...base, key: '?' })).toBe('help')
    expect(resolveShortcut({ ...base, key: '?', chord: true })).toBe('help')
  })

  it('g 是序列前缀，本身不触发动作', () => {
    expect(resolveShortcut({ ...base, key: 'g' })).toBe('none')
  })

  it('g 序列内：d/t/p 打开对应工具', () => {
    expect(resolveShortcut({ ...base, key: 'd', chord: true })).toBe('dm')
    expect(resolveShortcut({ ...base, key: 't', chord: true })).toBe('timeline')
    expect(resolveShortcut({ ...base, key: 'p', chord: true })).toBe('player')
  })

  it('裸按 d/t/p 不触发——防止普通打字误开弹层', () => {
    expect(resolveShortcut({ ...base, key: 'd' })).toBe('none')
    expect(resolveShortcut({ ...base, key: 't' })).toBe('none')
    expect(resolveShortcut({ ...base, key: 'p' })).toBe('none')
  })

  it('没有方案时 g 序列全部不动作（工具按钮本来也不在）', () => {
    expect(resolveShortcut({ ...base, key: 'd', chord: true, hasPlan: false })).toBe('none')
    expect(resolveShortcut({ ...base, key: 'p', chord: true, hasPlan: false })).toBe('none')
  })

  it('焦点在输入框里全部还给打字（中文输入常打半角 ?，不能抢）', () => {
    expect(resolveShortcut({ ...base, key: '/', inField: true })).toBe('none')
    expect(resolveShortcut({ ...base, key: 'd', inField: true, chord: true })).toBe('none')
    expect(resolveShortcut({ ...base, key: '?', inField: true })).toBe('none')
  })

  it('组合键（Ctrl/Meta/Alt）一律不抢', () => {
    expect(resolveShortcut({ ...base, key: '/', modifier: true })).toBe('none')
    expect(resolveShortcut({ ...base, key: '?', modifier: true })).toBe('none')
  })

  it('其他普通按键不打扰', () => {
    expect(resolveShortcut({ ...base, key: 'x' })).toBe('none')
    expect(resolveShortcut({ ...base, key: 'Enter' })).toBe('none')
  })
})

describe('键位表', () => {
  it('每个动作都有定义，动作与 resolveShortcut 的返回值对得上', () => {
    const actions = new Set(SHORTCUTS.map((s) => s.action))
    for (const action of ['focus-input', 'dm', 'player', 'timeline'] as const) {
      expect(actions.has(action)).toBe(true)
    }
  })

  it('键位描述不为空、无重复键位', () => {
    const keys = SHORTCUTS.map((s) => s.keys)
    expect(new Set(keys).size).toBe(keys.length)
    for (const s of SHORTCUTS) {
      expect(s.description.trim()).not.toBe('')
    }
  })

  it('g 序列窗口宽于 0.5s、短于 2s——太短按不到，太长误吃打字', () => {
    expect(CHORD_WINDOW_MS).toBeGreaterThanOrEqual(500)
    expect(CHORD_WINDOW_MS).toBeLessThanOrEqual(2000)
  })
})
