# Sheet entry — a booking's own OCR reading fills the Sheet

When a Booking Form's uploaded document has been read (the OCR/AI pipeline finishes and
`acc.booking_audits.status` becomes `done`), a note goes into a second queue. A service on a
dedicated PC is woken almost instantly, claims the note, and types the booking's fields into a
Google Sheet — one new row per booking, always, never editing an old one in place. If that same
booking is reprocessed later, its previous row is found and deleted first, so a reprocess reads
as a correction, not a duplicate.

```
JAIN-E                              the sheet-bot PC
──────                              ─────────────────
document OCR'd, status → done
  → note in acc.sheet_jobs   ─ping→  (near-instant, via Supabase Realtime)
                              ←────  claims the note, reads the booking's fields
                                       one Aadhaar? use it. two+? ask Claude which one.
                                       open the Sheet in Chrome (CDP, no Playwright)
                                       delete this booking's old row if one exists
                                       type the new row
                              ─────→ writes back: done, or what stopped it
```

**Why this is a separate thing from `tools/erp-bot/`.** That one drives Farvision with Claude
Code + the Chrome extension. This one is deliberately built without either — a small Node
service, one narrow Claude **API** call for a single judgment call (which Aadhaar number is the
applicant's), and everything else is plain deterministic code driving Chrome over the DevTools
Protocol. Two different automations, two different PCs, sharing only the same job-queue shape.

**Status: this is a test/prototype pass**, not yet a production automation — build it out and
watch it against a test copy of the Sheet before pointing it at the real one (see below).

## Setting it up, once

On the (different, not-yet-configured) PC that will run this:

1. **Install Node.js ≥18** and **Google Chrome**.
2. **Sign a dedicated Chrome profile** into the Google account that has edit access to the
   target Sheet, and leave it running with remote debugging on:
   ```
   chrome.exe --remote-debugging-port=9222 --user-data-dir="C:\sheet-bot-chrome-profile"
   ```
   Keep this Chrome open. The automation is pinned to whatever Chrome answers on that port —
   if it's not running, jobs fail and say so, rather than typing into whatever browser happens
   to be open.
3. **Add one hidden column** to the Sheet, `Case ID`, right after `Unit Price` (column V). The
   automation writes the booking's internal case id there and uses it to find/delete a
   booking's previous row on reprocess. Right-click the column header → *Hide column* once it's
   there, if you don't want it visible day-to-day.
4. **Make a test copy of the Sheet** (File → Make a copy) — also add the hidden `Case ID`
   column to the copy. You'll point at this copy first.
5. From this directory: `npm install`.
6. Copy `.env.example` to `.env` and fill in:
   - `SUPABASE_ANON_KEY` — the same publishable anon key JAIN-E's frontend uses.
   - `SHEET_BOT_SECRET` — from `select value from acc.job_secrets where name = 'sheet_bot';`
   - `ANTHROPIC_API_KEY` — used only for the Aadhaar disambiguation call.
   - `SHEET_URL` — **the test copy's URL**, for now.
7. **Try one job by hand:**
   ```
   npm run smoke-test
   ```
   Check the test copy of the Sheet, and read the log file under `logs/` for what happened.
8. Once you're happy with several clean runs against the test copy, edit `.env` to point
   `SHEET_URL` at the real Sheet and run `npm run smoke-test` once more, supervised.
9. **Leave it running unattended** by registering it as a Scheduled Task (not a Windows Service —
   a CDP-driven visible Chrome window needs an interactive desktop session, which a Service
   account doesn't get):
   ```
   powershell -ExecutionPolicy Bypass -File scripts\install-task.ps1
   ```
   This starts `node src/index.js` at your next logon, and restarts it up to 3 times if it
   crashes. Start it immediately (without logging off) with:
   ```
   powershell -Command "Start-ScheduledTask -TaskName 'JainE-SheetBot'"
   ```

## The safety rails

- **It stops rather than guesses.** Any unexpected step — a blocking dialog, the wrong sheet tab,
  the cursor not moving after typing, Chrome not answering on the debug port — fails the job
  with a note and a saved screenshot (in `logs/`), rather than typing something wrong.
- **The Aadhaar pick fails closed.** If there's more than one Aadhaar candidate, Claude is asked
  to pick the primary applicant's; if its answer isn't verbatim one of the candidates, the cell
  is left blank with a note instead of risking a wrong number on a financial record.
- **Its own secret.** The service holds a secret (`sheet_bot`, in `acc.job_secrets`) that can only
  claim and finish sheet jobs — not the service key. Revoke it by changing that one row.
- **Three attempts, then it waits**, same as `erp_jobs` — a job that keeps failing sits as
  `failed` for a person to read rather than retrying forever.

## Looking at the queue

```sql
select j.id, c.case_no, j.status, j.attempts, j.note, j.claimed_at, j.finished_at
from acc.sheet_jobs j join acc.flow_cases c on c.id = j.case_id
order by j.id desc;
```

## Changing what it does

- **The 21-column field mapping** lives in `src/mapping.js`, as plain, unit-testable functions —
  no prompt to edit, unlike `erp-bot`.
- **The Aadhaar-disambiguation prompt** is in `src/claude-decision.js`.
- **The Sheet URL and Chrome port** are in `.env` (never commit that file — it holds secrets).

## Known rough edges (expected at this "test" stage)

- The append routine finds the next empty row with `Ctrl+Down` from column A — a concurrent
  human edit or an unusual gap in column A could throw this off. A hybrid version that reads the
  row count via the Google Sheets API (while still typing via CDP) would remove this, at the
  cost of one more credential; not built yet since pure-keyboard automation was the ask.
- The Name Box selector (`#t-name-box`) and the dialog-detection selector in `src/sheet-cdp.js`
  are Google's current DOM ids/classes — if Google changes the Sheets UI, re-check these by
  opening DevTools on a real Sheet and looking for what changed.
- If the signed-in Google account gets logged out (password change, security flag), jobs will
  fail with a note rather than typing into a login form — that PC's Chrome profile needs
  re-authenticating by hand when that happens.
