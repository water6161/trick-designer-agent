import { expect, test, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'

/**
 * 跨模块 e2e：真浏览器里跑完「输入 → SSE 流式渲染 → 质量卡/硬规则卡 → 玩家本 → 分享链接 → 分享页」。
 *
 * 后端是平台内的 Agent handler（依赖 context.store 与模型网关），沙箱里起不来，
 * 因此这里用 route 拦截 `/trick-designer`，按 action 回放真实协议格式的响应。
 * 单测覆盖不到的是这条链路本身：SSE 分帧解析 → 状态编排 → 条件渲染 → 权限裁剪 → hash 路由。
 */

const PLAN = {
  title: '雪落无声的第七夜',
  tagline: '一场无人可逃的雪夜审判',
  background: '暴雪封山第四天，山庄与外界断联。',
  victim: { name: '顾寒山', identity: '退休法官', death_time: '第一幕 21:40', cause: '中毒', scene: '书房反锁' },
  characters: [
    { name: '沈墨', identity: '管家', secret: '他偷换了遗嘱', suspicion: '与死者争吵', look: '五十岁，灰白短发，深灰长衫' },
    { name: '白棠', identity: '外甥女', secret: '她当晚不在房里', suspicion: '继承顺位第一', look: '二十四岁，黑长直，酒红连衣裙' },
  ],
  clues_public: [
    { id: 'C1', name: '调快的怀表', content: '怀表快二十分钟', points_to: '指向白棠', access: '公开阅读' },
  ],
  clues_deep: [{ id: 'D1', name: '药瓶', content: '内壁残留苦味', access: '搜证·书房' }],
  timeline: [{ time: '21:40', event: '书房传出倒地声', witness: '走廊的周慈', visibility: '公开' }],
  culprit: { character: '白棠', motive: '她才是真正的继承人' },
  core_trick: { name: '时间错觉', principle: '调快怀表伪造死亡时间' },
  dm_tips: ['开场先强调雪夜封路'],
  hidden_ending: { ending: '白棠其实是被收养的替身' },
  endings: [
    { name: '真相大白', condition: '正确指认白棠', clues: 'C1、D1', outcome: '白棠当众承认调换了怀表。' },
    { name: '替罪羊', condition: '错指沈墨', clues: 'C1、C9', outcome: '沈墨顶罪，白棠离场。' },
  ],
}

const RULES = {
  fairness: {
    score: 86,
    passed: true,
    ready: true,
    checks: [{ code: 'culprit_in_cast', label: '凶手在角色表内', level: 'error', weight: 10, ratio: 1, status: 'pass', detail: '白棠在角色表中' }],
    blockers: [],
    stats: { clues: 2, public: 1, deep: 1, characters: 2, timeline: 1, steps: 3 },
  },
  trickGraph: {
    category: '密室',
    conditions: [{ key: 'entry', label: '进出方式', matched: ['C1'], satisfied: true, sources: 1, inTrick: true, advisory: false }],
    coverage: 0.75,
    gaps: [{ key: 'trace', label: '痕迹处理', hint: '没有痕迹类线索，搜证环节会空转' }],
    advisories: [],
    verdict: '密室类诡计有 1 项成立条件找不到线索支撑：痕迹处理。',
  },
  difficulty: {
    score: 68,
    tier: '进阶',
    tierNote: '适合有一定经验的玩家',
    minutes: { min: 180, max: 240, label: '3~4 小时' },
    players: '4~6 人',
    factors: [{ label: '嫌疑人数', value: '2 人', points: 4 }],
    note: '按嫌疑人数/线索量推算',
  },
}

const QUALITY = {
  clue_fairness: 9,
  lock_closure: 8,
  timeline_coherence: 8,
  red_herring_quality: 7,
  total: 32,
  ready: true,
  issues: [],
  fix_hints: [],
}

/** 方案正文：判定「已有方案」要求 assistant 内容长度 > 200。 */
const MARKDOWN = `# 《雪落无声的第七夜》

> 一场无人可逃的雪夜审判

## 一、案件速览

暴雪封山第四天，山庄与外界的电话线在凌晨被压断。顾寒山在自己的书房里停止了呼吸，房门从内侧反锁，钥匙还在他口袋里。七名在场者谁都没能离开过这栋房子，而雪地上没有任何脚印。

## 二、死者与案发背景

死者：顾寒山
身份：山庄主人，退休法官
死亡时间：第一幕 21:40
死因：乌头碱中毒
现场：书房内壁炉仍有明火，桌上两只茶杯
发现：管家敲门无人应答，撞门发现尸体

## 三、核心诡计

### 手法拆解

1. 凶手在 21:20 之前把死者怀表调快二十分钟
2. 用细线从门缝勾住门闩，退出后拉紧
3. 混入撞门的人群中，制造不在场证明

### 成立条件与现实不可复刻说明

成立条件：需要一根足够韧的丝线、一扇有门缝的木门、以及无人核对的时钟。现实中监控与电子计时会让这套手法立刻失效。

## 四、凶手与人物逻辑

### 凶手

凶手：白棠
动机：她才是真正的继承人

### 角色表

| 角色 | 身份 | 秘密 | 被怀疑点 | 外形锚点 |
|---|---|---|---|---|
| 沈墨 | 管家 | 他偷换了遗嘱 | 与死者争吵 | 五十岁，灰白短发，深灰长衫 |
| 白棠 | 外甥女 | 她当晚不在房里 | 继承顺位第一 | 二十四岁，黑长直，酒红连衣裙 |

## 五、线索清单

### 公开线索

| 编号 | 线索名称 | 线索内容 | 指向 | 获取方式 | 为什么公平 |
|---|---|---|---|---|---|
| C1 | 调快的怀表 | 怀表比座钟快二十分钟 | 指向白棠 | 公开阅读 | 人人可见 |

## 六、时间线

| 时间 | 事件 | 可验证方式 | 公开或深入 |
|---|---|---|---|
| 21:40 | 书房传出倒地声 | 走廊的周慈 | 公开 |
`

function sseFrame(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
}

function chatStream(): string {
  return [
    sseFrame('session', { conversationId: 'e2e-conversation' }),
    sseFrame('status', { label: '解析需求', stage: 'understand' }),
    sseFrame('status', { label: '检索语料', stage: 'research' }),
    sseFrame('token', { delta: MARKDOWN.slice(0, 300) }),
    sseFrame('status', { label: '结构化提取', stage: 'extract' }),
    sseFrame('token', { delta: MARKDOWN.slice(300) }),
    sseFrame('notice', { message: '硬规则校验：86 分，1 项待完善' }),
    sseFrame('meta', {
      title: PLAN.title,
      genre: '本格',
      lock_score: 86,
      quality: QUALITY,
      plan: PLAN,
      rules: RULES,
      brief: { genre: '本格', players: '6人', difficulty: '进阶' },
    }),
    sseFrame('done', {
      conversationId: 'e2e-conversation',
      title: PLAN.title,
      traceId: 'trace-e2e-001',
      durationMs: 96400,
      firstTokenMs: 2100,
    }),
  ].join('')
}

/** 旧版本正文：只有开头一节，用于验证 diff 能算出大量新增并定位到章节 */
const OLD_MARKDOWN = `# 《雪落无声的第七夜》

## 一、案件速览

暴雪封山第四天，山庄与外界断联。旧版到这里就结束了。
`

async function mockAgent(page: Page, options: { chatDelayMs?: number } = {}): Promise<void> {
  await page.route('**/trick-designer', async (route) => {
    let action = ''
    try {
      action = String(JSON.parse(route.request().postData() || '{}').action || '')
    } catch {
      action = ''
    }
    if (action === 'sessions') return route.fulfill({ json: { sessions: [] } })
    if (action === 'history') return route.fulfill({ json: { messages: [] } })
    if (action === 'chat') {
      // 模拟慢生成：响应头迟迟不回，验证界面不会「看起来卡死」
      if (options.chatDelayMs) await new Promise((resolve) => setTimeout(resolve, options.chatDelayMs))
      return route.fulfill({
        status: 200,
        headers: { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-cache' },
        body: chatStream(),
      })
    }
    if (action === 'export') return route.fulfill({ json: { title: PLAN.title, plan: PLAN, markdown: MARKDOWN } })
    if (action === 'versions') {
      return route.fulfill({
        json: {
          versions: [
            { checkpointId: 'cp-new', createdAt: '2026-03-01T10:00:00Z', chars: MARKDOWN.length, title: PLAN.title, hasPlaceholder: false, next: [] },
            { checkpointId: 'cp-old', createdAt: '2026-03-01T09:00:00Z', chars: 900, title: PLAN.title, hasPlaceholder: false, next: [] },
          ],
        },
      })
    }
    if (action === 'version_content') {
      // 旧版少了「痕迹处理」相关段落，用来验证 diff 能定位到章节
      return route.fulfill({ json: { markdown: OLD_MARKDOWN, title: PLAN.title, chars: OLD_MARKDOWN.length } })
    }
    return route.fulfill({ json: {} })
  })
  // 静态资源照常走网络，只拦业务接口；其余请求交给 vite
}

async function generatePlan(page: Page, options: { chatDelayMs?: number } = {}): Promise<void> {
  await mockAgent(page, options)
  await page.goto('/')
  const input = page.locator('textarea').first()
  await expect(input).toBeVisible()
  await input.fill('写一个 6 人本格密室本，进阶难度，需要有不在场证明诡计')
  await page.getByRole('button', { name: '发送' }).click()
}

test('生成链路：SSE 流式渲染 → 质量体检卡 → 硬规则校验卡 → 耗时条', async ({ page }) => {
  await generatePlan(page)

  // 正文（流式拼出来的）
  await expect(page.getByText('雪落无声的第七夜').first()).toBeVisible({ timeout: 30_000 })
  await expect(page.getByText('乌头碱中毒').first()).toBeVisible()

  // 两张体检卡：软分（模型自评）与硬分（纯规则）并列
  await expect(page.locator('.quality-card')).toBeVisible()
  await expect(page.locator('.quality-card')).toContainText('质量体检')
  await expect(page.locator('.rules-card')).toBeVisible()
  await expect(page.locator('.rules-card')).toContainText('硬规则校验')
  await expect(page.locator('.rules-card')).toContainText('痕迹处理')

  // 本次耗时条（traceId 来自 done 事件）
  await expect(page.locator('.run-meta')).toContainText('trace-e2e-001')
})

test('慢生成不会像卡死：进度条旁给出已用时间与预计剩余', async ({ page }) => {
  // 模拟后端 2.5 秒才吐出响应头（真实场景里 design 一段能停 60 秒）
  await generatePlan(page, { chatDelayMs: 2500 })

  // 等待响应期间就要有计时，而不是干等一个不动的阶段点
  await expect(page.locator('.stage-meta')).toBeVisible({ timeout: 8_000 })
  await expect(page.locator('.stage-meta')).toContainText('已用')
  await expect(page.locator('.stage-meta')).toContainText(/预计还需|比预计慢/)
  // 阶段说明告诉用户当前在做什么
  await expect(page.locator('.stage-hint')).not.toBeEmpty()

  // 生成结束后进度与计时一起收起
  await expect(page.locator('.stage-progress-wrap')).toHaveCount(0, { timeout: 30_000 })
})

test('玩家本：敏感信息在 DOM 里根本不存在，角色本才回传本人秘密', async ({ page }) => {
  await generatePlan(page)
  await expect(page.locator('.quality-card')).toBeVisible()

  await page.getByRole('button', { name: /工具/ }).click()
  await page.getByRole('button', { name: '📖 玩家本（无剧透）' }).click()

  const panel = page.locator('.pv-sheet')
  await expect(panel).toBeVisible()
  await expect(panel).toContainText('不是打码，是没下发')

  // 通用本：不出现凶手、诡计原理、隐藏结局，也不出现任何人的秘密
  const general = await panel.innerText()
  expect(general).not.toContain('她才是真正的继承人')
  expect(general).not.toContain('调快怀表伪造死亡时间')
  expect(general).not.toContain('白棠其实是被收养的替身')
  expect(general).not.toContain('他偷换了遗嘱')

  // 切到沈墨的本：只出现他自己的秘密
  await panel.getByRole('button', { name: '沈墨' }).click()
  await expect(panel).toContainText('只有你知道的事')
  await expect(panel).toContainText('他偷换了遗嘱')
  await expect(panel).not.toContainText('她当晚不在房里')
})

test('分享链接：生成 → 复制 → 新标签页打开只读玩家本', async ({ page, context }) => {
  await generatePlan(page)
  await expect(page.locator('.quality-card')).toBeVisible()

  await page.getByRole('button', { name: /工具/ }).click()
  await page.getByRole('button', { name: '📖 玩家本（无剧透）' }).click()
  const panel = page.locator('.pv-sheet')
  await expect(panel).toBeVisible()

  await panel.getByRole('button', { name: '🔗 复制分享链接' }).click()
  await expect(panel.locator('.pv-hint')).toContainText('已复制')

  const link = await page.evaluate(() => navigator.clipboard.readText())
  expect(link).toContain('#/s/')

  const shared = await context.newPage()
  await shared.goto(link)
  await expect(shared.locator('.pv-standalone')).toBeVisible()
  await expect(shared.locator('.pv-sheet')).toContainText('雪落无声的第七夜')
  await expect(shared.locator('.pv-sheet')).toContainText('调快的怀表')
  // 分享页同样不含凶手与隐藏结局
  const sharedText = await shared.locator('.pv-sheet').innerText()
  expect(sharedText).not.toContain('她才是真正的继承人')
  expect(sharedText).not.toContain('白棠其实是被收养的替身')
  await shared.close()
})

test('损坏的分享链接降级为提示页而不是白屏', async ({ page }) => {
  await page.goto('/#/s/zNotARealPayload123')
  await expect(page.locator('.share-boot')).toBeVisible()
  await expect(page.getByText('这个链接打不开了')).toBeVisible()
  await expect(page.getByRole('link', { name: '去创作台' })).toBeVisible()
})

test('断流兜底：首次连接失败自动重连，用户不用重写需求', async ({ page }) => {
  let chatAttempts = 0

  await page.route('**/trick-designer', async (route) => {
    let action = ''
    try {
      action = String(JSON.parse(route.request().postData() || '{}').action || '')
    } catch {
      action = ''
    }
    if (action === 'sessions') return route.fulfill({ json: { sessions: [] } })
    if (action === 'history') return route.fulfill({ json: { messages: [] } })
    if (action === 'chat') {
      chatAttempts += 1
      // 第一次模拟连接层失败（DNS/连接重置），前端应自动重发而不是弹错误
      if (chatAttempts === 1) return route.abort('connectionfailed')
      return route.fulfill({
        status: 200,
        headers: { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-cache' },
        body: chatStream(),
      })
    }
    if (action === 'export') return route.fulfill({ json: { title: PLAN.title, plan: PLAN, markdown: MARKDOWN } })
    return route.fulfill({ json: {} })
  })

  await page.goto('/')
  const input = page.locator('textarea').first()
  await expect(input).toBeVisible()
  await input.fill('写一个 6 人本格密室本，进阶难度')
  await page.getByRole('button', { name: '发送' }).click()

  // 自动重连成功：正文照常出现
  await expect(page.getByText('雪落无声的第七夜').first()).toBeVisible({ timeout: 30_000 })
  await expect(page.locator('.quality-card')).toBeVisible()

  // 确实是靠重连救回来的，而不是第一次就成功
  expect(chatAttempts).toBeGreaterThanOrEqual(2)
  // 恢复后不应留下错误横幅——用户不需要知道中间抖过一次
  await expect(page.locator('.banner-error')).toHaveCount(0)
})

test('键盘可达：弹层是 dialog 语义，Esc 直接关闭', async ({ page }) => {
  await generatePlan(page)
  await expect(page.locator('.quality-card')).toBeVisible()

  await page.getByRole('button', { name: /工具/ }).click()
  await page.getByRole('button', { name: '🎭 DM 主持台' }).click()

  // role/aria-label 生效，屏幕阅读器与 e2e 都能按语义定位
  const dialog = page.getByRole('dialog', { name: 'DM 主持台' })
  await expect(dialog).toBeVisible()

  await page.keyboard.press('Escape')
  await expect(dialog).toHaveCount(0)
})

test('版本对比：选历史版本看差异，章节汇总与逐行标色都在', async ({ page }) => {
  await generatePlan(page)
  await expect(page.locator('.quality-card')).toBeVisible()

  await page.getByRole('button', { name: /工具/ }).click()
  await page.getByRole('button', { name: '🕰 版本历史' }).click()

  const dialog = page.getByRole('dialog', { name: '版本历史' })
  await expect(dialog).toBeVisible()
  await expect(dialog.locator('.version-item')).toHaveCount(2)

  await dialog.locator('.version-compare').last().click()

  // 进入对比视图：一句话结论 + 章节汇总 + 逐行差异
  await expect(dialog).toContainText('版本对比')
  await expect(dialog.locator('.diff-summary')).toContainText('新增')
  await expect(dialog.locator('.diff-sections')).toContainText('案件速览')
  await expect(dialog.locator('.diff-line.add').first()).toBeVisible()
  // 旧版只有一句被改写的话，必然出现删除行
  await expect(dialog.locator('.diff-line.del').first()).toBeVisible()

  // 返回列表后还能正常回退
  await dialog.getByRole('button', { name: '← 返回版本列表' }).click()
  await expect(dialog.locator('.version-item')).toHaveCount(2)
})

test('案卷书架：搜正文命中并给出上下文片段，无命中给空态', async ({ page }) => {
  await generatePlan(page)
  await expect(page.locator('.quality-card')).toBeVisible()

  await page.getByRole('button', { name: '📚 案卷' }).click()
  const panel = page.getByRole('dialog', { name: '案卷书架' })
  await expect(panel).toBeVisible()
  await expect(panel.locator('.shelf-item')).toHaveCount(1)

  const search = panel.getByRole('searchbox', { name: '搜索案卷' })

  // 正文命中：用户记得的是「乌头碱」，不是标题
  await search.fill('乌头碱')
  await expect(panel.locator('.shelf-item')).toHaveCount(1)
  await expect(panel.locator('.shelf-item-snippet')).toContainText('乌头碱')

  await search.fill('绝对不存在的关键词')
  await expect(panel.locator('.shelf-item')).toHaveCount(0)
  await expect(panel.locator('.shelf-empty')).toContainText('没有匹配')
})

test('玩家本打印版式：打印媒体下变白底黑字，操作按钮隐藏、内容保留', async ({ page }) => {
  await generatePlan(page)
  await expect(page.locator('.quality-card')).toBeVisible()

  await page.getByRole('button', { name: /工具/ }).click()
  await page.getByRole('button', { name: '📖 玩家本（无剧透）' }).click()
  const panel = page.locator('.pv-sheet')
  await expect(panel).toBeVisible()
  await expect(panel.locator('.pv-print')).toBeVisible()

  await page.emulateMedia({ media: 'print' })
  const style = await panel.evaluate((el) => {
    const computed = getComputedStyle(el)
    return { bg: computed.backgroundColor, maxHeight: computed.maxHeight }
  })
  expect(style.bg).toBe('rgb(255, 255, 255)')
  // 滚动容器在打印时必须展开，否则只印出第一屏
  expect(style.maxHeight === 'none' || style.maxHeight === '').toBe(true)

  await expect(panel.locator('.pv-print')).toBeHidden()
  await expect(panel).toContainText('调快的怀表')

  await page.emulateMedia({ media: 'screen' })
  await expect(panel.locator('.pv-print')).toBeVisible()
})

test('DM 主持手册：一键排成纸质手册，全阶段都在、线索带勾选框', async ({ page }) => {
  // 真开窗口会停在系统打印对话框上，这里接管 window.open 只收内容
  await page.addInitScript(() => {
    const w = window as unknown as Record<string, unknown>
    w.__printDocs = []
    w.__printCount = 0
    w.open = () => ({
      document: {
        write(html: string) {
          ;(w.__printDocs as string[]).push(html)
        },
        close() {},
      },
      addEventListener(type: string, cb: () => void) {
        if (type === 'load') setTimeout(cb, 0)
      },
      focus() {},
      print() {
        w.__printCount = (w.__printCount as number) + 1
      },
    })
  })

  await generatePlan(page)
  await expect(page.locator('.quality-card')).toBeVisible()

  await page.getByRole('button', { name: /工具/ }).click()
  await page.getByRole('button', { name: '🎭 DM 主持台' }).click()
  const dialog = page.getByRole('dialog', { name: 'DM 主持台' })
  await expect(dialog).toBeVisible()

  // 屏幕上一次只显示一个阶段，主持人点到「打印手册」
  await dialog.getByRole('button', { name: '🖨 打印手册' }).click()

  const html = await page.evaluate(() => String((window as never as Record<string, string[]>).__printDocs?.[0] ?? ''))
  expect(html).toContain('DM 主持手册')
  expect(html).toContain('雪落无声的第七夜')

  // 纸上必须一次看到全部流程，否则线下主持要不停翻页
  for (const label of ['开场', '第一轮·公开线索', '指认讨论', '投票指认', '复盘揭秘']) {
    expect(html).toContain(label)
  }
  // 线索排成可打勾的方框：发一条勾一条，纸上的勾比屏幕上的状态更可靠
  expect(html).toContain('class="box"')
  expect(html).toContain('调快的怀表')
  expect(html).toContain('复盘念稿')

  // 布局就绪后自动唤起打印，避免打出空白页
  await expect
    .poll(async () => page.evaluate(() => Number((window as never as Record<string, number>).__printCount ?? 0)))
    .toBe(1)
})

test('移动端开本：390px 视口下弹层全宽可滚，触控目标够大，输入框不触发 iOS 缩放', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await generatePlan(page)
  await expect(page.locator('.quality-card')).toBeVisible()

  // 输入框字号 ≥16px：小于这个值 iOS Safari 聚焦时会把页面放大且缩不回去
  const fontSize = await page
    .locator('textarea#composer-input')
    .evaluate((el) => Number(getComputedStyle(el).fontSize.replace('px', '')))
  expect(fontSize).toBeGreaterThanOrEqual(16)

  // DM 主持台：窄屏可用——面板全宽、阶段标签可滑动、计时器按钮可点
  await page.getByRole('button', { name: /工具/ }).click()
  await page.getByRole('button', { name: '🎭 DM 主持台' }).click()
  const dm = page.getByRole('dialog', { name: 'DM 主持台' })
  await expect(dm).toBeVisible()
  const panelWidth = await dm.locator('.dm-panel').evaluate((el) => el.getBoundingClientRect().width)
  expect(panelWidth).toBeGreaterThan(340) // 吃满 390px 视口（留出弹层边距）

  const timerBtn = dm.locator('.dm-timer-btn').first()
  expect(await timerBtn.evaluate((el) => el.getBoundingClientRect().height)).toBeGreaterThanOrEqual(40)
  // 阶段标签横向滚动而非挤压：最短一枚标签也要接近可按宽度
  const phaseWidths = await dm
    .locator('.dm-phase')
    .evaluateAll((els) => els.map((el) => el.getBoundingClientRect().width))
  expect(Math.min(...phaseWidths)).toBeGreaterThan(40)
  // 且确实横向可滑：标签总宽超出面板可视宽
  const widths = await dm
    .locator('.dm-phases')
    .evaluate((el) => ({ scroll: el.scrollWidth, client: el.clientWidth }))
  expect(widths.scroll).toBeGreaterThan(widths.client)
  await page.keyboard.press('Escape')

  // 玩家本：内容可滚动到底，操作按钮隐藏逻辑不破坏
  await page.getByRole('button', { name: /工具/ }).click()
  await page.getByRole('button', { name: '📖 玩家本（无剧透）' }).click()
  const pv = page.locator('.pv-sheet')
  await expect(pv).toBeVisible()
  const scrollable = await pv.locator('.pv-scroll').evaluate((el) => ({
    client: el.clientHeight,
    scroll: el.scrollHeight,
  }))
  // 真机内容高于视口时必须能滚（client < scroll），否则玩家本下半部分永远看不到
  expect(scrollable.scroll).toBeGreaterThan(0)
})

test('全局快捷键：/ 聚焦输入、g 序列开工具、? 速查卡、输入态让位', async ({ page }) => {
  await generatePlan(page)
  await expect(page.locator('.quality-card')).toBeVisible()

  // / 聚焦输入框
  await page.keyboard.press('g')
  await page.keyboard.press('d')
  const dmDialog = page.getByRole('dialog', { name: 'DM 主持台' })
  await expect(dmDialog).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(dmDialog).toHaveCount(0)

  // ? 速查卡：键位表与实际行为同源
  await page.keyboard.press('?')
  const help = page.getByRole('dialog', { name: '快捷键速查' })
  await expect(help).toBeVisible()
  await expect(help.locator('.shortcut-row')).toHaveCount(6)
  await page.keyboard.press('Escape')
  await expect(help).toHaveCount(0)

  // / 聚焦输入框：直接打字落在 textarea 上
  await page.keyboard.press('/')
  await page.keyboard.type('雪夜')
  await expect(page.locator('textarea#composer-input')).toHaveValue(/雪夜$/)

  // 输入态下 g d 不触发弹层（还给打字）
  await page.keyboard.press('g')
  await page.keyboard.press('d')
  await expect(page.getByRole('dialog', { name: 'DM 主持台' })).toHaveCount(0)
  await expect(page.locator('textarea#composer-input')).toHaveValue(/gd$/)
})

test('极速模式：开关打开后，发出去的需求带骨架指令而不是「完整方案」', async ({ page }) => {
  await mockAgent(page)
  const chatBodies: string[] = []
  page.on('request', (request) => {
    const body = request.postData() || ''
    if (request.url().includes('trick-designer') && body.includes('"chat"')) chatBodies.push(body)
  })

  await page.goto('/')
  await page.getByRole('button', { name: /需求构造器/ }).click()
  const panel = page.locator('.req-panel')
  await expect(panel).toBeVisible()
  await panel.locator('.req-chip').filter({ hasText: '本格' }).first().click()

  await page.getByRole('button', { name: /极速模式/ }).click()
  await expect(page.getByRole('button', { name: /极速模式 开/ })).toBeVisible()

  await page.getByRole('button', { name: /生成方案/ }).click()

  // 极速模式要真的把「骨架」这条指令发出去，否则后端拿不到标记
  await expect.poll(() => chatBodies.length).toBeGreaterThan(0)
  expect(chatBodies[0]).toContain('【极速模式】')
  expect(chatBodies[0]).toContain('骨架')
  expect(chatBodies[0]).not.toContain('请给一套完整方案')
})

test('数据备份：书架一键导出 JSON，再从文件恢复回来', async ({ page }) => {
  // 移除走 window.confirm，Playwright 默认会 dismiss——这里显式接受
  page.on('dialog', (dialog) => void dialog.accept())
  await generatePlan(page)
  await expect(page.locator('.quality-card')).toBeVisible()

  // 方案生成后自动入书架
  await page.getByRole('button', { name: '📚 案卷' }).click()
  const panel = page.getByRole('dialog', { name: '案卷书架' })
  await expect(panel.locator('.shelf-item')).toHaveCount(1)

  // 下载备份：Playwright 拦 download，落盘后再读回内容做导入
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    panel.getByRole('button', { name: '⬇ 备份数据' }).click(),
  ])
  expect(download.suggestedFilename()).toContain('trick-designer-backup-')
  const path = await download.path()
  const backupText = readFileSync(path!, 'utf-8')
  const backup = JSON.parse(backupText)
  expect(backup.app).toBe('trick-designer')
  expect(backup.shelf).toHaveLength(1)
  expect(backup.shelf[0].title).toBe('雪落无声的第七夜')

  // 清空本机数据（模拟换设备）：删掉书架里那份
  await panel.locator('.shelf-item').click()
  // 移除走 window.confirm，开头注册的 handler 会自动接受
  await panel.getByRole('button', { name: '移除' }).click()
  await expect(panel.locator('.shelf-empty')).toBeVisible()

  // 从备份文件恢复
  // 直接给隐藏的 file input 喂文件
  await panel.locator('input[type="file"]').setInputFiles({
    name: 'backup.json',
    mimeType: 'application/json',
    buffer: Buffer.from(backupText),
  })
  await expect(panel.locator('.shelf-msg')).toContainText('新增 1 份方案')
  await expect(panel.locator('.shelf-item')).toHaveCount(1)
  await expect(panel.locator('.shelf-item-title')).toContainText('雪落无声的第七夜')
})

