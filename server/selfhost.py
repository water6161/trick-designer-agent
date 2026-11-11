"""剧本杀诡计设计师 Agent 的自托管入口（脱离 EdgeOne 平台独立运行）。

把平台 handler 包装成标准 FastAPI 服务：
- POST /trick-designer  → agents/trick-designer/index.py 的 handler
- POST /stop            → agents/stop/index.py 的 handler
- GET  /*               → dist/ 前端静态页（SPA）

平台 context 的自托管实现：
- context.request.body    解析好的 JSON dict
- context.request.headers Starlette Headers（大小写不敏感）
- context.request.signal  CancelSignal（/stop 触发 abort）
- context.conversation_id 来自 Makers-Conversation-Id 请求头
- context.env             dict（OS 环境变量 + 仓库根 .env 文件）
- context.store           LocalStore（JSON 文件持久化的会话存储）
- context.store.langgraph_checkpointer  AsyncSqliteSaver（SQLite 检查点）
- context.utils           stream_sse / abort_active_run

运行：python server/selfhost.py（PORT 环境变量控制端口，默认 80）
"""

from __future__ import annotations

import asyncio
import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path
from types import SimpleNamespace
from typing import Any

_BASE = Path(__file__).resolve().parent.parent
_AGENTS_DIR = str(_BASE / "agents")
if _AGENTS_DIR not in sys.path:
    sys.path.insert(0, _AGENTS_DIR)

from fastapi import FastAPI, Request  # noqa: E402
from fastapi.responses import JSONResponse, StreamingResponse  # noqa: E402
from fastapi.staticfiles import StaticFiles  # noqa: E402


def _load_handler_module(name: str, file: Path) -> Any:
    import importlib.util

    spec = importlib.util.spec_from_file_location(name, file)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


_agent_mod = _load_handler_module(
    "selfhost_trick_designer", _BASE / "agents" / "trick-designer" / "index.py"
)
_stop_mod = _load_handler_module("selfhost_stop", _BASE / "agents" / "stop" / "index.py")
agent_handler = _agent_mod.handler
stop_handler = _stop_mod.handler

DIST_DIR = _BASE / "dist"
DATA_DIR = _BASE / "data"
DATA_DIR.mkdir(parents=True, exist_ok=True)

# ───────────────────────── .env 加载 ─────────────────────────


def _load_dotenv() -> dict[str, str]:
    env: dict[str, str] = dict(os.environ)
    dotenv = _BASE / ".env"
    if dotenv.is_file():
        for line in dotenv.read_text(encoding="utf-8-sig").splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, _, value = line.partition("=")
            key = key.strip()
            value = value.strip().strip('"').strip("'")
            if key and value:
                env[key] = value
    return env


# ───────────────────────── 中断信号 ─────────────────────────


class CancelSignal:
    """兼容 _cancel_waiter 的最小 abort 信号：暴露 wait()/aborted。"""

    def __init__(self) -> None:
        self._event = asyncio.Event()

    @property
    def aborted(self) -> bool:
        return self._event.is_set()

    async def wait(self) -> None:
        await self._event.wait()

    def set(self) -> None:
        self._event.set()


_ACTIVE: dict[str, CancelSignal] = {}


# ───────────────────────── utils ─────────────────────────


class SelfHostUtils:
    """平台 context.utils 的自托管实现。"""

    def stream_sse(self, agen: Any) -> StreamingResponse:
        async def gen():
            async for frame in agen:
                yield frame

        return StreamingResponse(
            gen(),
            media_type="text/event-stream",
            headers={
                "Cache-Control": "no-cache",
                "X-Accel-Buffering": "no",
            },
        )

    def abort_active_run(self, conversation_id: str) -> bool:
        signal = _ACTIVE.get(conversation_id)
        if signal is None or signal.aborted:
            return False
        signal.set()
        return True


_UTILS = SelfHostUtils()


# ───────────────────────── store ─────────────────────────


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


