# CRM Call QA Pipeline

Every night the system takes yesterday's calls out of DreamCRM, listens to each recording, and asks
the question nobody was asking before: **does what actually happened on the call agree with what the
CRM says happened?**

A lead marked *Lost* who spent the call asking for a site visit was written off while still buying.
A lead still being chased who said "I have no requirement" is effort going nowhere. Remarks that say
"no req" against a call about budget. A callback booked for 12:30 today when the customer said next
week. All four are things the CRM records and nobody re-reads, and surfacing them is the point of the
whole thing.

```
00:00 IST daily
      ↓
Fetch the CRM feed for yesterday
      ↓
STORE THE RESPONSE VERBATIM  ──→  acc.crm_snapshots.raw, never cleared
      ↓
Normalise the STORED copy → one row per lead, one row per follow-up
      ↓
Build the queue from the STORED copy — only follow-ups with a recording
      ↓
One recording at a time, in order:
      ↓
   already transcribed?  ──yes──→  reuse it. No model call, no second bill.
      ↓ no
   fetch audio into memory  ← never stored, only the URL is
      ↓
   Gemini: transcribe, with diarization and MM:SS timestamps
      ↓
   OpenAI: judge the transcript against the CRM's own record
      ↓
   pitch · follow-up date · lost reason · remarks · status
      ↓
   store, and count the mismatch by category
      ↓
next recording
```

The CRM response is the **source-of-truth snapshot for that day's processing**. Everything after the
first step reads the stored copy. Nothing re-asks the CRM mid-run, so the day cannot change underneath
the work.

---

## Where everything lives

| Piece | Location |
| --- | --- |
| Pipeline (snapshot, queue, transcribe, judge) | [supabase/functions/crm-snapshot-qa/index.ts](supabase/functions/crm-snapshot-qa/index.ts) |
| The transcription prompt — listening only | [supabase/functions/crm-snapshot-qa/transcribe-prompt.ts](supabase/functions/crm-snapshot-qa/transcribe-prompt.ts) |
| The QA prompt — judging only | [supabase/functions/crm-snapshot-qa/qa-prompt.ts](supabase/functions/crm-snapshot-qa/qa-prompt.ts) |
| The six-point agent rubric | [supabase/functions/_shared/qa-rubric.ts](supabase/functions/_shared/qa-rubric.ts) |
| Schema, normaliser, queue builder, views | [supabase/migrations/20260831090000_crm_snapshot_qa_pipeline.sql](supabase/migrations/20260831090000_crm_snapshot_qa_pipeline.sql) |
| The two cron jobs | [supabase/migrations/20260831090100_crm_snapshot_qa_schedule.sql](supabase/migrations/20260831090100_crm_snapshot_qa_schedule.sql) |
| Dashboard, lead list, lead detail | [nexus-core.js](nexus-core.js) — the `trc*` functions |
| Page shell | [transcription.html](transcription.html) |

### The tables

| Table | One row per | Holds |
| --- | --- | --- |
| `acc.crm_snapshots` | day (+ revision) | the API response verbatim. **Never cleared.** |
| `acc.crm_snapshot_leads` / `_followups` | lead / follow-up, **per snapshot** | what the CRM claimed *that day* |
| `acc.crm_leads` | lead | the CRM's current state, carried forward |
| `acc.crm_followups` | follow-up | **the lead history.** Every follow-up ever seen |
| `acc.call_transcripts` | **recording_url** | the transcript. This is the deduplication key |
| `acc.followup_qa` | follow-up | the five assessments |
| `acc.transcription_queue` | follow-up with a recording | FIFO state |
| `acc.followup_timeline_v` | follow-up | all of the above joined — what the UI reads |
| `acc.daily_qa_summary_v` | day | the day's numbers, including the four mismatch counts |

---

## Deploying (order matters)

The function writes to columns the migration creates.

**1. Apply the schema.** Supabase SQL editor, or `supabase db push`. Both migrations are idempotent —
applying them to a database that already has the pipeline changes nothing.

