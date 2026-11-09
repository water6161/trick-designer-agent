"""诡计查重（dedup.py）的单元测试：指纹提取、历史收集、避开指令生成。"""

import sys

sys.path.insert(0, ".")

from agents._lib.dedup import build_avoidance_hint, collect_fingerprints, extract_fingerprint


def _meta(cid: str, brief_tricks=None, core=None, category=None):
    plan = None
    if core:
        plan = {"core_trick": {"name": core, "category": category or ""}}
    return {
        "conversationId": cid,
        "metadata": {
            "brief": {"trick_types": brief_tricks or []},
            "plan": plan,
        },
    }


# ── extract_fingerprint ──


class TestExtractFingerprint:
    def test_从brief与plan组合提取(self):
        fp = extract_fingerprint(
            {"trick_types": ["密室", "时间诡计"]},
            {"core_trick": {"name": "调快的怀表", "category": "时间诡计"}},
        )
        assert fp["types"] == ["密室", "时间诡计"]
        assert fp["core"] == "调快的怀表"
        assert fp["category"] == "时间诡计"

    def test_category去重不重复添加(self):
        fp = extract_fingerprint(
            {"trick_types": ["叙诡"]},
            {"core_trick": {"name": "死者叙事者", "category": "叙诡"}},
        )
        assert fp["types"].count("叙诡") == 1

    def test空输入返回空指纹(self):
        fp = extract_fingerprint(None, None)
        assert fp == {"types": [], "core": "", "category": ""}

    def test_plan无core_trick时降级到顶层字段(self):
        fp = extract_fingerprint({}, {"core_trick_name": "冰块门闩"})
        assert fp["core"] == "冰块门闩"

    def test_trick_types为字符串也接受(self):
        fp = extract_fingerprint({"trick_types": "密室"}, None)
        assert fp["types"] == ["密室"]


# ── collect_fingerprints ──


class TestCollectFingerprints:
    def test收集全部历史并排除当前会话(self):
        items = [
            _meta("a", brief_tricks=["密室"], core="冰块门闩"),
            _meta("b", brief_tricks=["叙诡"]),
            _meta("c", brief_tricks=["暴雪山庄"], core="调快的怀表"),
        ]
        fps = collect_fingerprints(items, exclude_conversation_id="a")
        assert len(fps) == 2
        assert all(f["core"] != "冰块门闩" for f in fps)

    def test兼容items字典包装(self):
        fps = collect_fingerprints({"items": [_meta("x", brief_tricks=["身份诡计"])]})
        assert len(fps) == 1 and fps[0]["types"] == ["身份诡计"]

    def test跳过残缺与非字典项(self):
        items = ["junk", 42, {"conversationId": "z", "metadata": None}, {"metadata": {}}]
        assert collect_fingerprints(items) == []

    def test无指纹信息的会话被过滤(self):
        items = [{"conversationId": "q", "metadata": {"title": "只有标题"}}]
        assert collect_fingerprints(items) == []


# ── build_avoidance_hint ──


class TestBuildAvoidanceHint:
    def test类型重叠时注入避开指令(self):
        hint = build_avoidance_hint({"trick_types": ["密室", "不在场证明"]}, [{"types": ["密室"], "core": ""}])
        assert hint is not None
        assert "密室" in hint
        assert "明显不同的新角度" in hint

    def test核心手法重名时提示差异化(self):
        hint = build_avoidance_hint({"trick_types": ["叙诡"]}, [{"types": [], "core": "叙诡性死亡"}])
        assert hint is not None
        assert "显著差异化" in hint

    def test无重叠返回None(self):
        hint = build_avoidance_hint({"trick_types": ["盗墓"]}, [{"types": ["密室"], "core": "冰块门闩"}])
        assert hint is None

    def test空历史返回None(self):
        assert build_avoidance_hint({"trick_types": ["密室"]}, []) is None
        assert build_avoidance_hint(None, []) is None

    def test列出历史核心手法供参考(self):
        hint = build_avoidance_hint({"trick_types": ["密室"]}, [{"types": ["密室"], "core": "双胞胎互换"}])
        assert "双胞胎互换" in hint

    def test多种历史去重展示(self):
        fps = [
            {"types": ["密室"], "core": "冰块门闩"},
            {"types": ["密室"], "core": "冰块门闩"},  # 重复
            {"types": ["时间诡计"], "core": "怀表"},
        ]
        hint = build_avoidance_hint({"trick_types": ["密室"]}, fps)
        assert hint.count("冰块门闩") == 1
        assert "怀表" in hint

    def test当前需求无类型时不误伤(self):
        # 用户没点名任何类型，历史再多也不注入，避免瞎猜
        assert build_avoidance_hint({}, [{"types": ["密室"], "core": "冰块门闩"}]) is None
