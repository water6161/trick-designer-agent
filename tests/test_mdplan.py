"""Markdown 方案解析（mdplan.py）的单元测试。

这是 extract 节点失败时的兜底路径：正文一定存在，解析到多少算多少，
所以重点验证「章节缺失也不抛异常」与「表格列名容错」。
"""

import sys

sys.path.insert(0, ".")

from agents._lib.mdplan import md_rows, parse_plan_from_markdown, rows_to_objects

MARKDOWN = """# 《雾锁山庄》

> 六个人，一场没有出口的雨夜

## 一、案件速览

| 题材 | 建议人数 | 难度 |
| --- | --- | --- |
| 本格 | 6人 | 进阶 |

## 二、死者与案发背景

死者：周敬山
身份：山庄主人，退役法官
死亡时间：第一幕 21:40
现场：书房内，门窗自内反锁，桌上台灯仍亮
发现：女仆白露送宵夜时久敲不应，撞门后发现

那晚暴雨冲断了唯一的山道，六个人被困在庄里。

## 三、核心诡计

### 手法拆解

1. 从窗户翻入书房
2. 用细线穿过门缝拉回插销
3. 擦掉窗台泥印后离开

## 四、凶手与人物逻辑

### 凶手

凶手：林昭
动机：死者握有他挪用公款的账本
机会：21:20 送茶时独自留在书房

### 角色表

| 角色 | 身份 | 秘密 | 被怀疑点 |
| --- | --- | --- | --- |
| 林昭 | 管家 | 挪用公款 | 最后见到死者 |
| 沈青 | 侄女 | 伪造遗嘱 | 遗产受益人 |
| 陆行 | 医生 | 开过禁药 | 持有毒物 |
| 白露 | 女仆 | 偷听谈话 | 行踪不明 |
| 顾南 | 旧友 | 被死者威胁 | 当晚争吵 |

## 五、线索清单

### 公开线索

| 编号 | 线索内容 | 指向或排除 | 获取方式 |
| --- | --- | --- | --- |
| C1 | 门缝里卡着一段细线 | 排除沈青 | 公开阅读 |
| C2 | 窗台有新鲜泥印 | 指向林昭 | 公开阅读 |
| C3 | 账本记录一笔公款缺口 | 指向林昭 | 公开阅读 |

### 深入线索

| 编号 | 线索内容 | 指向或排除 | 获取方式 |
| --- | --- | --- | --- |
| D1 | 怀表被调快二十分钟 | 指向林昭 | 搜证书房 |

## 六、时间线

| 时间 | 事件 | 可验证方式 | 公开或深入 |
| --- | --- | --- | --- |
| 21:20 | 林昭送茶进入书房 | 白露目击 | 公开 |
| 21:40 | 书房传出响动 | 众人皆闻 | 公开 |
| 22:10 | 发现尸体 | 撞门记录 | 深入 |

## 七、公平性自查报告

**锁凶充分性评分：82/100**

结论：线索足以锁定林昭，但红鲱鱼偏弱。
"""


class TestHelpers:
    def test_解析表格跳过对齐行(self):
        text = "| a | b |\n| --- | --- |\n| 1 | 2 |"
        assert md_rows(text) == [["a", "b"], ["1", "2"]]

    def test_表格转对象(self):
        objects = rows_to_objects([["角色", "身份"], ["林昭", "管家"]])
        assert objects == [{"角色": "林昭", "身份": "管家"}]

    def test_表头不足两行返回空(self):
        assert rows_to_objects([["角色"]]) == []