**2. Set the secrets** (Supabase → Edge Functions → Secrets). **Two keys, one per half:**
`GEMINI_API_KEY` transcribes and `CHATGPT_API_KEY` judges. Every other secret has a working default.

| Secret | Default | What it does |
| --- | --- | --- |
| `GEMINI_API_KEY` | — | **Required.** Transcription. Never reaches the browser. |
| `CHATGPT_API_KEY` | — | **Required for QA.** The OpenAI key, under the name this project's secret already uses (`OPENAI_API_KEY` is read as a fallback). Without it recordings still transcribe and the assessments queue up — see below. Never reaches the browser. |
| `GEMINI_MODEL` | `gemini-flash-latest` | The transcriber. |
| `CHATGPT_QA_MODEL` | `gpt-4.1` | The judge. `OPENAI_QA_MODEL` and `QA_MODEL` are accepted too. |
| `QA_MAX_TOKENS` | `16000` | Output budget for the QA reply. On a reasoning model the thinking comes out of this too. |
| `OPENAI_BASE_URL` | `https://api.openai.com/v1` | Only for an Azure or gateway endpoint. |
| `APP_TZ_OFFSET_MIN` | `330` | IST. Decides what "yesterday" means. |
| `LOST_CALL_FEED` | the RealtyBucket URL | |
| `MIN_DURATION_SECONDS` | `20` | Ring-out floor, checked against the CRM's own duration before any audio is fetched. `0` sends everything. |
| `MAX_ATTEMPTS` | `3` | Retries per phase. |
| `MAX_STEPS_PER_TICK` | `2` | Phases advanced per cron tick. Still strictly one recording at a time. |

**3. Deploy the function.**

```bash
supabase functions deploy crm-snapshot-qa --project-ref rkxsgtauigjrpcjkmccu --no-verify-jwt
```

`--no-verify-jwt` is **required**: the function does its own auth via `x-sync-secret`, because
pg_cron cannot present a user JWT. Deploying without the flag breaks both cron jobs.

**4. Smoke-test before waiting a day:**

```bash
curl -s -X POST "$SUPABASE_URL/functions/v1/crm-snapshot-qa" -H "Content-Type: application/json" -H "apikey: $ANON_KEY" -H "Authorization: Bearer $YOUR_USER_JWT" -d '{"action":"status"}'
```

Then pull one specific day by hand and work a single recording:

```bash
curl -s -X POST "$SUPABASE_URL/functions/v1/crm-snapshot-qa" -H "Content-Type: application/json" -H "apikey: $ANON_KEY" -H "Authorization: Bearer $YOUR_USER_JWT" -d '{"action":"run","from":"2026-08-30","to":"2026-08-30"}'
```

Actions: `snapshot` · `work` · `run` (both) · `retry` · `status`.

---

## The parts worth understanding

### The response is stored before anything else happens

`doSnapshot` writes `acc.crm_snapshots.raw` — the parsed JSON of exactly what came back — and only
then calls `crm_normalise_snapshot` and `crm_build_queue`, both of which read that stored row and
never the network. So a CRM that changes an hour later cannot alter the day being processed, and the
day can be replayed from storage at any point.

A re-fetch is safe. The response is hashed; identical bytes re-run the normalisation (a no-op) and
change nothing. Different bytes create a **new revision** and mark the previous row `superseded_at`
rather than overwriting it, so "what did the CRM say at midnight" stays answerable.

### Audio is never stored

The recording is fetched from Knowlarity into memory, handed to Gemini as inline base64, and goes out
of scope. OpenAI never receives audio at all — the judge is given the transcript as text. The row
keeps the ~90 byte `recording_url` and nothing else. There is no audio column, no bucket, no blob —
a retry simply re-fetches.

The Knowlarity link 302s to a presigned S3 URL that expires in ~600 seconds, which is exactly why the
*Knowlarity* link is what gets stored and never the redirect target.

### A recording is transcribed once, ever

`acc.call_transcripts.recording_url` is **unique**. Before any audio is fetched, the pipeline looks
the URL up:

