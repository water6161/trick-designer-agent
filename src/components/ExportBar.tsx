import { useState } from 'react'
import { exportPlan } from '../lib/api'
import { copyText, downloadCoverPNG, downloadDocx, downloadMarkdown } from '../lib/exporters'

interface Props {
  conversationId: string
  hasPlan: boolean
  disabled: boolean
}

export default function ExportBar({ conversationId, hasPlan, disabled }: Props) {
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')

  const run = async (task: (markdown: string, meta: { title: string; lockScore: number | null }) => Promise<void> | void) => {
    if (busy || disabled) return
    setBusy(true)
    setMessage('')
    try {
      const plan = await exportPlan(conversationId)
      await task(plan.markdown, { title: plan.title, lockScore: plan.lockScore })
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

  return (
    <div className="export-bar">
      <span className="export-label">开本稿</span>
      {btn('复制全文', () => void run((markdown) => { void copyText(markdown) }), 'copy')}
      {btn('下载 .md', () => void run((markdown, meta) => downloadMarkdown(markdown, meta.title)), 'md')}
      {btn('下载 Word', () => void run((markdown, meta) => downloadDocx(markdown, meta)), 'docx')}
      {btn('下载封面', () => void run((_markdown, meta) => downloadCoverPNG(meta)), 'cover')}
      {busy && <span className="export-msg">正在导出…</span>}
      {!busy && message && <span className="export-msg">{message}</span>}
    </div>
  )
}
