"""模型工厂：统一走 Makers 模型网关（OpenAI 兼容协议）。"""

from __future__ import annotations

from typing import Any, Literal

from langchain_openai import ChatOpenAI

from .config import EnvConfig

ModelKind = Literal["reason", "answer"]
_models: dict[tuple[str, str, str, str], ChatOpenAI] = {}


def _extra_body(model: str) -> dict[str, Any] | None:
    """平台默认 DeepSeek 推理模型会先消耗大量思考 token。

    复杂结构化请求下思考过程可达数分钟，导致节点超时或返回空结果；
    关闭思考后同一请求约 20 秒返回。其它模型不受影响。
    """
    if model.startswith("@makers/") and "deepseek" in model.lower():
        return {"thinking": {"type": "disabled"}}
    return None


def init_models(env: EnvConfig) -> None:
    """预热并缓存模型实例；切换模型只需改 AI_GATEWAY_MODEL。"""
    for kind in ("reason", "answer"):
        get_model(env, kind)  # type: ignore[arg-type]


def get_model(env: EnvConfig, kind: ModelKind) -> ChatOpenAI:
    key = (env.base_url, env.model, env.api_key, kind)
    cached = _models.get(key)
    if cached is not None:
        return cached

    if kind == "answer":
        model = ChatOpenAI(
            model=env.model,
            api_key=env.api_key,
            base_url=env.base_url,
            temperature=0.72,
            max_tokens=16000,
            timeout=300,
            max_retries=1,
            extra_body=_extra_body(env.model),
        )
    else:
        model = ChatOpenAI(
            model=env.model,
            api_key=env.api_key,
            base_url=env.base_url,
            temperature=0.5,
            max_tokens=16000,
            timeout=300,
            max_retries=1,
            extra_body=_extra_body(env.model),
        )

    _models[key] = model
    return model
