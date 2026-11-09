"""verify 节点（硬规则校验）的行为测试。

这个节点不调用模型，是纯计算，所以重点验证：
- 数据齐时产出三份报告；
- 数据缺时安静跳过，而不是抛错中断流水线；
- 内部异常被吞掉，方案正文照常交付。
"""

import asyncio
import sys

sys.path.insert(0, ".")

from agents._lib import nodes

MARKDOWN = """# 《雾锁山庄》

## 二、死者与案发背景

死者：周敬山
死亡时间：第一幕 21:40
现场：书房门窗反锁

## 四、凶手与人物逻辑

### 凶手

凶手：林昭

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
| C3 | 账本有公款缺口 | 指向林昭 | 公开阅读 |

### 深入线索

| 编号 | 线索内容 | 指向或排除 | 获取方式 |
| --- | --- | --- | --- |
| D1 | 怀表被调快二十分钟 | 指向林昭 | 搜证书房 |

## 六、时间线

| 时间 | 事件 | 可验证方式 | 公开或深入 |
| --- | --- | --- | --- |
| 21:20 | 林昭送茶进书房 | 白露目击 | 公开 |
| 21:40 | 书房传出响动 | 众人皆闻 | 公开 |
| 22:10 | 发现尸体 | 撞门记录 | 深入 |
"""

PLAN = {
    "core_trick": {"name": "反锁的书房", "category": "密室", "steps": ["翻窗进入", "细线拉回插销", "擦掉泥印"]},
    "culprit": {"character": "林昭", "motive": "挪用公款被握把柄", "evidence_chain": ["C1 细线", "C2 泥印", "D1 怀表"]},
    "victim": {"death_time": "第一幕 21:40"},
    "characters": [
        {"name": "林昭", "secret": "挪用公款"},
        {"name": "沈青", "secret": "伪造遗嘱"},
        {"name": "陆行", "secret": "开过禁药"},
        {"name": "白露", "secret": "偷听谈话"},
        {"name": "顾南", "secret": "被威胁"},
    ],
    "clues_public": [
        {"id": "C1", "name": "门缝", "content": "门缝里卡着细线", "points_to": "排除沈青", "access": "公开"},
        {"id": "C2", "name": "窗台", "content": "窗台有泥印", "points_to": "指向林昭", "access": "公开"},
        {"id": "C3", "name": "账本", "content": "账本有缺口", "points_to": "指向林昭", "access": "公开"},
    ],
    "clues_deep": [{"id": "D1", "name": "怀表", "content": "被调快二十分钟", "points_to": "指向林昭", "access": "搜证"}],
    "timeline": [
        {"time": "21:20", "event": "林昭送茶", "witness": "白露", "visibility": "公开"},
        {"time": "21:40", "event": "书房响动", "witness": "众人", "visibility": "公开"},
    ],
}


def run_node(state, monkeypatch):
    events = []
    monkeypatch.setattr(nodes, "get_stream_writer", lambda: events.append)
    result = asyncio.run(nodes.verify(state, {}))
    return result, events


class TestSkipConditions:
    def test_对比模式跳过(self, monkeypatch):
        result, events = run_node({"mode": "compared", "design_markdown": MARKDOWN}, monkeypatch)
        assert result == {"rules": {}}
        assert events == []

    def test_没有方案时跳过(self, monkeypatch):
        result, _ = run_node({"design_markdown": ""}, monkeypatch)
        assert result == {"rules": {}}

    def test_正文无法解析出结构时跳过(self, monkeypatch):
        result, _ = run_node({"design_markdown": "随便一段没有章节的话"}, monkeypatch)
        assert result == {"rules": {}}


class TestReports:
    def test_产出三份报告(self, monkeypatch):
        result, _ = run_node({"design": PLAN, "design_markdown": MARKDOWN}, monkeypatch)
        rules = result["rules"]
        assert set(rules) == {"fairness", "trickGraph", "difficulty"}
        assert rules["fairness"]["score"] > 0
        assert rules["trickGraph"]["category"] == "密室"
        assert rules["difficulty"]["tier"] in ("新手", "进阶", "硬核", "地狱")

    def test_发出校验状态与结论(self, monkeypatch):
        _, events = run_node({"design": PLAN, "design_markdown": MARKDOWN}, monkeypatch)
        labels = [item.get("label", "") for item in events if item.get("event") == "status"]
        assert any("硬规则校验" in label for label in labels)
        notices = [item.get("message", "") for item in events if item.get("event") == "notice"]
        assert any("硬规则校验" in message for message in notices)

    def test_结构化缺失时从正文兜底解析(self, monkeypatch):
        result, _ = run_node({"design": {}, "design_markdown": MARKDOWN}, monkeypatch)
        rules = result.get("rules") or {}
        # 正文能解析出角色/线索，所以仍然产出报告
        assert rules.get("fairness", {}).get("stats", {}).get("clues") == 4


class TestFailureIsolation:
    def test_规则内部异常时静默降级(self, monkeypatch):
        def boom(*args, **kwargs):
            raise RuntimeError("规则炸了")

        monkeypatch.setattr(nodes, "check_fairness", boom)
        result, _ = run_node({"design": PLAN, "design_markdown": MARKDOWN}, monkeypatch)
        assert result == {"rules": {}}


class TestScoreSpeedMode:
    """回归：极速模式曾因调用不存在的 logger.info 直接抛错。"""

    def test_极速模式下评分节点跳过而不崩溃(self, monkeypatch):
        from langchain_core.messages import HumanMessage

        events = []
        monkeypatch.setattr(nodes, "get_stream_writer", lambda: events.append)
        state = {
            "design_markdown": "正文" * 200,
            "messages": [HumanMessage(content="极速模式写个密室本")],
        }
        result = asyncio.run(nodes.score(state, {}, env=None))
        assert result == {"quality": {}}


class TestGapHint:
    def test_把上一轮缺口转成本轮约束(self):
        state = {"rules": {"trickGraph": {"gaps": [{"label": "痕迹处理", "hint": "没有痕迹类线索"}]}}}
        hint = nodes._gap_hint(state)
        assert "痕迹处理" in hint
        assert "必须补齐" in hint

    def test_没有规则结论时从方案现算(self):
        state = {"design": {"core_trick": {"category": "密室", "steps": ["翻窗"]}, "clues_public": []}}
        hint = nodes._gap_hint(state)
        assert hint and "逻辑漏洞" in hint

    def test_没有缺口时不注入(self):
        design = {
            "core_trick": {"category": "", "steps": ["一步"]},
            "clues_public": [{"id": "C1", "content": "他独自离开房间时带着凶器", "points_to": "指向某人"}],
        }
        assert nodes._gap_hint({"design": design}) is None
