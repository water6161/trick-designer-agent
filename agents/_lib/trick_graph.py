"""线索-诡计依赖图：校验「核心诡计要成立，必须有哪几条线索撑着」。

和 fairness 的分工：
- fairness 看的是**形式完整性**（编号、获取方式、证据链环数）；
- 这里看的是**因果完整性**——把诡计拆成若干「成立条件」，逐条去线索里找支撑。
  缺一条，玩家就会问「他到底怎么出去的」，而 DM 手里没有牌可打。

实现方式刻意保持确定性：
- 每个诡计类别预置一组条件模板，条件是「必须能在线索里被观察到的物理/信息事实」；
- 每个条件挂一组关键词，在线索正文/指向/时间线里做命中匹配，命中即视为有支撑；
- 不调用模型，因此结果可复现、可单测，也不会因为 prompt 改动而漂移。

局限（必须诚实写在 README 里）：
关键词匹配只能证明「提到了相关物证」，不能证明「这条线索真的能推出这个条件」。
所以它定位是**漏检器**：宁可漏报，也不要把成立的东西判成不成立。
"""

from __future__ import annotations

import re
from typing import Any

# 条件模板：类别关键词 → [(条件 key, 条件名, 关键词, 缺失时的提示)]
_CONDITION_TEMPLATES: list[tuple[tuple[str, ...], list[tuple[str, str, tuple[str, ...], str]]]] = [
    (
        ("密室", "封闭", "反锁", "上锁"),
        [
            ("entry", "进出方式", ("门锁", "窗户", "窗", "钥匙", "暗道", "密道", "通道", "通风口", "屋顶", "后门", "侧门", "门缝", "插销", "天窗", "阳台"), "没有线索说明凶手如何进出，密室会变成「魔法」"),
            ("lock", "上锁方式与时机", ("反锁", "门闩", "上闩", "挂锁", "封条", "胶带", "细线", "细绳", "绳", "锁", "钥匙", "插销", "搭扣", "铁链", "钩"), "没有线索解释锁是怎么锁上的，玩家无法复原手法"),
            ("exit", "凶手离开路径", ("离开", "逃", "绕", "躲", "藏", "返回", "回到", "通道", "窗", "暗道", "屋顶", "床下", "衣柜", "门后"), "缺少凶手脱离现场的路径线索"),
            ("trace", "痕迹处理", ("脚印", "血迹", "灰尘", "水渍", "擦", "清理", "拖", "地毯", "泥", "湿", "痕", "打扫"), "没有痕迹类线索，搜证环节会空转"),
        ],
    ),
    (
        ("不在场", "alibi"),
        [
            ("alibi_source", "不在场证明的来源", ("证言", "证词", "目击", "听到", "看到", "监控", "录音", "录像", "电话", "同行", "陪着"), "没写不在场证明是谁给的，无法被质询"),
            ("time_trick", "时间错觉机制", ("钟", "怀表", "手表", "时间", "时差", "调快", "调慢", "录音", "灯光", "广播", "钟声", "更夫", "表"), "缺少制造时间错觉的具体载体"),
            ("witness", "可被戳穿的证人", ("作证", "看见", "听见", "一起", "同房", "陪同", "经过", "对质"), "证人没有被戳穿的入口，不在场证明无法破解"),
            ("anchor", "客观时间锚点", ("记录", "登记", "票据", "签到", "日志", "监控", "票根", "账本", "登记簿"), "没有客观锚点，时间只能靠嘴说"),
        ],
    ),
    (
        ("叙诡", "叙述"),
        [
            ("narrator", "叙述者身份", ("叙述", "手记", "日记", "回忆", "口述", "第一人称", "记录者", "笔记"), "没交代叙述者是谁，叙诡无法落地"),
            ("hidden", "被隐藏的关键信息", ("隐瞒", "未提", "省略", "误认", "以为", "并不知道", "没有说出", "认错"), "找不到被隐藏的信息点"),
            ("reveal", "揭露用的伏笔", ("伏笔", "暗示", "称呼", "名字", "性别", "年龄", "身份", "照片", "笔迹"), "没有可回收的伏笔，揭露时会显得硬拗"),
        ],
    ),
    (
        ("时间", "时刻", "时差"),
        [
            ("clock", "时间基准", ("钟", "怀表", "手表", "时间", "日期", "日历", "时区", "夏令时", "更漏", "表"), "没给时间基准，时间诡计无法验证"),
            ("perception", "感知误导", ("以为", "误认", "天光", "灯", "声音", "气味", "温度", "寂静", "黑"), "缺少误导感知的手段"),
        ],
    ),
    (
        ("身份", "替身", "双胞胎"),
        [
            ("swap", "身份替换机制", ("双胞胎", "替身", "易容", "化妆", "面具", "同名", "冒充", "顶替", "换了衣服"), "没有替换机制，身份诡计立不住"),
            ("proof", "身份验证的漏洞", ("证件", "照片", "笔迹", "胎记", "疤", "声音", "指纹", "口音", "胎记"), "没有可被击穿的身份凭证"),
        ],
    ),
    (
        ("毒", "药"),
        [
            ("poison", "毒物来源", ("毒", "药", "粉末", "汤", "酒", "茶", "杯", "瓶", "苦"), "没写毒物从哪来"),
            ("timing", "发作时间窗", ("发作", "分钟", "立刻", "延迟", "剂量", "解药", "发作时间"), "缺发作时间窗，无法锁定投毒时机"),
        ],
    ),
]

