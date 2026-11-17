import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { createMikuStage, readMikuPetState, writeMikuPetState } from '../lib/miku'

/**
 * 初音未来桌宠：默认收起，点「♪」展开。
 * 渲染失败不吵不闹——收起并提示，绝不影响主流程。
 */
export default function MikuPet() {
  const [open, setOpen] = useState(() => readMikuPetState() === 'open')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const disposeRef = useRef<(() => void) | null>(null)

  useEffect(() => {
    if (!open) return
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
        setOpen(false)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
      disposeRef.current?.()
      disposeRef.current = null
    }
  }, [open])

  const toggle = (next: boolean) => {
    setOpen(next)
    writeMikuPetState(next ? 'open' : 'closed')
  }

  if (!open) {
    return (
      <button
        className="immersive-btn miku-btn"
        onClick={() => toggle(true)}
        title="初音未来桌宠：眨眼待机、视线跟着鼠标走，点击换动作"
        aria-pressed={false}
      >
        ♪ <span className="btn-label">初音</span>
      </button>
    )
  }

  // 面板必须挂到 body：topbar 的 backdrop-filter 会劫持 fixed 定位基准，
  // 让面板"相对顶栏"定位跑到视口外（同工具菜单层级问题的根因）
  return createPortal(
    <div className="miku-pet" role="complementary" aria-label="初音未来桌宠">
      <canvas ref={canvasRef} className="miku-canvas" width={260} height={340} />
      <div className="miku-meta">
        <span className="miku-tip">{loading ? '初音登场中…' : error ? error : '点我换动作 · 双马尾会甩'}</span>
        <button
          className="miku-close"
          onClick={() => toggle(false)}
          title="收起桌宠"
          aria-label="收起初音桌宠"
        >
          ×
        </button>
      </div>
    </div>,
    document.body,
  )
}
