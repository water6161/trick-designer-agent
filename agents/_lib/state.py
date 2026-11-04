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
    design_markdown: str  # 设计节点实时流式产出的完整 Markdown 方案
    audit: dict[str, Any]
    quality: dict[str, Any]  # 四维质量评分（线索公平/锁凶闭环/时间线/红鲱鱼）
    intent: str
    qa: bool
    pending: bool  # True=已向用户提出追问，等待回答
    mode: str  # ""=正常；"compare"=本轮输出多方案对比；"compared"=已对比，等用户选方向
    title: str
    user_id: str
