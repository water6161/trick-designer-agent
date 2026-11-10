"""公平性硬规则引擎：把「这个本能不能开」从模型自评变成确定性校验。

为什么需要它：
- score 节点让模型给自己打分，属于「软判断」，同一份稿子两次评分可能差 6 分，
  而且模型天然倾向于给自己高分，面试/复盘时无法解释「为什么是 34 分」；
- 真正能开本的硬条件是可以用规则验证的：凶手在不在角色表里、证据链够不够 3 环、
  关键线索有没有获取方式、死亡时间对不对得上时间线；
- 规则是纯函数、无 IO、无模型调用，改 prompt 不会让判定标准漂移，也能被单测固定住。

设计取舍：
1. 只验「可判定」的事项，不碰「好不好玩」这类主观项（那是 score 节点的事）；
2. 字段缺失（抽取失败）与规则不满足要区分：前者降级为 warn，后者才是 error；
3. 按「达标比例」给分而非二元判定，避免一条小瑕疵把整份方案判死；
4. 全部规则权重合计 100 分，输出里同时给分项明细，前端可以逐条展示。
"""

from __future__ import annotations

import re
from typing import Any, Callable

# ── 时间解析：把 21:40 / 21点40分 / 21点 统一成 "21:40" ──

_TIME_PATTERNS = (
    re.compile(r"(\d{1,2})\s*[:：]\s*(\d{2})"),
    re.compile(r"(\d{1,2})\s*点\s*(\d{1,2})?\s*分?"),
)


def _times(text: str) -> set[str]:
    found: set[str] = set()
    for pattern in _TIME_PATTERNS:
        for match in pattern.finditer(text or ""):
            hour = int(match.group(1))
            minute = int(match.group(2) or 0)
            if 0 <= hour <= 24 and 0 <= minute < 60:
                found.add(f"{hour}:{minute:02d}")
    return found


def _flat(value: Any) -> str:
    """把任意字段拍平成可匹配文本。"""
    if value is None:
        return ""
    if isinstance(value, str):
        return value
    if isinstance(value, (list, tuple)):
        return " ".join(_flat(item) for item in value)
    if isinstance(value, dict):
        return " ".join(_flat(item) for item in value.values())
    return str(value)


def _nonempty(value: Any) -> bool:
    return bool(_flat(value).strip())


# ── 上下文：一次遍历把所有要用的数据算好 ──


def _build_context(plan: dict[str, Any], markdown: str) -> dict[str, Any]:
    clues: list[tuple[str, dict[str, Any]]] = []
    for kind, key in (("公开", "clues_public"), ("深入", "clues_deep")):
        for clue in plan.get(key) or []:
            if isinstance(clue, dict):
                clues.append((kind, clue))

    characters = [c for c in (plan.get("characters") or []) if isinstance(c, dict)]
    timeline = [t for t in (plan.get("timeline") or []) if isinstance(t, dict)]
    culprit = plan.get("culprit")
    if isinstance(culprit, str):
        culprit = {"character": culprit}
    culprit = culprit or {}

    trick = plan.get("core_trick")
    if not isinstance(trick, dict):
        trick = {}

    victim = plan.get("victim")
    if not isinstance(victim, dict):
        victim = {}

    red_herrings = [r for r in (plan.get("red_herrings") or []) if isinstance(r, dict)]

    return {
        "plan": plan,
        "markdown": markdown or "",
        "clues": clues,
        "characters": characters,
        "timeline": timeline,
        "culprit": culprit,
        "trick": trick,
        "victim": victim,
        "red_herrings": red_herrings,
        "public_count": sum(1 for kind, _ in clues if kind == "公开"),
        "deep_count": sum(1 for kind, _ in clues if kind == "深入"),
    }


def _character_names(ctx: dict[str, Any]) -> list[str]:
    names = []
    for character in ctx["characters"]:
        name = str(character.get("name") or "").strip()
        if name:
            names.append(name)
    return names


def _culprit_name(ctx: dict[str, Any]) -> str:
    return str(ctx["culprit"].get("character") or "").strip()


