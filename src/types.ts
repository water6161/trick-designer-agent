export type Role = 'user' | 'assistant'

export interface ChatMessage {
  id: string
  role: Role
  content: string
  createdAt?: string | null
}

export interface SessionItem {
  id: string
  title: string
  updatedAt?: string | null
}

/** 方案版本快照（来自 checkpointer 的历史 checkpoint，不额外存储） */
export interface PlanVersion {
  checkpointId: string
  createdAt?: string | null
  chars: number
  title: string
  hasPlaceholder: boolean
  next: string[]
}

export interface PlanBrief {
  genre?: string
  players?: string
  difficulty?: string
}

export interface ClueData {
  id?: string
  name?: string
  content?: string
  access?: string
  points_to?: string
  why_fair?: string
}

export interface TimelineEvent {
  time?: string
  event?: string
  witness?: string
  visibility?: string
}

export interface PlanCharacter {
  name?: string
  identity?: string
  secret?: string
  suspicion?: string
}

export interface PlanEnding {
  name?: string
  condition?: string
  clues?: string
  outcome?: string
}

export interface PlanData {
  title?: string
  clues_public?: ClueData[]
  clues_deep?: ClueData[]
  characters?: PlanCharacter[]
  timeline?: TimelineEvent[]
  culprit?: { character?: string; motive?: string } | null
  hidden_ending?: { scene?: string; ending?: string } | null
  /** 分支结局：1 条真结局 + 1~2 条走向分支；每条的 clues 引用线索编号（C1/D2） */
  endings?: PlanEnding[] | null
  [key: string]: unknown
}

export interface QualityScore {
  clue_fairness?: number
  lock_closure?: number
  timeline_coherence?: number
  red_herring_quality?: number
  total?: number
  ready?: boolean
  issues?: string[]
  fix_hints?: string[]
}

export interface MetaPayload {
  title?: string
  genre?: string
  lock_score?: number | null
  quality?: QualityScore | null
  source_count?: number
  brief?: PlanBrief
  plan?: PlanData | null
  /** 硬规则校验结果（fairness / trickGraph / difficulty），失败或极速模式下为空 */
  rules?: PlanRules | null
}

export interface DonePayload {
  conversationId?: string
  title?: string
  lockScore?: number | null
  sourceCount?: number
  /** 本次请求的跟踪标识与耗时（后端 telemetry 记录的同一条数据） */
  traceId?: string
  durationMs?: number
  firstTokenMs?: number
  stages?: Record<string, number>
}

export interface StreamHandlers {
  onStatus?: (label: string) => void
  onStage?: (stage: string) => void
  onToken?: (delta: string) => void
  onMeta?: (meta: MetaPayload) => void
  onNotice?: (message: string) => void
  onDone?: (data: DonePayload) => void
  onError?: (message: string) => void
}

// ── 硬规则校验（后端 verify 节点产出，纯规则计算，不含模型判断）──

export type RuleStatus = 'pass' | 'partial' | 'fail'

export interface RuleCheck {
  code: string
  label: string
  level: 'error' | 'warn'
  weight: number
  ratio: number
  status: RuleStatus
  detail: string
}

export interface FairnessReport {
  score: number
  passed: boolean
  ready: boolean
  checks: RuleCheck[]
  blockers: string[]
  stats: {
    clues: number
    public: number
    deep: number
    characters: number
    timeline: number
    steps: number
  }
}

export interface TrickCondition {
  key: string
  label: string
  matched: string[]
  satisfied: boolean
  sources: number
  inTrick: boolean
  advisory: boolean
}

export interface TrickGap {
  key: string
  label: string
  hint: string
}

export interface TrickGraph {
  category: string
  conditions: TrickCondition[]
  coverage: number
  gaps: TrickGap[]
  advisories: TrickGap[]
  verdict: string
}

export interface DifficultyReport {
  score: number
  tier: string
  tierNote: string
  minutes: { min: number; max: number; label: string }
  players: string
  factors: Array<{ label: string; value: string; points: number }>
  note: string
}

export interface PlanRules {
  fairness?: FairnessReport
  trickGraph?: TrickGraph
  difficulty?: DifficultyReport
}

/** 运行指标（后端进程内最近 200 条 trace 的聚合） */
export interface StatsSnapshot {
  total: number
  ok: number
  failed: number
  successRate: number | null
  latency: { p50: number; p95: number; avg: number }
  firstToken: { p50: number; p95: number }
  stages: Array<{ stage: string; avgMs: number; p95Ms: number; samples: number }>
  tokens: { estIn: number; estOut: number; estCostCny: number }
  errors: Array<{ message: string; count: number }>
  /** 硬规则失败排行：哪种结构问题最常出现 */
  ruleFailures: Array<{ code: string; label: string; count: number }>
  recent: Array<{
    traceId: string
    action: string
    at: string
    durationMs: number
    firstTokenMs: number
    events: number
    ok: boolean
    error: string
  }>
  capacity: number
}
