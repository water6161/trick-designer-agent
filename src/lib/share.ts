/**
 * 玩家本：把一份完整方案裁剪成「某个玩家能看到的子集」，并编码进 URL 分享。
 *
 * 设计要点（这是整个文件的立论）：
 * 遮罩发生在**数据层**，不是 CSS 层。`buildPlayerPacket` 用显式白名单逐字段复制，
 * 绝不 spread 原对象——凶手、诡计原理、DM 提示、红鲱鱼排除方式、隐藏结局这些字段
 * 在编码前就已经从对象里消失。因此即便有人在开发者工具里改样式、扒 JSON，
 * 也还原不出他没权限看的内容。真正的权限化渲染，前提是「不该下发的数据根本不下发」。
 */
import type { PlanData } from '../types'

/** 玩家可见的线索：去掉 points_to（指向/排除 = 答案的边）与 why_fair（DM 视角的自证）。 */
export interface PlayerClue {
  id?: string
  name?: string
  content?: string
  access?: string
}

export interface PlayerCharacter {
  name?: string
  identity?: string
  suspicion?: string
  /** 只有「这是我的本」时才存在 */
  secret?: string
}

export interface PlayerTimeline {
  time?: string
  event?: string
  witness?: string
}

/** 互动节点：选项的结局类型（死亡/存疑/安全）属于剧透，不随玩家本下发。 */
export interface PlayerNode {
  title: string
  scene: string
  options: Array<{ text: string; result?: string }>
}

export interface PlayerPacket {
  v: 1
  title: string
  tagline?: string
  background?: string
  victim?: { name?: string; identity?: string; death_time?: string; cause?: string; scene?: string }
  /** 这份本属于哪个角色；空字符串表示「通用玩家本」（不含任何人的秘密） */
  role: string
  cast: PlayerCharacter[]
  clues: PlayerClue[]
  deep: PlayerClue[]
  timeline: PlayerTimeline[]
  interactions: PlayerNode[]
}

const MAX_BACKGROUND = 700

function str(value: unknown, limit = 0): string {
  const text = typeof value === 'string' ? value.trim() : ''
  return limit > 0 ? text.slice(0, limit) : text
}

