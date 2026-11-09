"""难度与时长预估（difficulty.py）的单元测试。"""

import sys

sys.path.insert(0, ".")

from agents._lib.difficulty import estimate_difficulty


def make_plan(suspects=6, public=6, deep=3, steps=4, anchors=5, red=2, category="密室"):
    return {
        "core_trick": {"name": "手法", "category": category, "steps": [f"第{i}步" for i in range(steps)]},
        "characters": [{"name": f"角色{i}"} for i in range(suspects)],
        "clues_public": [{"id": f"C{i}"} for i in range(public)],
        "clues_deep": [{"id": f"D{i}"} for i in range(deep)],
        "timeline": [{"time": f"{20 + i}:00"} for i in range(anchors)],
        "red_herrings": [{"description": f"误导{i}"} for i in range(red)],
    }


class TestScore:
    def test_简单本分数低(self):
        simple = estimate_difficulty(make_plan(suspects=4, public=3, deep=1, steps=3, anchors=3, red=0))
        assert simple["score"] < 55
        assert simple["tier"] in ("新手", "进阶")

    def test_复杂本分数高(self):
        heavy = estimate_difficulty(make_plan(suspects=8, public=8, deep=5, steps=7, anchors=8, red=4, category="叙诡"))
        assert heavy["score"] > 75
        assert heavy["tier"] in ("硬核", "地狱")

    def test_分数不超过一百(self):
        huge = estimate_difficulty(make_plan(suspects=12, public=20, deep=20, steps=20, anchors=20, red=10, category="叙诡"))
        assert huge["score"] <= 100
        assert huge["score"] >= 0

    def test_空方案不崩(self):
        result = estimate_difficulty({})
        assert result["score"] >= 0
        assert result["tier"] in ("新手", "进阶", "硬核", "地狱")

    def test_叙诡比密室更难(self):
        sealed = estimate_difficulty(make_plan(category="密室"))
        narrative = estimate_difficulty(make_plan(category="叙诡"))
        assert narrative["score"] > sealed["score"]

    def test_因素按贡献降序(self):
        factors = estimate_difficulty(make_plan())["factors"]
        points = [item["points"] for item in factors]
        assert points == sorted(points, reverse=True)


class TestMinutes:
    def test_时长区间合法(self):
        result = estimate_difficulty(make_plan())
        minutes = result["minutes"]
        assert 120 <= minutes["min"] < minutes["max"] <= 330
        assert "小时" in minutes["label"]

    def test_信息量越大时长越长(self):
        light = estimate_difficulty(make_plan(suspects=4, public=3, deep=1, steps=3, anchors=3, red=0))
        heavy = estimate_difficulty(make_plan(suspects=8, public=8, deep=5, steps=7, anchors=8, red=4))
        assert heavy["minutes"]["min"] >= light["minutes"]["min"]

    def test_给出建议人数(self):
        assert estimate_difficulty(make_plan(suspects=6))["players"] == "6人"

    def test_没有角色时不给人数(self):
        assert estimate_difficulty({})["players"] == ""
