"""运行指标（全链路 trace）：把「这次生成到底慢在哪、失败在哪」变成可查的数据。

为什么需要：
- 以前出问题只能翻平台日志，没有 P95、没有首字延迟、没有阶段耗时，
  面试官问「线上怎么排查」时没有抓手；
- 阶段耗时能直接暴露瓶颈（是 design 慢还是 score 慢），调 prompt 才有依据；
- 全部数据只存进程内最近 N 条，不落盘、不含用户原文，只保留哈希与长度，
  避免为了可观测性引入隐私与存储问题。

取舍说明：
- 生产环境应该接 OpenTelemetry，这里的实现是**零依赖版本**，
  目的是让指标可被看见，而不是替代 APM；
- token 数是从字符数估算的（中文约 0.7 token/字），
  所以字段名统一带 `est` 前缀，避免被当成账单数据；
- 多实例部署时各自统计，聚合值只代表当前实例。
"""

from __future__ import annotations

import hashlib
import re
import time
from collections import deque
from typing import Any

_CAPACITY = 200
_RECENT_LIMIT = 20

# 输出 token 的公开牌价（元 / 千 token），仅用于「量级参考」
_PRICE_IN_PER_K = 0.0008
_PRICE_OUT_PER_K = 0.002

_CJK = re.compile(r"[\u4e00-\u9fff]")

_records: deque[dict[str, Any]] = deque(maxlen=_CAPACITY)

# 硬规则失败计数：code -> {"label": 名称, "count": 次数}
_rule_failures: dict[str, dict[str, Any]] = {}


def estimate_tokens(text: str) -> int:
    """中文字符按 0.7 token、其余按 4 字符 1 token 估算。"""
    if not text:
        return 0
    cjk = len(_CJK.findall(text))
    rest = max(len(text) - cjk, 0)
    return int(cjk * 0.7 + rest / 4) + 1


def _hash(value: str) -> str:
    """用户/会话标识只留 8 位哈希，既能分组又不泄露原文。"""
    if not value:
        return "-"
    return hashlib.sha256(value.encode("utf-8")).hexdigest()[:8]


def record(
    *,
    trace_id: str,
    action: str,
    user_id: str = "",
    conversation_id: str = "",
    duration_ms: int = 0,
    first_token_ms: int = 0,
    stages: dict[str, int] | None = None,
    events: int = 0,
    chars_in: int = 0,
    chars_out: int = 0,
    ok: bool = True,
    error: str = "",
) -> dict[str, Any]:
    """记录一次请求的 trace。任何字段缺失都不影响其他统计。"""
    item = {
        "traceId": trace_id,
        "action": action,
        "user": _hash(user_id),
        "conv": _hash(conversation_id),
        "at": time.strftime("%Y-%m-%dT%H:%M:%S", time.localtime()),
        "durationMs": int(duration_ms),
        "firstTokenMs": int(first_token_ms),
        "stages": {str(k): int(v) for k, v in (stages or {}).items()},
        "events": int(events),
        "charsIn": int(chars_in),
        "charsOut": int(chars_out),
        "estTokensIn": max(0, int(chars_in * 0.7)),
        "estTokensOut": max(0, int(chars_out * 0.7)),
        "ok": bool(ok),
        "error": (error or "")[:120],
    }
    _records.append(item)
    return item


def record_rules(checks: list[dict[str, Any]]) -> None:
    """累计每条硬规则的失败次数，用于回答「哪种问题最常出现」。

    只统计 status=fail 的条目：partial 属于「待完善」，混进来会让排行失真。
    """
    for check in checks or []:
        if check.get("status") != "fail":
            continue
        code = str(check.get("code") or "")
        if not code:
            continue
        entry = _rule_failures.setdefault(code, {"label": str(check.get("label") or code), "count": 0})
        entry["count"] = int(entry["count"]) + 1


def _rule_rows() -> list[dict[str, Any]]:
    return [
        {"code": code, "label": entry["label"], "count": entry["count"]}
        for code, entry in sorted(_rule_failures.items(), key=lambda kv: -kv[1]["count"])[:6]
    ]


def _percentile(values: list[int], pct: float) -> int:
    if not values:
        return 0
    ordered = sorted(values)
    index = min(len(ordered) - 1, max(0, int(round((pct / 100) * (len(ordered) - 1)))))
    return int(ordered[index])


def snapshot() -> dict[str, Any]:
    """返回聚合指标，供 /stats 接口与前端指标面板使用。"""
    items = list(_records)
    total = len(items)
    if total == 0:
        return {
            "total": 0,
            "ok": 0,
            "failed": 0,
            "successRate": None,
            "latency": {"p50": 0, "p95": 0, "avg": 0},
            "firstToken": {"p50": 0, "p95": 0},
            "stages": [],
            "tokens": {"estIn": 0, "estOut": 0, "estCostCny": 0.0},
            "errors": [],
            "ruleFailures": _rule_rows(),
            "recent": [],
            "capacity": _CAPACITY,
        }

    ok_items = [item for item in items if item["ok"]]
    durations = [item["durationMs"] for item in items]
    first_tokens = [item["firstTokenMs"] for item in items if item["firstTokenMs"] > 0]

    stage_totals: dict[str, list[int]] = {}
    for item in items:
        for stage, ms in (item["stages"] or {}).items():
            stage_totals.setdefault(stage, []).append(int(ms))
    stages = [
        {
            "stage": stage,
            "avgMs": int(sum(values) / len(values)),
            "p95Ms": _percentile(values, 95),
            "samples": len(values),
        }
        for stage, values in stage_totals.items()
    ]
    stages.sort(key=lambda row: row["avgMs"], reverse=True)

    error_counts: dict[str, int] = {}
    for item in items:
        if item["ok"] or not item["error"]:
            continue
        error_counts[item["error"]] = error_counts.get(item["error"], 0) + 1
    errors = [{"message": msg, "count": n} for msg, n in sorted(error_counts.items(), key=lambda kv: -kv[1])[:5]]

    est_in = sum(item["estTokensIn"] for item in items)
    est_out = sum(item["estTokensOut"] for item in items)

    return {
        "total": total,
        "ok": len(ok_items),
        "failed": total - len(ok_items),
        "successRate": round(len(ok_items) / total, 3),
        "latency": {
            "p50": _percentile(durations, 50),
            "p95": _percentile(durations, 95),
            "avg": int(sum(durations) / total),
        },
        "firstToken": {
            "p50": _percentile(first_tokens, 50),
            "p95": _percentile(first_tokens, 95),
        },
        "stages": stages,
        "tokens": {
            "estIn": est_in,
            "estOut": est_out,
            "estCostCny": round(est_in / 1000 * _PRICE_IN_PER_K + est_out / 1000 * _PRICE_OUT_PER_K, 4),
        },
        "errors": errors,
        "ruleFailures": _rule_rows(),
        "recent": list(reversed(items[-_RECENT_LIMIT:])),
        "capacity": _CAPACITY,
    }


def reset() -> None:
    """清空统计（单测用）。"""
    _records.clear()
    _rule_failures.clear()
