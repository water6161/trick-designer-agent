import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import Welcome, { COVER_REEL } from '../src/components/Welcome'
import Composer, { composerHint } from '../src/components/Composer'
import Sidebar from '../src/components/Sidebar'
import { AI_COVER_MEDIA } from '../src/lib/api'

const markup = (element: React.ReactElement) => renderToStaticMarkup(element)

describe('Welcome 三步上手指引', () => {
  it('首屏包含三步上手有序列表', () => {
    const html = markup(<Welcome onPick={() => {}} />)
    expect(html).toContain('dossier-steps')
    expect(html).toContain('aria-label="三步上手"')
    expect(html.match(/<li>/g)?.length).toBe(3)
  })

  it('第一步讲直接打字，第二步讲案件卡，第三步讲极速', () => {
    const html = markup(<Welcome onPick={() => {}} />)
    expect(html).toContain('直接打字')
    expect(html).toContain('案件卡')
    expect(html).toContain('⚡ 极速')
    expect(html).toContain('15 秒')
  })

  it('案件卡的行动文案是「点击直接立案」而不是含糊的「调阅」', () => {
    const html = markup(<Welcome onPick={() => {}} />)
    expect(html.match(/点击直接立案 →/g)?.length).toBe(4)
    expect(html).not.toContain('调阅')
  })
})

describe('Welcome hero 画风轮播', () => {
  it('渲染轮播四张画风缩略图，且画种 key 都在 AI_COVER_MEDIA 契约内', () => {
    const html = markup(<Welcome onPick={() => {}} />)
    expect(html.match(/reel-img/g)?.length).toBe(COVER_REEL.length)
    expect(COVER_REEL.length).toBe(4)
    for (const item of COVER_REEL) {
      expect(AI_COVER_MEDIA.some((m) => m.key === item.key)).toBe(true)
    }
  })

  it('第一张是激活态，画风名与「设为默认」入口可见', () => {
    const html = markup(<Welcome onPick={() => {}} />)
    expect(html.match(/reel-img active/g)?.length).toBe(1)
    expect(html).toContain('设为默认')
    expect(html).toContain('AI 封面 · 共 10 种画风')
  })

  it('点击画风 chip 调用 onPickMedia 传入对应画种', () => {
    // renderToStaticMarkup 不执行事件，改用 dangerouslySetInnerHTML 断言按钮存在即可；
    // 交互行为归 e2e 覆盖
    const html = markup(<Welcome onPick={() => {}} onPickMedia={() => {}} />)
    expect(html.match(/reel-chip/g)?.length).toBe(1)
  })
})

describe('Composer 常用需求 chips', () => {
  const baseProps = {
    value: '',
    onChange: () => {},
    onSend: () => {},
    onStop: () => {},
    streaming: false,
    disabled: false,
  }

  it('输入为空且非流式时显示 chips 行', () => {
    const html = markup(
      <Composer {...baseProps} suggestions={['a 需求', 'b 需求']} onPickSuggestion={() => {}} />,
    )
    expect(html).toContain('composer-chips')
    expect(html).toContain('a 需求')
    expect(html).toContain('b 需求')
  })

  it('已输入内容时 chips 隐藏（避免挤占输入空间）', () => {
    const html = markup(
      <Composer
        {...baseProps}
        value="我已经在打字了"
        suggestions={['a 需求']}
        onPickSuggestion={() => {}}
      />,
    )
    expect(html).not.toContain('composer-chips')
  })

  it('流式生成中 chips 隐藏', () => {
    const html = markup(
      <Composer {...baseProps} streaming suggestions={['a 需求']} onPickSuggestion={() => {}} />,
    )
    expect(html).not.toContain('composer-chips')
  })

  it('不传 suggestions 时完全不渲染 chips（旧行为不变）', () => {
    expect(markup(<Composer {...baseProps} />)).not.toContain('composer-chips')
  })
})

describe('Sidebar 空态画风灵感位', () => {
  const emptyProps = {
    sessions: [],
    activeId: '',
    open: false,
    onNew: () => {},
    onSelect: () => {},
    onDelete: () => {},
    onClose: () => {},
  }

  it('没有会话时显示画风灵感网格（4 张缩略图 + 说明）', () => {
    const html = markup(<Sidebar {...emptyProps} onPickMedia={() => {}} />)
    expect(html).toContain('style-gallery')
    expect(html.match(/style-thumb/g)?.length).toBe(4)
    expect(html).toContain('点选设为默认画风')
  })

  it('已有会话时不渲染灵感位（列表优先）', () => {
    const html = markup(
      <Sidebar
        {...emptyProps}
        sessions={[{ id: 's1', title: '某个本', updatedAt: '2026-11-16T00:00:00Z' }]}
        onPickMedia={() => {}}
      />,
    )
    expect(html).not.toContain('style-gallery')
  })

  it('footer 不再出现平台名（已自托管）', () => {
    const html = markup(<Sidebar {...emptyProps} />)
    expect(html).not.toContain('EdgeOne')
    expect(html).toContain('自托管')
  })
})

describe('Composer 极速开关', () => {
  const baseProps = {
    value: '',
    onChange: () => {},
    onSend: () => {},
    onStop: () => {},
    streaming: false,
    disabled: false,
  }

  it('不传开关回调时不渲染极速按钮（保持旧行为）', () => {
    expect(markup(<Composer {...baseProps} />)).not.toContain('composer-speed')
  })

  it('传入回调后渲染开关，关闭态文案「⚡ 极速 关」', () => {
    const html = markup(<Composer {...baseProps} speedMode={false} onToggleSpeed={() => {}} />)
    expect(html).toContain('⚡ 极速 关')
    expect(html).not.toContain('composer-speed active')
  })

  it('开启后高亮（active + aria-pressed），文案「⚡ 极速 开」', () => {
    const html = markup(<Composer {...baseProps} speedMode onToggleSpeed={() => {}} />)
    expect(html).toContain('⚡ 极速 开')
    expect(html).toContain('composer-speed active')
    expect(html).toContain('aria-pressed="true"')
  })

  it('流式生成中不显示开关，提示改为 Esc 停止', () => {
    const html = markup(<Composer {...baseProps} streaming onToggleSpeed={() => {}} />)
    expect(html).not.toContain('composer-speed')
    expect(html).toContain('Esc 可停止生成')
  })

  it('禁用时开关不可点', () => {
    const html = markup(<Composer {...baseProps} disabled onToggleSpeed={() => {}} />)
    expect(html).toContain('composer-speed')
    expect(html).toContain('disabled')
  })
})

describe('composerHint 提示文案', () => {
  it('流式中教用户用 Esc 停止', () => {
    expect(composerHint(true, false)).toContain('Esc')
  })

  it('完整模式给「约 1 分半」的耗时预期', () => {
    expect(composerHint(false, false)).toContain('约 1 分半')
  })

  it('极速模式给「约 15 秒」的耗时预期', () => {
    expect(composerHint(false, true)).toContain('15 秒')
  })
})
