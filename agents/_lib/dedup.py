"""诡计查重：从历史会话的存储数据提取诡计指纹，生成前注入避开指令。

设计取舍：
- 指纹直接从会话 metadata（brief / plan.core_trick）推导，不新建存储表；
- list_conversations 已随 metadata 返回全部历史方案摘要，零额外 IO；
- 相似度判定刻意保持保守：只在诡计类型重叠或核心手法同名时才注入，
  避免把「用户就是喜欢密室」误判成「雷同」；
- 任何一步失败都静默降级为无提示，绝不阻断生成。
"""

from __future__ import annotations

from typing import Any

# 指纹里保留的 plan.core_trick 字段（DesignPlan 的结构）
_CORE_NAME_KEYS = ("name", "core_trick_name", "core_trick")
_CORE_CATEGORY_KEYS = ("category", "core_trick_category")


def _as_list(value: Any) -> list[str]:
    if isinstance(value, list):
        return [str(v).strip() for v in value if str(v).strip()]
    if isinstance(value, str) and value.strip():
        return [value.strip()]
    return []


def _pick(data: dict[str, Any], keys: tuple[str, ...]) -> str:
    for key in keys:
        if key in data and data[key]:
            return str(data[key]).strip()
    return ""


def extract_fingerprint(brief: dict[str, Any] | None, plan: dict[str, Any] | None) -> dict[str, Any]:
    """从一份方案的数据里提取诡计指纹：{"types": [...], "core": 名称, "category": 类别}。"""
    brief = brief or {}
    plan = plan or {}
    types = _as_list(brief.get("trick_types"))
    core = ""
    category = ""
    trick = plan.get("core_trick")
    if isinstance(trick, dict):
        core = _pick(trick, _CORE_NAME_KEYS)
        category = _pick(trick, _CORE_CATEGORY_KEYS)
    if not core:
        core = _pick(plan, _CORE_NAME_KEYS)
    if category and category not in types:
        types.append(category)
    return {"types": types, "core": core, "category": category}


def collect_fingerprints(items: list[Any], exclude_conversation_id: str = "") -> list[dict[str, Any]]:
    """从 list_conversations 的返回里收集所有历史方案的诡计指纹。

    items 兼容两种形态：裸列表，或 {"items": [...]}。跳过当前会话与残缺数据。
    """
    if isinstance(items, dict):
        items = items.get("items") or []
    result: list[dict[str, Any]] = []
    for item in items:
        if not isinstance(item, dict):
            continue
        cid = str(item.get("conversationId") or item.get("conversation_id") or item.get("id") or "")
        if exclude_conversation_id and cid == exclude_conversation_id:
            continue
        metadata = item.get("metadata")
        if not isinstance(metadata, dict):
            continue
        fp = extract_fingerprint(metadata.get("brief"), metadata.get("plan"))
        if fp["types"] or fp["core"]:
            result.append(fp)
    return result


def build_avoidance_hint(current_brief: dict[str, Any] | None, fingerprints: list[dict[str, Any]]) -> str | None:
    """比对当前需求与历史指纹，命中时返回注入 design 提示词的避开指令；否则 None。

    命中条件（满足其一）：
    - 当前需求的诡计类型与某次历史方案的类型有交集；
    - 历史方案的核心手法名与当前需求类型同名（如需求点名「叙诡」而上次核心就是叙诡）。
    """
    if not fingerprints:
        return None
    current_types = _as_list((current_brief or {}).get("trick_types"))

    used_types: list[str] = []
    used_cores: list[str] = []
    for fp in fingerprints:
        for t in fp.get("types") or []:
            if t not in used_types:
                used_types.append(t)
        core = str(fp.get("core") or "").strip()
        if core and core not in used_cores:
            used_cores.append(core)

    overlap = [t for t in current_types if t in used_types]
    core_clash = [c for c in used_cores if any(t and (t in c or c in t) for t in current_types)]

    if not overlap and not core_clash:
        return None

    lines: list[str] = []
    if overlap:
        lines.append(
            "用户最近的方案已经用过以下诡计类型：" + "、".join(overlap)
            + "。本次核心手法必须给出明显不同的新角度：换底层原理（如机械密室→心理密室），"
              "或换误导方向，不要只换场景和人物皮。"
        )
    if core_clash:
        lines.append(
            "以下核心手法与已用方案直接重名：" + "、".join(core_clash)
            + "。若确属用户点名要求，请在具体机制、动机与线索分布上做出显著差异化，并在自查里说明差异点。"
        )
    if used_cores:
        lines.append("历史已用核心手法（供参考避开）：" + "、".join(used_cores[:6]))
    return "\n".join(lines)
