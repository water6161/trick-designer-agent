import { useState } from 'react'
import { exportPlan } from '../lib/api'
import type { ExportPlan } from '../lib/api'
import { copyText, COVER_STYLES, downloadAICoverPNG, downloadCoverPNG, downloadMarkdown, type CoverStyle } from '../lib/exporters'
/** docx 导出库体积较大，按需动态加载，避免拖慢首屏。 */
const loadDocx = () => import('../lib/docxExporters')
import { aiCover } from '../lib/api'

interface Props {
  conversationId: string
  hasPlan: boolean
  disabled: boolean
}

export default function ExportBar({ conversationId, hasPlan, disabled }: Props) {
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [coverIdx, setCoverIdx] = useState(0)

  const run = async (task: (plan: ExportPlan) => Promise<void> | void) => {
    if (busy || disabled) return
    setBusy(true)
    setMessage('')
    try {
      const plan = await exportPlan(conversationId)
      await task(plan)
      setMessage('完成')
    } catch (err) {
      setMessage(err instanceof Error ? err.message : '导出失败，请重试。')
    } finally {
      setBusy(false)
      setTimeout(() => setMessage(''), 4000)
    }
  }

  if (!hasPlan) return null

  const btn = (label: string, onClick: () => void, key: string) => (
    <button key={key} className="export-btn" onClick={onClick} disabled={busy || disabled}>
      {label}
    </button>
  )

  const runCover = async (task: (plan: ExportPlan) => Promise<void> | void) => {
    if (busy || disabled) return
    setBusy(true)
    setMessage('AI 封面约需 30~60 秒…')
    try {
      const plan = await exportPlan(conversationId)
      await task(plan)
      setMessage('完成')
    } catch (err) {
      setMessage(err instanceof Error ? err.message : '导出失败，请重试。')
    } finally {
      setBusy(false)
      setTimeout(() => setMessage(''), 6000)
    }
  }

  return (
    <div className="export-bar">
      <span className="export-label">开本稿</span>
      {btn('复制全文', () => void run((plan) => { void copyText(plan.markdown) }), 'copy')}
      {btn('下载 Word', () => void run(async (plan) => { const d = await loadDocx(); await d.downloadDocx(plan.markdown, { title: plan.title, lockScore: plan.lockScore }) }), 'docx')}
      {btn('玩家版 Word', () => void run(async (plan) => { const d = await loadDocx(); await d.downloadPlayerDocx(plan.markdown, { title: plan.title }) }), 'player')}
      {btn('线索卡 Word', () => void run(async (plan) => { const d = await loadDocx(); await d.downloadClueCardsDocx(plan.plan, plan.title) }), 'clues')}
      {btn('下载 .md', () => void run((plan) => downloadMarkdown(plan.markdown, plan.title)), 'md')}
      {btn(`封面·${COVER_STYLES[coverIdx].label}`, () => {
        const style: CoverStyle = COVER_STYLES[coverIdx].key
        const result = run((plan) => downloadCoverPNG({ title: plan.title, lockScore: plan.lockScore }, style))
        setCoverIdx((i) => (i + 1) % COVER_STYLES.length)
        return result
      }, 'cover')}
      {btn('✨ AI 封面', () => void runCover(async (plan) => {
        const { image } = await aiCover(conversationId)
        downloadAICoverPNG(image, {
          title: plan.title,
          genre: plan.brief?.genre,
          players: plan.brief?.players,
          difficulty: plan.brief?.difficulty,
          lockScore: plan.lockScore,
        })
      }), 'aicover')}
      {busy && <span className="export-msg">正在导出…</span>}
      {!busy && message && <span className="export-msg">{message}</span>}
    </div>
  )
}