- a **completed** row → the queue entry jumps straight to QA, flagged `reused_transcription`. No
  model call, no second bill, and the existing transcript is left untouched.
- a **non_transcribable** row → the entry finishes as `skipped_existing`.

`callid` is stored and unique too, as the stable secondary identity if the URL is ever rewritten.

### Deduplication applies to the work, never to the history

This is the distinction that matters. If lead 708998's follow-up 3192290 carries a recording that was
transcribed yesterday, then today:

- the recording is **not** transcribed again, and
- follow-up 3192290 **still gets its row** in `acc.crm_followups`, and still appears in the lead's
  history on screen, showing the transcript it reused.

`acc.crm_followups` is keyed on the CRM's own `follow_up_id` and is never touched by deduplication.
The lead's complete history is *existing transcripts + the new CRM snapshot*, not one or the other.

### Two model calls, not one — Gemini listens, OpenAI judges

**Stage one transcribes, on Gemini.** It is given the audio and nothing else — no CRM data, no
project figures, no name. That is deliberate: a model that has been told the answer can return it
without listening.

**Stage two judges, on OpenAI** (`gpt-4.1` by default). It is given the transcript as text and the
CRM's own record, side by side, and never sees audio. Because there is no audio in the room and no
transcript field in its output, the project catalogue *can* safely be given to it — the transcript is
already fixed by then.

QA is on OpenAI as of 2026-09-02, by requirement. Both halves ran on Gemini between 2026-08-31 and
that date; before 2026-08-31 the judge was OpenAI (`gpt-4.1`). The transcript half never moved.

**Nothing about the scheduling changed with the vendor move.** Same two cron jobs, same 00:00 IST
snapshot, same one-minute worker window, same FIFO queue, same one-recording-at-a-time, same two
phases. The QA phase calls a different vendor and that is the whole of it — the cron bodies name no
model, so there was nothing to edit there.

**The failure mode this split had the first time is handled.** With no OpenAI key the function used to
refuse `work` outright, so recordings were not even transcribed. Now a missing `CHATGPT_API_KEY` only
**pauses the judge**: `oneStep` drops `qa_pending` out of the claimable set, so transcription keeps
draining in order and the assessments bank up until the key is set. No attempt is consumed and no row
is failed over a key that is simply absent. Both `status` and every `work` reply carry `qa_paused` and
how many transcripts are waiting, because a paused judge is the one state that looks like healthy
progress from outside — recordings keep being transcribed.

A rate limit on one half never re-bills the other: a failure resumes **at the phase that failed**, so
a 429 from OpenAI does not send the audio back through Gemini. That distinction mattered before and
matters more now that the two phases sit with two vendors.

The judge is asked for `json_object` and told the required shape in the prompt, the same arrangement
the transcriber uses. OpenAI's Structured Outputs would mean restating this contract in strict JSON
Schema, and the contract is nullable unions and a `null` member inside an enum — expressible only by
relaxing it, which trades a real guarantee for a nominal one. (Gemini's `responseSchema` could not
express it either, so this is unchanged by the move.) The guarantee therefore lives in `qaPhase`'s
validation: a reply missing any of the five assessments is refused and retried, and nothing
half-formed is ever saved.

`CHATGPT_QA_MODEL` moves the judge. An o-series or gpt-5 name is detected and sent
`max_completion_tokens` with no `temperature`; the 4.x chat models get `max_tokens` and
`temperature: 0`, which is what makes two runs over the same call comparable.

### The content guards, and why they must stay

An earlier design asked one model to listen and judge in a single call, and it quietly stopped
transcribing and started composing. Across **175 calls, the name it claimed to hear matched the CRM's
own record zero times out of the 20 it offered one** — Pradip Das was greeted as "Suman babu". Every
check passed, because every check tested the *shape* of the output.

So shape validation is necessary and not sufficient. Three checks test the *content*:

- **`degenerateRepeat`** — one word repeated over 60% of the time is a recogniser stuck in a loop,
  not a listen.
