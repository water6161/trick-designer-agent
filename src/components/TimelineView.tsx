import { useEffect, useMemo, useState } from 'react'
import { parsePlanFromMarkdown } from '../lib/parsePlan'
import { buildFrames, REPLAY_STEP_MS } from '../lib/replay'
import type { ClueData } from '../types'

interface Props {
  markdown: string
  onClose: () => void
}

interface NormClue {
  id: string
  name: string
  content: string
  pointsTo: string
}

/** 抽取可用于匹配的关键词（时间、人名、地点等长度 >= 2 的词）。 */
function keywordsOf(text: string): string[] {
  return (text.match(/[0-2]?\d[:：][0-5]\d|\d{1,2}日|[\u4e00-\u9fa5]{2,4}/g) || [])
    .map((s) => s.trim())
    .filter(Boolean)
}

/** 证据链时间线：垂直时间轴，点击节点查看关联线索；「重演案件」按帧回放全案。 */
export default function TimelineView({ markdown, onClose }: Props) {
  const plan = useMemo(() => parsePlanFromMarkdown(markdown), [markdown])
  const [openIdx, setOpenIdx] = useState<number | null>(null)
  const [replaying, setReplaying] = useState(false)
  const [cursor, setCursor] = useState(0)
  const [auto, setAuto] = useState(true)

  const clues: NormClue[] = [
    ...(plan.clues_public || []),
    ...(plan.clues_deep || []),
  ].map((c: ClueData) => ({
    id: c.id || '',
    name: c.name || c.content || '',
    content: c.content || '',
    pointsTo: c.points_to || '',
  }))

  const frames = useMemo(
    () => buildFrames(plan.timeline, plan.culprit),
    [plan],
  )

  const relatedClues = (idx: number): NormClue[] => {
    const ev = plan.timeline?.[idx]
    if (!ev) return []
    const kws = new Set(keywordsOf(`${ev.time} ${ev.event} ${ev.witness || ''}`))
    kws.delete('凶手')
    const scored = clues
      .map((c) => {
        const hay = `${c.name} ${c.content} ${c.pointsTo}`
        const hits = [...kws].filter((k) => hay.includes(k))
        return { c, score: hits.length }
      })
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 4)
    return scored.map((x) => x.c)
  }

  // ── 回放 ──
  const startReplay = () => {
    setOpenIdx(null)
    setReplaying(true)
    setCursor(0)
    setAuto(true)
  }
  const stopReplay = () => setReplaying(false)

  const last = frames.length - 1
  useEffect(() => {
    if (!replaying || !auto || cursor >= last) return
    const timer = window.setTimeout(() => setCursor((c) => Math.min(c + 1, last)), REPLAY_STEP_MS)
    return () => window.clearTimeout(timer)
  }, [replaying, auto, cursor, last])

  const frame = frames[cursor]
  const currentEventIdx = replaying && frame?.kind === 'event' ? cursor : -1
  const related = currentEventIdx >= 0 ? relatedClues(currentEventIdx) : []

  return (
    <div
      className="modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="证据链时间线"
      onClick={onClose}
    >
      <div className="modal-panel timeline-panel" onClick={(e) => e.stopPropagation()}>
        <header className="modal-head">
          <h2>🔗 证据链时间线</h2>
          <div className="modal-head-actions">
            {!replaying && frames.length > 0 && (
              <button className="tl-replay-btn" onClick={startReplay} title="按时间轴逐帧重演全案，复盘讲案子用">
                ▶ 重演案件
              </button>
            )}
            <button className="icon-btn" onClick={onClose} aria-label="关闭时间线">✕</button>
          </div>
        </header>

        {replaying && frames.length > 0 ? (
          <div className="replay-root">
            {/* 进度点：点哪帧跳哪帧 */}
            <div className="replay-bar" role="group" aria-label="重演进度">
              {frames.map((f, i) => (
                <button
                  key={i}
                  className={`replay-dot ${i === cursor ? 'now' : ''} ${i < cursor ? 'seen' : ''} ${f.kind === 'truth' ? 'truth' : ''}`}
                  onClick={() => { setCursor(i); setAuto(false) }}
                  aria-label={f.kind === 'truth' ? '真相帧' : `第 ${i + 1} 帧：${f.event || ''}`}
                />
              ))}
            </div>

            {frame?.kind === 'event' ? (
              <div className="replay-frame" key={cursor}>
                <p className="replay-time">{frame.time || '时间未知'}</p>
                <p className="replay-event">{frame.event || '（事件内容缺失）'}</p>
                {frame.witness && (
                  <p className="replay-witness">验证 / 见证：{frame.witness}</p>
                )}
                {frame.deep && <span className="tl-badge badge-deep">深入 · 玩家当时没看到</span>}
                {related.length > 0 && (
                  <div className="replay-clues">
                    <p className="tl-rel-title">此刻能戳穿它的线索</p>
                    <ul className="tl-clues">
                      {related.map((c, i) => (
                        <li key={i}>
                          <span className="tl-clue-id">{c.id || '线索'}</span>
                          <div>
                            <strong>{c.name}</strong>
                            {c.pointsTo && <p className="tl-points">指向：{c.pointsTo}</p>}
                          </div>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            ) : frame ? (
              <div className="replay-frame replay-truth" key={cursor}>
                <p className="replay-truth-label">真相</p>
                <p className="replay-event">凶手是{frame.culprit}。</p>
                {frame.motive && <p className="replay-motive">{frame.motive}</p>}
              </div>
            ) : null}

            <div className="replay-controls">
              <button onClick={() => { setCursor((c) => Math.max(0, c - 1)); setAuto(false) }} disabled={cursor === 0}>
                ← 上一帧
              </button>
              <button
                className="replay-play"
                onClick={() => {
                  if (cursor >= last) setCursor(0)
                  setAuto((v) => !v)
                }}
              >
                {auto ? '⏸ 暂停' : cursor >= last ? '↺ 重播' : '▶ 播放'}
              </button>
              <button
                onClick={() => { setCursor((c) => Math.min(last, c + 1)); setAuto(false) }}
                disabled={cursor >= last}
              >
                下一帧 →
              </button>
              <button className="replay-exit" onClick={stopReplay}>退出重演</button>
            </div>
          </div>
        ) : (
          <>
            <p className="timeline-hint">点击事件节点，查看见证人与可能暴露它的线索。</p>
            {!(plan.timeline?.length) ? (
              <p className="shelf-empty">这份方案里没有解析出时间线（需要「六、时间线」章节的表格）。</p>
            ) : (
              <ol className="timeline">
                {(plan.timeline || []).map((ev, idx) => {
                  const open = openIdx === idx
                  const related = open ? relatedClues(idx) : []
                  const deep = (ev.visibility || '').includes('深入')
                  return (
                    <li key={idx} className={`tl-node ${open ? 'open' : ''} ${deep ? 'deep' : ''}`}>
                      <button className="tl-dot" onClick={() => setOpenIdx(open ? null : idx)}>
                        <span className="tl-time">{ev.time || '时间未知'}</span>
                        <span className="tl-event">{ev.event}</span>
                        <span className={`tl-badge ${deep ? 'badge-deep' : 'badge-public'}`}>
                          {deep ? '深入' : '公开'}
                        </span>
                      </button>
                      {open && (
                        <div className="tl-detail">
                          {ev.witness && (
                            <p className="tl-witness"><strong>验证 / 见证：</strong>{ev.witness}</p>
                          )}
                          <p className="tl-rel-title">可能暴露本事件的线索</p>
                          {related.length === 0 ? (
                            <p className="tl-none">暂未找到直接关联线索——这本身就是一个可利用的盲区。</p>
                          ) : (
                            <ul className="tl-clues">
                              {related.map((c, i) => (
                                <li key={i}>
                                  <span className="tl-clue-id">{c.id || '线索'}</span>
                                  <div>
                                    <strong>{c.name}</strong>
                                    {c.content && <p>{c.content}</p>}
                                    {c.pointsTo && <p className="tl-points">指向：{c.pointsTo}</p>}
                                  </div>
                                </li>
                              ))}
                            </ul>
                          )}
                        </div>
                      )}
                    </li>
                  )
                })}
              </ol>
            )}
          </>
        )}
      </div>
    </div>
  )
}