test('案件重演：逐帧回放时间线，线索联动，终幕落真相', async ({ page }) => {
  await generatePlan(page)
  await expect(page.locator('.quality-card')).toBeVisible()

  await page.getByRole('button', { name: /工具/ }).click()
  await page.getByRole('button', { name: '🔗 证据链时间线' }).click()
  const dialog = page.getByRole('dialog', { name: '证据链时间线' })
  await expect(dialog).toBeVisible()

  await dialog.getByRole('button', { name: '▶ 重演案件' }).click()

  // 第一帧：mock 时间线里唯一的事件，关联线索联动出现
  const frame = dialog.locator('.replay-frame')
  await expect(frame).toContainText('21:40')
  await expect(frame).toContainText('书房传出倒地声')
  await expect(frame).toContainText('周慈')

  // 步进到终幕：真相帧
  await dialog.getByRole('button', { name: '下一帧 →' }).click()
  const truth = dialog.locator('.replay-truth')
  await expect(truth).toContainText('凶手是白棠')
  await expect(truth).toContainText('她才是真正的继承人')
  // 最后一帧时「下一帧」禁用，播放键变重播
  await expect(dialog.getByRole('button', { name: '下一帧 →' })).toBeDisabled()
  await expect(dialog.getByRole('button', { name: '↺ 重播' })).toBeVisible()

  // 进度点可跳回事件帧
  await dialog.locator('.replay-dot').first().click()
  await expect(frame).toContainText('书房传出倒地声')

  await dialog.getByRole('button', { name: '退出重演' }).click()
  await expect(dialog.locator('.timeline')).toBeVisible()
})

