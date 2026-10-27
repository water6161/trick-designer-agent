import { useEffect, useMemo, useRef, useState } from 'react'
import { parsePlanFromMarkdown } from '../lib/parsePlan'
import type { ClueData } from '../types'

interface Props {
  markdown: string
  onClose: () => void
}

interface Phase {
  key: string
  label: string
  minutes: number
  brief: string
}

/** DM 主持台：流程引导 + 线索发放清单 + 计时器，拿平板就能开本。 */
export default function DMView({ markdown, onClose }: Props) {
  const plan = useMemo(() => parsePlanFromMarkdown(markdown), [markdown])

  const phases: Phase[] = useMemo(() => {
    const list: Phase[] = [
      {
        key: 'intro',
        label: '开场',
        minutes: 10,
        brief:
          '介绍背景与规则：陈述案件概况（死者、死因、现场），说明公开线索的获取方式，提醒玩家「所有人都在说谎，但线索不会」。',
      },
    ]
    const pub = plan.clues_public || []
    const deep = plan.clues_deep || []
    if (pub.length)
      list.push({
        key: 'round1',
        label: '第一轮·公开线索',
        minutes: 15,
        brief: '按下面的清单逐一发放公开线索，玩家可以自由搜证与交换信息。发完进入自由讨论。',
      })
    if (deep.length)
      list.push({
        key: 'round2',
        label: '第二轮·深入线索',
        minutes: 15,
        brief: '深入线索通常需要消耗行动点或完成条件后解锁，发放时注意节奏，别让一轮拿光。',
      })
    list.push({
      key: 'discuss',
      label: '指认讨论',
      minutes: 10,
      brief: '引导玩家依次陈述：我认为谁是凶手、依据是什么。鼓励互相质询时间线上的矛盾点。',
    })
    list.push({
      key: 'vote',
      label: '投票指认',
      minutes: 3,
      brief: '每人一票，写下心目中的凶手。平票时让得票最高者做最后陈词后重投。',
    })
    list.push({
      key: 'reveal',
      label: '复盘揭秘',
      minutes: 10,
      brief: '公布真相与凶手手法，逐条回收伏笔；对照证据链说明哪些线索指向真相、哪些是红鲱鱼。',
    })
    return list
  }, [plan])

  const [phaseIdx, setPhaseIdx] = useState(0)
  const [checked, setChecked] = useState<Record<string, boolean>>({})
  const [left, setLeft] = useState(phases[0].minutes * 60)
  const [running, setRunning] = useState(false)
  const timerRef = useRef<number | null>(null)

  const phase = phases[phaseIdx]
  const roundClues: ClueData[] =
    phase.key === 'round1'
      ? plan.clues_public || []
      : phase.key === 'round2'
        ? plan.clues_deep || []
        : []

  useEffect(() => {
    setLeft(phases[phaseIdx].minutes * 60)
    setRunning(false)
  }, [phaseIdx, phases])

  useEffect(() => {
    if (!running) return
    timerRef.current = window.setInterval(() => {
      setLeft((s) => {
        if (s <= 1) {
          setRunning(false)
          return 0
        }
        return s - 1
      })
    }, 1000)
    return () => {
      if (timerRef.current !== null) window.clearInterval(timerRef.current)
    }
  }, [running])

  const mm = String(Math.floor(left / 60)).padStart(2, '0')
  const ss = String(left % 60).padStart(2, '0')
  const doneCount = roundClues.filter((c) => checked[c.id || c.name || '']).length

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-panel dm-panel" onClick={(e) => e.stopPropagation()}>
        <header className="modal-head">
          <h2>🎭 DM 主持台</h2>
          <button className="icon-btn" onClick={onClose} aria-label="关闭主持台">✕</button>
        </header>

        <nav className="dm-phases">
          {phases.map((p, i) => (
            <button
              key={p.key}
              className={`dm-phase ${i === phaseIdx ? 'now' : ''} ${i < phaseIdx ? 'done' : ''}`}
              onClick={() => setPhaseIdx(i)}
            >
              {p.label}
            </button>
          ))}
        </nav>

        <div className="dm-timer-row">
          <span className={`dm-timer ${left === 0 ? 'over' : running ? 'live' : ''}`}>
            {mm}:{ss}
          </span>
          <button className="dm-timer-btn" onClick={() => setRunning((r) => !r)}>
            {running ? '暂停' : left === 0 ? '加时 1 分钟' : '开始计时'}
          </button>
          <button
            className="dm-timer-btn"
            onClick={() => {
              setRunning(false)
              setLeft(phase.minutes * 60)
            }}
          >
            重置
          </button>
        </div>

        <div className="dm-brief">
          <h3>{phase.label}</h3>
          <p>{phase.brief}</p>
        </div>

        {roundClues.length > 0 && (
          <div className="dm-clues">
            <p className="dm-clues-head">
              线索发放清单（{doneCount}/{roundClues.length}）
            </p>
            <ul>
              {roundClues.map((c, i) => {
                const key = c.id || c.name || String(i)
                return (
                  <li key={key}>
                    <label className={checked[key] ? 'given' : ''}>
                      <input
                        type="checkbox"
                        checked={!!checked[key]}
                        onChange={() => setChecked((prev) => ({ ...prev, [key]: !prev[key] }))}
                      />
                      <span className="dm-clue-id">{c.id || '线索'}</span>
                      <span className="dm-clue-name">{c.name || c.content}</span>
                      {c.points_to && <span className="dm-clue-pts">→ {c.points_to}</span>}
                    </label>
                  </li>
                )
              })}
            </ul>
          </div>
        )}

        {phase.key === 'reveal' && (plan.culprit?.character || plan.hidden_ending) && (
          <div className="dm-truth">
            {plan.culprit?.character && <p><strong>凶手：</strong>{plan.culprit.character}</p>}
            {plan.hidden_ending?.ending && <p><strong>隐藏真结局：</strong>{plan.hidden_ending.ending}</p>}
          </div>
        )}

        <div className="dm-nav">
          <button disabled={phaseIdx === 0} onClick={() => setPhaseIdx((i) => i - 1)}>
            ← 上一阶段
          </button>
          <button disabled={phaseIdx === phases.length - 1} onClick={() => setPhaseIdx((i) => i + 1)}>
            下一阶段 →
          </button>
        </div>
      </div>
    </div>
  )
}
