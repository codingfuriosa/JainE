# JainE Automation -- a Chrome extension, not a separate process

Runs inside your real, already-signed-in Chrome. Two independent queues:

- **`acc.sheet_jobs`** -- proven, deterministic: when a Booking Form's OCR finishes, appends the
  booking's fields to a Google Sheet. Always runs the same purpose-built code.
- **`acc.automation_jobs`** -- universal: any JainE event, or a person, can enqueue a job with
  plain-English **instructions** and a starting URL. If nothing has been specifically written for
  that job's `kind`, Claude runs it step-by-step (click/type/navigate), bounded by a step cap and
  a host allowlist.

No separate Chrome window, no Playwright, no signing in twice.

```
JAIN-E (Supabase)                    this extension, in your browser
──────────────────                   ───────────────────────────────
booking OCR'd, status → done
  → note in acc.sheet_jobs   ─ping→  (every ~1 min, via chrome.alarms, or "Run now")
                              ←────  claims the note, reads the booking's fields
                                       one Aadhaar? use it. two+? ask Claude which one.
                                       attach to the Sheet tab (chrome.debugger)
                                       delete this booking's old row if one exists
                                       type the new row
                              ─────→ writes back: done, or what stopped it

anyone calls                 ─ping→  claims the note
acc.automation_job_enqueue(          has a purpose-built handler for this "kind"?
  kind, instructions, payload)         yes -> run it, same as above
                                        no  -> agentic fallback: read the page, ask
                                               Claude for ONE action, do it, repeat
                                               (max 20 steps, only on allowed hosts)
                              ─────→ writes back: done, or what stopped it
```

Same underlying mechanism for both (`chrome.debugger` driving a tab in this browser instance --
see `lib/cdp-input.js`), because testing found:

- **Chrome refuses `--remote-debugging-port` on your default profile** (a deliberate security
  measure), so a separate Chrome process could never be "your signed-in browser" -- it always
  needed its own profile and its own sign-in.
- Raw keyboard automation over the DevTools Protocol *does* work correctly against a real page
  (verified against the real Sheet: every one of the 21 columns landed right) -- it just needed to
  run as `chrome.debugger` inside a real extension instead of `chrome-remote-interface` from a
  standalone Node process, which also fixed the sign-in problem for free.

## One-time setup

1. Go to `chrome://extensions`, turn on **Developer mode** (top right).
2. **Load unpacked** → select this folder (`tools/jaine-automation-extension`).
3. Click the extension's **Details** → **Extension options** (or the puzzle-piece icon → pin it,
   then click it → Settings), and fill in:
   - **Supabase URL** / **anon key** -- same ones JainE's frontend uses.
   - **Sheet-bot secret** -- `select value from acc.job_secrets where name = 'sheet_bot';`
   - **Anthropic API key** -- used for the Aadhaar-disambiguation decision, and by the agentic
     fallback for any `automation_jobs` job.
   - **Target Sheet URL**.
   - **Automation-bot secret** (optional) -- `select value from acc.job_secrets where name =
     'automation_bot';`. Leave blank to disable the universal queue entirely and only run the
     Sheet pipeline.
4. Click the extension's toolbar icon and hit **Run now** to try one cycle immediately, or just
   wait -- it polls every minute on its own via `chrome.alarms`.

## Giving it instructions (the universal queue)

Enqueue a job as any signed-in JainE user (this RPC is not secret-gated -- describing work can't
read or change anything by itself):

```sql
select acc.automation_job_enqueue(
  'some_new_task',                              -- kind: free text, only matters if you later
                                                  -- write a dedicated handler for it
  'Open the page and click the export button, then confirm the download starts.',
  '{"url": "https://docs.google.com/..."}'::jsonb -- payload.url is required for the agentic path
);
```

If `some_new_task` has no entry in `lib/job-handlers.js`'s `AUTOMATION_HANDLERS`, the agentic
runner (`lib/agentic-runner.js`) picks it up: it reads the page as a numbered list of clickable
elements, asks Claude for one action, executes it, and repeats -- up to 20 steps, refusing to
navigate anywhere outside this extension's own `host_permissions`, and instructed to fail rather
than complete a purchase, deletion, or anything else it can't undo (that instruction is enforced
by prompting, not a hard technical guarantee -- treat the agentic path as good for exploratory or
low-stakes tasks, not as a substitute for a real handler on anything sensitive).

**To let it touch a new site**, add its host to `host_permissions` in `manifest.json` and reload
the extension -- there's no way around this by design; a job's instructions can't grant a
permission nobody explicitly gave the extension.

## What you'll see happen

When a job runs, `chrome.debugger` attaching to a tab shows Chrome's own **"[Extension name]
started debugging this browser"** banner on that tab while it works, then it detaches. That's
Chrome telling you an extension has low-level control of the tab -- expected, not an error.

## The safety rails

- **It stops rather than guesses.** A blocking dialog, the wrong sheet, the cursor not moving
  after typing, the agentic runner hitting its step cap -- the job fails with a note and a saved
  screenshot (`chrome://downloads`, folder `jaine-automation-logs/`), not a bad write.
- **Reprocess-safe (Sheet pipeline).** If a booking is OCR'd twice, its previous row is found *and
  verified to actually be in the hidden Case ID column* before being deleted -- a stray cell
  elsewhere that happens to contain the same digits is ignored, not deleted by mistake.
- **The Aadhaar pick fails closed.** If Claude's answer isn't verbatim one of the candidates, the
  cell is left blank with a note rather than risking a wrong number on a financial record.
- **The agentic runner is capped and fenced**, not just prompted to behave: a hard 20-step limit,
  and `navigate` is rejected in code (not just discouraged) for any host outside
  `manifest.json`'s `host_permissions`.
- **Separate secrets per queue** (`sheet_bot`, `automation_bot`), scoped to claiming/finishing
  jobs only -- not the service key. Revoke either independently by changing `acc.job_secrets`.

## Adding a real handler for a new automation_jobs kind

`lib/job-handlers.js`'s `AUTOMATION_HANDLERS` is the registry. A new one needs only:
1. A handler function: `(config, job) => { ok, note }` (see `runSheetAppendBooking` for the
   pattern, or write a purpose-built one using `lib/cdp-input.js`'s primitives directly).
2. One more entry in `AUTOMATION_HANDLERS`, keyed by the `kind` string you'll use in
   `automation_job_enqueue`.

`background.js`'s poll loop doesn't change -- it already drains both queues and dispatches by kind.

## Looking at the queues

```sql
select j.id, c.case_no, j.status, j.attempts, j.note, j.claimed_at, j.finished_at
from acc.sheet_jobs j join acc.flow_cases c on c.id = j.case_id
order by j.id desc;

select id, kind, status, attempts, note, instructions, claimed_at, finished_at
from acc.automation_jobs
order by id desc;
```

## Superseded

`tools/sheet-bot/` (the standalone Node.js + separate-Chrome-profile prototype) is superseded by
this extension. Kept for reference; not meant to be run going forward.