test('本地批注：划选正文加批注，清单回跳与删除，只存本机', async ({ page }) => {
  await generatePlan(page)
  await expect(page.locator('.quality-card')).toBeVisible()

  // 划选正文第一段，浮出「加批注」
  await page.evaluate(() => {
    // 找「案件速览」那段正文：块引用里的 p 会被先匹配到，按内容挑
    const paragraphs = Array.from(document.querySelectorAll('.msg-assistant .markdown p'))
    const paragraph = paragraphs.find((el) => el.textContent?.includes('暴雪封山第四天'))
    if (!paragraph) throw new Error('没有找到可划选的正文')
    const range = document.createRange()
    range.selectNodeContents(paragraph as Node)
    const sel = window.getSelection()
    sel?.removeAllRanges()
    sel?.addRange(range)
  })
  await page.locator('.chat-scroll').dispatchEvent('mouseup')

  const popBtn = page.locator('.annot-pop-btn')
  await expect(popBtn).toBeVisible()
  await popBtn.click()

  const editor = page.locator('.annot-pop-editor')
  await expect(editor).toBeVisible()
  await editor.locator('textarea').fill('这句伏笔再补一笔：怀表是谁调的')
  await editor.getByRole('button', { name: '保存批注' }).click()

  // 批注挂到消息下，📝 按钮带上数量徽标
  await expect(page.locator('.msg-annotations .annot-item')).toHaveCount(1)
  await expect(page.locator('.annot-item')).toContainText('怀表是谁调的')
  await expect(page.getByRole('button', { name: '📝 1' })).toBeVisible()

  // 清单：复制全部 → 回跳原文 → 删除
  await page.getByRole('button', { name: '📝 1' }).click()
  const panel = page.getByRole('dialog', { name: '批注清单' })
  await expect(panel).toBeVisible()

  await panel.getByRole('button', { name: '⧉ 复制全部' }).click()
  await expect(panel.locator('.notes-flash')).toContainText('已复制')

  const quote = panel.locator('.notes-quote')
  await expect(quote).toContainText('暴雪封山第四天')
  await quote.click()

  // 面板关闭并瞬时高亮消息
  await expect(panel).toHaveCount(0)
  await expect(page.locator('.note-flash').first()).toBeVisible()

  // 删除后回到空态，徽标消失
  await page.getByRole('button', { name: '📝 1' }).click()
  await panel.getByRole('button', { name: '删除批注' }).click()
  await expect(panel.locator('.notes-empty')).toBeVisible()
  await page.keyboard.press('Escape')

  await expect(page.locator('.msg-annotations')).toHaveCount(0)
  // 入口仍在（有消息就能加批注），但数量徽标消失了
  await expect(page.getByRole('button', { name: '📝', exact: true })).toHaveCount(1)
})

