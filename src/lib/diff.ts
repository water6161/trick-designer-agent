/**
 * 方案版本对比。
 *
 * 版本历史原本只能「回退」，但用户真正的疑问是「这次改了什么、值不值得回退」。
 * 这里做两件事：
 *   1. 行级 LCS diff —— 给出逐行的新增/删除；
 *   2. 章节级汇总 —— 方案是分章节写的，用户关心的是「哪一章被动了」，而不是第 137 行。
 *
 * 纯函数，无 DOM 依赖，可单测。
 */

export type DiffType = 'same' | 'add' | 'del'

export interface DiffOp {
  type: DiffType
  text: string
  /** 在旧版本中的行号（1 起，add 行为 0） */
  left: number
  /** 在新版本中的行号（1 起，del 行为 0） */
  right: number
}

export interface DiffStats {
  added: number
  removed: number
  unchanged: number
  /** 发生变化的章节数 */
  sections: number
  /** 是否有任何差异 */
  changed: boolean
}

export interface SectionStat {
  title: string
  added: number
  removed: number
}

export interface DiffResult {
  ops: DiffOp[]
  stats: DiffStats
  sections: SectionStat[]
}

/** 章节标题行：二级标题（方案正文的章节层级） */
const SECTION_RE = /^##\s+(.+?)\s*$/
const NO_SECTION = '（开篇）'

/** 超过这个规模就不做精细 LCS：几百万格的矩阵会卡住主线程，且对阅读没有额外帮助 */
const MAX_CELLS = 4_000_000

function splitLines(text: string): string[] {
  // 统一换行，避免 Windows 稿子和 Mac 稿子被判定为「整篇都变了」
  return text.replace(/\r\n?/g, '\n').split('\n')
}

function lcsTable(a: string[], b: string[]): Uint32Array {
  const n = a.length
  const m = b.length
  const width = m + 1
  const dp = new Uint32Array((n + 1) * width)
  for (let i = n - 1; i >= 0; i -= 1) {
    const row = i * width
    const next = (i + 1) * width
    for (let j = m - 1; j >= 0; j -= 1) {
      dp[row + j] =
        a[i] === b[j]
          ? dp[next + j + 1] + 1
          : Math.max(dp[next + j], dp[row + j + 1])
    }
  }
  return dp
}

/** 规模过大时的退化策略：按行直接比对，不做最优对齐（仍能给出准确的增删行数） */
function naiveOps(a: string[], b: string[]): DiffOp[] {
  const ops: DiffOp[] = []
  const max = Math.max(a.length, b.length)
  for (let i = 0; i < max; i += 1) {
    const left = a[i]
    const right = b[i]
    if (left === right) {
      ops.push({ type: 'same', text: left ?? '', left: i + 1, right: i + 1 })
    } else {
      if (left !== undefined) ops.push({ type: 'del', text: left, left: i + 1, right: 0 })
      if (right !== undefined) ops.push({ type: 'add', text: right, left: 0, right: i + 1 })
    }
  }
  return ops
}

export function diffLines(before: string, after: string): DiffResult {
  const a = splitLines(before || '')
  const b = splitLines(after || '')

  if (a.length * b.length > MAX_CELLS) {
    const ops = naiveOps(a, b)
    return { ops, ...withStats(ops) }
  }

  const dp = lcsTable(a, b)
  const width = b.length + 1
  const ops: DiffOp[] = []
  let i = 0
  let j = 0

  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      ops.push({ type: 'same', text: a[i], left: i + 1, right: j + 1 })
      i += 1
      j += 1
      continue
    }
    // 谁的前缀更长就往谁那边走，保证回溯路径与 LCS 表一致
    if (dp[(i + 1) * width + j] >= dp[i * width + j + 1]) {
      ops.push({ type: 'del', text: a[i], left: i + 1, right: 0 })
      i += 1
    } else {
      ops.push({ type: 'add', text: b[j], left: 0, right: j + 1 })
      j += 1
    }
  }
  while (i < a.length) {
    ops.push({ type: 'del', text: a[i], left: i + 1, right: 0 })
    i += 1
  }
  while (j < b.length) {
    ops.push({ type: 'add', text: b[j], left: 0, right: j + 1 })
    j += 1
  }

  return { ops, ...withStats(ops) }
}

function withStats(ops: DiffOp[]): { stats: DiffStats; sections: SectionStat[] } {
  const sections = summarizeSections(ops)
  const stats = statsOf(ops)
  stats.sections = sections.length
  return { stats, sections }
}

function statsOf(ops: DiffOp[]): DiffStats {
  let added = 0
  let removed = 0
  let unchanged = 0
  for (const op of ops) {
    if (op.type === 'add') added += 1
    else if (op.type === 'del') removed += 1
    else unchanged += 1
  }
  return { added, removed, unchanged, sections: 0, changed: added > 0 || removed > 0 }
}

/**
 * 按章节汇总改动量。
 * 章节标题只在 `## ` 行出现；两侧标题不一致时，新标题优先（用户看的是「新版哪一章变了」）。
 */
export function summarizeSections(ops: DiffOp[]): SectionStat[] {
  const order: string[] = []
  const map = new Map<string, SectionStat>()
  let current = NO_SECTION

  const touch = (title: string): SectionStat => {
    let stat = map.get(title)
    if (!stat) {
      stat = { title, added: 0, removed: 0 }
      map.set(title, stat)
      order.push(title)
    }
    return stat
  }

  for (const op of ops) {
    const match = SECTION_RE.exec(op.text)
    if (op.type === 'same') {
      if (match) current = match[1]
      continue
    }
    if (op.type === 'add') {
      if (match) current = match[1]
      touch(current).added += 1
      continue
    }
    // 删除行：被删的若正是章节标题，整章都算在它自己名下更好读
    touch(match ? match[1] : current).removed += 1
  }

  const result: SectionStat[] = []
  for (const title of order) {
    const stat = map.get(title)
    if (stat && stat.added + stat.removed > 0) result.push(stat)
  }
  return result
}

export type FoldedOp = DiffOp | { type: 'gap'; count: number }

/** 折叠连续的相同行，只保留变化点前后各 context 行，避免整篇贴出来。 */
export function foldContext(ops: DiffOp[], context = 2): FoldedOp[] {
  const keep = new Set<number>()
  ops.forEach((op, index) => {
    if (op.type === 'same') return
    for (let k = Math.max(0, index - context); k <= Math.min(ops.length - 1, index + context); k += 1) {
      keep.add(k)
    }
  })

  const folded: FoldedOp[] = []
  let skipped = 0
  ops.forEach((op, index) => {
    if (keep.has(index)) {
      if (skipped > 0) {
        folded.push({ type: 'gap', count: skipped })
        skipped = 0
      }
      folded.push(op)
    } else {
      skipped += 1
    }
  })
  if (skipped > 0) folded.push({ type: 'gap', count: skipped })
  return folded
}

/** 一句话结论，给列表项和卡片标题用。 */
export function diffSummary(stats: DiffStats): string {
  if (!stats.changed) return '与当前版本完全一致'
  const parts: string[] = []
  if (stats.added > 0) parts.push(`新增 ${stats.added} 行`)
  if (stats.removed > 0) parts.push(`删除 ${stats.removed} 行`)
  if (stats.sections > 0) parts.push(`涉及 ${stats.sections} 个章节`)
  return parts.join('，')
}
