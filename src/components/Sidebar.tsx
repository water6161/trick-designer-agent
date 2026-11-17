import { useEffect, useMemo, useState } from 'react'
import { CloseIcon, PlusIcon, TrashIcon } from './icons'
import { filterSessions, groupSessions } from '../lib/sessionFilter'
import { setCoverMediaPref, type AICoverMedia } from '../lib/api'
import type { SessionItem } from '../types'

interface Props {
  sessions: SessionItem[]
  activeId: string
  open: boolean
  onNew: () => void
  onSelect: (id: string) => void
  onDelete: (id: string) => void
  onClose: () => void
  /** 空态「画风灵感」位：点缩略图设为 AI 封面默认画风 */
  onPickMedia?: (media: AICoverMedia) => void
}

/** 空侧栏不放空文案，放画风缩略图——点一张，生成封面时默认用这个画风。与首屏轮播共用同一组图。 */
const STYLE_SHOTS: { key: AICoverMedia; label: string; src: string }[] = [
  { key: 'cine', label: '电影剧照', src: 'covers/cine.webp' },
  { key: 'ukiyoe', label: '浮世绘', src: 'covers/ukiyoe.webp' },
  { key: 'ink', label: '水墨写意', src: 'covers/ink.webp' },
  { key: 'noir', label: '黑白电影', src: 'covers/noir.webp' },
]

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

/** 会话攒到四条以上，靠日期辨认就不够用了——给个搜索框。 */
const SEARCH_THRESHOLD = 4

export default function Sidebar({
  sessions,
  activeId,
  open,
  onNew,
  onSelect,
  onDelete,
  onClose,
  onPickMedia,
}: Props) {
  const [query, setQuery] = useState('')
  // 删除会话不可逆（连历史带状态一起没），所以要点两次：第一次只把按钮变成「确认」
  const [pendingDelete, setPendingDelete] = useState('')

  useEffect(() => {
    if (!pendingDelete) return
    const timer = setTimeout(() => setPendingDelete(''), 4000)
    return () => clearTimeout(timer)
  }, [pendingDelete])

  const groups = useMemo(() => groupSessions(filterSessions(sessions, query)), [sessions, query])
  const matched = groups.reduce((sum, group) => sum + group.items.length, 0)

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

      {sessions.length >= SEARCH_THRESHOLD && (
        <input
          className="session-search"
          type="search"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value)
            setPendingDelete('')
          }}
          placeholder="搜剧本名"
          aria-label="搜索会话"
        />
      )}

      <div className="session-label">{query.trim() ? `匹配 ${matched} 个` : '最近的剧本'}</div>
      <div className="session-list">
        {sessions.length === 0 && (
          <>
            <p className="session-empty">还没有会话，输入一个题材开始。</p>
            <div className="style-gallery" aria-label="封面画风灵感">
              <div className="style-gallery-label">封面画风灵感</div>
              <div className="style-grid">
                {STYLE_SHOTS.map((shot) => (
                  <button
                    key={shot.key}
                    type="button"
                    className="style-thumb"
                    title={`生成 AI 封面时默认用「${shot.label}」`}
                    onClick={() => {
                      setCoverMediaPref(shot.key)
                      onPickMedia?.(shot.key)
                    }}
                  >
                    <img src={shot.src} alt={shot.label} width={66} height={88} loading="lazy" />
                    <span>{shot.label}</span>
                  </button>
                ))}
              </div>
              <p className="style-gallery-note">点选设为默认画风 · 共 10 种，导出栏可随时换</p>
            </div>
          </>
        )}

        {sessions.length > 0 && matched === 0 && (
          <p className="session-empty">没有标题含「{query.trim()}」的会话。</p>
        )}

        {groups.map((section) => (
          <div className="session-group" key={section.group}>
            <div className="session-group-label">{section.group}</div>
            {section.items.map((session) => {
              const confirming = pendingDelete === session.id
              return (
                <div
                  key={session.id}
                  className={`session-item ${session.id === activeId ? 'active' : ''}`}
                >
                  <button className="session-main" onClick={() => onSelect(session.id)}>
                    <span className="session-title">{session.title}</span>
                    <span className="session-time">{formatTime(session.updatedAt)}</span>
                  </button>
                  <button
                    className={`session-delete ${confirming ? 'confirming' : ''}`}
                    aria-label={
                      confirming ? `确认删除会话 ${session.title}` : `删除会话 ${session.title}`
                    }
                    onClick={(event) => {
                      event.stopPropagation()
                      if (!confirming) {
                        setPendingDelete(session.id)
                        return
                      }
                      setPendingDelete('')
                      onDelete(session.id)
                    }}
                  >
                    {confirming ? '确认' : <TrashIcon />}
                  </button>
                </div>
              )
            })}
          </div>
        ))}
      </div>

      <div className="sidebar-footer">
        <span>自托管 · 数据仅存本机</span>
        <span className="footer-note">仅用于虚构剧本杀创作</span>
      </div>
    </aside>
  )
}
