# JainE Agent

A local Windows service that turns a JainE event into browser automation:

```
JainE -> Supabase -> jaine-agent worker -> local LLM (Ollama) -> Playwright/Browser Use -> Chrome -> target app
```

The LLM and the browser layer are both swappable — see `jaine_agent/llm/` (added
in Phase 2) for the provider abstraction, and Section 7 below for how it talks
to Chrome. This file grows with each build phase; **Phases 1–3** are done, the
rest are listed at the bottom so progress is visible.

## Install (Windows)

```bash
cd jaine-agent
python -m venv .venv
.venv\Scripts\pip install -e .
copy .env.example .env
```

Edit `.env` — at minimum nothing is *required* yet (Phase 1 has no Ollama or
Supabase dependency), but fill in `OLLAMA_MODEL` before Phase 2.

## Run

```bash
jaine-agent test               # self-check: prints config, machine id, what's missing
jaine-agent start              # runs the worker (Ctrl+C to stop)
jaine-agent llm-test "prompt"  # send one prompt straight to the configured LLM, print the reply
jaine-agent browser-test       # open the dedicated Chrome profile, browse to Google, screenshot it
```

(Or, without installing the console script: `python -m jaine_agent test|start`.)

## Section 7 — how this talks to Chrome

Chrome 136+ blocks `--remote-debugging-port` on your **default** profile (a
security fix, so CDP can't be used to lift cookies/saved passwords from the
browser you actually use day to day). So jaine-agent does **not** attach to
your everyday Chrome window. Instead it drives a **separate, dedicated "JainE
Agent" Chrome profile** (its own folder, `.chrome-profile/` by default, set via
`CHROME_PROFILE_DIR`), launched via Playwright's `launch_persistent_context`
using the real installed Chrome (`BROWSER_CHANNEL=chrome`, not Playwright's
bundled Chromium — same browser you already use, just a separate profile).

**You log into FarVision (and anything else it needs) in that profile once, by
hand.** jaine-agent never sees, extracts, or stores a password — it just
reuses the cookies already sitting in that profile on every later run, same as
you would by reopening a browser you stayed logged into.

## What Phase 1 actually is

A standalone, independently-startable process with:
- config loaded entirely from `.env` (nothing hard-coded — provider, model,
  poll interval, Supabase credentials all come from the environment)
- a stable **machine_id**, auto-generated once and persisted to `.machine_id`
  (or set explicitly via `MACHINE_ID=` in `.env`, e.g. to call it "Machine A"
  so a job can later be pinned to it)
- clean start/stop and UTF-8-safe logging (Windows' console codepage otherwise
  mangles the em-dashes/curly quotes used throughout this project)

It does **not** yet talk to Ollama, a browser, or Supabase — those are Phases
2, 3–4, and 6–7. The `start` loop currently just idles and heartbeats; later
phases give it real work to pick up.

## Build order (see project root's original spec for full detail)

- [x] Phase 1 — local worker skeleton
- [x] Phase 2 — `LLMProvider` abstraction + `OllamaProvider` (code proven; needs
      Ollama actually installed on this machine to prove a live reply — see below)
- [x] Phase 3 — Playwright/Chrome connection, via a dedicated profile (see Section 7 below)
- [ ] Phase 4 — Browser Use agent integration
- [ ] Phase 5 — manual natural-language task execution
- [ ] Phase 6 — Supabase `agent_runs`
- [ ] Phase 7 — Supabase `agent_jobs`
- [ ] Phase 8 — JainE event trigger
- [ ] Phase 9 — Purchase Order Approved test event
- [ ] Phase 10 — FarVision automation
