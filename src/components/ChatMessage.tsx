import { Markdown } from '../lib/markdown'
import type { Annotation } from '../lib/annotations'
import type { ChatMessage as ChatMessageType } from '../types'

interface Props {
  message: ChatMessageType
  streaming?: boolean
  /** 挂在这条消息下的本地批注 */
  annotations?: Annotation[]
  onRemoveNote?: (id: string) => void
}

export default function ChatMessage({ message, streaming = false, annotations, onRemoveNote }: Props) {
  const isUser = message.role === 'user'

  const notes =
    annotations && annotations.length > 0 ? (
      <div className="msg-annotations">
        {annotations.map((item) => (
          <div className="annot-item" key={item.id}>
            <div className="annot-body">
              <p className="annot-quote">❝ {item.quote} ❞</p>
              <p className="annot-note">{item.note}</p>
            </div>
            {onRemoveNote && (
              <button
                className="annot-del"
                onClick={() => onRemoveNote(item.id)}
                aria-label="删除批注"
                title="删除这条批注"
              >
                ✕
              </button>
            )}
          </div>
        ))}
      </div>
    ) : null

  if (isUser) {
    return (
      <div className="msg msg-user" data-mid={message.id}>
        <div className="bubble bubble-user">{message.content}</div>
        {notes}
      </div>
    )
  }

  const empty = !message.content.trim()

  return (
    <div className="msg msg-assistant" data-mid={message.id}>
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
        {notes}
      </div>
    </div>
  )
}
