const STAGES = [
  { key: 'understand', label: '解析' },
  { key: 'research', label: '检索' },
  { key: 'design', label: '设计' },
  { key: 'extract', label: '提取' },
  { key: 'compose', label: '成稿' },
] as const

interface Props {
  stage: string
}

export default function StageProgress({ stage }: Props) {
  const activeIndex = STAGES.findIndex((item) => item.key === stage)

  return (
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
  )
}
