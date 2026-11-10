/**
 * DM 主持手册打印版式。
 *
 * 主持台是给屏幕用的（一次只看一个阶段、有计时器）；线下开本时 DM 真正需要的是
 * 一张能摊在桌上的纸：全阶段一目了然、线索能打勾、复盘念稿随手可读。
 * 所以这里不复用屏幕 DOM，而是按同一份数据重新排一份「纸质手册」到新窗口打印。
 *
 * 与 printPlan 同样的思路：不引 PDF 库，交给浏览器打印对话框「另存为 PDF」。
 */

import { PRINT_CSS } from './printPlan'
import type { ClueData, PlanEnding } from '../types'

export interface DMPhaseSheet {
  key: string
  label: string
  minutes: number
  brief: string
  clues: ClueData[]
}

export interface DMMeta {
  title?: string
  genre?: string
  players?: string
  difficulty?: string
  culprit?: string
  motive?: string
  hiddenEnding?: string
  endings?: PlanEnding[] | null
}

/** 手册专用样式：在方案稿版式上叠一层「主持手册」的表头、阶段块与勾选框。 */
const DM_CSS = `
${PRINT_CSS}
h1 { font-size: 17pt; margin-bottom: 2mm; }
.hand-title { text-align: center; margin: 0 0 1mm; font-size: 10pt; letter-spacing: 0.3em; color: #8a8177; }
.hand-meta { text-align: center; font-size: 9pt; color: #5c544b; margin: 0 0 6mm; }
.hand-sum { width: 100%; border-collapse: collapse; font-size: 9pt; margin: 0 0 7mm; }
.hand-sum th, .hand-sum td { border: 0.6pt solid #b9b0a4; padding: 1.2mm 2mm; }
.hand-sum th { background: #f2ece2; }
.hand-sum td.num { text-align: center; font-variant-numeric: tabular-nums; }
.phase { border-top: 1.2pt solid #8b2635; padding-top: 3mm; margin: 0 0 6mm; page-break-inside: avoid; }
.phase-head { display: flex; justify-content: space-between; align-items: baseline; margin: 0 0 2mm; }
.phase-head h2 { border: none; margin: 0; padding: 0; font-size: 13pt; }
.phase-min { font-size: 9pt; color: #6b6359; font-variant-numeric: tabular-nums; }
.phase-label { font-size: 8.5pt; letter-spacing: 0.16em; color: #8b2635; margin: 2.5mm 0 1mm; }
.phase-brief { margin: 0 0 2mm; }
.check { list-style: none; margin: 0; padding: 0; }
.check li { display: flex; gap: 2.5mm; align-items: flex-start; padding: 1.2mm 0; border-bottom: 0.4pt dashed #d8d0c4; }
.check .box { flex: none; width: 3.4mm; height: 3.4mm; border: 0.7pt solid #6b6359; margin-top: 0.8mm; }
.check .cid { flex: none; width: 12mm; font-weight: 700; }
.check .cname { flex: 1; }
.check .cpts { flex: none; color: #6b6359; font-size: 8.5pt; }
.truth { border: 1pt solid #8b2635; padding: 3mm 4mm; margin: 0 0 5mm; page-break-inside: avoid; }
.truth h2 { border: none; margin: 0 0 2mm; padding: 0; font-size: 13pt; }
.truth p { margin: 1.5mm 0; }
.truth table { margin-top: 2.5mm; }
.sig { margin-top: 8mm; font-size: 9pt; color: #5c544b; }
.sig span { display: inline-block; border-bottom: 0.6pt solid #9a9186; width: 40mm; height: 4mm; }
`

