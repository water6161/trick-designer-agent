import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import Welcome from '../src/components/Welcome'
import Composer, { composerHint } from '../src/components/Composer'

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
