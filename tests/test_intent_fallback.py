"""意图兜底与单段重写逻辑的单元测试。

这两块是系统容错的纯函数部分：输入输出明确、无外部依赖，是最值得做覆盖的地方。
运行：cd . && python -m pytest tests/ -q
"""

from __future__ import annotations

import sys
from pathlib import Path

import pytest
from langchain_core.messages import HumanMessage

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from agents._lib import nodes  # noqa: E402


# ───────────────────── 意图兜底：寒暄识别 ─────────────────────


@pytest.mark.parametrize(
    "text",
    ["你好", "您好！", "hi", "Hello~", "在吗？", "嗨", "你是谁", "你能做什么", "怎么用", "帮助", " 你好 。"],
)
def test_chitchat_detected(text: str) -> None:
    assert nodes._looks_like_chitchat(text) is True


@pytest.mark.parametrize(
    "text",
    [
        "暴雪山庄背景的密室本，5 人，新手难度",
        "你好，帮我写一个武侠本",
        "在吗？来一个硬核叙诡本",
        "做一个 6 人机制本",
    ],
)
def test_real_request_not_chitchat(text: str) -> None:
    assert nodes._looks_like_chitchat(text) is False


# ───────────────────── 意图兜底：短问句识别 ─────────────────────


@pytest.mark.parametrize(
    "text",
    ["怎么做一个密室本", "叙诡是什么意思", "能不能换个诡计", "为什么凶手是他", "哪种难度适合新手"],
)
def test_question_detected(text: str) -> None:
    assert nodes._looks_like_question(text) is True


@pytest.mark.parametrize(
    "text",
    [
        "帮我做一个密室本",
        "给我来一个硬核本",
        "生成一个 6 人本",
        "怎么写都可以，直接出一个本子",
    ],
)
def test_generation_verb_not_question(text: str) -> None:
    assert nodes._looks_like_question(text) is False


def test_long_text_not_treated_as_simple_question() -> None:
    """超过 40 字即便含问号也视为需求描述，避免长需求被误判成咨询。"""
    long_text = "怎么设计一个既公平又有反转的暴雪山庄密室本，要求 6 人、进阶难度、包含两个红鲱鱼和三段时间锚点？"
    assert len(long_text) > 40
    assert nodes._looks_like_question(long_text) is False


# ───────────────────── 意图兜底：跳过追问 ─────────────────────


@pytest.mark.parametrize(
    "text",
    ["直接生成", "不用问了", "别追问了", "你看着办", "随便你", "自己决定", "直接出"],
)
def test_skip_probe_detected(text: str) -> None:
    assert nodes._wants_skip_probe(text) is True


@pytest.mark.parametrize("text", ["来一个密室本", "难度你定就好，但要公平", "帮我加一条线索"])
def test_normal_text_not_skip_probe(text: str) -> None:
    assert nodes._wants_skip_probe(text) is False


# ───────────────────── 单段重写：意图识别 ─────────────────────

PLAN = """# 《暴雪山庄》

> 一句话卖点

## 一、案件速览
| 题材 | 本格 |

## 二、死者与案发背景
庄主死了。

## 三、核心诡计
1. 录音机伪造争执声

## 四、凶手与人物逻辑
凶手是医生。

## 五、线索清单
| C1 | 炉灰中的怀表零件 |

## 六、时间线
| 21:50 | 死亡 |

## 七、公平性自查
通过。

## 八、DM 提示
观察谁提到汤凉得快。
"""


def _state(text: str, markdown: str = PLAN) -> dict:
    return {"design_markdown": markdown, "messages": [HumanMessage(content=text)]}


@pytest.mark.parametrize(
    ("text", "expected"),
    [
        ("重写第二部分", 1),
        ("只改第三部分", 2),
        ("把第一部分重新写一下", 0),
        ("重写第2段", 1),
        ("第3部分再写一下", 2),
        # 「章」在这里指生成流程的第 N 段（段 3 = 时间线→结尾），不是文档里的「第三章」
        ("只重写第三章", 2),
    ],
)
def test_rewrite_part_detected(text: str, expected: int) -> None:
    assert nodes._rewrite_part_index(_state(text), PLAN) == expected


@pytest.mark.parametrize(
    "text",
    [
        "再加一个红鲱鱼",
        "改一下凶手",
        "把凶手换成管家",
        "难度调高一点",
    ],
)
def test_non_rewrite_not_triggered(text: str) -> None:
    assert nodes._rewrite_part_index(_state(text), PLAN) is None


def test_rewrite_ignored_without_existing_plan() -> None:
    """没有完整方案时不应触发单段重写（避免首次生成被截断成一段）。"""
    assert nodes._rewrite_part_index(_state("重写第二部分", ""), "") is None


# ───────────────────── 单段重写：拼接 ─────────────────────


def test_splice_middle_part_keeps_others() -> None:
    new_part = "## 四、凶手与人物逻辑\n凶手是管家。\n\n## 五、线索清单\n| C1 | 新线索 |"
    merged = nodes._splice_part(PLAN, new_part, 1)
    assert "管家" in merged
    assert "凶手是医生" not in merged
    assert "## 三、核心诡计" in merged
    assert "## 六、时间线" in merged
    assert merged.index("## 四、") < merged.index("## 六、")


def test_splice_first_part_keeps_tail() -> None:
    new_part = "# 《新标题》\n> 新卖点\n\n## 一、案件速览\n| 变格 |\n\n## 三、核心诡计\n新诡计"
    merged = nodes._splice_part(PLAN, new_part, 0)
    assert "《新标题》" in merged
    assert "《暴雪山庄》" not in merged
    assert "## 四、凶手" in merged
    assert "医生" in merged


def test_splice_last_part_to_end() -> None:
    new_part = "## 六、时间线\n| 22:00 | 新时间 |\n\n## 七、自查\n新自查"
    merged = nodes._splice_part(PLAN, new_part, 2)
    assert "22:00" in merged
    assert "21:50" not in merged
    assert "## 五、线索清单" in merged


def test_splice_falls_back_when_marker_missing() -> None:
    """找不到段落边界时退化为追加，绝不丢用户已有内容。"""
    merged = nodes._splice_part("# 只有标题\n一些内容", "新的一段", 1)
    assert "新的一段" in merged
    assert "只有标题" in merged
