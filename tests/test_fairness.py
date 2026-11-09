"""公平性硬规则引擎（fairness.py）的单元测试。

覆盖重点：
- 每条 error 级规则都能真正拦截（而不是摆设）；
- 部分达标时给部分分，而不是一刀切 0 分；
- 字段缺失要降级为「无法判定」，不能用空数据把方案判死；
- 分数永远落在 0~100。
"""

import sys

sys.path.insert(0, ".")

from agents._lib.fairness import check_fairness, summary_line


def base_plan():
    """一份各项都达标的方案，用于逐条对照。"""
    return {
        "title": "雾锁山庄",
        "victim": {"name": "周敬山", "death_time": "第一幕 21:40", "scene": "书房"},
        "core_trick": {
            "name": "反锁的书房",
            "category": "密室",
            "steps": ["从窗户翻入", "用细线从门缝拉回插销", "混入人群"],
        },
        "culprit": {
            "character": "林昭",
            "motive": "遗产纠纷",
            "evidence_chain": ["C1 门缝细线", "C2 窗台泥印", "D1 怀表被调快"],
        },
        "characters": [
            {"name": "林昭", "identity": "管家", "secret": "欠下赌债", "suspicion": "最后见过死者"},
            {"name": "沈青", "identity": "侄女", "secret": "伪造遗嘱", "suspicion": "遗产受益人"},
            {"name": "陆行", "identity": "医生", "secret": "开过禁药", "suspicion": "持有毒物"},
            {"name": "白露", "identity": "女仆", "secret": "偷听谈话", "suspicion": "行踪不明"},
            {"name": "顾南", "identity": "旧友", "secret": "被死者威胁", "suspicion": "当晚争吵"},
        ],
        "clues_public": [
            {"id": "C1", "name": "门缝", "content": "门缝里卡着一段细线", "points_to": "排除沈青", "access": "公开阅读"},
            {"id": "C2", "name": "窗台", "content": "窗台有新鲜泥印", "points_to": "指向林昭", "access": "公开阅读"},
            {"id": "C3", "name": "账本", "content": "账本记录一笔赌债", "points_to": "指向林昭", "access": "公开阅读"},
        ],
        "clues_deep": [
            {"id": "D1", "name": "怀表", "content": "怀表被调快了二十分钟", "points_to": "指向林昭", "access": "搜证·书房"},
        ],
        "timeline": [
            {"time": "21:20", "event": "林昭送茶进入书房", "witness": "白露", "visibility": "公开"},
            {"time": "21:40", "event": "书房传出响动", "witness": "众人", "visibility": "公开"},
            {"time": "22:00", "event": "发现尸体", "witness": "沈青", "visibility": "公开"},
        ],
        "red_herrings": [{"description": "医生的药箱", "clear_method": "药箱封条完整，可排除"}],
    }


def get_check(report, code):
    return next(item for item in report["checks"] if item["code"] == code)


class TestScoreBasics:
    def test_完整方案得分高且无阻断(self):
        report = check_fairness(base_plan())
        assert report["score"] >= 85
        assert report["passed"] is True
        assert report["ready"] is True
        assert report["blockers"] == []

    def test_空方案得低分且被阻断(self):
        report = check_fairness({})
        assert report["score"] < 20
        assert report["passed"] is False
        assert "clue_access" in report["blockers"]

    def test_分数永远在合法区间(self):
        for plan in ({}, None, base_plan(), {"characters": [{"name": "只有一个人"}]}):
            report = check_fairness(plan)
            assert 0 <= report["score"] <= 100

    def test_单条规则抛异常不影响整体(self):
        # timeline 里塞入不可哈希的怪数据，规则内部应自行兜住
        plan = base_plan()
        plan["timeline"] = [{"time": {"weird": "dict"}, "event": None}]
        report = check_fairness(plan)
        assert isinstance(report["score"], int)
        assert len(report["checks"]) == 15


