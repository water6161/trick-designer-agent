import { useEffect, useState } from 'react'

/**
 * 浏览器在线状态。
 *
 * `navigator.onLine` 只反映「有没有网络接口」，不保证后端可达——所以它不作为拦截条件，
 * 只用来提前告诉用户「这不是你的操作有问题」，并把请求错误从"未知异常"改写为"网络已断开"。
 */
export function useOnline(): boolean {
  const [online, setOnline] = useState<boolean>(() =>
    typeof navigator === 'undefined' ? true : navigator.onLine,
  )

  useEffect(() => {
    const up = () => setOnline(true)
    const down = () => setOnline(false)
    window.addEventListener('online', up)
    window.addEventListener('offline', down)
    // 挂载时对齐一次：事件可能发生在 React 接管之前
    setOnline(navigator.onLine)
    return () => {
      window.removeEventListener('online', up)
      window.removeEventListener('offline', down)
    }
  }, [])

  return online
}
