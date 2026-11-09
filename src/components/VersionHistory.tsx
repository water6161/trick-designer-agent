import { useEffect, useState } from 'react'
import { listVersions, restoreVersion } from '../lib/api'
import type { PlanVersion } from '../types'

interface Props {
  conversationId: string
  onClose: () => void
  onRestored: (markdown: string, title: string) => void
}

function formatTime(value?: string | null): string {
  if (!value) return '未知时间'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '未知时间'
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getMonth() + 1}/${date.getDate()} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

/**
 * 方案版本历史：把 checkpointer 里已存的历史快照列出来，点一下回退。
 * 版本数据完全复用会话状态存储，不额外持久化。
 */
export default function VersionHistory({ conversationId, onClose, onRestored }: Props) {
  const [versions, setVersions] = useState<PlanVersion[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [busyId, setBusyId] = useState('')

  useEffect(() => {
    let alive = true
    setLoading(true)
    listVersions(conversationId)
      .then((items) => {
        if (alive) setVersions(items)
      })
      .catch((err: unknown) => {
        if (alive) setError(err instanceof Error ? err.message : '读取版本历史失败')
      })
      .finally(() => {
        if (alive) setLoading(false)
      })
    return () => {
      alive = false
    }
  }, [conversationId])

  const restore = async (version: PlanVersion) => {
    if (busyId) return
    setBusyId(version.checkpointId)
    setError('')
    try {
      const restored = await restoreVersion(conversationId, version.checkpointId)
      onRestored(restored.markdown, restored.title)
      onClose()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : '恢复版本失败')
    } finally {
      setBusyId('')
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-panel version-panel" onClick={(event) => event.stopPropagation()}>
        <header className="modal-head version-head">
          <div>
            <h2>版本历史</h2>
            <p className="version-sub">每次生成都会留下快照，回退后可以继续在此基础上修改</p>
          </div>
          <button className="icon-btn" aria-label="关闭版本历史" onClick={onClose}>
            ✕
          </button>
        </header>

        {loading && <p className="version-tip">正在读取版本…</p>}
        {error && <p className="version-error">{error}</p>}

        {!loading && !error && versions.length === 0 && (
          <p className="version-tip">还没有可回退的版本——生成一次完整方案后，这里会出现快照。</p>
        )}

        <ol className="version-list">
          {versions.map((version, index) => (
            <li key={version.checkpointId} className="version-item">
              <div className="version-index">v{versions.length - index}</div>
              <div className="version-body">
                <div className="version-title">
                  {version.title}
                  {version.hasPlaceholder && <span className="version-badge">含待补充</span>}
                </div>
                <div className="version-meta">
                  {formatTime(version.createdAt)} · {version.chars.toLocaleString()} 字
                  {version.next.length > 0 && <span> · 中断于 {version.next.join('/')}</span>}
                </div>
              </div>
              <button className="version-restore" disabled={!!busyId} onClick={() => void restore(version)}>
                {busyId === version.checkpointId ? '恢复中…' : '回退到此版'}
              </button>
            </li>
          ))}
        </ol>
      </div>
    </div>
  )
}
