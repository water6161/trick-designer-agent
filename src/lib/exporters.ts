import { Packer, Document, Paragraph, HeadingLevel, TextRun, AlignmentType, Table, TableRow, TableCell, WidthType, BorderStyle } from 'docx'
import type { ClueData, PlanData } from '../types'

export interface CoverMeta {
  title: string
  genre?: string
  players?: string
  difficulty?: string
  lockScore?: number | null
}

// ───────────────────────── 封面 SVG ─────────────────────────

function esc(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

export function coverSVG(meta: CoverMeta): string {
  const title = esc(meta.title).slice(0, 22)
  const rows: string[] = []
  const info: string[] = []
  if (meta.genre) info.push(`题材 ${esc(meta.genre)}`)
  if (meta.players) info.push(`人数 ${esc(meta.players)}`)
  if (meta.difficulty) info.push(`难度 ${esc(meta.difficulty)}`)
  if (info.length) rows.push(info.join('　·　'))
  if (typeof meta.lockScore === 'number') {
    rows.push(`公平性评分 ${meta.lockScore} / 100`)
  }
  const sub = rows.join('\n')
  return `<svg xmlns="http://www.w3.org/2000/svg" width="900" height="1200" viewBox="0 0 900 1200">
  <defs>
    <radialGradient id="bg" cx="50%" cy="30%" r="90%">
      <stop offset="0%" stop-color="#1d1a14"/>
      <stop offset="100%" stop-color="#0b0a08"/>
    </radialGradient>
    <linearGradient id="gold" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#d8b56a"/>
      <stop offset="100%" stop-color="#a8823d"/>
    </linearGradient>
  </defs>
  <rect width="900" height="1200" fill="url(#bg)"/>
  <rect x="42" y="42" width="816" height="1116" fill="none" stroke="url(#gold)" stroke-width="2" opacity="0.7"/>
  <rect x="54" y="54" width="792" height="1092" fill="none" stroke="#d8b56a" stroke-width="0.6" opacity="0.35"/>
  <text x="450" y="300" text-anchor="middle" font-family="Georgia, serif" font-size="26" letter-spacing="14" fill="#d8b56a" opacity="0.85">TRICK ARCHITECT</text>
  <text x="450" y="345" text-anchor="middle" font-family="serif" font-size="18" letter-spacing="8" fill="#8a7a58">诡 计 建 筑 师</text>
  <line x1="250" y1="400" x2="650" y2="400" stroke="#d8b56a" stroke-width="1" opacity="0.6"/>
  <text x="450" y="510" text-anchor="middle" font-family="'Noto Serif SC', 'Songti SC', serif" font-size="64" font-weight="700" fill="#efe6cf">${title}</text>
  <line x1="250" y1="580" x2="650" y2="580" stroke="#d8b56a" stroke-width="1" opacity="0.6"/>
  ${sub
    .split('\n')
    .map(
      (line, i) =>
        `<text x="450" y="${680 + i * 56}" text-anchor="middle" font-family="'Noto Serif SC', serif" font-size="30" fill="#bfae87">${line}</text>`,
    )
    .join('\n  ')}
  <text x="450" y="1085" text-anchor="middle" font-family="serif" font-size="20" letter-spacing="6" fill="#6f6545">仅供虚构剧本创作 · 诡计依赖虚构设定 · 现实不可复刻</text>
</svg>`
}

// ───────────────────────── 下载工具 ─────────────────────────

function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 4000)
}

export function downloadMarkdown(markdown: string, title: string): void {
  saveBlob(new Blob([markdown], { type: 'text/markdown;charset=utf-8' }), `${title}.md`)
}

export function downloadCoverPNG(meta: CoverMeta): void {
  const svg = coverSVG(meta)
  const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const image = new Image()
  image.onload = () => {
    const canvas = document.createElement('canvas')
    canvas.width = 900
    canvas.height = 1200
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.drawImage(image, 0, 0, 900, 1200)
    URL.revokeObjectURL(url)
    canvas.toBlob((png) => {
      if (png) saveBlob(png, `${meta.title}·封面.png`)
    }, 'image/png')
  }
  image.onerror = () => {
    // PNG 转换失败时兜底下载原始 SVG
    saveBlob(blob, `${meta.title}·封面.svg`)
    URL.revokeObjectURL(url)
  }
  image.src = url
}

// ───────────────────────── Word 导出 ─────────────────────────