class TestParse:
    def test_解析标题与卖点(self):
        plan = parse_plan_from_markdown(MARKDOWN)
        assert plan["title"] == "《雾锁山庄》".strip("《》")
        assert plan["tagline"] == "六个人，一场没有出口的雨夜"

    def test_解析死者信息(self):
        victim = parse_plan_from_markdown(MARKDOWN)["victim"]
        assert victim["name"].startswith("周敬山")
        assert victim["death_time"] == "第一幕 21:40"
        assert "反锁" in victim["scene"]

    def test_解析凶手(self):
        culprit = parse_plan_from_markdown(MARKDOWN)["culprit"]
        assert culprit["character"] == "林昭"
        assert "账本" in culprit["motive"]

    def test_解析角色表(self):
        characters = parse_plan_from_markdown(MARKDOWN)["characters"]
        assert len(characters) == 5
        assert characters[0]["name"] == "林昭"
        assert characters[0]["secret"] == "挪用公款"

    def test_解析公开线索(self):
        clues = parse_plan_from_markdown(MARKDOWN)["clues_public"]
        assert [c["id"] for c in clues] == ["C1", "C2", "C3"]
        assert clues[0]["content"] == "门缝里卡着一段细线"
        assert clues[0]["points_to"] == "排除沈青"
        assert clues[0]["access"] == "公开阅读"

    def test_解析深入线索(self):
        clues = parse_plan_from_markdown(MARKDOWN)["clues_deep"]
        assert len(clues) == 1
        assert clues[0]["access"] == "搜证书房"

    def test_时间线区分公开与深入(self):
        timeline = parse_plan_from_markdown(MARKDOWN)["timeline"]
        assert len(timeline) == 3
        assert timeline[0]["visibility"] == "公开"
        assert timeline[-1]["visibility"] == "深入"

    def test_解析锁凶评分(self):
        assert parse_plan_from_markdown(MARKDOWN)["lock_score"] == 82

    def test_空输入返回空字典(self):
        assert parse_plan_from_markdown("") == {}

    def test_残缺正文不抛异常(self):
        plan = parse_plan_from_markdown("随手写的一段话，没有任何章节")
        assert isinstance(plan, dict)

    def test_缺少角色表时角色列表为空(self):
        plan = parse_plan_from_markdown("# 《只有标题》\n\n## 二、死者与案发背景\n\n死者：某人\n")
        assert plan["characters"] == []
        assert plan["clues_public"] == []

    def test_分段生成的省略标题也能解析凶手(self):
        md = "### 凶手\n\n凶手：沈青\n动机：争夺遗产\n"
        assert parse_plan_from_markdown(md)["culprit"]["character"] == "沈青"

class TestEndings:
    """「### 结局分支」小节 → plan["endings"]。"""

    def test_解析结局分支表(self):
        md = (
            "### 结局分支\n\n"
            "| 结局 | 触发条件 | 支撑线索 | 走向 |\n"
            "|---|---|---|---|\n"
            "| 真相大白 | 正确指认白棠 | C1、D1 | 白棠伏法 |\n"
            "| 替罪羊 | 错指沈墨 | C1 | 沈墨顶罪 |\n"
        )
        endings = parse_plan_from_markdown(md)["endings"]
        assert len(endings) == 2
        assert endings[0] == {
            "name": "真相大白", "condition": "正确指认白棠", "clues": "C1、D1", "outcome": "白棠伏法",
        }
        assert endings[1]["name"] == "替罪羊"

    def test_旧式表头也能解析(self):
        md = (
            "### 结局分支\n\n"
            "| 结局名 | 达成条件 | 线索 | 结局走向 |\n"
            "|---|---|---|---|\n"
            "| 沉默 | 全员隐瞒 | D2 | 案件成为悬案 |\n"
        )
        endings = parse_plan_from_markdown(md)["endings"]
        assert endings[0]["condition"] == "全员隐瞒"
        assert endings[0]["outcome"] == "案件成为悬案"

    def test_没有结局章节时不产出字段(self):
        plan = parse_plan_from_markdown("# 《只有线索》\n\n## 五、线索清单\n\n| 编号 |\n|---|\n| C1 |\n")
        assert "endings" not in plan

    def test_结局章节为空表时不产出字段(self):
        md = "### 结局分支\n\n| 结局 | 触发条件 | 支撑线索 | 走向 |\n|---|---|---|---|\n"
        assert "endings" not in parse_plan_from_markdown(md)

class TestLook:
    """角色表新增「外形锚点」列：驱动立绘一致性的文本锚点。"""

    def test_解析外形锚点列(self):
        md = (
            "### 角色表\n\n"
            "| 角色 | 身份 | 秘密 | 被怀疑点 | 外形锚点 |\n"
            "|---|---|---|---|---|\n"
            "| 沈墨 | 管家 | 偷换遗嘱 | 争吵 | 五十岁，灰白短发，深灰长衫 |\n"
        )
        chars = parse_plan_from_markdown(md)["characters"]
        assert chars[0]["look"] == "五十岁，灰白短发，深灰长衫"

    def test_旧表头没有外形列时字段为空(self):
        md = (
            "### 角色表\n\n"
            "| 角色 | 身份 | 秘密 | 被怀疑点 |\n"
            "|---|---|---|---|\n"
            "| 沈墨 | 管家 | 偷换遗嘱 | 争吵 |\n"
        )
        chars = parse_plan_from_markdown(md)["characters"]
        assert chars[0]["look"] == ""
