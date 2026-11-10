import { useState } from 'react'
import { copyText } from '../lib/exporters'
import { annotationsToText, type Annotation } from '../lib/annotations'

interface Props {
  items: Annotation[]
  onClose: () => void
  onRemove: (id: string) => void
  onJump: (messageId: string) => void
}

/** 批注清单：当前会话划过的每一句与写的每一句，一键回跳原文。 */
export default function AnnotationsPanel({ items, onClose, onRemove, onJump }: Props) {
  const [msg, setMsg] = useState('')

  const flash = (text: string) => {
    setMsg(text)
    window.setTimeout(() => setMsg(''), 2600)
  }

  const copyAll = async () => {
    const ok = await copyText(annotationsToText(items))
    flash(ok ? '已复制全部批注' : '复制失败，请手动选择文本')
  }

  return (
    <div
      className="modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="批注清单"
      onClick={onClose}
    >
      <div className="modal-panel notes-panel" onClick={(e) => e.stopPropagation()}>
        <header className="modal-head">
          <h2>📝 批注（{items.length}）</h2>
          <div className="modal-head-actions">
            {items.length > 0 && (
              <button className="notes-copy" onClick={() => void copyAll()}>
                ⧉ 复制全部
              </button>
            )}
            <button className="icon-btn" onClick={onClose} aria-label="关闭批注清单">✕</button>
          </div>
        </header>

        {msg && (
          <p className="notes-flash" role="status">
            {msg}
          </p>
        )}

        {items.length === 0 ? (
          <p className="notes-empty">
            还没有批注。在正文里划选一段文字，点「✎ 加批注」就能记下修改意见——只存在本机浏览器里。
          </p>
        ) : (
          <ul className="notes-list">
            {items.map((item) => (
              <li key={item.id} className="notes-item">
                <button
                  className="notes-quote"
                  onClick={() => onJump(item.messageId)}
                  title="点击跳到这条批注所在的消息"
                >
                  ❝ {item.quote} ❞
                </button>
                <p className="notes-note">{item.note}</p>
                <button
                  className="notes-del"
                  onClick={() => onRemove(item.id)}
                  aria-label="删除批注"
                >
                  ✕
                </button>
              </li>
            ))}
          </ul>
        )}

        <p className="notes-foot">批注只保存在这台设备的浏览器里，不会上传，也不会出现在分享链接中。</p>
      </div>
    </div>
  )
}
