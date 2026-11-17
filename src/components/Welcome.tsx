import { useEffect, useRef, useState } from 'react'
import { SparkIcon } from './icons'
import type { AICoverMedia } from '../lib/api'

interface Props {
  onPick: (prompt: string) => void
  /** 首屏轮播点选画风：写入偏好，导出栏的 AI 封面默认用它 */
  onPickMedia?: (media: AICoverMedia) => void
}

const PRESETS = [
  {
    no: 'No.01',
    tag: '本格 · 密室',
    title: '暴雪山庄的密室',
    desc: '6 人硬核本，双重密室，要求线索可公开锁凶。',
    prompt:
      '题材：本格；6人；硬核难度；核心诡计要密室；特殊设定：暴风雪山庄，全员被困，第二具尸体出现在上锁的房间。请给一套完整方案。',
  },
  {
    no: 'No.02',
    tag: '民国 · 身份',
    title: '戏院里的替身',
    desc: '5 人民国本，身份互换 + 不在场证明。',
    prompt:
      '题材：民国；5人；进阶难度；想要身份诡计 + 不在场证明；特殊设定：戏院后台，名伶演出中途死亡，所有人都看见她上了台。请给一套完整方案。',
  },
  {
    no: 'No.03',
    tag: '变格 · 叙诡',
    title: '被写错的一天',
    desc: '6 人变格本，叙述性诡计，时间线错位。',
    prompt:
      '题材：变格；6人；硬核难度；想要叙诡 + 时间诡计；特殊设定：所有玩家都记得昨天是同一个日期，但证物指向不同的日子。请给一套完整方案。',
  },
  {
    no: 'No.04',
    tag: '科幻 · 时间',
    title: '第七次循环',
    desc: '5 人科幻本，循环设定下的身份与时间诡计。',
    prompt:
      '题材：科幻；5人；进阶难度；想要时间循环 + 身份诡计；特殊设定：空间站每 90 分钟重置一次记忆，死者在第三次循环中被发现。请给一套完整方案。',
  },
]

/** hero 画风轮播：静态资源（public/covers/*.webp，每张 10~16KB），展示 AI 封面的画风维度 */
export const COVER_REEL: { key: AICoverMedia; label: string; src: string }[] = [
  { key: 'cine', label: '电影剧照', src: 'covers/cine.webp' },
  { key: 'ukiyoe', label: '浮世绘', src: 'covers/ukiyoe.webp' },
  { key: 'ink', label: '水墨写意', src: 'covers/ink.webp' },
  { key: 'noir', label: '黑白电影', src: 'covers/noir.webp' },
]

const REEL_INTERVAL_MS = 3400
/** 点案件卡到真正立案的间隔：给「立案中」印章留出登场时间 */
const STAMP_DELAY_MS = 480

