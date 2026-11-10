import type { PlanData } from '../types'

interface RowLike {
  [key: string]: string
}

function mdRows(text: string): string[][] {
  const rows: string[][] = []
  for (const raw of text.split('\n')) {
    const line = raw.trim()
    if (!line.startsWith('|')) continue
    const cells = line.replace(/^\||\|$/g, '').split('|').map((c) => c.trim())
    if (cells.length && cells.every((c) => /^:?-{2,}:?$/.test(c) || !c)) continue
    if (cells.some(Boolean)) rows.push(cells)
  }
  return rows
}

function mdSection(md: string, name: string): string {
  const match = md.match(new RegExp(`^##\\s*${name}[^\\n]*\\n([\\s\\S]*?)(?=^##\\s|(?![\\s\\S]))`, 'm'))
  return match ? match[1] : ''
}

function mdSubsection(md: string, name: string): string {
  const match = md.match(new RegExp(`^###\\s*${name}[^\\n]*\\n([\\s\\S]*?)(?=^##[#]?[^\\n]|(?![\\s\\S]))`, 'm'))
  return match ? match[1] : ''
}

function mdTableAfter(md: string, name: string): string {
  const text = mdSubsection(md, name)
  if (mdRows(text).length) return text
  const match = md.match(new RegExp(`${name}[^\\n]*\\n([\\s\\S]*?)(?=^##[#]?[^\\n]|(?![\\s\\S]))`, 'm'))
  return match ? match[1] : text
}

function rowsToObjects(rows: string[][]): RowLike[] {
  if (rows.length < 2) return []
  const header = rows[0].map((h) => h.replace(/\*/g, '').trim())
  return rows.slice(1).map((cells) => {
    const obj: RowLike = {}
    header.forEach((h, i) => {
      if (h) obj[h] = (cells[i] || '').trim()
    })
    return obj
  })
}

function pick(row: RowLike, keys: string[]): string {
  // 先做「完全相等」的精确匹配，再做「包含」的模糊匹配。
  // 否则 ['线索'] 会先命中最左边的「线索内容 / 线索名称」列，导致内容错列。
  for (const key of keys) {
    for (const name of Object.keys(row)) {
      if (name === key) return row[name]
    }
  }
  for (const key of keys) {
    for (const name of Object.keys(row)) {
      if (name.includes(key)) return row[name]
    }
  }
  return ''
}

