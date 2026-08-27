# Lost-Call QA Pipeline

Every night the system takes yesterday's calls out of DreamCRM, listens to each recording with
Gemini (see **Model availability**), grades the agent, and asks one question that nobody was asking before: **does what
actually happened on the call agree with what the CRM says happened?**

A lead marked *Lost* who spent the call asking for a site visit was written off while still buying.
A lead still being chased who said "I have no requirement" is effort going nowhere. Both show up as
a **MISMATCH**, and surfacing them is the point of the whole thing.

```
00:00 IST daily
      ↓
Fetch yesterday from DreamCRM ──→ store the raw JSON response (audit)
      ↓
One durable row per lead, deduplicated on lead_id + callid
      ↓
FIFO queue — strictly one call at a time
      ↓
Fetch audio from Knowlarity into memory  ← never stored, only the URL is
      ↓
Gemini: is there a real conversation?
      ↓                                    ↓
     yes                                   no
      ↓                                    ↓
transcript + dashboard fields          non_transcribable
+ QA audit + verdict                   with a specific reason
      ↓                                    ↓
validate the JSON                      terminal
      ↓
compare against the CRM → MATCH / MISMATCH / NOT_COMPARABLE
      ↓
next call
```

---

## Where everything lives

| Piece | Location |
| --- | --- |
| Pipeline (fetch, queue, Gemini, comparison) | [supabase/functions/transcription-sync/index.ts](supabase/functions/transcription-sync/index.ts) |
| Schema + one-time data migration | [supabase/migrations/20260827090000_lost_call_pipeline.sql](supabase/migrations/20260827090000_lost_call_pipeline.sql) |
| The two cron jobs | [supabase/migrations/20260827090100_lost_call_schedule.sql](supabase/migrations/20260827090100_lost_call_schedule.sql) |
| Dashboard, table, detail view | [nexus-core.js](nexus-core.js) — the `tra*` functions |
| Page shell | [transcription.html](transcription.html) |
| Rows | `acc.transcriptions` where `source = 'lost_call_sync'` |
| The day's raw feed, parked | `acc.transcription_jobs` |
| Fetch audit log | `acc.lost_call_sync_runs` |

Manual uploads are a **separate path** and always were: they go through the `transcription-analyze`
function (Gladia), carry `source IS NULL`, and keep their own `done`/`error` statuses. Nothing here
touches them.

---

## Deploying (order matters)

The function writes to columns the migration creates. **Deploy in this order or the running
pipeline will start failing every call.**

**1. Apply the schema migration.** Supabase SQL editor, or:

```bash
supabase db push
```

**2. Confirm the consolidation did what it should.** 13 leads held two rows each; they should now
hold one row with the older call folded into `call_history`:

```sql
select count(*) as rows, count(distinct lead_id) as leads
from acc.transcriptions where source='lost_call_sync' and deleted_at is null;
```

Those two numbers must now be equal. The folded rows are soft-deleted with
`deleted_by = 'system: folded into the lead row'` and `merged_into` pointing at the survivor —
nothing was destroyed, and the fold can be reversed.

**3. Set the secrets** (Supabase → Edge Functions → Secrets). `GEMINI_API_KEY` is the only required
one; the rest have working defaults:

| Secret | Default | What it does |
| --- | --- | --- |
| `GEMINI_API_KEY` | — | **Required.** Never reaches the browser. |
| `GEMINI_MODEL` | `gemini-3.1-pro-preview` | See **Model availability** below. Change without touching cron. |
| `APP_TZ_OFFSET_MIN` | `330` | IST. Decides what "yesterday" means. |
| `LOST_CALL_FEED` | the RealtyBucket URL | |
| `WANTED_STATUSES` | *(empty — all)* | Comma-separated allow-list, e.g. `Lost,In Followup`. |
| `MIN_DURATION_SECONDS` | `60` | Ring-out floor. `0` sends everything to Gemini. |
| `MAX_ATTEMPTS` | `3` | Automatic retries before a call stays failed. |

**4. Deploy the function.**

