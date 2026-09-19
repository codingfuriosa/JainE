"""Picks an LLMProvider from config.llm_provider — the one place that knows
which concrete classes exist. Adding AnthropicProvider/OpenAIProvider/
GeminiProvider later means one more branch here; nothing else in the
codebase references a concrete provider class.
"""
from __future__ import annotations

from jaine_agent.config import Config
from jaine_agent.llm.base import LLMProvider, LLMProviderError


def create_provider(cfg: Config) -> LLMProvider:
    provider = cfg.llm_provider

    if provider == "ollama":
        from jaine_agent.llm.ollama_provider import OllamaProvider

        return OllamaProvider(base_url=cfg.ollama_base_url, model=cfg.ollama_model)

    if provider in ("anthropic", "openai", "gemini"):
        raise LLMProviderError(
            f"LLM_PROVIDER='{provider}' is planned but not implemented yet — only 'ollama' exists so far."
        )

    raise LLMProviderError(f"Unknown LLM_PROVIDER '{provider}'. Expected one of: ollama.")


def create_browser_use_llm(cfg: Config):
    """Same LLM_PROVIDER switch as create_provider(), but returning one of
    Browser Use's own BaseChatModel implementations instead of our LLMProvider.

    Browser Use already ships current, correct chat-model wrappers per
    provider (browser_use.llm.ollama/anthropic/openai/google/...) — reusing
    them here means swapping providers is still just adding one branch below,
    with no change to the agent-running code that calls this factory.
    """
    provider = cfg.llm_provider

    if provider == "ollama":
        if not cfg.ollama_model:
            raise LLMProviderError(
                "OLLAMA_MODEL is not set. Pull one first, e.g. `ollama pull qwen2.5:14b`, "
                "then set OLLAMA_MODEL in .env."
            )
        from browser_use.llm.ollama.chat import ChatOllama

        return ChatOllama(model=cfg.ollama_model, host=cfg.ollama_base_url)

    if provider in ("anthropic", "openai", "gemini"):
        raise LLMProviderError(
            f"LLM_PROVIDER='{provider}' is planned but not implemented yet — only 'ollama' exists so far."
        )

    raise LLMProviderError(f"Unknown LLM_PROVIDER '{provider}'. Expected one of: ollama.")
