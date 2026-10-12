"""Configuration for jaine-agent, loaded entirely from the environment (.env).

Nothing here is hard-coded: which LLM provider to use, which Ollama model, the
poll interval, and this machine's own identity all come from the environment
so the same code runs unchanged on every machine and every provider swap.
"""
from __future__ import annotations

import os
import uuid
from dataclasses import dataclass
from pathlib import Path

from dotenv import load_dotenv

AGENT_DIR = Path(__file__).resolve().parent.parent
MACHINE_ID_FILE = AGENT_DIR / ".machine_id"


def _resolve_machine_id(explicit: str) -> str:
    """MACHINE_ID env var wins outright (lets a machine be named "Machine A").
    Otherwise reuse the id persisted from this machine's first run, generating
    and saving one if this is that first run — so a machine's identity is
    stable across restarts without anyone having to set anything."""
    explicit = (explicit or "").strip()
    if explicit:
        return explicit
    if MACHINE_ID_FILE.exists():
        saved = MACHINE_ID_FILE.read_text(encoding="utf-8").strip()
        if saved:
            return saved
    new_id = f"machine-{uuid.uuid4().hex[:12]}"
    MACHINE_ID_FILE.write_text(new_id, encoding="utf-8")
    return new_id


@dataclass(frozen=True)
class Config:
    machine_id: str
    llm_provider: str
    ollama_base_url: str
    ollama_model: str
    supabase_url: str
    supabase_service_key: str
    poll_interval_seconds: int
    log_level: str
    chrome_profile_dir: str
    browser_channel: str
    browser_headless: bool
    agent_max_steps: int
    agent_timeout_seconds: int
    agent_use_vision: bool

    def describe(self) -> str:
        """Human-readable summary with secrets masked — safe to print/log."""

        def mask(v: str) -> str:
            return "(not set)" if not v else (v[:4] + "…" if len(v) > 4 else "set")

        lines = [
            f"machine_id            = {self.machine_id}",
            f"llm_provider           = {self.llm_provider}",
            f"ollama_base_url        = {self.ollama_base_url}",
            f"ollama_model           = {self.ollama_model or '(not set — required before Phase 2 can call Ollama)'}",
            f"supabase_url           = {self.supabase_url or '(not set — wired up in Phase 6/7)'}",
            f"supabase_service_key   = {mask(self.supabase_service_key)}",
            f"poll_interval_seconds  = {self.poll_interval_seconds}",
            f"log_level              = {self.log_level}",
            f"chrome_profile_dir     = {self.chrome_profile_dir}",
            f"browser_channel        = {self.browser_channel}",
            f"browser_headless       = {self.browser_headless}",
            f"agent_max_steps        = {self.agent_max_steps}",
            f"agent_timeout_seconds  = {self.agent_timeout_seconds}",
            f"agent_use_vision       = {self.agent_use_vision}",
        ]
        return "\n".join(lines)


def load_config() -> Config:
    env_file = AGENT_DIR / ".env"
    if env_file.exists():
        load_dotenv(env_file)

    return Config(
        machine_id=_resolve_machine_id(os.getenv("MACHINE_ID", "")),
        llm_provider=os.getenv("LLM_PROVIDER", "ollama").strip().lower(),
        ollama_base_url=os.getenv("OLLAMA_BASE_URL", "http://localhost:11434").strip(),
        ollama_model=os.getenv("OLLAMA_MODEL", "").strip(),
        supabase_url=os.getenv("SUPABASE_URL", "").strip(),
        supabase_service_key=os.getenv("SUPABASE_SERVICE_KEY", "").strip(),
        poll_interval_seconds=int(os.getenv("POLL_INTERVAL_SECONDS", "5")),
        log_level=os.getenv("LOG_LEVEL", "INFO").strip().upper(),
        chrome_profile_dir=os.getenv("CHROME_PROFILE_DIR", str(AGENT_DIR / ".chrome-profile")).strip(),
        browser_channel=os.getenv("BROWSER_CHANNEL", "chrome").strip(),
        browser_headless=os.getenv("BROWSER_HEADLESS", "false").strip().lower() in ("1", "true", "yes"),
        agent_max_steps=int(os.getenv("AGENT_MAX_STEPS", "15")),
        agent_timeout_seconds=int(os.getenv("AGENT_TIMEOUT_SECONDS", "300")),
        # Off by default: most small local Ollama text models (llama3.2, qwen2.5, ...) reject the
        # screenshots Browser Use sends when this is on, with a hard 400 from Ollama itself. Only
        # turn this on if OLLAMA_MODEL is actually a vision model (llama3.2-vision, qwen2.5vl, ...).
        agent_use_vision=os.getenv("AGENT_USE_VISION", "false").strip().lower() in ("1", "true", "yes"),
    )
