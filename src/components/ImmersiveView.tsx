import { useCallback, useEffect, useState } from 'react'
import { exportPlan } from '../lib/api'
import { parsePlanFromMarkdown } from '../lib/parsePlan'
import type { ClueData, PlanData } from '../types'

interface Props {
  conversationId: string
  fallbackMarkdown?: string
  onClose: () => void
}

const STAGE_TITLES = ['序幕', '背景', '案发', '人物', '搜证', '时间线', '指凶', '抉择']

interface InteractionOption {
  text: string
  result: string
  type: string
}

interface InteractionNode {
  title: string
  scene: string
  options: InteractionOption[]
}

function outcomeType(type: string): 'death' | 'risk' | 'safe' {
  if (type.includes('死')) return 'death'
  if (type.includes('疑') || type.includes('险')) return 'risk'
  return 'safe'
}

const CHOICE_SECONDS = 25

function InteractiveStage({ plan }: { plan: PlanData | null }) {
  const nodes = (Array.isArray(plan?.interactions) ? (plan!.interactions as InteractionNode[]) : []).filter(
    (n) => n && Array.isArray(n.options) && n.options.length >= 2,
  )
  const hidden = (plan?.hidden_ending || null) as { scene?: string; ending?: string } | null
  const [idx, setIdx] = useState(0)
  const [deaths, setDeaths] = useState(0)
  const [outcome, setOutcome] = useState<{ type: 'death' | 'risk' | 'safe'; result: string } | null>(null)
  const [timeLeft, setTimeLeft] = useState(CHOICE_SECONDS)

  // 限时抉择：每个节点 25 秒，超时直接判定死亡；展示结果时暂停
  useEffect(() => {
    if (outcome || idx >= nodes.length) return
    setTimeLeft(CHOICE_SECONDS)
    const started = Date.now()
    const tick = setInterval(() => {
      const left = CHOICE_SECONDS - Math.floor((Date.now() - started) / 1000)
      setTimeLeft(Math.max(left, 0))
    }, 250)
    const expire = setTimeout(() => {
      setOutcome({ type: 'death', result: '你在原地犹豫了太久。黑暗没有给第二次机会——机会稍纵即逝，犹豫本身就是答案。（超时判定）' })
    }, CHOICE_SECONDS * 1000)
    return () => {
      clearInterval(tick)
      clearTimeout(expire)
    }
  }, [idx, outcome, nodes.length])

  if (!nodes.length) {
    return (
      <div className="imm-center">
        <h2 className="imm-heading">抉择时刻</h2>
        <p className="imm-para">本套方案未附带互动剧情，重新生成一次方案即可解锁。</p>
      </div>
    )
  }

  if (idx >= nodes.length) {
    const grade =
      deaths === 0
        ? { title: '👑 完美神探', desc: '全程无伤，每一次选择都踩在线索铺好的路上。' }
        : deaths <= 2
          ? { title: '🌅 幸存者', desc: `你带着 ${deaths} 次死亡的记忆走到了最后。` }
          : { title: '🕯️ 九死一生', desc: `${deaths} 次死亡之后，你终于学会了用线索思考。` }
    const unlocked = deaths === 0 && hidden && hidden.ending
    return (
      <div className="imm-center imm-text">
        <h2 className="imm-heading">{grade.title}</h2>
        <p className="imm-para">{grade.desc}</p>
        {unlocked ? (
          <>
            <p className="imm-eyebrow imm-hidden-label">🔮 隐藏真结局已解锁</p>
            {hidden!.scene
              ?.split('\n')
              .filter((p) => p.trim())
              .map((p, i) => (
                <p key={`s${i}`} className="imm-para imm-fade" style={{ animationDelay: `${i * 0.2}s` }}>
                  {p.replace(/^场景[：:]\s*/, '')}
                </p>
              ))}
            <p className="imm-para imm-hidden-ending imm-fade" style={{ animationDelay: '0.6s' }}>
              {hidden!.ending?.replace(/^真结局[：:]\s*/, '')}
            </p>
          </>
        ) : (
          <p className="imm-para imm-hint">
            {hidden && deaths > 0
              ? `有一段隐藏真结局被死亡次数锁住了——全程无伤通关即可解锁。本轮死亡：${deaths} 次。`
              : '真相已经揭开——退出沉浸模式，回到工作台继续复盘或迭代方案。'}
          </p>
        )}
        <p className="imm-para imm-hint">退出沉浸模式，回到工作台继续复盘或迭代方案。</p>
      </div>
    )
  }

  const node = nodes[idx]

  if (outcome) {
    if (outcome.type === 'death') {
      return (
        <div className="imm-center">
          <p className="imm-eyebrow imm-death-label">💀 死亡结局</p>
          <h2 className="imm-heading">你已出局</h2>
          <p className="imm-para">{outcome.result}</p>
          <p className="imm-para imm-hint">死亡不是终点——回到抉择，用线索重新判断。（本轮死亡 +1）</p>
          <button
            className="imm-btn"
            onClick={() => {
              setDeaths((d) => d + 1)
              setOutcome(null)
            }}
          >
            重新抉择
          </button>
        </div>
      )
    }
    return (
      <div className="imm-center">
        <p className="imm-eyebrow">{outcome.type === 'risk' ? '⚠️ 侥幸过关' : '✅ 平安'}</p>
        <p className="imm-para">{outcome.result}</p>
        {idx < nodes.length - 1 && (
          <button className="imm-btn" onClick={() => { setOutcome(null); setIdx((v) => v + 1) }}>
            继续
          </button>
        )}
        {idx >= nodes.length - 1 && (
          <button className="imm-btn" onClick={() => { setOutcome(null); setIdx((v) => v + 1) }}>
            迎接结局
          </button>
        )}
      </div>
    )
  }

  return (
    <div className="imm-center imm-text">
      <div className="imm-timer" role="timer">
        <div className="imm-timer-bar" style={{ width: `${(timeLeft / CHOICE_SECONDS) * 100}%` }} />
      </div>
      <p className="imm-eyebrow">
        抉择 {idx + 1} / {nodes.length} · {node.title} · ⏳ {timeLeft}s
      </p>
      {node.scene
        .split('\n')
        .filter((p) => p.trim())
        .slice(0, 4)
        .map((p, i) => (
          <p key={i} className="imm-para imm-fade" style={{ animationDelay: `${i * 0.2}s` }}>
            {p.replace(/^场景[：:]\s*/, '')}
          </p>
        ))}
      <div className="imm-choices">
        {node.options.map((opt, i) => (
          <button
            key={i}
            className="imm-choice imm-fade"
            style={{ animationDelay: `${0.3 + i * 0.15}s` }}
            onClick={() => setOutcome({ type: outcomeType(opt.type), result: opt.result || opt.text })}
          >
            {opt.text}
          </button>
        ))}
      </div>
    </div>
  )
}

