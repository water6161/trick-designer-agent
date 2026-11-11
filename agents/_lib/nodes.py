"""LangGraph 节点实现。"""

from __future__ import annotations

import asyncio
import json
import re
from typing import Any

from langchain_core.messages import AIMessage, HumanMessage, SystemMessage
from langchain_core.runnables import RunnableConfig
from langgraph.config import get_stream_writer
from pydantic import BaseModel, ValidationError

from . import dedup, telemetry
from .amap import extract_place, fetch_weather_note
from .config import EnvConfig
from .difficulty import estimate_difficulty
from .fairness import check_fairness, summary_line
from .kb import retrieve_knowledge
from .logger import create_logger
from .mdplan import parse_plan_from_markdown
from .models import get_model
from .trick_graph import build_gap_instruction, build_trick_graph
from .prompts import (
    AUDIT_SYSTEM,
    COMPOSE_QA_SYSTEM,
    COMPOSE_SYSTEM,
    DESIGN_STREAM_SYSTEM,
    EXTRACT_SYSTEM,
    PROBE_SYSTEM,
    UNDERSTAND_SYSTEM,
)
from .schemas import BriefPatch, PlanDigest, QualityScore, QuickQuestions
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
            # 按目标 schema 给不同的重试提示：轻量结构不需要「精简线索数」这类诱导
            if schema is PlanDigest:
                hint = (
                    "上一次没有按要求返回结构化结果。请立即调用 emit_result 工具，"
                    "严格按给定 JSON Schema 填写，不要输出解释文字。"
                    "时间有限，内容务必精简：公开线索3条、深入线索2条、时间线4条、角色4人，"
                    "每条一两句话点到为止。"
                )
            else:
                hint = (
                    "上一次没有按要求返回结构化结果。请立即调用 emit_result 工具，"
                    "严格按给定 JSON Schema 填写，字段没有信息就留空，不要输出解释文字。"
                )
            working = list(messages) + [
                AIMessage(content=content or "（无内容）"),
                HumanMessage(content=hint),
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


def _looks_like_chitchat(user_text: str) -> bool:
    """整句寒暄/能力咨询：模型抖动时也要能正确识别为闲聊而非「要新方案」。"""
    return bool(
        re.fullmatch(
            r"[\s，。！？~～、,.!?]*(你好|您好|hi|hello|在吗|嗨|哈喽|你是谁|你能做什么|能干什么|怎么用|怎么玩|如何使用|帮助|help)[\s，。！？~～、,.!?]*",
            user_text.strip(),
            re.IGNORECASE,
        )
    )


def _looks_like_question(user_text: str) -> bool:
    """短问句且不含生成动词 → 是在问，不是在下单。"""
    text = user_text.strip()
    # 「怎么做」里的「做」不是下单动词，先把它从生成动词判断中排除
    probe = re.sub(r"怎么做|如何做|怎样做", "", text)
    return bool(
        re.search(r"(怎么|如何|能不能|可以|是否|为什么|什么|哪)", text)
        and not re.search(r"(帮我|给我|写一|来一|做一|生成|出一)", probe)
        and len(text) <= 40
    )


def _wants_skip_probe(user_text: str) -> bool:
    """明确表示「别问了/直接生成/你看着办」时尊重其意愿，跳过追问。"""
    return bool(
        re.search(
            r"(不用|不要|别|无需|不必|免)(再)?(问|追问|确认)"
            r"|直接(生成|出|写|做|开始)"
            r"|(自己)?(决定|看着办|拿主意)"
            r"|随意|随便你|你看着来|你看着办",
            user_text,
        )
    )


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

    # 兜底：明显的寒暄 / 能力咨询 / 纯提问，不该被当成「要一套新方案」
    _chat_only = _looks_like_chitchat(user_text)
    _asks_how = _looks_like_question(user_text)
    if (_chat_only or _asks_how) and intent == "new" and not state.get("design"):
        intent = "question"
        qa = True

    updates: dict[str, Any] = {"brief": brief, "intent": intent, "qa": qa, "pending": False}

    # 上一轮发了追问：本轮用户输入即回答，附进需求后正常出方案
    if state.get("pending"):
        brief["answers"] = user_text
        updates["brief"] = brief

    # 上一轮给了多方案对比：本轮输入是选方向
    if state.get("mode") == "compared":
        brief["compare_pick"] = user_text
        brief["answers"] = user_text  # 选向即视为已回应追问，不再二次追问
        updates["brief"] = brief
        updates["mode"] = ""
        intent = "new" if not state.get("design") else intent
        qa = False
        updates["intent"] = intent
        updates["qa"] = False

    # 首次出方案且要求多方案对比：进入对比模式
    if (
        intent == "new"
        and not state.get("design")
        and re.search(r"对比|多方案|几个方向|多给几个", user_text)
    ):
        updates["mode"] = "compare"

    # 用户明确要求推翻重做时，清掉旧方案，避免模型被上一版锚定
    if intent == "new" and state.get("design"):
        updates["design"] = {}
        updates["audit"] = {}
        updates["research"] = []
        updates["design_markdown"] = ""

    # 用户明确表示「不用追问 / 直接生成」时尊重其意愿，跳过追问环节
    _skip_probe = _wants_skip_probe(user_text)

    # 首次出完整方案且信息有空白时，先追问 2~3 个关键问题（回答后一次到位）
    if (
        intent == "new"
        and not state.get("design")
        and updates.get("mode") != "compare"
        and not state.get("pending")
        and not brief.get("answers")
        and not _skip_probe
    ):
        try:
            probe: QuickQuestions = await _invoke_structured(  # type: ignore[assignment]
                model,
                QuickQuestions,
                [
                    SystemMessage(content=PROBE_SYSTEM),
                    HumanMessage(content=_json({"需求": brief, "本轮用户输入": user_text})),
                ],
                timeouts=[30, 20],
            )
            questions = [q.strip() for q in probe.questions if q.strip()][:3]
            if questions:
                lines = "\n".join(f"{i}. {q}" for i, q in enumerate(questions, 1))
                for delta in (
                    "为了让方案一次到位，先和你确认几个关键点：\n\n"
                    f"{lines}\n\n直接回答即可，也可以说「直接生成」让我自行决定。"
                ):
                    writer({"event": "token", "delta": delta})
                updates["pending"] = True
                writer({"event": "status", "stage": "understood", "label": "已提出追问，等待回答"})
                return updates
        except Exception as exc:  # noqa: BLE001 - 追问失败不阻断主流程
            logger.exception("probe failed", exc)

    writer({"event": "status", "stage": "understood", "label": "需求已确认"})
    return updates


async def research(
    state: AgentState, config: RunnableConfig, *, search_tool: Any = None, env: EnvConfig | None = None
) -> dict[str, Any]:
    writer = get_stream_writer()

    # 极速模式：联网检索要多轮网络往返，是「出骨架」路径上最不值的一段开销。
    # 骨架阶段本来就只要主线，套路纠偏留给正式模式。
    if _speed_mode(state):
        writer({"event": "status", "stage": "research", "label": "极速模式：跳过联网检索"})
        writer({"event": "notice", "message": "极速模式已跳过联网检索，直接给骨架；需要套路校验请关闭极速模式重新生成。"})
        return {"research": []}

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
        "ask": (
            "现在写【第三部分】：从「## 六、时间线」开始，到「## 十一、沉浸互动剧情」整节结束与创作声明结束。只输出这一部分。"
            "在 DM 提示之后加入「### 结局分支」小节：一张 4 列表格（结局 / 触发条件 / 支撑线索 / 走向），"
            "给出 2~3 条分支结局——1 条真结局 + 1~2 条取决于玩家推理走向的分支（如错指凶手的替罪羊结局、全员隐瞒的沉默结局）。"
            "「支撑线索」列必须引用线索表中的编号（如 C1、D2），不得使用表中不存在的编号——这是 verify 硬校验项。"
        ),
        "label": "正在收尾时间线与自查（3/3）",
    },
]


