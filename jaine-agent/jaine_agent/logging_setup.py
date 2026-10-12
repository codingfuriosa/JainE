"""Logging setup shared by every entry point.

Deliberately plain stdlib logging, not a model chain-of-thought dump: what
gets logged here is exactly the concise action/status trail the dashboard
and console are meant to show (see the project's observability rules) —
"Starting browser", "Navigating to X", "Completed" — never raw model
reasoning.
"""
from __future__ import annotations

import logging
import sys


def setup_logging(level: str = "INFO") -> logging.Logger:
    logger = logging.getLogger("jaine_agent")
    if logger.handlers:
        return logger  # already configured (e.g. re-entered in the same process)

    logger.setLevel(getattr(logging, level, logging.INFO))
    # The Windows console's default codepage mangles the em-dashes/curly quotes
    # this project writes everywhere in its own comments and messages; force
    # UTF-8 on stdout so logged text (and later, page text the agent reads)
    # never gets corrupted into "?" or mojibake.
    if hasattr(sys.stdout, "reconfigure"):
        try:
            sys.stdout.reconfigure(encoding="utf-8")
        except Exception:
            pass
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(logging.Formatter(
        fmt="%(asctime)s  %(levelname)-7s  %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S",
    ))
    logger.addHandler(handler)
    logger.propagate = False
    return logger