```bash
supabase functions deploy transcription-sync --no-verify-jwt
```

`--no-verify-jwt` is required: the function does its own auth (see below) because pg_cron cannot
present a user JWT.

**5. Install the cron jobs** — run `20260827090100_lost_call_schedule.sql`.

**6. Smoke-test before waiting a day:**

```bash
curl -s -X POST "$SUPABASE_URL/functions/v1/transcription-sync" \
  -H "Content-Type: application/json" -H "apikey: $ANON_KEY" \
  -H "Authorization: Bearer $YOUR_USER_JWT" \
  -d '{"action":"status"}'
```

Then pull one specific day by hand and work a single call:

```bash
curl -s -X POST "$SUPABASE_URL/functions/v1/transcription-sync" \
  -H "Content-Type: application/json" -H "apikey: $ANON_KEY" \
  -H "Authorization: Bearer $YOUR_USER_JWT" \
  -d '{"action":"pull","from":"2026-08-26","to":"2026-08-26"}'
```

---

## The parts worth understanding

### Audio is never stored

The recording is fetched from Knowlarity into memory, handed to Gemini as inline base64, and goes
out of scope. The row keeps the ~90 byte `recording_url` and nothing else. Storing the audio would
be roughly **4.7 GB a year** for no benefit — a retry just re-fetches it. There is no audio column,
no bucket, no blob.

The Knowlarity link 302s to a presigned S3 URL that expires in ~600 seconds, which is exactly why
the *Knowlarity* link is what gets stored and never the redirect target.

### Model availability

The spec asked for **Gemini 2.5 Pro**. Google no longer serves it to this API project — a live call
on 2026-08-27 returned:

> 404 `models/gemini-2.5-pro is no longer available to new users. Please update your code to use
> models/gemini-3.1-pro-preview`

So the default is `gemini-3.1-pro-preview`, which the same key reaches without a 404. `GEMINI_MODEL`
in Secrets overrides it with no redeploy when this changes again — and it will.

**Billing.** The 36 pre-existing failures were all `429 Your prepayment credits are depleted`, and a
test call on 2026-08-27 still returns 429. **The pipeline cannot transcribe anything until the Gemini
project is topped up** at https://ai.studio/projects. Everything upstream of the model call is
verified working; this is the only thing standing between the queue and results.

### The day's raw response

An edge function has no filesystem between invocations, so "store the original response temporarily
as JSON" means a row. `acc.transcription_jobs` existed for exactly this and had never been written
to — the pull now fills it (`job_date`, `payload`, `feed_rows`, counters, `status`), and the worker
clears `payload` once every call for that day has reached a terminal state. A day that fails to
fetch gets a `status='failed'` job row, so a missing day is visible rather than simply absent.

The **durable** audit is per-row `original_crm_response`, which is never cleared. The parked payload
is only the replayable copy of the whole array.

### One row per lead, with the history inside it

A lead called three times has **one** row. The newest call sits on the row's own columns; earlier
calls are archived into `call_history`, each keeping its own transcript, QA evaluation, verdict and
comparison. `status_trail` records how the CRM's verdict moved — the table renders it as
**Qualified → Lost**.

A call that arrives while another is still being processed waits in `pending_calls` and rotates in
the moment the current one reaches a terminal state, so a second call is never lost and never
clobbers work in flight. A unique index enforces the one-row rule at the database level:

```sql
create unique index transcriptions_one_row_per_lead
  on acc.transcriptions (lead_id)
  where source = 'lost_call_sync' and deleted_at is null and lead_id is not null;
```

### FIFO, and what makes it survive a restart

`queue_seq` comes from a Postgres sequence, handed out **in the order the CRM API returned the
records**. The worker:

1. Requeues anything eligible for automatic retry, and reclaims rows stuck in `processing` for over
   15 minutes — that is a killed invocation, not work in flight.
2. **Refuses to start** if any row is genuinely `processing`.
3. Takes the single lowest `queue_seq` row and claims it with `update ... where status in
   ('pending','retrying')`. The status predicate *is* the lock: two overlapping ticks cannot both
   win, so a recording is never paid for twice.