# ── 单段重写：把「重写第 N 部分」这类请求，映射到 DESIGN_PARTS 的某一段 ──

# 每段的标题关键章节号：用于在既有 Markdown 中定位该段的起止边界
_PART_BOUNDS: list[tuple[str, str]] = [
    ("#", "## 四、"),          # 第 1 段：标题 … 到「四、凶手」之前
    ("## 四、", "## 六、"),     # 第 2 段：「四、凶手」… 到「六、时间线」之前
    ("## 六、", ""),           # 第 3 段：「六、时间线」… 到结尾
]

_REWRITE_HINT = re.compile(
    r"(?:重写|重生成|重新写|改写|再写|换掉|补写|补上|只改|只重写|只写)"
    r"|(?:改|换|调整)\s*(?:一下|下)?\s*第?\s*[1-3一二三]\s*(?:部分|段|章|节)"
    r"|第?\s*([1-3一二三])\s*(?:部分|段|章|节)\s*(?:重写|重生成|重新写|改写|再写|补写|补上|改)"
)
_PART_WORD = {"1": 0, "一": 0, "2": 1, "二": 1, "3": 2, "三": 2}


def _rewrite_part_index(state: AgentState, previous_markdown: str) -> int | None:
    """识别用户是否在要求「只重写某一段」，返回 DESIGN_PARTS 下标；否则 None。

    仅在已有完整方案、且用户明确指向某一段时才触发，避免误伤正常的迭代修改。
    支持「重写第二部分」「只改第三段」「第2部分再写一下」等表述。
    """
    if not previous_markdown or len(previous_markdown) < 120:
        return None
    text = _last_user_text(state)
    if not text:
        return None

    # 先找「第 N 部分/段/章」这种明确指向，再判断是否含重写动词
    # (?![下些点步]) 排除「改一下」「想一些」这类把「一」当量词的误匹配
    target = re.search(r"第?\s*([1-3一二三])(?![下些点步])[^，。！？\n]{0,4}?(?:部分|段|章|节)", text)
    if not target:
        return None
    if not re.search(r"重写|重生成|重新写|改写|再写|补写|补上|只改|换掉|改一下|调整", text):
        return None
    return _PART_WORD.get(target.group(1))