export default function Welcome({ onPick, onPickMedia }: Props) {
  const sheetRef = useRef<HTMLDivElement>(null)
  const [tilt, setTilt] = useState({ x: 0, y: 0, gx: 50, gy: 30 })
  const [reelIndex, setReelIndex] = useState(0)
  // 点案件卡先盖「立案中」章再立案——反馈即时可见，但不阻塞真正的发送
  const [stamping, setStamping] = useState<string | null>(null)

  // 鼠标跟随：卷宗轻微 3D 倾斜 + 光晕跟随（用 rAF 节流，避免高频 mousemove 触发过多渲染）
  useEffect(() => {
    const node = sheetRef.current
    if (!node) return
    let frame = 0
    let pending: MouseEvent | null = null
    const apply = () => {
      frame = 0
      const event = pending
      pending = null
      if (!event) return
      const rect = node.getBoundingClientRect()
      const px = (event.clientX - rect.left) / rect.width
      const py = (event.clientY - rect.top) / rect.height
      setTilt({
        x: (0.5 - py) * 4,
        y: (px - 0.5) * 5,
        gx: Math.max(0, Math.min(100, px * 100)),
        gy: Math.max(0, Math.min(100, py * 100)),
      })
    }
    const onMove = (event: MouseEvent) => {
      pending = event
      if (!frame) frame = requestAnimationFrame(apply)
    }
    const onLeave = () => {
      if (frame) {
        cancelAnimationFrame(frame)
        frame = 0
      }
      pending = null
      setTilt({ x: 0, y: 0, gx: 50, gy: 30 })
    }
    node.addEventListener('mousemove', onMove)
    node.addEventListener('mouseleave', onLeave)
    return () => {
      if (frame) cancelAnimationFrame(frame)
      node.removeEventListener('mousemove', onMove)
      node.removeEventListener('mouseleave', onLeave)
    }
  }, [])

  // 轮播自动切换：用户偏好减少动效时保持第一张不动
  useEffect(() => {
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    if (reduce) return
    const timer = window.setInterval(
      () => setReelIndex((index) => (index + 1) % COVER_REEL.length),
      REEL_INTERVAL_MS,
    )
    return () => window.clearInterval(timer)
  }, [])

  const pickPreset = (preset: (typeof PRESETS)[number]) => {
    if (stamping) return
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    if (reduce) {
      onPick(preset.prompt)
      return
    }
    setStamping(preset.title)
    window.setTimeout(() => onPick(preset.prompt), STAMP_DELAY_MS)
  }

  const active = COVER_REEL[reelIndex]

  return (
    <section className="dossier">
      <div className="dossier-spine" aria-hidden="true">
        <span className="dossier-spine-code">ARCHIVE / 001</span>
        <span className="dossier-spine-year">CASE&nbsp;FILES</span>
      </div>

      <div
        className="dossier-sheet"
        ref={sheetRef}
        style={
          {
            '--tilt-x': `${tilt.x}deg`,
            '--tilt-y': `${tilt.y}deg`,
            '--glow-x': `${tilt.gx}%`,
            '--glow-y': `${tilt.gy}%`,
          } as React.CSSProperties
        }
      >
        <div className="dossier-glow" aria-hidden="true" />

        <header className="dossier-head">
          <div className="dossier-stamp" aria-hidden="true">
            绝密
          </div>
          <div className="dossier-head-main">
            <p className="dossier-kicker">
              <SparkIcon size={13} />
              资深诡计设计师 · 公平性裁判
            </p>
            <h2 className="dossier-title">
              <span>先定舞台，</span>
              <span>再设计一场无法被看穿的局。</span>
            </h2>
            <p className="dossier-desc">
              告诉我题材、人数、难度与想要的诡计类型。我会检索经典套路与玩家雷点，输出完整诡计方案，
              并自动做公平性自查——线索够不够锁凶、有没有强行降智、还有哪些解释没被排除。
            </p>
            {/* 三步上手：竖排三行，编号圆点加大——这是新用户最先该看到的东西 */}
            <ol className="dossier-steps" aria-label="三步上手">
              <li>
                <b>直接打字</b>说需求（题材、人数、难度），回车发送
              </li>
              <li>
                点下面的<b>案件卡</b>，立即以此立案生成
              </li>
              <li>
                赶时间？打开输入框旁的 <b>⚡ 极速</b>，约 15 秒出主线
              </li>
            </ol>
          </div>

          {/* 画风轮播：把「AI 封面有十种画风」直接摆出来，点选即设为默认画风 */}
          <div className="dossier-reel">
            <div className="reel-frame">
              {COVER_REEL.map((item, index) => (
                <img
                  key={item.key}
                  className={`reel-img ${index === reelIndex ? 'active' : ''}`}
                  src={item.src}
                  alt={index === reelIndex ? `AI 封面画风示例：${item.label}` : ''}
                  width={132}
                  height={176}
                />
              ))}
            </div>
            <button
              type="button"
              className="reel-chip"
              onClick={() => onPickMedia?.(active.key)}
              title="生成封面时默认用这个画风，之后可在导出栏更换"
            >
              {active.label} · 设为默认
            </button>
            <span className="reel-note">AI 封面 · 共 10 种画风</span>
          </div>
        </header>

        <div className="dossier-rule">
          <span>立案选题 / SELECT A CASE</span>
        </div>

        <div className="dossier-grid">
          {PRESETS.map((preset, index) => (
            <button
              key={preset.title}
              className={`dossier-card ${stamping === preset.title ? 'stamping' : ''}`}
              style={{ animationDelay: `${0.28 + index * 0.07}s` }}
              onClick={() => pickPreset(preset)}
              disabled={Boolean(stamping)}
            >
              <span className="dossier-card-no">{preset.no}</span>
              <span className="dossier-card-tag">{preset.tag}</span>
              <strong>{preset.title}</strong>
              <span className="dossier-card-desc">{preset.desc}</span>
              <span className="dossier-card-go" aria-hidden="true">
                点击直接立案 →
              </span>
              {stamping === preset.title && (
                <span className="card-stamp" aria-hidden="true">
                  立案中
                </span>
              )}
            </button>
          ))}
        </div>

        <footer className="dossier-foot">
          <span className="dossier-foot-label">支持迭代</span>
          <span>调整难度</span>
          <span>更换诡计</span>
          <span>增删角色</span>
          <span>修复漏洞</span>
          <span>加反转</span>
        </footer>
      </div>
    </section>
  )
}
