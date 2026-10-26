import { SparkIcon } from './icons'

interface Props {
  onPick: (prompt: string) => void
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

export default function Welcome({ onPick }: Props) {
  return (
    <section className="dossier">
      <div className="dossier-spine" aria-hidden="true">
        <span className="dossier-spine-code">ARCHIVE / 001</span>
        <span className="dossier-spine-year">CASE&nbsp;FILES</span>
      </div>

      <div className="dossier-sheet">
        <header className="dossier-head">
          <div className="dossier-stamp">绝密</div>
          <div className="dossier-head-main">
            <p className="dossier-kicker">
              <SparkIcon size={13} />
              资深诡计设计师 · 公平性裁判
            </p>
            <h2 className="dossier-title">
              先定舞台，
              <br />
              再设计一场无法被看穿的局。
            </h2>
            <p className="dossier-desc">
              告诉我题材、人数、难度与想要的诡计类型。我会检索经典套路与玩家雷点，输出完整诡计方案，
              并自动做公平性自查——线索够不够锁凶、有没有强行降智、还有哪些解释没被排除。
            </p>
          </div>
        </header>

        <div className="dossier-rule">
          <span>立案选题 / SELECT A CASE</span>
        </div>

        <div className="dossier-grid">
          {PRESETS.map((preset) => (
            <button key={preset.title} className="dossier-card" onClick={() => onPick(preset.prompt)}>
              <span className="dossier-card-no">{preset.no}</span>
              <span className="dossier-card-tag">{preset.tag}</span>
              <strong>{preset.title}</strong>
              <span className="dossier-card-desc">{preset.desc}</span>
              <span className="dossier-card-go" aria-hidden="true">
                调阅 →
              </span>
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
