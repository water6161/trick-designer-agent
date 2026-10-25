"""LangGraph 节点实现。"""

from __future__ import annotations

import asyncio
import json
from typing import Any

from langchain_core.messages import AIMessage, HumanMessage, SystemMessage
from langchain_core.runnables import RunnableConfig
from langgraph.config import get_stream_writer
from pydantic import BaseModel, ValidationError

from .config import EnvConfig
from .amap import extract_place, fetch_weather_note
from .kb import retrieve_knowledge
from .logger import create_logger
from .models import get_model
from .prompts import (
    AUDIT_SYSTEM,
    COMPOSE_QA_SYSTEM,
    COMPOSE_SYSTEM,
    DESIGN_SYSTEM,
    UNDERSTAND_SYSTEM,
)
from .schemas import BriefPatch, DesignPlan, FairnessAudit
from .search import build_queries, run_searches
from .state import AgentState

logger = create_logger("nodes")


# ───────────────────────── helpers ─────────────────────────


def _text(content: Any) -> str:
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts: list[str] = []
        for item in content:
            if isinstance(item, str):
                parts.append(item)
            elif isinstance(item, dict):
                text = item.get("text") or item.get("content")
                if isinstance(text, str):
                    parts.append(text)
        return "".join(parts)
    if content is None:
        return ""
    return str(content)


def _last_user_text(state: AgentState) -> str:
    for message in reversed(state.get("messages") or []):
        if isinstance(message, HumanMessage):
            return _text(message.content).strip()
    return ""


def _recent_dialogue(state: AgentState, limit: int = 8) -> list[dict[str, str]]:
    result: list[dict[str, str]] = []
    for message in (state.get("messages") or [])[-limit:]:
        if isinstance(message, HumanMessage):
            role = "user"
        elif isinstance(message, AIMessage):
            role = "assistant"
        else:
            continue
        text = _text(message.content).strip()
        if text:
            result.append({"role": role, "content": text[:1200]})
    return result


def _json(data: Any) -> str:
    return json.dumps(data, ensure_ascii=False, default=str)


async def _invoke_structured(
    model: Any,
    schema: type[BaseModel],
    messages: list[Any],
    timeout: float,
) -> BaseModel:
    """通过 function call 取结构化结果，失败时重试一次并做 JSON 兜底解析。"""
    tool = {
        "type": "function",
        "function": {
            "name": "emit_result",
            "description": "Return the final structured result. Only call once.",
            "parameters": schema.model_json_schema(),
        },
    }
    bound = model.bind_tools(
        [tool],
        tool_choice={"type": "function", "function": {"name": "emit_result"}},
    )
    working = list(messages)

    last_error: str = ""
    for attempt in range(2):
        response = await asyncio.wait_for(bound.ainvoke(working), timeout=timeout)
        calls = getattr(response, "tool_calls", None) or []
        for call in calls:
            args = call.get("args") or {}
            try:
                return schema.model_validate(args)
            except ValidationError as exc:
                last_error = str(exc)[:600]

        content = _text(getattr(response, "content", ""))
        try:
            return schema.model_validate(json.loads(content))
        except Exception:
            if content:
                last_error = content[:300]

        if attempt == 0:
            working = list(messages) + [
                AIMessage(content=content or "（无内容）"),
                HumanMessage(
                    content=(
                        "上一次没有按要求返回结构化结果。请立即调用 emit_result 工具，"
                        "严格按给定 JSON Schema 填写，不要输出解释文字。"
                    )
                ),
            ]

    raise RuntimeError(f"模型未返回合法的结构化结果：{last_error or '格式不符'}")


def _default_brief(brief: dict[str, Any]) -> dict[str, Any]:
    merged = dict(brief)
    merged.setdefault("genre", "本格")
    merged.setdefault("players", "6人")
    merged.setdefault("difficulty", "进阶")
    merged.setdefault("trick_types", [])
    merged.setdefault("special", "")
    merged.setdefault("story_title", "")
    return merged


# ───────────────────────── nodes ─────────────────────────


