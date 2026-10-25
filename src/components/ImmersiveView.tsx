import { useCallback, useEffect, useState } from 'react'
import { exportPlan } from '../lib/api'
import type { ClueData, PlanData } from '../types'

interface Props {
  conversationId: string
  onClose: () => void
}

const STAGE_TITLES = ['序幕', '背景', '案发', '人物', '搜证', '时间线', '指凶']

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

export default function ImmersiveView({ conversationId, onClose }: Props) {
  const [plan, setPlan] = useState<PlanData | null>(null)
  const [error, setError] = useState('')
  const [stage, setStage] = useState(0)

  useEffect(() => {
    let cancelled = false
    exportPlan(conversationId)
      .then((data) => {
        if (!cancelled) setPlan(data.plan || { title: data.title })
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : '方案加载失败')
      })
    return () => {
      cancelled = true
    }
  }, [conversationId])

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
  const culpritName = String((plan?.culprit as { character?: string } | undefined)?.character || '')

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
                  想盘问某个角色的细节？退出沉浸模式，直接在对话里问——比如
                  <Seribold>「21:40 时某某说他在哪里，证词可信吗？」</Seribold>
                </p>
                <button className="imm-btn" onClick={onClose}>
                  回到工作台盘问
                </button>
              </div>
            )}
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
