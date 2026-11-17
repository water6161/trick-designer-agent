import { useEffect, useRef } from 'react'
import { SendIcon, StopIcon } from './icons'

interface Props {
  value: string
  onChange: (value: string) => void
  onSend: () => void
  onStop: () => void
  streaming: boolean
  disabled: boolean
  /** 极速开关：与需求构造器共用同一状态（提升到 App） */
  speedMode?: boolean
  onToggleSpeed?: () => void
  /** 常用需求 chips：输入框为空且非流式时显示，点一下自动填充 */
  suggestions?: string[]
  onPickSuggestion?: (text: string) => void
}

/** 输入框下方提示文案：流式中教停止，平时按模式给耗时预期 */
export function composerHint(streaming: boolean, speedMode: boolean): string {
  if (streaming) return 'Esc 可停止生成'
  return speedMode ? '⚡ 约 15 秒出主线 · Enter 发送' : '完整模式约 1 分半 · Enter 发送'
}

export default function Composer({
  value,
  onChange,
  onSend,
  onStop,
  streaming,
  disabled,
  speedMode = false,
  onToggleSpeed,
  suggestions,
  onPickSuggestion,
}: Props) {
  const areaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    const area = areaRef.current
    if (!area) return
    area.style.height = 'auto'
    area.style.height = `${Math.min(area.scrollHeight, 200)}px`
  }, [value])

  const submit = () => {
    if (streaming || disabled) return
    if (!value.trim()) return
    onSend()
  }

  return (
    <div className="composer">
      {suggestions && onPickSuggestion && !streaming && !value.trim() && (
        <div className="composer-chips" aria-label="常用需求，点一下自动填充">
          {suggestions.map((text) => (
            <button key={text} type="button" onClick={() => onPickSuggestion(text)}>
              {text}
            </button>
          ))}
        </div>
      )}
      <div className={`composer-box ${streaming ? 'is-streaming' : ''}`}>
        <textarea
          ref={areaRef}
          id="composer-input"
          className="composer-input"
          rows={1}
          value={value}
          placeholder="一句话说需求：题材、人数、难度、想要的诡计…"
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault()
              submit()
            }
          }}
        />
        <div className="composer-actions">
          {onToggleSpeed && !streaming && (
            <button
              type="button"
              className={`composer-speed ${speedMode ? 'active' : ''}`}
              onClick={onToggleSpeed}
              disabled={disabled}
              aria-pressed={speedMode}
              title="极速模式：跳过联网检索与质量自查，约 15 秒出主线骨架（标题/凶手/线索/时间线）；需要完整方案与分支结局请关闭"
            >
              ⚡ 极速 {speedMode ? '开' : '关'}
            </button>
          )}
          <span className="composer-hint">{composerHint(streaming, speedMode)}</span>
          {streaming ? (
            <button className="stop-btn" onClick={onStop} aria-label="停止生成">
              <StopIcon />
              <span>停止</span>
            </button>
          ) : (
            <button
              className="send-btn"
              onClick={submit}
              disabled={disabled || !value.trim()}
              aria-label="发送"
            >
              <SendIcon />
            </button>
          )}
        </div>
      </div>
      <p className="composer-disclaimer">
        仅用于虚构剧本杀创作。诡计依赖虚构设定，现实中不可复刻，请勿模仿。
      </p>
    </div>
  )
}
