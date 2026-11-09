import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import ChatMessage from './components/ChatMessage'
import Composer from './components/Composer'
import ExportBar from './components/ExportBar'
import RequirementBuilder from './components/RequirementBuilder'
import Sidebar from './components/Sidebar'
import StageProgress from './components/StageProgress'
import Welcome from './components/Welcome'
import QualityCard from './components/QualityCard'
import RulesCard from './components/RulesCard'
import { MenuIcon } from './components/icons'

/**
 * 弹层类组件全部按需加载：它们要等用户点开才出现，却会把首屏包撑大。
 * 首屏只保留「打开就要看见」的部分（对话、输入框、侧栏、质检卡）。
 */
const ImmersiveView = lazy(() => import('./components/ImmersiveView'))
const TimelineView = lazy(() => import('./components/TimelineView'))
const DMView = lazy(() => import('./components/DMView'))
const RescuePanel = lazy(() => import('./components/RescuePanel'))
const RoleCards = lazy(() => import('./components/RoleCards'))
const VersionHistory = lazy(() => import('./components/VersionHistory'))
const StatsPanel = lazy(() => import('./components/StatsPanel'))
const PlayerView = lazy(() => import('./components/PlayerView'))
const Shelf = lazy(() => import('./components/Shelf'))

/** 弹层加载期间的占位：不遮罩、不闪屏，加载完成后直接出现 */
function PanelFallback() {
  return (
    <div className="panel-boot" role="status" aria-live="polite">
      <span className="loader" />
    </div>
  )
}
import { useOnline } from './hooks/useOnline'
import {
  deleteSession,
  getHistory,
  listSessions,
  newConversationId,
  stopRun,
  streamChat,
  streamRetry,
  StreamFailureError,
} from './lib/api'
import { humanizeError, reconnectDelay, sleep } from './lib/net'
import { readDraft, saveDraft } from './lib/draft'
import {
  exhaustedNotice,
  reconnectStatusText,
  resumeMode,
  shouldAutoReconnect,
} from './lib/streamPolicy'
import { listShelf, removeFromShelf, saveToShelf, planTitle, type ShelfItem } from './lib/shelf'
import { decodePacket, hasShareToken, readShareToken, type PlayerPacket } from './lib/share'
import { parsePlanFromMarkdown } from './lib/parsePlan'
import type {
  ChatMessage as ChatMessageType,
  DonePayload,
  MetaPayload,
  PlanData,
  PlanRules,
  QualityScore,
  SessionItem,
} from './types'

function fmtMs(value?: number): string {
  if (!value) return '—'
  return value >= 1000 ? `${(value / 1000).toFixed(1)}s` : `${value}ms`
}