- **the density floor** — real transcripts of these calls run 6–16 characters per second of audio.
  The failures cluster far below: "Hello." at 0.1, forty-character answers at 0.2 and 0.5. The
  threshold of 1.5 sits in the empty gap, so a genuinely terse call passes and near-silence does not.
- **`name_matches_crm`** — the transcriber is never told the CRM's name, so this stays honest. One
  mismatch is a reason to look. **A run where it almost never agrees is the alarm** — check it after
  any prompt or model change.

Do not remove them.

### What the QA step measures

Five assessments per follow-up, each carrying its own status, its evidence quoted from the transcript,
and its reasoning. "Not Verifiable" is a real answer everywhere and is never penalised — guessing is
the only wrong answer.

| | Statuses | The trap it is written to avoid |
| --- | --- | --- |
| **Pitch accuracy** | Accurate · Partially Accurate · Inaccurate · Not Verifiable | scoring a pitch that never happened. A call cut short is Not Verifiable and scores `null`, not 0 — a zero would drag the day's average down as though the agent had pitched badly. |
| **Follow-up date accuracy** | Accurate · Inaccurate · Not Verifiable | marking a date wrong merely because the customer never named one. No discussion is **Not Verifiable**, never Inaccurate. Only a conversation that *contradicts* the CRM date is Inaccurate. |
| **Lost reason accuracy** | Accurate · Inaccurate · Not Verifiable | inventing a specific reason. "Not interested, thank you" is not evidence of a budget problem. |
| **Remarks accuracy** | Accurate · Partially Accurate · Inaccurate · Not Verifiable | demanding the salesperson's shorthand match word for word. Meaning is judged, not wording. |
| **Status assessment** | Lost · Qualified · In Follow Up · Unclear | deciding from one keyword. "I'm not interested right now" is usually In Follow Up; "send me the details" is usually not Qualified. |

Plus the **six-point agent audit** — Script, Etiquette, Query Handling, Call to Action, Leakage
Avoidance, Hyper-personalization — scored Pass / Partial / Fail / Not Applicable against the explicit
rubric in `_shared/qa-rubric.ts`.

**The audit is done BEFORE the status, not after.** What the agent asked decides what the call is
capable of establishing: an agent who never asked the budget cannot have established that the budget
matches, and a status resting on a question nobody asked is a guess. The prompt is ordered that way
and says so.

### What qualifies a lead

Four requirement gates, recorded in `status_assessment.qualification_check`: **location**, **budget**,
**area (sqft)** and **position** (ready to move vs under construction). All four Match is Qualified;
any Mismatch fails; a gate the call never reached is `Not Established`, which does not qualify a lead
but does not lose it either.

These are not the pitch's `fact_checks`. `fact_checks` asks whether what the **agent said** about the
project was true; `qualification_check` asks whether what the **customer wants** fits the project. A
call can be pitched perfectly to someone who wants a flat this project does not build.

