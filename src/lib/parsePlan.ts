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

  const culpritText = mdSubsection(md, '凶手')
  if (culpritText) {
    const nameMatch =
      culpritText.match(/凶手[：:]\s*([^\n，,（(。]{2,12})/) || md.match(/凶手[：:]\s*([^\n，,（(。]{2,12})/)
    plan.culprit = { character: nameMatch ? nameMatch[1].trim() : '', motive: culpritText.slice(0, 400) }
  }

  plan.characters = rowsToObjects(mdRows(mdTableAfter(md, '角色表'))).map((row) => ({
    name: pick(row, ['角色', '姓名', '名字']),
    identity: pick(row, ['身份']),
    secret: pick(row, ['秘密']),
    suspicion: pick(row, ['怀疑']),
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
    const blocks = [...sec11.matchAll(/^###\s*互动\s*(\d+)?[：:]?\s*([^\n]*)\n([\s\S]*?)(?=^###\s*互动|(?![\s\S]))/gm)]
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
  }

  return plan as unknown as PlanData
}
