import type { PlanRules, RuleCheck, TrickCondition } from '../types'

interface Props {
  rules: PlanRules
  /** 把查出的缺口回传给对话，让模型只重写受影响的那一段 */
  onFix?: () => void
}

const STATUS_ICON: Record<RuleCheck['status'], string> = { pass: '✓', partial: '!', fail: '✕' }

function coverageTone(value: number): string {
  if (value >= 0.99) return 'good'
  if (value >= 0.65) return 'mid'
  return 'bad'
}

function pct(value: number): string {
  return `${Math.round(value * 100)}%`
}

/**
 * 硬规则校验卡：与 QualityCard（模型自评）并列展示。
 *
 * 区别在于这里每一项都是确定性计算：规则命中就通过，没命中就不通过，
 * 没有「模型今天心情好给了 8 分」这种漂移。所以条目可以直接当 checklist 用。
 */
export default function RulesCard({ rules, onFix }: Props) {
  const fairness = rules.fairness
  const graph = rules.trickGraph
  const difficulty = rules.difficulty

  // 三个子报告都缺失（对比模式 / 抽取失败）时不上这张卡
  if (!fairness && !graph && !difficulty) return null

  const checks = fairness?.checks ?? []
  const problems = checks.filter((item) => item.status !== 'pass')
  const passed = checks.filter((item) => item.status === 'pass').length
  const conditions: TrickCondition[] = graph?.conditions ?? []
  const requiredConditions = conditions.filter((item) => !item.advisory)

  return (
    <div className="rules-card">
      <div className="rules-head">
        <span className="rules-title">🔍 硬规则校验</span>
        {fairness && (
          <span className={`rules-score ${fairness.ready ? 'ok' : fairness.passed ? 'mid' : 'bad'}`}>
            {fairness.score}/100 · {fairness.ready ? '可开本' : fairness.passed ? '待完善' : '有硬伤'}
          </span>
        )}
      </div>

      {checks.length > 0 && (
        <>
          <div className="rules-summary">
            {checks.length} 项规则 · {passed} 项通过 · {problems.length} 项待修
          </div>
          <ul className="rules-list">
            {problems.slice(0, 6).map((item) => (
              <li key={item.code} className={`rules-item ${item.status}`}>
                <span className="rules-icon">{STATUS_ICON[item.status]}</span>
                <span className="rules-label">{item.label}</span>
                <span className="rules-detail">{item.detail}</span>
              </li>
            ))}
          </ul>
          {problems.length === 0 && <p className="rules-allpass">全部规则通过，结构与公平性没有可自动检出的问题。</p>}
        </>
      )}

      {requiredConditions.length > 0 && graph && (
        <div className="rules-section">
          <div className="rules-section-head">
            <span>🧩 诡计成立条件 · {graph.category}</span>
            <span className={`rules-coverage ${coverageTone(graph.coverage)}`}>覆盖 {pct(graph.coverage)}</span>
          </div>
          <div className="rules-conditions">
            {requiredConditions.map((item) => (
              <span
                key={item.key}
                className={`rules-chip ${item.satisfied ? 'ok' : 'bad'}`}
                title={
                  item.satisfied
                    ? `由线索 ${item.matched.join('、') || '时间线'} 支撑`
                    : '没有任何玩家可见的线索支撑这个条件'
                }
              >
                {item.satisfied ? '✓' : '✕'} {item.label}
                {item.matched.length > 0 && <em>{item.matched.join(' ')}</em>}
              </span>
            ))}
          </div>
          {graph.gaps.length > 0 && (
            <>
              <ul className="rules-gaps">
                {graph.gaps.slice(0, 3).map((gap) => (
                  <li key={gap.key}>
                    <strong>{gap.label}</strong>：{gap.hint}
                  </li>
                ))}
              </ul>
              {onFix && (
                <button className="rules-fix" onClick={onFix}>
                  按缺口补写线索（只重写第二部分）
                </button>
              )}
            </>
          )}
        </div>
      )}

      {difficulty && (
        <div className="rules-section">
          <div className="rules-section-head">
            <span>⏳ 难度与时长</span>
            <span className="rules-tier">{difficulty.tier}</span>
          </div>
          <div className="rules-difficulty">
            <span>⏱ {difficulty.minutes.label}</span>
            {difficulty.players && <span>👥 {difficulty.players}</span>}
            <span>📈 复杂度 {difficulty.score}</span>
          </div>
          <p className="rules-note">{difficulty.tierNote}</p>
        </div>
      )}
    </div>
  )
}
