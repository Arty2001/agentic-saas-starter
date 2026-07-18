"""Provider-agnostic LLM factory.

Provides a single ``get_llm()`` function that all downstream code uses to
obtain a chat model instance.  No provider-specific imports should appear
anywhere else in the codebase.
"""

from __future__ import annotations

import logging
from typing import Any

from langchain_anthropic import ChatAnthropic
from langchain_core.language_models import BaseChatModel
from langchain_openai import ChatOpenAI

from agent_platform.config import get_settings

logger = logging.getLogger(__name__)

# Providers backed by the OpenAI-compatible ``ChatOpenAI`` adapter.
# The value is the default ``base_url`` for that provider (``None`` means the
# caller must supply one explicitly, or the provider uses its own default).
_OPENAI_COMPATIBLE_DEFAULTS: dict[str, str | None] = {
    "openai": None,
    "deepseek": "https://api.deepseek.com/v1",
    "vllm": None,
}


def get_llm(
    *,
    provider: str | None = None,
    model: str | None = None,
    base_url: str | None = None,
    temperature: float = 0.0,
    enable_thinking: bool = True,
    **kwargs: Any,
) -> BaseChatModel:
    """Return a chat model for the requested provider.

    When *provider* or *model* are ``None`` the values fall back to the
    ``DEFAULT_LLM_PROVIDER`` / ``DEFAULT_LLM_MODEL`` environment variables
    (exposed via :func:`agent_platform.config.get_settings`).

    Args:
        provider: One of ``"openai"``, ``"anthropic"``, ``"deepseek"``, or
            ``"vllm"``.  Defaults to ``settings.default_llm_provider``.
        model: Model name/identifier.  Defaults to
            ``settings.default_llm_model``.
        base_url: Override the API endpoint.  Required for ``"vllm"``
            if ``DEFAULT_LLM_BASE_URL`` is not set.
        temperature: Sampling temperature.  Defaults to ``0.0``
            (deterministic).
        enable_thinking: For vLLM-served models with a thinking switch in
            their chat template, toggles reasoning on/off.
        **kwargs: Forwarded to the underlying chat model constructor.

    Returns:
        A :class:`~langchain_core.language_models.BaseChatModel` instance
        ready for ``.invoke()`` or ``.bind_tools()``.

    Raises:
        ValueError: If *provider* is not recognised, or ``"vllm"`` is
            requested without a resolvable *base_url*.
    """
    settings = get_settings()

    provider = provider or settings.default_llm_provider
    model = model or settings.default_llm_model
    logger.info(
        "get_llm_called: provider=%s model=%s base_url=%s temperature=%s",
        provider, model, base_url, temperature,
    )

    # --- Anthropic ---------------------------------------------------------
    if provider == "anthropic":
        return ChatAnthropic(
            model_name=model,
            api_key=settings.anthropic_api_key,  # type: ignore[arg-type]
            temperature=temperature,
            **kwargs,
        )

    # --- OpenAI-compatible providers (openai / deepseek / vllm) ------------
    if provider in _OPENAI_COMPATIBLE_DEFAULTS:
        effective_base_url = (
            base_url
            or settings.default_llm_base_url
            or _OPENAI_COMPATIBLE_DEFAULTS[provider]
        )

        if provider == "vllm":
            if not effective_base_url:
                raise ValueError(
                    "base_url is required for the 'vllm' provider. "
                    "Pass it directly or set DEFAULT_LLM_BASE_URL."
                )
            api_key: str | None = "not-needed"
        elif provider == "deepseek":
            api_key = settings.deepseek_api_key or settings.openai_api_key
        else:
            # openai
            api_key = settings.openai_api_key

        extra_body = {}
        if provider == "vllm":
            extra_body["chat_template_kwargs"] = {"enable_thinking": enable_thinking}

        logger.info("get_llm_creating: provider=%s model=%s base_url=%s", provider, model, effective_base_url)
        return ChatOpenAI(
            model=model,
            base_url=effective_base_url,  # type: ignore[arg-type]
            api_key=api_key,  # type: ignore[arg-type]
            temperature=temperature,
            stream_usage=True,
            extra_body=extra_body or None,
            **kwargs,
        )

    # --- Unknown -----------------------------------------------------------
    raise ValueError(
        f"Unknown provider: {provider!r}. "
        "Supported: openai, anthropic, deepseek, vllm"
    )


def estimate_tokens(messages: list) -> int:
    """Estimate token count from messages using a chars-per-token heuristic.

    Works with any provider — no tokenizer needed. Conservative estimate
    (slightly over-counts) to avoid context window overflow.
    """
    total = 0
    for msg in messages:
        content = getattr(msg, "content", "")
        if isinstance(content, str):
            total += len(content) // 3  # ~3 chars/token is conservative
        elif isinstance(content, list):
            for block in content:
                if isinstance(block, dict):
                    total += len(str(block)) // 3
                elif isinstance(block, str):
                    total += len(block) // 3
        total += 4  # per-message overhead (role, separators)
    return total
