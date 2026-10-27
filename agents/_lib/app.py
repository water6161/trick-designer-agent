"""剧本杀诡计设计师 Agent 的 HTTP 入口实现。

平台约定：
- 目录名即路由，入口函数签名 handler(context)
- conversation_id 由请求头 Makers-Conversation-Id 注入
- 会话记忆使用 context.store.langgraph_checkpointer（平台 Blob 存储）
- 流式输出使用 context.utils.stream_sse
"""

from __future__ import annotations

import asyncio
import json
import re
import time
from typing import Any, AsyncIterator

from langchain_core.messages import HumanMessage

from .config import ConfigError, load_env
from .graph import build_graph
from .logger import create_logger
from .models import init_models

logger = create_logger("handler")

MAX_MESSAGE_CHARS = 4000
USER_ID_PATTERN = re.compile(r"^[0-9a-zA-Z._-]{6,64}$")


# ───────────────────────── SSE ─────────────────────────


def _sse(event: str, data: Any) -> str:
    return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False, default=str)}\n\n"


HEARTBEAT_SECONDS = 20


async def _run_graph(graph: Any, payload: dict[str, Any], config: dict[str, Any]):
    """转发图事件；长时间无事件时发送心跳，避免前端看起来像卡死。"""
    queue: asyncio.Queue[Any] = asyncio.Queue()
    end = object()

    async def produce() -> None:
        try:
            async for chunk in graph.astream(
                payload,
                config=config,
                stream_mode=["updates", "custom"],
                version="v2",
            ):
                if chunk.get("type") != "custom":
                    continue
                data = chunk.get("data") or {}
                event = str(data.get("event") or "")
                if not event:
                    continue
                await queue.put((event, {key: value for key, value in data.items() if key != "event"}))
        except asyncio.TimeoutError:
            logger.error("graph timeout")
            await queue.put(
                ("error", {"code": "timeout", "message": "生成超时了，请稍后重试，或把需求拆小一点。"})
            )
        except Exception as exc:  # noqa: BLE001 - 统一转成前端友好提示
            logger.exception("graph failed", exc)
            await queue.put(("error", {"code": "agent_error", "message": _friendly_error(exc)}))
        finally:
            await queue.put(end)

    task = asyncio.ensure_future(produce())
    try:
        while True:
            try:
                item = await asyncio.wait_for(queue.get(), timeout=HEARTBEAT_SECONDS)
            except asyncio.TimeoutError:
                yield "status", {"stage": "waiting", "label": "模型仍在生成中，请稍候…"}
                continue
            if item is end:
                break
            yield item
    finally:
        if not task.done():
            task.cancel()
            try:
                await task
            except BaseException:
                pass


def _friendly_error(exc: BaseException) -> str:
    text = f"{type(exc).__name__}: {exc}".lower()
    if "timeout" in text or "timed out" in text:
        return "模型响应超时，请稍后重试；长方案建议先给出题材和人数再逐步细化。"
    if "rate limit" in text or "429" in text or "quota" in text:
        return "模型调用额度或频率受限，请稍等一会儿再试。"
    if "context" in text or "maximum" in text or "token" in text:
        return "对话上下文过长，已接近模型上限。建议新建一个会话继续。"
    if "401" in text or "unauthorized" in text or "api key" in text:
        return "模型网关鉴权失败，请检查项目环境变量 AI_GATEWAY_API_KEY。"
    if "no tool" in text or "tool_calls" in text:
        return "模型输出格式异常，请重试一次。"
    return "生成过程中出现异常，请稍后重试。如果持续失败，请新建会话再来一次。"


def _cancel_waiter(signal: Any) -> asyncio.Future | None:
    """把客户端中断信号适配成可等待对象，兼容 Web AbortSignal 与平台封装。"""
    if signal is None:
        return None
    wait = getattr(signal, "wait", None)
    if callable(wait):
        try:
            return asyncio.ensure_future(wait())
        except Exception:  # noqa: BLE001
            return None
    try:
        loop = asyncio.get_running_loop()
        future: asyncio.Future = loop.create_future()
        if getattr(signal, "aborted", False):
            future.set_result(None)
            return future
        listener = getattr(signal, "add_event_listener", None) or getattr(signal, "addEventListener", None)
        if callable(listener):
            def _on_abort(*_: Any) -> None:
                if not future.done():
                    future.set_result(None)

            listener("abort", _on_abort)
            return future
    except Exception:  # noqa: BLE001
        return None
    return None