**A site visit is not the test.** Agreeing to one qualifies a lead on its own — but a customer who
passes the four gates and still will not come (busy, travelling, sending a family member, "call me
after the puja") is *still Qualified*. They want to buy; only the visit is unsettled.

### Qualification only moves forward

Once a lead has cleared the bar, a later call can carry it on as **Qualified** or close it as **Lost**.
It cannot go back to **In Follow Up**. Working a qualified lead means a fresh callback date and new
remarks — that is the normal way to do it, and reading it as a downgrade is what produced most of the
false `qualified_should_not_have_been_qualified` flags.

The rule is enforced twice. The prompt is handed a **LEAD HISTORY** block — the lead's earlier calls,
what the CRM logged for each and what any earlier audit concluded — and told the rule in plain words.
Then `deriveStatusMatch` applies it deterministically: an "In Follow Up" verdict on a lead that was
already qualified is lifted back to Qualified before anything is compared or counted. The model's own
untouched answer is kept in `status_assessment.model_assessed_status`, with
`qualification_ratcheted: true` beside it, so the lift is always auditable.

Whether the lead had already qualified comes from `acc.followup_timeline_v.prior_max_status` — the
highest rung it reached *before* this follow-up, from the same view the dashboard's "Status regressed"
tag is derived from, so the two cannot disagree.

**The guard that keeps this honest:** a prior Qualified that an earlier audit already flagged as
`qualified_should_not_have_been_qualified` does **not** earn the ratchet. A lead qualified on no
evidence stays catchable on every call after it; only a qualification that stood up protects the ones
that follow. (One honest gap: an earlier Qualified not yet audited is taken at face value, because
the CRM record is all there is at that point. The queue runs oldest-first, so it is rarely the case.)

**The rubric holds no figures and must never hold any.** Every rule in it is about what the *agent
did* — asked, answered, confirmed, disclosed — so there is no project fact in it for a transcript to
absorb.

### The four mismatch counts

`status_match` and `mismatch_type` are **re-derived by the pipeline** from the CRM status and the
assessed status after the reply arrives. The model is asked for them, because making it commit in
writing is what makes its reasoning legible — but its answer is not what gets counted. A model that
contradicts itself cannot corrupt the dashboard.

| CRM says | The call says | Counted as |
| --- | --- | --- |
| Lost | Qualified or In Follow Up | `lost_should_not_have_been_lost` |
| Qualified | anything else | `qualified_should_not_have_been_qualified` — but never when the lead was already soundly qualified and the call merely set a new callback date; that is lifted to Qualified first and agrees |
| In Follow Up | Lost | `in_followup_should_have_been_lost` |
| In Follow Up | Qualified | `in_followup_should_have_been_qualified` — including a lead already qualified that the agent has logged back as In Follow Up |
| anything | Unclear | **not counted** — an unclear call is not a disagreement |
| Site Visited, OV, … | anything | not counted — outside the four categories |

A `check` constraint on `acc.followup_qa` refuses any other value, so a typo cannot become a fifth
category that no card ever shows.

### FIFO, and what survives a restart

`queue_seq` comes from a Postgres sequence. The worker:

1. Requeues anything eligible for retry — **at the phase that failed**. A QA call that rate-limited
   never re-transcribes; that audio is already transcribed and already paid for.
2. Reclaims rows stuck in `transcribing`/`qa_running` past 15 minutes — a killed invocation, not work
   in flight. **Reclaiming counts as an attempt**, or a recording whose model call always overruns the
   worker limit would be reclaimed and re-billed for ever.
3. **Refuses to start** if anything is genuinely in flight.
4. Claims the lowest `queue_seq` row with a status predicate — that predicate *is* the lock, so two
   overlapping ticks cannot both win and a recording is never paid for twice.
5. Advances it one phase, then stops.

Nothing lives in memory between invocations: the queue *is* the table.

---

## The UI

**Transcription → Automatic Processing.** Four cards — Total Calls, Transcribed, CRM Match, CRM
Mismatch — over the follow-ups in the selected range, with chips for Waiting, No recording, No
conversation and Failed, and counts for QA assessed and *reused an existing transcript*. Filters
combine: date range, CRM status, business unit, and a search over lead id, name and follow-up id.

**Clicking CRM Mismatch** opens the breakdown: the four categories by name, with counts and one line
each on what the disagreement means. Clicking a category filters the table, which switches from one
row per lead to **one row per call** — because a mismatch exists at the level of a conversation, not
a lead — showing the CRM's verdict and the call's verdict side by side.

**Clicking a lead** opens its complete story: the lead as the CRM has it today, an accuracy roll-up
across all its calls, and then **every conversation in chronological order, oldest first**. Each one
carries what the CRM recorded, how it was processed, the four accuracy assessments with their
evidence, the status check, the verdict, the **full transcript** turn by turn with MM:SS timestamps
and speaker labels, and the six-point audit. A call that reused an existing transcript is marked as
such and shows that transcript.

The lead list is newest-first. Inside a lead it is oldest-first: a history only reads forwards.

**Copy Response** puts the lead's stored CRM record on the clipboard. There is no download button
anywhere on this page, by requirement. **Retry** appears on failed calls and resumes at the phase that
failed.

---

## What happened to the old pipeline

`transcription-sync` and `acc.transcriptions` are **still there and still work**. The Manual Upload,
Folders, Deleted, Discrepancies and Compilation tabs read them, as does `transcription/auto/<id>`, so
every row imported before the changeover still opens.

What changed is that its two cron jobs are unscheduled — both pipelines writing at once would
transcribe every recording twice — and the Automatic Processing tab now reads the new tables. The old
shape came from a CRM feed that returned one row per call; the feed now returns one object per lead
with its complete `history` array, which is a different shape and needed a different schema, not a
patch.

---

## Operating it

```sql
-- queue depth and state
select status, fail_phase, count(*) from acc.transcription_queue group by 1,2;

-- the day's numbers, including the four mismatch counts
select * from acc.daily_qa_summary_v order by date desc limit 7;

-- what the last few snapshots did
select id, snapshot_date, revision, status, lead_count, followup_count,
       recording_count, new_recording_count, error_text, fetched_at
from acc.crm_snapshots order by fetched_at desc limit 10;

-- how much deduplication is actually saving
select count(*) as followups_with_recording,
       count(distinct recording_url) as distinct_recordings
from acc.crm_followups where has_recording;

-- is the content check holding up? run this after any prompt or model change
select verification from acc.call_transcripts
where status = 'completed' and first_seen_date = current_date - 1;

-- did cron actually fire
select * from cron.job_run_details order by start_time desc limit 10;
```

**Back-fill a missed day:** `{"action":"run","from":"2026-08-20","to":"2026-08-20"}`. Safe to run
twice — the queue builder skips follow-ups it already holds, and the transcript table skips recordings
it already has.

**Nothing is being worked.** Check, in order: is it inside the worker's window (19:00–05:59 UTC);
`cron.job_run_details` for failures; whether a row is wedged in `transcribing` (it self-clears after
15 minutes); whether `GEMINI_API_KEY` is set; then `{"action":"status"}`.

**Recordings are transcribing but nothing is being assessed.** `{"action":"status"}`, then look at
`chatgpt_key_present` and `qa_paused`. This is the deliberate behaviour when `CHATGPT_API_KEY` is not
set — the transcripts are queued at `qa_pending`, not lost. Set the secret and they are judged in
order on the next tick, with no re-transcription and no second audio bill.

**Everything is failing at once.** Almost always a model name or a key. Which half tells you which
vendor: a `last_error` beginning `Gemini` is the transcriber, `OpenAI QA` is the judge, and
`fail_phase` on the queue row says the same thing. `raw_reply` on a failed `call_transcripts` row
holds the actual reply.

**Every QA call 400s.** A model name and its parameters disagreeing — a reasoning model sent
`max_tokens`, or `temperature` sent to one that refuses it. The name decides this in
`isReasoningModel`; a name outside `o*` / `gpt-5*` that behaves like a reasoning model needs adding
there.

---

## Known trade-offs

- **All CRM statuses are ingested**, not just Lost. "Total Calls" has to be an honest total, and
  `qualified_should_not_have_been_qualified` cannot be counted if Qualified leads are never taken in.
- **Recordings at or under 20 seconds never reach a model.** They are ring-outs, and the CRM's own
  `call_duration` is checked *before* any audio is fetched, so a ring-out costs nothing at all. They
  land as `non_transcribable` with an explicit reason, so they are visible rather than silently
  skipped.
- **The worker only runs 19:00–05:59 UTC** (00:30–11:29 IST). Outside that window the queue does not
  drain. Widen the schedule if a day is ever still going at 11:30 IST.
- **`gemini-flash-latest` is an alias, not a pinned version.** Google repoints it as Flash changes, so
  it cannot 404 the way a pinned name once did — but the model underneath can change with no deploy
  and no warning. That is what the content guards are for.
- **Two vendors means two keys, two rate limits and two status pages.** That is the cost of putting
  the judge on OpenAI, and it is accepted deliberately. What it does *not* cost is a stalled night: a
  missing or rate-limited judge pauses only the judging, never the transcription.
