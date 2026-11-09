"""线索-诡计依赖图（trick_graph.py）的单元测试。

核心断言：缺线索时能指出缺哪个「成立条件」，而不是笼统说一句「逻辑不严」。
"""

import sys

sys.path.insert(0, ".")

from agents._lib.trick_graph import build_gap_instruction, build_trick_graph, suggest_clue_for_gap


def sealed_room_plan(extra_clues=None):
    clues = [
        {"id": "C1", "name": "门缝", "content": "门缝里卡着一段细线，线头有蜡痕", "points_to": "排除沈青", "access": "公开"},
        {"id": "C2", "name": "窗台", "content": "窗台有新鲜泥印", "points_to": "指向林昭", "access": "公开"},
        {"id": "C3", "name": "地毯", "content": "地毯上有一道被擦过的拖痕", "points_to": "指向搬运", "access": "公开"},
    ]
    return {
        "core_trick": {
            "name": "反锁的书房",
            "category": "密室",
            "steps": ["从窗户翻入", "用细线从门缝拉回插销", "擦掉脚印后离开"],
        },
        "clues_public": clues + list(extra_clues or []),
        "clues_deep": [],
        "timeline": [{"time": "21:40", "event": "书房传出响动", "witness": "众人", "visibility": "公开"}],
        "culprit": {"character": "林昭", "motive": "遗产纠纷"},
    }


def condition(graph, key):
    return next(item for item in graph["conditions"] if item["key"] == key)


class TestCategory:
    def test_识别密室类(self):
        graph = build_trick_graph(sealed_room_plan())
        assert graph["category"] == "密室"
        keys = {item["key"] for item in graph["conditions"]}
        assert {"entry", "lock", "exit", "trace"} <= keys

    def test_类别缺失时从手法名推断(self):
        plan = sealed_room_plan()
        plan["core_trick"].pop("category")
        plan["core_trick"]["name"] = "完美的密室"
        assert build_trick_graph(plan)["category"] == "密室"

    def test_完全没信息时归为通用(self):
        graph = build_trick_graph({})
        assert graph["category"] == "通用"
        assert all(item["satisfied"] is False for item in graph["conditions"])


class TestCoverage:
    def test_有线索支撑的条件被标记成立(self):
        graph = build_trick_graph(sealed_room_plan())
        assert condition(graph, "lock")["satisfied"] is True
        assert "C1" in condition(graph, "lock")["matched"]
        assert condition(graph, "trace")["satisfied"] is True

    def test_缺少支撑的条件进入缺口(self):
        plan = sealed_room_plan()
        plan["clues_public"] = [plan["clues_public"][0]]  # 只剩门缝一条
        graph = build_trick_graph(plan)
        gap_keys = {gap["key"] for gap in graph["gaps"]}
        # 只剩「门缝细线」时，凶手怎么离开现场这件事没有任何线索承载
        assert "exit" in gap_keys
        assert graph["coverage"] < 1

    def test_只有手法写了线索没写时提示DM独占信息(self):
        plan = sealed_room_plan()
        plan["clues_public"] = [{"id": "C9", "name": "无关", "content": "一只茶杯", "points_to": "", "access": "公开"}]
        graph = build_trick_graph(plan)
        lock_gap = next((gap for gap in graph["gaps"] if gap["key"] == "lock"), None)
        assert lock_gap is not None
        assert "DM 独占信息" in lock_gap["hint"]

    def test_动机缺失只作建议不算缺口(self):
        plan = sealed_room_plan()
        plan["culprit"]["motive"] = ""
        graph = build_trick_graph(plan)
        assert "motive" not in {gap["key"] for gap in graph["gaps"]}
        assert "motive" in {item["key"] for item in graph["advisories"]}

    def test_覆盖率只统计必须项(self):
        graph = build_trick_graph(sealed_room_plan())
        required = [item for item in graph["conditions"] if not item["advisory"]]
        expected = round(sum(1 for item in required if item["satisfied"]) / len(required), 3)
        assert graph["coverage"] == expected

    def test_全部满足时给闭环结论(self):
        graph = build_trick_graph(sealed_room_plan())
        if not graph["gaps"]:
            assert "闭环" in graph["verdict"]

    def test_有缺口时结论里点名(self):
        plan = sealed_room_plan()
        plan["clues_public"] = []
        graph = build_trick_graph(plan)
        assert graph["gaps"]
        assert "找不到玩家可见线索支撑" in graph["verdict"]


class TestGapInstruction:
    def test_缺口能转成补线索建议(self):
        plan = sealed_room_plan()
        plan["clues_public"] = []
        graph = build_trick_graph(plan)
        text = suggest_clue_for_gap(graph["gaps"][0], graph["category"])
        assert "补一条" in text
        assert graph["gaps"][0]["label"] in text

    def test_无缺口时不给指令(self):
        graph = build_trick_graph(sealed_room_plan())
        if not graph["gaps"]:
            assert build_gap_instruction(sealed_room_plan()) is None

    def test_指令包含本轮务必补齐(self):
        plan = sealed_room_plan()
        plan["clues_public"] = []
        instruction = build_gap_instruction(plan)
        assert instruction is not None
        assert "逻辑漏洞" in instruction
