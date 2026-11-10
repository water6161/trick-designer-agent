import { useEffect, useRef, useState } from 'react'

export interface SelectionTarget {
  /** 浮标水平锚点（选区中心） */
  x: number
  /** 浮标垂直锚点（选区顶端） */
  y: number
  messageId: string
  quote: string
}

interface Props {
  target: SelectionTarget
  onSave: (note: string) => void
  onCancel: () => void
}

/**
 * 选区浮标：划选正文后浮出「加批注」，点开就地写一句。
 * 浮层挂在 App 根层（fixed 定位），不参与聊天气泡的布局与滚动。
 */
export default function AnnotationPopover({ target, onSave, onCancel }: Props) {
  const [open, setOpen] = useState(false)
  const [note, setNote] = useState('')
  const inputRef = useRef<HTMLTextAreaElement | null>(null)

  useEffect(() => {
    setOpen(false)
    setNote('')
  }, [target.messageId, target.quote])

  useEffect(() => {
    if (open) inputRef.current?.focus()
  }, [open])

  // 编辑态 Esc 只取消编辑，不冒泡去关别的弹层
  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'Escape') {
      event.stopPropagation()
      onCancel()
    }
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault()
      if (note.trim()) onSave(note)
    }
  }

  const top = target.y > 120 ? target.y - 46 : target.y + 14

  if (!open) {
    return (
      <div className="annot-pop" style={{ left: target.x, top }}>
        <button
          className="annot-pop-btn"
          // 不让点击浮标时丢掉选区
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => setOpen(true)}
        >
          ✎ 加批注
        </button>
      </div>
    )
  }

  return (
    <div className="annot-pop annot-pop-editor" style={{ left: target.x, top }} onKeyDown={onKeyDown}>
      <p className="annot-pop-quote">❝ {target.quote} ❞</p>
      <textarea
        ref={inputRef}
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="写批注：这里要改什么、为什么可疑…"
        rows={3}
        aria-label="批注内容"
      />
      <div className="annot-pop-actions">
        <button className="annot-pop-save" disabled={!note.trim()} onClick={() => onSave(note)}>
          保存批注
        </button>
        <button className="annot-pop-cancel" onClick={onCancel}>
          取消
        </button>
        <span className="annot-pop-hint">⌘/Ctrl + Enter 保存</span>
      </div>
    </div>
  )
}