const HEADING_LEVELS: Record<number, (typeof HeadingLevel)[keyof typeof HeadingLevel]> = {
  1: HeadingLevel.HEADING_1,
  2: HeadingLevel.HEADING_2,
  3: HeadingLevel.HEADING_3,
}

function inlineRuns(text: string): TextRun[] {
  // 处理 **加粗** 与 `代码`，其余原样输出
  const runs: TextRun[] = []
  const pattern = /(\*\*[^*]+\*\*|`[^`]+`)/g
  let last = 0
  let match: RegExpExecArray | null
  while ((match = pattern.exec(text)) !== null) {
    if (match.index > last) {
      runs.push(new TextRun({ text: text.slice(last, match.index), font: 'Noto Serif SC' }))
    }
    const token = match[0]
    if (token.startsWith('**')) {
      runs.push(new TextRun({ text: token.slice(2, -2), bold: true, font: 'Noto Serif SC' }))
    } else {
      runs.push(new TextRun({ text: token.slice(1, -1), font: 'Consolas' }))
    }
    last = match.index + token.length
  }
  if (last < text.length) {
    runs.push(new TextRun({ text: text.slice(last), font: 'Noto Serif SC' }))
  }
  if (runs.length === 0) runs.push(new TextRun({ text, font: 'Noto Serif SC' }))
  return runs
}

export async function downloadDocx(markdown: string, meta: CoverMeta): Promise<void> {
  const children: Paragraph[] = []

  children.push(
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 240 },
      children: [new TextRun({ text: meta.title, bold: true, size: 52, font: 'Noto Serif SC' })],
    }),
  )
  const metaLine = [
    meta.genre && `题材：${meta.genre}`,
    meta.players && `人数：${meta.players}`,
    meta.difficulty && `难度：${meta.difficulty}`,
    typeof meta.lockScore === 'number' && `公平性评分：${meta.lockScore}/100`,
  ]
    .filter(Boolean)
    .join('　·　')
  if (metaLine) {
    children.push(
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { after: 480 },
        children: [new TextRun({ text: metaLine, size: 22, color: '8a7a58', font: 'Noto Serif SC' })],
      }),
    )
  }

  const lines = markdown.split('\n')
  let inCode = false
  for (const rawLine of lines) {
    const line = rawLine.replace(/\s+$/, '')
    if (line.trim().startsWith('```')) {
      inCode = !inCode
      continue
    }
    if (inCode) {
      children.push(
        new Paragraph({
          children: [new TextRun({ text: line, font: 'Consolas', size: 20 })],
        }),
      )
      continue
    }
    if (!line.trim()) {
      children.push(new Paragraph({ text: '' }))
      continue
    }
    const heading = /^(#{1,3})\s+(.*)$/.exec(line)
    if (heading) {
      children.push(
        new Paragraph({
          heading: HEADING_LEVELS[heading[1].length],
          children: [new TextRun({ text: heading[2].replace(/\*\*/g, ''), bold: true, font: 'Noto Serif SC' })],
        }),
      )
      continue
    }
    if (/^\s*[-*]\s+/.test(line)) {
      children.push(
        new Paragraph({
          bullet: { level: 0 },
          children: inlineRuns(line.replace(/^\s*[-*]\s+/, '')),
        }),
      )
      continue
    }
    if (/^\s*\d+[.、)]\s+/.test(line)) {
      children.push(
        new Paragraph({
          children: inlineRuns(line),
          indent: { left: 360 },
        }),
      )
      continue
    }
    if (line.trim().startsWith('|')) {
      children.push(
        new Paragraph({
          children: inlineRuns(line.replace(/\|/g, '｜')),
          spacing: { after: 40 },
        }),
      )
      continue
    }
    if (/^>\s?/.test(line)) {
      children.push(
        new Paragraph({
          children: inlineRuns(line.replace(/^>\s?/, '')),
          indent: { left: 480 },
          spacing: { before: 80, after: 80 },
        }),
      )
      continue
    }
    children.push(new Paragraph({ children: inlineRuns(line) }))
  }

  children.push(
    new Paragraph({
      spacing: { before: 480 },
      alignment: AlignmentType.CENTER,
      children: [
        new TextRun({
          text: '本方案仅用于虚构剧本创作与娱乐，诡计依赖剧本内虚构设定，现实中不可复刻。',
          size: 20,
          italics: true,
          color: '8a7a58',
          font: 'Noto Serif SC',
        }),
      ],
    }),
  )

  const doc = new Document({
    sections: [{ properties: {}, children }],
  })
  const blob = await Packer.toBlob(doc)
  saveBlob(blob, `${meta.title}.docx`)
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}

