/**
 * 打印排版：把方案 Markdown 渲染成 A4 分页文档，在新窗口唤起系统打印。
 *
 * 线下开本场景最实用的是「一键打印成册」——浏览器打印对话框里选「另存为 PDF」
 * 即可得到 PDF，无需额外引入 PDF 生成库（体积成本为 0）。
 */

/** 极简 Markdown → HTML：只处理方案里实际会出现的语法，避免引入整个渲染库。 */
function inline(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/`(.+?)`/g, '<code>$1</code>')
}

function mdToHtml(md: string): string {
  const lines = md.replace(/\r\n/g, '\n').split('\n')
  const out: string[] = []
  let i = 0
  let inList: 'ul' | 'ol' | null = null

  const closeList = () => {
    if (inList) {
      out.push(`</${inList}>`)
      inList = null
    }
  }

  while (i < lines.length) {
    const raw = lines[i]
    const line = raw.trim()

    // 空行
    if (!line) {
      closeList()
      i += 1
      continue
    }

    // 表格：当前行以 | 开头，且下一行是分隔行
    if (line.startsWith('|') && lines[i + 1] && /^\|[\s:|-]+\|?$/.test(lines[i + 1].trim())) {
      closeList()
      const cells = (row: string) =>
        row.replace(/^\||\|$/g, '').split('|').map((c) => c.trim())
      const head = cells(line)
      i += 2
      const body: string[][] = []
      while (i < lines.length && lines[i].trim().startsWith('|')) {
        body.push(cells(lines[i].trim()))
        i += 1
      }
      out.push('<table><thead><tr>' + head.map((h) => `<th>${inline(h)}</th>`).join('') + '</tr></thead><tbody>')
      for (const row of body) {
        out.push('<tr>' + row.map((c) => `<td>${inline(c)}</td>`).join('') + '</tr>')
      }
      out.push('</tbody></table>')
      continue
    }

    // 标题
    const h = line.match(/^(#{1,4})\s+(.+)$/)
    if (h) {
      closeList()
      const level = h[1].length
      out.push(`<h${level}>${inline(h[2])}</h${level}>`)
      i += 1
      continue
    }

    // 引用
    if (line.startsWith('>')) {
      closeList()
      out.push(`<blockquote>${inline(line.replace(/^>\s?/, ''))}</blockquote>`)
      i += 1
      continue
    }

    // 分隔线
    if (/^(-{3,}|\*{3,})$/.test(line)) {
      closeList()
      out.push('<hr/>')
      i += 1
      continue
    }

    // 有序 / 无序列表
    const ol = line.match(/^\d+[.、)]\s+(.+)$/)
    const ul = line.match(/^[-*+]\s+(.+)$/)
    if (ol || ul) {
      const want: 'ul' | 'ol' = ol ? 'ol' : 'ul'
      if (inList !== want) {
        closeList()
        out.push(`<${want}>`)
        inList = want
      }
      out.push(`<li>${inline((ol || ul)![1])}</li>`)
      i += 1
      continue
    }

    closeList()
    out.push(`<p>${inline(line)}</p>`)
    i += 1
  }
  closeList()
  return out.join('\n')
}

export const PRINT_CSS = `
@page { size: A4; margin: 18mm 16mm 16mm; }
* { box-sizing: border-box; }
body {
  margin: 0; color: #1d1b19; background: #fff;
  font-family: "Noto Serif SC", "Songti SC", "SimSun", serif;
  font-size: 10.5pt; line-height: 1.75;
}
.doc { max-width: 178mm; margin: 0 auto; }
h1 { font-size: 20pt; text-align: center; margin: 0 0 4mm; letter-spacing: 0.05em; }
h2 { font-size: 13pt; margin: 7mm 0 2.5mm; padding-bottom: 1.5mm; border-bottom: 1.2pt solid #8b2635; page-break-after: avoid; }
h3 { font-size: 11pt; margin: 4.5mm 0 1.5mm; page-break-after: avoid; }
h4 { font-size: 10.5pt; margin: 3mm 0 1mm; }
p { margin: 1.6mm 0; text-align: justify; }
blockquote { margin: 2.5mm 0; padding: 2mm 4mm; border-left: 3pt solid #c9a86a; background: #faf6ef; color: #4a423a; }
table { width: 100%; border-collapse: collapse; margin: 2.5mm 0; font-size: 9pt; page-break-inside: avoid; }
th, td { border: 0.6pt solid #b9b0a4; padding: 1.4mm 2mm; text-align: left; vertical-align: top; }
th { background: #f2ece2; font-weight: 700; }
ul, ol { margin: 1.5mm 0 2mm; padding-left: 6mm; }
li { margin: 0.8mm 0; }
hr { border: none; border-top: 0.6pt dashed #c4bbad; margin: 4mm 0; }
code { font-family: "Noto Sans Mono", monospace; font-size: 9pt; background: #f4f1ec; padding: 0 1mm; }
.doc-foot { margin-top: 8mm; padding-top: 3mm; border-top: 0.6pt solid #ccc; font-size: 8pt; color: #8a8177; text-align: center; }
@media print { .no-print { display: none !important; } }
.toolbar { position: sticky; top: 0; padding: 6mm; background: #f7f4ef; border-bottom: 1pt solid #ddd6c9; text-align: center; }
.toolbar button { font-size: 12pt; padding: 2mm 6mm; cursor: pointer; }
@media print { .toolbar { display: none; } }
`

export interface PrintMeta {
  title: string
  lockScore?: number | null
  genre?: string
  players?: string
  difficulty?: string
}

/** 供测试直接验证 Markdown → HTML 的渲染结果。 */
export function renderForTest(md: string): string {
  return mdToHtml(md)
}

/** 打开打印预览窗口；用户确认后由系统打印对话框输出（可另存为 PDF）。 */
export function printPlan(markdown: string, meta: PrintMeta): void {
  const win = window.open('', '_blank')
  if (!win) {
    throw new Error('浏览器拦截了打印窗口，请允许弹出窗口后重试。')
  }

  const metaLine = [
    meta.genre && `题材：${meta.genre}`,
    meta.players && `人数：${meta.players}`,
    meta.difficulty && `难度：${meta.difficulty}`,
    typeof meta.lockScore === 'number' && meta.lockScore > 0 && `公平性评分：${meta.lockScore}/100`,
  ]
    .filter(Boolean)
    .join(' · ')

  win.document.write(`<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="utf-8"/>
<title>${meta.title} · 开本稿</title>
<style>${PRINT_CSS}</style>
</head><body>
<div class="toolbar"><button onclick="window.print()">打印 / 另存为 PDF</button></div>
<div class="doc">
${mdToHtml(markdown)}
<div class="doc-foot">${metaLine || '诡计设计师 · AI 生成的开本稿'}　|　仅供虚构剧本创作，现实不可复刻</div>
</div>
</body></html>`)
  win.document.close()
  // 等字体与布局就绪再唤起打印，避免空白页
  win.addEventListener('load', () => {
    win.focus()
    win.print()
  })
}
