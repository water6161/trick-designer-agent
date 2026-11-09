import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import CrashScreen, {
  buildCrashInfo,
  formatCrashReport,
  sanitizeUrl,
} from '../src/components/CrashScreen'

describe('buildCrashInfo', () => {
  it('保留错误类型与消息', () => {
    const error = new TypeError('cannot read property of undefined')
    const info = buildCrashInfo(error)
    expect(info.title).toBe('TypeError')
    expect(info.message).toContain('cannot read property')
  })

  it('普通 Error 用中文标题兜底', () => {
    expect(buildCrashInfo(new Error('炸了')).title).toBe('页面渲染出错')
  })

  it('空消息也有占位，不会渲染出 undefined', () => {
    expect(buildCrashInfo(new Error('')).message).toBe('（没有错误消息）')
  })

  it('带上可对齐日志的时间戳', () => {
    const info = buildCrashInfo(new Error('x'), undefined, new Date('2026-03-01T08:00:00Z'))
    expect(info.at).toBe('2026-03-01T08:00:00.000Z')
  })

  it('组件栈两端空白被裁掉', () => {
    expect(buildCrashInfo(new Error('x'), '\n  at Foo  \n').componentStack).toBe('at Foo')
  })
})

describe('formatCrashReport', () => {
  const info = buildCrashInfo(new Error('boom'), 'at Foo\nat Bar', new Date('2026-03-01T08:00:00Z'))

  it('首行是时间 + 类型 + 消息', () => {
    expect(formatCrashReport(info).split('\n')[0]).toBe('[2026-03-01T08:00:00.000Z] 页面渲染出错: boom')
  })

  it('包含组件栈', () => {
    expect(formatCrashReport(info)).toContain('at Foo')
  })

  it('环境字段过滤空值，避免刷出 "浏览器: " 这种无用行', () => {
    const report = formatCrashReport(info, { 页面: 'https://x/y', 浏览器: '', 视口: '1440×900' })
    expect(report).toContain('页面: https://x/y')
    expect(report).toContain('视口: 1440×900')
    expect(report).not.toContain('浏览器:')
  })

  it('没有组件栈时不出现空的"组件栈："标题', () => {
    const bare = buildCrashInfo(new Error('x'), '')
    expect(formatCrashReport(bare)).not.toContain('组件栈')
  })
})

describe('sanitizeUrl', () => {
  it('分享 token 必须隐去——解出来就是整份玩家本', () => {
    const url = sanitizeUrl('https://studio.example.com/app/#/s/abcDEF123')
    expect(url).toBe('https://studio.example.com/app/#/s/<已隐藏>')
    expect(url).not.toContain('abcDEF123')
  })

  it('普通 hash 路由保留，便于判断崩在哪个界面', () => {
    expect(sanitizeUrl('https://x.dev/app/#/shelf')).toBe('https://x.dev/app/#/shelf')
  })

  it('非法地址不抛错', () => {
    expect(sanitizeUrl('not a url')).toBe('<无法解析的地址>')
    expect(sanitizeUrl('')).toBe('')
  })
})

describe('CrashScreen 渲染', () => {
  const info = buildCrashInfo(new Error('boom'), 'at Foo', new Date('2026-03-01T08:00:00Z'))

  it('给出出路：刷新 + 重置 + 复制', () => {
    const html = renderToStaticMarkup(<CrashScreen info={info} onReset={() => {}} />)
    expect(html).toContain('刷新页面')
    expect(html).toContain('复制错误详情')
    expect(html).toContain('只重置界面状态')
  })

  it('用 role=alert 让屏幕阅读器立刻播报', () => {
    const html = renderToStaticMarkup(<CrashScreen info={info} />)
    expect(html).toContain('role="alert"')
  })

  it('默认不展开技术细节，避免吓到普通用户', () => {
    const html = renderToStaticMarkup(<CrashScreen info={info} />)
    expect(html).toContain('aria-expanded="false"')
    expect(html).not.toContain('at Foo')
  })

  it('告诉用户数据没丢，降低焦虑', () => {
    const html = renderToStaticMarkup(<CrashScreen info={info} />)
    expect(html).toContain('会话数据没有丢')
  })

  it('传入 onReset 才出现重置按钮，避免无意义的假按钮', () => {
    const withReset = renderToStaticMarkup(<CrashScreen info={info} onReset={() => {}} />)
    const without = renderToStaticMarkup(<CrashScreen info={info} />)
    expect(withReset).toContain('只重置界面状态')
    expect(without).not.toContain('只重置界面状态')
  })
})
