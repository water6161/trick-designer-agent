/**
 * 角色立绘一致性。
 *
 * 这个模块要解决的是「同一个角色，两次生成的图长得不像」——
 * 在没有图片生成 API 的前提下，把一致性拆成两个确定性的东西：
 *
 * 1. **文本锚点**：方案里每个角色都固化一段外形描述（发色/年龄/服装/标志物），
 *    拼进提示词时连同全局画风一起下发，任何画图工具拿到同一段话都会画出同一个人；
 * 2. **固定 seed**：seed 由「标题 + 角色名」哈希得出，不含随机量。
 *    同一份方案里，同一个角色无论重开多少次、换哪台机器，seed 都不变，
 *    用户把它填进画图工具（或本地的确定性 SVG 肖像）就得到同一张脸。
 *
 * 这里同时用一个 SVG 肖像把 seed 渲染出来：它不是「美术素材」，
 * 而是让「一致性」可被肉眼和单测验证——同 seed 必出同一张图。
 */
import type { PlanCharacter, PlanData } from '../types'

/** FNV-1a 32 位：短、无依赖、跨环境稳定（不用 Math.random，也不能用 Date）。 */
export function hashSeed(value: string): number {
  let hash = 0x811c9dc5
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash >>> 0
}

/** 角色的稳定标识：标题 + 姓名（不含序号，改名会变脸是合理的，换顺序不该变）。 */
export function characterSeed(title: string, name: string): number {
  return hashSeed(`${(title || '').trim()}::${(name || '').trim()}`)
}

const GENRE_STYLES: { match: RegExp; style: string }[] = [
  { match: /(古风|宫廷|武侠|江湖|朝堂|民国)/, style: '国风工笔重彩，绢本质感，暗红与墨色为主' },
  { match: /(日式|和风|校园|夏日祭|都市怪谈)/, style: '日式动画赛璐璐，干净线条，冷调阴影' },
  { match: /(变格|怪谈|灵异|超自然|梦魇)/, style: '暗调胶片质感，低饱和，强逆光与颗粒' },
  { match: /(科幻|赛博|未来|太空)/, style: '赛博朋克，霓虹冷光，金属与雾气' },
  { match: /(欧式|庄园|维多利亚|古堡|雪夜)/, style: '写实推理剧照感，冷灰蓝调，柔光' },
]

/** 全局画风锚点：整份方案共用一段，保证多张立绘「像同一部剧里的」。 */
export function styleAnchor(plan: PlanData | null | undefined): string {
  const fields = [plan?.title, plan?.genre, plan?.tagline, plan?.background]
    .filter((value): value is string => typeof value === 'string')
    .join(' ')
  const hit = GENRE_STYLES.find((item) => item.match.test(fields))
  const base = hit ? hit.style : '电影级写实人像，柔和侧光，浅景深'
  return `${base}；同一部剧本内所有角色统一画风、统一色调、统一镜头高度`
}

/** 每个角色最少要有的外形描述：没有锚点就退回到「身份 + 气质」，也比随机强。 */
function lookOf(character: PlanCharacter): string {
  const look = typeof character.look === 'string' ? character.look.trim() : ''
  if (look) return look
  const identity = typeof character.identity === 'string' ? character.identity.trim() : ''
  return identity ? `${identity}，着装与身份相符，神色克制` : '半身人像，面无表情，衣着朴素'
}

/**
 * 拼一个角色的完整绘图提示词。
 * 顺序按画图工具的习惯：主体 → 外形 → 构图 → 风格 → 一致性参数 → 负面词。
 */
export function characterPrompt(
  plan: PlanData | null | undefined,
  character: PlanCharacter,
  index = 0,
): string {
  const title = typeof plan?.title === 'string' ? plan.title : '未命名剧本'
  const name = (character.name || `角色${index + 1}`).trim()
  const identity = (character.identity || '').trim()
  const seed = characterSeed(title, name)

  return [
    `《${title}》角色立绘：${name}${identity ? `，${identity}` : ''}`,
    `外形：${lookOf(character)}`,
    '构图：半身正面，视线略偏，背景为场景虚化（不含文字与边框）',
    `画风：${styleAnchor(plan)}`,
    `一致性：seed ${seed}，同一角色所有图沿用此 seed 与外形描述`,
    '负面：不要多人、不要文字水印、不要改变发色与服装主色、不要漫画夸张表情',
  ].join('\n')
}

