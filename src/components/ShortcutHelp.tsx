import { SHORTCUTS } from '../lib/shortcuts'

interface Props {
  onClose: () => void
}

/** 快捷键速查卡：? 唤起。键位表来自 shortcuts.ts，与实际行为同源。 */
export default function ShortcutHelp({ onClose }: Props) {
  return (
    <div
      className="modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="快捷键速查"
      onClick={onClose}
    >
      <div className="modal-panel shortcut-panel" onClick={(e) => e.stopPropagation()}>
        <header className="modal-head">
          <h2>⌨️ 快捷键</h2>
          <button className="icon-btn" onClick={onClose} aria-label="关闭快捷键速查">✕</button>
        </header>
        <ul className="shortcut-list">
          {SHORTCUTS.map((item) => (
            <li key={item.keys} className="shortcut-row">
              <kbd className="shortcut-keys">{item.keys}</kbd>
              <span className="shortcut-desc">{item.description}</span>
            </li>
          ))}
        </ul>
        <p className="shortcut-foot">输入框聚焦时快捷键让位给打字；先按 g 再按 d / t / p 触发工具（g 是前缀键）。</p>
      </div>
    </div>
  )
}
