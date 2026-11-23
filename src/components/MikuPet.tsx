import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { createMikuStage, readMikuPetState, writeMikuPetState } from '../lib/miku'

/** 收起态的顶栏入口按钮（SSR 也渲染这个） */
function EntryButton({ onOpen }: { onOpen: () => void }) {
  return (
    <button
      className="immersive-btn miku-btn"
      onClick={onOpen}
      title="初音未来桌宠：眨眼待机、视线跟着鼠标走，点击换动作"
      aria-pressed={false}
    >
      ♪ <span className="btn-label">初音</span>
    </button>
  )
}

/**
 * 初音未来桌宠：默认收起，点「♪」展开。
 * 渲染失败不吵不闹——收起并提示，绝不影响主流程。
 *
 * 性能关键：舞台只创建一次。收起只是 CSS 隐藏面板（模型常驻内存），
 * 再展开瞬时可见——收起→展开不重新下载 465KB 模型包。
 * 只有组件卸载（刷新页面）才真正销毁。
 */
export default function MikuPet() {
  const [open, setOpen] = useState(() => readMikuPetState() === 'open')
  const [started, setStarted] = useState(open)
  const [retry, setRetry] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const disposeRef = useRef<(() => void) | null>(null)

  useEffect(() => {
    // 已创建过（或正在创建）就不重来：disposeRef 在成功后置位，
    // 失败时保持 null，retry 递增后重试
    if (!started || disposeRef.current) return
    let cancelled = false
    setLoading(true)
    setError('')
    createMikuStage(canvasRef.current!)
      .then((stage) => {
        if (cancelled) {
          stage.dispose()
          return
        }
        disposeRef.current = () => stage.dispose()
      })
      .catch((err: unknown) => {
        if (cancelled) return
        console.error('[miku] 桌宠加载失败:', err)
        setError(err instanceof Error ? err.message : '桌宠加载失败')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [started, retry])

  // 组件卸载（页面刷新/关闭）才真正销毁舞台
  useEffect(() => () => disposeRef.current?.(), [])

  const toggle = (next: boolean) => {
    setOpen(next)
    if (next) {
      if (error) setRetry((n) => n + 1) // 上次失败：重新发起加载
      setStarted(true)
    }
    writeMikuPetState(next ? 'open' : 'closed')
  }

  // SSR（无 document）不支持 portal：只渲染入口按钮
  if (typeof document === 'undefined') {
    return <EntryButton onOpen={() => toggle(true)} />
  }

  // 面板常驻 DOM（收起时 is-hidden 隐藏），canvas 与模型因此不会反复重建；
  // 收起时同时渲染顶栏入口按钮
  return (
    <>
      {!open && <EntryButton onOpen={() => toggle(true)} />}
      {createPortal(
        <div
          className={`miku-pet ${open ? '' : 'is-hidden'}`}
          role="complementary"
          aria-label="初音未来桌宠"
          aria-hidden={!open}
        >
          <canvas ref={canvasRef} className="miku-canvas" width={260} height={340} />
          <div className="miku-meta">
            <span className="miku-tip" title={error ? '收起后再点「♪ 初音」可重试' : undefined}>
              {error ? `${error} · 收起后重试` : loading ? '初音登场中…' : '点我换动作 · 双马尾会甩'}
            </span>
            <button
              className="miku-close"
              onClick={() => toggle(false)}
              title="收起桌宠（下次秒开）"
              aria-label="收起初音桌宠"
            >
              ×
            </button>
          </div>
        </div>,
        document.body,
      )}
    </>
  )
}

