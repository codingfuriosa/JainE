"""jaine-agent CLI.

    python -m jaine_agent test     — self-check: config loads, machine id is
                                      stable, report what is/isn't configured
                                      yet. No browser, no LLM call (those
                                      arrive in later phases).
    python -m jaine_agent start    — run the worker process. Phase 1: proves
                                      the service starts, logs its identity
                                      and config, and idles cleanly until
                                      stopped — the skeleton every later
                                      phase (Ollama, Playwright, Supabase
                                      polling) gets layered into.
    python -m jaine_agent llm-test "prompt"
                                    — Phase 2: send one prompt straight to the
                                      configured LLMProvider (no browser, no
                                      tools) and print the reply. Proves the
                                      provider abstraction actually reaches a
                                      real model before anything is built on
                                      top of it.
    python -m jaine_agent browser-test
                                    — Phase 3: launch the dedicated JainE Agent
                                      Chrome profile, navigate to Google,
                                      confirm the page loaded, screenshot it.
                                      No LLM involved yet — proves the browser
                                      layer on its own before Browser Use
                                      (Phase 4) drives it with reasoning.
    python -m jaine_agent agent-test "task"
                                    — Phase 4/5: the real thing. Runs a
                                      natural-language task through a Browser
                                      Use Agent, using the configured LLM
                                      provider and the dedicated Chrome
                                      profile. Prints concise step-by-step
                                      status (never the model's raw
                                      reasoning) and the final result.

Also runnable as the `jaine-agent` console script once the package is
installed (`pip install -e .`) — see pyproject.toml.
"""
from __future__ import annotations

import argparse
import asyncio
import sys
import time
from pathlib import Path

from jaine_agent.config import load_config
from jaine_agent.logging_setup import setup_logging


def cmd_test() -> int:
    cfg = load_config()
    log = setup_logging(cfg.log_level)
    log.info("jaine-agent self-check")
    log.info("Config:\n%s", cfg.describe())

    problems = []
    if cfg.llm_provider == "ollama" and not cfg.ollama_model:
        problems.append("OLLAMA_MODEL is not set — required from Phase 2 onward.")
    if not cfg.supabase_url or not cfg.supabase_service_key:
        problems.append("SUPABASE_URL/SUPABASE_SERVICE_KEY not set yet — expected until Phase 6/7.")

    if problems:
        log.info("Not yet configured (fine at this phase):")
        for p in problems:
            log.info("  - %s", p)
    else:
        log.info("Everything is configured.")

    log.info("Self-check complete. machine_id=%s", cfg.machine_id)
    return 0


def cmd_llm_test(prompt: str) -> int:
    from jaine_agent.llm import LLMProviderError, Message, create_provider

    cfg = load_config()
    log = setup_logging(cfg.log_level)
    log.info("Provider: %s", cfg.llm_provider)
    try:
        provider = create_provider(cfg)
        log.info("Using model: %s", provider.name)
        log.info("Sending prompt...")
        reply = provider.chat([Message(role="user", content=prompt)])
    except LLMProviderError as e:
        log.error("Failed: %s", e)
        return 1
    log.info("Reply:\n%s", reply.content)
    return 0


def cmd_browser_test() -> int:
    from jaine_agent.browser import BrowserSession

    cfg = load_config()
    log = setup_logging(cfg.log_level)

    async def run() -> int:
        log.info(
            "Starting browser (profile: %s, channel: %s, headless: %s)",
            cfg.chrome_profile_dir, cfg.browser_channel, cfg.browser_headless,
        )
        session = BrowserSession(cfg.chrome_profile_dir, cfg.browser_channel, cfg.browser_headless)
        try:
            page = await session.start()
            log.info("Navigating to Google")
            await page.goto("https://www.google.com", wait_until="domcontentloaded")
            log.info("Verifying result")
            title = await page.title()
            shot_dir = Path(cfg.chrome_profile_dir).parent / ".artifacts"
            shot_dir.mkdir(parents=True, exist_ok=True)
            shot_path = shot_dir / "browser-test.png"
            await page.screenshot(path=str(shot_path))
            if not title:
                log.error("Failed: page loaded but returned no title")
                return 1
            log.info("Completed — page title: %r, screenshot: %s", title, shot_path)
            return 0
        finally:
            await session.stop()

    try:
        return asyncio.run(run())
    except Exception as e:
        log.error("Failed: %s", e)
        return 1


def cmd_agent_test(task: str) -> int:
    from jaine_agent.browser_agent import AgentTaskError, run_browser_task

    cfg = load_config()
    log = setup_logging(cfg.log_level)
    log.info("Task: %s", task)
    log.info(
        "Provider: %s (%s), max_steps=%s, timeout=%ss",
        cfg.llm_provider, cfg.ollama_model, cfg.agent_max_steps, cfg.agent_timeout_seconds,
    )

    def on_status(msg: str) -> None:
        log.info(msg)

    async def run() -> int:
        try:
            result = await run_browser_task(task, cfg, on_status=on_status)
        except AgentTaskError as e:
            log.error("Failed: %s", e)
            return 1
        log.info("Success: %s", result.success)
        log.info("Steps taken: %s", result.steps_taken)
        if result.errors:
            log.info("Errors: %s", "; ".join(result.errors))
        log.info("Final result: %s", result.final_result or "(none)")
        return 0 if result.success else 1

    return asyncio.run(run())


def cmd_start() -> int:
    cfg = load_config()
    log = setup_logging(cfg.log_level)
    log.info("jaine-agent starting  (machine_id=%s, llm_provider=%s)", cfg.machine_id, cfg.llm_provider)
    log.info("Config:\n%s", cfg.describe())
    log.info(
        "Phase 1 skeleton: no job source is wired up yet (that's Supabase "
        "agent_jobs, Phase 6/7) — idling every %ss until stopped with Ctrl+C.",
        cfg.poll_interval_seconds,
    )
    try:
        while True:
            time.sleep(cfg.poll_interval_seconds)
            log.info("heartbeat — waiting for later phases to give this loop real work")
    except KeyboardInterrupt:
        log.info("Stopping (Ctrl+C received). Goodbye.")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(prog="jaine-agent")
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("start", help="Run the worker process")
    sub.add_parser("test", help="Self-check config without starting the worker")
    p_llm = sub.add_parser("llm-test", help="Send one prompt to the configured LLMProvider")
    p_llm.add_argument("prompt", help="The prompt to send")
    sub.add_parser("browser-test", help="Open the dedicated Chrome profile and browse to Google")
    p_agent = sub.add_parser("agent-test", help="Run a natural-language task through Browser Use")
    p_agent.add_argument("task", help="The task to perform")
    args = parser.parse_args()

    if args.command == "start":
        return cmd_start()
    if args.command == "test":
        return cmd_test()
    if args.command == "llm-test":
        return cmd_llm_test(args.prompt)
    if args.command == "browser-test":
        return cmd_browser_test()
    if args.command == "agent-test":
        return cmd_agent_test(args.task)
    parser.print_help()
    return 1


if __name__ == "__main__":
    sys.exit(main())
