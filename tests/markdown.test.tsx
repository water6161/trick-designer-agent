import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { Markdown, splitBlocks } from '../src/lib/markdown'

describe('splitBlocks 切块', () => {
  it('普通段落按空行切分', () => {
    expect(splitBlocks('第一段\n\n第二段\n\n第三段')).toEqual(['第一段', '第二段', '第三段'])
  })

  it('围栏代码块内的空行是内容，不能切', () => {
    const md = '前面\n\n```python\ndef a():\n\n    return 1\n\n```\n\n后面'
    expect(splitBlocks(md)).toEqual(['前面', '```python\ndef a():\n\n    return 1\n\n```', '后面'])
  })

  it('波浪线围栏同样保护', () => {
    const md = 'a\n\n~~~\nx\n\ny\n~~~\n\nb'
    expect(splitBlocks(md)).toEqual(['a', '~~~\nx\n\ny\n~~~', 'b'])
  })

  it('表格与列表整块保留', () => {
    const md = '| a | b |\n| --- | --- |\n| 1 | 2 |\n\n- 甲\n- 乙'
    expect(splitBlocks(md)).toEqual(['| a | b |\n| --- | --- |\n| 1 | 2 |', '- 甲\n- 乙'])
  })

  it('连续空行、首尾空行不产生空块', () => {
    expect(splitBlocks('\n\na\n\n\n\nb\n\n')).toEqual(['a', 'b'])
  })

  it('空输入返回空数组，不抛错', () => {
    expect(splitBlocks('')).toEqual([])
    expect(splitBlocks('\n')).toEqual([])
  })

  it('未闭合的围栏也不崩，剩余内容归入同块', () => {
    expect(splitBlocks('a\n\n```\n未闭合')).toEqual(['a', '```\n未闭合'])
  })

  it('CRLF 统一处理', () => {
    expect(splitBlocks('a\r\n\r\nb')).toEqual(['a', 'b'])
  })
})

describe('块级渲染与整篇渲染等价', () => {
  const MD = `# 《雪落无声的第七夜》

> 一场无人可逃的雪夜审判

| 线索 | 指向 |
| --- | --- |
| C1 调快的怀表 | 白棠 |

1. 调快怀表
2. 细线勾门闩

\`\`\`
伪代码里
有空行也不碎

就是这样
\`\`\`

结尾一段 **加粗** 与 \`代码\`。
`

  const blockHtml = renderToStaticMarkup(<Markdown content={MD} />)

  it('标题、引用、表格、列表、代码、行内标记都在', () => {
    expect(blockHtml).toContain('<h1>《雪落无声的第七夜》</h1>')
    expect(blockHtml).toContain('一场无人可逃的雪夜审判')
    expect(blockHtml).toContain('<table>')
    expect(blockHtml).toContain('C1 调快的怀表')
    expect(blockHtml).toContain('<ol>')
    expect(blockHtml).toContain('细线勾门闩')
    expect(blockHtml).toContain('code-block')
    expect(blockHtml).toContain('<strong>加粗</strong>')
    expect(blockHtml).toContain('code-inline')
  })

  it('代码块内的空行被完整保留', () => {
    const codeBlock = blockHtml.slice(blockHtml.indexOf('code-block'))
    expect(codeBlock).toContain('伪代码里')
    expect(codeBlock).toContain('就是这样')
    expect(blockHtml).not.toContain('未闭合')
  })

  it('空内容渲染出空容器，不抛错', () => {
    expect(renderToStaticMarkup(<Markdown content="" />)).toBe('<div class="markdown"></div>')
  })
})