function Seribold({ children }: { children: React.ReactNode }) {
  return <strong style={{ color: '#d8b56a' }}>{children}</strong>
}

function CoverStage({ plan, onNext }: { plan: PlanData | null; onNext: () => void }) {
  return (
    <div className="imm-center">
      <p className="imm-eyebrow">TRICK ARCHITECT · 沉浸模式</p>
      <h1 className="imm-title">{plan?.title || '未命名剧本'}</h1>
      {typeof (plan as { tagline?: string } | null)?.tagline === 'string' && (
        <p className="imm-tagline">{(plan as { tagline?: string }).tagline}</p>
      )}
      <button className="imm-btn" onClick={onNext}>
        翻开剧本
      </button>
      <p className="imm-hint">← → 方向键翻页 · Esc 退出</p>
    </div>
  )
}

function TextStage({ title, paragraphs, onNext }: { title: string; paragraphs: string[]; onNext: () => void }) {
  return (
    <div className="imm-center imm-text">
      <h2 className="imm-heading">{title}</h2>
      {paragraphs.map((p, i) => (
        <p key={i} className="imm-para imm-fade" style={{ animationDelay: `${i * 0.25}s` }}>
          {p}
        </p>
      ))}
      <button className="imm-btn" onClick={onNext}>
        继续
      </button>
    </div>
  )
}

function CharacterStage({ plan, onNext }: { plan: PlanData | null; onNext: () => void }) {
  const characters = Array.isArray(plan?.characters) ? plan!.characters : []
  return (
    <div className="imm-center">
      <h2 className="imm-heading">在场人物</h2>
      <div className="imm-cards">
        {characters.map((c, i) => (
          <div key={i} className="imm-card imm-fade" style={{ animationDelay: `${i * 0.2}s` }}>
            <strong>{String(c.name || '未知')}</strong>
            <span>{String(c.identity || '')}</span>
            <em>{String(c.suspicion || '')}</em>
          </div>
        ))}
      </div>
      <button className="imm-btn" onClick={onNext}>
        开始搜证
      </button>
    </div>
  )
}

function ClueCard({ clue }: { clue: ClueData }) {
  const [flipped, setFlipped] = useState(false)
  return (
    <button className={`imm-clue ${flipped ? 'flipped' : ''}`} onClick={() => setFlipped((v) => !v)}>
      {flipped ? (
        <>
          <strong>
            {clue.id} · {clue.name}
          </strong>
          <span>{clue.content}</span>
          {clue.access && <em>获取：{clue.access}</em>}
        </>
      ) : (
        <span className="imm-clue-back">🔍 {clue.id || '线索'}</span>
      )}
    </button>
  )
}

