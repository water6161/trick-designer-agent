import { describe, expect, it } from 'vitest'
import {
  buildPlayerPacket,
  buildShareLink,
  decodePacket,
  encodePacket,
  hasShareToken,
  readShareToken,
  type PlayerPacket,
} from '../src/lib/share'
import type { PlanData } from '../src/types'

/** 接近真实产出的完整方案：含凶手、诡计、DM 提示等所有不该下发的字段。 */
function fullPlan(): PlanData {
  return {
    title: '暴雪山庄的密室',
    tagline: '一句被篡改的死亡时间',
    background: '雪夜，山庄与外界断联。',
    victim: { name: '顾寒山', death_time: '第一幕 21:40', cause: '中毒', scene: '书房反锁' },
    characters: [
      { name: '沈墨', identity: '管家', secret: '他偷换了遗嘱', suspicion: '曾与死者争吵' },
      { name: '白棠', identity: '外甥女', secret: '她当晚并不在房里', suspicion: '继承顺位第一' },
      { name: '陆迟', identity: '医生', secret: '他伪造了死亡证明', suspicion: '唯一懂毒理的人' },
    ],
    clues_public: [
      { id: 'C1', name: '调快的怀表', content: '怀表被调快二十分钟', points_to: '指向白棠', access: '公开阅读', why_fair: '人人可见' },
      { id: 'C2', name: '门缝细线', content: '门缝里卡着一根细线', points_to: '指向陆迟', access: '公开阅读', why_fair: '人人可见' },
    ],
    clues_deep: [
      { id: 'D1', name: '药瓶', content: '药瓶内壁残留苦味', points_to: '锁定陆迟', access: '搜证·书房抽屉', why_fair: '搜证可得' },
    ],
    timeline: [
      { time: '21:40', event: '书房传出倒地声', witness: '众人', visibility: '公开' },
      { time: '21:55', event: '陆迟独自返回书房', witness: '监控', visibility: '深入' },
    ],
    culprit: { character: '白棠', motive: '她才是真正的继承人' },
    core_trick: { name: '时间错觉', principle: '调快怀表伪造死亡时间' },
    dm_tips: ['开场先强调雪夜封路'],
    anti_argument: ['如果玩家质疑时间线，就把怀表拿出来'],
    hidden_ending: { ending: '白棠其实是被收养的替身' },
    endings: [{ name: '真相大白', condition: '指认白棠', clues: 'C1', outcome: '白棠伏法' }],
    red_herrings: [{ description: '陆迟的毒药瓶', misleading: '让人以为他是凶手', clear_method: 'C2 细线排除' }],
    interactions: [
      {
        title: '雨夜敲门',
        scene: '门外有人敲门',
        options: [
          { text: '开门', result: '你被拖进黑暗', type: '死亡结局' },
          { text: '从猫眼看', result: '你看到空无一人的走廊', type: '安全' },
        ],
      },
    ],
  }
}

