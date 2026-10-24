"""中止当前会话正在执行的 Agent：POST /stop"""

from __future__ import annotations

from typing import Any


async def handler(context: Any):
    body = getattr(context.request, "body", None) or {}
    conversation_id = str(
        (body.get("conversationId") if isinstance(body, dict) else "")
        or getattr(context, "conversation_id", "")
        or ""
    )
    if not conversation_id:
        return {"error": "缺少 conversationId。"}

    try:
        aborted = context.utils.abort_active_run(conversation_id)
    except Exception:  # noqa: BLE001 - 停止是尽力而为，失败不阻断前端中断
        return {"status": "idle", "conversationId": conversation_id, "aborted": False}

    return {
        "status": "aborting" if aborted else "idle",
        "conversationId": conversation_id,
        "aborted": bool(aborted),
    }
