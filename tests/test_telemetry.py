"""运行指标（telemetry.py）的单元测试。"""

import sys

sys.path.insert(0, ".")

import pytest

from agents._lib import telemetry


@pytest.fixture(autouse=True)
def _clean():
    telemetry.reset()
    yield
    telemetry.reset()


def add(**kwargs):
    payload = {
        "trace_id": "t1",
        "action": "chat",
        "user_id": "user-abcdef",
        "conversation_id": "conv-abcdef",
        "duration_ms": 1000,
        "first_token_ms": 300,
        "stages": {"design": 600, "compose": 200},
        "events": 40,
        "chars_in": 100,
        "chars_out": 2000,
        "ok": True,
    }
    payload.update(kwargs)
    return telemetry.record(**payload)


class TestEstimate:
    def test_中文按字估算(self):
        assert telemetry.estimate_tokens("你好世界") == 3  # 4*0.7=2.8 -> 2 + 1

    def test_空字符串为零(self):
        assert telemetry.estimate_tokens("") == 0

    def test_英文按四字符一token(self):
        assert telemetry.estimate_tokens("abcdefgh") == 3  # 8/4=2 -> 2 + 1

    def test_混合文本(self):
        assert telemetry.estimate_tokens("中文 abcdef") > 0


class TestRecord:
    def test_记录后能取回(self):
        item = add()
        assert item["action"] == "chat"
        assert item["ok"] is True
        snapshot = telemetry.snapshot()
        assert snapshot["total"] == 1
        assert snapshot["recent"][0]["traceId"] == "t1"

    def test_用户标识只存哈希(self):
        item = add(user_id="sensitive-user-id")
        assert item["user"] != "sensitive-user-id"
        assert len(item["user"]) == 8

    def test_空标识不报错(self):
        assert add(user_id="", conversation_id="")["user"] == "-"

    def test_阶段耗时被保留(self):
        add(stages={"design": 500})
        assert telemetry.snapshot()["stages"][0]["stage"] == "design"


class TestSnapshot:
    def test_空数据返回零值结构(self):
        snapshot = telemetry.snapshot()
        assert snapshot["total"] == 0
        assert snapshot["successRate"] is None
        assert snapshot["stages"] == []

    def test_成功率按记录计算(self):
        add(ok=True)
        add(trace_id="t2", ok=True)
        add(trace_id="t3", ok=False, error="超时")
        snapshot = telemetry.snapshot()
        assert snapshot["total"] == 3
        assert snapshot["failed"] == 1
        assert snapshot["successRate"] == 0.667

    def test_分位数落在样本区间内(self):
        for i, ms in enumerate([100, 200, 300, 400, 5000]):
            add(trace_id=f"t{i}", duration_ms=ms)
        latency = telemetry.snapshot()["latency"]
        assert 100 <= latency["p50"] <= 5000
        assert latency["p95"] >= latency["p50"]
        assert latency["avg"] > 0

    def test_阶段按平均耗时降序(self):
        add(trace_id="a", stages={"understand": 100, "design": 900})
        add(trace_id="b", stages={"understand": 300, "design": 1100})
        stages = telemetry.snapshot()["stages"]
        assert stages[0]["stage"] == "design"
        assert stages[0]["avgMs"] == 1000

    def test_错误按次数聚合(self):
        add(trace_id="a", ok=False, error="模型超时")
        add(trace_id="b", ok=False, error="模型超时")
        add(trace_id="c", ok=False, error="额度受限")
        errors = telemetry.snapshot()["errors"]
        assert errors[0]["message"] == "模型超时"
        assert errors[0]["count"] == 2

    def test_token估算与成本为正(self):
        add(chars_in=1000, chars_out=5000)
        tokens = telemetry.snapshot()["tokens"]
        assert tokens["estIn"] > 0
        assert tokens["estOut"] > tokens["estIn"]
        assert tokens["estCostCny"] > 0

    def test_首字延迟只统计有值的样本(self):
        add(trace_id="a", first_token_ms=200)
        add(trace_id="b", first_token_ms=0)
        assert telemetry.snapshot()["firstToken"]["p50"] == 200


class TestCapacity:
    def test_超出容量后丢弃最旧(self):
        for i in range(telemetry._CAPACITY + 5):
            add(trace_id=f"t{i}")
        snapshot = telemetry.snapshot()
        assert snapshot["total"] == telemetry._CAPACITY
        assert snapshot["recent"][0]["traceId"] == f"t{telemetry._CAPACITY + 4}"

    def test_reset清空(self):
        add()
        telemetry.reset()
        assert telemetry.snapshot()["total"] == 0


class TestRuleFailures:
    def test_只统计失败项(self):
        telemetry.record_rules([
            {"code": "a", "label": "规则A", "status": "fail"},
            {"code": "b", "label": "规则B", "status": "pass"},
            {"code": "c", "label": "规则C", "status": "partial"},
        ])
        rows = telemetry.snapshot()["ruleFailures"]
        assert [row["code"] for row in rows] == ["a"]

    def test_累计次数并降序(self):
        telemetry.record_rules([{"code": "a", "label": "规则A", "status": "fail"}])
        telemetry.record_rules([{"code": "a", "label": "规则A", "status": "fail"}])
        telemetry.record_rules([{"code": "b", "label": "规则B", "status": "fail"}])
        rows = telemetry.snapshot()["ruleFailures"]
        assert rows[0]["code"] == "a"
        assert rows[0]["count"] == 2
        assert rows[1]["count"] == 1

    def test_空输入不报错(self):
        telemetry.record_rules([])
        telemetry.record_rules(None)
        assert telemetry.snapshot()["ruleFailures"] == []
