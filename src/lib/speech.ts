/**
 * DM 提示的语音朗读：文本清洗 + 切块。
 *
 * 为什么不能直接 `speechSynthesis.speak(整段)`：
 * 1. 方案正文里有 Markdown 标记、箭头、编号，直接念会念出「星号星号」「右箭头」；
 * 2. Chrome 对单条 utterance 有约 15 秒的静默截断（历史遗留 bug），长段落必被掐断；
 * 3. 中文语音对拉丁字母编号（C1 / D2）读法不统一，需要换成「线索一」这类说法。
 *
 * 所以先把文本洗成人话，再按标点切成小块逐条朗读——每块都短，天然绕过截断。
 */

const CN_DIGITS = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九']

/** 1~99 转中文读法；超出范围原样返回（剧本里不会有更大的编号）。 */
export function cnNumber(value: number): string {
  if (!Number.isInteger(value) || value < 0 || value > 99) return String(value)
  if (value < 10) return CN_DIGITS[value]
  const tens = Math.floor(value / 10)
  const ones = value % 10
  const head = tens === 1 ? '十' : `${CN_DIGITS[tens]}十`
  return ones === 0 ? head : `${head}${CN_DIGITS[ones]}`
}

// 常见 emoji 区段：语音引擎会把它们念成「笑脸」「剪刀」之类的噪音
const EMOJI = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}\u{200D}]/gu

/**
 * 把方案里的排版文字洗成适合朗读的口语文本。
 *
 * 只做「念出来不别扭」必要的处理，不做摘要——宁可多念一句，也不替用户删内容。
 */
export function cleanForSpeech(text: string): string {
  return (text || '')
    .replace(/\r/g, '')
    .replace(EMOJI, '')
    // 标题井号、加粗、行内代码、引用符号
    .replace(/^#{1,6}\s*/gm, '')
    .replace(/\*\*|__|`/g, '')
    .replace(/^>\s?/gm, '')
    // 表格竖线读出来毫无意义，换成停顿
    .replace(/\s*\|\s*/g, '，')
    // 破折号与箭头：念成「指向」比念「破折号」有用
    .replace(/→|->|⇒/g, '，指向')
    .replace(/—{2,}|--/g, '，')
    // 线索编号 C1 / D12 → 线索一 / 线索十二
    .replace(/\b([A-Z])(\d{1,2})\b/g, (_, _letter: string, num: string) => `线索${cnNumber(Number(num))}`)
    // 全角空格、连续空白
    .replace(/[\u3000\s]+/g, ' ')
    // 空格与标点相邻时去掉空格，避免念出「线索一 ，指向」
    .replace(/\s+([，。、；：！？])/g, '$1')
    // 首尾的孤立标点没有朗读价值
    .replace(/^[\s，。、；：！？]+/, '')
    .replace(/[\s，、；：]+$/, '')
}

const SOFT_BREAK = /[。！？；!?;\n]/
const HARD_BREAK = /[，、：,:]/

/**
 * 按标点把长文本切成朗读块。
 *
 * 优先在句末切；单句仍超长时退到逗号；连逗号都没有才硬切，保证不会出现超长 utterance。
 */
export function speechChunks(text: string, max = 90): string[] {
  const source = (text || '').trim()
  if (!source) return []

  const chunks: string[] = []
  let buffer = ''

  const flush = () => {
    const piece = buffer.trim()
    if (piece) chunks.push(piece)
    buffer = ''
  }

  for (const char of source) {
    buffer += char
    if (SOFT_BREAK.test(char)) {
      flush()
      continue
    }
    // 缓冲过长的中间态：先看能不能在最近的逗号处断开
    if (buffer.length >= max) {
      const cut = Math.max(
        ...[...buffer].map((c, i) => (HARD_BREAK.test(c) ? i : -1)).filter((i) => i >= 0),
        -1,
      )
      if (cut > 0) {
        chunks.push(buffer.slice(0, cut + 1).trim())
        buffer = buffer.slice(cut + 1)
      } else if (buffer.length >= max * 2) {
        chunks.push(buffer.slice(0, max).trim())
        buffer = buffer.slice(max)
      }
    }
  }
  flush()

  // 兜底再切一遍：极端情况（整段无标点）仍可能超出上限
  return chunks.flatMap((chunk) =>
    chunk.length > max * 2 ? chunk.match(new RegExp(`[\\s\\S]{1,${max}}`, 'g')) || [chunk] : [chunk],
  )
}

export interface VoiceLike {
  name: string
  lang: string
}

/**
 * 选中文语音：优先普通话，其次任意中文，最后交给引擎默认。
 * 各平台语音名差异极大（macOS「婷婷」、Windows「Huihui」、Chrome「Google 普通话」），
 * 因此只看 lang，不看名字。
 */
export function pickChineseVoice<T extends VoiceLike>(voices: T[]): T | null {
  if (!voices.length) return null
  const zh = voices.filter((v) => /^zh/i.test(v.lang || ''))
  if (!zh.length) return null
  const mandarin = zh.find((v) => /zh[-_]?(cn|hans)|cmn/i.test(v.lang))
  return mandarin || zh[0]
}

/** 当前环境是否支持朗读（测试与非浏览器环境都走 false）。 */
export function speechAvailable(): boolean {
  return typeof window !== 'undefined' && 'speechSynthesis' in window && 'SpeechSynthesisUtterance' in window
}