def _loose_match(name: str, pool: list[str]) -> str:
    """角色名容错匹配：支持「林昭」「林昭（管家）」互相命中。"""
    if not name:
        return ""
    for candidate in pool:
        if candidate == name or name in candidate or candidate in name:
            return candidate
    return ""


# ── 单条规则 ──


def _check_clue_ids(ctx: dict[str, Any]) -> tuple[float, str]:
    clues = ctx["clues"]
    if not clues:
        return 0.0, "没有任何线索，无法判定"
    ids = [str(clue.get("id") or "").strip() for _, clue in clues]
    filled = [i for i in ids if i]
    unique = set(filled)
    if len(unique) == len(ids):
        return 1.0, f"{len(unique)} 条线索编号唯一"
    return len(unique) / len(ids), f"{len(ids)} 条线索中有 {len(ids) - len(unique)} 条编号缺失或重复"


def _check_clue_access(ctx: dict[str, Any]) -> tuple[float, str]:
    clues = ctx["clues"]
    if not clues:
        return 0.0, "没有任何线索"
    ok = sum(1 for _, clue in clues if _nonempty(clue.get("access")))
    ratio = ok / len(clues)
    if ratio >= 1:
        return 1.0, f"{ok} 条线索均写明获取方式"
    return ratio * 0.9, f"{len(clues) - ok} 条线索没有写获取方式，玩家可能拿不到"


def _check_clue_points_to(ctx: dict[str, Any]) -> tuple[float, str]:
    clues = ctx["clues"]
    if not clues:
        return 0.0, "没有任何线索"
    ok = sum(1 for _, clue in clues if _nonempty(clue.get("points_to")))
    ratio = ok / len(clues)
    if ratio >= 1:
        return 1.0, f"{ok} 条线索均写明指向或排除"
    return ratio * 0.9, f"{len(clues) - ok} 条线索没写指向/排除，等于给了玩家一条无用信息"


def _check_cast_size(ctx: dict[str, Any]) -> tuple[float, str]:
    count = len(_character_names(ctx))
    if count >= 5:
        return 1.0, f"{count} 名嫌疑人，推理密度充足"
    if count == 4:
        return 0.7, "只有 4 名嫌疑人，可怀疑范围偏窄"
    return max(count / 5, 0.2), f"仅 {count} 名嫌疑人，撑不起讨论量"


def _check_culprit_in_cast(ctx: dict[str, Any]) -> tuple[float, str]:
    name = _culprit_name(ctx)
    pool = _character_names(ctx)
    if not name:
        return 0.0, "没有写明凶手是谁"
    if not pool:
        return 0.4, "角色表缺失，无法核对凶手是否在名单内"
    hit = _loose_match(name, pool)
    if hit:
        return 1.0, f"凶手「{name}」在角色表内"
    return 0.0, f"凶手「{name}」不在角色表（{'、'.join(pool[:6])}）里，玩家选不到他"


def _check_evidence_chain(ctx: dict[str, Any]) -> tuple[float, str]:
    chain = ctx["culprit"].get("evidence_chain") or []
    if not isinstance(chain, list):
        chain = [chain]
    links = [item for item in chain if _nonempty(item)]
    if len(links) >= 3:
        return 1.0, f"锁凶证据链 {len(links)} 环"
    if len(links) == 2:
        return 0.6, "证据链只有 2 环，中间缺一步推理跳跃"
    return len(links) / 3 * 0.6, f"证据链仅 {len(links)} 环，撑不起唯一解"


def _check_clue_depth(ctx: dict[str, Any]) -> tuple[float, str]:
    public, deep = ctx["public_count"], ctx["deep_count"]
    problems = []
    if public < 3:
        problems.append(f"公开线索只有 {public} 条")
    if deep < 1:
        problems.append("没有深入线索")
    if not problems:
        return 1.0, f"公开 {public} 条 + 深入 {deep} 条"
    # 深入线索是「搜证环节」的存在理由，一条都没有时直接落到 fail 区间（<0.5）
    if deep < 1:
        return 0.4, "；".join(problems)
    score = min(public / 3, 1.0) * 0.6 + 0.4
    return score, "；".join(problems)