function arr(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function obj(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
}

/**
 * 生成玩家本。
 *
 * @param plan  完整方案（meta.plan 或 parsePlan 兜底解析的结果）
 * @param role  视角角色名；传空则产出通用玩家本
 */
export function buildPlayerPacket(plan: PlanData | null | undefined, role = ''): PlayerPacket {
  const source = obj(plan)
  const me = str(role)

  // 白名单：逐字段显式搬运。新增字段时必须在这里主动加，否则默认不下发。
  const victimRaw = obj(source.victim)
  const victim = {
    name: str(victimRaw.name, 20) || undefined,
    identity: str(victimRaw.identity, 40) || undefined,
    death_time: str(victimRaw.death_time, 30) || undefined,
    cause: str(victimRaw.cause, 80) || undefined,
    scene: str(victimRaw.scene, 120) || undefined,
  }

  const cast = arr(source.characters)
    .map((item) => {
      const row = obj(item)
      const name = str(row.name, 20)
      const entry: PlayerCharacter = {
        name: name || undefined,
        identity: str(row.identity, 40) || undefined,
        suspicion: str(row.suspicion, 160) || undefined,
      }
      // 秘密只回给当事人：别人的秘密是推理对象，不是背景资料
      if (me && name === me) {
        const secret = str(row.secret, 200)
        if (secret) entry.secret = secret
      }
      return entry
    })
    .filter((item) => item.name)

  const clueOf = (item: unknown): PlayerClue => {
    const row = obj(item)
    return {
      id: str(row.id, 12) || undefined,
      name: str(row.name, 30) || undefined,
      content: str(row.content, 300) || undefined,
      access: str(row.access, 40) || undefined,
    }
  }
  const clues = arr(source.clues_public).map(clueOf).filter((c) => c.id || c.content)
  // 深入线索是搜证奖励：玩家本里只留「有这么一张、去哪儿拿」，内容和标题都不下发，
  // 否则玩家在开场就翻到了本该第二轮才拿到的物证。
  const deep = arr(source.clues_deep)
    .map((item) => {
      const row = obj(item)
      return { id: str(row.id, 12) || undefined, access: str(row.access, 40) || undefined }
    })
    .filter((c) => c.id || c.access)

  const timeline = arr(source.timeline)
    .map((item) => {
      const row = obj(item)
      return {
        time: str(row.time, 24),
        event: str(row.event, 160),
        witness: str(row.witness, 40) || undefined,
        visibility: str(row.visibility, 8),
      }
    })
    // 只下发公开时间点：深入时间线要靠搜证解锁
    .filter((item) => item.event && item.visibility !== '深入')
    .map(({ time, event, witness }) => ({ time, event, witness }))

  const interactions = arr(source.interactions)
    .map((item) => {
      const row = obj(item)
      return {
        title: str(row.title, 40) || '互动节点',
        scene: str(row.scene, 320),
        options: arr(row.options)
          .map((opt) => {
            const line = obj(opt)
            return { text: str(line.text, 120), result: str(line.result, 240) || undefined }
          })
          .filter((opt) => opt.text),
      }
    })
    .filter((node) => node.options.length >= 2)

  return {
    v: 1,
    title: str(source.title, 40) || '未命名剧本',
    tagline: str(source.tagline, 60) || undefined,
    background: str(source.background, MAX_BACKGROUND) || undefined,
    victim,
    role: me,
    cast,
    clues,
    deep,
    timeline,
    interactions,
  }
}

// ───────────────────────── 编码 ─────────────────────────
//
// 链接格式：#/s/{flag}{payload}
//   flag = 'z' → deflate-raw 压缩后的 base64url
//   flag = 'n' → 未压缩的 base64url（环境不支持 CompressionStream 时的降级）
//
// 为什么不用后端短链：会话数据存在带 user_id 鉴权的 Blob 存储里，匿名访问天然不成立，
// 为了分享去开一个无鉴权读接口属于纯增攻击面。方案本身是静态可读数据，压进 URL
// 正好换来「零存储、零鉴权、链接即快照」——代价是链接较长、且内容不会随后续修改更新。

const FLAG_DEFLATE = 'z'
const FLAG_RAW = 'n'
/** URL 上限保护：主流浏览器约 2MB，但聊天软件常在 8KB 处截断，这里取保守值 */
export const MAX_SHARE_CHARS = 6000

function toBase64Url(bytes: Uint8Array): string {
  let binary = ''
  // 分块避免 apply 参数过多导致栈溢出（大剧本能到几 KB）
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function fromBase64Url(text: string): Uint8Array {
  const normalized = text.replace(/-/g, '+').replace(/_/g, '/')
  const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4)
  const binary = atob(padded)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
  return bytes
}

/** 复制成独立 ArrayBuffer：避免子视图的 buffer 类型歧义（TS 的 BlobPart 不接受 SharedArrayBuffer 视图）。 */
function bufferOf(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
}

async function squeeze(bytes: Uint8Array): Promise<Uint8Array | null> {
  if (typeof CompressionStream === 'undefined') return null
  try {
    const stream = new Blob([bufferOf(bytes)]).stream().pipeThrough(new CompressionStream('deflate-raw'))
    const buffer = await new Response(stream).arrayBuffer()
    return new Uint8Array(buffer)
  } catch {
    return null
  }
}

async function expand(bytes: Uint8Array): Promise<Uint8Array | null> {
  if (typeof DecompressionStream === 'undefined') return null
  try {
    const stream = new Blob([bufferOf(bytes)]).stream().pipeThrough(new DecompressionStream('deflate-raw'))
    const buffer = await new Response(stream).arrayBuffer()
    return new Uint8Array(buffer)
  } catch {
    return null
  }
}

/** 编码成可放进 hash 的字符串（不含 # 前缀）。 */
export async function encodePacket(packet: PlayerPacket, forceRaw = false): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(packet))
  if (!forceRaw) {
    const packed = await squeeze(bytes)
    if (packed && packed.length < bytes.length) {
      return FLAG_DEFLATE + toBase64Url(packed)
    }
  }
  return FLAG_RAW + toBase64Url(bytes)
}

function isPacket(value: unknown): value is PlayerPacket {
  if (!value || typeof value !== 'object') return false
  const row = value as Record<string, unknown>
  return row.v === 1 && typeof row.title === 'string' && Array.isArray(row.cast)
}

/**
 * 解码分享串。任何异常都返回 null 而不是抛错——
 * 分享链接会被聊天软件改写、被用户手工截断，解析失败必须降级成「链接无效」页面。
 */
export async function decodePacket(text: string): Promise<PlayerPacket | null> {
  const body = (text || '').trim()
  if (!body || body.length > MAX_SHARE_CHARS * 4) return null
  const flag = body[0]
  let bytes: Uint8Array
  try {
    bytes = fromBase64Url(body.slice(1))
  } catch {
    return null
  }

  if (flag === FLAG_DEFLATE) {
    const raw = await expand(bytes)
    if (!raw) return null
    bytes = raw
  } else if (flag !== FLAG_RAW) {
    return null
  }

  try {
    const parsed: unknown = JSON.parse(new TextDecoder().decode(bytes))
    return isPacket(parsed) ? parsed : null
  } catch {
    return null
  }
}

/** 从 location.hash 中取出分享串；不是分享页时返回空串。 */
export function readShareToken(hash: string): string {
  const match = (hash || '').match(/^#\/s\/([A-Za-z0-9_-]+)$/)
  return match ? match[1] : ''
}

export function hasShareToken(hash: string): boolean {
  return readShareToken(hash).length > 0
}

/** 拼成完整分享链接（同时带上站点已有的 base path，兼容部署在子路径的情况）。 */
export function buildShareLink(token: string, base?: { origin: string; pathname: string }): string {
  const where = base ?? (typeof location !== 'undefined' ? location : { origin: '', pathname: '/' })
  return `${where.origin}${where.pathname}#/s/${token}`
}
