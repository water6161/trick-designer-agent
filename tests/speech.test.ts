import { describe, expect, it } from 'vitest'
import {
  cleanForSpeech,
  cnNumber,
  pickChineseVoice,
  speechAvailable,
  speechChunks,
} from '../src/lib/speech'

describe('cnNumber', () => {
  it('个位与整十', () => {
    expect(cnNumber(0)).toBe('零')
    expect(cnNumber(7)).toBe('七')
    expect(cnNumber(10)).toBe('十')
    expect(cnNumber(20)).toBe('二十')
  })

  it('两位数', () => {
    expect(cnNumber(12)).toBe('十二')
    expect(cnNumber(45)).toBe('四十五')
    expect(cnNumber(99)).toBe('九十九')
  })

  it('超出范围原样返回，不抛错', () => {
    expect(cnNumber(100)).toBe('100')
    expect(cnNumber(-1)).toBe('-1')
    expect(cnNumber(1.5)).toBe('1.5')
  })
})

describe('cleanForSpeech', () => {
  it('去掉 Markdown 标记', () => {
    expect(cleanForSpeech('## 开场\n**注意**：不要提前发线索')).toBe('开场 注意：不要提前发线索')
  })

  it('箭头念成「指向」', () => {
    expect(cleanForSpeech('C1 → 白棠')).toBe('线索一，指向 白棠')
  })

  it('表格竖线换成停顿', () => {
    expect(cleanForSpeech('| 时间 | 事件 |')).toBe('时间，事件')
  })

  it('线索编号转中文', () => {
    expect(cleanForSpeech('先发 C1 和 D12')).toBe('先发 线索一 和 线索十二')
  })

  it('清掉 emoji 与引用符号', () => {
    expect(cleanForSpeech('> 🎭 开场白')).toBe('开场白')
  })

  it('压缩空白并去掉开头标点', () => {
    expect(cleanForSpeech('  　　，先说明规则  ')).toBe('先说明规则')
  })

  it('空输入返回空串', () => {
    expect(cleanForSpeech('')).toBe('')
    expect(cleanForSpeech(undefined as unknown as string)).toBe('')
  })
})

describe('speechChunks', () => {
  it('空文本返回空数组', () => {
    expect(speechChunks('')).toEqual([])
    expect(speechChunks('   ')).toEqual([])
  })

  it('短句保持一块', () => {
    expect(speechChunks('先说明规则。')).toEqual(['先说明规则。'])
  })

  it('按句末标点切分', () => {
    const chunks = speechChunks('第一句。第二句！第三句？')
    expect(chunks).toHaveLength(3)
    expect(chunks[1]).toBe('第二句！')
  })

  it('长句在逗号处断开而不是硬切', () => {
    const text = `${'甲'.repeat(40)}，${'乙'.repeat(40)}，${'丙'.repeat(40)}。`
    const chunks = speechChunks(text, 50)
    expect(chunks.length).toBeGreaterThan(1)
    expect(chunks[0].endsWith('，')).toBe(true)
  })

  it('完全没有标点时也不会产出超长块', () => {
    const chunks = speechChunks('丙'.repeat(500), 60)
    expect(chunks.length).toBeGreaterThan(1)
    expect(Math.max(...chunks.map((c) => c.length))).toBeLessThanOrEqual(120)
  })

  it('拼回去等于原文（不丢内容）', () => {
    const text = '开场说明规则。第一轮发公开线索；第二轮发深入线索！最后投票指认？'
    expect(speechChunks(text).join('')).toBe(text)
  })
})

describe('pickChineseVoice', () => {
  const voices = [
    { name: 'Alex', lang: 'en-US' },
    { name: 'Google 普通话', lang: 'zh-CN' },
    { name: 'Mei-Jia', lang: 'zh-TW' },
  ]

  it('优先普通话', () => {
    expect(pickChineseVoice(voices)?.lang).toBe('zh-CN')
  })

  it('没有普通话时退到任意中文', () => {
    expect(pickChineseVoice([{ name: 'Mei', lang: 'zh-TW' }])?.lang).toBe('zh-TW')
  })

  it('没有中文语音时返回 null，交给引擎默认', () => {
    expect(pickChineseVoice([{ name: 'Alex', lang: 'en-US' }])).toBeNull()
    expect(pickChineseVoice([])).toBeNull()
  })
})

describe('speechAvailable', () => {
  it('Node 测试环境没有语音 API', () => {
    expect(speechAvailable()).toBe(false)
  })
})