class LocalStore:
    """JSON 文件持久化的最小会话存储，接口对齐平台 Blob 存储。

    数据结构：{"conversations": {cid: {"id", "user_id", "metadata", "messages": []}}}
    单进程部署足够用；读写都在 asyncio.Lock 内，避免并发写坏文件。
    """

    def __init__(self, path: Path, checkpointer: Any) -> None:
        self._path = path
        self._lock = asyncio.Lock()
        self._data: dict[str, Any] = {"conversations": {}}
        if path.is_file():
            try:
                self._data = json.loads(path.read_text(encoding="utf-8"))
            except Exception:  # noqa: BLE001 - 文件坏了就从空开始，别挡住启动
                self._data = {"conversations": {}}
        self._data.setdefault("conversations", {})
        self.langgraph_checkpointer = checkpointer

    async def _save(self) -> None:
        tmp = self._path.with_suffix(".tmp")
        tmp.write_text(
            json.dumps(self._data, ensure_ascii=False, default=str),
            encoding="utf-8",
        )
        tmp.replace(self._path)

    def _conv(self, conversation_id: str) -> dict[str, Any]:
        convs = self._data["conversations"]
        if conversation_id not in convs:
            convs[conversation_id] = {
                "id": conversation_id,
                "user_id": "",
                "metadata": {},
                "messages": [],
            }
        return convs[conversation_id]

    async def append_message(
        self,
        conversation_id: str,
        role: str,
        content: str,
        user_id: str = "anonymous",
        metadata: dict[str, Any] | None = None,
    ) -> None:
        async with self._lock:
            conv = self._conv(conversation_id)
            conv["messages"].append(
                {
                    "role": role,
                    "content": content,
                    "createdAt": _now(),
                    "metadata": metadata or {"source": "web"},
                }
            )
            conv["metadata"]["last_message_at"] = _now()
            conv["user_id"] = user_id or conv.get("user_id", "")
            await self._save()

    async def update_conversation(
        self,
        conversation_id: str,
        metadata: dict[str, Any] | None = None,
    ) -> None:
        async with self._lock:
            conv = self._conv(conversation_id)
            conv["metadata"].update(metadata or {})
            await self._save()

    async def list_conversations(
        self,
        user_id: str | None = None,
        limit: int = 50,
    ) -> dict[str, Any]:
        async with self._lock:
            items = [dict(v) for v in self._data["conversations"].values()]
        if user_id:
            items = [item for item in items if item.get("user_id") == user_id]
        items.sort(key=lambda item: item.get("metadata", {}).get("last_message_at", ""), reverse=True)
        items = items[:limit]
        return {
            "items": [
                {
                    "id": item["id"],
                    "conversationId": item["id"],
                    "metadata": item.get("metadata", {}),
                    "lastMessageAt": item.get("metadata", {}).get("last_message_at", ""),
                }
                for item in items
            ]
        }

    async def get_messages(self, conversation_id: str, limit: int = 100) -> list[dict[str, Any]]:
        async with self._lock:
            conv = self._data["conversations"].get(conversation_id)
            messages = list(conv.get("messages", [])) if conv else []
        return messages[-limit:]

    async def delete_conversation(self, conversation_id: str) -> None:
        async with self._lock:
            self._data["conversations"].pop(conversation_id, None)
            await self._save()


# ───────────────────────── checkpointer ─────────────────────────


async def _build_checkpointer() -> tuple[Any, Any]:
    """优先 SQLite 持久化（重启不丢方案版本），失败退回内存。返回 (checkpointer, closer)。"""
    try:
        from langgraph.checkpoint.sqlite.aio import AsyncSqliteSaver

        conn = await __import__("aiosqlite").connect(str(DATA_DIR / "checkpoints.sqlite3"))
        saver = AsyncSqliteSaver(conn)
        await saver.setup()
        return saver, conn
    except Exception as exc:  # noqa: BLE001 - 退化到内存检查点，服务照常可用
        print(f"[selfhost] sqlite checkpointer unavailable ({exc}), fallback to memory", flush=True)
        from langgraph.checkpoint.memory import InMemorySaver

        return InMemorySaver(), None


# ───────────────────────── FastAPI ─────────────────────────

app = FastAPI(title="trick-designer self-hosted")

_STORE: LocalStore | None = None
_ENV_CACHE: dict[str, str] = {}


def _make_context(body: dict[str, Any], headers: Any, signal: CancelSignal) -> SimpleNamespace:
    conversation_id = str(headers.get("makers-conversation-id") or "")
    request = SimpleNamespace(body=body, headers=headers, signal=signal)
    return SimpleNamespace(
        request=request,
        conversation_id=conversation_id,
        env=_ENV_CACHE,
        store=_STORE,
        utils=_UTILS,
    )


def _finalize(result: Any) -> Any:
    if isinstance(result, (StreamingResponse, JSONResponse)):
        return result
    return JSONResponse(result)


@app.post("/trick-designer")
async def agent_endpoint(request: Request):
    try:
        body = await request.json()
        if not isinstance(body, dict):
            body = {}
    except Exception:  # noqa: BLE001
        body = {}
    signal = CancelSignal()
    ctx = _make_context(body, request.headers, signal)
    conversation_id = ctx.conversation_id
    if conversation_id:
        _ACTIVE[conversation_id] = signal
    try:
        result = await agent_handler(ctx)
    finally:
        _ACTIVE.pop(conversation_id, None)
    return _finalize(result)


@app.post("/stop")
async def stop_endpoint(request: Request):
    try:
        body = await request.json()
        if not isinstance(body, dict):
            body = {}
    except Exception:  # noqa: BLE001
        body = {}
    signal = CancelSignal()
    ctx = _make_context(body, request.headers, signal)
    try:
        result = await stop_handler(ctx)
    finally:
        _ACTIVE.pop(str(body.get("conversationId") or ""), None)
    return _finalize(result)


@app.get("/healthz")
async def healthz():
    return {"ok": True, "ts": _now()}


if DIST_DIR.is_dir():
    app.mount("/", StaticFiles(directory=str(DIST_DIR), html=True), name="static")


@app.on_event("startup")
async def _startup() -> None:
    global _STORE, _ENV_CACHE
    _ENV_CACHE = _load_dotenv()
    checkpointer, _conn = await _build_checkpointer()
    _STORE = LocalStore(DATA_DIR / "store.json", checkpointer)
    print(f"[selfhost] ready, dist={'yes' if DIST_DIR.is_dir() else 'missing'}, data={DATA_DIR}", flush=True)


def main() -> None:
    import uvicorn

    port = int(os.environ.get("PORT") or _load_dotenv().get("PORT") or 80)
    uvicorn.run(app, host="0.0.0.0", port=port, log_level="info")


if __name__ == "__main__":
    main()