def _check_timeline_anchors(ctx: dict[str, Any]) -> tuple[float, str]:
    count = len(ctx["timeline"])
    if count >= 3:
        return 1.0, f"{count} 个时间锚点"
    return count / 3 * 0.75, f"时间线只有 {count} 条，无法交叉验证"


def _check_timeline_public(ctx: dict[str, Any]) -> tuple[float, str]:
    public = sum(
        1 for item in ctx["timeline"] if str(item.get("visibility") or "公开") != "深入"
    )
    if public >= 2:
        return 1.0, f"{public} 个公开时间锚点"
    return public / 2 * 0.8, "公开时间锚点不足 2 个，玩家没有可讨论的共同事实"


def _check_culprit_on_timeline(ctx: dict[str, Any]) -> tuple[float, str]:
    name = _culprit_name(ctx)
    if not name:
        return 0.0, "没有凶手，无法核对行动线"
    if not ctx["timeline"]:
        return 0.3, "时间线缺失，无法核对凶手行动线"
    for item in ctx["timeline"]:
        if name in _flat(item):
            return 1.0, f"凶手「{name}」出现在时间线中，机会可被验证"
    return 0.0, f"凶手「{name}」没有出现在时间线里，玩家无法验证他有没有机会"


def _check_death_time_anchor(ctx: dict[str, Any]) -> tuple[float, str]:
    death_time = _flat(ctx["victim"].get("death_time"))
    death_times = _times(death_time)
    if not death_times:
        return 0.6, "死者死亡时间未写成可比较的时间点，无法与时间线对齐"
    timeline_times: set[str] = set()
    for item in ctx["timeline"]:
        timeline_times |= _times(_flat(item.get("time")))
    if death_times & timeline_times:
        return 1.0, f"死亡时间 {sorted(death_times)[0]} 能对上时间线"
    return 0.0, f"死亡时间 {sorted(death_times)[0]} 在时间线里找不到对应锚点"


def _check_timeline_duplicates(ctx: dict[str, Any]) -> tuple[float, str]:
    seen: dict[str, int] = {}
    for item in ctx["timeline"]:
        for stamp in _times(_flat(item.get("time"))):
            seen[stamp] = seen.get(stamp, 0) + 1
    repeated = {stamp: n for stamp, n in seen.items() if n >= 3}
    if not repeated:
        return 1.0, "时间锚点分布正常"
    worst = max(repeated.items(), key=lambda kv: kv[1])
    return 0.5, f"时间点 {worst[0]} 重复出现 {worst[1]} 次，时间线可能糊了"


def _check_character_secrets(ctx: dict[str, Any]) -> tuple[float, str]:
    names = ctx["characters"]
    if not names:
        return 0.0, "没有角色表"
    ok = sum(1 for character in names if _nonempty(character.get("secret")))
    ratio = ok / len(names)
    if ratio >= 1:
        return 1.0, f"{ok} 名角色都有各自的秘密"
    return ratio * 0.85, f"{len(names) - ok} 名角色没有秘密，等于没有可藏的东西"


def _check_trick_steps(ctx: dict[str, Any]) -> tuple[float, str]:
    steps = ctx["trick"].get("steps") or []
    if not isinstance(steps, list):
        steps = [steps]
    count = len([s for s in steps if _nonempty(s)])
    if count >= 3:
        return 1.0, f"手法拆成 {count} 步"
    return count / 3 * 0.7, f"手法只拆了 {count} 步，细节不足以支撑搜证"


_RED_HERRING_SECTION = re.compile(r"^#{2,3}\s*[^\n]*红鲱鱼[^\n]*\n(.*?)(?=^#{2,3}\s|\Z)", re.M | re.S)
_CLEAR_WORDS = ("排除", "澄清", "解释", "洗清", "被推翻", "不成立", "对不上")

