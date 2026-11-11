import { useEffect, useState } from 'react'

import { estimateRun, formatDuration } from '../lib/eta'

const STAGES = [
  { key: 'understand', label: '解析' },
  { key: 'research', label: '检索' },
  { key: 'design', label: '设计' },
  { key: 'extract', label: '提取' },
  { key: 'compose', label: '成稿' },
] as const

/** 阶段说明：告诉用户「现在具体在干嘛」，比只高亮一个点更让人安心 */
const HINTS: Record<string, string> = {
  '': '正在连接模型…',
  understand: '解析题材与约束',
  research: '检索同类套路，避免撞梗',
  design: '正在写正文，这一步最久，会持续出字',
  extract: '整理线索与时间线结构',
  score: '做质量体检打分',
  compose: '组装成稿',
}

interface Props {
  stage: string
  /** 本次生成开始的时间戳（毫秒） */
  startedAt: number
  /** 是否极速模式：决定耗时基准 */
  speed: boolean
}

export default function StageProgress({ stage, startedAt, speed }: Props) {
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [])

  const activeIndex = STAGES.findIndex((item) => item.key === stage)
  const elapsed = Math.max(0, (now - startedAt) / 1000)
  const eta = estimateRun(stage, elapsed, speed)
  const clock = eta.slow
    ? `已用 ${formatDuration(eta.elapsedSec)} · 比预计慢，仍在生成中`
    : `已用 ${formatDuration(eta.elapsedSec)} · 预计还需 ${formatDuration(eta.remainingSec)}`

  return (
    <div className="stage-progress-wrap">
      <div className="stage-progress" role="status">
        {STAGES.map((item, index) => {
          const state = index < activeIndex ? 'done' : index === activeIndex ? 'active' : 'todo'
          return (
            <div key={item.key} className={`stage ${state}`}>
              <span className="stage-dot" />
              <span className="stage-label">{item.label}</span>
              {index < STAGES.length - 1 && <span className="stage-line" />}
            </div>
          )
        })}
      </div>
      <div className="stage-meta-line" aria-live="polite">
        <span className="stage-hint">{HINTS[stage] ?? HINTS['']}</span>
        <span className="stage-meta" data-slow={eta.slow ? 'true' : 'false'}>
          {clock}
        </span>
      </div>
    </div>
  )
}