4. Processes it to a terminal state, then stops.

Cron ticks every minute. That is a heartbeat, not parallelism — and it is what makes the queue
self-healing, because a crashed invocation is picked up on the next tick instead of stalling the
day.

Nothing lives in memory between invocations, so "restart-safe" is free: the queue *is* the table.

### Statuses

| Status | Meaning | Terminal | Retry button |
| --- | --- | --- | --- |
| `pending` | queued, not started | no | no |
| `processing` | in flight right now | no | no |
| `retrying` | automatically requeued after a failure | no | no |
| `completed` | transcript + QA saved | **yes** | no |
| `failed` | the attempt did not produce a valid result | **yes** | **yes** |
| `non_transcribable` | no human conversation in the recording | **yes** | no |

Rows created before this rewrite used `queued`/`done`/`error`/`no_recording`/`too_short`. The
migration maps them, and the UI normalises anything it missed, so old and new rows read the same.

### Never "completed" on a failure

A call reaches `completed` only after **all** of these pass:

- Gemini returned HTTP 200 with non-empty text
- the text parses as JSON
- the JSON has `status: "Completed"`, a non-empty `transcript` array, and an array `qa_evaluation`
- the transcript is not a stuck loop (one word repeated over 60% of the time)
- the transcript is not too thin for the length of the audio (≥120 characters, and ≥1.5 characters
  per second of audio)

Anything else is `failed`, with the raw reply kept in `gemini_raw` for debugging and explicitly
**not** saved as a transcript.

### Why those last two content checks exist

This matters, because the spec asks Gemini to both listen and judge in a single call, and that exact
shape has failed here before.

An earlier version quietly stopped transcribing and started composing. Across **175 calls, the name
it claimed to hear matched the CRM's own record zero times out of the 20 it offered one** — Pradip
Das was greeted as "Suman babu". Every check passed, because every check tested the *shape* of the
output.

So shape validation is necessary and not sufficient. Three checks test the *content* instead:

- **`degenerateRepeat`** — one word repeated is a recogniser stuck in a loop, not a listen.
- **the density floor** — real transcripts of these calls run 6–16 characters per second of audio.
  The failures cluster far below: "Hello." at 0.1, forty-character answers at 0.2 and 0.5. The
  threshold of 1.5 sits in the empty gap, so a genuinely terse call passes and near-silence does
  not.
- **`name_matches_crm`** — the model is never told the CRM's name, so this stays an honest check.
  One mismatch is a reason to look. **A run where it almost never agrees is the alarm** — check it
  after any prompt or model change.

Do not remove them.

### The comparison

`transcription_status` is derived from the conversation, in the CRM's own vocabulary so the two are
comparable at all:

| AI lead category | Derived |
| --- | --- |
| Not Interested | `lost` |
| Qualified · Interested Site Visit · Interested in Booking | `qualified` |
| Interested Not Qualified | `follow_up` if a callback was requested, else `lost` |

| CRM says | Call says | Result |
| --- | --- | --- |
| Lost | lost | MATCH |
| Lost | qualified | **MISMATCH** — written off while still active, re-open it |
| Lost | follow_up | **MISMATCH** — pending, not closed |
| In Followup | follow_up / qualified | MATCH |
| In Followup | lost | **MISMATCH** — chasing a closed lead |
| anything | not transcribed, failed, or unclear | NOT_COMPARABLE |

`non_transcribable` is deliberately **NOT_COMPARABLE**, never MATCH. A recording with no conversation
in it cannot agree with the CRM, and counting it as agreement would inflate the one number on the
dashboard anyone acts on.

---

## The UI

Six tabs on **Transcription**:

- **Automatic Processing** — the daily import. Four cards (Total Calls, Transcribed, CRM Match, CRM
  Mismatch) plus a row of state chips (Pending, Processing, Retrying, Failed, Non-Transcribable).
  Every count is a filter over real rows, so a card and the table under it cannot disagree.