describe('buildPlayerPacket 权限裁剪', () => {
  it('凶手、诡计、DM 提示、红鲱鱼、隐藏结局一律不下发', () => {
    const packet = buildPlayerPacket(fullPlan(), '沈墨')
    const json = JSON.stringify(packet)
    expect(json).not.toContain('白棠其实是被收养的替身')
    expect(json).not.toContain('调快怀表伪造死亡时间')
    expect(json).not.toContain('开场先强调雪夜封路')
    expect(json).not.toContain('C2 细线排除')
    expect(json).not.toContain('她才是真正的继承人')
    // 字段级断言，防止换名后被字符串匹配漏掉
    expect(packet).not.toHaveProperty('culprit')
    expect(packet).not.toHaveProperty('core_trick')
    expect(packet).not.toHaveProperty('dm_tips')
    expect(packet).not.toHaveProperty('hidden_ending')
    expect(packet).not.toHaveProperty('red_herrings')
    expect(packet).not.toHaveProperty('endings')
  })

  it('只回传当事人自己的秘密', () => {
    const packet = buildPlayerPacket(fullPlan(), '沈墨')
    const byName = Object.fromEntries(packet.cast.map((c) => [c.name, c]))
    expect(byName['沈墨'].secret).toBe('他偷换了遗嘱')
    expect(byName['白棠'].secret).toBeUndefined()
    expect(byName['陆迟'].secret).toBeUndefined()
  })

  it('通用本（不指定角色）不含任何秘密', () => {
    const packet = buildPlayerPacket(fullPlan(), '')
    expect(packet.role).toBe('')
    expect(packet.cast.every((c) => c.secret === undefined)).toBe(true)
  })

  it('线索剥离指向列与公平性自证', () => {
    const packet = buildPlayerPacket(fullPlan(), '沈墨')
    expect(packet.clues[0]).toEqual({
      id: 'C1',
      name: '调快的怀表',
      content: '怀表被调快二十分钟',
      access: '公开阅读',
    })
  })

  it('深入线索只留编号与获取方式，内容和标题都不下发', () => {
    const packet = buildPlayerPacket(fullPlan(), '沈墨')
    expect(packet.deep).toEqual([{ id: 'D1', access: '搜证·书房抽屉' }])
    expect(JSON.stringify(packet.deep)).not.toContain('苦味')
  })

  it('时间线只保留公开项', () => {
    const packet = buildPlayerPacket(fullPlan(), '沈墨')
    expect(packet.timeline).toHaveLength(1)
    expect(packet.timeline[0].event).toContain('倒地声')
  })

  it('互动选项的结局类型（死亡/安全）被剥离', () => {
    const packet = buildPlayerPacket(fullPlan(), '沈墨')
    expect(packet.interactions[0].options[0]).toEqual({ text: '开门', result: '你被拖进黑暗' })
  })

  it('空方案不抛错，产出可渲染的空壳', () => {
    const packet = buildPlayerPacket(null)
    expect(packet.title).toBe('未命名剧本')
    expect(packet.cast).toEqual([])
    expect(packet.clues).toEqual([])
    expect(packet.timeline).toEqual([])
  })

  it('超长背景被截断，避免链接失控', () => {
    const plan = { ...fullPlan(), background: '雪'.repeat(5000) }
    const packet = buildPlayerPacket(plan as PlanData)
    expect((packet.background || '').length).toBe(700)
  })
})

describe('分享编码往返', () => {
  const roundTrip = async (forceRaw: boolean) => {
    const packet = buildPlayerPacket(fullPlan(), '沈墨')
    const token = await encodePacket(packet, forceRaw)
    const back = await decodePacket(token)
    expect(back).toEqual(packet)
    return token
  }

  it('压缩路径可无损还原', async () => {
    const token = await roundTrip(false)
    expect(token.startsWith('z')).toBe(true)
  })

  it('明文路径可无损还原（压缩不可用时的降级）', async () => {
    const token = await roundTrip(true)
    expect(token.startsWith('n')).toBe(true)
  })

  it('压缩确实让链接变短', async () => {
    const packet = buildPlayerPacket(fullPlan(), '沈墨')
    const [packed, plain] = await Promise.all([encodePacket(packet, false), encodePacket(packet, true)])
    expect(packed.length).toBeLessThan(plain.length)
    expect(packed.length).toBeLessThan(2000)
  })

  it('只含 URL 安全字符', async () => {
    const token = await encodePacket(buildPlayerPacket(fullPlan(), ''), false)
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/)
  })

  it('被截断的串返回 null 而不是抛错', async () => {
    const token = await encodePacket(buildPlayerPacket(fullPlan(), ''), false)
    expect(await decodePacket(token.slice(0, token.length - 12))).toBeNull()
  })

  it('随意构造的串一律拒绝', async () => {
    expect(await decodePacket('')).toBeNull()
    expect(await decodePacket('z')).toBeNull()
    expect(await decodePacket('n!!!')).toBeNull()
    expect(await decodePacket('xabcdef')).toBeNull()
    // 合法 base64 但内容不是方案包
    expect(await decodePacket('n' + btoa('{"v":2}').replace(/=+$/, ''))).toBeNull()
  })
})

describe('hash 路由', () => {
  it('识别分享链接', () => {
    expect(readShareToken('#/s/zABC_-123')).toBe('zABC_-123')
    expect(hasShareToken('#/s/zABC')).toBe(true)
  })

  it('普通 hash 与空值不误判', () => {
    expect(readShareToken('')).toBe('')
    expect(readShareToken('#/s/')).toBe('')
    expect(readShareToken('#other')).toBe('')
    expect(readShareToken('#/s/a b')).toBe('')
    expect(hasShareToken('')).toBe(false)
  })

  it('拼接时保留部署子路径', () => {
    expect(buildShareLink('zabc', { origin: 'https://x.cn', pathname: '/trick/' })).toBe(
      'https://x.cn/trick/#/s/zabc',
    )
  })
})
