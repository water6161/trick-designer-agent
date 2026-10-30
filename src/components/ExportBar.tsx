import { useEffect, useState } from 'react'
import { exportPlan } from '../lib/api'
import type { ExportPlan } from '../lib/api'
import { copyText, COVER_STYLES, downloadAICoverPNG, downloadCoverPNG, downloadMarkdown, type CoverStyle } from '../lib/exporters'
import { aiCover, type AICoverStyle } from '../lib/api'

const AI_COVER_STYLES: { key: AICoverStyle; label: string }[] = [
  { key: 'character', label: '人物海报' },
  { key: 'group', label: '群像剪影' },
  { key: 'scene', label: '场景氛围' },
]
/** docx 导出库体积较大，按需动态加载，避免拖慢首屏。 */
const loadDocx = () => import('../lib/docxExporters')

interface Props {
  conversationId: string
  hasPlan: boolean
  disabled: boolean
}

export default function ExportBar({ conversationId, hasPlan, disabled }: Props) {
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [coverIdx, setCoverIdx] = useState(0)
  const [aiIdx, setAiIdx] = useState(0)

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

  const [moreOpen, setMoreOpen] = useState(false)

  // 点击下拉外部时关闭
  useEffect(() => {
    if (!moreOpen) return
    const onDoc = (e: MouseEvent) => {
      const target = e.target as HTMLElement
      if (!target.closest('.export-more')) setMoreOpen(false)
    }
    document.addEventListener('click', onDoc)
    return () => document.removeEventListener('click', onDoc)
  }, [moreOpen])

  return (
    <div className="export-bar">
      <span className="export-label">开本稿</span>
      {btn('复制全文', () => void run((plan) => { void copyText(plan.markdown) }), 'copy')}
      {btn('下载 Word', () => void run(async (plan) => { const d = await loadDocx(); await d.downloadDocx(plan.markdown, { title: plan.title, lockScore: plan.lockScore }) }), 'docx')}
      <div className="export-more">
        <button className="export-btn" onClick={() => setMoreOpen((v) => !v)} disabled={busy || disabled}>
          更多导出 {moreOpen ? '▴' : '▾'}
        </button>
        {moreOpen && (
          <div className="export-menu">
            <button onClick={() => { setMoreOpen(false); void run(async (plan) => { const d = await loadDocx(); await d.downloadPlayerDocx(plan.markdown, { title: plan.title }) }) }}>
              玩家版 Word
            </button>
            <button onClick={() => { setMoreOpen(false); void run(async (plan) => { const d = await loadDocx(); await d.downloadClueCardsDocx(plan.plan, plan.title) }) }}>
              线索卡 Word
            </button>
            <button onClick={() => { setMoreOpen(false); void run((plan) => downloadMarkdown(plan.markdown, plan.title)) }}>
              下载 .md
            </button>
            <button onClick={() => {
              setMoreOpen(false)
              const style: CoverStyle = COVER_STYLES[coverIdx].key
              const result = run((plan) => downloadCoverPNG({ title: plan.title, lockScore: plan.lockScore }, style))
              setCoverIdx((i) => (i + 1) % COVER_STYLES.length)
              void result
            }}>
              封面·{COVER_STYLES[coverIdx].label}
            </button>
            <button className="export-menu-ai" onClick={() => {
              setMoreOpen(false)
              void runCover(async (plan) => {
                const style = AI_COVER_STYLES[aiIdx].key
                const { image } = await aiCover(conversationId, style)
                downloadAICoverPNG(image, {
                  title: plan.title,
                  genre: plan.brief?.genre,
                  players: plan.brief?.players,
                  difficulty: plan.brief?.difficulty,
                  lockScore: plan.lockScore,
                })
                setAiIdx((i) => (i + 1) % AI_COVER_STYLES.length)
              })
            }}>
              ✨ AI 封面·{AI_COVER_STYLES[aiIdx].label}
            </button>
          </div>
        )}
      </div>
      {busy && <span className="export-msg">正在导出…</span>}
      {!busy && message && <span className="export-msg">{message}</span>}
    </div>
  )
}
