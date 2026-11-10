"""端到端验证：_handle_ai_cover 发给生图服务的请求必须是新模板 + 每次不同的 seed。

背景：线上出现过「每个本都长一样」的封面，根因是旧版 prompt 写死构图。
此文件钉死三件事，防止接线层回归：
1. 发出去的 prompt 不含旧模板文案、含方案素材；
2. 不传 nonce 时每次调用 seed/prompt/nonce 都不同（换一张）；
3. 传同一 nonce 可复现同一 seed。
"""

from __future__ import annotations

import asyncio
import json
from typing import Any

import pytest

from agents._lib.app import _handle_ai_cover


class _FakeEnv:
    api_key = "sk-test"
    base_url = "https://dashscope.aliyuncs.com/compatible-mode/v1"


class _FakeStore:
    async def get_messages(self, conversation_id: str, limit: int) -> list[dict[str, Any]]:
        return [
            {
                "role": "assistant",
                "content": "# 《雪线之下》\n\n" + "正文" * 120,
                "metadata": {
                    "title": "雪线之下",
                    "partial": False,
                    "brief": {"genre": "本格", "era": "当代", "players": "8人"},
                    "plan": {
                        "victim": {"scene": "缆车机房，总闸被拉下"},
                        "characters": [
                            {"name": "陆延", "identity": "电工", "look": "三十五岁，寸头，卡其色工装"},
                        ],
                        "clues_public": [{"id": "C1", "name": "半截烧焦的保险丝"}],
                    },
                },
            }
        ]


class _FakeResp:
    content = b"\x89PNG-fake-bytes"

    def __init__(self, payload: dict[str, Any]):
        self._payload = payload
        self.text = json.dumps(payload)

    def raise_for_status(self) -> None:
        return None

    def json(self) -> dict[str, Any]:
        return self._payload


@pytest.fixture()
def capture(monkeypatch: pytest.MonkeyPatch) -> list[dict[str, Any]]:
    """劫持 requests：捕获创建任务的请求体，其余按 DashScope 协议应答。"""
    created: list[dict[str, Any]] = []
    import requests as requests_module

    import agents._lib.app as app

    def fake_post(url: str, headers: dict[str, str] | None = None, json: dict[str, Any] | None = None, timeout: int = 30) -> _FakeResp:
        if "image-synthesis" in url:
            created.append(json or {})
            return _FakeResp({"output": {"task_id": f"task-{len(created)}"}})
        raise AssertionError(f"unexpected POST {url}")

    def fake_get(url: str, headers: dict[str, str] | None = None, timeout: int = 15) -> _FakeResp:
        if "/tasks/" in url:
            return _FakeResp({
                "output": {
                    "task_status": "SUCCEEDED",
                    "results": [{"url": "https://img.example/x.png"}],
                }
            })
        return _FakeResp({})

    # requests 在被测函数内部 import，patch 模块对象本身即可覆盖局部导入
    monkeypatch.setattr(requests_module, "post", fake_post)
    monkeypatch.setattr(requests_module, "get", fake_get)
    # 轮询间隔 3 秒，测试里跳过真实等待
    monkeypatch.setattr(app.time, "sleep", lambda _seconds: None)
    return created


def _run(capture: list[dict[str, Any]], **kwargs: Any) -> dict[str, Any]:
    return asyncio.run(
        _handle_ai_cover(_FakeEnv(), _FakeStore(), "conv-1", **kwargs)
    )


def test_发出去的_prompt_是方案素材_不是旧模板(capture: list[dict[str, Any]]) -> None:
    result = _run(capture, style="character")
    assert result.get("image", "").startswith("data:image/png")
    prompt = capture[0]["input"]["prompt"]
    assert "半截烧焦的保险丝" in prompt
    assert "寸头" in prompt
    assert "缆车机房" in prompt
    # 旧模板的写死文案一个都不能再出现
    assert "怀表/信件/匕首" not in prompt
    assert "老宅走廊与暗红帷幔" not in prompt


def test_不传_nonce_连点两次_seed_与_prompt_都不同(capture: list[dict[str, Any]]) -> None:
    first = _run(capture, style="character")
    second = _run(capture, style="character")
    assert len(capture) == 2
    seed_a = capture[0]["parameters"]["seed"]
    seed_b = capture[1]["parameters"]["seed"]
    assert seed_a != seed_b
    assert capture[0]["input"]["prompt"] != capture[1]["input"]["prompt"]
    assert first["nonce"] != second["nonce"]


def test_同一_nonce_复现同一_seed(capture: list[dict[str, Any]]) -> None:
    _run(capture, style="character", nonce="repro-1")
    _run(capture, style="character", nonce="repro-1")
    assert capture[0]["parameters"]["seed"] == capture[1]["parameters"]["seed"]
    assert capture[0]["input"]["prompt"] == capture[1]["input"]["prompt"]


def test_nonce_进入请求参数_且扩写关闭(capture: list[dict[str, Any]]) -> None:
    _run(capture, style="character", nonce="n-42")
    params = capture[0]["parameters"]
    assert params["prompt_extend"] is False
    assert params["size"] == "960*1280"