# 通用条件：任何题材都该成立。
# advisory=True 的条件缺失只作提示不计入覆盖率——动机常常写在角色本里而非物证上，
# 强行要求「动机必须有线索」会让大部分正常方案都被判缺口。
_COMMON_CONDITIONS: list[tuple[str, str, tuple[str, ...], str, bool]] = [
    ("opportunity", "作案机会", ("时间", "独自", "离开", "房间", "走廊", "前后", "空档", "一个人"), "缺少可验证的作案时间窗", False),
    ("instrument", "凶器/手段痕迹", ("凶器", "刀", "绳", "钝器", "钝击", "砸", "药", "毒", "血", "伤"), "没有凶器或手段相关线索", False),
    ("motive", "动机可查", ("动机", "遗产", "仇恨", "债务", "威胁", "私情", "恩怨", "把柄", "遗书", "账本"), "凶手的动机没有线索支撑，玩家会问「他为什么杀人」", True),
]

_CATEGORY_HINTS = ("密室", "不在场", "叙诡", "时间", "身份", "毒", "暴风雪山庄", "循环")


def _flat(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, str):
        return value
    if isinstance(value, (list, tuple)):
        return " ".join(_flat(item) for item in value)
    if isinstance(value, dict):
        return " ".join(_flat(item) for item in value.values())
    return str(value)


def _clues(plan: dict[str, Any]) -> list[tuple[str, str, str]]:
    """返回 [(编号, 类型, 可匹配文本)]。"""
    result: list[tuple[str, str, str]] = []
    for kind, key in (("公开", "clues_public"), ("深入", "clues_deep")):
        for index, clue in enumerate(plan.get(key) or []):
            if not isinstance(clue, dict):
                continue
            cid = str(clue.get("id") or "").strip() or f"{kind[0]}{index + 1}"
            text = " ".join(
                _flat(clue.get(field)) for field in ("name", "content", "points_to", "access", "why_fair")
            )
            result.append((cid, kind, text))
    return result


def _pick_conditions(category: str) -> list[tuple[str, str, tuple[str, ...], str, bool]]:
    chosen: list[tuple[str, str, tuple[str, ...], str, bool]] = []
    for keywords, conditions in _CONDITION_TEMPLATES:
        if any(keyword in category for keyword in keywords):
            for condition in conditions:
                chosen.append((*condition, False))  # 类别专属条件：必须在线索里成立
    # 通用条件始终参与，但去重（避免同一 key 出现两次）
    seen = {item[0] for item in chosen}
    for condition in _COMMON_CONDITIONS:
        if condition[0] not in seen:
            chosen.append(condition)
    return chosen