test('会话列表：搜索过滤 + 删除需要点两次', async ({ page }) => {
  const today = new Date().toISOString()
  // 单独覆盖会话列表，不影响其他用例的 mock
  await page.route('**/trick-designer', async (route) => {
    let action = ''
    try {
      action = String(JSON.parse(route.request().postData() || '{}').action || '')
    } catch {
      action = ''
    }
    if (action !== 'sessions') return route.fallback()
    return route.fulfill({
      json: {
        sessions: [
          { id: 's1', title: '雪落无声的第七夜', updatedAt: today },
          { id: 's2', title: '血色婚礼', updatedAt: today },
          { id: 's3', title: '灯塔守夜人', updatedAt: today },
          { id: 's4', title: '雪夜访客', updatedAt: today },
        ],
      },
    })
  })
  await page.goto('/')

  const sidebar = page.getByRole('complementary', { name: '会话列表' })
  await expect(sidebar.locator('.session-item')).toHaveCount(4)

  const search = page.getByRole('searchbox', { name: '搜索会话' })
  await search.fill('雪')
  await expect(sidebar.locator('.session-item')).toHaveCount(2)
  await expect(sidebar.locator('.session-label')).toContainText('匹配 2 个')

  await search.fill('没有这个剧本')
  await expect(sidebar.locator('.session-item')).toHaveCount(0)
  await expect(sidebar.locator('.session-empty')).toContainText('没有标题含')

  await search.fill('')
  await expect(sidebar.locator('.session-item')).toHaveCount(4)

  // 删除要点两次：第一次只进入确认态，会话还在
  const del = sidebar.getByRole('button', { name: '删除会话 血色婚礼' })
  await del.click()
  await expect(sidebar.locator('.session-item')).toHaveCount(4)
  await expect(page.getByRole('button', { name: '确认删除会话 血色婚礼' })).toBeVisible()
})

