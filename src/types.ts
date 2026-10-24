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

export interface MetaPayload {
  title?: string
  genre?: string
  lock_score?: number | null
  source_count?: number
}

export interface DonePayload {
  conversationId?: string
  title?: string
  lockScore?: number | null
  sourceCount?: number
}

export interface StreamHandlers {
  onStatus?: (label: string) => void
  onToken?: (delta: string) => void
  onMeta?: (meta: MetaPayload) => void
  onNotice?: (message: string) => void
  onDone?: (data: DonePayload) => void
  onError?: (message: string) => void
}
