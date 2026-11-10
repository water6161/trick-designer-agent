/**
 * 全局快捷键：键位表 + 按键决策（纯函数）。
 *
 * 决策拆成 resolveShortcut 便于单测——App 里只负责执行动作，
 * 「什么键在什么状态下是什么意思」全部在这里，速查卡也直接吃这张表。
 */

export interface ShortcutDef {
  /** 展示用键位，如 "g d" */
  keys: string
  action: string
  description: string
}

export type ShortcutAction =
  | 'focus-input'
  | 'help'
  | 'dm'
  | 'player'
  | 'timeline'
  | 'none'

export const SHORTCUTS: ShortcutDef[] = [
  { keys: '/', action: 'focus-input', description: '聚焦输入框（任何地方按一下就能打字）' },
  { keys: 'g d', action: 'dm', description: '打开 DM 主持台' },
  { keys: 'g t', action: 'timeline', description: '打开证据链时间线' },
  { keys: 'g p', action: 'player', description: '打开玩家本（无剧透）' },
  { keys: '?', action: 'help', description: '打开快捷键速查卡' },
  { keys: 'Esc', action: 'help', description: '关闭当前弹层 / 停止生成' },
]

/** g 序列键的等待窗口：太长会误吃后续正常打字 */
export const CHORD_WINDOW_MS = 800

export interface ShortcutContext {
  key: string
  /** 焦点在输入框/下拉/可编辑元素里 */
  inField: boolean
  /** 按着 Ctrl/Meta/Alt——组合键留给浏览器，不抢 */
  modifier: boolean
  /** 处于 g 序列等待中（上一拍按了 g 且未超窗） */
  chord: boolean
  /** 当前会话已有方案：工具类键位需要 */
  hasPlan: boolean
}

/** 把一次按键翻译成动作；翻译不了返回 none（调用方不动）。 */
export function resolveShortcut(ctx: ShortcutContext): ShortcutAction {
  const { key, inField, modifier, chord, hasPlan } = ctx
  if (modifier) return 'none'
  if (key === '?') {
    return inField ? 'none' : 'help'
  }
  if (inField) return 'none'
  if (key === '/') return 'focus-input'
  if (key === 'g') return 'none' // 等下一拍
  if (chord) {
    if (!hasPlan) return 'none'
    if (key === 'd') return 'dm'
    if (key === 't') return 'timeline'
    if (key === 'p') return 'player'
  }
  return 'none'
}
