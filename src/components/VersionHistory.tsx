import { useEffect, useMemo, useState } from 'react'
import { getVersionContent, listVersions, restoreVersion } from '../lib/api'
import { diffLines, diffSummary, foldContext, type DiffResult } from '../lib/diff'
import type { PlanVersion } from '../types'

interface Props {
  conversationId: string
  /** 当前正文，用于和选中的历史版本对比 */
  currentMarkdown?: string
  onClose: () => void
  onRestored: (markdown: string, title: string) => void
}

interface Comparison {
  versionLabel: string
  title: string
  createdAt?: string | null
  result: DiffResult
}

function formatTime(value?: string | null): string {
  if (!value) return '未知时间'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '未知时间'
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getMonth() + 1}/${date.getDate()} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

/**
 * 方案版本历史：把 checkpointer 里已存的历史快照列出来。
 *
 * 两件事：**回退**（写回状态）和**对比**（只读，不产生副作用）。
 * 用户真正的疑问往往是「这一版和现在差在哪」，只给回退按钮等于逼他盲选。
 */
export default function VersionHistory({ conversationId, currentMarkdown, onClose, onRestored }: Props) {
  const [versions, setVersions] = useState<PlanVersion[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [busyId, setBusyId] = useState('')
  const [comparison, setComparison] = useState<Comparison | null>(null)

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

  const compare = async (version: PlanVersion, label: string) => {
    if (busyId) return
    setBusyId(version.checkpointId)
    setError('')
    try {
      const content = await getVersionContent(conversationId, version.checkpointId)
      setComparison({
        versionLabel: label,
        title: content.title,
        createdAt: version.createdAt,
        result: diffLines(content.markdown, currentMarkdown || ''),
      })
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : '读取版本内容失败')
    } finally {
      setBusyId('')
    }
  }

  const folded = useMemo(
    () => (comparison ? foldContext(comparison.result.ops, 2) : []),
    [comparison],
  )

  return (
    <div
      className="modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="版本历史"
      onClick={onClose}
    >
      <div className="modal-panel version-panel" onClick={(event) => event.stopPropagation()}>
        <header className="modal-head version-head">
          <div>
            <h2>{comparison ? '版本对比' : '版本历史'}</h2>
            <p className="version-sub">
              {comparison
                ? `${comparison.versionLabel} → 当前版本，逐行差异（灰底为未改动部分已折叠）`
                : '每次生成都会留下快照；可以对比差异后再决定回退'}
            </p>
          </div>
          <button className="icon-btn" aria-label="关闭版本历史" onClick={onClose}>
            ✕
          </button>
        </header>

        {comparison ? (
          <>
            <div className="diff-summary-row">
              <button className="diff-back" onClick={() => setComparison(null)}>
                ← 返回版本列表
              </button>
              <span className="diff-summary">{diffSummary(comparison.result.stats)}</span>
            </div>

            {comparison.result.sections.length > 0 && (
              <ul className="diff-sections" aria-label="按章节汇总">
                {comparison.result.sections.map((section) => (
                  <li key={section.title}>
                    <span className="diff-section-name">{section.title}</span>
                    {section.added > 0 && <span className="diff-count add">+{section.added}</span>}
                    {section.removed > 0 && <span className="diff-count del">−{section.removed}</span>}
                  </li>
                ))}
              </ul>
            )}

            <div className="diff-body" role="region" aria-label="逐行差异">
              {!comparison.result.stats.changed && (
                <p className="version-tip">这一版和当前正文完全一致，没有可对比的改动。</p>
              )}
              {folded.map((item, index) =>
                item.type === 'gap' ? (
                  <div key={`gap-${index}`} className="diff-gap">
                    ⋯ 省略 {item.count} 行未改动内容
                  </div>
                ) : (
                  <div key={`line-${index}`} className={`diff-line ${item.type}`}>
                    <span className="diff-sign">
                      {item.type === 'add' ? '+' : item.type === 'del' ? '−' : ' '}
                    </span>
                    <span className="diff-text">{item.text || '\u00a0'}</span>
                  </div>
                ),
              )}
            </div>
          </>
        ) : (
          <>
            {loading && <p className="version-tip">正在读取版本…</p>}
            {error && <p className="version-error">{error}</p>}

            {!loading && !error && versions.length === 0 && (
              <p className="version-tip">还没有可回退的版本——生成一次完整方案后，这里会出现快照。</p>
            )}

            <ol className="version-list">
              {versions.map((version, index) => {
                const label = `v${versions.length - index}`
                return (
                  <li key={version.checkpointId} className="version-item">
                    <div className="version-index">{label}</div>
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
                    <div className="version-actions">
                      <button
                        className="version-compare"
                        disabled={!!busyId}
                        onClick={() => void compare(version, label)}
                      >
                        {busyId === version.checkpointId ? '读取中…' : '看差异'}
                      </button>
                      <button
                        className="version-restore"
                        disabled={!!busyId}
                        onClick={() => void restore(version)}
                      >
                        回退到此版
                      </button>
                    </div>
                  </li>
                )
              })}
            </ol>
          </>
        )}
      </div>
    </div>
  )
}
