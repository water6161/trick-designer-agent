"""方案版本历史的集成测试：用真实 LangGraph + InMemorySaver 验证列出与回退。"""

import asyncio
import sys

sys.path.insert(0, ".")

from langgraph.checkpoint.memory import InMemorySaver
from langgraph.graph import END, START, StateGraph

from agents._lib.app import _handle_restore, _handle_version_content, _handle_versions
from agents._lib.state import AgentState

MD_V1 = "# 《旧版方案》\n\n" + "旧版正文。" * 60
MD_V2 = "# 《新版方案》\n\n" + "新版正文。" * 60
MD_SHORT = "# 太短\n\n只有一句话。"


def _build_graph():
    builder = StateGraph(AgentState)
    builder.add_node("compose", lambda state: {})
    builder.add_edge(START, "compose")
    builder.add_edge("compose", END)
    return builder.compile(checkpointer=InMemorySaver())


def _make_history(graph, config, markdowns):
    async def run():
        for md in markdowns:
            await graph.aupdate_state(config, {"design_markdown": md}, as_node="compose")

    asyncio.run(run())


class TestVersions:
    def test列出历史版本且过滤过短正文(self):
        graph = _build_graph()
        config = {"configurable": {"thread_id": "conv-v1"}}
        _make_history(graph, config, [MD_V1, MD_SHORT, MD_V2])

        result = asyncio.run(_handle_versions(graph, config))
        versions = result["versions"]
        assert len(versions) == 2
        titles = [v["title"] for v in versions]
        assert "新版方案" in titles[0]  # 最新在最前
        assert "旧版方案" in titles[1]
        assert all(v["chars"] >= 200 for v in versions)

    def test版本包含可展示的元信息(self):
        graph = _build_graph()
        config = {"configurable": {"thread_id": "conv-v2"}}
        _make_history(graph, config, [MD_V1])

        version = asyncio.run(_handle_versions(graph, config))["versions"][0]
        assert version["checkpointId"]
        assert version["hasPlaceholder"] is False
        assert isinstance(version["next"], list)

    def test待补充占位被标记(self):
        graph = _build_graph()
        config = {"configurable": {"thread_id": "conv-v3"}}
        md = "# 《缺一章》\n\n## 待补充：凶手·角色·线索清单\n（本节生成超时）" + "正文。" * 60
        _make_history(graph, config, [md])

        version = asyncio.run(_handle_versions(graph, config))["versions"][0]
        assert version["hasPlaceholder"] is True

    def test空会话返回空列表(self):
        graph = _build_graph()
        config = {"configurable": {"thread_id": "conv-empty"}}
        assert asyncio.run(_handle_versions(graph, config))["versions"] == []


class TestRestore:
    def test回退后状态指向旧版正文(self):
        graph = _build_graph()
        config = {"configurable": {"thread_id": "conv-r1"}}
        _make_history(graph, config, [MD_V1, MD_V2])

        versions = asyncio.run(_handle_versions(graph, config))["versions"]
        old = [v for v in versions if "旧版" in v["title"]][0]

        restored = asyncio.run(_handle_restore(graph, config, old["checkpointId"]))
        assert restored["title"] == "旧版方案"
        assert "旧版正文" in restored["markdown"]

        state = asyncio.run(graph.aget_state(config))
        assert state.values["design_markdown"] == MD_V1

    def test缺少版本标识时报错(self):
        graph = _build_graph()
        config = {"configurable": {"thread_id": "conv-r2"}}
        assert "缺少版本标识" in asyncio.run(_handle_restore(graph, config, ""))["error"]

    def test版本不存在时报错(self):
        graph = _build_graph()
        config = {"configurable": {"thread_id": "conv-r3"}}
        _make_history(graph, config, [MD_V1])
        result = asyncio.run(_handle_restore(graph, config, "not-a-real-checkpoint"))
        assert "error" in result

    def test回退不触发后续节点重跑(self):
        graph = _build_graph()
        config = {"configurable": {"thread_id": "conv-r4"}}
        _make_history(graph, config, [MD_V1, MD_V2])
        versions = asyncio.run(_handle_versions(graph, config))["versions"]
        old = [v for v in versions if "旧版" in v["title"]][0]

        asyncio.run(_handle_restore(graph, config, old["checkpointId"]))
        state = asyncio.run(graph.aget_state(config))
        # as_node=compose 应该让图停在 END，没有待执行节点
        assert list(state.next) == []

class TestVersionContent:
    """对比用的只读入口：必须拿到正文，且绝不能改动会话状态。"""

    def test返回指定版本的正文与元信息(self):
        graph = _build_graph()
        config = {"configurable": {"thread_id": "conv-c1"}}
        _make_history(graph, config, [MD_V1, MD_V2])
        versions = asyncio.run(_handle_versions(graph, config))["versions"]
        old = [v for v in versions if "旧版" in v["title"]][0]

        content = asyncio.run(_handle_version_content(graph, config, old["checkpointId"]))
        assert "旧版正文" in content["markdown"]
        assert content["title"] == "旧版方案"
        assert content["chars"] == len(MD_V1)

    def test读取旧版不会把当前状态改掉(self):
        graph = _build_graph()
        config = {"configurable": {"thread_id": "conv-c2"}}
        _make_history(graph, config, [MD_V1, MD_V2])
        versions = asyncio.run(_handle_versions(graph, config))["versions"]
        old = [v for v in versions if "旧版" in v["title"]][0]

        asyncio.run(_handle_version_content(graph, config, old["checkpointId"]))

        state = asyncio.run(graph.aget_state(config))
        # 这正是它和 restore 的区别：看一眼差异不应该产生副作用
        assert state.values["design_markdown"] == MD_V2

    def test缺少版本标识时报错(self):
        graph = _build_graph()
        config = {"configurable": {"thread_id": "conv-c3"}}
        assert "缺少版本标识" in asyncio.run(_handle_version_content(graph, config, ""))["error"]

    def test版本不存在时报错(self):
        graph = _build_graph()
        config = {"configurable": {"thread_id": "conv-c4"}}
        _make_history(graph, config, [MD_V1])
        result = asyncio.run(_handle_version_content(graph, config, "not-a-real-checkpoint"))
        assert "error" in result

    def test过短正文不被当作可对比版本(self):
        graph = _build_graph()
        config = {"configurable": {"thread_id": "conv-c5"}}
        _make_history(graph, config, [MD_SHORT])
        versions = asyncio.run(_handle_versions(graph, config))["versions"]
        # 过短正文不会出现在 versions 里，自然也不会有可对比内容
        assert versions == []
