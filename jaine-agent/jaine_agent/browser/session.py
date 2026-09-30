"""Owns the one Chrome session jaine-agent drives.

SECTION 7 DECISION (documented per the spec's own request):
Chrome 136+ ignores --remote-debugging-port on the DEFAULT profile directory
(a deliberate security fix, to stop CDP from being used to lift cookies/saved
passwords from your everyday browser). That rules out attaching to whatever
Chrome window you already have open day to day.

So this uses the spec's own documented fallback instead: a SEPARATE, dedicated
"JainE Agent" Chrome profile (its own --user-data-dir, launched via Playwright's
launch_persistent_context). You log into FarVision/etc. in that profile once,
by hand — jaine-agent never sees or stores a password — and every later
automation run reuses that same profile's cookies. It is real Chrome (not
Playwright's bundled Chromium) via the "chrome" channel, so it behaves exactly
like the browser you already use, just in its own separate profile.

Async, not sync: Browser Use (Phase 4) is asyncio-native, and the worker's
job loop will be too (polling Supabase while a browser task runs), so this is
built async-first rather than needing a rewrite later.
"""
from __future__ import annotations

from pathlib import Path
from typing import Optional


class BrowserSession:
    def __init__(self, profile_dir: str, channel: str = "chrome", headless: bool = False):
        self._profile_dir = Path(profile_dir)
        self._channel = channel
        self._headless = headless
        self._playwright = None
        self._context = None

    async def start(self):
        """Launch (or attach to a fresh window in) the dedicated profile and
        return a ready-to-use Page."""
        try:
            from playwright.async_api import async_playwright
        except ImportError as e:
            raise RuntimeError(
                "playwright is not installed. Run: pip install -e .[browser] && playwright install"
            ) from e

        self._profile_dir.mkdir(parents=True, exist_ok=True)
        self._playwright = await async_playwright().start()
        try:
            self._context = await self._playwright.chromium.launch_persistent_context(
                user_data_dir=str(self._profile_dir),
                channel=self._channel,
                headless=self._headless,
                viewport=None,  # None lets a headed window use its own natural size
            )
        except Exception:
            # Real Chrome ("chrome" channel) may not be registered with Playwright
            # yet, or genuinely isn't installed — fall back to bundled Chromium
            # rather than failing the whole run over a channel mismatch.
            if self._channel != "chromium":
                self._context = await self._playwright.chromium.launch_persistent_context(
                    user_data_dir=str(self._profile_dir),
                    headless=self._headless,
                    viewport=None,
                )
            else:
                raise

        return self._context.pages[0] if self._context.pages else await self._context.new_page()

    @property
    def context(self):
        return self._context

    async def stop(self) -> None:
        if self._context is not None:
            await self._context.close()
            self._context = None
        if self._playwright is not None:
            await self._playwright.stop()
            self._playwright = None