def build_trick_graph(plan: dict[str, Any] | None) -> dict[str, Any]:
    """构建「成立条件 → 线索」覆盖矩阵。

    返回结构::

        {
          "category": "密室",
          "conditions": [{key,label,matched:[线索编号],satisfied,sources,inTrick,advisory}],
          "coverage": 0-1,          # 只统计必须项
          "gaps": [{key,label,hint,keywords}],
          "advisories": [{key,label,hint}],   # 建议项（缺失不影响 coverage）
          "verdict": "一句话结论",
        }
    """
    plan = plan or {}
    trick = plan.get("core_trick")
    if not isinstance(trick, dict):
        trick = {}

    category = str(trick.get("category") or "").strip()
    if not category:
        # 类别缺失时，用方案标题/手法名/AI 给的标签兜底，尽量还原是什么诡计
        haystack = _flat(trick.get("name")) + _flat(trick.get("principle")) + _flat(plan.get("tagline"))
        for hint in _CATEGORY_HINTS:
            if hint in haystack:
                category = hint
                break
    if not category:
        category = "通用"

    clues = _clues(plan)
    timeline_text = " ".join(_flat(item) for item in (plan.get("timeline") or []))
    # 手法拆解只作为「DM 手册里写过」的证据，不能替代玩家可见线索
    trick_text = " ".join(
        _flat(trick.get(field)) for field in ("name", "steps", "principle", "why_works")
    )
    conditions = _pick_conditions(category)

    rows: list[dict[str, Any]] = []
    gaps: list[dict[str, Any]] = []
    advisories: list[dict[str, Any]] = []
    required = 0
    satisfied_required = 0

    for key, label, keywords, hint, advisory in conditions:
        matched: list[str] = []
        for cid, _kind, text in clues:
            if any(keyword in text for keyword in keywords):
                matched.append(cid)
        # 公开时间线里明确写到也算玩家可见的支撑
        from_timeline = any(keyword in timeline_text for keyword in keywords)
        in_trick = any(keyword in trick_text for keyword in keywords)
        satisfied = bool(matched) or from_timeline

        if not advisory:
            required += 1
            if satisfied:
                satisfied_required += 1

        rows.append(
            {
                "key": key,
                "label": label,
                "matched": matched,
                "satisfied": satisfied,
                "sources": len(matched) + (1 if from_timeline and not matched else 0),
                "inTrick": in_trick,
                "advisory": advisory,
            }
        )

        if satisfied:
            continue
        if advisory:
            advisories.append({"key": key, "label": label, "hint": hint})
            continue
        gaps.append(
            {
                "key": key,
                "label": label,
                "hint": (
                    f"手法拆解里写了「{label}」，但没有任何线索让玩家发现——这属于 DM 独占信息。"
                    "建议补一条玩家可获得的物证线索。"
                )
                if in_trick
                else hint,
                "keywords": list(keywords),
            }
        )

    coverage = round(satisfied_required / required, 3) if required else 0.0

    if not conditions:
        verdict = "缺少核心诡计信息，无法校验成立条件。"
    elif not gaps:
        verdict = f"{category}类诡计的 {required} 项成立条件全部有玩家可见线索支撑，逻辑闭环。"
    else:
        names = "、".join(gap["label"] for gap in gaps[:3])
        verdict = f"{category}类诡计有 {len(gaps)} 项成立条件找不到玩家可见线索支撑：{names}。"

    return {
        "category": category,
        "conditions": rows,
        "coverage": coverage,
        "gaps": gaps,
        "advisories": advisories,
        "verdict": verdict,
    }


def suggest_clue_for_gap(gap: dict[str, Any], category: str = "") -> str:
    """给缺口生成一条「建议补的线索」，用于前端展示与单段重写提示。"""
    label = gap.get("label") or "该条件"
    keywords = gap.get("keywords") or []
    sample = "、".join(keywords[:3])
    prefix = f"{category}类" if category else ""
    return f"补一条能承载「{label}」的{prefix}线索（例如涉及 {sample} 的物证），并在『指向或排除』里写明它排除谁。"


_CN_ORDINAL = re.compile(r"^[0-9]+$")


def build_gap_instruction(plan: dict[str, Any] | None) -> str | None:
    """把缺口整理成可直接拼进单段重写提示的指令；无缺口返回 None。"""
    graph = build_trick_graph(plan)
    gaps = graph.get("gaps") or []
    if not gaps:
        return None
    lines = [suggest_clue_for_gap(gap, graph.get("category") or "") for gap in gaps[:4]]
    return "本轮务必补齐以下逻辑漏洞（其余内容保持不变）：\n" + "\n".join(f"- {line}" for line in lines)
