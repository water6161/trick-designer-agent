"""LangGraph 会话状态。"""

from __future__ import annotations

from typing import Annotated, Any, TypedDict

from langchain_core.messages import AnyMessage
from langgraph.graph.message import add_messages


class AgentState(TypedDict, total=False):
    # 平台 checkpointer 按 conversation_id 持久化，跨请求保留
    messages: Annotated[list[AnyMessage], add_messages]
    brief: dict[str, Any]
    research: list[dict[str, Any]]
    design: dict[str, Any]
    audit: dict[str, Any]
    intent: str
    qa: bool
    title: str
    user_id: str
