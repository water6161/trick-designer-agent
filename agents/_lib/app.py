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
        if len(text) > len(best.get("markdown", "")):
            best = {"markdown": text}

    if not best.get("markdown"):
        return {"error": "当前会话还没有可导出的完整方案。先生成一次方案再导出。"}

    return {
        "title": title or "未命名诡计方案",
        "markdown": best["markdown"],
        "lockScore": lock_score,
    }


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
    if action != "chat":
        return {"error": f"未知 action：{action}"}

    message = str(body.get("message") or "").strip()
    if not message:
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
    initial = {
        "messages": [HumanMessage(content=message)],
        "user_id": user_id,
    }

    logger.log("chat start", {"conversationId": conversation_id, "chars": len(message)})

    async def generate():
        yield _sse("session", {"conversationId": conversation_id})
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
            await _append_message(
                store,
                conversation_id,
                "assistant",
                answer,
                user_id,
                metadata={
                    "source": "web",
                    "title": title,
                    "partial": errored,
                    "lockScore": meta.get("lock_score"),
                },
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

    return context.utils.stream_sse(generate())
