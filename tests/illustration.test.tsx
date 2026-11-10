import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import {
  buildPortraits,
  characterPrompt,
  characterSeed,
  hashSeed,
  portraitParams,
  portraitSvg,
  promptPack,
  styleAnchor,
} from '../src/lib/illustration'
import RoleCards from '../src/components/RoleCards'
import type { PlanData } from '../src/types'

function plan(overrides: Partial<PlanData> = {}): PlanData {
  return {
    title: '雪落无声的第七夜',
    genre: '本格密室',
    tagline: '一场无人可逃的雪夜审判',
    characters: [
      { name: '沈墨', identity: '管家', secret: '偷换遗嘱', look: '五十岁，灰白短发，深灰长衫' },
      { name: '白棠', identity: '外甥女', secret: '不在房里', look: '二十四岁，黑长直，酒红连衣裙' },
      { name: '周慈', identity: '医生', secret: '隐瞒病史' },
    ],
    ...overrides,
  }
}

describe('hashSeed', () => {
  it('同一输入恒定', () => {
    expect(hashSeed('雪落无声')).toBe(hashSeed('雪落无声'))
  })

  it('不同输入不同（碰撞在实际用例上可忽略）', () => {
    const seeds = new Set(['沈墨', '白棠', '周慈', '林晚', '顾寒山'].map(hashSeed))
    expect(seeds.size).toBe(5)
  })

  it('结果是 32 位无符号整数', () => {
    const seed = hashSeed('很长的一段中文标题，用来验证哈希不会溢出成负数')
    expect(seed).toBeGreaterThanOrEqual(0)
    expect(seed).toBeLessThanOrEqual(0xffffffff)
    expect(Number.isInteger(seed)).toBe(true)
  })
})

describe('characterSeed 一致性', () => {
  it('同一标题同一姓名恒定——这是「同一张脸」的根', () => {
    expect(characterSeed('雪夜', '沈墨')).toBe(characterSeed('雪夜', '沈墨'))
  })

  it('与角色在表中的顺序无关', () => {
    const a = characterSeed('雪夜', '沈墨')
    const b = characterSeed('雪夜', '白棠')
    // 交换顺序后各自 seed 不变
    expect(characterSeed('雪夜', '沈墨')).toBe(a)
    expect(characterSeed('雪夜', '白棠')).toBe(b)
  })

  it('不同剧本的同名角色 seed 不同（避免跨本撞脸）', () => {
    expect(characterSeed('雪夜', '沈墨')).not.toBe(characterSeed('灯塔', '沈墨'))
  })

  it('首尾空格不影响', () => {
    expect(characterSeed(' 雪夜 ', ' 沈墨 ')).toBe(characterSeed('雪夜', '沈墨'))
  })
})

describe('styleAnchor', () => {
  it('雪夜庄园 → 写实推理剧照感', () => {
    expect(styleAnchor(plan())).toContain('写实推理')
  })

  it('古风宫廷 → 国风工笔', () => {
    expect(styleAnchor({ title: '深宫疑云', genre: '古风宫廷' })).toContain('国风')
  })

  it('变格怪谈 → 暗调胶片', () => {
    expect(styleAnchor({ title: '第七个梦', genre: '变格怪谈' })).toContain('暗调')
  })

  it('无题材线索时给通用电影感兜底', () => {
    expect(styleAnchor({ title: '无题' })).toContain('电影级写实')
  })

  it('始终带「统一画风」约束', () => {
    expect(styleAnchor(plan())).toContain('统一画风')
  })
})

describe('characterPrompt', () => {
  it('包含姓名、身份、外形锚点、画风与 seed', () => {
    const prompt = characterPrompt(plan(), plan().characters![0], 0)
    expect(prompt).toContain('沈墨')
    expect(prompt).toContain('管家')
    expect(prompt).toContain('灰白短发')
    expect(prompt).toContain('写实推理')
    expect(prompt).toContain(String(characterSeed('雪落无声的第七夜', '沈墨')))
  })

  it('没有外形锚点时退回身份描述，而不是留空', () => {
    const prompt = characterPrompt(plan(), plan().characters![2], 2)
    expect(prompt).toContain('医生')
    expect(prompt).toContain('外形：')
  })

  it('负面词固定，防止模型擅自改发色服装', () => {
    expect(characterPrompt(plan(), plan().characters![1], 1)).toContain('不要改变发色与服装主色')
  })
})

describe('promptPack', () => {
  it('包含全部角色与统一画风说明', () => {
    const pack = promptPack(plan())
    expect(pack).toContain('共 3 人')
    expect(pack).toContain('沈墨')
    expect(pack).toContain('白棠')
    expect(pack).toContain('周慈')
    expect(pack).toContain('统一画风')
  })

  it('没有角色时返回空串（UI 不会渲染按钮）', () => {
    expect(promptPack({ title: '空本', characters: [] })).toBe('')
    expect(promptPack(null)).toBe('')
  })
})

