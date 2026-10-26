import { useCallback, useEffect, useRef, useState } from 'react'
import ChatMessage from './components/ChatMessage'
import Composer from './components/Composer'
import ExportBar from './components/ExportBar'
import ImmersiveView from './components/ImmersiveView'
import RequirementBuilder from './components/RequirementBuilder'
import Sidebar from './components/Sidebar'
import StageProgress from './components/StageProgress'
import Welcome from './components/Welcome'
import { MenuIcon } from './components/icons'
import {
  deleteSession,
  getHistory,
  listSessions,
  newConversationId,
  stopRun,
  streamChat,
  streamRetry,
} from './lib/api'
import type { ChatMessage as ChatMessageType, SessionItem } from './types'

export default function App() {
  const [sessions, setSessions] = useState<SessionItem[]>([])
  const [activeId, setActiveId] = useState<string>(() => newConversationId())
  const [messages, setMessages] = useState<ChatMessageType[]>([])
  const [input, setInput] = useState('')
  const [status, setStatus] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [streaming, setStreaming] = useState(false)
  const [stage, setStage] = useState('')
  const [hydrating, setHydrating] = useState(true)
  const [hydratingHistory, setHydratingHistory] = useState(false)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [immersive, setImmersive] = useState(false)

  const abortRef = useRef<AbortController | null>(null)
  const pendingRef = useRef('')
  const flushTimerRef = useRef<number | null>(null)
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const stickRef = useRef(true)
  const historySeq = useRef(0)

  const flushTokens = () => {
    const buffered = pendingRef.current
    if (!buffered) return
    pendingRef.current = ''
    setMessages((prev) => {
      if (prev.length === 0) return prev
      const lastIndex = prev.length - 1
      const last = prev[lastIndex]
      if (last.role !== 'assistant') return prev
      const copy = prev.slice()
      copy[lastIndex] = { ...last, content: last.content + buffered }
      return copy
    })
  }

  const scheduleFlush = () => {
    if (flushTimerRef.current !== null) return
    flushTimerRef.current = window.setTimeout(() => {
      flushTimerRef.current = null
      flushTokens()
    }, 60)
  }

  const refreshSessions = useCallback(async () => {
    try {
      const items = await listSessions()
      setSessions(items)
    } catch {
      // 会话列表刷新失败不影响当前对话
    }
  }, [])

  const loadHistory = useCallback(async (id: string) => {
    const seq = ++historySeq.current
    setHydratingHistory(true)
    try {
      const history = await getHistory(id)
      if (seq !== historySeq.current) return
      setMessages(history)
      stickRef.current = true
    } catch (err) {
      if (seq !== historySeq.current) return
      setError(err instanceof Error ? err.message : '历史会话加载失败，请重试。')
    } finally {
      if (seq === historySeq.current) setHydratingHistory(false)
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    const boot = async () => {
      try {
        const items = await listSessions()
        if (cancelled) return
        setSessions(items)
        if (items.length > 0) {
          setActiveId(items[0].id)
          await loadHistory(items[0].id)
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : '初始化失败，请刷新页面重试。')
        }
      } finally {
        if (!cancelled) setHydrating(false)
      }
    }
    void boot()
    return () => {
      cancelled = true
    }
  }, [loadHistory])

  useEffect(() => {
    if (!notice) return
    const timer = window.setTimeout(() => setNotice(''), 6000)
    return () => window.clearTimeout(timer)
  }, [notice])

  useEffect(() => {
    if (!stickRef.current) return
    const container = scrollRef.current
    if (!container) return
    container.scrollTop = container.scrollHeight
  }, [messages, streaming, hydratingHistory])

  useEffect(() => {
    return () => {
      if (flushTimerRef.current !== null) window.clearTimeout(flushTimerRef.current)
      abortRef.current?.abort()
    }
  }, [])

  const runStream = async (
    controller: AbortController,
    assistantId: string,
    useRetry: boolean,
    messageText?: string,
  ) => {
    setStreaming(true)
    setStatus(useRetry ? '正在从断点恢复' : '正在连接诡计工作台')
    stickRef.current = true
    const handlers = {
      onStatus: (label: string) => setStatus(label),
      onStage: (value: string) => {
        // 心跳事件的 waiting 不改变阶段高亮
        if (value && value !== 'waiting') setStage(value)
      },
      onToken: (delta: string) => {
        pendingRef.current += delta
        scheduleFlush()
      },
      onNotice: (msg: string) => setNotice(msg),
      onError: (msg: string) => setError(msg),
    }
    try {
      if (useRetry) {
        await streamRetry(activeId, handlers, controller.signal)
      } else {
        await streamChat(activeId, messageText ?? '', handlers, controller.signal)
      }
    } catch (err) {
      if (!controller.signal.aborted) {
        setError(err instanceof Error ? err.message : '网络异常，请稍后重试。')
      }
    } finally {
      if (flushTimerRef.current !== null) {
        window.clearTimeout(flushTimerRef.current)
        flushTimerRef.current = null
      }
      flushTokens()
      setMessages((prev) => prev.filter((item) => item.id !== assistantId || item.content.trim().length > 0))
      setStreaming(false)
      setStage('')
      setStatus('')
      abortRef.current = null
      void refreshSessions()
    }
  }

  const retryFromCheckpoint = async () => {
    if (streaming || hydrating) return
    setError('')
    setNotice('')
    const controller = new AbortController()
    abortRef.current = controller
    const assistantId = newConversationId()
    setMessages((prev) => [...prev, { id: assistantId, role: 'assistant', content: '' }])
    await runStream(controller, assistantId, true)
  }

  const send = async (raw?: string) => {
    const text = (raw ?? input).trim()
    if (!text || streaming || hydrating) return

    const userMessage: ChatMessageType = {
      id: newConversationId(),
      role: 'user',
      content: text,
    }
    const assistantId = newConversationId()

    setMessages((prev) => [
      ...prev,
      userMessage,
      { id: assistantId, role: 'assistant', content: '' },
    ])
    setInput('')
    setError('')
    setNotice('')

    const controller = new AbortController()
    abortRef.current = controller

    await runStream(controller, assistantId, false, text)
  }

  const startNewChat = () => {
    if (streaming) {
      setNotice('正在生成中，请先停止当前生成再新建会话。')
      return
    }
    historySeq.current += 1
    setActiveId(newConversationId())
    setMessages([])
    setInput('')
    setError('')
    setNotice('')
    setStatus('')
    setSidebarOpen(false)
    stickRef.current = true
  }

  const openSession = async (id: string) => {
    setSidebarOpen(false)
    if (id === activeId) return
    if (streaming) {
      setNotice('正在生成中，请先停止当前生成再切换会话。')
      return
    }
    setActiveId(id)
    setMessages([])
    setError('')
    setNotice('')
    setStatus('')
    await loadHistory(id)
  }

  const handleStop = () => {
    if (!streaming) return
    abortRef.current?.abort()
    void stopRun(activeId)
    setStatus('已停止')
    setStreaming(false)
  }

  const removeSession = async (id: string) => {
    if (streaming && id === activeId) {
      setNotice('请先停止生成，再删除当前会话。')
      return
    }
    if (!window.confirm('确定删除这个会话？删除后无法恢复。')) return
    try {
      await deleteSession(id)
      setSessions((prev) => prev.filter((item) => item.id !== id))
      if (id === activeId) {
        startNewChat()
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '删除会话失败，请重试。')
    }
  }

  const activeSession = sessions.find((item) => item.id === activeId)
  const headerTitle = activeSession?.title || (messages.length > 0 ? '新剧本' : '新对话')
  const loading = hydrating || hydratingHistory
  const hasPlan = messages.some((item) => item.role === 'assistant' && item.content.length > 200)

  return (
    <div className="app">
      <Sidebar
        sessions={sessions}
        activeId={activeId}
        open={sidebarOpen}
        onNew={startNewChat}
        onSelect={(id) => void openSession(id)}
        onDelete={(id) => void removeSession(id)}
        onClose={() => setSidebarOpen(false)}
      />

      {sidebarOpen && (
        <button className="scrim" onClick={() => setSidebarOpen(false)} aria-label="关闭会话列表" />
      )}

      <main className="main">
        <header className="topbar">
          <button className="icon-btn menu-btn" onClick={() => setSidebarOpen(true)} aria-label="打开会话列表">
            <MenuIcon />
          </button>
          <div className="topbar-title">
            <span className="eyebrow">TRICK STUDIO</span>
            <h1>{headerTitle}</h1>
          </div>
        <div className="topbar-actions">
          {hasPlan && !streaming && (
            <button className="immersive-btn" onClick={() => setImmersive(true)} disabled={loading}>
              🌙 沉浸模式
            </button>
          )}
          <div className={`status-pill ${streaming ? 'live' : ''}`}>
            <span className="dot" />
            {streaming ? status || '生成中' : loading ? '连接中' : '待命中'}
          </div>
        </div>
      </header>

      {immersive && hasPlan && (
        <ImmersiveView
          conversationId={activeId}
          fallbackMarkdown={
            [...messages].reverse().find((m) => m.role === 'assistant' && m.content.length > 200)?.content || ''
          }
          onClose={() => setImmersive(false)}
        />
      )}

        {streaming && <StageProgress stage={stage} />}

        <ExportBar conversationId={activeId} hasPlan={hasPlan && !streaming} disabled={loading} />

        {!streaming && !loading && (
          <RequirementBuilder
            onSend={(text) => void send(text)}
            hasPlan={messages.some((item) => item.role === 'assistant' && item.content.length > 200)}
            disabled={loading}
          />
        )}

        <div className="chat-scroll" ref={scrollRef} onScroll={() => {
          const container = scrollRef.current
          if (!container) return
          stickRef.current = container.scrollHeight - container.scrollTop - container.clientHeight < 140
        }}>
          <div className="chat-inner">
            {messages.length === 0 ? (
              loading ? (
                <div className="loading-state">
                  <span className="loader" />
                  正在载入创作台…
                </div>
              ) : (
                <Welcome onPick={(prompt) => void send(prompt)} />
              )
            ) : (
              messages.map((message, index) => (
                <ChatMessage
                  key={message.id}
                  message={message}
                  streaming={streaming && index === messages.length - 1}
                />
              ))
            )}
          </div>
        </div>

        {(error || notice) && (
          <div className="banners">
            {error && (
              <div className="banner banner-error">
                <span>{error}</span>
                {!streaming && !loading && (
                  <button className="banner-action" onClick={() => void retryFromCheckpoint()}>
                    从断点重试
                  </button>
                )}
                <button onClick={() => setError('')} aria-label="关闭错误提示">
                  关闭
                </button>
              </div>
            )}
            {notice && (
              <div className="banner banner-notice">
                <span>{notice}</span>
                <button onClick={() => setNotice('')} aria-label="关闭提示">
                  关闭
                </button>
              </div>
            )}
          </div>
        )}

        <Composer
          value={input}
          onChange={setInput}
          onSend={() => void send()}
          onStop={handleStop}
          streaming={streaming}
          disabled={loading}
        />
      </main>
    </div>
  )
}