/** 一键复制的提示词包：整份方案的角色一起给，避免逐个复制时漏改画风。 */
export function promptPack(plan: PlanData | null | undefined): string {
  const characters = (plan?.characters || []).filter((c) => c && (c.name || c.identity))
  if (!characters.length) return ''
  const title = typeof plan?.title === 'string' ? plan.title : '未命名剧本'
  const header = [
    `《${title}》角色立绘提示词包（共 ${characters.length} 人）`,
    `统一画风：${styleAnchor(plan)}`,
    '用法：逐个角色生成，seed 与外形描述不要改；改 seed 会让同一角色换脸。',
    '',
  ].join('\n')
  return header + characters.map((c, i) => characterPrompt(plan, c, i)).join('\n\n')
}

/** 允许出现的形状枚举：都由 seed 决定，不引入随机。 */
interface PortraitParams {
  skin: string
  hair: string
  cloth: string
  accent: string
  hairStyle: 0 | 1 | 2
  shoulder: 'broad' | 'slim'
}

const SKINS = ['#e8c4a8', '#dcae8c', '#c99a76', '#b9835f', '#e3b795']
const HAIRS = ['#1b1b21', '#2e2119', '#41302a', '#5a3c28', '#8a8f99', '#2b2b33']
const CLOTHS = ['#3c4a63', '#5a3a3a', '#3f4a3c', '#4a3f5c', '#5c4a2e', '#2f3b44']

/** 外形锚点文字 → 发型轮廓：长发放下来，背头偏分，其余短发。 */
const LONG_HAIR_RE = /(长发|长直|披肩|马尾|辫)/
const SIDE_PART_RE = /(背头|中分|偏分)/

/** 外形锚点文字 → 发色。花白/银发给浅灰，黑给深黑，栗棕给褐色。 */
const HAIR_COLOR_RULES: [RegExp, string][] = [
  [/(灰白|花白|白发|银发|银白)/, '#a8adb8'],
  [/(金发|金黄)/, '#c9a75f'],
  [/(栗色|棕色|褐色|咖啡)/, '#5a3c28'],
  [/(黑发|黑长直|乌黑)/, '#1b1b21'],
]

/** 外形锚点文字 → 服装主色。白大褂要能和背景区分开。 */
const CLOTH_COLOR_RULES: [RegExp, string][] = [
  [/(白大褂|白衣|素服)/, '#c9ced8'],
  [/(酒红|红裙|红衣|红)/, '#5a3a3a'],
  [/(卡其|黄褐|驼色)/, '#5c4a2e'],
  [/(蓝|藏青|靛)/, '#31465e'],
  [/(绿|军装)/, '#3f4a3c'],
  [/(灰|长衫)/, '#43495a'],
]

/**
 * 把外形锚点文字落成可画的参数。
 * 只认「可被画出来」的具体词（发长/发色/服装主色），抽象形容自然落回 seed 默认值——
 * 文字与 seed 双轨都确定，所以同一角色依然恒定同一张脸。
 */
export function lookParams(look: string): Partial<PortraitParams> {
  const params: Partial<PortraitParams> = {}
  if (!look) return params
  if (LONG_HAIR_RE.test(look)) params.hairStyle = 2
  else if (SIDE_PART_RE.test(look)) params.hairStyle = 1
  for (const [re, color] of HAIR_COLOR_RULES) {
    if (re.test(look)) {
      params.hair = color
      break
    }
  }
  for (const [re, color] of CLOTH_COLOR_RULES) {
    if (re.test(look)) {
      params.cloth = color
      break
    }
  }
  return params
}

