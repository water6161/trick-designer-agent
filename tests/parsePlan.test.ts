import { describe, expect, it } from 'vitest'
import { parsePlanFromMarkdown } from '../src/lib/parsePlan'

/** 一份接近真实输出的方案样本：章节编号 + 表头措辞都按实际生成格式。 */
const SAMPLE = `# 《暴雪山庄的密室》

> 一句被篡改的死亡时间，一场无人可逃的雪夜审判

## 二、死者与案发背景

死者：顾寒山
身份：山庄主人，退休法官
死亡时间：第一幕 21:50
死因：中毒身亡
现场：书房内，炉火仍旺，桌上有一只空杯
发现：23:00 由管家温辞发现

## 四、凶手与人物逻辑

凶手：白棠
动机：三年前父亲的案子被死者误判，家破人亡。

## 角色表

| 角色 | 身份 | 秘密 | 怀疑 |
| --- | --- | --- | --- |
| 白棠 | 亡友之女 | 私家侦探 | 与死者有旧怨 |
| 温辞 | 死者侄子 | 被剥夺继承权 | 当晚曾进入书房 |

## 公开线索

| 编号 | 线索名称 | 线索内容 | 指向 | 获取方式 | 公平性 |
| --- | --- | --- | --- | --- | --- |
| C1 | 炉灰中的怀表零件 | 怀表停在 21:50 | 指向白棠 | 搜查壁炉 | 公开可得 |
| C2 | 安神汤杯底药渣 | 含有镇静剂 | 指向白棠 | 检查杯子 | 公开可得 |

## 深入线索

| 编号 | 线索名称 | 线索内容 | 指向 | 获取方式 | 公平性 |
| --- | --- | --- | --- | --- | --- |
| D1 | 录音机倒转痕迹 | 争执声是伪造的 | 指向白棠 | 第二轮搜证 | 可获取 |

## 六、时间线

| 时间 | 事件 | 目击者/佐证 |
| --- | --- | --- |
| 21:00 | 晚宴开始 | 全员在场 |
| 21:50 | 死者身亡 | 怀表零件 |
| 22:15 | 书房争执声 | 录音机痕迹 |
| 23:00 | 尸体被发现 | 温辞 |

## 十一、沉浸互动剧情

### 互动1：炉火的余温

场景：你推开书房的门，炉火还旺，可杯子已经凉了。

| 选项 | 结果 | 结局 |
| --- | --- | --- |
| 检查壁炉 | 你摸到一块金属 | 安全 |
| 直接翻找抽屉 | 你惊动了外面的人 | 存疑 |

### 隐藏真结局

场景：雪停了，真相却刚刚开始。
真结局：白棠承认了一切。

## 锁凶充分性评分：88/100
`

describe('parsePlanFromMarkdown', () => {
  const plan = parsePlanFromMarkdown(SAMPLE)

  it('从一级标题提取剧本名', () => {
    expect(plan.title).toBe('暴雪山庄的密室')
  })

  it('提取一句话卖点，且跳过创作声明', () => {
    expect(plan.tagline).toContain('死亡时间')
  })

  it('从第二章中文冒号字段提取死者信息', () => {
    expect(plan.victim).toMatchObject({
      name: '顾寒山',
      identity: '山庄主人，退休法官',
      death_time: '第一幕 21:50',
    })
    expect((plan.victim as Record<string, string>).found_by).toContain('温辞')
  })

  it('提取凶手与动机', () => {
    expect(plan.culprit).toMatchObject({ character: '白棠' })
    expect(String((plan.culprit as { motive?: string }).motive)).toContain('三年前')
  })

  it('动机是干净的句子，不带「凶手：」前缀的稿中稿', () => {
    const motive = String((plan.culprit as { motive?: string }).motive)
    expect(motive).not.toContain('凶手：')
    expect(motive).not.toContain('动机：')
    expect(motive).toBe('三年前父亲的案子被死者误判，家破人亡。')
  })

  it('没有「动机：」行时退化为小节纯文本（换行折叠），也不带行前缀', () => {
    const md = `## 四、凶手与人物逻辑

### 凶手

凶手：沈墨
管家偷换了遗嘱
`
    const parsed = parsePlanFromMarkdown(md)
    const motive = String((parsed.culprit as { motive?: string }).motive)
    expect(motive).toContain('管家偷换了遗嘱')
    expect(motive).not.toContain('\n')
  })

  it('解析角色表（表头多候选键名）', () => {
    expect(plan.characters).toHaveLength(2)
    expect(plan.characters?.[0]).toMatchObject({
      name: '白棠',
      identity: '亡友之女',
      secret: '私家侦探',
    })
  })

  it('分别解析公开线索与深入线索', () => {
    expect(plan.clues_public).toHaveLength(2)
    expect(plan.clues_deep).toHaveLength(1)
    expect(plan.clues_public?.[0]).toMatchObject({
      id: 'C1',
      points_to: '指向白棠',
      access: '搜查壁炉',
    })
    expect(plan.clues_deep?.[0].id).toBe('D1')
  })

  it('解析第六章时间线并按关键词判定公开/深入', () => {
    expect(plan.timeline).toHaveLength(4)
    expect(plan.timeline?.[1]).toMatchObject({ time: '21:50', event: '死者身亡' })
    expect(plan.timeline?.every((t) => t.visibility === '公开')).toBe(true)
  })

  it('解析互动剧情节点的选项与隐藏真结局', () => {
    const nodes = (plan as unknown as { interactions?: Array<{ title: string; options: unknown[] }> }).interactions
    expect(nodes).toHaveLength(1)
    expect(nodes?.[0].title).toBe('炉火的余温')
    expect(nodes?.[0].options).toHaveLength(2)
    expect((plan.hidden_ending as { ending?: string } | null)?.ending).toContain('白棠')
  })

  it('提取锁凶评分', () => {
    expect(plan.lock_score).toBe(88)
  })
})

describe('parsePlanFromMarkdown · 兜底容错', () => {
  it('缺章节时返回空数组而非抛异常', () => {
    const plan = parsePlanFromMarkdown('# 《空方案》\n\n什么都没有。')
    expect(plan.characters).toEqual([])
    expect(plan.clues_public).toEqual([])
    expect(plan.timeline).toEqual([])
  })

  it('表头措辞变化时仍能通过多候选键名命中（名称缺失时回落到内容）', () => {
    const md = `# 《测试》

## 公开线索

| 编号 | 名称 | 内容 | 指向 | 获取 |
| --- | --- | --- | --- | --- |
| C1 | 怀表 | 停在 21:50 | 指向医生 | 搜证 |
`
    const plan = parsePlanFromMarkdown(md)
    const clue = plan.clues_public?.[0]
    expect(clue).toMatchObject({ id: 'C1', content: '停在 21:50' })
    // 表头写「名称」而非「线索名称」时，name 回落到内容列——不理想但不会留空，
    // 这正是「兜底解析」的设计取舍：宁可名称与内容重复，也不让卡片显示空白。
    expect(clue?.name).toBe('停在 21:50')
  })

  it('空输入不崩溃', () => {
    expect(() => parsePlanFromMarkdown('')).not.toThrow()
  })
})
