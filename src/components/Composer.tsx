import { useEffect, useRef } from 'react'
import { SendIcon, StopIcon } from './icons'

interface Props {
  value: string
  onChange: (value: string) => void
  onSend: () => void
  onStop: () => void
  streaming: boolean
  disabled: boolean
}

export default function Composer({ value, onChange, onSend, onStop, streaming, disabled }: Props) {
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
      <div className={`composer-box ${streaming ? 'is-streaming' : ''}`}>
        <textarea
          ref={areaRef}
          className="composer-input"
          rows={1}
          value={value}
          placeholder="描述题材、人数、难度、想要的诡计类型与特殊设定，或直接追问修改意见…"
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault()
              submit()
            }
          }}
        />
        <div className="composer-actions">
          <span className="composer-hint">Enter 发送 · Shift + Enter 换行</span>
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
