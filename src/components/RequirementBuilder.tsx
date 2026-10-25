import { useEffect, useMemo, useState } from 'react'

interface Props {
  onSend: (message: string) => void
  hasPlan: boolean
  disabled: boolean
}

const GENRES = ['本格', '变格', '民国', '古风', '现代', '科幻', '情感']
const PLAYER_OPTIONS = ['4人', '5人', '6人', '7人', '8人']
const DIFFICULTIES = ['新手', '进阶', '硬核', '地狱']
const TRICKS = ['密室', '不在场证明', '叙诡', '时间诡计', '身份诡计', '红鲱鱼', '双线叙事', '循环']
const MOODS = ['暴雪夜', '孤岛', '深山古宅', '老钟楼', '民国邮轮', '废弃戏院', '暴雨古镇', '雪国列车']

const ITERATION_CHIPS = [
  '再难一点，加一层反转',
  '换一个诡计方向重新设计',
  '加一条红鲱鱼，别太容易排除',
  '帮我修公平性问题，补足锁凶线索',
  '精简到适合新手开本',
]

const STORE_KEY = 'trick-designer-req-builder'

interface BuilderState {
  genre: string
  players: string
  difficulty: string
  tricks: string[]
  mood: string
}

function loadSaved(): BuilderState {
  try {
    const raw = localStorage.getItem(STORE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<BuilderState>
      return {
        genre: typeof parsed.genre === 'string' ? parsed.genre : '',
        players: typeof parsed.players === 'string' ? parsed.players : '',
        difficulty: typeof parsed.difficulty === 'string' ? parsed.difficulty : '',
        tricks: Array.isArray(parsed.tricks) ? parsed.tricks.filter((t) => typeof t === 'string') : [],
        mood: typeof parsed.mood === 'string' ? parsed.mood : '',
      }
    }
  } catch {
    // 忽略损坏的本地数据
  }
  return { genre: '', players: '', difficulty: '', tricks: [], mood: '' }
}

function pick<T>(items: T[]): T {
  return items[Math.floor(Math.random() * items.length)]
}

export default function RequirementBuilder({ onSend, hasPlan, disabled }: Props) {
  const [open, setOpen] = useState(false)
  const [state, setState] = useState<BuilderState>(loadSaved)
  const [special, setSpecial] = useState('')

  useEffect(() => {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(state))
    } catch {
      // 忽略存储失败
    }
  }, [state])

  const message = useMemo(() => {
    const parts: string[] = []
    if (state.genre) parts.push(`题材：${state.genre}`)
    if (state.players) parts.push(`人数：${state.players}`)
    if (state.difficulty) parts.push(`难度：${state.difficulty}`)
    if (state.tricks.length > 0) parts.push(`核心诡计：${state.tricks.join('、')}`)
    const specialText = [state.mood, special].filter(Boolean).join('，')
    if (specialText) parts.push(`特殊设定：${specialText}`)
    return parts.join('；')
  }, [state, special])

  const canBuild = message.length > 0

  const chip = (label: string, active: boolean, onClick: () => void, key: string) => (
    <button
      key={key}
      type="button"
      className={`req-chip ${active ? 'active' : ''}`}
      onClick={onClick}
      disabled={disabled}
    >
      {label}
    </button>
  )

  const toggleTrick = (item: string) => {
    setState((prev) => ({
      ...prev,
      tricks: prev.tricks.includes(item)
        ? prev.tricks.filter((t) => t !== item)
        : [...prev.tricks, item],
    }))
  }

  const randomize = () => {
    setState({
      genre: pick(GENRES),
      players: pick(PLAYER_OPTIONS),
      difficulty: pick(DIFFICULTIES),
      tricks: [pick(TRICKS), pick(TRICKS)].filter((v, i, arr) => arr.indexOf(v) === i),
      mood: Math.random() > 0.4 ? pick(MOODS) : '',
    })
    setOpen(true)
  }

  return (
    <div className="req-builder">
      <div className="req-builder-bar">
        {hasPlan
          ? ITERATION_CHIPS.map((text) => (
              <button
                key={text}
                type="button"
                className="req-chip"
                onClick={() => onSend(text)}
                disabled={disabled}
              >
                {text}
              </button>
            ))
          : (
            <>
              <button type="button" className="req-chip" onClick={() => setOpen((v) => !v)} disabled={disabled}>
                🎭 需求构造器 {open ? '▲' : '▼'}
              </button>
              <button type="button" className="req-chip" onClick={randomize} disabled={disabled} title="随机抽一组题材/诡计/氛围">
                🎲 灵感骰子
              </button>
            </>
          )}
      </div>

      {open && !hasPlan && (
        <div className="req-panel">
          <div className="req-row">
            <span className="req-label">题材</span>
            {GENRES.map((g) => chip(g, state.genre === g, () => setState((p) => ({ ...p, genre: p.genre === g ? '' : g })), g))}
          </div>
          <div className="req-row">
            <span className="req-label">人数</span>
            {PLAYER_OPTIONS.map((p) => chip(p, state.players === p, () => setState((prev) => ({ ...prev, players: prev.players === p ? '' : p })), p))}
          </div>
          <div className="req-row">
            <span className="req-label">难度</span>
            {DIFFICULTIES.map((d) => chip(d, state.difficulty === d, () => setState((prev) => ({ ...prev, difficulty: prev.difficulty === d ? '' : d })), d))}
          </div>
          <div className="req-row">
            <span className="req-label">诡计</span>
            {TRICKS.map((t) => chip(t, state.tricks.includes(t), () => toggleTrick(t), t))}
          </div>
          <div className="req-row">
            <span className="req-label">氛围</span>
            {MOODS.map((m) => chip(m, state.mood === m, () => setState((prev) => ({ ...prev, mood: prev.mood === m ? '' : m })), m))}
          </div>
          <div className="req-row">
            <span className="req-label">设定</span>
            <input
              className="req-input"
              value={special}
              placeholder="补充特殊设定，如：第二具尸体出现在上锁的房间"
              onChange={(event) => setSpecial(event.target.value)}
              disabled={disabled}
            />
          </div>
          <div className="req-row req-footer">
            <span className="req-preview">{canBuild ? message : '选择任意条件后即可生成'}</span>
            <button
              type="button"
              className="req-generate"
              disabled={!canBuild || disabled}
              onClick={() => {
                onSend(`${message}。请给一套完整方案。`)
                setOpen(false)
              }}
            >
              🚀 生成方案
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
