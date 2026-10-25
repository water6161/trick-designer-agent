"""环境变量读取：所有密钥只从平台注入的 env 读取，禁止硬编码。"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

DEFAULT_BASE_URL = "https://ai-gateway.edgeone.link/v1"
DEFAULT_MODEL = "@makers/deepseek-v4-flash"


class ConfigError(RuntimeError):
    """配置缺失或非法。"""


@dataclass(frozen=True)
class EnvConfig:
    api_key: str
    base_url: str
    model: str
    fast_model: str
    wsa_api_key: str


def _env_get(env: Any, key: str) -> str:
    """兼容 dict / 平台 env 对象两种形态。"""
    if env is None:
        return ""
    getter = getattr(env, "get", None)
    if callable(getter):
        try:
            value = getter(key)
            if value is not None:
                return str(value).strip()
        except Exception:
            pass
    value = getattr(env, key, None)
    return str(value).strip() if value is not None else ""


def load_env(env: Any) -> EnvConfig:
    # 自备 OpenAI 兼容服务（如阿里云 DashScope）优先：
    # 平台的 AI_GATEWAY_* 为保留变量，控制台修改会被重置，因此提供 OPENAI_* 覆盖通道。
    fallback_key = _env_get(env, "OPENAI_API_KEY")
    fallback_base = _env_get(env, "OPENAI_BASE_URL")
    fallback_model = _env_get(env, "OPENAI_MODEL")

    api_key = fallback_key or _env_get(env, "AI_GATEWAY_API_KEY")
    base_url = (
        fallback_base
        or _env_get(env, "AI_GATEWAY_BASE_URL")
        or DEFAULT_BASE_URL
    )
    model = fallback_model or _env_get(env, "AI_GATEWAY_MODEL") or DEFAULT_MODEL

    # 当前联网搜索走平台内置 web_search，WSA_API_KEY 仅读取备用，不参与硬编码。
    wsa_api_key = _env_get(env, "WSA_API_KEY")

    if not api_key:
        raise ConfigError(
            "缺少 AI_GATEWAY_API_KEY。请在 EdgeOne Makers 控制台为项目配置模型网关密钥后重试。"
        )
    if not base_url.startswith("http"):
        raise ConfigError("AI_GATEWAY_BASE_URL 不是合法的 http(s) 地址。")
    # 轻量模型用于 understand 等小任务；未配置时退回主模型。
    fast_model = _env_get(env, "OPENAI_MODEL_FAST") or model

    return EnvConfig(
        api_key=api_key,
        base_url=base_url.rstrip("/"),
        model=model,
        fast_model=fast_model,
        wsa_api_key=wsa_api_key,
    )