// ───────────────────────── 玩家版过滤 ─────────────────────────

// 仅保留玩家可见章节；DM 专属章节按标题关键词剔除
const DM_ONLY_PATTERN = /(凶手|真凶|真相|答案|解析|诡计|手法|红鲱鱼|误导|DM|防杠|易卡壳|深入线索|审查|自查|复盘)/

export function playerMarkdown(markdown: string): string {
  const lines = markdown.split('\n')
  const out: string[] = []
  let dropping = false
  let dropLevel = 0
  for (const line of lines) {
    const heading = /^(#{1,3})\s+(.*)$/.exec(line)
    if (heading) {
      if (DM_ONLY_PATTERN.test(heading[2])) {
        dropping = true
        dropLevel = heading[1].length
        continue
      }
      if (dropping && heading[1].length <= dropLevel) {
        dropping = false
      }
    }
    if (!dropping) out.push(line)
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim()
}

export function downloadPlayerDocx(markdown: string, meta: CoverMeta): void {
  const filtered = playerMarkdown(markdown)
  if (!filtered) throw new Error('未能解析出玩家可见章节，请改用完整版导出。')
  return void downloadDocx(filtered, { ...meta, lockScore: null })
}

// ───────────────────────── 线索卡片 Word ─────────────────────────

const CARD_BORDER = { style: BorderStyle.SINGLE, size: 6, color: 'A8823D' }

function clueCard(clue: ClueData): Table {
  const rows: TableRow[] = []
  const head = [clue.id, clue.name].filter(Boolean).join('　')
  const push = (label: string, value?: string) => {
    if (value && value.trim()) {
      rows.push(
        new TableRow({
          children: [
            new TableCell({
              width: { size: 16, type: WidthType.PERCENTAGE },
              margins: { top: 80, bottom: 80, left: 120, right: 120 },
              children: [new Paragraph({ children: [new TextRun({ text: label, bold: true, size: 20, font: 'Noto Serif SC' })] })],
            }),
            new TableCell({
              width: { size: 84, type: WidthType.PERCENTAGE },
              margins: { top: 80, bottom: 80, left: 120, right: 120 },
              children: [new Paragraph({ children: [new TextRun({ text: value, size: 20, font: 'Noto Serif SC' })] })],
            }),
          ],
        }),
      )
    }
  }
  push('线索', head)
  push('内容', clue.content)
  push('获取方式', clue.access)
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: {
      top: CARD_BORDER,
      bottom: CARD_BORDER,
      left: CARD_BORDER,
      right: CARD_BORDER,
      insideHorizontal: { style: BorderStyle.SINGLE, size: 2, color: 'D8B56A' },
      insideVertical: { style: BorderStyle.SINGLE, size: 2, color: 'D8B56A' },
    },
    rows,
  })
}

export async function downloadClueCardsDocx(plan: PlanData | null | undefined, title: string): Promise<void> {
  const clues: ClueData[] = [...(plan?.clues_public || []), ...(plan?.clues_deep || [])]
  if (clues.length === 0) throw new Error('方案中没有线索数据，请生成完整方案后重试。')

  const children: (Paragraph | Table)[] = [
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 120 },
      children: [new TextRun({ text: `${title} · 线索卡`, bold: true, size: 44, font: 'Noto Serif SC' })],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 240 },
      children: [
        new TextRun({
          text: `共 ${clues.length} 张 · 前半为公开线索，后半为深入搜证线索 · 按虚线裁剪发放`,
          size: 18,
          color: '8A7A58',
          font: 'Noto Serif SC',
        }),
      ],
    }),
  ]

  clues.forEach((clue, index) => {
    children.push(clueCard(clue))
    children.push(
      new Paragraph({
        spacing: { before: index === clues.length - 1 ? 0 : 200, after: 200 },
        border: index === clues.length - 1 ? undefined : { bottom: { style: BorderStyle.DASHED, size: 4, color: 'BBBBBB', space: 8 } },
        children: [new TextRun({ text: '', size: 8 })],
      }),
    )
  })

  const doc = new Document({ sections: [{ properties: {}, children }] })
  const blob = await Packer.toBlob(doc)
  saveBlob(blob, `${title}·线索卡.docx`)
}