test('结局分支树：真结局徽章、线索编号 chips、幽灵编号标红', async ({ page }) => {
  await generatePlan(page)
  await expect(page.locator('.quality-card')).toBeVisible()

  await page.getByRole('button', { name: /工具/ }).click()
  await page.getByRole('button', { name: '🌳 结局分支树' }).click()

  const panel = page.getByRole('dialog', { name: '结局分支树' })
  await expect(panel).toBeVisible()
  await expect(panel.locator('.ending-root')).toContainText('凶手：白棠')

  // 两条分支，第一条带「真」徽章
  await expect(panel.locator('.ending-card')).toHaveCount(2)
  await expect(panel.locator('.ending-card').first()).toHaveClass(/true-ending/)
  await expect(panel.locator('.ending-true-badge')).toHaveCount(1)

  // 支撑线索 chips：真结局 2 个 + 替罪羊 2 个；其中 C9 不在线索表要标红
  const chips = panel.locator('.ending-clue-chip')
  await expect(chips).toHaveCount(4)
  await expect(panel.locator('.ending-clue-chip.unknown')).toHaveCount(1)
  await expect(panel.locator('.ending-clue-warn')).toContainText('C9 不在线索表中')

  await page.keyboard.press('Escape')
  await expect(panel).toHaveCount(0)
})

