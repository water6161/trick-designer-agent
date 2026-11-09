import { useMemo, useState } from 'react'

/**
 * 白屏兜底页。
 *
 * React 的渲染异常如果不接，整个页面会变成一片空白——用户拿不到任何信息，
 * 也没法告诉你发生了什么。这个页面做三件事：说人话、给一条可复制的定位信息、给一个出口。
 *
 * 单独拆成展示组件而不是写在 ErrorBoundary 里，是为了能脱离 DOM 直接断言渲染结果。
 */

export interface CrashInfo {
  /** 错误摘要（首行） */
  title: string
  /** 原始错误消息 */
  message: string
  /** 组件栈，线上排查最有用的一段 */
  componentStack: string
  /** 发生时间，用于和日志对齐 */
  at: string
}

export function buildCrashInfo(error: Error, componentStack?: string, now: Date = new Date()): CrashInfo {
  const title = error.name && error.name !== 'Error' ? error.name : '页面渲染出错'
  return {
    title,
    message: error.message || '（没有错误消息）',
    componentStack: (componentStack || '').trim(),
    at: now.toISOString(),
  }
}

/**
 * 报错信息里不能带分享链接——`#/s/<token>` 解出来就是整份玩家本（含剧透）。
 * 排查只需要知道「崩在分享页还是主界面」，token 本身要隐掉。
 */
export function sanitizeUrl(href: string): string {
  if (!href) return ''
  try {
    const url = new URL(href)
    if (url.hash.startsWith('#/s/')) {
      return `${url.origin}${url.pathname}#/s/<已隐藏>`
    }
    return `${url.origin}${url.pathname}${url.hash}`
  } catch {
    return '<无法解析的地址>'
  }
}

/** 复制到剪贴板的那段文本：足够定位问题，又不夹带用户内容。 */
export function formatCrashReport(info: CrashInfo, extra?: Record<string, string>): string {
  const lines = [`[${info.at}] ${info.title}: ${info.message}`]
  if (info.componentStack) lines.push('', '组件栈：', info.componentStack)
  if (extra) {
    const pairs = Object.entries(extra).filter(([, value]) => value)
    if (pairs.length) {
      lines.push('', '环境：')
      for (const [key, value] of pairs) lines.push(`${key}: ${value}`)
    }
  }
  return lines.join('\n')
}

interface CrashScreenProps {
  info: CrashInfo
  extra?: Record<string, string>
  onReload?: () => void
  onReset?: () => void
}

export default function CrashScreen({ info, extra, onReload, onReset }: CrashScreenProps) {
  const [copied, setCopied] = useState(false)
  const [showDetail, setShowDetail] = useState(false)
  const report = useMemo(() => formatCrashReport(info, extra), [info, extra])

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(report)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2000)
    } catch {
      // 剪贴板不可用（非 https / 权限拒绝）时退化为展开详情，让用户手动选中
      setShowDetail(true)
    }
  }

  const reload = onReload ?? (() => window.location.reload())

  return (
    <div className="crash" role="alert" aria-live="assertive">
      <div className="crash-card">
        <div className="crash-mark">⚠</div>
        <h1 className="crash-title">这一页没能画出来</h1>
        <p className="crash-lead">
          界面在某处渲染失败了，但你的会话数据没有丢——刷新之后还能从左侧会话列表继续。
        </p>

        <div className="crash-actions">
          <button className="crash-primary" onClick={reload}>
            刷新页面
          </button>
          {onReset && (
            <button className="crash-ghost" onClick={onReset}>
              只重置界面状态
            </button>
          )}
          <button className="crash-ghost" onClick={() => void copy()}>
            {copied ? '已复制 ✓' : '复制错误详情'}
          </button>
        </div>

        <button
          className="crash-toggle"
          aria-expanded={showDetail}
          onClick={() => setShowDetail((value) => !value)}
        >
          {showDetail ? '收起技术细节 ▴' : '查看技术细节 ▾'}
        </button>

        {showDetail && (
          <pre className="crash-detail" tabIndex={0}>
            {report}
          </pre>
        )}
      </div>
    </div>
  )
}
