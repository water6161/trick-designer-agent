import { useMemo, useState } from 'react'
import {
  buildPlayerPacket,
  buildShareLink,
  encodePacket,
  MAX_SHARE_CHARS,
  type PlayerPacket,
} from '../lib/share'
import type { PlanData } from '../types'

interface Props {
  /** 主站内打开时传完整方案，组件自己按角色裁剪 */
  plan?: PlanData | null
  /** 分享页打开时直接给已裁剪好的包（不再计算，避免二次裁剪出错） */
  packet?: PlayerPacket | null
  onClose?: () => void
}

/**
 * 玩家本：同一份方案的「无剧透」视角。
 *
 * 注意这里没有任何「隐藏 DOM / 加遮罩」的技巧——拿到的数据里本来就没有凶手、
 * 诡计原理与 DM 提示（见 lib/share.ts 的白名单裁剪）。所以这份视图可以直接
 * 打包成链接发给玩家，而不只是「给 DM 看的预览」。
 */
export default function PlayerView({ plan, packet: fixed, onClose }: Props) {
  const [role, setRole] = useState(() => fixed?.role ?? '')
  const [link, setLink] = useState('')
  const [hint, setHint] = useState('')
  const [busy, setBusy] = useState(false)

  const packet = useMemo(() => fixed ?? buildPlayerPacket(plan, role), [fixed, plan, role])
  const editable = !fixed

  const empty = !packet.clues.length && !packet.cast.length && !packet.background

  const makeLink = async () => {
    if (busy) return
    setBusy(true)
    setHint('')
    try {
      const token = await encodePacket(packet)
      if (token.length > MAX_SHARE_CHARS) {
        setHint(`这份玩家本太长（${token.length} 字符），超出链接可承载的长度，请减少线索或背景篇幅。`)
        return
      }
      const url = buildShareLink(token)
      setLink(url)
      try {
        await navigator.clipboard.writeText(url)
        setHint(`已复制到剪贴板 · ${token.length} 字符`)
      } catch {
        // 非 https 或用户拒绝授权时剪贴板不可用，保留输入框让用户手动复制
        setHint('已生成链接，请手动复制下方地址')
      }
    } catch {
      setHint('生成链接失败，请稍后重试')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className={fixed ? 'pv-standalone' : 'modal-overlay'} onClick={onClose}>
      <div
        className={fixed ? 'pv-sheet pv-sheet-full' : 'modal-panel pv-sheet'}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-head">
          <div className="pv-head-text">
            <h2>{packet.title}</h2>
            {packet.tagline && <p className="pv-tagline">{packet.tagline}</p>}
          </div>
          <div className="modal-head-actions">
            {!fixed && (
              <button
                className="pv-print"
                onClick={() => window.print()}
                title="按角色本排版打印，线下开本可直接发给玩家"
              >
                🖨 打印
              </button>
            )}
            {fixed && (
              <a className="pv-home" href="./" title="用 AI 写一份自己的剧本">
                我也要写一个
              </a>
            )}
            {onClose && (
              <button className="icon-btn" onClick={onClose} aria-label="关闭玩家本">
                ✕
              </button>
            )}
          </div>
        </div>

        <div className="pv-scroll">
          <div className="pv-note">
            <span className="pv-note-badge">玩家本</span>
            本页数据在生成时已剔除凶手身份、诡计原理、DM 提示与结局走向——
            <strong>不是打码，是没下发</strong>。可以放心发给玩家。
          </div>

          {editable && packet.cast.length > 0 && (
            <div className="pv-roles">
              <span className="pv-roles-label">按角色查看</span>
              <button
                className={`pv-role-chip ${role === '' ? 'on' : ''}`}
                onClick={() => setRole('')}
              >
                通用本
              </button>
              {packet.cast.map((item) => (
                <button
                  key={item.name}
                  className={`pv-role-chip ${role === item.name ? 'on' : ''}`}
                  onClick={() => setRole(item.name || '')}
                >
                  {item.name}
                </button>
              ))}
            </div>
          )}

          {empty && <p className="pv-empty">这份方案还没有可展示给玩家的内容，先生成一份完整方案吧。</p>}

          {role && packet.cast.some((c) => c.name === role) && (
            <section className="pv-mine">
              <h3>你的身份</h3>
              {packet.cast
                .filter((c) => c.name === role)
                .map((c) => (
                  <div key={c.name} className="pv-mine-card">
                    <p className="pv-mine-name">
                      {c.name}
                      {c.identity && <span className="pv-mine-identity">{c.identity}</span>}
                    </p>
                    {c.secret && (
                      <p className="pv-mine-row">
                        <strong>只有你知道的事</strong>
                        {c.secret}
                      </p>
                    )}
                    {c.suspicion && (
                      <p className="pv-mine-row">
                        <strong>你需要澄清的疑点</strong>
                        {c.suspicion}
                      </p>
                    )}
                  </div>
                ))}
            </section>
          )}

          {(packet.background || packet.victim?.name) && (
            <section className="pv-block">
              <h3>案发背景</h3>
              {packet.victim?.name && (
                <ul className="pv-victim">
                  <li>
                    <span>死者</span>
                    {packet.victim.name}
                    {packet.victim.identity && <em>（{packet.victim.identity}）</em>}
                  </li>
                  {packet.victim.death_time && (
                    <li>
                      <span>死亡时间</span>
                      {packet.victim.death_time}
                    </li>
                  )}
                  {packet.victim.cause && (
                    <li>
                      <span>死因</span>
                      {packet.victim.cause}
                    </li>
                  )}
                  {packet.victim.scene && (
                    <li>
                      <span>现场</span>
                      {packet.victim.scene}
                    </li>
                  )}
                </ul>
              )}
              {packet.background && <p className="pv-body">{packet.background}</p>}
            </section>
          )}

          {packet.cast.length > 0 && (
            <section className="pv-block">
              <h3>在场者</h3>
              <ul className="pv-cast">
                {packet.cast.map((c) => (
                  <li key={c.name}>
                    <span className="pv-cast-name">{c.name}</span>
                    {c.identity && <span className="pv-cast-id">{c.identity}</span>}
                    {c.suspicion && <span className="pv-cast-suspect">{c.suspicion}</span>}
                  </li>
                ))}
              </ul>
              <p className="pv-foot-note">其他人的秘密不在你的本里——那是你要在讨论中问出来的东西。</p>
            </section>
          )}

          {packet.clues.length > 0 && (
            <section className="pv-block">
              <h3>公开线索</h3>
              <ul className="pv-clues">
                {packet.clues.map((c) => (
                  <li key={c.id || c.content}>
                    {c.id && <span className="pv-clue-id">{c.id}</span>}
                    <span className="pv-clue-text">
                      {c.name && <strong>{c.name}</strong>}
                      {c.content}
                    </span>
                    {c.access && <span className="pv-clue-access">{c.access}</span>}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {packet.deep.length > 0 && (
            <section className="pv-block">
              <h3>
                深入线索 <span className="pv-locked">搜证后由 DM 发放</span>
              </h3>
              <ul className="pv-clues pv-clues-locked">
                {packet.deep.map((c) => (
                  <li key={c.id || c.access}>
                    {c.id && <span className="pv-clue-id">{c.id}</span>}
                    <span className="pv-clue-text">
                      <strong>未解锁</strong>
                      {c.access ? `——搜证时可从「${c.access}」取得` : '——满足条件后向 DM 索取'}
                    </span>
                  </li>
                ))}
              </ul>
              <p className="pv-foot-note">内容不在你的本里：拿到手才知道上面写了什么。</p>
            </section>
          )}

          {packet.timeline.length > 0 && (
            <section className="pv-block">
              <h3>已知时间线</h3>
              <ul className="pv-timeline">
                {packet.timeline.map((item, i) => (
                  <li key={`${item.time}-${i}`}>
                    <span className="pv-time">{item.time}</span>
                    <span className="pv-event">
                      {item.event}
                      {item.witness && <em>（{item.witness}）</em>}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {packet.interactions.length > 0 && (
            <section className="pv-block">
              <h3>
                你可能遇到的抉择 <span className="pv-locked">结果由 DM 现场推进</span>
              </h3>
              {packet.interactions.map((node, i) => (
                <div className="pv-node" key={`${node.title}-${i}`}>
                  <h4>{node.title}</h4>
                  {node.scene && <p className="pv-body">{node.scene}</p>}
                  <ol className="pv-options">
                    {node.options.map((opt) => (
                      <li key={opt.text}>{opt.text}</li>
                    ))}
                  </ol>
                </div>
              ))}
            </section>
          )}
        </div>

        <div className="pv-foot">
          <div className="pv-foot-left">
            {role ? `当前：${role} 的本` : '当前：通用玩家本（不含任何人的秘密）'}
          </div>
          <div className="pv-foot-actions">
            {hint && <span className="pv-hint">{hint}</span>}
            <button className="pv-share" onClick={() => void makeLink()} disabled={busy || empty}>
              {busy ? '生成中…' : '🔗 复制分享链接'}
            </button>
          </div>
        </div>

        {link && (
          <div className="pv-link">
            <input
              className="pv-link-input"
              value={link}
              readOnly
              onFocus={(e) => e.currentTarget.select()}
              aria-label="分享链接"
            />
          </div>
        )}
      </div>
    </div>
  )
}
