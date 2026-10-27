import { useMemo } from 'react'
import { parsePlanFromMarkdown } from '../lib/parsePlan'

interface Props {
  markdown: string
  onClose: () => void
}

/** 从正文按标题抓取某一节原文（含 ### 子节）。 */
function section(md: string, keyword: string): string {
  const re = new RegExp(`^##[^\\n]*${keyword}[^\\n]*\\n([\\s\\S]*?)(?=^##\\s|(?![\\s\\S]))`, 'm')
  const m = md.match(re)
  return m ? m[1].trim() : ''
}

function bullets(text: string): string[] {
  return text
    .split('\n')
    .map((l) => l.replace(/^[\s\-*•\d.、）)]+/, '').trim())
    .filter((l) => l.length > 4 && !l.startsWith('|') && !l.startsWith('#'))
}

const BGM_MAP: { keys: string[]; label: string; tips: string[] }[] = [
  {
    keys: ['民国', '戏院', '上海', '旧', '租界'],
    label: '民国旧梦',
    tips: [
      '暖场：老上海爵士与留声机噪音（搜「1930s Shanghai jazz」）',
      '搜证：低音提琴+钢琴三拍子，克制不抢话',
      '揭晓：二胡或手风琴单旋律，收在最后一拍',
    ],
  },
  {
    keys: ['雪', '山庄', '孤岛', '封闭', '暴风雪'],
    label: '封闭孤馆',
    tips: [
      '暖场：风雪环境音 + 极简钢琴单音',
      '搜证：低频嗡鸣与钟表滴答，制造时间压力',
      '揭晓：弦乐渐强到断句，留一段静默再念真相',
    ],
  },
  {
    keys: ['古', '武侠', '江湖', '宫', '朝'],
    label: '古风江湖',
    tips: [
      '暖场：古琴泛音与箫声，慢板',
      '搜证：鼓点轻敲，节奏贴玩家发言',
      '揭晓：琵琶轮指，情绪收束在最后一句',
    ],
  },
  {
    keys: ['校园', '现代', '都市', '公司', '公寓'],
    label: '现代悬疑',
    tips: [
      '暖场：氛围电子与心跳低频',
      '搜证：Trip-hop 鼓组，音量压到 30%',
      '揭晓：持续音墙，在关键句前突然抽掉',
    ],
  },
]

/** DM 救场手册 + BGM 建议：开本现场的两块「即时可用」辅助。 */
export default function RescuePanel({ markdown, onClose }: Props) {
  const plan = useMemo(() => parsePlanFromMarkdown(markdown), [markdown])
  const rescue = useMemo(() => {
    const stuck = section(markdown, '易卡点')
    const tips = section(markdown, 'DM 开本提示')
    const list = [...bullets(stuck), ...bullets(tips)]
    return list.length ? list.slice(0, 8) : []
  }, [markdown])

  const bgm = useMemo(() => {
    const text = markdown.slice(0, 3000)
    const hit = BGM_MAP.map((g) => ({
      ...g,
      score: g.keys.filter((k) => text.includes(k)).length,
    })).sort((a, b) => b.score - a.score)[0]
    return hit && hit.score > 0 ? hit : BGM_MAP[3]
  }, [markdown])

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-panel rescue-panel" onClick={(e) => e.stopPropagation()}>
        <header className="modal-head">
          <h2>🆘 救场手册 &amp; 配乐</h2>
          <button className="icon-btn" onClick={onClose} aria-label="关闭救场手册">✕</button>
        </header>

        <div className="rescue-body">
          <section className="rescue-block">
            <h3>玩家卡住了这样救</h3>
            {rescue.length === 0 ? (
              <p className="tl-none">方案里没有「易卡点 / DM 提示」内容，可用下面的通用话术。</p>
            ) : (
              <ol className="rescue-list">
                {rescue.map((line, i) => (
                  <li key={i}>{line}</li>
                ))}
              </ol>
            )}
            <div className="rescue-generic">
              <p className="rescue-generic-title">通用救场三句</p>
              <ul>
                <li>「再确认一下：那个时间点，谁和谁在一起？」——把玩家拉回时间线。</li>
                <li>「这条线索不能证明他做了，只能证明他在场——区别在哪？」——拆穿结论跳跃。</li>
                <li>「如果有人的证词互相矛盾，你们先信谁？」——逼出立场对立。</li>
              </ul>
            </div>
          </section>

          <section className="rescue-block">
            <h3>配乐建议 · {bgm.label}</h3>
            <ul className="rescue-bgm">
              {bgm.tips.map((t, i) => (
                <li key={i}>{t}</li>
              ))}
            </ul>
            <p className="rescue-note">
              音量统一压在 20~30%，人声一出就自动让位；揭晓段落建议直接静音，比配乐更有压迫感。
            </p>
          </section>

          {plan.culprit?.character && (
            <section className="rescue-block">
              <h3>一句话答案（DM 私藏）</h3>
              <p className="rescue-answer">
                凶手是 <strong>{plan.culprit.character}</strong>
                {plan.culprit.motive ? `——${plan.culprit.motive.slice(0, 120)}` : ''}
              </p>
            </section>
          )}
        </div>
      </div>
    </div>
  )
}
