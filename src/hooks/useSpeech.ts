import { useCallback, useEffect, useRef, useState } from 'react'
import { cleanForSpeech, pickChineseVoice, speechAvailable, speechChunks } from '../lib/speech'

interface SpeechApi {
  /** 环境是否支持朗读（不支持时调用方应隐藏按钮，而不是给一个点了没反应的入口） */
  supported: boolean
  speaking: boolean
  rate: number
  setRate: (value: number) => void
  speak: (text: string) => void
  stop: () => void
}

/**
 * 浏览器内置语音的朗读封装（零依赖、零 API key、离线可用）。
 *
 * 三个必须处理的现实问题：
 * 1. **语音列表异步加载**：Chrome 首次 getVoices() 返回空，必须监听 voiceschanged；
 * 2. **重入叠音**：连续点两次朗读会两路同时念，speak 前必须先 cancel；
 * 3. **组件卸载后继续念**：弹窗关掉还在说话，必须在 cleanup 里 cancel。
 */
export function useSpeech(): SpeechApi {
  const [supported] = useState(speechAvailable)
  const [speaking, setSpeaking] = useState(false)
  const [rate, setRate] = useState(1)
  const voiceRef = useRef<SpeechSynthesisVoice | null>(null)
  const queueRef = useRef<string[]>([])
  const activeRef = useRef(false)
  // 用 ref 持有「念下一块」的实现，避免递归引用导致的闭包错位
  const nextRef = useRef<() => void>(() => {})

  useEffect(() => {
    if (!supported) return
    const synth = window.speechSynthesis
    const sync = () => {
      voiceRef.current = pickChineseVoice(synth.getVoices())
    }
    sync()
    synth.addEventListener?.('voiceschanged', sync)
    return () => {
      synth.removeEventListener?.('voiceschanged', sync)
      activeRef.current = false
      queueRef.current = []
      synth.cancel()
    }
  }, [supported])

  useEffect(() => {
    if (!supported) return
    nextRef.current = () => {
      if (!activeRef.current) return
      const chunk = queueRef.current.shift()
      if (!chunk) {
        activeRef.current = false
        setSpeaking(false)
        return
      }
      const utter = new SpeechSynthesisUtterance(chunk)
      utter.lang = 'zh-CN'
      utter.rate = rate
      utter.pitch = 1
      if (voiceRef.current) utter.voice = voiceRef.current
      // 逐块串联而不是一次性 enqueue 全部：每块都短，天然规避 Chrome 对长文本的截断
      utter.onend = () => nextRef.current()
      utter.onerror = () => {
        activeRef.current = false
        queueRef.current = []
        setSpeaking(false)
      }
      window.speechSynthesis.speak(utter)
    }
  }, [rate, supported])

  const stop = useCallback(() => {
    if (!supported) return
    activeRef.current = false
    queueRef.current = []
    window.speechSynthesis.cancel()
    setSpeaking(false)
  }, [supported])

  const speak = useCallback(
    (text: string) => {
      if (!supported) return
      const chunks = speechChunks(cleanForSpeech(text))
      if (!chunks.length) return
      stop()
      queueRef.current = chunks
      activeRef.current = true
      setSpeaking(true)
      nextRef.current()
    },
    [stop, supported],
  )

  return { supported, speaking, rate, setRate, speak, stop }
}