- **Manual Upload** — the existing hand-upload path, unchanged, just separated out.
- **Folders**, **Deleted**, **Discrepancies**, **Compilation** — unchanged.

Filters combine: date range (with *Previous day* / *Today* / *All time* presets and From/To inputs),
processing status, match status, CRM status, and a search box over lead ID and name. Filtering is on
`source_date` — the day the *call* belongs to, not the day the row happened to be written, which
differ whenever a day is back-filled.

Clicking a row opens the full detail: the complete CRM response rendered from the stored payload (so
a field the API starts sending tomorrow appears on its own), processing timeline, the comparison with
its reason, the **complete** transcript with MM:SS timestamps and speaker labels, dashboard fields,
the qualification checklist, the seven-point QA table, the verdict, earlier calls on the lead, and
the raw stored JSON.

**Copy Response** puts that row's original CRM record on the clipboard. There is no download button
anywhere on this page, by requirement.

**Retry** appears only on `failed` rows. It sends the call to the *back* of the FIFO queue so it
cannot starve the day's own calls, increments `attempt_count`, and leaves the existing result alone
until a new one replaces it. No row is duplicated.

---

## Authentication

The function does its own auth and accepts three things:

1. `x-sync-secret` matching `acc.job_secrets` where `name = 'transcription_sync'` — a token the
   **database generated for itself**. pg_cron reads it to build the header; the function reads it
   with its service-role key. No human ever invents or pastes a password.
2. `SYNC_SECRET` from Secrets (legacy).
3. A signed-in user's bearer token — this is what the Retry button uses.

`acc.job_secrets` has RLS on with no policies, so only the service role can read it.

---

## Operating it

```sql
-- queue depth and state
select status, count(*) from acc.transcriptions
where source='lost_call_sync' and deleted_at is null group by status;

-- what the last few pulls did
select created_at, from_date, trigger, feed_rows, inserted, duplicates,
       appended_history, queued_behind, error_text
from acc.lost_call_sync_runs order by created_at desc limit 10;

-- is the content check holding up? run this after any prompt or model change
select verification from acc.transcriptions
where source='lost_call_sync' and status='completed'
  and source_date = current_date - 1;

-- did cron actually fire
select * from cron.job_run_details order by start_time desc limit 10;
```

**Back-fill a missed day:** `{"action":"pull","from":"2026-08-20","to":"2026-08-20"}`. Safe to run
twice — deduplication is on `lead_id` + `callid`, so a repeat inserts nothing.

**Nothing is being worked.** Check, in order: `cron.job_run_details` for failures; whether a row is
wedged in `processing` (it self-clears after 15 minutes); whether `GEMINI_API_KEY` is set;
`{"action":"status"}`.

**Everything is failing at once.** Almost always the model name or the key. `gemini_raw` on a failed
row holds the actual reply.

---

## Known trade-offs

- **All CRM statuses are ingested**, not just Lost and In Followup. "Total Calls" has to be an honest
  total, and a lead's *Qualified → Lost* trail cannot be built if the Qualified leg was never taken
  in. This costs more in Gemini calls than the old Lost-only filter. Set `WANTED_STATUSES` to narrow
  it if the bill argues back.
- **Recordings under 60 seconds never reach Gemini.** They are ring-outs, and paying 2.5 Pro to be
  told so is waste. They land as `non_transcribable` with an explicit reason, so they are visible and
  not silently skipped. `MIN_DURATION_SECONDS=0` disables this.
- **Some columns are duplicated** — `attempt_count`/`attempts`, `last_error`/`error_text`,
  `source_date`/`report_date`. The new names are what the spec asked for; the old ones are still
  read by the Folders, Deleted, Discrepancies and Compilation tabs. The pipeline writes both. Worth
  collapsing once those tabs are revisited.
- **`original_crm_response` on pre-migration rows is reconstructed** from the columns the payload was
  unpacked into, and carries `"_reconstructed": true`. The detail view says so on screen. Rows
  imported after the migration hold the real payload.
