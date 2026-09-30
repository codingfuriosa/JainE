"""The seam between jaine-agent and whatever does its reasoning.

Everything upstream (the worker, the browser-agent loop, the tool system)
talks to this interface only. Swapping local Ollama for Anthropic/OpenAI/
Gemini later means adding one more class in this package — nothing in
worker/ or browser/ changes.
"""
from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Any, Optional


@dataclass
class ToolSpec:
    """One tool the LLM is allowed to call this turn, in JSON-schema shape —
    provider-agnostic; each provider adapts it to its own wire format."""
    name: str
    description: str
    parameters: dict


@dataclass
class ToolCall:
    id: str
    name: str
    arguments: dict


@dataclass
class Message:
    role: str  # "system" | "user" | "assistant" | "tool"
    content: str = ""
    tool_call_id: Optional[str] = None                    # set on role="tool" replies
    tool_calls: list[ToolCall] = field(default_factory=list)  # set on role="assistant" turns that called tools


@dataclass
class LLMResponse:
    content: str
    tool_calls: list[ToolCall]
    model: str
    raw: Any = None  # provider's raw reply, for debugging only — never surfaced as agent "reasoning"


class LLMProviderError(RuntimeError):
    """Connection failure, missing model, bad config, etc. Callers (CLI, worker)
    catch this and turn it into a clean failed-job status line, not a stack trace."""


class LLMProvider(ABC):
    @property
    @abstractmethod
    def name(self) -> str:
        """e.g. "ollama:qwen2.5:14b" — used in logs and agent_runs.model."""

    @abstractmethod
    def chat(self, messages: list[Message], tools: Optional[list[ToolSpec]] = None) -> LLMResponse:
        """One turn: send the conversation (+ optional tool definitions this
        turn may use), get back plain text and/or one or more tool calls for
        the caller to execute and feed back as a role="tool" Message."""