def _splice_part(previous_markdown: str, new_part: str, index: int) -> str:
    """把重写后的某一段拼回完整方案：替换该段覆盖的区间，其余章节保持不变。"""
    start_marker, end_marker = _PART_BOUNDS[index]
    text = previous_markdown

    if index == 0:
        # 第一段从文档开头（# 标题）起，到下一段标记前
        start = 0
        if not text.lstrip().startswith("#"):
            start = 0
    else:
        pos = text.find(start_marker)
        if pos < 0:
            # 找不到边界：退化为整体追加，保证不丢用户内容
            return (text.rstrip() + "\n\n" + new_part.strip()).strip()
        start = pos

    end = len(text)
    if end_marker:
        pos = text.find(end_marker, start + 1)
        if pos >= 0:
            end = pos

    head = text[:start].rstrip()
    tail = text[end:].lstrip()
    pieces = [p for p in (head, new_part.strip(), tail) if p]
    return "\n\n".join(pieces).strip()


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


# 极速模式专用：整份骨架一次写完。
# 分段的本意是「边写边看 + 避免单段超时」，但每段都要重发整份 payload
# （知识库/research/上一版正文），三次 prefill 是这条链路上最贵的固定开销；
# 骨架本身只有千把字，一次出完反而更快。
QUICK_PART = {
    "no": 0,
    "title": "骨架",
    "ask": "现在一次性写完整份骨架方案（含全部 7 节），不要分段提示，不要写开场白或收尾解释。",
    "label": "正在快速搭建骨架",
}


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
        "本地知识库参考（可引用思路但不要照抄）": None if speed else retrieve_knowledge(brief),
        "历史已用诡计（本次务必避开这些套路角度，除非用户点名）": dedup.build_avoidance_hint(
            brief, state.get("used_tricks") or []
        )
        or None,
        "硬规则校验发现的逻辑缺口（本轮优先补齐）": _gap_hint(state) if previous_markdown else None,
        "联网检索资料（用于规避烂梗与雷点，不要照抄）": [
            {"title": item.get("title"), "snippet": item.get("snippet"), "href": item.get("href")}
            for item in research[:10]
        ],
        "上一版方案相关段落（迭代时在它基础上修改，为空表示全新创作）": (
            previous_markdown[:2000] if speed else previous_markdown[:6000]
        )
        or None,
        "用户对追问的回答（追问器上轮提的问题）": brief.get("answers") or None,
        "用户选择的方向（多方案对比后的选择）": brief.get("compare_pick") or None,
        "本轮用户原话": _last_user_text(state),
        "输出基调": (
            "【极速模式·骨架】一次写完，全文控制在 900 字以内，只写下面 7 节，其他章节一律不写：\n"
            "1.「# 《标题》」+ 一行「> 卖点」\n"
            "2.「## 一、案件速览」：一张表，只 1 行数据（题材/人数/难度/诡计类型）\n"
            "3.「## 二、死者与案发背景」：2 句话（死者身份、现场状态）\n"
            "4.「## 三、核心诡计」：先「### 手法拆解」写 3 步有序列表（每步一句话），"
            "末尾 1 句现实不可复刻说明\n"
            "5.「## 四、凶手与人物逻辑」：先写「### 凶手」小标题，凶手/动机/机会/手法 各 1 句；"
            "再写「### 角色表」小标题，4 人表格（角色/身份/秘密/被怀疑点/外形锚点），"
            "外形锚点写发型发色或服装主色，10 字内\n"
            "6.「## 五、线索清单」：先「### 公开线索」3 条，再「### 深入线索」2 条，"
            "表格列固定为「编号/线索/指向或排除/获取方式」\n"
            "7.「## 六、时间线」：3 条，表格列「时间/事件/可验证方式」；其中至少 1 条必须是凶手的行动，"
            "另 1 条必须是死者死亡时间（这两点决定玩家能不能自己验证）\n"
            "不要写：结局分支、隐藏真结局、公平性自查、DM 提示、防杠、可迭代方向、沉浸互动剧情。"
            if speed
            else "内容完整：公开线索6~8条、深入线索5~6条、时间线5条左右、角色5~6人。"
        ),
    }
    base_payload = _json(payload)

    # 多方案对比模式：一次给出 2~3 个截然不同的诡计方向，用户选一个后再展开
    if state.get("mode") == "compare":
        writer({"event": "status", "stage": "design", "label": "正在构思多个诡计方向"})
        compare_messages = [
            SystemMessage(content=DESIGN_STREAM_SYSTEM),
            HumanMessage(
                content=(
                    base_payload
                    + "\n\n本次任务是【多方案对比】：给出 2~3 个截然不同的诡计方向（如密室方向 / 叙诡方向 / 身份方向）。"
                    "每个方向包含：方向代号（A/B/C）、《暂定标题》、一句话卖点、核心诡计 3 步简述、最大亮点、最大风险，"
                    "每个方向 150 字以内。最后单独一行提示：「回复 A / B / C 选择方向，我会沿该方向展开完整方案」。"
                    "不要输出其他章节。"
                )
            ),
        ]
        parts: list[str] = []
        try:
            async def _consume_compare() -> None:
                async for chunk in model.astream(compare_messages):
                    delta = _text(getattr(chunk, "content", ""))
                    if delta:
                        parts.append(delta)
                        writer({"event": "token", "delta": delta})

            await asyncio.wait_for(_consume_compare(), timeout=110)
        except TimeoutError:
            logger.error("compare generation timed out")
        comparison = "".join(parts).strip()
        if len(comparison) < 100:
            raise RuntimeError("多方案对比生成失败，请重试。")
        writer({"event": "status", "stage": "designed", "label": "对比方案已给出，等待选择"})
        return {"design_markdown": comparison, "design": {}, "audit": {}, "mode": "compared"}

    chunks: list[str] = []
    # 全局预算：给 extract 与成稿留出 ≥80s，避免三段都慢时撞平台 300s 硬上限
    # 极速模式只跑一段，预算收到 95s——超了就该降级/重试，而不是继续等
    deadline = asyncio.get_running_loop().time() + (195 if not speed else 95)

    # 单段重写：用户说「重写第二部分 / 只改第三章」时，只重跑对应那一段，其余章节原样保留
    only = _rewrite_part_index(state, previous_markdown)
    if only is not None:
        part = DESIGN_PARTS[only]
        writer({"event": "status", "stage": "design", "label": f"正在重写第 {part['no']} 部分"})
        text = await _stream_part(
            model,
            base_payload,
            part,
            writer,
            timeouts=[130, 95] if not speed else [100, 75],
            deadline=deadline,
        )
        merged = _splice_part(previous_markdown, text, only)
        writer({"event": "status", "stage": "designed", "label": f"第 {part['no']} 部分已重写"})
        return {"design_markdown": merged}

    if speed:
        # 极速模式：一次调用出完整骨架（正文短，合并不吃亏；省下两次 prefill）
        writer({"event": "status", "stage": "design", "label": QUICK_PART["label"]})
        text = await _stream_part(
            model,
            base_payload,
            QUICK_PART,
            writer,
            timeouts=[80, 50],
            deadline=deadline,
        )
        markdown = text.strip()
        if len(markdown) < 150:
            raise RuntimeError("方案正文过短，模型可能未正常输出，请重试。")
        writer({"event": "status", "stage": "designed", "label": "骨架已完成"})
        return {"design_markdown": markdown}

    for part in DESIGN_PARTS:
        writer({"event": "status", "stage": "design", "label": part["label"]})
        text = await _stream_part(
            model,
            base_payload,
            part,
            writer,
            timeouts=[115, 85],
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

    # 多方案对比轮没有正式方案，跳过提取
    if state.get("mode") == "compared":
        return {"design": {}, "audit": {}}

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


async def verify(
    state: AgentState, config: RunnableConfig, *, env: EnvConfig | None = None
) -> dict[str, Any]:
    """硬规则校验：确定性验证方案能不能开本，并给出诡计成立条件的线索覆盖矩阵。

    与 score 节点的区别：
    - score 让模型自评「好不好」，软判断，可能两次打分不一样；
    - verify 用规则验「成不成立」，纯计算、可复现、可单测，结论能直接摆给用户看。

    三条产出：
    - fairness：15 条硬规则加权得分（凶手在不在角色表、证据链几环、线索有没有获取方式…）
    - trickGraph：核心诡计的成立条件 × 线索覆盖矩阵，缺哪条一目了然
    - difficulty：难度档位与建议时长

    全部失败静默降级：校验是增值功能，不能拖垮交付。
    """
    writer = get_stream_writer()

    # 多方案对比轮还没有正式方案，跳过
    if state.get("mode") == "compared":
        return {"rules": {}}

    markdown = state.get("design_markdown") or ""
    plan = state.get("design") or {}
    if not plan:
        # extract 失败时从正文兜底解析：正文一定存在，解析到多少算多少
        plan = parse_plan_from_markdown(markdown)
    if not (plan.get("clues_public") or plan.get("clues_deep") or plan.get("characters")):
        logger.log("verify skipped: no structured plan available")
        return {"rules": {}}

    writer({"event": "status", "stage": "verify", "label": "正在跑硬规则校验"})

    try:
        fairness = check_fairness(plan, markdown)
        trick_graph = build_trick_graph(plan)
        difficulty = estimate_difficulty(plan)
    except Exception as exc:  # noqa: BLE001 - 校验失败不影响方案交付
        logger.exception("verify failed", exc)
        return {"rules": {}}

    telemetry.record_rules(fairness.get("checks") or [])
    writer({"event": "notice", "message": summary_line(fairness)})
    return {
        "rules": {
            "fairness": fairness,
            "trickGraph": trick_graph,
            "difficulty": difficulty,
        }
    }


async def score(
    state: AgentState, config: RunnableConfig, *, env: EnvConfig | None
) -> dict[str, Any]:
    """四维质量评分：线索公平性 / 锁凶闭环 / 时间线自洽 / 红鲱鱼质量。

    只打分不改稿，结果写入 state["quality"]，并由 compose 通过 meta 事件送到前端。
    任何失败都静默降级（评分是增值功能，不能拖垮交付）。
    """
    writer = get_stream_writer()
    markdown = state.get("design_markdown") or ""
    if not markdown:
        return {"quality": {}}

    writer({"event": "status", "stage": "score", "label": "正在做质量体检"})

    # 极速模式跳过：省下这一次模型调用换取整体提速
    if _speed_mode(state):
        logger.log("score skipped in speed mode")
        return {"quality": {}}

    # 评分是辅助功能：用 fast 模型换速度，实测 10s+ → 3s 内，且不占用设计模型配额
    model = get_model(env, "fast")
    messages = [
        SystemMessage(content=AUDIT_SYSTEM),
        HumanMessage(content=markdown[:16000]),
    ]
    try:
        result: QualityScore = await _invoke_structured(  # type: ignore[assignment]
            model, QualityScore, messages, timeouts=[60, 40]
        )
    except Exception as exc:  # noqa: BLE001
        logger.exception("quality score failed", exc)
        writer({"event": "notice", "message": "质量体检未完成，方案正文不受影响。"})
        return {"quality": {}}

    quality = {
        "clue_fairness": result.clue_fairness,
        "lock_closure": result.lock_closure,
        "timeline_coherence": result.timeline_coherence,
        "red_herring_quality": result.red_herring_quality,
        "total": result.total,
        "ready": result.total >= 32 and min(
            result.clue_fairness,
            result.lock_closure,
            result.timeline_coherence,
            result.red_herring_quality,
        ) >= 6,
        "issues": result.issues,
        "fix_hints": result.fix_hints,
    }
    writer(
        {
            "event": "notice",
            "message": (
                f"质量体检完成：综合 {result.total}/40"
                f"（线索公平 {result.clue_fairness}·锁凶闭环 {result.lock_closure}"
                f"·时间线 {result.timeline_coherence}·红鲱鱼 {result.red_herring_quality}）"
                + ("，可开本。" if quality["ready"] else "，建议按改进建议修订后再开本。")
            ),
        }
    )
    return {"quality": quality}


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
    quality = state.get("quality") or {}
    rules = state.get("rules") or {}
    brief = state.get("brief") or {}
    research = state.get("research") or []
    title = _compose_title(state)

    writer(
        {
            "event": "meta",
            "title": title,
            "genre": brief.get("genre"),
            "lock_score": audit_data.get("lock_score"),
            "quality": quality or None,
            "rules": rules or None,
            "source_count": len(research),
            "brief": {
                "genre": brief.get("genre"),
                "players": brief.get("players"),
                "difficulty": brief.get("difficulty"),
                "trick_types": brief.get("trick_types") or [],
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
    if state.get("pending"):
        return "ask"
    return "compose" if state.get("qa") else "research"


def _speed_mode(state: AgentState) -> bool:
    """用户消息含【极速模式】标记时，设计与自查改用轻量模型，大幅提速。"""
    return "极速" in _last_user_text(state)


def _gap_hint(state: AgentState) -> str | None:
    """把上一轮硬规则校验查出的逻辑缺口，转成本轮必须补齐的约束。

    这是「检出 → 修复」的闭环：verify 节点说缺什么，design 节点就被告知补什么。
    只在迭代（已有方案）时生效，首次生成没有上一轮结论可参考。
    """
    rules = state.get("rules") or {}
    graph = rules.get("trickGraph") or {}
    gaps = graph.get("gaps") or []
    if gaps:
        lines = [f"- {gap.get('label')}：{gap.get('hint')}" for gap in gaps[:4]]
        return "上一轮硬规则校验发现以下成立条件缺少玩家可见线索支撑，本轮必须补齐（其余内容保持不变）：\n" + "\n".join(lines)
    # 没有 rules 时（例如规则校验被跳过）退回现算一次，成本极低
    return build_gap_instruction(state.get("design"))
