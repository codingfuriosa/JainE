"""Runs one natural-language task through Browser Use.

This is where sections 5/6 of the spec (hybrid AI + deterministic tools) live
in practice: Browser Use's own Tools/Controller already implement the
deterministic browser operations (navigate, click, type, select, scroll,
wait, screenshot, extract, back, forward) via Playwright under the hood —
the LLM only ever decides WHICH of those known operations to call next, one
step at a time. We don't hand it shell access or anything outside that
registry.

Uses the SAME dedicated Chrome profile Phase 3 established (Section 7), so
whatever you've logged into by hand carries over into an agent-driven run
too — Browser Use manages the actual Playwright lifecycle itself here.
"""
from __future__ import annotations

import asyncio
from dataclasses import dataclass, field
from typing import Callable, Optional

from jaine_agent.config import Config
from jaine_agent.llm import LLMProviderError, create_browser_use_llm


class AgentTaskError(RuntimeError):
    """Setup failed before any browser step ran (bad LLM config, browser-use/
    playwright not installed, profile couldn't launch) — distinct from a run
    that started but didn't succeed, which comes back as AgentRunResult
    instead of raising."""


@dataclass
class AgentRunResult:
    success: bool
    final_result: Optional[str]
    steps_taken: int
    errors: list = field(default_factory=list)
    timed_out: bool = False


async def run_browser_task(
    task: str,
    cfg: Config,
    on_status: Optional[Callable[[str], None]] = None,
) -> AgentRunResult:
    def emit(msg: str) -> None:
        if on_status:
            on_status(msg)

    try:
        from browser_use import Agent
        from browser_use.browser.profile import BrowserProfile
    except ImportError as e:
        raise AgentTaskError(
            "browser-use is not installed. Run: pip install -e .[browser] && playwright install"
        ) from e

    try:
        llm = create_browser_use_llm(cfg)
    except LLMProviderError as e:
        raise AgentTaskError(str(e)) from e

    profile = BrowserProfile(
        user_data_dir=cfg.chrome_profile_dir,
        channel=cfg.browser_channel,
        headless=cfg.browser_headless,
    )

    def on_step(browser_state, agent_output, step_number) -> None:
        # Deliberately only next_goal — never `thinking` (the model's raw
        # chain-of-thought) or the evaluation/memory fields. Section 8/12:
        # show concise action/status only, never hidden reasoning.
        goal = (getattr(agent_output, "next_goal", None) or "").strip()
        if goal:
            emit(f"Step {step_number}: {goal}")

    agent = Agent(
        task=task,
        llm=llm,
        browser_profile=profile,
        register_new_step_callback=on_step,
        use_vision=cfg.agent_use_vision,
    )

    emit("Starting browser")
    try:
        history = await asyncio.wait_for(
            agent.run(max_steps=cfg.agent_max_steps), timeout=cfg.agent_timeout_seconds
        )
    except asyncio.TimeoutError:
        msg = f"Timed out after {cfg.agent_timeout_seconds}s"
        emit(msg)
        return AgentRunResult(
            success=False, final_result=None, steps_taken=cfg.agent_max_steps,
            errors=[msg], timed_out=True,
        )
    finally:
        try:
            await agent.close()
        except Exception:
            pass

    errors = [e for e in history.errors() if e]
    result = AgentRunResult(
        success=bool(history.is_successful()),
        final_result=history.final_result(),
        steps_taken=len(history.history),
        errors=errors,
    )
    emit("Completed" if result.success else "Completed with issues")
    return result
