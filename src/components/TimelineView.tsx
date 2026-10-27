import { useMemo, useState } from 'react'
import { parsePlanFromMarkdown } from '../lib/parsePlan'
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

/** 证据链时间线：垂直时间轴，点击节点查看关联线索与破绽提示。 */
export default function TimelineView({ markdown, onClose }: Props) {
  const plan = useMemo(() => parsePlanFromMarkdown(markdown), [markdown])
  const [openIdx, setOpenIdx] = useState<number | null>(null)

  const clues: NormClue[] = [
    ...(plan.clues_public || []),
    ...(plan.clues_deep || []),
  ].map((c: ClueData) => ({
    id: c.id || '',
    name: c.name || c.content || '',
    content: c.content || '',
    pointsTo: c.points_to || '',
  }))

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

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-panel timeline-panel" onClick={(e) => e.stopPropagation()}>
        <header className="modal-head">
          <h2>🔗 证据链时间线</h2>
          <button className="icon-btn" onClick={onClose} aria-label="关闭时间线">✕</button>
        </header>
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
      </div>
    </div>
  )
}
