"""难度与时长预估：把「这个本大概多难、要开多久」算成可解释的数字。

用途：
- 用户提问「这个本能开几个小时」时，DM 不用凭感觉回答；
- 前端在方案顶部显示一个难度徽章，方便按场次排期；
- 所有系数都是显式常量，改一个数就能调整整体手感，不需要重训任何东西。

注意：这是**排期参考**而非承诺值。真实时长取决于玩家水平和 DM 控场，
所以输出里同时给区间和「主要影响因素」，让用户知道数字从哪来。
"""

from __future__ import annotations

from typing import Any

# 各因素的影响系数（调这里就能整体调难度手感）
_W_SUSPECT = 2.5
_W_CLUE = 1.8
_W_STEP = 3.0
_W_ANCHOR = 2.0
_W_RED_HERRING = 4.0
_BASE_SCORE = 15.0

# 诡计类型自带的认知负担
_CATEGORY_BONUS: tuple[tuple[tuple[str, ...], int, str], ...] = (
    (("叙诡", "叙述"), 16, "叙诡需要玩家自己发现叙述不可靠，认知负担最高"),
    (("身份", "替身"), 12, "身份替换要求玩家持续核对每个角色的信息源"),
    (("时间", "时差", "时刻"), 9, "时间诡计需要玩家手工对齐多条时间线"),
    (("密室", "封闭", "反锁"), 7, "密室需要空间还原，讨论成本高"),
    (("不在场", "alibi"), 7, "不在场证明需要逐条质询证人"),
    (("毒", "药"), 4, "毒杀案需要判断发作时间窗"),
)

_TIERS = (
    (40, "新手", "适合第一次玩的新手局，DM 只需轻推一次"),
    (60, "进阶", "常规商业本难度，需要 DM 在第二幕给一次提示"),
    (78, "硬核", "需要玩家主动做时间线还原，DM 要准备两套提示"),
    (101, "地狱", "信息量大且互相干扰，建议配经验 DM 并预留复盘时间"),
)


def _count(value: Any) -> int:
    return len(value) if isinstance(value, (list, tuple)) else 0


def _category_hit(category: str) -> tuple[int, str]:
    for keywords, bonus, reason in _CATEGORY_BONUS:
        if any(keyword in category for keyword in keywords):
            return bonus, reason
    return 0, ""


def estimate_difficulty(plan: dict[str, Any] | None) -> dict[str, Any]:
    """按角色数、线索量、手法层数、时间锚点、红鲱鱼量估算复杂度与时长。

    返回结构::

        {
          "score": 0-100, "tier": "进阶", "tierNote": "...",
          "minutes": {"min": 180, "max": 240, "label": "3~4 小时"},
          "players": "6人",
          "factors": [{label, value, points}],   # 分数构成，按贡献降序
          "note": "一句话说明"
        }
    """
    plan = plan or {}
    trick = plan.get("core_trick") if isinstance(plan.get("core_trick"), dict) else {}
    category = str(trick.get("category") or "").strip()

    suspects = _count(plan.get("characters"))
    clues = _count(plan.get("clues_public")) + _count(plan.get("clues_deep"))
    steps = _count(trick.get("steps"))
    anchors = _count(plan.get("timeline"))
    red = _count(plan.get("red_herrings"))

    factors: list[dict[str, Any]] = []

    def add(label: str, value: str, points: float) -> None:
        nonlocal score
        score += points
        factors.append({"label": label, "value": value, "points": round(points, 1)})

    score = _BASE_SCORE
    add("嫌疑人数", f"{suspects} 人", min(suspects, 8) * _W_SUSPECT)
    add("线索总量", f"{clues} 条", min(clues, 16) * _W_CLUE)
    add("手法层数", f"{steps} 步", min(steps, 8) * _W_STEP)
    add("时间锚点", f"{anchors} 个", min(anchors, 8) * _W_ANCHOR)
    add("红鲱鱼", f"{red} 条", min(red, 4) * _W_RED_HERRING)

    bonus, reason = _category_hit(category)
    if bonus:
        add(f"{category}类型负担", category or "未知", bonus)

    score = int(max(0, min(100, round(score))))

    tier, tier_note = _TIERS[-1][1], _TIERS[-1][2]
    for ceiling, name, note in _TIERS:
        if score < ceiling:
            tier, tier_note = name, note
            break

    # 时长：以 2.5 小时为基准，按信息量线性外推，再夹到 2~5.5 小时
    raw = 150 + suspects * 8 + clues * 3 + steps * 4 + red * 5 + bonus * 2
    low = max(120, min(300, int(round(raw * 0.85 / 30) * 30)))
    high = max(low + 30, min(330, int(round(raw * 1.15 / 30) * 30)))

    factors.sort(key=lambda item: item["points"], reverse=True)

    note = f"按 {suspects} 人 / {clues} 条线索 / {steps} 步手法推算，{tier}难度。"
    if reason:
        note += reason + "。"

    return {
        "score": score,
        "tier": tier,
        "tierNote": tier_note,
        "minutes": {"min": low, "max": high, "label": f"{low / 60:g}~{high / 60:g} 小时"},
        "players": f"{suspects}人" if suspects else "",
        "factors": factors[:6],
        "note": note,
    }
