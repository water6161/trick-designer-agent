"""极速模式的提速行为测试。

极速模式的价值就是「快」，而快来自三件具体的事，任何一件退化都会让它慢回去：
1. 跳过联网检索（多轮网络往返）；
2. 整份骨架一次生成，而不是三段各发一遍完整 payload；
3. payload 里不带知识库、上一版正文截断更短。
"""

from __future__ import annotations

import asyncio
import sys
from typing import Any

import pytest
from langchain_core.messages import HumanMessage

sys.path.insert(0, ".")

from agents._lib import nodes

SKELETON = """# 《雪线之下》

> 缆车停摆的那七分钟，谁动了总闸

## 一、案件速览

| 题材 | 人数 | 难度 | 诡计类型 |
| --- | --- | --- | --- |
| 本格 | 6 人 | 进阶 | 密室 |

## 二、死者与案发背景

死者：周敬山，山庄老板。现场：缆车机房，总闸被拉下。

## 三、核心诡计

### 手法拆解

1. 提前调换保险丝。
2. 借停电七分钟完成换人。
3. 用备用闸的余电制造时间错觉。

现实不可复刻说明：依赖虚构的缆车电路设定。

## 四、凶手与人物逻辑

### 凶手

凶手：陆延。动机：被克扣工钱。机会：值守机房。手法：拉闸。

### 角色表

| 角色 | 身份 | 秘密 | 被怀疑点 | 外形锚点 |
| --- | --- | --- | --- | --- |
| 陆延 | 电工 | 私接线路 | 值守机房 | 寸头，卡其工装 |
| 白棠 | 会计 | 做假账 | 最后见死者 | 黑长直，深灰大衣 |
| 沈墨 | 医生 | 开禁药 | 持有药瓶 | 花白背头，白大褂 |
| 顾南 | 游客 | 偷拍 | 行踪不明 | 短发，藏青冲锋衣 |

## 五、线索清单

### 公开线索

| 编号 | 线索 | 指向或排除 | 获取方式 |
| --- | --- | --- | --- |
| C1 | 半截烧焦的保险丝 | 指向陆延 | 机房搜证 |
| C2 | 值班表被涂改 | 指向陆延 | 公开 |
| C3 | 备用闸余电记录 | 排除外部断电 | 公开 |

### 深入线索

| 编号 | 线索 | 指向或排除 | 获取方式 |
| --- | --- | --- | --- |
| D1 | 工装上的铜屑 | 指向陆延 | 搜身 |
| D2 | 死者口袋里的欠条 | 指向动机 | 尸检 |

## 六、时间线

| 时间 | 事件 | 可验证方式 |
| --- | --- | --- |
| 21:40 | 陆延拉下总闸，缆车停摆 | 调度记录 |
| 21:47 | 死者死亡（机房传出响动） | 游客口供 |
| 22:10 | 发现尸体 | 撞门记录 |
"""


class _Chunk:
    def __init__(self, content: str):
        self.content = content


class _FakeModel:
    """记录调用次数，按阈值吐出足够长的正文。"""

    def __init__(self, text: str = SKELETON):
        self.calls: list[str] = []
        self._text = text

    def astream(self, messages: list[Any]) -> Any:
        self.calls.append(str(messages[-1].content))

        async def gen() -> Any:
            yield _Chunk(self._text)

        return gen()


class _FakeSearch:
    """按 LangChain 工具约定实现 ainvoke，供 run_searches 并发调用。"""

    def __init__(self) -> None:
        self.calls = 0

    async def ainvoke(self, payload: dict[str, Any]) -> list[dict[str, str]]:
        self.calls += 1
        return [{"title": "参考资料", "snippet": "经典诡计", "href": "https://example.com"}]


def _env() -> Any:
    class Env:
        api_key = "sk-test"
        base_url = "https://example.com"
        model = "test"
        amap_key = ""

    return Env()


@pytest.fixture()
def events(monkeypatch: pytest.MonkeyPatch) -> list[dict[str, Any]]:
    captured: list[dict[str, Any]] = []
    monkeypatch.setattr(nodes, "get_stream_writer", lambda: captured.append)
    return captured


