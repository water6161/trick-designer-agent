/** 沉浸模式音效：全部用 Web Audio 实时合成，不依赖任何音频文件。
 *  浏览器要求用户交互后才能播放，首次调用会自动解锁；静音开关持久化到 localStorage。 */

const MUTE_KEY = 'tda_imm_muted'

let ctx: AudioContext | null = null

function ensureCtx(): AudioContext | null {
  if (typeof window === 'undefined') return null
  try {
    if (!ctx) {
      const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
      if (!Ctor) return null
      ctx = new Ctor()
    }
    if (ctx.state === 'suspended') void ctx.resume()
    return ctx
  } catch {
    return null
  }
}

export function isMuted(): boolean {
  try {
    return localStorage.getItem(MUTE_KEY) === '1'
  } catch {
    return false
  }
}

export function setMuted(muted: boolean): void {
  try {
    localStorage.setItem(MUTE_KEY, muted ? '1' : '0')
  } catch {
    // 忽略存储失败
  }
}

/** 死亡闷响：低频下滑 + 噪声尾巴，模拟「心脏骤停」的听觉冲击。 */
export function playDeathThud(): void {
  if (isMuted()) return
  const audio = ensureCtx()
  if (!audio) return
  const now = audio.currentTime

  const osc = audio.createOscillator()
  const gain = audio.createGain()
  osc.type = 'sine'
  osc.frequency.setValueAtTime(150, now)
  osc.frequency.exponentialRampToValueAtTime(38, now + 0.7)
  gain.gain.setValueAtTime(0.0001, now)
  gain.gain.exponentialRampToValueAtTime(0.42, now + 0.02)
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 1.05)
  osc.connect(gain).connect(audio.destination)
  osc.start(now)
  osc.stop(now + 1.1)

  // 噪声尾巴：营造「耳鸣」余韵
  const len = Math.floor(audio.sampleRate * 0.6)
  const buffer = audio.createBuffer(1, len, audio.sampleRate)
  const data = buffer.getChannelData(0)
  for (let i = 0; i < len; i += 1) {
    data[i] = (Math.random() * 2 - 1) * (1 - i / len) ** 2
  }
  const noise = audio.createBufferSource()
  const nGain = audio.createGain()
  noise.buffer = buffer
  nGain.gain.setValueAtTime(0.06, now)
  nGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.6)
  noise.connect(nGain).connect(audio.destination)
  noise.start(now + 0.05)
}

/** 心跳：一声「咚-咚」，紧张段循环调用。 */
export function playHeartbeat(intensity = 1): void {
  if (isMuted()) return
  const audio = ensureCtx()
  if (!audio) return
  const now = audio.currentTime
  const beat = (offset: number, amp: number) => {
    const osc = audio.createOscillator()
    const gain = audio.createGain()
    osc.type = 'sine'
    osc.frequency.setValueAtTime(72, now + offset)
    osc.frequency.exponentialRampToValueAtTime(34, now + offset + 0.16)
    gain.gain.setValueAtTime(0.0001, now + offset)
    gain.gain.exponentialRampToValueAtTime(amp, now + offset + 0.012)
    gain.gain.exponentialRampToValueAtTime(0.0001, now + offset + 0.22)
    osc.connect(gain).connect(audio.destination)
    osc.start(now + offset)
    osc.stop(now + offset + 0.24)
  }
  beat(0, 0.22 * intensity)
  beat(0.2, 0.14 * intensity)
}

/** 安全通过：一声清亮的短音。 */
export function playSafeChime(): void {
  if (isMuted()) return
  const audio = ensureCtx()
  if (!audio) return
  const now = audio.currentTime
  ;[523.25, 783.99].forEach((freq, i) => {
    const osc = audio.createOscillator()
    const gain = audio.createGain()
    osc.type = 'triangle'
    osc.frequency.value = freq
    gain.gain.setValueAtTime(0.0001, now + i * 0.09)
    gain.gain.exponentialRampToValueAtTime(0.09, now + i * 0.09 + 0.02)
    gain.gain.exponentialRampToValueAtTime(0.0001, now + i * 0.09 + 0.5)
    osc.connect(gain).connect(audio.destination)
    osc.start(now + i * 0.09)
    osc.stop(now + i * 0.09 + 0.55)
  })
}

/** 在首次用户交互时解锁音频上下文（浏览器自动播放策略）。 */
export function unlockAudio(): void {
  ensureCtx()
}
