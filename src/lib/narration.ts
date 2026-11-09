/**
 * 沉浸模式的「本页念什么」。
 *
 * 每个分镜能看到的文字散落在各个子组件里（背景段落、人物卡、线索卡、时间轴…），
 * 如果让朗读去猜 DOM，就会和渲染逻辑耦合、且改版必崩。这里按 stage 编号
 * 从结构化方案重新组织一段口语文本——渲染怎么改都不会影响朗读内容，
 * 也让「念得对不对」可以被单测直接断言。
 */
import type { PlanData } from '../types'

function obj(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
}

function arr(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : typeof value === 'number' ? String(value) : ''
}

/** 句末补标点：切块依赖标点，缺了会把两句话粘成一句念。 */
function sentence(value: string): string {
  const trimmed = value.trim()
  if (!trimmed) return ''
  return /[。！？；，、：!?;,]$/.test(trimmed) ? trimmed : `${trimmed}。`
}

/**
 * 生成某个分镜的朗读文本。
 *
 * @param stage 0=序幕 1=背景 2=案发 3=人物 4=搜证 5=时间线 6=指凶 7=抉择
 */
export function narrateStage(stage: number, plan: PlanData | null | undefined): string {
  const source = obj(plan)
  const parts: string[] = []

  if (stage === 0) {
    parts.push(sentence(text(source.title) || '未命名剧本'))
    const tagline = text(source.tagline)
    if (tagline) parts.push(sentence(tagline))
    return parts.join('')
  }

  if (stage === 1) {
    parts.push('背景。')
    const paragraphs = text(source.background)
      .split(/\n+/)
      .filter((line) => line.trim())
      .slice(0, 6)
    paragraphs.forEach((line) => parts.push(sentence(line)))
    if (!paragraphs.length) parts.push('这份方案还没有写出背景。')
    return parts.join('')
  }

  if (stage === 2) {
    const victim = obj(source.victim)
    parts.push('案发。')
    const fields: Array<[string, string]> = [
      ['死者', text(victim.name)],
      ['身份', text(victim.identity)],
      ['死亡时间', text(victim.death_time)],
      ['死因', text(victim.cause)],
      ['现场', text(victim.scene)],
      ['发现', text(victim.found_by)],
    ]
    fields.forEach(([label, value]) => {
      if (value) parts.push(sentence(`${label}，${value}`))
    })
    if (parts.length === 1) parts.push('这份方案还没有写出案发信息。')
    return parts.join('')
  }

  if (stage === 3) {
    const cast = arr(source.characters)
    parts.push('在场人物。')
    cast.forEach((item) => {
      const row = obj(item)
      const name = text(row.name)
      if (!name) return
      const identity = text(row.identity)
      const suspicion = text(row.suspicion)
      parts.push(
        sentence(`${name}${identity ? `，${identity}` : ''}${suspicion ? `。被怀疑的地方是，${suspicion}` : ''}`),
      )
    })
    if (cast.length === 0) parts.push('这份方案还没有列出角色。')
    return parts.join('')
  }

  if (stage === 4) {
    // 线索内容交由玩家自己翻开看：念出来既冗长，也剥夺了「翻开」的那一下
    const count = arr(source.clues_public).length
    return count
      ? `搜证环节。桌面上一共有${count}条公开线索，点击线索卡可以翻开阅读。`
      : '搜证环节。这份方案还没有公开线索。'
  }

  if (stage === 5) {
    const timeline = arr(source.timeline).filter((item) => text(obj(item).visibility) !== '深入')
    parts.push('时间线。')
    timeline.forEach((item) => {
      const row = obj(item)
      const time = text(row.time)
      const event = text(row.event)
      if (!event) return
      parts.push(sentence(`${time ? `${time}，` : ''}${event}${text(row.witness) ? `，可验证方式是${text(row.witness)}` : ''}`))
    })
    if (timeline.length === 0) parts.push('这份方案还没有公开时间线。')
    return parts.join('')
  }

  if (stage === 6) {
    return '指凶时刻。所有人集中，每人一段话陈述指认对象与理由。接下来是专属于你的抉择时刻。'
  }

  if (stage === 7) {
    const nodes = arr(source.interactions).filter((item) => arr(obj(item).options).length >= 2)
    return nodes.length
      ? `抉择时刻。一共有${nodes.length}个互动节点，每个选择都有时限，选错了就回不了头。`
      : '抉择时刻。这份方案还没有互动剧情。'
  }

  return ''
}
