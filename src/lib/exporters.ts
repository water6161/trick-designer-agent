import { Packer, Document, Paragraph, HeadingLevel, TextRun, AlignmentType } from 'docx'

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
