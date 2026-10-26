"""诡计设计工作流：需求解析 → 检索 → 流式设计 → 结构化提取 → 成稿。"""

from __future__ import annotations

from functools import partial
from typing import Any

from langgraph.graph import END, START, StateGraph

from .config import EnvConfig
from .nodes import after_understand, compose, design, extract, research, understand
from .state import AgentState


def build_graph(
    checkpointer: Any = None,
    env: EnvConfig | None = None,
    search_tool: Any = None,
):
    """编译工作流。

    依赖（模型配置、检索工具）通过闭包注入，避免放进 configurable 后被
    checkpointer 序列化，导致平台存储写入失败。
    """
    builder = StateGraph(AgentState)
    builder.add_node("understand", partial(understand, env=env))
    builder.add_node("research", partial(research, search_tool=search_tool, env=env))
    builder.add_node("design", partial(design, env=env))
    builder.add_node("extract", partial(extract, env=env))
    builder.add_node("compose", partial(compose, env=env))

    builder.add_edge(START, "understand")
    builder.add_conditional_edges(
        "understand",
        after_understand,
        {"research": "research", "compose": "compose", "ask": END},
    )
    builder.add_edge("research", "design")
    builder.add_edge("design", "extract")
    builder.add_edge("extract", "compose")
    builder.add_edge("compose", END)

    return builder.compile(checkpointer=checkpointer)
