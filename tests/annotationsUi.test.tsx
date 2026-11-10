import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import ChatMessage from '../src/components/ChatMessage'
import AnnotationPopover, { type SelectionTarget } from '../src/components/AnnotationPopover'
import AnnotationsPanel from '../src/components/AnnotationsPanel'
import type { Annotation } from '../src/lib/annotations'

const NOTE: Annotation = {
  id: 'a1',
  conversationId: 'conv-1',
  messageId: 'm1',
  quote: '凶手在 21:20 之前把怀表调快了二十分钟',
  note: '这里补一个怀表谁调的伏笔',
  createdAt: 1000,
}

describe('ChatMessage 批注渲染', () => {
  it('批注挂在消息下：原文、批注、删除按钮都在，消息带 data-mid 锚点', () => {
    const html = renderToStaticMarkup(
      <ChatMessage
        message={{ id: 'm1', role: 'assistant', content: '正文' }}
        annotations={[NOTE]}
        onRemoveNote={() => {}}
      />,
    )
    expect(html).toContain('data-mid="m1"')
    expect(html).toContain('msg-annotations')
    expect(html).toContain('凶手在 21:20 之前把怀表调快了二十分钟')
    expect(html).toContain('这里补一个怀表谁调的伏笔')
    expect(html).toContain('aria-label="删除批注"')
  })

  it('没有批注时不渲染批注容器', () => {
    const html = renderToStaticMarkup(
      <ChatMessage message={{ id: 'm1', role: 'assistant', content: '正文' }} />,
    )
    expect(html).not.toContain('msg-annotations')
    // 锚点仍然要有：划选定位靠它
    expect(html).toContain('data-mid="m1"')
  })

  it('玩家自己的消息也能加批注', () => {
    const html = renderToStaticMarkup(
      <ChatMessage
        message={{ id: 'm2', role: 'user', content: '帮我改成 6 人本' }}
        annotations={[{ ...NOTE, messageId: 'm2' }]}
        onRemoveNote={() => {}}
      />,
    )
    expect(html).toContain('msg-annotations')
    expect(html).toContain('帮我改成 6 人本')
  })
})

const TARGET: SelectionTarget = { x: 200, y: 300, messageId: 'm1', quote: '凶手在 21:20' }

describe('AnnotationPopover 浮标', () => {
  it('默认是「加批注」按钮态', () => {
    const html = renderToStaticMarkup(
      <AnnotationPopover target={TARGET} onSave={() => {}} onCancel={() => {}} />,
    )
    expect(html).toContain('加批注')
    expect(html).not.toContain('<textarea')
  })

  it('按钮态不泄漏原文：原文只在点开后的编辑态里出现', () => {
    const html = renderToStaticMarkup(
      <AnnotationPopover target={TARGET} onSave={() => {}} onCancel={() => {}} />,
    )
    expect(html).not.toContain('凶手在 21:20')
  })
})

describe('AnnotationsPanel 批注清单', () => {
  it('空态告诉用户怎么加批注、存到哪里', () => {
    const html = renderToStaticMarkup(
      <AnnotationsPanel items={[]} onClose={() => {}} onRemove={() => {}} onJump={() => {}} />,
    )
    expect(html).toContain('批注（0）')
    expect(html).toContain('划选一段文字')
    expect(html).not.toContain('复制全部')
    expect(html).toContain('不会上传')
  })

  it('列表渲染每条批注，带复制与删除入口', () => {
    const html = renderToStaticMarkup(
      <AnnotationsPanel
        items={[NOTE, { ...NOTE, id: 'a2', note: '第二条' }]}
        onClose={() => {}}
        onRemove={() => {}}
        onJump={() => {}}
      />,
    )
    expect(html).toContain('批注（2）')
    expect(html).toContain('这里补一个怀表谁调的伏笔')
    expect(html).toContain('第二条')
    expect(html).toContain('复制全部')
    expect(html).toContain('aria-label="删除批注"')
    // 跳转按钮的 title 说明用途
    expect(html).toContain('点击跳到这条批注所在的消息')
  })

  it('批注缺原文也能渲染（老数据兜底，不抛错）', () => {
    const html = renderToStaticMarkup(
      <AnnotationsPanel
        items={[{ ...NOTE, quote: '' }]}
        onClose={() => {}}
        onRemove={() => {}}
        onJump={() => {}}
      />,
    )
    expect(html).toContain('这里补一个怀表谁调的伏笔')
  })
})
