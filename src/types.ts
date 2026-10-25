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

export interface PlanData {
  title?: string
  clues_public?: ClueData[]
  clues_deep?: ClueData[]
  [key: string]: unknown
}

export interface MetaPayload {
  title?: string
  genre?: string
  lock_score?: number | null
  source_count?: number
  brief?: PlanBrief
  plan?: PlanData | null
}

export interface DonePayload {
  conversationId?: string
  title?: string
  lockScore?: number | null
  sourceCount?: number
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
