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
    COMPOSE_QA_SYSTEM,
    COMPOSE_SYSTEM,
    DESIGN_STREAM_SYSTEM,
    EXTRACT_SYSTEM,
    UNDERSTAND_SYSTEM,
)
from .schemas import BriefPatch, PlanDigest
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
    timeouts: list[float],
) -> BaseModel:
    """通过 function call 取结构化结果；按 timeouts 逐次尝试，失败做 JSON 兜底。"""
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
    max_attempts = len(timeouts)
    for attempt in range(max_attempts):
        timeout = timeouts[attempt]
        try:
            response = await asyncio.wait_for(bound.ainvoke(working), timeout=timeout)
        except (asyncio.TimeoutError, TimeoutError):
            # 单次超时只作废本次尝试，继续下一轮，避免整体直接失败
            last_error = f"第{attempt + 1}次尝试超时（{timeout:.0f}s）"
            logger.error("structured attempt %d/%d timed out after %.0fs", attempt + 1, max_attempts, timeout)
            if attempt < max_attempts - 1:
                continue
            break
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

        # 诊断日志：失败时记录模型真实返回形态，便于远程定位
        stop = getattr(response, "response_metadata", {}) or {}
        logger.error(
            "structured attempt %d/%d failed: tool_calls=%d content_len=%d stop=%s content_head=%s",
            attempt + 1,
            max_attempts,
            len(calls),
            len(content),
            str(stop.get("finish_reason") or stop)[:60],
            content[:160].replace("\n", " "),
        )

        if attempt < max_attempts - 1:
            working = list(messages) + [
                AIMessage(content=content or "（无内容）"),
                HumanMessage(
                    content=(
                        "上一次没有按要求返回结构化结果。请立即调用 emit_result 工具，"
                        "严格按给定 JSON Schema 填写，不要输出解释文字。"
                        "时间有限，内容务必精简：公开线索3条、深入线索2条、时间线4条、角色4人，"
                        "每条一两句话点到为止。"
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
        model, BriefPatch, messages, timeouts=[90, 60]
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
        updates["design_markdown"] = ""

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


DESIGN_PARTS = [
    {
        "no": 1,
        "title": "标题·速览·背景·核心诡计",
        "ask": "现在写【第一部分】：从「# 《标题》」开始，到「## 三、核心诡计」整节结束（含现实不可复刻说明）。只输出这一部分。",
        "label": "正在搭建核心诡计（1/3）",
    },
    {
        "no": 2,
        "title": "凶手·角色·线索清单",
        "ask": "现在写【第二部分】：从「## 四、凶手与人物逻辑」开始，到「## 五、线索清单」整节结束（公开线索+深入线索两张表）。只输出这一部分。",
        "label": "正在铺开人物与线索（2/3）",
    },
    {
        "no": 3,
        "title": "时间线·自查·DM 提示",
        "ask": "现在写【第三部分】：从「## 六、时间线」开始，到「## 十、可迭代方向」与创作声明结束。只输出这一部分。",
        "label": "正在收尾时间线与自查（3/3）",
    },
]


async def _stream_part(
    model: Any,
    base_payload: str,
    part: dict[str, Any],
    writer: Any,
    timeouts: list[float],
    deadline: float | None = None,
) -> str:
    """单段流式生成：独立超时、独立重试，超时时已输出的内容保留。"""
    for attempt, budget in enumerate(timeouts):
        if deadline is not None:
            remaining = deadline - asyncio.get_running_loop().time()
            if remaining < 20:
                logger.error("design part %s skipped: global deadline exhausted", part["no"])
                break
            timeout = min(budget, remaining)
        else:
            timeout = budget
        lean = attempt > 0
        messages = [
            SystemMessage(content=DESIGN_STREAM_SYSTEM),
            HumanMessage(
                content=(
                    base_payload
                    + "\n"
                    + part["ask"]
                    + ("【时间有限，本部分务必精简，每条一两句话点到为止。】" if lean else "")
                )
            ),
        ]
        parts: list[str] = []

        async def _consume() -> None:
            async for chunk in model.astream(messages):
                delta = _text(getattr(chunk, "content", ""))
                if delta:
                    parts.append(delta)
                    writer({"event": "token", "delta": delta})

        try:
            await asyncio.wait_for(_consume(), timeout=timeout)
            text = "".join(parts).strip()
            if len(text) >= 120:
                return text
            logger.error("design part %s too short (%d chars)", part["no"], len(text))
        except TimeoutError:
            logger.error("design part %s attempt %d timed out after %.0fs", part["no"], attempt + 1, timeout)
        # 超时/过短：已流出的内容保留在页面上，下轮重试只补写本段
        if parts:
            writer({"event": "token", "delta": "\n\n"})
        if attempt < len(timeouts) - 1:
            continue
    # 兜底：本段失败不拖垮整个方案
    writer(
        {
            "event": "notice",
            "message": f"「{part['title']}」部分生成超时已跳过，其余部分不受影响；你可以直接让我补写这一节。",
        }
    )
    return f"## 待补充：{part['title']}\n（本节生成超时，请回复「补写 {part['no']}」让我补上。）"


async def design(
    state: AgentState, config: RunnableConfig, *, env: EnvConfig | None
) -> dict[str, Any]:
    """分段流式设计：方案拆 3 段独立生成，任何一段超时只丢一段，不再整体卡死。"""
    writer = get_stream_writer()
    writer({"event": "status", "stage": "design", "label": "正在分段生成完整方案"})

    model = get_model(env, "reason")
    brief = state.get("brief") or {}
    previous_markdown = state.get("design_markdown") or ""
    research = state.get("research") or []
    speed = _speed_mode(state)

    payload = {
        "需求": brief,
        "本轮改动": brief.get("modifications") or [],
        "本地知识库参考（可引用思路但不要照抄）": retrieve_knowledge(brief),
        "联网检索资料（用于规避烂梗与雷点，不要照抄）": [
            {"title": item.get("title"), "snippet": item.get("snippet"), "href": item.get("href")}
            for item in research[:10]
        ],
        "上一版方案相关段落（迭代时在它基础上修改，为空表示全新创作）": previous_markdown[:6000] or None,
        "本轮用户原话": _last_user_text(state),
        "输出基调": (
            "【极速模式】全文精简：公开线索4条、深入线索3条、时间线4条、角色4人，每条一两句话点到为止。"
            if speed
            else "内容完整：公开线索6~8条、深入线索5~6条、时间线5条左右、角色5~6人。"
        ),
    }
    base_payload = _json(payload)

    chunks: list[str] = []
    # 全局预算：给 extract 与成稿留出 ≥80s，避免三段都慢时撞平台 300s 硬上限
    deadline = asyncio.get_running_loop().time() + (195 if not speed else 165)
    for part in DESIGN_PARTS:
        writer({"event": "status", "stage": "design", "label": part["label"]})
        text = await _stream_part(
            model,
            base_payload,
            part,
            writer,
            timeouts=[115, 85] if not speed else [95, 70],
            deadline=deadline,
        )
        chunks.append(text)

    markdown = "\n\n".join(chunks).strip()
    if len(markdown) < 200:
        raise RuntimeError("方案正文过短，模型可能未正常输出，请重试。")

    writer({"event": "status", "stage": "designed", "label": "方案正文已完成"})
    return {"design_markdown": markdown}


async def extract(
    state: AgentState, config: RunnableConfig, *, env: EnvConfig | None
) -> dict[str, Any]:
    """用轻量模型把流式 Markdown 秒级提取为结构化摘要（供线索卡/沉浸模式/导出）。

    提取失败不阻断交付：Markdown 正文已经展示给用户，只少了结构化卡片。
    """
    writer = get_stream_writer()
    writer({"event": "status", "stage": "extract", "label": "正在提取线索卡与人物档案"})

    markdown = state.get("design_markdown") or ""
    model = get_model(env, "fast")
    messages = [
        SystemMessage(content=EXTRACT_SYSTEM),
        HumanMessage(content=markdown[:16000]),
    ]

    try:
        digest: PlanDigest = await _invoke_structured(  # type: ignore[assignment]
            model, PlanDigest, messages, timeouts=[90, 60]
        )
    except Exception as exc:
        logger.exception("extract failed", exc)
        writer({"event": "notice", "message": "结构化摘要提取失败，方案正文不受影响；线索卡/沉浸模式本轮不可用。"})
        return {"design": {}, "audit": {}}

    design = {
        "title": digest.title,
        "tagline": digest.tagline,
        "victim": {
            "name": digest.victim_name,
            "identity": digest.victim_identity,
            "death_time": digest.victim_death_time,
            "cause": "",
            "scene": digest.victim_scene,
            "found_by": "",
        },
        "background": digest.background,
        "core_trick": {
            "name": digest.core_trick_name,
            "category": digest.core_trick_category,
            "steps": digest.core_trick_steps,
            "principle": digest.core_trick_principle,
            "why_works": "",
            "risks": [],
            "reality_safety": digest.reality_safety,
        },
        "culprit": {
            "character": digest.culprit,
            "motive": digest.culprit_motive,
            "opportunity": "",
            "method": "",
            "cover_up": [],
            "evidence_chain": digest.culprit_evidence_chain,
        },
        "characters": [c.model_dump() for c in digest.characters],
        "clues_public": [c.model_dump() for c in digest.clues_public],
        "clues_deep": [c.model_dump() for c in digest.clues_deep],
        "timeline": [t.model_dump() for t in digest.timeline],
        "red_herrings": [],
        "dm_tips": [],
        "anti_argument": [],
        "player_traps": [],
        "iteration_hooks": [],
    }
    audit = {
        "lock_score": digest.lock_score,
        "verdict": digest.audit_verdict,
        "must_fix": digest.must_fix,
        "sufficient_to_identify": digest.lock_score >= 60,
    }
    writer(
        {
            "event": "notice",
            "message": f"结构化摘要完成：锁凶充分性 {digest.lock_score}/100，线索卡/沉浸模式已就绪。",
        }
    )
    return {"design": design, "audit": audit}


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

    if not qa:
        # 完整方案已在 design 节点实时流式展示，这里不再二次生成，直接收尾
        writer({"event": "status", "stage": "done", "label": "方案交付完成"})
        return {"title": title}

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


def _speed_mode(state: AgentState) -> bool:
    """用户消息含【极速模式】标记时，设计与自查改用轻量模型，大幅提速。"""
    return "极速" in _last_user_text(state)
