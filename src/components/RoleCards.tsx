import { useMemo, useState } from 'react'
import { parsePlanFromMarkdown } from '../lib/parsePlan'
import type { PlanCharacter } from '../types'

interface Props {
  markdown: string
  onClose: () => void
}

/** 角色速览卡：给玩家的选角席位卡，裁开即可递给玩家。
 *  秘密/怀疑点默认隐藏，避免剧透；勾选「显示剧本提示」或打印时才带出。 */
export default function RoleCards({ markdown, onClose }: Props) {
  const plan = useMemo(() => parsePlanFromMarkdown(markdown), [markdown])
  const [reveal, setReveal] = useState(false)
  const roles: PlanCharacter[] = (plan.characters || []).filter((c) => c.name || c.identity)

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-panel role-panel" onClick={(e) => e.stopPropagation()}>
        <header className="modal-head">
          <h2>🃏 角色速览卡</h2>
          <div className="modal-head-actions">
            <label className="reveal-toggle">
              <input type="checkbox" checked={reveal} onChange={(e) => setReveal(e.target.checked)} />
              显示剧本提示（含剧透）
            </label>
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
              打印后裁开，每人一张。
            </p>
            <div className={`role-grid printable ${reveal ? 'revealed' : ''}`}>
              {roles.map((role, i) => (
                <div className="role-card" key={i}>
                  <div className="role-card-top">
                    <span className="role-no">角色 {String(i + 1).padStart(2, '0')}</span>
                    <span className="role-name">{role.name || '未命名'}</span>
                  </div>
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
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