describe('portraitSvg 确定性', () => {
  it('同 seed 输出完全相同的 SVG 字符串', () => {
    expect(portraitSvg(123456)).toBe(portraitSvg(123456))
  })

  it('不同 seed 输出不同（发型/配色会变）', () => {
    expect(portraitSvg(1)).not.toBe(portraitSvg(2))
  })

  it('产出合法 SVG 根标签', () => {
    const svg = portraitSvg(42)
    expect(svg.startsWith('<svg')).toBe(true)
    expect(svg.endsWith('</svg>')).toBe(true)
  })

  it('不含随机量或时间戳痕迹', () => {
    const svg = portraitSvg(42)
    expect(svg).not.toContain('Math.random')
    expect(svg).not.toContain('Date')
  })
})

describe('portraitParams', () => {
  it('同 seed 同参数', () => {
    expect(portraitParams(99)).toEqual(portraitParams(99))
  })

  it('参数取值都在允许集合内', () => {
    const params = portraitParams(7)
    expect([0, 1, 2]).toContain(params.hairStyle)
    expect(['broad', 'slim']).toContain(params.shoulder)
    expect(params.skin).toMatch(/^#[0-9a-f]{6}$/i)
  })
})

describe('buildPortraits', () => {
  it('每个角色一个立绘，seed 与 characterSeed 一致', () => {
    const portraits = buildPortraits(plan())
    expect(portraits).toHaveLength(3)
    expect(portraits[0].seed).toBe(characterSeed('雪落无声的第七夜', '沈墨'))
    expect(portraits[0].svg).toBe(portraitSvg(portraits[0].seed, '五十岁，灰白短发，深灰长衫'))
  })

  it('两次调用结果完全相同（重开弹层不会换脸）', () => {
    expect(buildPortraits(plan())).toEqual(buildPortraits(plan()))
  })

  it('空方案返回空数组', () => {
    expect(buildPortraits(null)).toEqual([])
    expect(buildPortraits({ title: 'x', characters: [] })).toEqual([])
  })
})

describe('RoleCards 渲染', () => {
  const md = `# 雪落无声的第七夜

## 四、凶手与人物逻辑

### 角色表

| 角色 | 身份 | 秘密 | 被怀疑点 | 外形锚点 |
|---|---|---|---|---|
| 沈墨 | 管家 | 偷换遗嘱 | 与死者争吵 | 五十岁，灰白短发，深灰长衫 |
| 白棠 | 外甥女 | 当晚不在房里 | 继承顺位第一 | 二十四岁，黑长直，酒红连衣裙 |
`

  it('每个角色都渲染出肖像 SVG 与 seed', () => {
    const html = renderToStaticMarkup(<RoleCards markdown={md} onClose={() => {}} />)
    expect((html.match(/<svg/g) ?? []).length).toBe(2)
    expect((html.match(/data-seed=/g) ?? []).length).toBe(2)
    expect(html).toContain('复制提示词')
  })

  it('外形锚点来自角色表新增列', () => {
    const html = renderToStaticMarkup(<RoleCards markdown={md} onClose={() => {}} />)
    expect(html).toContain('灰白短发')
    expect(html).toContain('酒红连衣裙')
  })

  it('默认不泄露秘密', () => {
    const html = renderToStaticMarkup(<RoleCards markdown={md} onClose={() => {}} />)
    expect(html).not.toContain('偷换遗嘱')
    expect(html).toContain('剧本细节开本时由 DM 私发')
  })

  it('两次渲染的 seed 与 SVG 完全一致', () => {
    const a = renderToStaticMarkup(<RoleCards markdown={md} onClose={() => {}} />)
    const b = renderToStaticMarkup(<RoleCards markdown={md} onClose={() => {}} />)
    expect(a).toBe(b)
  })
})

describe('lookParams 外形锚点落图', () => {
  it('「花白背头」→ 浅灰发 + 偏分轮廓', () => {
    const params = portraitParams(2176427767, '六十岁，花白背头，白大褂')
    expect(params.hair).toBe('#a8adb8')
    expect(params.hairStyle).toBe(1)
  })

  it('「黑长直」→ 黑发长发轮廓', () => {
    const params = portraitParams(4057262402, '二十四岁，黑长直，酒红连衣裙')
    expect(params.hair).toBe('#1b1b21')
    expect(params.hairStyle).toBe(2)
  })

  it('「白大褂」→ 浅色衣服，和深色背景区分开', () => {
    const params = portraitParams(1, '六十岁，花白背头，白大褂')
    expect(params.cloth).toBe('#c9ced8')
  })

  it('抽象形容不改变 seed 默认值', () => {
    const base = portraitParams(42)
    const params = portraitParams(42, '气质出众，眼神深邃')
    expect(params).toEqual(base)
  })

  it('带锚点与不带锚点，只要锚点没命中规则就完全一致', () => {
    expect(portraitSvg(42, '一脸正气')).toBe(portraitSvg(42))
  })

  it('锚点命中时 SVG 确实变化，但同锚点同 seed 依然恒定', () => {
    const withLook = portraitSvg(42, '黑长直，酒红连衣裙')
    expect(withLook).not.toBe(portraitSvg(42))
    expect(portraitSvg(42, '黑长直，酒红连衣裙')).toBe(withLook)
  })
})