async def _stream_with_cancel(context: Any, source: AsyncIterator[tuple[str, Any]]):
    """支持客户端断开时中止图执行。"""
    agen = source.__aiter__()
    signal = getattr(getattr(context, "request", None), "signal", None)
    cancel_task = _cancel_waiter(signal)
    pending: asyncio.Task | None = None

    try:
        while True:
            if pending is None:
                pending = asyncio.ensure_future(agen.__anext__())
            wait_set = {pending}
            if cancel_task is not None:
                wait_set.add(cancel_task)
            done, _ = await asyncio.wait(wait_set, return_when=asyncio.FIRST_COMPLETED)

            if cancel_task is not None and cancel_task in done:
                logger.log("client disconnected, aborting stream")
                break

            try:
                event, data = pending.result()
            except StopAsyncIteration:
                break
            pending = None
            yield event, data
    finally:
        if pending is not None and not pending.done():
            pending.cancel()
            try:
                await pending
            except BaseException:
                pass
        if cancel_task is not None and not cancel_task.done():
            cancel_task.cancel()
            try:
                await cancel_task
            except BaseException:
                pass
        try:
            await agen.aclose()
        except Exception as exc:  # noqa: BLE001
            logger.error("aclose failed", str(exc))


# ───────────────────────── store helpers ─────────────────────────