class TestErrorRules:
    def test_凶手不在角色表会被拦截(self):
        plan = base_plan()
        plan["culprit"]["character"] = "赵六"
        report = check_fairness(plan)
        assert get_check(report, "culprit_in_cast")["status"] == "fail"
        assert "culprit_in_cast" in report["blockers"]

    def test_凶手名带后缀也能匹配(self):
        plan = base_plan()
        plan["culprit"]["character"] = "林昭（管家）"
        report = check_fairness(plan)
        assert get_check(report, "culprit_in_cast")["status"] == "pass"

    def test_证据链不足三环判失败(self):
        plan = base_plan()
        plan["culprit"]["evidence_chain"] = ["只有一环"]
        report = check_fairness(plan)
        check = get_check(report, "evidence_chain")
        assert check["status"] == "fail"
        assert "1 环" in check["detail"]

    def test_两环证据链给部分分(self):
        plan = base_plan()
        plan["culprit"]["evidence_chain"] = ["一环", "二环"]
        check = get_check(check_fairness(plan), "evidence_chain")
        assert check["status"] == "partial"
        assert 0 < check["ratio"] < 1

    def test_线索缺获取方式按比例扣分(self):
        plan = base_plan()
        plan["clues_public"][0]["access"] = ""
        check = get_check(check_fairness(plan), "clue_access")
        assert check["status"] == "partial"
        assert check["ratio"] < 1
        assert "1 条线索没有写获取方式" in check["detail"]

    def test_大部分线索没获取方式时算硬伤(self):
        plan = base_plan()
        for clue in plan["clues_public"]:
            clue["access"] = ""
        plan["clues_deep"][0]["access"] = ""
        check = get_check(check_fairness(plan), "clue_access")
        assert check["status"] == "fail"
        assert "clue_access" in check_fairness(plan)["blockers"]

    def test_没有深入线索判失败(self):
        plan = base_plan()
        plan["clues_deep"] = []
        check = get_check(check_fairness(plan), "clue_depth")
        assert check["status"] == "fail"
        assert "深入线索" in check["detail"]

    def test_凶手不在时间线判失败(self):
        plan = base_plan()
        for item in plan["timeline"]:
            item["event"] = item["event"].replace("林昭", "某人")
            item["witness"] = item["witness"].replace("林昭", "某人")
        check = get_check(check_fairness(plan), "culprit_on_timeline")
        assert check["status"] == "fail"

    def test_线索编号重复会被发现(self):
        plan = base_plan()
        plan["clues_public"][1]["id"] = "C1"
        check = get_check(check_fairness(plan), "clue_ids")
        assert check["status"] == "partial"
        assert "重复" in check["detail"]


class TestWarnRules:
    def test_死亡时间对不上时间线(self):
        plan = base_plan()
        plan["victim"]["death_time"] = "第一幕 23:55"
        check = get_check(check_fairness(plan), "death_time_anchor")
        assert check["status"] == "fail"
        assert "23:55" in check["detail"]

    def test_中文时间写法也能对齐(self):
        plan = base_plan()
        plan["victim"]["death_time"] = "晚上 21 点 40 分"
        assert get_check(check_fairness(plan), "death_time_anchor")["status"] == "pass"

    def test_死亡时间缺失时只给部分分不阻断(self):
        plan = base_plan()
        plan["victim"]["death_time"] = "深夜"
        report = check_fairness(plan)
        check = get_check(report, "death_time_anchor")
        assert check["status"] == "partial"
        assert check["level"] == "warn"

    def test_同一时间点堆叠三次会被提示(self):
        plan = base_plan()
        plan["timeline"] = [
            {"time": "21:40", "event": "甲", "witness": "众人"},
            {"time": "21:40", "event": "乙", "witness": "众人"},
            {"time": "21:40", "event": "丙", "witness": "众人"},
        ]
        check = get_check(check_fairness(plan), "timeline_duplicates")
        assert check["status"] == "partial"
        assert "21:40" in check["detail"]

    def test_角色没有秘密会扣分(self):
        plan = base_plan()
        for character in plan["characters"]:
            character["secret"] = ""
        check = get_check(check_fairness(plan), "character_secrets")
        assert check["status"] == "fail"

    def test_嫌疑人数不足会被判失败(self):
        plan = base_plan()
        plan["characters"] = plan["characters"][:2]
        check = get_check(check_fairness(plan), "cast_size")
        assert check["status"] == "fail"
        assert "2 名嫌疑人" in check["detail"]

    def test_四人局只算待完善(self):
        plan = base_plan()
        plan["characters"] = plan["characters"][:4]
        check = get_check(check_fairness(plan), "cast_size")
        assert check["status"] == "partial"


class TestRedHerring:
    def test_结构化红鲱鱼缺排除方式(self):
        plan = base_plan()
        plan["red_herrings"] = [{"description": "药箱", "clear_method": ""}]
        check = get_check(check_fairness(plan), "red_herring_clear")
        assert check["status"] == "fail"

    def test_没有红鲱鱼章节不判失败(self):
        plan = base_plan()
        plan.pop("red_herrings")
        check = get_check(check_fairness(plan), "red_herring_clear")
        assert check["status"] == "partial"
        assert "可选" in check["detail"]

    def test_从正文兜底识别红鲱鱼排除说明(self):
        plan = base_plan()
        plan.pop("red_herrings")
        markdown = (
            "## 七、红鲱鱼与误导点\n"
            "- 医生的药箱：看起来像凶器，但药箱封条完整，可排除\n"
            "- 女仆的钥匙：钥匙当晚在管家手里，可以排除\n"
        )
        check = get_check(check_fairness(plan, markdown), "red_herring_clear")
        assert check["status"] == "pass"


class TestSummaryLine:
    def test_通过时给出结论(self):
        assert "通过" in summary_line(check_fairness(base_plan()))

    def test_不通过时点名问题项(self):
        plan = base_plan()
        plan["culprit"]["character"] = "不存在的人"
        line = summary_line(check_fairness(plan))
        assert "凶手在角色表内" in line
