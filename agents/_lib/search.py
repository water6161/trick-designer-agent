"""联网检索：优先使用 Makers 内置 web_search 工具。"""

from __future__ import annotations

import asyncio
import json
from typing import Any

from .logger import create_logger

logger = create_logger("search")

MAX_RESULTS_PER_QUERY = 5
MAX_SNIPPET = 220


def build_queries(brief: dict[str, Any]) -> list[str]:
    genre = str(brief.get("genre") or "本格").strip()
    tricks = [str(item).strip() for item in (brief.get("trick_types") or []) if str(item).strip()]
    trick_text = "、".join(tricks[:3]) if tricks else "经典诡计"
    special = str(brief.get("special") or "").strip()
    queries = [
        f"{genre} 剧本杀 {trick_text} 经典诡计 案例 设计思路",
        f"剧本杀 {trick_text} 常见雷点 玩家吐槽 公平性",
        f"剧本杀 {genre} 时间线 不在场证明 叙诡 套路 复盘",
    ]
    if special:
        queries.append(f"剧本杀 {genre} {special} 设定 玩法 注意事项")
    result: list[str] = []
    for query in queries:
        if query not in result:
            result.append(query)
    return result


def _pick(item: dict[str, Any], *keys: str) -> str:
    for key in keys:
        value = item.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
    return ""


def _normalize_items(raw: Any) -> list[dict[str, str]]:
    if isinstance(raw, str):
        text = raw.strip()
        if not text:
            return []
        try:
            raw = json.loads(text)
        except Exception:
            return []

    if isinstance(raw, dict):
        for key in ("results", "result", "data", "items", "hits"):
            value = raw.get(key)
            if isinstance(value, (list, dict)):
                return _normalize_items(value)
        raw = [raw]

    if not isinstance(raw, list):
        return []

    collected: list[dict[str, str]] = []
    for entry in raw:
        if isinstance(entry, str):
            collected.append({"title": entry[:80], "href": "", "snippet": entry[:MAX_SNIPPET], "date": ""})
            continue
        if not isinstance(entry, dict):
            continue
        snippet = _pick(entry, "snippet", "content", "summary", "description", "text")
        if len(snippet) > MAX_SNIPPET:
            snippet = snippet[:MAX_SNIPPET] + "…"
        item = {
            "title": _pick(entry, "title", "name") or "未命名结果",
            "href": _pick(entry, "href", "url", "link"),
            "snippet": snippet,
            "date": _pick(entry, "date", "published_at", "publishedAt", "time"),
        }
        if item["title"] or item["snippet"]:
            collected.append(item)
    return collected


def _dedupe(items: list[dict[str, str]], limit: int = 12) -> list[dict[str, str]]:
    seen: set[str] = set()
    result: list[dict[str, str]] = []
    for item in items:
        key = (item.get("href") or item.get("title") or "").strip().lower()
        if not key or key in seen:
            continue
        seen.add(key)
        result.append(item)
        if len(result) >= limit:
            break
    return result


async def _search_once(tool: Any, query: str) -> list[dict[str, str]]:
    response = await asyncio.wait_for(
        tool.ainvoke({"query": query, "maxResults": MAX_RESULTS_PER_QUERY}),
        timeout=25,
    )
    return _normalize_items(response)


async def run_searches(
    tool: Any, queries: list[str]
) -> tuple[list[dict[str, str]], list[str]]:
    """并发检索；单条失败不影响整体，返回 (结果, 错误提示)。"""
    if tool is None:
        return [], ["联网检索工具暂不可用，本次方案基于内置创作经验生成。"]

    tasks = [asyncio.create_task(_search_once(tool, query)) for query in queries]
    outcomes = await asyncio.gather(*tasks, return_exceptions=True)

    merged: list[dict[str, str]] = []
    errors: list[str] = []
    for query, outcome in zip(queries, outcomes):
        if isinstance(outcome, BaseException):
            logger.warn("web_search failed", query, f"{type(outcome).__name__}: {outcome}")
            errors.append("部分联网检索超时或失败，已使用其余结果继续生成。")
            continue
        merged.extend(outcome)

    if not merged and not errors:
        errors.append("未检索到有效资料，本次方案基于内置创作经验生成。")
    return _dedupe(merged), list(dict.fromkeys(errors))
