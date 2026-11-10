import { useMemo, useState } from 'react'
import { parsePlanFromMarkdown } from '../lib/parsePlan'
import { copyText } from '../lib/exporters'
import { buildPortraits, promptPack, styleAnchor, type Portrait } from '../lib/illustration'
import type { PlanCharacter } from '../types'

interface Props {
  markdown: string
  onClose: () => void
}

/** 角色速览卡：给玩家的选角席位卡，裁开即可递给玩家。
 *  秘密/怀疑点默认隐藏，避免剧透；勾选「显示剧本提示」或打印时才带出。
 *  立绘走「固定锚点 + 固定 seed」：同角色重开多少次都是同一张脸，可直接拿去生成正稿。 */
export default function RoleCards({ markdown, onClose }: Props) {
  const plan = useMemo(() => parsePlanFromMarkdown(markdown), [markdown])
  const [reveal, setReveal] = useState(false)
  const [msg, setMsg] = useState('')
  const roles: PlanCharacter[] = (plan.characters || []).filter((c) => c.name || c.identity)
  const portraits: Portrait[] = useMemo(() => buildPortraits(plan), [plan])

  const copy = async (text: string, tip: string) => {
    const ok = await copyText(text)
    setMsg(ok ? tip : '复制失败，请手动选中文本')
    setTimeout(() => setMsg(''), 2400)
  }

  return (
    <div
      className="modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="角色速览卡"
      onClick={onClose}
    >
      <div className="modal-panel role-panel" onClick={(e) => e.stopPropagation()}>
        <header className="modal-head">
          <h2>🃏 角色速览卡</h2>
          <div className="modal-head-actions">
            <label className="reveal-toggle">
              <input type="checkbox" checked={reveal} onChange={(e) => setReveal(e.target.checked)} />
              显示剧本提示（含剧透）
            </label>
            {portraits.length > 0 && (
              <button
                className="immersive-btn"
                onClick={() => void copy(promptPack(plan), '已复制全部角色的立绘提示词')}
                title="含统一画风与每人的 seed，贴进任意画图工具即可保持同一张脸"
              >
                🎨 立绘提示词包
              </button>
            )}
            <button className="immersive-btn" onClick={() => window.print()}>
              打印
            </button>
            <button className="icon-btn" onClick={onClose} aria-label="关闭角色卡">✕</button>
          </div>
        </header>

        {roles.length === 0 ? (
          <p className="shelf-empty">这份方案里没有解析出角色表（需要「四、凶手与人物逻辑 · 角色表」）。</p>
        ) : (
          <>
            <p className="timeline-hint">
              共 {roles.length} 位角色。默认是「公开信息版」，可直接发给玩家；勾选上方选项才显示秘密，供 DM 对照。
              立绘用固定 seed 生成，同一角色每次都是同一张脸——换成正式插画时把提示词贴给画图工具即可。
            </p>
            {portraits.length > 0 && (
              <p className="role-style-anchor">统一画风：{styleAnchor(plan)}</p>
            )}
            {msg && <p className="role-toast">{msg}</p>}
            <div className={`role-grid printable ${reveal ? 'revealed' : ''}`}>
              {roles.map((role, i) => {
                const portrait = portraits[i]
                return (
                  <div className="role-card" key={i}>
                    <div className="role-card-top">
                      <span className="role-no">角色 {String(i + 1).padStart(2, '0')}</span>
                      <span className="role-name">{role.name || '未命名'}</span>
                    </div>

                    {portrait && (
                      <div className="role-portrait">
                        {/* SVG 由 seed 纯函数生成：不含用户文本插值，同 seed 必出同图 */}
                        <div
                          className="role-portrait-art"
                          data-seed={portrait.seed}
                          dangerouslySetInnerHTML={{ __html: portrait.svg }}
                        />
                        <div className="role-portrait-meta">
                          <span className="role-seed">seed {portrait.seed}</span>
                          <button
                            className="role-copy"
                            onClick={() =>
                              void copy(portrait.prompt, `已复制 ${portrait.name} 的立绘提示词`)
                            }
                          >
                            复制提示词
                          </button>
                        </div>
                        {role.look && <p className="role-look">{role.look}</p>}
                      </div>
                    )}

                    <p className="role-identity">{role.identity || '身份待补充'}</p>
                    <div className="role-spoiler">
                      {reveal ? (
                        <>
                          {role.secret && (
                            <p className="role-secret">
                              <span>人设提示</span>
                              {role.secret}
                            </p>
                          )}
                          {role.suspicion && (
                            <p className="role-suspicion">
                              <span>别人眼中的你</span>
                              {role.suspicion}
                            </p>
                          )}
                        </>
                      ) : (
                        <p className="role-hidden">剧本细节开本时由 DM 私发</p>
                      )}
                    </div>
                    <div className="role-blank">
                      <span>我的名字：</span>
                      <i />
                    </div>
                  </div>
                )
              })}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
