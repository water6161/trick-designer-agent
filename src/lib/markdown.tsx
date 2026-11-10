import { memo } from 'react'
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

/**
 * 把 Markdown 按空行切成独立块。
 *
 * 流式生成时每 ~50ms 就有一批新 token：整篇交给一个 ReactMarkdown 重排，
 * 几千字的方案每次都要从第一行渲到最后一行。切成块后每块单独 memo——
 * 前面的块内容不变就原地复用，只有正在生长的最后一块在重渲。
 *
 * 围栏代码块（```）内部的空行是内容不是分界，切开了代码块会碎掉；
 * 所以按行扫，处于围栏内时空行不切。
 */
export function splitBlocks(md: string): string[] {
  const lines = md.replace(/\r\n/g, '\n').split('\n')
  const blocks: string[] = []
  let current: string[] = []
  let fence: string | null = null

  const flush = () => {
    if (current.length) {
      blocks.push(current.join('\n'))
      current = []
    }
  }

  for (const line of lines) {
    const fenceMatch = line.trim().match(/^(`{3,}|~{3,})/)
    if (fenceMatch) {
      if (!fence) {
        fence = fenceMatch[1]
      } else if (line.trim().startsWith(fence)) {
        fence = null
      }
      current.push(line)
      continue
    }
    // 围栏内的空行是代码内容；围栏外的空行才是块分界
    if (!fence && !line.trim()) {
      flush()
      continue
    }
    current.push(line)
  }
  flush()
  return blocks
}

/** 单块渲染：内容字符串不变就不重渲（字符串是原始值，浅比较即命中）。 */
const MarkdownBlock = memo(function MarkdownBlock({ text }: { text: string }) {
  return (
    <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
      {text}
    </ReactMarkdown>
  )
})

export const Markdown = memo(function Markdown({ content }: { content: string }) {
  return (
    <div className="markdown">
      {splitBlocks(content).map((block, index) => (
        // 块只追加、永不重排，index 作 key 是稳定的
        <MarkdownBlock key={index} text={block} />
      ))}
    </div>
  )
})
