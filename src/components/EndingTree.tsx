import type { PlanEnding, PlanData } from '../types'

interface Props {
  plan: PlanData | null | undefined
  onClose: () => void
}

function obj(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
}

function arr(value: unknown): PlanEnding[] {
  return Array.isArray(value) ? (value.filter((item) => item && typeof item === 'object') as PlanEnding[]) : []
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

/** 从「支撑线索」列拆出线索编号：C1、D2 / C1、C2。 */
export function clueIdsOf(ending: PlanEnding): string[] {
  const raw = text(ending.clues)
  if (!raw) return []
  return Array.from(new Set(raw.match(/[A-Za-z]\d{1,2}/g) ?? []).values()).map((id) => id.toUpperCase())
}

/**
 * 结局分支树：把「支撑线索 → 走向」画成一棵可视化的树。
 *
 * 存在的价值：多结局不是噱头，它要求每条分支都有线索可达——
 * 树状布局让「哪条线索通向哪条结局」一眼可查，复盘时照着收尾即可。
 * 数据来自方案 Markdown 的「结局分支」表（mdplan 解析），没有该章节时给引导文案。
 */
export default function EndingTree({ plan, onClose }: Props) {
  const source = obj(plan)
  const endings = arr(source.endings).filter((item) => text(item.name) || text(item.outcome))
  const culprit = text(obj(source.culprit).character)
  const knownIds = new Set(
    [...arr(source.clues_public), ...arr(source.clues_deep)]
      .map((clue) => text(obj(clue).id).toUpperCase())
      .filter(Boolean),
  )

  return (
    <div
      className="modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="结局分支树"
      onClick={onClose}
    >
      <div className="modal-panel ending-panel" onClick={(event) => event.stopPropagation()}>
        <header className="modal-head">
          <h2>🌳 结局分支</h2>
          <button className="icon-btn" onClick={onClose} aria-label="关闭结局分支树">✕</button>
        </header>

        {endings.length === 0 ? (
          <div className="ending-empty">
            {culprit && (
              <div className="ending-root">
                <span className="ending-root-label">本案真相</span>
                <span className="ending-root-culprit">凶手：{culprit}</span>
              </div>
            )}
            <p>这份方案还没有分支结局。</p>
            <p className="ending-empty-hint">
              直接说「给方案加 2 条分支结局」，我会在 DM 提示后补一张结局分支表：
              每条结局都标注触发条件与支撑线索编号，硬规则会校验编号真实存在。
            </p>
          </div>
        ) : (
          <div className="ending-tree">
            <div className="ending-root">
              <span className="ending-root-label">本案真相</span>
              {culprit && <span className="ending-root-culprit">凶手：{culprit}</span>}
            </div>

            <ul className="ending-branches">
              {endings.map((ending, index) => {
                const ids = clueIdsOf(ending)
                const unknown = ids.filter((id) => !knownIds.has(id))
                const isTrue = index === 0
                return (
                  <li className="ending-branch" key={`${text(ending.name)}-${index}`}>
                    <span className="ending-stem" aria-hidden="true" />
                    <article className={`ending-card ${isTrue ? 'true-ending' : ''}`}>
                      <header className="ending-card-head">
                        <h3 className="ending-name">
                          {isTrue && <span className="ending-true-badge">真</span>}
                          {text(ending.name) || `结局 ${index + 1}`}
                        </h3>
                        {text(ending.condition) && (
                          <p className="ending-condition">触发：{text(ending.condition)}</p>
                        )}
                      </header>

                      {ids.length > 0 && (
                        <div className="ending-clues">
                          <span className="ending-clues-label">支撑线索</span>
                          {ids.map((id) => (
                            <span
                              key={id}
                              className={`ending-clue-chip ${unknown.includes(id) ? 'unknown' : ''}`}
                              title={unknown.includes(id) ? '线索表里找不到这个编号' : undefined}
                            >
                              {id}
                            </span>
                          ))}
                          {unknown.length > 0 && (
                            <span className="ending-clue-warn">
                              {unknown.join('、')} 不在线索表中
                            </span>
                          )}
                        </div>
                      )}

                      {text(ending.outcome) && <p className="ending-outcome">{text(ending.outcome)}</p>}
                    </article>
                  </li>
                )
              })}
            </ul>
          </div>
        )}
      </div>
    </div>
  )
}
