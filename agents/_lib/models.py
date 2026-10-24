"""模型工厂：统一走 Makers 模型网关（OpenAI 兼容协议）。"""

from __future__ import annotations

from typing import Literal

from langchain_openai import ChatOpenAI

from .config import EnvConfig

ModelKind = Literal["reason", "answer"]
_models: dict[tuple[str, str, str, str], ChatOpenAI] = {}


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
            max_tokens=8000,
            timeout=300,
            max_retries=1,
        )
    else:
        model = ChatOpenAI(
            model=env.model,
            api_key=env.api_key,
            base_url=env.base_url,
            temperature=0.5,
            timeout=300,
            max_retries=1,
        )

    _models[key] = model
    return model
