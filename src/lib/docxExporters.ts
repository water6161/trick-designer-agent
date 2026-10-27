// docx 导出模块：体积较大，仅在用户点击导出时由 ExportBar 动态加载
import { Packer, Document, Paragraph, TextRun, AlignmentType, Table, TableRow, TableCell, WidthType, BorderStyle } from 'docx'
import { HeadingLevel } from 'docx'
import type { CoverMeta } from './exporters'
import type { ClueData, PlanData } from '../types'
import { saveBlob } from './exporters'
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

/** 扑克牌式线索卡：A4 每页 2×3 共 6 张，虚线为裁切线，打印裁开即用。 */
export async function downloadClueCardsDocx(plan: PlanData | null | undefined, title: string): Promise<void> {
  const clues: ClueData[] = [...(plan?.clues_public || []), ...(plan?.clues_deep || [])]
  if (clues.length === 0) throw new Error('方案中没有线索数据，请生成完整方案后重试。')

  const cut = { style: BorderStyle.DASHED, size: 4, color: 'BBBBBB' }
  const cellMargins = { top: 140, bottom: 140, left: 180, right: 180 }

  const cardCell = (clue: ClueData): TableCell => {
    const paras: Paragraph[] = []
    const head = [clue.id, clue.name].filter(Boolean).join('　')
    paras.push(
      new Paragraph({
        spacing: { after: 60 },
        children: [
          new TextRun({ text: head || '线索', bold: true, size: 26, color: '7E1416', font: 'Noto Serif SC' }),
        ],
        border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: 'A8823D', space: 4 } },
      }),
    )
    if (clue.content) {
      paras.push(
        new Paragraph({
          spacing: { after: 80, line: 300 },
          children: [new TextRun({ text: clue.content, size: 19, font: 'Noto Serif SC' })],
        }),
      )
    }
    if (clue.points_to) {
      paras.push(
        new Paragraph({
          spacing: { after: 40 },
          children: [
            new TextRun({ text: '指向　', bold: true, size: 16, color: 'A8823D', font: 'Noto Serif SC' }),
            new TextRun({ text: clue.points_to, size: 16, color: '555555', font: 'Noto Serif SC' }),
          ],
        }),
      )
    }
    if (clue.access) {
      paras.push(
        new Paragraph({
          children: [
            new TextRun({ text: '获取　', bold: true, size: 16, color: 'A8823D', font: 'Noto Serif SC' }),
            new TextRun({ text: clue.access, size: 16, color: '555555', font: 'Noto Serif SC' }),
          ],
        }),
      )
    }
    return new TableCell({
      margins: cellMargins,
      borders: { top: cut, bottom: cut, left: cut, right: cut },
      children: paras,
    })
  }

  const children: (Paragraph | Table)[] = [
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 80 },
      children: [new TextRun({ text: `${title} · 线索卡`, bold: true, size: 40, font: 'Noto Serif SC' })],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 200 },
      children: [
        new TextRun({
          text: `共 ${clues.length} 张 · 每页 6 张 · 沿虚线裁剪后按编号发放`,
          size: 18,
          color: '8A7A58',
          font: 'Noto Serif SC',
        }),
      ],
    }),
  ]

  for (let i = 0; i < clues.length; i += 6) {
    const batch = clues.slice(i, i + 6)
    while (batch.length < 6) batch.push({} as ClueData)
    for (let r = 0; r < 3; r++) {
      children.push(
        new Table({
          width: { size: 100, type: WidthType.PERCENTAGE },
          borders: {
            top: cut, bottom: r === 2 ? cut : { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
            left: cut, right: cut,
            insideHorizontal: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
            insideVertical: cut,
          },
          rows: [
            new TableRow({
              height: { value: 3050, rule: 'atLeast' } as never,
              children: [cardCell(batch[r * 2]), cardCell(batch[r * 2 + 1])],
            }),
          ],
        }),
      )
      if (r < 2) {
        children.push(new Paragraph({ spacing: { before: 0, after: 0 }, children: [new TextRun({ text: '', size: 2 })] }))
      }
    }
    children.push(new Paragraph({ spacing: { before: 120, after: 60 }, children: [new TextRun({ text: '✂ - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -', size: 12, color: 'BBBBBB', font: 'Noto Serif SC' })] }))
  }

  const doc = new Document({ sections: [{ properties: {}, children }] })
  const blob = await Packer.toBlob(doc)
  saveBlob(blob, `${title}·线索卡.docx`)
}