async def understand(
    state: AgentState, config: RunnableConfig, *, env: EnvConfig | None
) -> dict[str, Any]:
    writer = get_stream_writer()
    writer({"event": "status", "stage": "understand", "label": "正在解析题材与约束"})

    model = get_model(env, "fast")
    user_text = _last_user_text(state)

    payload = {
        "当前已确认设定": state.get("brief") or {},
        "是否已有方案": bool(state.get("design")),
        "最近对话": _recent_dialogue(state),
        "本轮用户输入": user_text,
    }
    messages = [
        SystemMessage(content=UNDERSTAND_SYSTEM),
        HumanMessage(content=_json(payload)),
    ]

    patch: BriefPatch = await _invoke_structured(  # type: ignore[assignment]
        model, BriefPatch, messages, timeout=90
    )

    brief = dict(state.get("brief") or {})
    for field in ("genre", "players", "difficulty", "special", "story_title"):
        value = str(getattr(patch, field, "") or "").strip()
        if value:
            brief[field] = value
    if patch.trick_types:
        brief["trick_types"] = [str(item).strip() for item in patch.trick_types if str(item).strip()]
    # 每轮都刷新改动列表：本轮没提改动时，避免把上一轮的修改继续带进去
    brief["modifications"] = [
        str(item).strip() for item in patch.modifications if str(item).strip()
    ]
    brief = _default_brief(brief)

    intent = patch.intent
    qa = intent == "question"
    updates: dict[str, Any] = {"brief": brief, "intent": intent, "qa": qa}

    # 用户明确要求推翻重做时，清掉旧方案，避免模型被上一版锚定
    if intent == "new" and state.get("design"):
        updates["design"] = {}
        updates["audit"] = {}
        updates["research"] = []

    writer({"event": "status", "stage": "understood", "label": "需求已确认"})
    return updates


async def research(
    state: AgentState, config: RunnableConfig, *, search_tool: Any = None, env: EnvConfig | None = None
) -> dict[str, Any]:
    writer = get_stream_writer()
    writer({"event": "status", "stage": "research", "label": "正在检索经典诡计与玩家雷点"})

    brief = state.get("brief") or {}
    queries = build_queries(brief)
    results, errors = await run_searches(search_tool, queries)

    # 特殊设定提到真实地名时，用高德取当地天气做环境细节参考（失败静默降级）
    amap_key = getattr(env, "amap_key", "") if env else ""
    place = extract_place(str(brief.get("special") or ""))
    if amap_key and place:
        note = await fetch_weather_note(amap_key, place)
        if note:
            results = list(results) + [note]
            writer({"event": "notice", "message": f"已参考真实环境细节：{note['title']}。"})

    for message in errors:
        writer({"event": "notice", "message": message})
    if results:
        writer(
            {
                "event": "notice",
                "message": f"已检索到 {len(results)} 条参考资料，用于校准套路与雷点。",
            }
        )
    return {"research": results}


async def design(
    state: AgentState, config: RunnableConfig, *, env: EnvConfig | None
) -> dict[str, Any]:
    writer = get_stream_writer()
    writer({"event": "status", "stage": "design", "label": "正在搭建核心诡计与线索链"})

    model = get_model(env, "reason")
    brief = state.get("brief") or {}
    previous = state.get("design") or {}
    research = state.get("research") or []

    payload = {
        "需求": brief,
        "本轮改动": brief.get("modifications") or [],
        "本地知识库参考（精选诡计/结构整理，可引用思路但不要照抄）": retrieve_knowledge(brief),
        "联网检索资料（用于规避烂梗与雷点，不要照抄）": [
            {"title": item.get("title"), "snippet": item.get("snippet"), "href": item.get("href")}
            for item in research[:12]
        ],
        "上一版方案（迭代时在它基础上修改；为空表示全新创作）": previous or None,
        "本轮用户原话": _last_user_text(state),
    }
    messages = [
        SystemMessage(content=DESIGN_SYSTEM),
        HumanMessage(content=_json(payload)),
    ]

    plan: DesignPlan = await _invoke_structured(  # type: ignore[assignment]
        model, DesignPlan, messages, timeout=260
    )
    writer({"event": "status", "stage": "designed", "label": f"诡计「{plan.core_trick.name}」已成型"})
    return {"design": plan.model_dump()}