/** seed → 视觉参数。纯函数：同 seed 必得同参数。 */
export function portraitParams(seed: number, look = ''): PortraitParams {
  const pick = <T,>(list: readonly T[], shift: number): T => list[(seed >>> shift) % list.length]
  const base: PortraitParams = {
    skin: pick(SKINS, 0),
    hair: pick(HAIRS, 3),
    cloth: pick(CLOTHS, 6),
    accent: pick(CLOTHS, 9),
    hairStyle: (seed % 3) as 0 | 1 | 2,
    shoulder: seed % 5 === 0 ? 'slim' : 'broad',
  }
  return { ...base, ...lookParams(look) }
}

const HAIR_PATHS: string[] = [
  // 短发
  'M34 40 C34 22 50 16 60 16 C70 16 86 22 86 40 C86 30 76 26 60 26 C44 26 34 30 34 40 Z',
  // 偏分
  'M33 42 C31 20 48 14 60 14 C74 14 89 22 87 44 C84 30 72 30 62 33 C52 36 38 34 33 42 Z',
  // 长发（垂到肩）
  'M33 42 C31 20 48 14 60 14 C74 14 89 22 87 44 C92 60 90 76 84 86 C82 70 80 52 78 44 C74 34 46 34 42 44 C40 52 38 70 36 86 C30 74 29 58 33 42 Z',
]

/**
 * 确定性 SVG 肖像（120x140）。
 *
 * 不是美术资源，而是「seed 的可视化」：同一个 seed 一定得到同一张图，
 * 因此把它当作一致性自检——图不一样，说明 seed 或锚点被改动了。
 */
export function portraitSvg(seed: number, look = ''): string {
  const p = portraitParams(seed, look)
  const shoulderWidth = p.shoulder === 'broad' ? 44 : 36
  const gradId = `g${seed.toString(36)}`
  return [
    `<svg viewBox="0 0 120 140" width="120" height="140" role="img" aria-hidden="true" xmlns="http://www.w3.org/2000/svg">`,
    `<defs><linearGradient id="${gradId}" x1="0" y1="0" x2="0" y2="1">`,
    `<stop offset="0%" stop-color="#1a1e28"/><stop offset="100%" stop-color="#0e1119"/>`,
    `</linearGradient></defs>`,
    `<rect width="120" height="140" rx="10" fill="url(#${gradId})"/>`,
    // 肩部与衣物
    `<path d="M${60 - shoulderWidth} 140 C${60 - shoulderWidth} 108 ${60 - 22} 100 60 100 C${60 + 22} 100 ${60 + shoulderWidth} 108 ${60 + shoulderWidth} 140 Z" fill="${p.cloth}"/>`,
    `<path d="M52 104 L60 120 L68 104" stroke="${p.accent}" stroke-width="3" fill="none" opacity="0.7"/>`,
    // 脖子与脸
    `<rect x="53" y="82" width="14" height="20" rx="6" fill="${p.skin}" opacity="0.9"/>`,
    `<ellipse cx="60" cy="62" rx="21" ry="25" fill="${p.skin}"/>`,
    // 发型由 seed 决定三种轮廓
    `<path d="${HAIR_PATHS[p.hairStyle]}" fill="${p.hair}"/>`,
    // 五官（极简，避免恐怖谷）
    `<circle cx="52" cy="62" r="1.8" fill="#20242c"/><circle cx="68" cy="62" r="1.8" fill="#20242c"/>`,
    `<path d="M55 74 Q60 77 65 74" stroke="#8a5f52" stroke-width="1.6" fill="none" stroke-linecap="round"/>`,
    `</svg>`,
  ].join('')
}

/** 给 UI 用的角色立绘描述：seed + SVG + 提示词一次性算好。 */
export interface Portrait {
  name: string
  seed: number
  svg: string
  prompt: string
}

export function buildPortraits(plan: PlanData | null | undefined): Portrait[] {
  const title = typeof plan?.title === 'string' ? plan.title : ''
  return (plan?.characters || [])
    .filter((c) => c && (c.name || c.identity))
    .map((character, index) => {
      const name = (character.name || `角色${index + 1}`).trim()
      const seed = characterSeed(title, name)
      const look = typeof character.look === 'string' ? character.look : ''
      return { name, seed, svg: portraitSvg(seed, look), prompt: characterPrompt(plan, character, index) }
    })
}
