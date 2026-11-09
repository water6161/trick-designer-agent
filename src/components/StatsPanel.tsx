import { useCallback, useEffect, useState } from 'react'
import { getStats } from '../lib/api'
import type { StatsSnapshot } from '../types'

interface Props {
  conversationId: string
  onClose: () => void
}

function ms(value: number): string {
  if (!value) return '—'
  return value >= 1000 ? `${(value / 1000).toFixed(1)}s` : `${value}ms`
}

function int(value: number): string {
  return value.toLocaleString('zh-CN')
}

/**
 * 运行指标面板：把后端进程内的 trace 聚合摆出来。
 *
 * 存在的意义不是「好看」，而是回答三个具体问题：
 * 1. 现在快不快 —— P50 / P95 / 首字延迟；
 * 2. 慢在哪一步 —— 各阶段平均耗时排序；
 * 3. 失败长什么样 —— 错误信息聚合，改完能对比。
 */
export default function StatsPanel({ conversationId, onClose }: Props) {
  const [data, setData] = useState<StatsSnapshot | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      setData(await getStats(conversationId))
    } catch (err) {
      setError(err instanceof Error ? err.message : '读取运行指标失败。')
    } finally {
      setLoading(false)
    }
  }, [conversationId])

  useEffect(() => {
    void load()
  }, [load])

  const maxStage = data?.stages?.length ? Math.max(...data.stages.map((item) => item.avgMs), 1) : 1

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-panel stats-panel" onClick={(event) => event.stopPropagation()}>
        <header className="modal-head">
          <h2>📊 运行指标</h2>
          <div className="stats-head-actions">
            <button className="icon-btn" onClick={() => void load()} aria-label="刷新指标">↻</button>
            <button className="icon-btn" onClick={onClose} aria-label="关闭指标面板">✕</button>
          </div>
        </header>

        {loading && <p className="stats-empty">正在读取…</p>}
        {error && <p className="stats-empty">{error}</p>}

        {data && !loading && data.total === 0 && (
          <p className="stats-empty">
            还没有请求记录。生成一次方案后再回来看，这里会显示耗时分布与失败原因。
          </p>
        )}

        {data && !loading && data.total > 0 && (
          <>
            <div className="stats-grid">
              <div className="stats-cell">
                <span className="stats-value">{data.total}</span>
                <span className="stats-label">样本数</span>
              </div>
              <div className="stats-cell">
                <span className={`stats-value ${data.successRate === 1 ? 'ok' : 'mid'}`}>
                  {data.successRate === null ? '—' : `${Math.round(data.successRate * 100)}%`}
                </span>
                <span className="stats-label">成功率</span>
              </div>
              <div className="stats-cell">
                <span className="stats-value">{ms(data.latency.p50)}</span>
                <span className="stats-label">P50 耗时</span>
              </div>
              <div className="stats-cell">
                <span className="stats-value">{ms(data.latency.p95)}</span>
                <span className="stats-label">P95 耗时</span>
              </div>
              <div className="stats-cell">
                <span className="stats-value">{ms(data.firstToken.p50)}</span>
                <span className="stats-label">首字延迟</span>
              </div>
              <div className="stats-cell">
                <span className="stats-value">{int(data.tokens.estOut)}</span>
                <span className="stats-label">输出 tokens（估）</span>
              </div>
            </div>

            {data.stages.length > 0 && (
              <div className="stats-block">
                <h3>阶段耗时（平均）</h3>
                {data.stages.map((item) => (
                  <div className="stats-bar-row" key={item.stage}>
                    <span className="stats-bar-label">{item.stage}</span>
                    <div className="stats-bar">
                      <div className="stats-bar-fill" style={{ width: `${Math.round((item.avgMs / maxStage) * 100)}%` }} />
                    </div>
                    <span className="stats-bar-value">{ms(item.avgMs)}</span>
                  </div>
                ))}
              </div>
            )}

            <div className="stats-block">
              <h3>成本量级（按牌价粗估）</h3>
              <p className="stats-cost">
                输入约 {int(data.tokens.estIn)} tokens · 输出约 {int(data.tokens.estOut)} tokens ·
                合计约 ¥{data.tokens.estCostCny.toFixed(4)}
              </p>
              <p className="stats-hint">
                按字符数估算（中文 0.7 token/字），用于观察趋势，不能当账单。
              </p>
            </div>

            {data.ruleFailures.length > 0 && (
              <div className="stats-block">
                <h3>最常不达标的硬规则</h3>
                <div className="stats-bar-row stats-bar-row-rule">
                  {data.ruleFailures.map((item) => (
                    <div className="stats-rule-row" key={item.code}>
                      <span className="stats-bar-label">{item.label}</span>
                      <span className="stats-rule-count">{item.count} 次</span>
                    </div>
                  ))}
                </div>
                <p className="stats-hint">按 fail 次数排序，partial 不计入；用来判断改 prompt 该往哪使劲。</p>
              </div>
            )}

            {data.errors.length > 0 && (
              <div className="stats-block">
                <h3>失败原因</h3>
                <ul className="stats-errors">
                  {data.errors.map((item) => (
                    <li key={item.message}>
                      <span className="stats-error-count">{item.count}×</span>
                      {item.message}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div className="stats-block">
              <h3>最近 {Math.min(data.recent.length, 12)} 次</h3>
              <table className="stats-table">
                <thead>
                  <tr>
                    <th>时间</th>
                    <th>trace</th>
                    <th>耗时</th>
                    <th>首字</th>
                    <th>状态</th>
                  </tr>
                </thead>
                <tbody>
                  {data.recent.slice(0, 12).map((item) => (
                    <tr key={item.traceId}>
                      <td>{item.at.slice(11)}</td>
                      <td className="stats-trace">{item.traceId}</td>
                      <td>{ms(item.durationMs)}</td>
                      <td>{ms(item.firstTokenMs)}</td>
                      <td className={item.ok ? 'ok' : 'bad'}>{item.ok ? '成功' : item.error || '失败'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