async def audit(
    state: AgentState, config: RunnableConfig, *, env: EnvConfig | None
) -> dict[str, Any]:
    writer = get_stream_writer()
    writer({"event": "status", "stage": "audit", "label": "正在做公平性自查"})

    model = get_model(env, "reason")
    plan = state.get("design") or {}
    brief = state.get("brief") or {}

    payload = {
        "需求": brief,
        "待审方案": plan,
        "审查重点": "锁凶是否充分、线索是否所有玩家可得、是否存在其他合理解释、是否强行降智、时间线是否矛盾、红鲱鱼能否被排除、尺度与可复刻性。",
    }
    messages = [
        SystemMessage(content=AUDIT_SYSTEM),
        HumanMessage(content=_json(payload)),
    ]

    try:
        result: FairnessAudit = await _invoke_structured(  # type: ignore[assignment]
            model, FairnessAudit, messages, timeout=180
        )
        data = result.model_dump()
        writer(
            {
                "event": "notice",
                "message": f"公平性自查完成：锁凶充分性 {result.lock_score}/100。",
            }
        )
        return {"audit": data}
    except Exception as exc:
        # 自查失败不阻断交付，但必须如实告知玩家
        logger.exception("audit failed", exc)
        writer(
            {
                "event": "notice",
                "message": "公平性自查调用失败，本次方案未经完整审查，建议重试或人工复核。",
            }
        )
        fallback = {
            "failed": True,
            "lock_score": None,
            "sufficient_to_identify": False,
            "forced_stupidity": False,
            "god_view_only": False,
            "alternative_solutions": [],
            "issues": [],
            "verdict": "自动公平性自查未完成，请人工复核线索链。",
            "must_fix": ["重新执行一次公平性自查"],
        }
        return {"audit": fallback}


def _compose_title(state: AgentState) -> str:
    design = state.get("design") or {}
    brief = state.get("brief") or {}
    title = str(design.get("title") or brief.get("story_title") or "").strip()
    if title:
        return title
    raw = _last_user_text(state).replace("\n", " ").strip()
    return raw[:24] or "未命名诡计方案"


async def compose(
    state: AgentState, config: RunnableConfig, *, env: EnvConfig | None
) -> dict[str, Any]:
    writer = get_stream_writer()
    qa = bool(state.get("qa"))
    writer(
        {
            "event": "status",
            "stage": "compose",
            "label": "正在回答你的问题" if qa else "正在撰写开本稿",
        }
    )

    model = get_model(env, "answer")
    design = state.get("design") or {}
    audit_data = state.get("audit") or {}
    brief = state.get("brief") or {}
    research = state.get("research") or []
    title = _compose_title(state)

    writer(
        {
            "event": "meta",
            "title": title,
            "genre": brief.get("genre"),
            "lock_score": audit_data.get("lock_score"),
            "source_count": len(research),
            "brief": {
                "genre": brief.get("genre"),
                "players": brief.get("players"),
                "difficulty": brief.get("difficulty"),
            },
            "plan": design or None,
        }
    )

    payload = {
        "模式": "咨询问答" if qa else "完整方案",
        "需求": brief,
        "方案": design or None,
        "公平性自查": audit_data or None,
        "检索资料": research[:10],
        "用户本轮问题": _last_user_text(state),
        "最近对话": _recent_dialogue(state, limit=6),
    }
    system_prompt = COMPOSE_QA_SYSTEM if qa else COMPOSE_SYSTEM
    messages = [
        SystemMessage(content=system_prompt),
        HumanMessage(content=_json(payload)),
    ]

    parts: list[str] = []
    async for chunk in model.astream(messages):
        delta = _text(getattr(chunk, "content", ""))
        if not delta:
            continue
        parts.append(delta)
        writer({"event": "token", "delta": delta})

    answer = "".join(parts).strip()
    if not answer:
        raise RuntimeError("模型未返回正文内容，请重试。")

    return {"title": title}


def after_understand(state: AgentState) -> str:
    return "compose" if state.get("qa") else "research"