class TestSpeedResearch:
    def test_极速模式不联网(self, events, monkeypatch):
        search = _FakeSearch()
        result = asyncio.run(
            nodes.research(
                {"brief": {"genre": "本格"}, "messages": [HumanMessage(content="【极速模式】写个本")]},
                {},
                search_tool=search,
                env=_env(),
            )
        )
        assert result == {"research": []}
        assert search.calls == 0
        # 明确告知用户跳过了什么，避免以为是漏了检索
        assert any("跳过联网检索" in str(e.get("message", "")) for e in events)

    def test_正常模式仍走检索(self, events, monkeypatch):
        search = _FakeSearch()
        asyncio.run(
            nodes.research(
                {"brief": {"genre": "本格"}, "messages": [HumanMessage(content="写个本")]},
                {},
                search_tool=search,
                env=_env(),
            )
        )
        assert search.calls > 0


class TestSpeedDesign:
    def test_极速模式只调一次模型(self, events, monkeypatch):
        model = _FakeModel()
        monkeypatch.setattr(nodes, "get_model", lambda env, role: model)
        result = asyncio.run(
            nodes.design(
                {
                    "brief": {"genre": "本格"},
                    "messages": [HumanMessage(content="【极速模式】写个本")],
                },
                {},
                env=_env(),
            )
        )
        # 三段各发一遍完整 payload 是最贵的固定开销，极速只跑一段
        assert len(model.calls) == 1
        assert result["design_markdown"].startswith("# 《雪线之下》")

    def test_正常模式仍是三段(self, events, monkeypatch):
        model = _FakeModel()
        monkeypatch.setattr(nodes, "get_model", lambda env, role: model)
        asyncio.run(
            nodes.design(
                {"brief": {"genre": "本格"}, "messages": [HumanMessage(content="写个本")]},
                {},
                env=_env(),
            )
        )
        assert len(model.calls) == 3

    def test_极速_payload_不带知识库且上版截断(self, events, monkeypatch):
        model = _FakeModel()
        monkeypatch.setattr(nodes, "get_model", lambda env, role: model)
        long_previous = "旧" * 5000
        asyncio.run(
            nodes.design(
                {
                    "brief": {"genre": "本格"},
                    "messages": [HumanMessage(content="【极速模式】改写一下")],
                    "design_markdown": long_previous,
                },
                {},
                env=_env(),
            )
        )
        sent = model.calls[0]
        # 知识库参考置空（省 prefill），上一版正文只带 2000 字
        assert "本地知识库参考" in sent
        assert sent.count("旧") <= 2000
        assert "900 字以内" in sent  # 输出基调已切到骨架版

    def test_正常模式上版带六千字(self, events, monkeypatch):
        model = _FakeModel()
        monkeypatch.setattr(nodes, "get_model", lambda env, role: model)
        long_previous = "旧" * 5000
        asyncio.run(
            nodes.design(
                {
                    "brief": {"genre": "本格"},
                    "messages": [HumanMessage(content="改写一下")],
                    "design_markdown": long_previous,
                },
                {},
                env=_env(),
            )
        )
        assert model.calls[0].count("旧") == 5000


class TestSkeletonParsable:
    """骨架省略内容可以，但结构必须让解析器抓得到——否则卡片/DM 台/玩家本全空。"""

    def test_骨架能解析出角色凶手线索时间线(self):
        from agents._lib.mdplan import parse_plan_from_markdown

        plan = parse_plan_from_markdown(SKELETON)
        assert len(plan.get("characters") or []) == 4
        assert (plan.get("culprit") or {}).get("character") == "陆延"
        assert len(plan.get("clues_public") or []) == 3
        assert len(plan.get("clues_deep") or []) == 2
        assert len(plan.get("timeline") or []) == 3
        # 外形锚点也要有：立绘/封面要用
        looks = [c.get("look") for c in plan["characters"]]
        assert all(looks), looks