def _to_plain(value: Any) -> Any:
    if value is None or isinstance(value, (str, int, float, bool)):
        return value
    if isinstance(value, dict):
        return {str(key): _to_plain(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [_to_plain(item) for item in value]

    dump = getattr(value, "model_dump", None)
    if callable(dump):
        try:
            return _to_plain(dump())
        except Exception:
            pass

    as_dict = getattr(value, "_asdict", None)
    if callable(as_dict):
        try:
            return _to_plain(as_dict())
        except Exception:
            pass

    if hasattr(value, "__dict__"):
        return {key: _to_plain(item) for key, item in vars(value).items() if not key.startswith("_")}
    return str(value)


def _pick(data: dict[str, Any], *keys: str) -> Any:
    for key in keys:
        if key in data and data[key] is not None:
            return data[key]
    return None


def _content_text(content: Any) -> str:
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts = []
        for item in content:
            if isinstance(item, str):
                parts.append(item)
            elif isinstance(item, dict):
                text = item.get("text") or item.get("content")
                if isinstance(text, str):
                    parts.append(text)
            else:
                text = getattr(item, "text", None)
                if isinstance(text, str):
                    parts.append(text)
        return "".join(parts)
    if isinstance(content, dict):
        text = content.get("text")
        if isinstance(text, str):
            return text
    text = getattr(content, "text", None)
    return text if isinstance(text, str) else ""


def _user_id(context: Any) -> str:
    headers = getattr(getattr(context, "request", None), "headers", None)
    raw = ""
    if headers is not None:
        try:
            raw = (headers.get("x-client-id") or headers.get("X-Client-Id") or "").strip()
        except Exception:
            raw = ""
    return raw if USER_ID_PATTERN.match(raw) else "anonymous"


async def _append_message(
    store: Any,
    conversation_id: str,
    role: str,
    content: str,
    user_id: str,
    metadata: dict[str, Any] | None = None,
) -> None:
    try:
        await store.append_message(
            conversation_id=conversation_id,
            role=role,
            content=content,
            user_id=user_id,
            metadata=metadata or {"source": "web"},
        )
    except Exception as exc:  # noqa: BLE001 - 记忆写入失败不应打断对话
        logger.exception("append_message failed", exc)


async def _touch_conversation(store: Any, conversation_id: str, title: str) -> None:
    try:
        await store.update_conversation(
            conversation_id=conversation_id,
            metadata={"title": title},
        )
    except Exception as exc:  # noqa: BLE001
        logger.warn("update_conversation failed", str(exc))


# ───────────────────────── actions ─────────────────────────


async def _handle_sessions(store: Any, user_id: str) -> dict[str, Any]:
    try:
        try:
            result = await store.list_conversations(user_id=user_id, limit=50)
        except TypeError:
            result = await store.list_conversations(limit=50)
    except Exception as exc:  # noqa: BLE001
        logger.exception("list_conversations failed", exc)
        return {"sessions": [], "error": "读取会话列表失败，请刷新页面重试。"}

    plain = _to_plain(result)
    if isinstance(plain, dict):
        items = plain.get("items") or []
    elif isinstance(plain, list):
        items = plain
    else:
        items = []

    sessions = []
    for item in items:
        if not isinstance(item, dict):
            continue
        conversation_id = _pick(item, "conversationId", "conversation_id", "id")
        if not conversation_id:
            continue
        metadata = item.get("metadata") or {}
        title = ""
        if isinstance(metadata, dict):
            title = str(metadata.get("title") or "")
        sessions.append(
            {
                "id": str(conversation_id),
                "title": title or "未命名剧本",
                "updatedAt": _pick(item, "lastMessageAt", "last_message_at", "updatedAt", "updated_at"),
            }
        )
    return {"sessions": sessions}


async def _handle_history(store: Any, conversation_id: str) -> dict[str, Any]:
    try:
        messages = await store.get_messages(conversation_id=conversation_id, limit=100)
    except Exception as exc:  # noqa: BLE001
        logger.exception("get_messages failed", exc)
        return {"messages": [], "error": "读取历史消息失败，请重试。"}

    output = []
    for message in messages or []:
        plain = _to_plain(message)
        if not isinstance(plain, dict):
            continue
        role = plain.get("role")
        if role not in ("user", "assistant"):
            continue
        text = _content_text(plain.get("content"))
        if not text:
            continue
        output.append(
            {
                "role": role,
                "content": text,
                "createdAt": _pick(plain, "createdAt", "created_at"),
            }
        )
    return {"messages": output}


def _md_rows(text: str) -> list[list[str]]:
    """解析 Markdown 表格行为二维数组，自动跳过分隔行。"""
    rows: list[list[str]] = []
    for line in text.splitlines():
        line = line.strip()
        if not line.startswith("|"):
            continue
        cells = [c.strip() for c in line.strip("|").split("|")]
        if cells and all(re.fullmatch(r":?-{2,}:?", c) for c in cells if c):
            continue
        if any(c for c in cells):
            rows.append(cells)
    return rows


def _md_section(md: str, name: str) -> str:
    match = re.search(rf"^##\s*{re.escape(name)}[^\n]*\n(.*?)(?=^##\s|\Z)", md, re.M | re.S)
    return match.group(1) if match else ""


def _md_subsection(md: str, name: str) -> str:
    match = re.search(rf"^###\s*{re.escape(name)}[^\n]*\n(.*?)(?=^##[#]?[^\n]|\Z)", md, re.M | re.S)
    return match.group(1) if match else ""


def _md_table_after(md: str, name: str) -> str:
    """取「name 小节」之后的表格文本；小节缺失时从 name 之后全局找第一张表。"""
    text = _md_subsection(md, name)
    if _md_rows(text):
        return text
    match = re.search(rf"{re.escape(name)}[^\n]*\n(.*?)(?=^##[#]?[^\n]|\Z)", md, re.M | re.S)
    return match.group(1) if match else text


def _rows_to_objects(rows: list[list[str]]) -> list[dict[str, str]]:
    """把表头为「字段/字段/…」的表格转成对象列表。"""
    if len(rows) < 2:
        return []
    header = [h.replace("*", "").strip() for h in rows[0]]
    return [
        {header[i]: cells[i] for i in range(min(len(header), len(cells))) if header[i]}
        for cells in rows[1:]
    ]


def _parse_plan_from_markdown(md: str) -> dict[str, Any]:
    """从流式 Markdown 正文解析沉浸模式/线索卡所需的结构化数据。

    提取节点失败时的兜底：正文一定存在，解析失败也只是字段少一点。
    """
    plan: dict[str, Any] = {}

    title_match = re.search(r"^#\s*[《\"]?([^《》\n]{2,40})[》\"]?", md, re.M)
    if title_match:
        plan["title"] = title_match.group(1).strip()
    tagline_match = re.search(r"^>\s*([^>\n]{6,60})$", md, re.M)
    if tagline_match and "声明" not in tagline_match.group(1):
        plan["tagline"] = tagline_match.group(1).strip()

    # 背景与死者（第二节）
    body = _md_section(md, "二")
    if body:
        paras = [p.strip() for p in re.split(r"\n\s*\n|\n(?=[^\n|]{8,}：)", body) if p.strip() and not p.strip().startswith("|")]
        plan["background"] = "\n".join(paras)[:800]
        victim_text = "\n".join(
            line.strip() for line in body.splitlines() if line.strip() and not line.strip().startswith("|")
        )
        victim: dict[str, str] = {}
        for pattern, key in (
            (r"死者[：:]\s*([^\n，,（(。]{2,12})", "name"),
            (r"身份[：:]\s*([^\n]{2,30})", "identity"),
            (r"死亡时间[：:]\s*([^\n]{2,20})", "death_time"),
            (r"现场[：:]\s*([^\n]{2,80})", "scene"),
            (r"发现[：:]\s*([^\n]{2,60})", "found_by"),
        ):
            m = re.search(pattern, victim_text)
            if m:
                victim[key] = m.group(1).strip()
        if victim:
            plan["victim"] = victim

    # 凶手与角色（第四节；分段生成时「## 四」标题可能省略，直接全局找子标题）
    culprit_text = _md_subsection(md, "凶手")
    if culprit_text:
        name_match = (
            re.search(r"凶手[：:]\s*([^\n，,（(。]{2,12})", culprit_text)
            or re.search(r"凶手[：:]\s*([^\n，,（(。]{2,12})", md)
            or re.match(r"^\s*([^\n，,（(。：:]{2,12})", culprit_text)
        )
        plan["culprit"] = {
            "character": name_match.group(1).strip() if name_match else "",
            "motive": culprit_text[:400],
        }
    char_table = _rows_to_objects(_md_rows(_md_table_after(md, "角色表")))
    plan["characters"] = [
        {
            "name": row.get("角色") or row.get("姓名") or row.get("名字") or "",
            "identity": row.get("身份") or "",
            "secret": row.get("秘密") or "",
            "suspicion": row.get("被怀疑点") or row.get("怀疑点") or "",
        }
        for row in char_table
    ]

    # 线索（第五节）
    for key, sub in (("clues_public", "公开线索"), ("clues_deep", "深入线索")):
        rows = _rows_to_objects(_md_rows(_md_table_after(md, sub)))
        plan[key] = [
            {
                "id": row.get("编号") or "",
                "name": row.get("线索") or row.get("名称") or row.get("线索内容") or "",
                "content": row.get("线索内容") or row.get("内容") or row.get("线索") or "",
                "points_to": row.get("指向或排除") or row.get("指向") or "",
                "access": row.get("获取方式") or "",
                "why_fair": row.get("为什么公平") or "",
            }
            for row in rows
        ]

    # 时间线（第六节）
    tl_rows = _rows_to_objects(_md_rows(_md_section(md, "六")))
    plan["timeline"] = [
        {
            "time": row.get("时间") or "",
            "event": row.get("事件") or "",
            "witness": row.get("可验证方式") or row.get("可验证") or "",
            "visibility": "深入" if "深入" in (row.get("公开或深入") or "") else "公开",
        }
        for row in tl_rows
    ]

    score_match = re.search(r"锁凶充分性评分[：:]\s*(\d{1,3})\s*/\s*100", md)
    if score_match:
        plan["lock_score"] = int(score_match.group(1))
    return plan


async def _handle_export(store: Any, conversation_id: str) -> dict[str, Any]:
    """导出当前会话最后一版完整方案（优先取非 partial 的最长 assistant 消息）。"""
    try:
        messages = await store.get_messages(conversation_id=conversation_id, limit=100)
    except Exception as exc:  # noqa: BLE001
        logger.exception("export get_messages failed", exc)
        return {"error": "读取会话内容失败，请重试。"}

    best: dict[str, Any] = {}
    title = ""
    lock_score: Any = None
    plan: Any = None
    brief: Any = None
    for message in messages or []:
        plain = _to_plain(message)
        if not isinstance(plain, dict) or plain.get("role") != "assistant":
            continue
        text = _content_text(plain.get("content")).strip()
        if len(text) < 200:  # 跳过闲聊回复，只导出成稿
            continue
        metadata = plain.get("metadata") or {}
        if isinstance(metadata, dict):
            if metadata.get("partial"):
                continue
            if not title:
                title = str(metadata.get("title") or "")
            if lock_score is None and metadata.get("lockScore") is not None:
                lock_score = metadata.get("lockScore")
            if metadata.get("plan"):
                plan = metadata.get("plan")
                brief = metadata.get("brief")
        if len(text) > len(best.get("markdown", "")):
            best = {"markdown": text}

    if not best.get("markdown"):
        return {"error": "当前会话还没有可导出的完整方案。先生成一次方案再导出。"}

    if not plan:
        # 结构化提取失败时，直接从 Markdown 正文解析，保证沉浸模式/线索卡可用
        plan = _parse_plan_from_markdown(best["markdown"])
        if lock_score is None and plan.get("lock_score") is not None:
            lock_score = plan.get("lock_score")

    return {
        "title": title or "未命名诡计方案",
        "markdown": best["markdown"],
        "lockScore": lock_score,
        "brief": brief,
        "plan": plan,
    }


async def _handle_ai_cover(env: Any, store: Any, conversation_id: str, style: str = "character") -> dict[str, Any]:
    """调用通义万相生成 AI 封面插画，返回 base64 图片（前端再叠加标题文字）。

    走 DashScope 异步文生图接口：建任务 → 轮询 → 取图 → 转 base64。
    任何一步失败都返回友好 error，不影响其他功能。
    style: character=人物海报 / group=群像剪影 / scene=场景氛围
    """
    import base64

    import requests

    export = await _handle_export(store, conversation_id)
    if export.get("error") or not export.get("markdown"):
        return {"error": export.get("error") or "还没有可导出的方案。"}
    if not getattr(env, "api_key", "") or "dashscope" not in str(getattr(env, "base_url", "")):
        return {"error": "当前模型服务不支持 AI 生图。"}

    title = str(export.get("title") or "未命名诡计方案")[:24]
    brief = export.get("brief") or {}
    genre = str(brief.get("genre") or "")
    era = str(brief.get("era") or brief.get("background") or "")
    era_part = f"，{era}背景" if era else ""
    if style == "group":
        prompt = (
            f"日系动漫风格剧本杀群像海报插画，精致二次元五官，{genre}题材{era_part}，五到六位嫌疑人全身群像，"
            "每位都是独立完整的人物：年龄性别身份各不相同，服装道具严格贴合各自职业与时代背景，"
            "神态各异——有人镇定自若、有人眼神闪躲、有人攥紧拳头、有人强作微笑，"
            "人物之间明暗光影交错，仿佛每个人都在隐藏秘密，动漫人物面部精致、比例协调，"
            "构图上人物分层错落站位避免重叠，中央上方留出标题空间，"
            "深蓝夜色与暗红色调，电影级群像打光，戏剧性构图，"
            "高清大师级插画画质，画面中不要出现任何文字、字母或水印"
        )
    elif style == "scene":
        prompt = (
            f"剧本杀游戏封面插画，{title}，{genre}题材，悬疑惊悚氛围，"
            "深蓝夜色与暗红色调，电影级光影，戏剧性构图，细节丰富，"
            "高清大师级插画画质，画面中不要出现任何文字、字母或水印"
        )
    else:  # character（默认）：主角人物海报
        prompt = (
            f"日系动漫风格剧本杀人物海报插画，精致二次元五官，{genre}题材{era_part}，主角半身像特写：神秘人物立于阴影中，"
            "面部半掩于明暗交界的光影里，眼神锐利意味深长，手中持有一件关键线索道具（怀表/信件/匕首），"
            "服装与发型严格贴合题材时代背景，背景虚化处理并隐约有案发现场轮廓，"
            "深蓝夜色与暗红色调，电影级伦勃朗人物打光，海报级构图，动漫人物面部精致、比例协调，"
            "高清大师级插画画质，画面中不要出现任何文字、字母或水印"
        )
    negative = "文字, 字母, 水印, 血腥, 恐怖恶心, 低质量, 模糊, 变形, 多余手指, 面部扭曲, 写实人脸, 照片写实风格, 脸部畸形, 五官错位"

    api_key = getattr(env, "api_key", "")
    base = str(getattr(env, "base_url", "")).replace("/compatible-mode/v1", "")

    def _call() -> str:
        create = requests.post(
            f"{base}/api/v1/services/aigc/text2image/image-synthesis",
            headers={"Authorization": f"Bearer {api_key}", "X-DashScope-Async": "enable",
                     "Content-Type": "application/json"},
            json={
                "model": "wanx2.1-t2i-turbo",
                "input": {"prompt": prompt, "negative_prompt": negative},
                "parameters": {"n": 1, "size": "720*960", "prompt_extend": True},
            },
            timeout=30,
        )
        create.raise_for_status()
        task_id = str(((create.json().get("output") or {}).get("task_id")) or "")
        if not task_id:
            raise RuntimeError(f"未获取到 task_id：{create.text[:200]}")
        url = ""
        for _ in range(30):
            time.sleep(3)
            poll = requests.get(
                f"{base}/api/v1/tasks/{task_id}",
                headers={"Authorization": f"Bearer {api_key}"},
                timeout=15,
            )
            body = poll.json().get("output") or {}
            status = str(body.get("task_status") or "")
            if status == "SUCCEEDED":
                url = str(((body.get("results") or [{}])[0].get("url")) or "")
                break
            if status in ("FAILED", "CANCELED", "UNKNOWN"):
                raise RuntimeError(f"生图任务失败：{status} {str(body.get('message') or '')[:120]}")
        if not url:
            raise RuntimeError("生图任务超时（90 秒）")
        img = requests.get(url, timeout=30)
        img.raise_for_status()
        return "data:image/png;base64," + base64.b64encode(img.content).decode()

    try:
        image = await asyncio.to_thread(_call)
        return {"image": image, "title": export.get("title") or title}
    except Exception as exc:  # noqa: BLE001
        logger.exception("ai cover failed", exc)
        msg = str(exc)[:200]
        if "Model.ACC" in msg or "403" in msg or "InvalidApiKey" in msg:
            msg = "当前阿里云账号未开通通义万相生图服务（或额度不足），可到百炼控制台开通后重试。"
        return {"error": f"AI 封面生成失败：{msg}"}


async def _handle_delete(store: Any, conversation_id: str) -> dict[str, Any]:
    try:
        await store.delete_conversation(conversation_id=conversation_id)
        return {"ok": True}
    except Exception as exc:  # noqa: BLE001
        logger.exception("delete_conversation failed", exc)
        return {"ok": False, "error": "删除会话失败，请稍后重试。"}


# ───────────────────────── search tool ─────────────────────────


def _search_tool(context: Any) -> Any:
    tools = getattr(context, "tools", None)
    if tools is None:
        return None
    try:
        from langchain_core.tools import StructuredTool

        converter = getattr(tools, "to_langchain_tools", None)
        if callable(converter):
            converted = None
            # 兼容不同版本平台的签名差异
            for build in (
                lambda: converter(StructuredTool, names=["web_search"]),
                lambda: converter(names=["web_search"]),
                lambda: converter(StructuredTool),
                lambda: converter(),
            ):
                try:
                    converted = build()
                except TypeError:
                    continue
                if converted:
                    break
            if converted:
                for tool in converted:
                    if getattr(tool, "name", "") == "web_search":
                        return tool
                return converted[0]
    except Exception as exc:  # noqa: BLE001
        logger.warn("to_langchain_tools failed", str(exc))
    try:
        getter = getattr(tools, "get", None)
        if callable(getter):
            return getter("web_search")
    except Exception as exc:  # noqa: BLE001
        logger.warn("tools.get failed", str(exc))
    return None


# ───────────────────────── entry ─────────────────────────


async def handler(context: Any):
    body = getattr(context.request, "body", None) or {}
    if not isinstance(body, dict):
        return {"error": "请求体必须是 JSON 对象。"}

    action = str(body.get("action") or "chat")
    conversation_id = str(getattr(context, "conversation_id", "") or "")
    if not conversation_id:
        return {"error": "缺少 Makers-Conversation-Id 请求头。"}

    store = context.store
    user_id = _user_id(context)

    if action == "sessions":
        return await _handle_sessions(store, user_id)
    if action == "history":
        return await _handle_history(store, conversation_id)
    if action == "delete":
        target = str(body.get("conversation_id") or conversation_id)
        return await _handle_delete(store, target)
    if action == "export":
        return await _handle_export(store, conversation_id)
    if action == "ai_cover":
        cover_style = str(body.get("cover_style") or "character")
        if cover_style not in ("character", "group", "scene"):
            cover_style = "character"
        return await _handle_ai_cover(env, store, conversation_id, cover_style)
    if action not in ("chat", "retry"):
        return {"error": f"未知 action：{action}"}

    message = str(body.get("message") or "").strip()
    if action == "chat" and not message:
        return {"error": "请输入你的剧本设定或问题。"}
    if len(message) > MAX_MESSAGE_CHARS:
        return {"error": f"输入过长（{len(message)} 字），请控制在 {MAX_MESSAGE_CHARS} 字以内。"}

    try:
        env = load_env(context.env)
        init_models(env)
    except ConfigError as exc:
        logger.error(str(exc))
        return {"error": str(exc)}
    except Exception as exc:  # noqa: BLE001
        logger.exception("init models failed", exc)
        return {"error": "模型初始化失败，请检查网关配置。"}

    try:
        checkpointer = context.store.langgraph_checkpointer
        graph = build_graph(
            checkpointer=checkpointer,
            env=env,
            search_tool=_search_tool(context),
        )
    except Exception as exc:  # noqa: BLE001
        logger.exception("build graph failed", exc)
        return {"error": "会话记忆初始化失败，请确认 edgeone.json 已声明 langgraph 框架。"}

    config = {"configurable": {"thread_id": conversation_id}}

    async def generate(initial: dict[str, Any] | None, append_user: bool):
        yield _sse("session", {"conversationId": conversation_id})
        if append_user:
            await _append_message(store, conversation_id, "user", message, user_id)

        answer_parts: list[str] = []
        meta: dict[str, Any] = {}
        errored = False

        async for event, data in _stream_with_cancel(context, _run_graph(graph, initial, config)):
            if event == "token":
                answer_parts.append(str(data.get("delta") or ""))
            elif event == "meta":
                meta = data
            elif event == "error":
                errored = True
            yield _sse(event, data)

        answer = "".join(answer_parts).strip()
        title = str(meta.get("title") or message.replace("\n", " ")[:24] or "未命名剧本")

        if answer:
            metadata: dict[str, Any] = {
                "source": "web",
                "title": title,
                "partial": errored,
                "lockScore": meta.get("lock_score"),
            }
            # 结构化方案随消息持久化，供导出（线索卡/玩家版）使用
            if meta.get("plan"):
                metadata["plan"] = meta.get("plan")
                metadata["brief"] = meta.get("brief") or {}
            await _append_message(
                store,
                conversation_id,
                "assistant",
                answer,
                user_id,
                metadata=metadata,
            )
        await _touch_conversation(store, conversation_id, title)

        if errored:
            return

        yield _sse(
            "done",
            {
                "conversationId": conversation_id,
                "title": title,
                "lockScore": meta.get("lock_score"),
                "sourceCount": meta.get("source_count", 0),
            },
        )

    if action == "retry":
        # 断点续跑：None 输入让 LangGraph 从 checkpointer 中上次失败的节点继续，
        # 已成功的节点（如 understand/research）不会重复执行。
        logger.log("chat resume", {"conversationId": conversation_id})
        return context.utils.stream_sse(generate(initial=None, append_user=False))

    logger.log("chat start", {"conversationId": conversation_id, "chars": len(message)})
    return context.utils.stream_sse(
        generate(
            initial={
                "messages": [HumanMessage(content=message)],
                "user_id": user_id,
            },
            append_user=True,
        )
    )
