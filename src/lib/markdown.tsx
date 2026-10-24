import ReactMarkdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'

const components: Components = {
  a({ node: _node, ...props }) {
    return <a {...props} target="_blank" rel="noreferrer noopener" />
  },
  table({ node: _node, ...props }) {
    return (
      <div className="table-wrap">
        <table {...props} />
      </div>
    )
  },
  pre({ node: _node, ...props }) {
    return <pre className="code-block" {...props} />
  },
  code({ node: _node, className, children, ...props }) {
    return (
      <code className={className ? `code-inline ${className}` : 'code-inline'} {...props}>
        {children}
      </code>
    )
  },
}

export function Markdown({ content }: { content: string }) {
  return (
    <div className="markdown">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {content}
      </ReactMarkdown>
    </div>
  )
}
