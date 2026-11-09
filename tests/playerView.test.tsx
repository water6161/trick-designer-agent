import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import PlayerView from '../src/components/PlayerView'
import { buildPlayerPacket } from '../src/lib/share'
import type { PlanData } from '../src/types'

/** 与 share.test.ts 同源的完整方案（含全部敏感字段）。 */
function fullPlan(): PlanData {
  return {
    title: '暴雪山庄的密室',
    tagline: '一句被篡改的死亡时间',
    background: '雪夜，山庄与外界断联。',
    victim: { name: '顾寒山', death_time: '第一幕 21:40', cause: '中毒', scene: '书房反锁' },
    characters: [
      { name: '沈墨', identity: '管家', secret: '他偷换了遗嘱', suspicion: '曾与死者争吵' },
      { name: '白棠', identity: '外甥女', secret: '她当晚并不在房里', suspicion: '继承顺位第一' },
    ],
    clues_public: [
      { id: 'C1', name: '调快的怀表', content: '怀表被调快二十分钟', points_to: '指向白棠', access: '公开阅读' },
    ],
    clues_deep: [{ id: 'D1', name: '药瓶', content: '药瓶内壁残留苦味', access: '搜证·书房抽屉' }],
    timeline: [
      { time: '21:40', event: '书房传出倒地声', witness: '众人', visibility: '公开' },
      { time: '21:55', event: '陆迟独自返回书房', witness: '监控', visibility: '深入' },
    ],
    culprit: { character: '白棠', motive: '她才是真正的继承人' },
    core_trick: { name: '时间错觉', principle: '调快怀表伪造死亡时间' },
    dm_tips: ['开场先强调雪夜封路'],
    hidden_ending: { ending: '白棠其实是被收养的替身' },
    interactions: [
      {
        title: '雨夜敲门',
        scene: '门外有人敲门',
        options: [
          { text: '开门', result: '你被拖进黑暗', type: '死亡结局' },
          { text: '从猫眼看', result: '走廊空无一人', type: '安全' },
        ],
      },
    ],
  }
}

describe('PlayerView 渲染不变式', () => {
  it('通用本页面绝不出现凶手身份与诡计原理', () => {
    const html = renderToStaticMarkup(<PlayerView plan={fullPlan()} />)
    expect(html).not.toContain('她才是真正的继承人')
    expect(html).not.toContain('调快怀表伪造死亡时间')
    expect(html).not.toContain('开场先强调雪夜封路')
    expect(html).not.toContain('白棠其实是被收养的替身')
    expect(html).not.toContain('他偷换了遗嘱')
    expect(html).not.toContain('她当晚并不在房里')
  })

  it('深入线索只渲染编号与获取方式，不渲染内容', () => {
    const html = renderToStaticMarkup(<PlayerView plan={fullPlan()} />)
    expect(html).toContain('搜证·书房抽屉')
    expect(html).not.toContain('苦味')
    expect(html).not.toContain('药瓶')
    expect(html).toContain('未解锁')
  })

  it('深入时间线不渲染', () => {
    const html = renderToStaticMarkup(<PlayerView plan={fullPlan()} />)
    expect(html).toContain('倒地声')
    expect(html).not.toContain('陆迟独自返回书房')
  })

  it('互动选项不渲染结局类型', () => {
    const html = renderToStaticMarkup(<PlayerView plan={fullPlan()} />)
    expect(html).toContain('开门')
    expect(html).not.toContain('死亡结局')
    expect(html).not.toContain('安全')
  })

  it('角色专属本回传本人秘密，仍然不含他人秘密', () => {
    const packet = buildPlayerPacket(fullPlan(), '沈墨')
    const html = renderToStaticMarkup(<PlayerView packet={packet} />)
    expect(html).toContain('只有你知道的事')
    expect(html).toContain('他偷换了遗嘱')
    expect(html).not.toContain('她当晚并不在房里')
    // 角色视角不再提供切换入口（fixed 模式）
    expect(html).not.toContain('按角色查看')
  })

  it('线索内容里的 HTML 不会进入 DOM', () => {
    const plan = fullPlan()
    plan.clues_public = [
      { id: 'C1', name: '注入', content: '<img src=x onerror=alert(1)>恶意', access: '公开' },
    ]
    const html = renderToStaticMarkup(<PlayerView plan={plan} />)
    expect(html).not.toContain('<img src=x')
    expect(html).toContain('&lt;img')
  })

  it('空方案渲染空壳与占位提示', () => {
    const html = renderToStaticMarkup(<PlayerView plan={null} />)
    expect(html).toContain('未命名剧本')
    expect(html).toContain('还没有可展示给玩家的内容')
  })

  it('分享页模式显示回主站入口，不显示关闭按钮', () => {
    const packet = buildPlayerPacket(fullPlan(), '')
    const html = renderToStaticMarkup(<PlayerView packet={packet} />)
    expect(html).toContain('我也要写一个')
    expect(html).not.toContain('aria-label="关闭玩家本"')
  })
})
