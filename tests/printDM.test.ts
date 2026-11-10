import { describe, expect, it, vi } from 'vitest'
import { dmSheetHtml, printDM, type DMPhaseSheet } from '../src/lib/printDM'

const PHASES: DMPhaseSheet[] = [
  {
    key: 'intro',
    label: '开场',
    minutes: 10,
    brief: '介绍背景与规则，提醒玩家「所有人都在说谎，但线索不会」。',
    clues: [],
  },
  {
    key: 'round1',
    label: '第一轮·公开线索',
    minutes: 15,
    brief: '按清单逐一发放公开线索。',
    clues: [
      { id: 'C1', name: '炉灰里的怀表零件', points_to: '医生' },
      { id: 'C2', name: '半截烧焦的录音带', points_to: '管家' },
    ],
  },
  {
    key: 'vote',
    label: '投票指认',
    minutes: 3,
    brief: '每人一票。',
    clues: [],
  },
]

describe('DM 手册渲染', () => {
  const html = dmSheetHtml(PHASES, {
    title: '暴雪山庄的密室',
    genre: '本格',
    players: '5 人',
    difficulty: '进阶',
    culprit: '医生',
    motive: '为十年前的手术事故复仇',
    hiddenEnding: '全员隐瞒了死者的真实死因',
    endings: [
      { name: '真结局·怀表停了', condition: '指认医生且出示 C1', clues: 'C1、C2', outcome: '真相大白' },
      { name: '替罪羊结局', condition: '指认管家', clues: 'C2', outcome: '管家被冤' },
    ],
  })

  it('渲染手册抬头与剧本名', () => {
    expect(html).toContain('DM 主持手册')
    expect(html).toContain('<h1>《暴雪山庄的密室》</h1>')
  })

  it('元信息行包含题材人数难度', () => {
    expect(html).toContain('题材：本格')
    expect(html).toContain('人数：5 人')
    expect(html).toContain('难度：进阶')
  })

  it('阶段一览表列出每个阶段与合计时长', () => {
    expect(html).toContain('<table class="hand-sum">')
    expect(html).toContain('第一轮·公开线索')
    expect(html).toContain('28 分钟') // 10 + 15 + 3
  })

  it('一览表里标出每阶段要发的线索数', () => {
    expect(html).toContain('2 条')
    expect(html).toContain('—')
  })

  it('每个阶段都有编号、引导词与建议时长', () => {
    expect(html).toContain('<h2>1. 开场</h2>')
    expect(html).toContain('<h2>2. 第一轮·公开线索</h2>')
    expect(html).toContain('按清单逐一发放公开线索。')
    expect(html).toContain('15 分钟')
  })

  it('线索排成可打勾的方框，含编号与指向', () => {
    expect(html).toContain('发放清单（2 条，发出后打勾）')
    expect(html).toContain('<span class="box"></span>')
    expect(html).toContain('<span class="cid">C1</span>')
    expect(html).toContain('炉灰里的怀表零件')
    expect(html).toContain('→ 医生')
  })

  it('没有线索的阶段不出现发放清单', () => {
    const introBlock = html.slice(html.indexOf('<h2>1. 开场</h2>'), html.indexOf('<h2>2. 第一轮'))
    expect(introBlock).not.toContain('发放清单')
  })

  it('复盘块含凶手、动机、隐藏结局与结局表', () => {
    expect(html).toContain('<h2>复盘念稿</h2>')
    expect(html).toContain('凶手：</strong>医生')
    expect(html).toContain('为十年前的手术事故复仇')
    expect(html).toContain('全员隐瞒了死者的真实死因')
    expect(html).toContain('分支结局（2 条）')
    expect(html).toContain('真结局·怀表停了')
    expect(html).toContain('C1、C2')
  })

  it('没有复盘内容时整块不渲染', () => {
    const bare = dmSheetHtml(PHASES, { title: '空本' })
    expect(bare).not.toContain('复盘念稿')
    expect(bare).toContain('《空本》')
  })

  it('转义用户内容，避免破坏结构', () => {
    const escaped = dmSheetHtml(
      [
        {
          key: 'intro',
          label: '<script>alert(1)</script>',
          minutes: 5,
          brief: 'a & b < c',
          clues: [{ id: 'C1', name: '"引号"' }],
        },
      ],
      { title: '<img onerror=x>' },
    )
    expect(escaped).not.toContain('<script>')
    expect(escaped).toContain('&lt;script&gt;')
    expect(escaped).toContain('a &amp; b &lt; c')
    expect(escaped).toContain('&quot;引号&quot;')
    expect(escaped).not.toContain('<img onerror')
  })

  it('线索没有名字时退化到内容首句', () => {
    const fallback = dmSheetHtml(
      [
        {
          key: 'round1',
          label: '公开线索',
          minutes: 10,
          brief: '发线索',
          clues: [{ id: 'C1', content: '炉灰里有一枚怀表零件。还有别的细节没写进线索名。' }],
        },
      ],
      {},
    )
    expect(fallback).toContain('炉灰里有一枚怀表零件')
    expect(fallback).not.toContain('还有别的细节')
  })

  it('都没有时用占位名，避免出现空编号行', () => {
    const blank = dmSheetHtml(
      [{ key: 'round1', label: '公开线索', minutes: 10, brief: '发', clues: [{}] }],
      {},
    )
    expect(blank).toContain('<span class="cid">线索1</span>')
  })
})

/** 伪造一个够用的打印窗口，避免测试真的开窗口。 */
function fakeWindow() {
  return {
    document: { write: vi.fn(), close: vi.fn() },
    addEventListener: vi.fn(),
    focus: vi.fn(),
    print: vi.fn(),
  }
}

describe('唤起打印', () => {
  it('没有阶段时明确报错，不去开空窗口', () => {
    const open = vi.fn()
    expect(() => printDM([], { title: 'x' }, open)).toThrow('还没有可打印的流程')
    expect(open).not.toHaveBeenCalled()
  })

  it('弹窗被拦截时给出可操作的提示', () => {
    expect(() => printDM(PHASES, { title: 'x' }, () => null)).toThrow('允许弹出窗口')
  })

  it('把手册写进新窗口并等布局就绪后唤起打印', () => {
    const win = fakeWindow()
    printDM(PHASES, { title: '暴雪山庄的密室' }, () => win as unknown as Window)

    const written = win.document.write.mock.calls[0][0] as string
    expect(written).toContain('DM 主持手册')
    expect(written).toContain('《暴雪山庄的密室》')
    // 样式内联在文档里，新窗口不依赖主应用的 CSS
    expect(written).toContain('@page')
    expect(written).toContain('class="toolbar"')
    expect(win.document.close).toHaveBeenCalled()

    // 打印挂在 load 之后，否则可能打出空白页
    expect(win.print).not.toHaveBeenCalled()
    const onLoad = win.addEventListener.mock.calls.find(([type]) => type === 'load')?.[1] as () => void
    onLoad()
    expect(win.focus).toHaveBeenCalled()
    expect(win.print).toHaveBeenCalled()
  })
})