_ENDING_SECTION_RE = re.compile(r"结局分支")
# 结局表「支撑线索」列里引用的线索编号：C1 / D2 这类字母+数字形式
_CLUE_ID_IN_TEXT = re.compile(r"\b([A-Za-z]\d{1,2})\b")


def _check_endings_supported(ctx: dict[str, Any]) -> tuple[float, str]:
    """分支结局的支撑线索必须真实存在于线索表——防止「凭空结局」。

    结局分支是可选章节：旧方案没有它不扣为 fail（0.5 = 可选缺失），
    但只要写了，每条结局引用的线索编号就必须能在公开/深入线索里找到。
    """
    endings = [e for e in ctx["plan"].get("endings") or [] if isinstance(e, dict)]
    if not endings:
        if _ENDING_SECTION_RE.search(ctx["markdown"]):
            return 0.4, "写了「结局分支」小节，但解析不出结构化的结局表"
        return 0.5, "没有结局分支章节（可选：加了它复盘时能按走向收尾）"

    known_ids = {str(clue.get("id") or "").upper() for _, clue in ctx["clues"] if clue.get("id")}
    ok = 0
    missing_examples: list[str] = []
    for ending in endings:
        # 编号大小写不敏感：模型写 c1 / C1 都算同一个线索
        used = {m.upper() for m in _CLUE_ID_IN_TEXT.findall(str(ending.get("clues") or ""))}
        if not used:
            continue  # 一条编号都没引用：不算错，但也不加分
        if used <= known_ids:
            ok += 1
        elif len(missing_examples) < 2:
            missing_examples.append(
                "、".join(sorted(used - known_ids)) + f"（{ending.get('name') or '未命名结局'}）"
            )

    if len(endings) < 2:
        ratio = 0.6 if ok else 0.3
        return ratio, "只有 1 条结局，算不上「分支」——至少给 1 条真结局 + 1 条走向分支"

    ratio = ok / len(endings)
    if ratio >= 0.999:
        return 1.0, f"{len(endings)} 条分支结局的支撑线索都能对上编号"
    return ratio * 0.8, f"{len(endings) - ok} 条结局引用了线索表里不存在的编号：{'；'.join(missing_examples)}"


def _check_red_herring_clear(ctx: dict[str, Any]) -> tuple[float, str]:
    """红鲱鱼必须有排除方式，否则就是纯误导（玩家会觉得被耍）。"""
    items = ctx["red_herrings"]
    if items:
        ok = sum(1 for item in items if _nonempty(item.get("clear_method")))
        ratio = ok / len(items)
        if ratio >= 1:
            return 1.0, f"{ok} 条红鲱鱼都有排除方式"
        return ratio * 0.8, f"{len(items) - ok} 条红鲱鱼没有写怎么排除"

    # 结构化字段缺失时退回 Markdown 粗查：有这一节就应该有排除说明
    section = _RED_HERRING_SECTION.search(ctx["markdown"])
    if not section:
        return 0.5, "方案里没有红鲱鱼章节（可选，不加分也不扣分）"
    lines = [line for line in section.group(1).splitlines() if line.strip().startswith(("-", "*", "|"))]
    if not lines:
        return 0.5, "红鲱鱼章节为空"
    clear = sum(1 for line in lines if any(word in line for word in _CLEAR_WORDS))
    ratio = clear / len(lines)
    if ratio >= 0.6:
        return 1.0, f"{clear}/{len(lines)} 条红鲱鱼写明了排除方式"
    return ratio * 0.8, f"只有 {clear}/{len(lines)} 条红鲱鱼写了排除方式"