export default function ImmersiveView({ conversationId, fallbackMarkdown, onClose }: Props) {
  const [plan, setPlan] = useState<PlanData | null>(null)
  const [error, setError] = useState('')
  const [stage, setStage] = useState(0)

  useEffect(() => {
    let cancelled = false
    const parsed = fallbackMarkdown && fallbackMarkdown.length > 200 ? parsePlanFromMarkdown(fallbackMarkdown) : null
    exportPlan(conversationId)
      .then((data) => {
        if (cancelled) return
        // 导出接口的结构化数据优先（flash 提取更规整），缺失字段用正文解析结果补齐
        const remote = data.plan
        if (remote && Object.keys(remote).length > 2) {
          setPlan({ ...(parsed || {}), ...remote, title: remote.title || parsed?.title || data.title } as PlanData)
        } else {
          setPlan(parsed || { title: data.title })
        }
      })
      .catch(() => {
        if (!cancelled) {
          if (parsed) setPlan(parsed)
          else setError('方案加载失败，请重新生成一次方案。')
        }
      })
    return () => {
      cancelled = true
    }
  }, [conversationId, fallbackMarkdown])

  const next = useCallback(() => setStage((s) => Math.min(s + 1, STAGE_TITLES.length - 1)), [])
  const prev = useCallback(() => setStage((s) => Math.max(s - 1, 0)), [])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
      if (event.key === 'ArrowRight' || event.key === 'PageDown') next()
      if (event.key === 'ArrowLeft' || event.key === 'PageUp') prev()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [next, prev, onClose])

  const backgroundParas = String(plan?.background || '')
    .split(/\n+/)
    .filter((p) => p.trim())
  const victim = (plan?.victim || {}) as Record<string, unknown>
  const publicClues = Array.isArray(plan?.clues_public) ? plan!.clues_public : []
  const timeline = (Array.isArray(plan?.timeline) ? plan!.timeline : []).filter(
    (t) => (t as { visibility?: string }).visibility !== '深入',
  )

  return (
    <div className="imm-overlay" role="dialog" aria-label="沉浸模式">
      <header className="imm-top">
        <span className="imm-stage-label">
          {STAGE_TITLES[stage]} · {stage + 1}/{STAGE_TITLES.length}
        </span>
        <button className="imm-close" onClick={onClose} aria-label="退出沉浸模式">
          ✕ 退出
        </button>
      </header>

      <div className="imm-body">
        {error && <div className="imm-center imm-para">{error}</div>}
        {!error && !plan && <div className="imm-center imm-para">正在翻开剧本…</div>}

        {!error && plan && (
          <>
            {stage === 0 && <CoverStage plan={plan} onNext={next} />}

            {stage === 1 && (
              <TextStage title="背景" paragraphs={backgroundParas.slice(0, 6)} onNext={next} />
            )}

            {stage === 2 && (
              <TextStage
                title="案发"
                paragraphs={[
                  victim.name ? `死者：${victim.name}（${victim.identity || ''}）` : '',
                  victim.death_time ? `死亡时间：${victim.death_time}` : '',
                  victim.cause ? `死因：${victim.cause}` : '',
                  victim.scene ? `现场：${victim.scene}` : '',
                  victim.found_by ? `发现：${victim.found_by}` : '',
                ].filter((p) => p.length > 0)}
                onNext={next}
              />
            )}

            {stage === 3 && <CharacterStage plan={plan} onNext={next} />}

            {stage === 4 && (
              <div className="imm-center">
                <h2 className="imm-heading">搜证 · 点击翻开线索卡</h2>
                <div className="imm-clue-grid">
                  {publicClues.map((clue, i) => (
                    <ClueCard key={i} clue={clue} />
                  ))}
                </div>
                <button className="imm-btn" onClick={next} style={{ marginTop: 24 }}>
                  看时间线
                </button>
              </div>
            )}

            {stage === 5 && (
              <div className="imm-center">
                <h2 className="imm-heading">时间线（公开部分）</h2>
                <div className="imm-timeline">
                  {timeline.map((item, i) => {
                    const t = item as { time?: string; event?: string; witness?: string }
                    return (
                      <div key={i} className="imm-tl-item imm-fade" style={{ animationDelay: `${i * 0.2}s` }}>
                        <span className="imm-tl-time">{t.time}</span>
                        <span className="imm-tl-event">{t.event}</span>
                        {t.witness && <span className="imm-tl-witness">可验证：{t.witness}</span>}
                      </div>
                    )
                  })}
                </div>
                <button className="imm-btn" onClick={next}>
                  进入指凶
                </button>
              </div>
            )}

            {stage === 6 && (
              <div className="imm-center">
                <h2 className="imm-heading">指凶时刻</h2>
                <p className="imm-para">所有人集中。每人一段话陈述指认对象与理由。</p>
                <p className="imm-para">
                  想盘问某个角色的细节？方向键或下方按钮继续——
                  <Seribold>接下来是专属于你的抉择时刻。</Seribold>
                </p>
                <button className="imm-btn" onClick={next}>
                  进入抉择
                </button>
              </div>
            )}

            {stage === 7 && <InteractiveStage plan={plan} />}
          </>
        )}
      </div>

      <footer className="imm-nav">
        <button onClick={prev} disabled={stage === 0} aria-label="上一页">
          ← 上一页
        </button>
        <button onClick={next} disabled={stage === STAGE_TITLES.length - 1} aria-label="下一页">
          下一页 →
        </button>
      </footer>
    </div>
  )
}
