"""全链路 trace 的集成测试：验证一次 chat 请求结束后指标真的被记录下来。

这里不 mock telemetry，而是把 handler 的依赖（模型、图、检索）换成假实现，
让它跑完真实的事件循环与 SSE 序列，最后检查指标内容。
"""

import asyncio
import json
import sys
from types import SimpleNamespace

sys.path.insert(0, ".")

import pytest

from agents._lib import app as app_module
from agents._lib import telemetry

FAKE_EVENTS = [
    ("status", {"stage": "understand", "label": "解析需求"}),
    ("status", {"stage": "design", "label": "生成方案"}),
    ("token", {"delta": "## 一、案件速览\n"}),
    ("token", {"delta": "正文内容"}),
    ("status", {"stage": "compose", "label": "收尾"}),
    ("meta", {"title": "雨夜山庄", "lock_score": 82, "quality": {"total": 34}, "plan": {"title": "雨夜山庄"}}),
    ("status", {"stage": "done", "label": "完成"}),
]


async def fake_run_graph(graph, payload, config):
    for event, data in FAKE_EVENTS:
        yield event, data


async def noop(*args, **kwargs):
    return None


def make_context(message="写一个密室本"):
    store = SimpleNamespace(
        append_message=noop,
        update_conversation=noop,
        list_conversations=noop,
        langgraph_checkpointer=None,
    )
    request = SimpleNamespace(
        body={"action": "chat", "message": message},
        headers={"x-client-id": "tester-123456"},
        signal=None,
    )
    return SimpleNamespace(
        request=request,
        conversation_id="conv-trace-test",
        store=store,
        env={},
        utils=SimpleNamespace(stream_sse=lambda agen: agen),
    )


def parse_frame(frame: str):
    """把一帧 SSE 文本还原成 (event, data)。"""
    event = "message"
    payload = "{}"
    for line in frame.strip().splitlines():
        if line.startswith("event:"):
            event = line[6:].strip()
        elif line.startswith("data:"):
            payload = line[5:].strip()
    return event, json.loads(payload)


async def drain(agen):
    events = []
    async for frame in agen:
        events.append(parse_frame(frame))
    return events


@pytest.fixture(autouse=True)
def _patch(monkeypatch):
    telemetry.reset()
    monkeypatch.setattr(app_module, "load_env", lambda env: SimpleNamespace())
    monkeypatch.setattr(app_module, "init_models", lambda env: None)
    monkeypatch.setattr(app_module, "build_graph", lambda **kwargs: object())
    monkeypatch.setattr(app_module, "_run_graph", fake_run_graph)

    async def no_tricks(*args, **kwargs):
        return []

    monkeypatch.setattr(app_module, "_collect_used_tricks", no_tricks)
    yield
    telemetry.reset()


def run(message="写一个密室本"):
    return asyncio.run(_run(message))


async def _run(message):
    context = make_context(message)
    agen = await app_module.handler(context)
    return await drain(agen)


class TestTraceRecorded:
    def test_一次请求只记一条指标(self):
        run()
        assert telemetry.snapshot()["total"] == 1

    def test_记录成功并带耗时(self):
        run()
        item = telemetry.snapshot()["recent"][0]
        assert item["ok"] is True
        assert item["action"] == "chat"
        assert item["durationMs"] >= 0
        assert item["events"] == len(FAKE_EVENTS)

    def test_按阶段聚合耗时(self):
        run()
        stages = {row["stage"] for row in telemetry.snapshot()["stages"]}
        assert {"understand", "design", "compose"} <= stages

    def test_心跳阶段不计入(self):
        # waiting 是心跳占位，不该出现在阶段统计里
        assert "waiting" not in {row["stage"] for row in telemetry.snapshot()["stages"]}

    def test_统计输出字符(self):
        run()
        item = telemetry.snapshot()["recent"][0]
        assert item["charsOut"] == len("## 一、案件速览\n正文内容")

    def test_session帧带traceId(self):
        events = run()
        session = next(data for event, data in events if event == "session")
        assert session["traceId"]
        assert session["conversationId"] == "conv-trace-test"

    def test_done帧带耗时信息(self):
        events = run()
        done = next(data for event, data in events if event == "done")
        assert "traceId" in done
        assert done["durationMs"] >= 0
        assert "stages" in done


class TestTraceFailure:
    def test_错误事件被记为失败(self, monkeypatch):
        async def failing(graph, payload, config):
            yield "token", {"delta": "半截"}
            yield "error", {"code": "timeout", "message": "生成超时了"}
            return

        monkeypatch.setattr(app_module, "_run_graph", failing)
        run()
        snapshot = telemetry.snapshot()
        assert snapshot["failed"] == 1
        assert snapshot["errors"][0]["message"] == "生成超时了"


class TestStatsAction:
    def test_stats返回聚合结构(self):
        run()
        context = make_context()
        context.request.body = {"action": "stats"}
        result = asyncio.run(app_module.handler(context))
        assert result["total"] == 1
        assert "latency" in result
        assert "tokens" in result