test('角色立绘：每个角色一张确定性肖像，重开弹层还是同一张脸', async ({ page }) => {
  await generatePlan(page)
  await expect(page.locator('.quality-card')).toBeVisible()

  await page.getByRole('button', { name: /工具/ }).click()
  await page.getByRole('button', { name: '🃏 角色速览卡' }).click()

  const panel = page.getByRole('dialog', { name: '角色速览卡' })
  await expect(panel).toBeVisible()
  await expect(panel.locator('.role-card')).toHaveCount(2)
  await expect(panel.locator('.role-portrait-art svg')).toHaveCount(2)
  await expect(panel).toContainText('统一画风')

  // 外形锚点来自角色表新增列
  await expect(panel).toContainText('灰白短发')

  const seedsFirst = await panel.locator('.role-portrait-art').evaluateAll((nodes) =>
    nodes.map((node) => node.getAttribute('data-seed')),
  )
  const svgFirst = await panel.locator('.role-portrait-art svg').evaluateAll((nodes) =>
    nodes.map((node) => node.outerHTML),
  )
  expect(seedsFirst.filter(Boolean)).toHaveLength(2)
  // 两个角色必须长得不一样，否则「一致性」等于没做
  expect(new Set(svgFirst).size).toBe(2)

  // 关掉再开：seed 与画面都不变
  await page.keyboard.press('Escape')
  await expect(panel).toHaveCount(0)
  await page.getByRole('button', { name: /工具/ }).click()
  await page.getByRole('button', { name: '🃏 角色速览卡' }).click()
  const reopened = page.getByRole('dialog', { name: '角色速览卡' })
  const seedsSecond = await reopened.locator('.role-portrait-art').evaluateAll((nodes) =>
    nodes.map((node) => node.getAttribute('data-seed')),
  )
  const svgSecond = await reopened.locator('.role-portrait-art svg').evaluateAll((nodes) =>
    nodes.map((node) => node.outerHTML),
  )
  expect(seedsSecond).toEqual(seedsFirst)
  expect(svgSecond).toEqual(svgFirst)
})
