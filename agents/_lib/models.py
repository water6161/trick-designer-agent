"""模型工厂：统一走 Makers 模型网关（OpenAI 兼容协议）。"""

from __future__ import annotations

from typing import Any, Literal

from langchain_openai import ChatOpenAI

from .config import EnvConfig

ModelKind = Literal["reason", "answer", "fast"]
_models: dict[tuple[str, str, str, str], ChatOpenAI] = {}


def _extra_body(model: str) -> dict[str, Any] | None:
    """平台默认 DeepSeek 推理模型会先消耗大量思考 token。

    复杂结构化请求下思考过程可达数分钟，导致节点超时或返回空结果；
    关闭思考后同一请求约 20 秒返回。其它模型不受影响。
    """
    if model.startswith("@makers/") and "deepseek" in model.lower():
        return {"thinking": {"type": "disabled"}}
    return None


def _max_tokens(model: str) -> int:
    """输出上限统一 16000（qwen-plus 等第三方兼容服务实测可接受）。"""
    return 16000


def init_models(env: EnvConfig) -> None:
    """预热并缓存模型实例；切换模型只需改 AI_GATEWAY_MODEL。"""
    for kind in ("reason", "answer"):
        get_model(env, kind)  # type: ignore[arg-type]


def get_model(env: EnvConfig, kind: ModelKind) -> ChatOpenAI:
    target_model = env.fast_model if kind == "fast" else env.model
    key = (env.base_url, target_model, env.api_key, kind)
    cached = _models.get(key)
    if cached is not None:
        return cached

    common: dict[str, Any] = dict(
        model=target_model,
        api_key=env.api_key,
        base_url=env.base_url,
        max_tokens=_max_tokens(target_model),
        timeout=300,
        max_retries=1,
        extra_body=_extra_body(target_model),
    )

    if kind == "answer":
        model = ChatOpenAI(temperature=0.72, **common)
    elif kind == "fast":
        model = ChatOpenAI(temperature=0.3, **common)
    else:
        model = ChatOpenAI(temperature=0.5, **common)

    _models[key] = model
    return model
