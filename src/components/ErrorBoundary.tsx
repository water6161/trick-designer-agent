import { Component, type ErrorInfo, type ReactNode } from 'react'
import CrashScreen, { buildCrashInfo, sanitizeUrl, type CrashInfo } from './CrashScreen'

interface Props {
  children: ReactNode
  /** 变化时自动复位（例如切换会话），避免一次崩溃钉死在当前页面 */
  resetKey?: unknown
}

interface State {
  info: CrashInfo | null
}

/**
 * 顶层错误边界：任何组件在 render / 生命周期里抛错，都不会再让整页变白。
 *
 * 类组件是 React 目前唯一能捕获子树渲染异常的形式（hooks 没有等价能力），
 * 所以这里刻意不用函数组件写法。
 */
export default class ErrorBoundary extends Component<Props, State> {
  state: State = { info: null }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { info: buildCrashInfo(error) }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    this.setState({ info: buildCrashInfo(error, info.componentStack ?? '') })
    // 控制台留一份完整信息，方便现场截图或远程指导用户打开开发者工具
    console.error('[trick-designer] 渲染异常', error, info.componentStack)
  }

  componentDidUpdate(prev: Props) {
    if (this.state.info && prev.resetKey !== this.props.resetKey) {
      this.setState({ info: null })
    }
  }

  private reset = () => this.setState({ info: null })

  render() {
    const { info } = this.state
    if (!info) return this.props.children

    return (
      <CrashScreen
        info={info}
        extra={{
          页面: sanitizeUrl(typeof location !== 'undefined' ? location.href : ''),
          视口:
            typeof window !== 'undefined'
              ? `${window.innerWidth}×${window.innerHeight}`
              : '',
          浏览器: typeof navigator !== 'undefined' ? navigator.userAgent : '',
        }}
        onReset={this.reset}
      />
    )
  }
}
