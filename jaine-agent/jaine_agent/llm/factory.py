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