function MainApp() {
  const [sessions, setSessions] = useState<SessionItem[]>([])
  const [activeId, setActiveId] = useState<string>(() => newConversationId())
  const [messages, setMessages] = useState<ChatMessageType[]>([])
  // 顺手把上次没写完的需求捞回来：误刷新 / 误关标签不用重写
  const [input, setInput] = useState(() => readDraft())
  const [status, setStatus] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [streaming, setStreaming] = useState(false)
  const [stage, setStage] = useState('')
  const [hydrating, setHydrating] = useState(true)
  const [hydratingHistory, setHydratingHistory] = useState(false)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  // 只用于提示，不拦截请求：navigator.onLine 只说明有没有网络接口，不代表后端可达
  const online = useOnline()
  const [immersive, setImmersive] = useState(false)
  const [shelfOpen, setShelfOpen] = useState(false)
  const [shelfItems, setShelfItems] = useState<ShelfItem[]>(() => listShelf())
  const [showTimeline, setShowTimeline] = useState(false)
  const [showDM, setShowDM] = useState(false)
  const [showRoles, setShowRoles] = useState(false)
  const [showRescue, setShowRescue] = useState(false)
  const [showVersions, setShowVersions] = useState(false)
  const [toolsOpen, setToolsOpen] = useState(false)
  const [quality, setQuality] = useState<QualityScore | null>(null)
  const [rules, setRules] = useState<PlanRules | null>(null)
  const [showStats, setShowStats] = useState(false)
  const [lastRun, setLastRun] = useState<DonePayload | null>(null)
  const [showPlayer, setShowPlayer] = useState(false)
  const [latestPlan, setLatestPlan] = useState<PlanData | null>(null)

  const abortRef = useRef<AbortController | null>(null)
  const pendingRef = useRef('')
  const flushTimerRef = useRef<number | null>(null)
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const stickRef = useRef(true)
  const historySeq = useRef(0)
  const lastAssistantLenRef = useRef(0)

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
      lastAssistantLenRef.current = copy[lastIndex].content.length
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
      setQuality(null)
      setRules(null)
      setLatestPlan(null)
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

  // 点击下拉外部时关闭工具菜单
  useEffect(() => {
    if (!toolsOpen) return
    const onDoc = (e: MouseEvent) => {
      const target = e.target as HTMLElement
      if (!target.closest('.tools-menu')) setToolsOpen(false)
    }
    document.addEventListener('click', onDoc)
    return () => document.removeEventListener('click', onDoc)
  }, [toolsOpen])

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
    // 是否已收到 done：决定「流结束但没 done」是断流还是正常收尾
    let gotDone = false
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
      onMeta: (meta: MetaPayload) => {
        setQuality(meta.quality ?? null)
        setRules(meta.rules ?? null)
        // 结构化方案优先；缺失时下面会用 Markdown 兜底解析
        setLatestPlan(meta.plan ?? null)
      },
      onDone: (data: DonePayload) => {
        gotDone = true
        setLastRun(data)
      },
      onError: (msg: string) => setError(msg),
    }

    let retryMode = useRetry
    let attempts = 0

    try {
      for (;;) {
        try {
          if (retryMode) {
            await streamRetry(activeId, handlers, controller.signal)
          } else {
            await streamChat(activeId, messageText ?? '', handlers, controller.signal)
          }
          break
        } catch (err) {
          if (controller.signal.aborted) break

          const failure =
            err instanceof StreamFailureError
              ? { kind: err.kind, phase: err.phase, message: err.message }
              : null
          // 未 flush 的增量也要算进进度，否则「刚吐了几个字就断」会被误判成没内容
          const progress = {
            chars: lastAssistantLenRef.current + pendingRef.current.length,
            done: gotDone,
          }

          if (failure && shouldAutoReconnect(failure, progress, attempts)) {
            attempts += 1
            setStatus(reconnectStatusText(attempts))
            setNotice(
              failure.phase === 'connect'
                ? `连接没建立起来，正在自动重试（第 ${attempts} 次）…`
                : `生成刚起步就断了，正在从断点续跑（第 ${attempts} 次）…`,
            )
            await sleep(reconnectDelay(attempts), controller.signal)
            if (controller.signal.aborted) break
            // 连接阶段失败可以原样重发；流阶段失败改走断点续跑，避免重复消耗已完成的阶段
            retryMode = resumeMode(failure) === 'retry'
            continue
          }

          // 正文已基本生成完整时，收尾阶段的断流降级为提示而非报错——内容没丢，导出/沉浸都可用
          if (lastAssistantLenRef.current > 1500) {
            setNotice(
              attempts > 0
                ? exhaustedNotice(attempts)
                : '方案主体已生成完毕，收尾连接中断。导出与沉浸模式已可用；如需线索卡数据，可点「从断点重试」补跑收尾。',
            )
          } else {
            const message = humanizeError(err)
            setError(attempts > 0 ? `${message}（已自动重连 ${attempts} 次）` : message)
          }
          break
        }
      }
    } finally {
      if (flushTimerRef.current !== null) {
        window.clearTimeout(flushTimerRef.current)
        flushTimerRef.current = null
      }
      flushTokens()
      // 生成结束后自动把完整方案存入本地书架
      setMessages((prev) => {
        const filtered = prev.filter((item) => item.id !== assistantId || item.content.trim().length > 0)
        const last = [...filtered].reverse().find((m) => m.role === 'assistant' && m.content.length > 500)
        if (last) {
          try {
            saveToShelf({ id: activeId, title: planTitle(last.content), markdown: last.content, savedAt: Date.now() })
            setShelfItems(listShelf())
          } catch {
            // 书架写入失败不影响主流程
          }
        }
        return filtered
      })
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
    setQuality(null)
    setRules(null)
    setLatestPlan(null)
    setLastRun(null)
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

  // 草稿落盘：input 每次变化都存；发送后 setInput('') 会自动把草稿删掉
  useEffect(() => {
    saveDraft(input)
  }, [input])

  // Esc 的两层语义：有弹层时关弹层（键盘用户不必 Tab 到角落找关闭按钮），
  // 没弹层但正在生成时 = 停止生成（一次等三分钟，想中途叫停不该只能去点按钮）
  const anyPanelOpen =
    immersive || shelfOpen || showTimeline || showDM || showRoles || showRescue || showVersions || showStats || showPlayer
  useEffect(() => {
    if (!anyPanelOpen && !streaming) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      if (anyPanelOpen) {
        setImmersive(false)
        setShelfOpen(false)
        setShowTimeline(false)
        setShowDM(false)
        setShowRoles(false)
        setShowRescue(false)
        setShowVersions(false)
        setShowStats(false)
        setShowPlayer(false)
        return
      }
      if (streaming) {
        abortRef.current?.abort()
        void stopRun(activeId)
        setStatus('已停止')
        setStreaming(false)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [anyPanelOpen, streaming, activeId])

  // 生成中关页面/刷新等于白等，给浏览器一次确认机会
  useEffect(() => {
    if (!streaming) return
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [streaming])

  // 标签页标题跟随当前剧本：同时开几个会话时才分得清谁是谁
  useEffect(() => {
    document.title =
      messages.length > 0 ? `${headerTitle} · 诡计工作台` : '诡计工作台 · 剧本杀诡计设计'
  }, [headerTitle, messages.length])
  const loading = hydrating || hydratingHistory
  // 流式生成时 token 每秒 flush 十几次，这两个派生值若每帧重算就是 O(n²)：
  // 遍历全部消息 + 复制数组反转。用 useMemo 挂在 messages 上，只在消息真正变化时重算。
  const { hasPlan, latestMarkdown } = useMemo(() => {
    // 从后往前找第一条长回复：既拿到最新方案正文，也顺带判定是否已有方案
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      const item = messages[i]
      if (item.role !== 'assistant' || item.content.length <= 200) continue
      return { hasPlan: true, latestMarkdown: item.content }
    }
    return { hasPlan: false, latestMarkdown: '' }
  }, [messages])

  // 玩家本的数据源：结构化方案优先，extract 失败时用 Markdown 兜底解析
  const playerPlan = useMemo<PlanData | null>(() => {
    if (latestPlan) return latestPlan
    return latestMarkdown ? parsePlanFromMarkdown(latestMarkdown) : null
  }, [latestPlan, latestMarkdown])

  return (
    <div className="app">
      {/* 键盘用户跳过侧栏和工具条，直接进入对话区；鼠标用户看不见它 */}
      <a className="skip-link" href="#main-content">
        跳到主内容
      </a>

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

      <main className="main" id="main-content" tabIndex={-1}>
        {!online && (
          <div className="offline-bar" role="status" aria-live="polite">
            <span className="offline-dot" />
            网络已断开——生成会暂停，恢复后自动继续；已写好的内容不会丢。
          </div>
        )}
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
            <>
              <button className="immersive-btn" onClick={() => setImmersive(true)} disabled={loading}>
                🌙 沉浸模式
              </button>
              <div className="tools-menu">
                <button className="immersive-btn" onClick={() => setToolsOpen((v) => !v)}>
                  🛠 工具 {toolsOpen ? '▴' : '▾'}
                </button>
                {toolsOpen && (
                  <div className="tools-dropdown">
                    <button onClick={() => { setToolsOpen(false); setShowDM(true) }}>🎭 DM 主持台</button>
                    <button onClick={() => { setToolsOpen(false); setShowTimeline(true) }}>🔗 证据链时间线</button>
                    <button onClick={() => { setToolsOpen(false); setShowRoles(true) }}>🃏 角色速览卡</button>
                    <button onClick={() => { setToolsOpen(false); setShowRescue(true) }}>🆘 救场手册</button>
                    <button onClick={() => { setToolsOpen(false); setShowVersions(true) }}>🕰 版本历史</button>
                    <button onClick={() => { setToolsOpen(false); setShowPlayer(true) }}>📖 玩家本（无剧透）</button>
                  </div>
                )}
              </div>
            </>
          )}
          <button
            className="immersive-btn stats-btn"
            onClick={() => setShowStats(true)}
            title="运行指标：耗时分布与失败原因"
          >
            📊
          </button>
          <button className="immersive-btn shelf-btn" onClick={() => { setShelfItems(listShelf()); setShelfOpen(true) }}>
            📚 案卷
          </button>
          {/* 阶段变化播报给屏幕阅读器：看不到进度条的人也需要知道"现在到哪一步了" */}
          <div className={`status-pill ${streaming ? 'live' : ''}`} role="status" aria-live="polite">
            <span className="dot" />
            {streaming ? status || '生成中' : loading ? '连接中' : '待命中'}
          </div>
        </div>
      </header>

      {immersive && hasPlan && (
        <Suspense fallback={<PanelFallback />}>
          <ImmersiveView
            conversationId={activeId}
            fallbackMarkdown={latestMarkdown}
            onClose={() => setImmersive(false)}
          />
        </Suspense>
      )}

      {showTimeline && hasPlan && (
        <Suspense fallback={<PanelFallback />}>
          <TimelineView markdown={latestMarkdown} onClose={() => setShowTimeline(false)} />
        </Suspense>
      )}

      {showDM && hasPlan && (
        <Suspense fallback={<PanelFallback />}>
          <DMView markdown={latestMarkdown} onClose={() => setShowDM(false)} />
        </Suspense>
      )}

      {showRescue && hasPlan && (
        <Suspense fallback={<PanelFallback />}>
          <RescuePanel markdown={latestMarkdown} onClose={() => setShowRescue(false)} />
        </Suspense>
      )}

      {showVersions && hasPlan && (
        <Suspense fallback={<PanelFallback />}>
          <VersionHistory
            conversationId={activeId}
            currentMarkdown={latestMarkdown}
            onClose={() => setShowVersions(false)}
            onRestored={(markdown, title) => {
              setMessages((prev) => [
                ...prev,
                { id: newConversationId(), role: 'assistant', content: markdown, createdAt: new Date().toISOString() },
              ])
              setNotice(`已回退到「${title}」，后续修改会基于这一版进行。`)
            }}
          />
        </Suspense>
      )}

      {showRoles && hasPlan && (
        <Suspense fallback={<PanelFallback />}>
          <RoleCards markdown={latestMarkdown} onClose={() => setShowRoles(false)} />
        </Suspense>
      )}

      {showPlayer && hasPlan && (
        <Suspense fallback={<PanelFallback />}>
          <PlayerView plan={playerPlan} onClose={() => setShowPlayer(false)} />
        </Suspense>
      )}

      {showStats && (
        <Suspense fallback={<PanelFallback />}>
          <StatsPanel conversationId={activeId} onClose={() => setShowStats(false)} />
        </Suspense>
      )}

      {shelfOpen && (
        <Suspense fallback={<PanelFallback />}>
          <Shelf
            items={shelfItems}
            onClose={() => setShelfOpen(false)}
            onDelete={(id) => {
              removeFromShelf(id)
              setShelfItems(listShelf())
            }}
          />
        </Suspense>
      )}

      {hasPlan && !streaming && !immersive && (
        <button
          className="immersive-fab"
          onClick={() => setImmersive(true)}
          disabled={loading}
          aria-label="进入沉浸模式"
        >
          🌙 沉浸模式
        </button>
      )}

        {streaming && <StageProgress stage={stage} />}

        <ExportBar conversationId={activeId} hasPlan={hasPlan && !streaming} disabled={loading} />

        {!streaming && !loading && (
          <RequirementBuilder
            onSend={(text) => void send(text)}
            hasPlan={hasPlan}
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
              <>
                {messages.map((message, index) => (
                  <ChatMessage
                    key={message.id}
                    message={message}
                    streaming={streaming && index === messages.length - 1}
                  />
                ))}
                {quality && !streaming && <QualityCard score={quality} />}
                {rules && !streaming && (
                  <RulesCard
                    rules={rules}
                    onFix={() => void send('按硬规则校验发现的逻辑缺口补齐线索，只重写第二部分，其余章节保持不变')}
                  />
                )}
                {lastRun && !streaming && (lastRun.durationMs || lastRun.traceId) && (
                  <div className="run-meta">
                    <span>本次生成 {fmtMs(lastRun.durationMs)}</span>
                    {lastRun.firstTokenMs ? <span>首字 {fmtMs(lastRun.firstTokenMs)}</span> : null}
                    {lastRun.traceId && <span className="run-meta-trace">trace {lastRun.traceId}</span>}
                  </div>
                )}
              </>
            )}
          </div>
        </div>

        {(error || notice) && (
          <div className="banners">
            {error && (
              <div className="banner banner-error" role="alert">
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
              <div className="banner banner-notice" role="status" aria-live="polite">
                <span>{notice}</span>
                {!streaming && !loading && (
                  <button className="banner-action" onClick={() => void retryFromCheckpoint()}>
                    从断点重试
                  </button>
                )}
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

/**
 * 入口分流：`#/s/<token>` 是分享链接，直接进玩家本只读页；其余情况照常进创作台。
 * 分成两个组件而不是在 App 里 early return，是为了让 hooks 顺序与路由无关。
 */
export default function App() {
  const initialHash = useRef(typeof location !== 'undefined' ? location.hash : '')
  const shared = useRef(hasShareToken(initialHash.current))
  const [packet, setPacket] = useState<PlayerPacket | null>(null)
  const [ready, setReady] = useState(() => !shared.current)

  useEffect(() => {
    if (!shared.current) return
    void (async () => {
      const token = readShareToken(initialHash.current)
      setPacket(await decodePacket(token))
      setReady(true)
    })()
  }, [])

  // 分享页也带上标题：截图、收藏、历史记录里都能看出是哪一局
  useEffect(() => {
    if (!shared.current) return
    document.title = packet?.title ? `${packet.title} · 玩家本` : '玩家本 · 诡计工作台'
  }, [packet])

  if (!ready) {
    return (
      <div className="share-boot">
        <span className="loader" />
        <p>正在打开分享的剧本…</p>
      </div>
    )
  }

  if (shared.current) {
    if (packet) {
      return (
        <Suspense fallback={<PanelFallback />}>
          <PlayerView packet={packet} />
        </Suspense>
      )
    }
    return (
      <div className="share-boot">
        <p className="share-boot-title">这个链接打不开了</p>
        <p className="share-boot-hint">
          分享内容整段编码在链接里，被聊天软件截断或改写都会导致无法还原。请让分享者重新生成一次。
        </p>
        <a className="pv-home" href="./">去创作台</a>
      </div>
    )
  }

  return <MainApp />
}
