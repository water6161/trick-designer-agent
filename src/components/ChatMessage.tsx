import { Markdown } from '../lib/markdown'
import type { ChatMessage as ChatMessageType } from '../types'

interface Props {
  message: ChatMessageType
  streaming?: boolean
}

export default function ChatMessage({ message, streaming = false }: Props) {
  const isUser = message.role === 'user'

  if (isUser) {
    return (
      <div className="msg msg-user">
        <div className="bubble bubble-user">{message.content}</div>
      </div>
    )
  }

  const empty = !message.content.trim()

  return (
    <div className="msg msg-assistant">
      <div className="avatar" aria-hidden="true">
        诡
      </div>
      <div className="assistant-body">
        {empty && streaming ? (
          <div className="typing" aria-label="正在生成">
            <span />
            <span />
            <span />
          </div>
        ) : (
          <>
            <Markdown content={message.content} />
            {streaming && <span className="caret" aria-hidden="true" />}
          </>
        )}
      </div>
    </div>
  )
}
