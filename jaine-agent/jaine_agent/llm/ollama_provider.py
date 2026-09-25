"""LLMProvider backed by a local Ollama server (docs.ollama.com/capabilities/tool-calling).

Uses the official `ollama` Python client's chat() endpoint, which accepts a
plain messages list and an OpenAI-style `tools` array and returns tool_calls
with arguments already parsed as dicts (not JSON strings) — no extra parsing
needed on our side.
"""
from __future__ import annotations

from typing import Any, Optional

from jaine_agent.llm.base import (
    LLMProvider,
    LLMProviderError,
    LLMResponse,
    Message,
    ToolCall,
    ToolSpec,
)


def _get(obj: Any, key: str, default: Any = None) -> Any:
    """Ollama's client returns pydantic-style objects with attribute access in
    some versions and plain dicts in others — read either without caring which."""
    if obj is None:
        return default
    if isinstance(obj, dict):
        return obj.get(key, default)
    return getattr(obj, key, default)


def _to_ollama_message(m: Message) -> dict:
    out: dict = {"role": m.role, "content": m.content}
    if m.role == "tool" and m.tool_call_id:
        out["tool_call_id"] = m.tool_call_id
    if m.role == "assistant" and m.tool_calls:
        out["tool_calls"] = [
            {"function": {"name": tc.name, "arguments": tc.arguments}} for tc in m.tool_calls
        ]
    return out


def _to_ollama_tool(t: ToolSpec) -> dict:
    return {
        "type": "function",
        "function": {
            "name": t.name,
            "description": t.description,
            "parameters": t.parameters,
        },
    }


class OllamaProvider(LLMProvider):
    def __init__(self, base_url: str, model: str):
        if not model:
            raise LLMProviderError(
                "OLLAMA_MODEL is not set. Pull one first, e.g. `ollama pull qwen2.5:14b`, "
                "then set OLLAMA_MODEL in .env."
            )
        try:
            import ollama
        except ImportError as e:
            raise LLMProviderError(
                "The 'ollama' package is not installed. Run: pip install -e .[llm]"
            ) from e

        self._base_url = base_url.rstrip("/")
        self._model = model
        self._client = ollama.Client(host=self._base_url)

    @property
    def name(self) -> str:
        return f"ollama:{self._model}"

    def chat(self, messages: list[Message], tools: Optional[list[ToolSpec]] = None) -> LLMResponse:
        payload_messages = [_to_ollama_message(m) for m in messages]
        payload_tools = [_to_ollama_tool(t) for t in tools] if tools else None

        try:
            resp = self._client.chat(
                model=self._model,
                messages=payload_messages,
                tools=payload_tools,
            )
        except Exception as e:
            raise LLMProviderError(
                f"Could not reach Ollama at {self._base_url} with model '{self._model}': {e}. "
                "Is Ollama installed and running (`ollama serve`), and has this model been "
                f"pulled (`ollama pull {self._model}`)?"
            ) from e

        msg = _get(resp, "message", {})
        content = _get(msg, "content", "") or ""
        raw_tool_calls = _get(msg, "tool_calls", None) or []

        tool_calls: list[ToolCall] = []
        for i, tc in enumerate(raw_tool_calls):
            fn = _get(tc, "function", {})
            tool_calls.append(
                ToolCall(
                    id=_get(tc, "id", None) or f"call_{i}",
                    name=_get(fn, "name", "") or "",
                    arguments=dict(_get(fn, "arguments", {}) or {}),
                )
            )

        return LLMResponse(content=content, tool_calls=tool_calls, model=self._model, raw=resp)
