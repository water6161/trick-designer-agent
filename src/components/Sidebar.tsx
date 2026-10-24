import { CloseIcon, PlusIcon, TrashIcon } from './icons'
import type { SessionItem } from '../types'

interface Props {
  sessions: SessionItem[]
  activeId: string
  open: boolean
  onNew: () => void
  onSelect: (id: string) => void
  onDelete: (id: string) => void
  onClose: () => void
}

function formatTime(value?: string | null): string {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const now = new Date()
  const sameDay =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate()
  if (sameDay) {
    return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
  }
  return `${date.getMonth() + 1}/${date.getDate()}`
}

export default function Sidebar({
  sessions,
  activeId,
  open,
  onNew,
  onSelect,
  onDelete,
  onClose,
}: Props) {
  return (
    <aside className={`sidebar ${open ? 'sidebar-open' : ''}`} aria-label="会话列表">
      <div className="brand">
        <div className="brand-mark" aria-hidden="true">
          诡
        </div>
        <div className="brand-text">
          <strong>诡计设计师</strong>
          <span>TRICK ARCHITECT</span>
        </div>
        <button className="icon-btn sidebar-close" onClick={onClose} aria-label="关闭会话列表">
          <CloseIcon />
        </button>
      </div>

      <button className="new-chat" onClick={onNew}>
        <PlusIcon />
        <span>新建对话</span>
      </button>

      <div className="session-label">最近的剧本</div>
      <div className="session-list">
        {sessions.length === 0 && <p className="session-empty">还没有会话，输入一个题材开始。</p>}
        {sessions.map((session) => (
          <div
            key={session.id}
            className={`session-item ${session.id === activeId ? 'active' : ''}`}
          >
            <button className="session-main" onClick={() => onSelect(session.id)}>
              <span className="session-title">{session.title}</span>
              <span className="session-time">{formatTime(session.updatedAt)}</span>
            </button>
            <button
              className="session-delete"
              aria-label={`删除会话 ${session.title}`}
              onClick={(event) => {
                event.stopPropagation()
                onDelete(session.id)
              }}
            >
              <TrashIcon />
            </button>
          </div>
        ))}
      </div>

      <div className="sidebar-footer">
        <span>LangGraph · EdgeOne Makers</span>
        <span className="footer-note">仅用于虚构剧本杀创作</span>
      </div>
    </aside>
  )
}
