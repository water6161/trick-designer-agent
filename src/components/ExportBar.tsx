import { useEffect, useState } from 'react'
import { exportPlan } from '../lib/api'
import type { ExportPlan } from '../lib/api'
import { copyText, COVER_STYLES, downloadAICoverPNG, downloadCoverPNG, downloadMarkdown, type CoverStyle } from '../lib/exporters'
import { printPlan } from '../lib/printPlan'
import { aiCover, AI_COVER_MEDIA, getCoverMediaPref, type AICoverMedia, type AICoverStyle } from '../lib/api'

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

  const btn = (label: string, onClick: () => void, key: string) => (
    <button key={key} className="export-btn" onClick={onClick} disabled={busy || disabled}>
      {label}
    </button>
  )

  const runCover = async (task: (plan: ExportPlan) => Promise<string | void>) => {
    if (busy || disabled) return
    setBusy(true)
    setMessage('AI 封面约需 30~60 秒…')
    try {
      const plan = await exportPlan(conversationId)
      const mediaLabel = await task(plan)
      // 每次点都是新图，明确告诉用户还能继续点
      setMessage(mediaLabel ? `已生成 · ${mediaLabel} · 再点换一张` : '已生成 · 再点一次换一张')
    } catch (err) {
      setMessage(err instanceof Error ? err.message : '生成失败，请重试。')
    } finally {
      setBusy(false)
      setTimeout(() => setMessage(''), 6000)
    }
  }

  // 默认画风偏好：首屏「画风灵感」位设置；本组件在出方案后才挂载，挂载时读一次即可
  const [prefMedia] = useState(() => getCoverMediaPref())
  const [moreOpen, setMoreOpen] = useState(false)
  const [aiOpen, setAiOpen] = useState(false)

  /**
   * 生成 AI 封面。
   * media 传具体画种 → 指定画风；传 '' → 每次随机；
   * 不传 → 先看首屏「画风灵感」选过的默认偏好，没有再随机。
   */
  const genCover = async (media?: AICoverMedia | '') => {
    setAiOpen(false)
    const chosen: AICoverMedia | '' = media !== undefined ? media : prefMedia
    await runCover(async (plan) => {
      const style = AI_COVER_STYLES[aiIdx].key
      // 每次点都是新构图：nonce 变 → 后端 seed、画风、机位、光源、色调一起变
      const nonce = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
      const { image, mediaLabel } = await aiCover(conversationId, style, nonce, chosen)
      downloadAICoverPNG(image, {
        title: plan.title,
        genre: plan.brief?.genre,
        players: plan.brief?.players,
        difficulty: plan.brief?.difficulty,
        lockScore: plan.lockScore,
      })
      setAiIdx((i) => (i + 1) % AI_COVER_STYLES.length)
      return mediaLabel
    })
  }

  // 点击下拉外部时关闭
  useEffect(() => {
    if (!moreOpen && !aiOpen) return
    const onDoc = (e: MouseEvent) => {
      const target = e.target as HTMLElement
      if (moreOpen && !target.closest('.export-more')) setMoreOpen(false)
      if (aiOpen && !target.closest('.export-ai')) setAiOpen(false)
    }
    document.addEventListener('click', onDoc)
    return () => document.removeEventListener('click', onDoc)
  }, [moreOpen, aiOpen])

  // 注意：early return 必须放在所有 hooks 之后，否则 hasPlan 变化时 hooks 数量不一致会导致 React 崩溃（error #310）
  if (!hasPlan) return null

  return (
    <div className="export-bar">
      <span className="export-label">开本稿</span>
      {btn('复制全文', () => void run((plan) => { void copyText(plan.markdown) }), 'copy')}
      {btn('下载 Word', () => void run(async (plan) => { const d = await loadDocx(); await d.downloadDocx(plan.markdown, { title: plan.title, lockScore: plan.lockScore }) }), 'docx')}
      <div className="export-ai">
        <button
          className="export-btn export-ai-btn"
          onClick={() => setAiOpen((v) => !v)}
          disabled={busy || disabled}
          title="AI 封面：可用首屏选过的默认画风，也可指定或随机"
        >
          ✨ AI 封面 {aiOpen ? '▴' : '▾'}
        </button>
        {aiOpen && (
          <div className="export-menu export-ai-menu">
            {prefMedia && (
              <button
                className="export-menu-ai"
                onClick={() => void genCover()}
                title="首屏「画风灵感」里选过的画种"
              >
                ⭐ 默认：{AI_COVER_MEDIA.find((m) => m.key === prefMedia)?.label}
              </button>
            )}
            <button className="export-menu-ai" onClick={() => void genCover('')}>
              🎲 随机画风（每次不同）
            </button>
            <span className="export-menu-sep">指定画风</span>
            {AI_COVER_MEDIA.map((media) => (
              <button key={media.key} onClick={() => void genCover(media.key)}>
                {media.key === prefMedia ? `⭐ ${media.label}` : media.label}
              </button>
            ))}
          </div>
        )}
      </div>
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
              void run((plan) => printPlan(plan.markdown, {
                title: plan.title,
                lockScore: plan.lockScore,
                genre: plan.brief?.genre,
                players: plan.brief?.players,
                difficulty: plan.brief?.difficulty,
              }))
            }}>
              打印 / 存为 PDF
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
          </div>
        )}
      </div>
      {busy && <span className="export-msg">正在导出…</span>}
      {!busy && message && <span className="export-msg">{message}</span>}
    </div>
  )
}
