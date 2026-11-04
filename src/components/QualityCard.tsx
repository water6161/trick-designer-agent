import type { QualityScore } from '../types'

interface Props {
  score: QualityScore
}

interface Dim {
  key: keyof QualityScore
  label: string
  hint: string
}

const DIMS: Dim[] = [
  { key: 'clue_fairness', label: '线索公平性', hint: '关键线索是否都能在第二轮前拿到' },
  { key: 'lock_closure', label: '锁凶闭环', hint: '证据链是否完整、三要素是否齐全' },
  { key: 'timeline_coherence', label: '时间线自洽', hint: '时间锚点是否可交叉验证' },
  { key: 'red_herring_quality', label: '红鲱鱼质量', hint: '误导线索是否都能被排除' },
]

/** 四维质量评分卡：方案生成后立即做的一次「可开本性体检」。 */
export default function QualityCard({ score }: Props) {
  const total = typeof score.total === 'number' ? score.total : 0
  const ready = Boolean(score.ready)
  const issues = Array.isArray(score.issues) ? score.issues.filter(Boolean) : []
  const hints = Array.isArray(score.fix_hints) ? score.fix_hints.filter(Boolean) : []

  return (
    <div className="quality-card">
      <div className="quality-head">
        <span className="quality-title">📋 质量体检</span>
        <span className={`quality-total ${ready ? 'ok' : 'warn'}`}>
          {total}/40 · {ready ? '可开本' : '建议修订'}
        </span>
      </div>

      <div className="quality-dims">
        {DIMS.map((dim) => {
          const value = typeof score[dim.key] === 'number' ? (score[dim.key] as number) : 0
          const pct = Math.max(0, Math.min(100, value * 10))
          return (
            <div className="quality-dim" key={String(dim.key)} title={dim.hint}>
              <span className="quality-dim-label">{dim.label}</span>
              <div className="quality-bar">
                <div
                  className={`quality-bar-fill ${value >= 8 ? 'good' : value >= 6 ? 'mid' : 'bad'}`}
                  style={{ width: `${pct}%` }}
                />
              </div>
              <span className="quality-dim-value">{value}</span>
            </div>
          )
        })}
      </div>

      {issues.length > 0 && (
        <ul className="quality-list">
          {issues.slice(0, 4).map((item, i) => (
            <li key={`i${i}`}>{item}</li>
          ))}
        </ul>
      )}

      {hints.length > 0 && (
        <div className="quality-hints">
          <span className="quality-hints-label">改进建议</span>
          <ul className="quality-list">
            {hints.slice(0, 3).map((item, i) => (
              <li key={`h${i}`}>{item}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