function esc(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** 线索的显示名：优先线索名，退化到内容首句，都没有就留空。 */
function clueName(clue: ClueData): string {
  if (clue.name) return clue.name
  const content = (clue.content || '').trim()
  if (!content) return ''
  const first = content.split(/[。；;\n]/)[0]
  return first.length > 60 ? `${first.slice(0, 60)}…` : first
}

/** 阶段一览：让 DM 开本前先看到整场的时间分配。 */
function summaryTable(phases: DMPhaseSheet[]): string {
  const total = phases.reduce((sum, phase) => sum + phase.minutes, 0)
  const rows = phases
    .map(
      (phase, index) => `<tr>
  <td class="num">${index + 1}</td>
  <td>${esc(phase.label)}</td>
  <td class="num">${phase.minutes} 分钟</td>
  <td class="num">${phase.clues.length ? `${phase.clues.length} 条` : '—'}</td>
</tr>`,
    )
    .join('\n')
  return `<table class="hand-sum">
<thead><tr><th>#</th><th>阶段</th><th>建议时长</th><th>需发放线索</th></tr></thead>
<tbody>
${rows}
<tr><td class="num"></td><td><strong>合计</strong></td><td class="num"><strong>${total} 分钟</strong></td><td class="num">—</td></tr>
</tbody></table>`
}

function phaseBlock(phase: DMPhaseSheet, index: number): string {
  const clues = phase.clues.length
    ? `<p class="phase-label">发放清单（${phase.clues.length} 条，发出后打勾）</p>
<ul class="check">
${phase.clues
  .map(
    (clue, clueIndex) => `<li>
  <span class="box"></span>
  <span class="cid">${esc(clue.id || `线索${clueIndex + 1}`)}</span>
  <span class="cname">${esc(clueName(clue))}</span>
  <span class="cpts">${clue.points_to ? `→ ${esc(clue.points_to)}` : ''}</span>
</li>`,
  )
  .join('\n')}
</ul>`
    : ''

  return `<section class="phase">
<div class="phase-head"><h2>${index + 1}. ${esc(phase.label)}</h2><span class="phase-min">${phase.minutes} 分钟</span></div>
<p class="phase-label">引导词</p>
<p class="phase-brief">${esc(phase.brief)}</p>
${clues}
</section>`
}

/** 复盘页：凶手、动机、真相、分支结局。没有内容就整块不出，避免打印一张空表。 */
function truthBlock(meta: DMMeta): string {
  const endings = meta.endings ?? []
  const hasBody = meta.culprit || meta.motive || meta.hiddenEnding || endings.length > 0
  if (!hasBody) return ''

  const rows = endings.length
    ? `<table>
<thead><tr><th>结局</th><th>触发条件</th><th>支撑线索</th><th>走向</th></tr></thead>
<tbody>
${endings
  .map(
    (ending, index) => `<tr>
  <td>${esc(ending.name || `结局 ${index + 1}`)}</td>
  <td>${esc(ending.condition || '')}</td>
  <td>${esc(String(ending.clues ?? ''))}</td>
  <td>${esc(ending.outcome || '')}</td>
</tr>`,
  )
  .join('\n')}
</tbody></table>`
    : ''

  return `<section class="truth">
<h2>复盘念稿</h2>
${meta.culprit ? `<p><strong>凶手：</strong>${esc(meta.culprit)}</p>` : ''}
${meta.motive ? `<p><strong>动机：</strong>${esc(meta.motive)}</p>` : ''}
${meta.hiddenEnding ? `<p><strong>隐藏真结局：</strong>${esc(meta.hiddenEnding)}</p>` : ''}
${endings.length ? `<p><strong>分支结局（${endings.length} 条）：</strong></p>` : ''}
${rows}
</section>`
}

/** 生成整本手册的 HTML（纯函数，测试直接断言它）。 */
export function dmSheetHtml(phases: DMPhaseSheet[], meta: DMMeta): string {
  const metaLine = [
    meta.genre && `题材：${meta.genre}`,
    meta.players && `人数：${meta.players}`,
    meta.difficulty && `难度：${meta.difficulty}`,
    phases.length && `阶段：${phases.length}`,
  ]
    .filter(Boolean)
    .map((item) => esc(String(item)))
    .join('　·　')

  const title = meta.title || '未命名剧本'

  return `<div class="doc">
<p class="hand-title">DM 主持手册</p>
<h1>《${esc(title)}》</h1>
<p class="hand-meta">${metaLine || '诡计设计师 · 生成的开本手册'}</p>
${summaryTable(phases)}
${phases.map((phase, index) => phaseBlock(phase, index)).join('\n')}
${truthBlock(meta)}
<p class="sig">开本日期：<span></span>　　主持人：<span></span></p>
<div class="doc-foot">诡计设计师 · AI 生成的开本手册　|　仅供虚构剧本创作，现实不可复刻</div>
</div>`
}

/** 打印：新窗口渲染手册并唤起系统打印对话框（可另存为 PDF）。 */
export function printDM(
  phases: DMPhaseSheet[],
  meta: DMMeta,
  open: (url?: string, target?: string) => Window | null = (url, target) =>
    window.open(url, target),
): void {
  if (phases.length === 0) {
    throw new Error('还没有可打印的流程，先生成一份方案。')
  }

  const win = open('', '_blank')
  if (!win) {
    throw new Error('浏览器拦截了打印窗口，请允许弹出窗口后重试。')
  }

  win.document.write(`<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="utf-8"/>
<title>${esc(meta.title || '未命名剧本')} · DM 主持手册</title>
<style>${DM_CSS}</style>
</head><body>
<div class="toolbar"><button onclick="window.print()">打印 / 另存为 PDF</button></div>
${dmSheetHtml(phases, meta)}
</body></html>`)
  win.document.close()
  // 等布局就绪再唤起打印，避免打印出空白页
  win.addEventListener('load', () => {
    win.focus()
    win.print()
  })
}