/** 从流式 Markdown 正文解析沉浸模式所需的结构化数据（与后端解析逻辑一致）。 */
export function parsePlanFromMarkdown(md: string): PlanData {
  const plan: Record<string, unknown> = {}

  const title = md.match(/^#\s*[《“"]?([^《》\n]{2,40})[》”"]?/m)
  if (title) plan.title = title[1].trim()
  const tagline = [...md.matchAll(/^>\s*([^>\n]{6,60})$/gm)].map((m) => m[1]).find((s) => !s.includes('声明'))
  if (tagline) plan.tagline = tagline.trim()

  const body = mdSection(md, '二')
  if (body) {
    plan.background = body
      .split('\n')
      .filter((l) => l.trim() && !l.trim().startsWith('|'))
      .join('\n')
      .slice(0, 800)
    const victimText = plan.background as string
    const victim: Record<string, string> = {}
    for (const [pattern, key] of [
      [/死者[：:]\s*([^\n，,（(。]{2,12})/, 'name'],
      [/身份[：:]\s*([^\n]{2,30})/, 'identity'],
      [/死亡时间[：:]\s*([^\n]{2,20})/, 'death_time'],
      [/死因[：:]\s*([^\n]{2,60})/, 'cause'],
      [/现场[：:]\s*([^\n]{2,80})/, 'scene'],
      [/发现[：:]\s*([^\n]{2,60})/, 'found_by'],
    ] as [RegExp, string][]) {
      const m = victimText.match(pattern)
      if (m) victim[key] = m[1].trim()
    }
    if (Object.keys(victim).length) plan.victim = victim
  }

  // 凶手信息：优先在「凶手」小节里找，找不到则退回全文中第一个「凶手：」
  // （方案的实际章节名是「## 四、凶手与人物逻辑」，是二级标题而非三级，只查 subsection 会漏）
  const culpritSection = mdSubsection(md, '凶手') || mdSection(md, '四')
  const culpritText = culpritSection || md
  const nameMatch = culpritText.match(/凶手[：:]\s*([^\n，,（(。]{2,12})/)
  if (nameMatch) {
    // 动机单独提取「动机：」行——直接塞原文会把「凶手：xxx」前缀一起带出去，
    // DM 朗读真相时会念出「凶手：白棠 动机：……」这种稿中稿
    const motiveMatch = culpritText.match(/动机[：:]\s*([^\n]+)/)
    plan.culprit = {
      character: nameMatch[1].trim(),
      motive: motiveMatch
        ? motiveMatch[1].trim()
        : culpritText.replace(/\s*\n+\s*/g, ' ').slice(0, 200),
    }
  }

  plan.characters = rowsToObjects(mdRows(mdTableAfter(md, '角色表'))).map((row) => ({
    name: pick(row, ['角色', '姓名', '名字']),
    identity: pick(row, ['身份']),
    secret: pick(row, ['秘密']),
    suspicion: pick(row, ['怀疑']),
    look: pick(row, ['外形锚点', '外形', '视觉锚点']),
  }))

  for (const [key, sub] of [['clues_public', '公开线索'], ['clues_deep', '深入线索']] as const) {
    plan[key] = rowsToObjects(mdRows(mdTableAfter(md, sub))).map((row) => ({
      id: pick(row, ['编号']),
      name: pick(row, ['线索名称', '线索']) || pick(row, ['内容']),
      content: pick(row, ['线索内容', '内容']) || pick(row, ['线索']),
      points_to: pick(row, ['指向']),
      access: pick(row, ['获取', '方式']),
      why_fair: pick(row, ['公平']),
    }))
  }

  plan.timeline = rowsToObjects(mdRows(mdSection(md, '六'))).map((row) => ({
    time: pick(row, ['时间']),
    event: pick(row, ['事件']),
    witness: pick(row, ['验证', '证人']),
    visibility: (pick(row, ['公开或深入', '可见']) || '').includes('深入') ? '深入' : '公开',
  }))

  const score = md.match(/锁凶充分性评分[：:]\s*(\d{1,3})\s*\/\s*100/)
  if (score) plan.lock_score = Number(score[1])

  // 沉浸互动剧情（第十一节）：### 互动N：标题 + 场景 + 选项表
  const sec11 = mdSection(md, '十一')
  if (sec11) {
    const blocks = [...sec11.matchAll(/^###\s*互动\s*(\d+)?[：:]?\s*([^\n]*)\n([\s\S]*?)(?=^###\s|(?![\s\S]))/gm)]
    plan.interactions = blocks.map((m) => {
      const text = m[3]
      const sceneMatch = text.match(/场景[：:]?\s*([\s\S]*?)(?=\n(?:\s*\|)|$)/)
      return {
        title: (m[2] || `互动 ${m[1] || ''}`).trim().replace(/[：:]$/, ''),
        scene: (sceneMatch ? sceneMatch[1] : '').trim(),
        options: rowsToObjects(mdRows(text)).map((row) => ({
          text: pick(row, ['选项', '选择', '行动']),
          result: pick(row, ['结果', '描述']),
          type: pick(row, ['结局', '类型']) || '安全',
        })).filter((o) => o.text),
      }
    }).filter((node) => node.options.length >= 2)

    const hiddenMatch = sec11.match(
      /###\s*隐藏真结局[^\n]*\n([\s\S]*?)(?=^#{2,3}\s|(?![\s\S]))/,
    )
    if (hiddenMatch) {
      const text = hiddenMatch[1]
      const sceneM = text.match(/场景[：:]?\s*([\s\S]*?)(?=\n真结局|\n###|\n##|$)/)
      const endM = text.match(/真结局[：:]?\s*([\s\S]*?)(?=\n###|\n##|$)/)
      plan.hidden_ending = {
        scene: (sceneM ? sceneM[1] : '').trim(),
        ending: (endM ? endM[1] : text).trim(),
      }
    }
  }

  return plan as unknown as PlanData
}
