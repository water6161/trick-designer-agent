import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import ErrorBoundary from './components/ErrorBoundary'
import './index.css'

const container = document.getElementById('root')
if (!container) {
  throw new Error('未找到 #root 挂载点')
}

createRoot(container).render(
  <StrictMode>
    {/* 顶层兜底：任何渲染异常都降级为可读页面，而不是白屏 */}
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
)