# (code, 名称, 级别, 权重, 检查函数)
_RULES: list[tuple[str, str, str, int, Callable[[dict[str, Any]], tuple[float, str]]]] = [
    ("clue_ids", "线索编号唯一", "error", 6, _check_clue_ids),
    ("clue_access", "线索获取方式齐全", "error", 12, _check_clue_access),
    ("clue_points_to", "线索指向明确", "warn", 9, _check_clue_points_to),
    ("cast_size", "嫌疑人数充足", "warn", 6, _check_cast_size),
    ("culprit_in_cast", "凶手在角色表内", "error", 12, _check_culprit_in_cast),
    ("evidence_chain", "锁凶证据链 ≥3 环", "error", 12, _check_evidence_chain),
    ("clue_depth", "公开/深入线索结构", "error", 9, _check_clue_depth),
    ("timeline_anchors", "时间锚点 ≥3 个", "warn", 6, _check_timeline_anchors),
    ("timeline_public", "公开时间锚点 ≥2 个", "warn", 5, _check_timeline_public),
    ("culprit_on_timeline", "凶手行动线可验证", "error", 9, _check_culprit_on_timeline),
    ("death_time_anchor", "死亡时间对得上时间线", "warn", 5, _check_death_time_anchor),
    ("timeline_duplicates", "时间线无堆叠", "warn", 3, _check_timeline_duplicates),
    ("character_secrets", "角色各有秘密", "warn", 3, _check_character_secrets),
    ("trick_steps", "手法拆解 ≥3 步", "warn", 2, _check_trick_steps),
    ("red_herring_clear", "红鲱鱼可被排除", "warn", 1, _check_red_herring_clear),
    ("endings_supported", "分支结局有线索支撑", "warn", 4, _check_endings_supported),
]

_TOTAL_WEIGHT = sum(rule[3] for rule in _RULES)


def check_fairness(plan: dict[str, Any] | None, markdown: str = "") -> dict[str, Any]:
    """对一份方案跑全部硬规则，返回分值 + 逐条明细。

    返回结构::

        {
          "score": 0-100,           # 加权得分
          "passed": bool,           # 是否没有 error 级未通过项
          "ready": bool,            # 分数达标且无 error
          "checks": [{code,label,level,weight,ratio,status,detail}],
          "blockers": [...],        # error 级未通过的 code
          "stats": {clues,public,deep,characters,timeline,steps},
        }
    """
    plan = plan or {}
    ctx = _build_context(plan, markdown)

    checks: list[dict[str, Any]] = []
    earned = 0.0
    for code, label, level, weight, fn in _RULES:
        try:
            ratio, detail = fn(ctx)
        except Exception as exc:  # noqa: BLE001 - 单条规则出错不能影响整体
            ratio, detail = 0.0, f"规则执行失败：{type(exc).__name__}"
        ratio = max(0.0, min(1.0, float(ratio)))
        earned += weight * ratio
        # 0.5 是「及格线」：低于一半就算未通过（会进 blockers），
        # 高于一半只算待完善——既不让小瑕疵阻断，也不让硬伤蒙混过关
        status = "pass" if ratio >= 0.999 else ("partial" if ratio >= 0.5 else "fail")
        checks.append(
            {
                "code": code,
                "label": label,
                "level": level,
                "weight": weight,
                "ratio": round(ratio, 3),
                "status": status,
                "detail": detail,
            }
        )

    score = int(round(earned / _TOTAL_WEIGHT * 100))
    blockers = [c["code"] for c in checks if c["level"] == "error" and c["status"] == "fail"]
    passed = not blockers

    return {
        "score": score,
        "passed": passed,
        "ready": passed and score >= 70,
        "checks": checks,
        "blockers": blockers,
        "stats": {
            "clues": len(ctx["clues"]),
            "public": ctx["public_count"],
            "deep": ctx["deep_count"],
            "characters": len(ctx["characters"]),
            "timeline": len(ctx["timeline"]),
            "steps": len(ctx["trick"].get("steps") or []),
        },
    }


def summary_line(report: dict[str, Any]) -> str:
    """给 SSE notice 用的一句话结论。"""
    score = report.get("score", 0)
    failed = [c for c in report.get("checks") or [] if c["status"] == "fail"]
    if report.get("ready"):
        return f"硬规则校验通过：{score}/100，无阻断项。"
    if not failed:
        return f"硬规则校验 {score}/100，有 {len([c for c in report.get('checks') or [] if c['status'] == 'partial'])} 项待完善。"
    names = "、".join(c["label"] for c in failed[:3])
    return f"硬规则校验 {score}/100，{len(failed)} 项不达标：{names}。"
