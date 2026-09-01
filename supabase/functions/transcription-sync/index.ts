// LOST-CALL QA PIPELINE — daily CRM fetch -> FIFO queue -> Gemini -> CRM comparison.
//
// THE SHAPE, in one paragraph. At 00:00 IST a cron calls `pull`, which asks DreamCRM for
// YESTERDAY's lost_call_recordings, stores the raw JSON array verbatim (both as a run payload and
// per-record), and turns each record into a durable processing row. A second cron calls `work`
// every minute, which takes exactly ONE row off the front of the queue, hands the audio to Gemini
// (GEMINI_MODEL, see CONFIG), validates what comes back, saves it, compares it against the CRM's own
// verdict, and stops. Nothing runs in parallel. Nothing is held in memory between invocations.
//
// ONE ROW PER LEAD. A lead that is called more than once keeps ONE row: the newest call is the
// "current" one on the row's own columns, every earlier call is archived into `call_history`, and
// `status_trail` records how the CRM's own verdict moved over time - "Qualified -> Lost". Extra
// calls that arrive while one is still being processed wait in `pending_calls` and rotate in when
// the current call reaches a terminal state. So every detail for a lead lives in a single row.
//
// AUDIO IS NEVER STORED. It is fetched from Knowlarity into memory for exactly one Gemini call and
// then goes out of scope. The row keeps the ~90 byte recording_url and nothing else. Storing the
// audio would be ~4.7 GB/year for no benefit, and re-fetching is free.
//
// WHY THE LOCAL GUARDS EXIST, since the prompt now asks Gemini to both listen and judge in one
// call. An earlier version of exactly this shape quietly stopped transcribing and started
// composing: across 175 calls the name it claimed to hear matched the CRM's own record ZERO times
// out of the 20 it offered one - Pradip Das was greeted as "Suman babu". Every check passed,
// because every check tested the SHAPE of the output. So shape validation is necessary and not
// sufficient. degenerateRepeat(), the chars-per-second density floor and nameMatchesCrm() test the
// CONTENT, and a call that fails them is marked `failed` and retried rather than saved as a
// confident verdict formed on nothing. Do not remove them.
//
// Actions: pull | work | retry | status | run (pull then one work step).
// Auth: acc.job_secrets (a token the DATABASE generated for itself, read by pg_cron) via
// x-sync-secret, or SYNC_SECRET (legacy), or a signed-in user's bearer token.

import { createClient } from "jsr:@supabase/supabase-js@2";
import { encodeBase64 } from "https://deno.land/std@0.224.0/encoding/base64.ts";
import { QA_RUBRIC } from "./qa-rubric.ts";
type DB = ReturnType<typeof createClient>;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-sync-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const j = (o: unknown, status = 200) =>
  new Response(JSON.stringify(o), { status, headers: { "Content-Type": "application/json", ...CORS } });

/* ------------------------------------------------------------------ CONFIG
   Everything sensitive or environment-shaped comes from Secrets. Nothing here is a credential and
   nothing here reaches the browser. */
/* The spec asked for gemini-2.5-pro. Google no longer serves it to this API project - a live call on
   2026-08-27 returned 404 "models/gemini-2.5-pro is no longer available to new users", which is what
   failed 6 of that day's calls. Asked for on 2026-08-28: gemini-flash-latest.
   TWO THINGS TO KNOW ABOUT THIS DEFAULT. It is an ALIAS, not a pinned model - Google repoints it at
   the current Flash whenever that changes, so this line cannot 404 the way a pinned name just did,
   but the model underneath can change without a deploy here and without warning. And Flash is the
   cheaper, weaker tier: this prompt asks one call to both transcribe and judge, and the failure mode
   that shape has already shown once is composing a plausible call instead of transcribing the real
   one. That is precisely what degenerateRepeat(), MIN_CHARS_PER_SECOND and nameMatchesCrm() below
   are for, so watch the name-match agreement rate after any change to this line.
   GEMINI_MODEL in Secrets overrides it without a redeploy, and a per-request `gemini_model` overrides
   both, which is how a candidate model gets tried on one call before it becomes everyone's default. */
const GEMINI_MODEL = Deno.env.get("GEMINI_MODEL") || "gemini-flash-latest";
const FEED_URL = Deno.env.get("LOST_CALL_FEED") || "https://www.realtybucket.com/report/lost_call_recordings";
/* The application timezone, as an offset in minutes. Calls are Indian, so "yesterday" must be
   yesterday in IST: at 18:30 UTC when the cron fires, UTC is still on the previous day. */
const APP_TZ_OFFSET_MIN = Number(Deno.env.get("APP_TZ_OFFSET_MIN") || 330); // +05:30
const APP_TZ_NAME = Deno.env.get("APP_TZ") || "Asia/Kolkata";

const SOURCE = "lost_call_sync";
const JOB_SECRET_NAME = "transcription_sync";

/* Which CRM statuses to ingest. EMPTY MEANS ALL, which is the default: "Total Calls" has to be the
   honest total for the day, and a lead's "Qualified -> Lost" trail cannot be built if the Qualified
   leg was never ingested. Set WANTED_STATUSES to a comma-separated list (e.g. "Lost,In Followup")
   to narrow it again if the Gemini bill argues for it. */
const WANTED_STATUSES = (Deno.env.get("WANTED_STATUSES") || "")
  .split(",").map((s) => s.trim()).filter(Boolean);

/* STRICTLY ONE AT A TIME. Not a tuning knob - the spec requires FIFO with no overlap, and the
   claim-then-process step below depends on it. */
const BATCH = 1;
/* A recording under this many seconds is a ring-out, and paying for a Gemini call to be told so is
   waste. Recorded as non_transcribable with an explicit reason, so it is visible and retryable
   rather than silently skipped. Set to 0 to send everything to Gemini. */
const MIN_DURATION_SECONDS = Number(Deno.env.get("MIN_DURATION_SECONDS") || 60);
const MAX_AUDIO_BYTES = 20 * 1024 * 1024;
/* Automatic retry. An error is usually transient. Bounded so a genuinely broken recording stops
   costing money, and spaced so a rate limit or an outage is not hammered. */
const MAX_ATTEMPTS = Number(Deno.env.get("MAX_ATTEMPTS") || 3);
const RETRY_AFTER_MINUTES = 10;
/* A row left in `processing` past this is a killed invocation, not work in flight. Reclaimed on the
   next tick, which is what makes the queue restart-safe. */
const STALE_PROCESSING_MINUTES = 15;
/* Statuses that mean "this call is already on its way through the queue", so a retry must refuse it
   rather than reorder it underneath the worker. `queued` is in here because rows written before the
   rebuild use that word for what is now `pending`, and a legacy row is exactly the kind that gets
   retried by hand. */
const IN_FLIGHT_STATUSES = ["pending", "processing", "retrying", "queued"];
/* The CRM feed occasionally 502s. Controlled retry policy, per spec 2.7. */
const FEED_ATTEMPTS = 3;
const FEED_BACKOFF_MS = [0, 2000, 6000];

/* What counts as "too thin to be a transcript of THIS recording". Measured, not guessed: real
   transcripts of these calls run 6-16 characters per second of audio, and the failures cluster far
   below - "Hello." at 0.1, and the 40-character answers at 0.2 and 0.5. 1.5 sits in the empty gap
   between the two, so a genuinely terse exchange still passes while near-silence does not. */
const MIN_TRANSCRIPT_CHARS = 120;
const MIN_CHARS_PER_SECOND = 1.5;

/* ------------------------------------------------------------- TEXT REPAIR
   The switchboard, not the conversation. Every call opens with this and it was being written down
   as the agent's first words, which made a two-line call look like a four-line one. */
const IVR_PATTERNS: RegExp[] = [
  /welcome\s+to\s+ja[iy]n\s+group[.,!]?/gi,
  /this\s+call\s+(?:will\s+be|is\s+being)\s+recorded\s+for\s+(?:monitoring\s+and\s+)?(?:training|quality)\s*(?:and\s+training\s*)?purposes?[.,!]?/gi,
  /please\s+wait\s+while\s+we\s+connect\s+your\s+call[.,!]?/gi,
  /please\s+hold\s+while\s+we\s+connect\s+you[.,!]?/gi,
];
function stripIvr(t: string): string {
  let out = String(t || "");
  for (const re of IVR_PATTERNS) out = out.replace(re, " ");
  return out.replace(/[ \t]{2,}/g, " ").trim();
}

/* Kolkata place names as a Bengali speaker says them, which is not how they are written. Pailan
   comes back as "Poylan" every time, so the model is primed with the correct spellings AND these
   are corrected afterwards - priming raises the odds, it does not guarantee them. */
const SPELLINGS: [RegExp, string][] = [
  [/\bpoylan\b/gi, "Pailan"], [/\bpoilan\b/gi, "Pailan"], [/\bpailaan\b/gi, "Pailan"],
  [/\bjhoka\b/gi, "Joka"], [/\bjokha\b/gi, "Joka"],
  [/\bmodhyomgram\b/gi, "Madhyamgram"], [/\bmadhyamgra?am\b/gi, "Madhyamgram"],
  [/\bdoltola\b/gi, "Doltala"], [/\bdoltalla\b/gi, "Doltala"],
  [/\brajarhaat\b/gi, "Rajarhat"], [/\brajarhut\b/gi, "Rajarhat"],
  [/\bbarasaat\b/gi, "Barasat"], [/\bbarashat\b/gi, "Barasat"],
  [/\bnarendrapore\b/gi, "Narendrapur"],
  [/\bgems?\s+group\b/gi, "Jain Group"], [/\bjems?\s+group\b/gi, "Jain Group"],
  [/\bdream\s+gurukool\b/gi, "Dream Gurukul"], [/\bdream\s+exotika\b/gi, "Dream Exotica"],
];
function fixSpellings(t: string): string {
  let out = String(t || "");
  for (const [re, right] of SPELLINGS) out = out.replace(re, right);
  return out;
}

/* One word repeated is a recogniser stuck in a loop, not a listen. Needs 8+ words before it will
   call anything a loop, so a genuine "haan haan haan" is left alone. */
function degenerateRepeat(text: string): { word: string; count: number; total: number } | null {
  const words = String(text || "").toLowerCase().replace(/[^a-zऀ-ॿঀ-৿ ]/g, " ")
    .split(/\s+/).filter(Boolean);
  if (words.length < 8) return null;
  const freq: Record<string, number> = {};
  for (const w of words) freq[w] = (freq[w] || 0) + 1;
  let top = "", n = 0;
  for (const w of Object.keys(freq)) if (freq[w] > n) { n = freq[w]; top = w; }
  return n / words.length > 0.6 ? { word: top, count: n, total: words.length } : null;
}

/* ------------------------------------------------------------ THE CATALOGUE
   VOCABULARY for the judging half, never content. Given this list and a hard recording, an earlier
   version returned "2 BHK starts from 57 lakh and 3 BHK starts from 80 lakh" - the list's own
   figures, on a call about neither. The prompt below says so explicitly, twice. */
const CATALOGUE = `Jain Group projects, for reference when READING the conversation (never to fill in
anything the audio does not contain):
- Dream Gurukul: 3BHK from 80 lakh, 2BHK from 57 lakh. UNDER CONSTRUCTION. Doltala, Madhyamgram / near Airport. Possession 2027/2028.
- Dream World City: 2BHK 29 lakh, 3BHK 36 lakh. READY TO MOVE. Near Joka Metro / Pailan More.
- Dream Valley: 3BHK 73 lakh (no 2BHK). READY TO MOVE. Siliguri, Hill Cart Road, Dagapur.
- Dream Eco City: 2BHK 34 lakh, 2.5BHK 39 lakh. READY TO MOVE. Durgapur, Muchipara, NH-2.
- Dream Exotica: 2BHK 36 lakh, 3BHK 44 lakh. READY TO MOVE. Madhyamgram, Badu Road.
- Dream One: Rajarhat, opposite Eco Park.
- Dream Residency Manor.`;

/* ------------------------------------------------------------------ PROMPT
   Section 5 of the specification, verbatim in structure, with the application's own field
   definitions filled into TASK 2 and TASK 3 where the spec says "use the exact existing dashboard
   field definitions / QA evaluation points already configured in the application". */
const QA_PROMPT = `### ROLE
You are an expert Sales Quality Assurance Analyst for JainGroup, a Kolkata real-estate developer.

### CRITICAL PRE-CHECK - READ FIRST
Before performing any other task, listen to the complete audio.
Determine whether there is an actual human conversation between an Agent and a Customer.
If the call contains ONLY one or more of the following:
- Ringing
- Caller tune
- Busy signal
- Switch-off message
- IVR recording
- Automated system message
- Silence
- No meaningful human conversation between an Agent and Customer
STOP IMMEDIATELY.
In this case, return ONLY the following valid JSON structure and nothing else:
{
  "status": "Non-Transcribable",
  "reason": "[Specific reason such as Caller Tune, Busy, Switch Off, IVR, Silence, or No Conversation]",
  "transcript": [],
  "dashboard_fields": null,
  "qa_evaluation": [],
  "summary_verdict": "Call discarded due to lack of human conversation."
}
Do not invent a conversation.
IMPORTANT: ringing, a caller tune or the recorded IVR greeting AT THE START is normal and is NEVER
on its own a reason to stop - skip past it and check whether people speak after it. Only call the
recording non-transcribable if there is no human conversation ANYWHERE in it.

### TASK 1 - END-TO-END TRANSCRIPTION
Only if a real human conversation exists:
Transcribe the COMPLETE audio from beginning to end.
Requirements:
- Preserve the ORIGINAL spoken language.
- Do not translate the conversation unless specifically requested in another field.
- Support Hindi, English, Bengali, and code-switching between these languages.
- Maintain strict speaker diarization.
- Identify speakers as "Agent" and "Customer" whenever possible.
- Include timestamps in MM:SS format for every speaker turn.
- Do not omit important conversation segments.
- Do not summarize instead of transcribing.
- The transcript must represent the complete conversation.
- WRITE DOWN EVERY WORD SPOKEN. Keep every "hello", "haan", "achha", "ji", every repetition and
  false start. Do not tidy, merge or shorten. Eight minutes of audio means dozens of turns.
- Where you truly cannot make out a phrase, write [inaudible] in its place and carry on. That is
  for gaps, never for a whole call.
- NEVER invent a name, a figure, a location or a project you did not hear.

Kolkata place names are said in Bengali and written differently: Pailan (heard as "Poylan"), Joka,
Madhyamgram, Doltala, Rajarhat, Barasat, Narendrapur, Chinar Park. The developer is "Jain Group" -
"Gems Group" or "Jems Group" is a mishearing.

The transcript must be returned as a JSON array, for example:
[
  { "timestamp": "00:05", "speaker": "Agent", "text": "..." },
  { "timestamp": "00:12", "speaker": "Customer", "text": "..." }
]

### TASK 2 - DASHBOARD FIELD MAPPING
Analyze the complete conversation and extract the dashboard fields configured in this application.
Base every value ONLY on the actual conversation. Do not guess. Where the information is not in the
audio, return null or "None" as indicated.

${CATALOGUE}

"dashboard_fields": {
  "number_asked": "Yes" or "No" - did the agent ask for or confirm a contact number,
  "pincode_provided": the pincode if one was given, else "None",
  "lead_category": EXACTLY one of 'Not Interested','Qualified','Interested Not Qualified','Interested Site Visit','Interested in Booking',
  "lost_reason": why this lead did not progress, or "None",
  "project_discussed": the project actually named in the conversation, else "Unclear"
}

"criteria": six booleans, true ONLY where the conversation establishes it:
  "site_visit_interested" - the customer agreed to a site visit or asked for one
  "location_match"        - the location they want is one JainGroup builds in
  "bhk_match"             - the configuration they want is available
  "budget_match"          - their budget fits the project discussed
  "ready_move_match"      - ready-to-move vs under-construction matches what was offered
  "follow_up_requested"   - they did not decide but asked to be contacted again ("call me later",
                            "I am busy", "call me next week"), or a callback time was agreed. FALSE
                            if they said they have no requirement, have already bought, or are
                            simply not interested - that is a closed lead, not a pending one.

"customer_name": the customer's name ONLY if it is actually spoken in the audio, else ""
"project_discussed": the project actually named in the audio, else "Unclear"
"languages": which of "Hindi", "Bengali", "English" actually appear

### TASK 3 - AGENT QA AUDIT
Evaluate the Agent against the six QA points configured in this application. Return
"qa_evaluation" as an array of six objects, each {"point","status","evidence","notes"}, where
"status" is exactly "Pass", "Fail" or "Partial" and "evidence" quotes the conversation.
Use these exact six names, in this order: Script, Etiquette, Query Handling, Call to Action,
Leakage Avoidance, Hyper-personalization.

${QA_RUBRIC}

The rubric above describes AGENT BEHAVIOUR only and states no fact about any project. Nothing in it
may appear in the transcript, in "dashboard_fields" or in "criteria".
Do not give credit for actions that did not occur. Do not invent statements that are not in the
audio. If something never arose because the customer ended the call early, say so in "notes" rather
than failing the agent for it.

### TASK 4 - FINAL VERDICT
"summary_verdict": several sentences - what the customer wanted, how the agent handled it, what was
agreed, and what the agent should have done differently. If the call was only a few words, say that
plainly instead of padding it out.

### OUTPUT FORMAT - STRICT
Return ONLY valid JSON.
Do not return:
- Markdown
- Markdown code fences
- Explanations outside JSON
- Comments
- Additional text before or after the JSON
If the call is non-conversational, return the exact "Non-Transcribable" structure above.
If the call contains a conversation, return:
{
  "status": "Completed",
  "reason": null,
  "transcript": [ { "timestamp": "MM:SS", "speaker": "Agent", "text": "..." } ],
  "dashboard_fields": { },
  "criteria": { },
  "customer_name": "",
  "project_discussed": "",
  "languages": [],
  "qa_evaluation": [ ],
  "summary_verdict": ""
}`;

/* --------------------------------------------------------------- TIME / IDs */
const nowIso = () => new Date().toISOString();
const appNow = () => new Date(Date.now() + APP_TZ_OFFSET_MIN * 60e3);
const appToday = () => appNow().toISOString().slice(0, 10);
/* Yesterday in the APPLICATION timezone, computed at call time. Never hardcoded, never derived from
   UTC's idea of the date. */
const appYesterday = () => new Date(appNow().getTime() - 864e5).toISOString().slice(0, 10);
const isDate = (s: unknown) => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);

/* FIFO ordering. A Postgres sequence hands out strictly increasing numbers, so the order the CRM
   returned its records in survives pulls, retries, overlapping ticks and restarts - which a
   max(queue_seq)+1 read could not promise. Reserves a block of n and returns the FIRST number in
   it. If the function is somehow unavailable, a millisecond-based number is still monotonic and
   still orders correctly, so the queue degrades rather than breaking. */
async function reserveQueueSeq(db: DB, n: number): Promise<number> {
  const { data, error } = await db.rpc("next_transcription_queue_block", { n: Math.max(1, n) });
  const first = Number(data);
  return (error || !Number.isFinite(first)) ? Date.now() * 1000 : first;
}

/* Duration without decoding. Knowlarity sends CBR MPEG 2.5 Layer III, 16 kbps, 8 kHz mono, so bytes
   over bitrate is exact enough - verified against a real 166,752 byte file that came to 83.4s. The
   feed sends no duration, so this is the only way to apply the ">1 minute" rule.
   NOTE it measures the FILE, which includes ringing and post-hangup silence. null never fails. */
const BR_V1 = [0,32,40,48,56,64,80,96,112,128,160,192,224,256,320,0];
const BR_V2 = [0,8,16,24,32,40,48,56,64,80,96,112,128,144,160,0];
const SAMPLE_RATES: Record<number, number[]> = { 3:[44100,48000,32000], 2:[22050,24000,16000], 0:[11025,12000,8000] };
function estimateDurationSeconds(b: Uint8Array): number | null {
  let off = 0;
  if (b.length > 10 && b[0] === 0x49 && b[1] === 0x44 && b[2] === 0x33) {
    off = 10 + (((b[6]&0x7f)<<21)|((b[7]&0x7f)<<14)|((b[8]&0x7f)<<7)|(b[9]&0x7f));
  }
  const limit = Math.min(b.length - 4, off + 0x20000);
  for (let i = off; i < limit; i++) {
    if (b[i] !== 0xff || (b[i+1] & 0xe0) !== 0xe0) continue;
    const version = (b[i+1] >> 3) & 3, layer = (b[i+1] >> 1) & 3;
    if (version === 1 || layer === 0) continue;
    const brIdx = (b[i+2] >> 4) & 15, srIdx = (b[i+2] >> 2) & 3;
    if (brIdx === 0 || brIdx === 15 || srIdx === 3) continue;
    const kbps = (version === 3 ? BR_V1 : BR_V2)[brIdx];
    const sr = SAMPLE_RATES[version]?.[srIdx];
    if (!kbps || !sr) continue;
    return Math.round(((b.length - i) * 8) / (kbps * 1000));
  }
  return null;
}

/* ------------------------------------------------------------------- FEED */
type FeedRow = Record<string, unknown>;
// The feed writes absence as text rather than as null, and not always the same text.
const FEED_BLANKS = ["none", "null", "undefined", "na", "n/a", "-", ""];
function feedText(v: unknown): string | null {
  const s = String(v ?? "").trim();
  return FEED_BLANKS.includes(s.toLowerCase()) ? null : s;
}
/* The CRM's own verdict. It sends "lost" and "In Followup" - inconsistent casing, so it is
   normalised here rather than at every place that reads it. An unrecognised value is kept as-is
   instead of dropped, so a new status shows up on screen as itself rather than silently blank. */
const CRM_STATUSES: Record<string, string> = {
  "lost": "Lost", "in followup": "In Followup", "followup": "In Followup", "follow up": "In Followup",
  "qualified": "Qualified", "sit visited": "Sit Visited", "site visited": "Sit Visited", "ov": "OV",
};
function crmStatusFrom(v: unknown): string | null {
  const s = feedText(v);
  return s ? (CRM_STATUSES[s.toLowerCase()] || s) : null;
}
/* What each recording is called: "Full Name_Lead Id", or the lead id on its own when the CRM has no
   name. The lead id is always sent, so a recording can never end up nameless. */
function recordingName(name: string | null, leadId: number): string {
  const clean = String(name || "").replace(/[\\/:*?"<>|]+/g, " ").replace(/\s+/g, " ").trim();
  return clean ? clean + "_" + leadId : String(leadId);
}
/* The stable per-call identity. lead_id alone is the LEAD; lead_id + callid is the CALL, which is
   what deduplication has to key on so a second call to the same person is new work and a re-run of
   the same day is not. */
const callUuidFrom = (url: string) => url.match(/callid=([0-9a-fA-F-]{36})/)?.[1] ?? null;
const callKeyOf = (leadId: number, uuid: string | null, url: string | null) =>
  `${leadId}:${uuid || url || "norec"}`;

type Check = { check: string; status: "pass" | "fail" | "skip"; detail: string };

/* ------------------------------------------------- DERIVED STATUS + COMPARISON
   The transcription-derived status, in the CRM's own vocabulary so the two can be compared at all.
   Three outcomes, not two: a customer who asked to be called back has neither matched nor been
   lost, and forcing them into "lost" is how a live lead gets written off. */
const HIGH_INTENT = ["qualified", "interested site visit", "interested in booking"];
function derivedStatusFrom(category: string | null, crit: Record<string, boolean> | null): string | null {
  const c = String(category || "").trim().toLowerCase();
  if (!c) {
    if (crit?.follow_up_requested) return "follow_up";
    return null;
  }
  if (c === "not interested") return "lost";
  if (HIGH_INTENT.includes(c)) return "qualified";
  if (c === "interested not qualified") return crit?.follow_up_requested ? "follow_up" : "lost";
  return null;
}
const CRM_TO_DERIVED: Record<string, string> = {
  "lost": "lost", "in followup": "follow_up", "qualified": "qualified",
  "sit visited": "qualified", "ov": "qualified",
};
/* MATCH / MISMATCH / NOT_COMPARABLE. NOT_COMPARABLE is a real answer, not a failure to answer: a
   call with no conversation in it cannot agree or disagree with the CRM, and counting it as a match
   would inflate the only number on the dashboard anyone acts on. */
function compareWithCrm(crmStatus: string | null, derived: string | null, processing: string):
  { comparison_status: string; comparison_reason: string } {
  if (processing === "non_transcribable") {
    return { comparison_status: "NOT_COMPARABLE",
      comparison_reason: "The recording holds no human conversation, so there is nothing to compare against the CRM's verdict." };
  }
  if (processing !== "completed") {
    return { comparison_status: "NOT_COMPARABLE",
      comparison_reason: "This call has not been transcribed yet, so no comparison has been made." };
  }
  if (!crmStatus) {
    return { comparison_status: "NOT_COMPARABLE",
      comparison_reason: "The CRM feed sent no status for this lead." };
  }
  if (!derived) {
    return { comparison_status: "NOT_COMPARABLE",
      comparison_reason: "The conversation did not establish a clear outcome, so no status could be derived from it." };
  }
  const crmDerived = CRM_TO_DERIVED[crmStatus.toLowerCase()];
  if (!crmDerived) {
    return { comparison_status: "NOT_COMPARABLE",
      comparison_reason: `CRM status "${crmStatus}" is not one this report has sent before, so it was not checked against the call.` };
  }
  if (crmDerived === derived) {
    return { comparison_status: "MATCH",
      comparison_reason: `CRM has this lead as "${crmStatus}" and the call agrees - the conversation reads as "${derived}".` };
  }
  // The two disagree in opposite directions, and both are worth surfacing.
  if (crmDerived === "lost" && derived === "qualified") {
    return { comparison_status: "MISMATCH",
      comparison_reason: `CRM marked this lead Lost, but the call shows buying intent. This lead was written off while still active and should be re-opened.` };
  }
  if (crmDerived === "lost" && derived === "follow_up") {
    return { comparison_status: "MISMATCH",
      comparison_reason: `CRM marked this lead Lost, but on the call the customer asked to be contacted again - it is a pending lead, not a closed one.` };
  }
  if (crmDerived === "follow_up" && derived === "lost") {
    return { comparison_status: "MISMATCH",
      comparison_reason: `CRM still has this lead In Followup, but on the call the customer said they are not interested - the team is chasing a lead that is already closed.` };
  }
  if (crmDerived === "qualified" && derived === "lost") {
    return { comparison_status: "MISMATCH",
      comparison_reason: `CRM has this lead as "${crmStatus}", but the call reads as a customer who is not interested.` };
  }
  return { comparison_status: "MISMATCH",
    comparison_reason: `CRM has this lead as "${crmStatus}" (${crmDerived}) but the call reads as "${derived}".` };
}

/* The three-way outcome the existing dashboard renders, from the SAME criteria, by the same rule it
   prints, so the panel and the badge cannot disagree. Order matters - a firm yes outranks a maybe,
   and a maybe outranks nothing. */
const CRIT_KEYS = ["site_visit_interested","location_match","bhk_match","budget_match","ready_move_match","follow_up_requested"];
function normaliseCriteria(v: unknown): Record<string, boolean> | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const out: Record<string, boolean> = {};
  for (const k of CRIT_KEYS) out[k] = (v as any)[k] === true;
  return out;
}
function qualifyFrom(c: Record<string, boolean> | null) {
  if (!c) return { qualification: null as string | null, why: "" };
  const core = ["location_match","bhk_match","budget_match","ready_move_match"];
  const met = core.filter((k) => c[k]);
  if (c.site_visit_interested || met.length === core.length) {
    return { qualification: "Qualified",
      why: c.site_visit_interested ? "The customer agreed to a site visit." : "Location, configuration, budget and possession all matched." };
  }
  if (c.follow_up_requested) {
    return { qualification: "Follow-Up", why: "The customer did not decide but asked to be contacted again." };
  }
  return { qualification: "Not Qualified",
    why: met.length ? `Only ${met.length} of ${core.length} requirements matched.` : "None of the requirements matched." };
}
function qaScoreFor(qa: unknown): number | null {
  if (!Array.isArray(qa) || !qa.length) return null;
  let got = 0;
  for (const p of qa as any[]) {
    const s = String(p?.status || "").toLowerCase();
    if (s === "pass") got += 1; else if (s === "partial") got += 0.5;
  }
  return Math.round((got / (qa as any[]).length) * 100);
}
function languagesFrom(v: unknown): string[] | null {
  if (!Array.isArray(v)) return null;
  const map: Record<string, string> = { hindi: "hi", english: "en", bengali: "bn", bangla: "bn", hi: "hi", en: "en", bn: "bn" };
  const out = Array.from(new Set(v.map((x) => map[String(x).trim().toLowerCase()]).filter(Boolean)));
  return out.length ? out : null;
}

/* ----------------------------------------------------- TRANSCRIPT RENDERING
   The turns Gemini returns, kept as given and also flattened to plain text so the existing detail
   view, the search box and the density check all keep working on `transcript`. */
type Turn = { timestamp: string; speaker: string; text: string };
function normaliseTurns(v: unknown): Turn[] {
  if (!Array.isArray(v)) return [];
  const out: Turn[] = [];
  for (const t of v as any[]) {
    if (!t || typeof t !== "object") continue;
    const text = fixSpellings(stripIvr(String(t.text ?? "")));
    if (!text) continue;
    const rawSpeaker = String(t.speaker ?? "").trim();
    const speaker = /agent/i.test(rawSpeaker) ? "Agent"
      : /customer/i.test(rawSpeaker) ? "Customer"
      : (rawSpeaker || "Speaker");
    const ts = String(t.timestamp ?? "").trim();
    out.push({ timestamp: /^\d{1,2}:\d{2}(:\d{2})?$/.test(ts) ? ts : "", speaker, text });
  }
  return out;
}
const flattenTurns = (turns: Turn[]) =>
  turns.map((t) => (t.timestamp ? `[${t.timestamp}] ` : "") + t.speaker + ": " + t.text).join("\n");
const plainText = (turns: Turn[]) => turns.map((t) => t.text).join(" ");

/* ------------------------------------------------------------ GEMINI OUTPUT
   Gemini is asked for bare JSON and asked again via responseMimeType, and still occasionally wraps
   it in a fence. Unwrapping a fence is not "accepting invalid JSON" - the JSON inside is either
   valid or it is not, and if it is not, this returns null and the attempt FAILS. */
function parseGeminiJson(raw: string): any | null {
  let s = String(raw || "").trim();
  if (s.startsWith("```")) s = s.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
  if (!s) return null;
  try { return JSON.parse(s); } catch { /* fall through */ }
  // A single trailing brace short, or trailing prose after the object: take the outermost braces.
  const a = s.indexOf("{"), b = s.lastIndexOf("}");
  if (a >= 0 && b > a) { try { return JSON.parse(s.slice(a, b + 1)); } catch { /* give up */ } }
  return null;
}

/* SHAPE validation. Necessary, and - as the header says - not sufficient; the content guards in
   processOne are the other half. */
function validateGemini(p: any): { ok: true; nonTranscribable: boolean } | { ok: false; why: string } {
  if (!p || typeof p !== "object" || Array.isArray(p)) return { ok: false, why: "the reply was not a JSON object" };
  const st = String(p.status || "").trim().toLowerCase();
  if (st === "non-transcribable" || st === "non_transcribable") {
    if (!feedText(p.reason)) return { ok: false, why: 'status was "Non-Transcribable" but no reason was given' };
    return { ok: true, nonTranscribable: true };
  }
  if (st !== "completed") return { ok: false, why: `unrecognised status "${p.status}"` };
  if (!Array.isArray(p.transcript) || !p.transcript.length) {
    return { ok: false, why: 'status was "Completed" but the transcript array was empty' };
  }
  if (!Array.isArray(p.qa_evaluation)) return { ok: false, why: "qa_evaluation was not an array" };
  return { ok: true, nonTranscribable: false };
}

/* ============================================================ PULL (daily) */
async function fetchFeed(from: string, to: string): Promise<{ rows: FeedRow[]; raw: unknown }> {
  let lastErr = "";
  for (let i = 0; i < FEED_ATTEMPTS; i++) {
    if (FEED_BACKOFF_MS[i]) await new Promise((r) => setTimeout(r, FEED_BACKOFF_MS[i]));
    try {
      const res = await fetch(`${FEED_URL}?from=${from}&to=${to}`, { headers: { Accept: "application/json" } });
      if (!res.ok) throw new Error(`feed returned ${res.status}`);
      const body = await res.json();
      if (!Array.isArray(body)) throw new Error("feed did not return a JSON array");
      return { rows: body as FeedRow[], raw: body };
    } catch (e) {
      lastErr = String((e as any)?.message || e);
    }
  }
  throw new Error(lastErr || "feed fetch failed");
}

async function doPull(db: DB, from: string, to: string, trigger: string) {
  let feed: FeedRow[], raw: unknown;
  try {
    const got = await fetchFeed(from, to);
    feed = got.rows; raw = got.raw;
  } catch (e) {
    /* Logged in both places on purpose: the run log is the operational history, and a failed job row
       is what makes "we have nothing for the 26th" visible next to the days that worked, rather than
       the day simply being absent. */
    const error_text = String((e as any)?.message || e).slice(0, 500);
    await db.schema("acc").from("lost_call_sync_runs").insert({
      from_date: from, to_date: to, trigger, error_text, attempts: FEED_ATTEMPTS });
    await db.schema("acc").from("transcription_jobs").insert({
      job_date: from, trigger, status: "failed", error_text, completed_at: nowIso() });
    return j({ error: "feed fetch failed after " + FEED_ATTEMPTS + " attempts: " + error_text }, 502);
  }

  /* THE ORIGINAL RESPONSE, STORED VERBATIM, BEFORE ANY TRANSCRIPTION STARTS. An edge function has no
     filesystem between invocations, so "temporarily as JSON" means a row: acc.transcription_jobs
     exists for exactly this and was never wired up. The payload is cleared once the day's queue
     drains (see clearFinishedJobPayloads) - the durable audit is per-row original_crm_response,
     which is what the Copy Response button hands back. */
  const { data: job } = await db.schema("acc").from("transcription_jobs").insert({
    job_date: from, trigger, payload: raw as any, feed_rows: feed.length, status: "fetched",
  }).select("job_date").maybeSingle();
  if (!job) {
    console.warn("could not park the raw feed payload for " + from + " - continuing");
  }
  const { data: run } = await db.schema("acc").from("lost_call_sync_runs").insert({
    from_date: from, to_date: to, trigger, feed_rows: feed.length,
  }).select("id").single();
  const runId = run?.id ?? null;

  const seen = new Set<string>();
  type Prepared = {
    leadId: number; key: string; uuid: string | null; url: string | null;
    crm: string | null; name: string | null; crmRow: FeedRow; order: number;
  };
  const prepared: Prepared[] = [];
  let skippedStatus = 0, noRecording = 0;

  feed.forEach((row, idx) => {
    const leadId = Number((row as any).lead_id) || null;
    if (!leadId) return;
    const crm = crmStatusFrom((row as any).status);
    if (WANTED_STATUSES.length && (!crm || !WANTED_STATUSES.includes(crm))) { skippedStatus++; return; }
    const url = feedText((row as any).recording_url);
    const uuid = url ? callUuidFrom(url) : null;
    const key = callKeyOf(leadId, uuid, url);
    // The feed repeats rows, and sends exact duplicates when recording_url is "None".
    if (seen.has(key)) return;
    seen.add(key);
    if (!url) noRecording++;
    prepared.push({ leadId, key, uuid, url, crm, name: feedText((row as any).lead_name), crmRow: row, order: idx });
  });

  // What we already hold for these leads. ONE ROW PER LEAD, so this is a lead lookup, not a call one.
  const leadIds = Array.from(new Set(prepared.map((p) => p.leadId)));
  const existing = new Map<number, any>();
  for (let i = 0; i < leadIds.length; i += 200) {
    /* The whole row, not a column list. A lead whose current call is finished gets that call folded
       into call_history by archiveCurrent(), and a partial read silently drops whatever it did not
       ask for - the turn-by-turn transcript went missing exactly that way. */
    const { data } = await db.schema("acc").from("transcriptions")
      .select("*")
      .eq("source", SOURCE).is("deleted_at", null).in("lead_id", leadIds.slice(i, i + 200));
    for (const r of data || []) existing.set(Number(r.lead_id), r);
  }

  const TERMINAL = ["completed", "failed", "non_transcribable"];
  let inserted = 0, appendedHistory = 0, queuedBehind = 0, duplicates = 0;
  /* Feed order IS queue order - spec 3. One block reserved for the whole pull, handed out in the
     order the CRM returned the records, so the first record in the response is the first one
     worked. */
  let seq = (await reserveQueueSeq(db, prepared.length)) - 1;
  const nextSeq = () => ++seq;

  for (const p of prepared) {
    const base = {
      source: SOURCE,
      title: recordingName(p.name, p.leadId),
      file_name: recordingName(p.name, p.leadId),
      lead_id: p.leadId,
      customer_name: p.name,
      crm_status: p.crm,
      crm_lost_reason: feedText((p.crmRow as any).lost_reason),
      crm_remarks: feedText((p.crmRow as any).remarks),
      next_follow_up_date: feedText((p.crmRow as any).next_follow_up_date),
      business_unit_name: feedText((p.crmRow as any).business_unit_name),
      project: feedText((p.crmRow as any).business_unit_name),
      recording_url: p.url,
      call_uuid: p.uuid,
      // The complete CRM record for this row, exactly as the API sent it. Spec 11.
      original_crm_response: p.crmRow as any,
      source_date: from,
      report_date: from,
      sync_run_id: runId,
      synced_at: nowIso(),
    };

    const prior = existing.get(p.leadId);

    /* ---- brand new lead ---- */
    if (!prior) {
      const noRec = !p.url;
      const { error } = await db.schema("acc").from("transcriptions").insert({
        ...base,
        status: noRec ? "non_transcribable" : "pending",
        non_transcribable_reason: noRec ? "The CRM feed returned no recording URL for this call." : null,
        comparison_status: "NOT_COMPARABLE",
        comparison_reason: noRec
          ? "There is no recording, so nothing can be compared against the CRM's verdict."
          : "This call has not been transcribed yet, so no comparison has been made.",
        queue_seq: noRec ? null : nextSeq(),
        queued_at: noRec ? null : nowIso(),
        completed_at: noRec ? nowIso() : null,
        attempt_count: 0, attempts: 0,
        processed_call_uuids: p.uuid ? [p.uuid] : [],
        status_trail: p.crm ? [p.crm] : [],
        call_history: [], pending_calls: [],
        verification: [{ check: "recording_present", status: noRec ? "fail" : "pass",
          detail: noRec ? 'The CRM feed returned "None" for this call - there is no recording to transcribe.'
                        : "CRM feed supplied a recording URL." }] satisfies Check[],
      });
      // 23505 is a duplicate key: two overlapping runs, not worth aborting on.
      if (error && error.code !== "23505") {
        await db.schema("acc").from("lost_call_sync_runs")
          .update({ error_text: error.message.slice(0, 500) }).eq("id", runId);
        return j({ error: error.message }, 500);
      }
      if (!error) inserted++;
      /* Re-read so a second call for the same lead in this same feed sees the row we just made.
         Whole row, not a subset: if that second call finds this one already terminal (a
         no-recording row is), archiveCurrent() runs against it, and a partial read would archive a
         mostly-empty entry. */
      const { data: fresh } = await db.schema("acc").from("transcriptions")
        .select("*")
        .eq("source", SOURCE).eq("lead_id", p.leadId).is("deleted_at", null).maybeSingle();
      if (fresh) existing.set(p.leadId, fresh);
      continue;
    }

    /* ---- lead we already hold ---- */
    const known: string[] = Array.isArray(prior.processed_call_uuids) ? prior.processed_call_uuids : [];
    const pendingQ: any[] = Array.isArray(prior.pending_calls) ? prior.pending_calls : [];
    const thisCallId = p.uuid || p.url || null;
    const alreadyKnown = !!thisCallId && (
      known.includes(thisCallId) ||
      prior.call_uuid === p.uuid ||
      pendingQ.some((q: any) => (q.call_uuid || q.recording_url) === thisCallId)
    );
    // Already processed or already queued: a re-run of the same day must change nothing. Spec 2.8.
    if (alreadyKnown || !thisCallId) { duplicates++; continue; }

    const trail: string[] = Array.isArray(prior.status_trail) ? prior.status_trail.slice() : [];
    if (p.crm && trail[trail.length - 1] !== p.crm) trail.push(p.crm);

    if (TERMINAL.includes(String(prior.status))) {
      /* The current call is finished, so it becomes history and this new call takes the row. Every
         detail for the lead stays in this one row - the archived call keeps its own transcript, QA
         and comparison. */
      const archived = archiveCurrent(prior);
      const history = (Array.isArray(prior.call_history) ? prior.call_history : []).concat(archived ? [archived] : []);
      const { error } = await db.schema("acc").from("transcriptions").update({
        ...base,
        status: "pending",
        call_history: history,
        status_trail: trail,
        processed_call_uuids: known.concat([thisCallId]),
        queue_seq: nextSeq(), queued_at: nowIso(),
        processing_started_at: null, completed_at: null,
        attempt_count: 0, attempts: 0, last_error: null, error_text: null,
        // the previous call's result is in call_history now; the row's own result fields reset
        transcript: null, transcript_en: null, transcript_bn: null, utterances: null,
        dashboard_fields: null, criteria: null, qa_evaluation: null, qa_score: null,
        summary_verdict: null, summary: null, qualification: null, reason: null,
        ai_lead_category: null, transcription_status: null, non_transcribable_reason: null,
        gemini_raw: null, languages: null, duration_seconds: null,
        comparison_status: "NOT_COMPARABLE",
        comparison_reason: "This call has not been transcribed yet, so no comparison has been made.",
        mismatch: null, mismatch_severity: null, mismatch_reason: null,
        verification: null, discrepancy: null, has_discrepancy: null,
        updated_at: nowIso(),
      }).eq("id", prior.id);
      if (error) return j({ error: error.message }, 500);
      appendedHistory++;
      existing.set(p.leadId, { ...prior, ...base, status: "pending",
        processed_call_uuids: known.concat([thisCallId]), call_history: history, status_trail: trail, pending_calls: pendingQ });
    } else {
      /* The row is mid-flight. Queue the new call behind it rather than clobbering work in progress
         - it rotates in the moment the current one reaches a terminal state. */
      const q = pendingQ.concat([{ ...base, queued_at: nowIso() }]);
      const { error } = await db.schema("acc").from("transcriptions").update({
        pending_calls: q, status_trail: trail,
        processed_call_uuids: known.concat([thisCallId]),
        updated_at: nowIso(),
      }).eq("id", prior.id);
      if (error) return j({ error: error.message }, 500);
      queuedBehind++;
      existing.set(p.leadId, { ...prior, pending_calls: q, status_trail: trail,
        processed_call_uuids: known.concat([thisCallId]) });
    }
  }

  await db.schema("acc").from("lost_call_sync_runs").update({
    inserted, duplicates, no_recording: noRecording,
    appended_history: appendedHistory, queued_behind: queuedBehind,
  }).eq("id", runId);
  await db.schema("acc").from("transcription_jobs").update({
    queued: inserted + appendedHistory + queuedBehind,
    duplicates, no_recording: noRecording, status: "queued",
  }).eq("job_date", from).is("completed_at", null);

  return { from, to, timezone: APP_TZ_NAME, feed_rows: feed.length, unique_calls: prepared.length,
           inserted, appended_history: appendedHistory, queued_behind: queuedBehind,
           duplicates, no_recording: noRecording, skipped_other_statuses: skippedStatus, run_id: runId };
}

/* A finished call, packed for the history array. Everything that made it a call - the transcript,
   the QA, the verdict, the comparison - travels with it, so nothing is lost when the row moves on
   to the lead's next conversation. */
function archiveCurrent(row: any) {
  /* A call with no recording still happened, and the CRM still had a verdict on it - dropping it
     would put a hole in the lead's trail. Only a genuinely empty row is skipped. */
  if (!row.call_uuid && !row.recording_url && !row.transcript
      && !row.source_date && !row.crm_status) return null;
  return {
    call_uuid: row.call_uuid ?? null,
    recording_url: row.recording_url ?? null,
    source_date: row.source_date ?? row.report_date ?? null,
    crm_status: row.crm_status ?? null,
    processing_status: row.status ?? null,
    transcription_status: row.transcription_status ?? null,
    comparison_status: row.comparison_status ?? null,
    comparison_reason: row.comparison_reason ?? null,
    duration_seconds: row.duration_seconds ?? null,
    transcript: row.transcript ?? null,
    utterances: row.utterances ?? null,
    dashboard_fields: row.dashboard_fields ?? null,
    qa_evaluation: row.qa_evaluation ?? null,
    summary_verdict: row.summary_verdict ?? null,
    non_transcribable_reason: row.non_transcribable_reason ?? null,
    last_error: row.last_error ?? null,
    attempt_count: row.attempt_count ?? null,
    original_crm_response: row.original_crm_response ?? null,
    queued_at: row.queued_at ?? null,
    processing_started_at: row.processing_started_at ?? null,
    completed_at: row.completed_at ?? null,
    archived_at: nowIso(),
  };
}

/* ====================================================== WORK (one at a time) */
async function processOne(db: DB, row: any, geminiKey: string, geminiModel: string) {
  const attempt = Number(row.attempt_count || row.attempts || 0) + 1;
  const checks: Check[] = [{ check: "recording_present", status: "pass", detail: "CRM feed supplied a recording URL." }];

  /* Every terminal write goes through here, so a row can never be left in `processing` and can
     never be marked completed by a path that did not actually produce a result. */
  const finish = async (status: string, extra: Record<string, unknown> = {}, err: string | null = null) => {
    const retryable = status === "failed" && attempt < MAX_ATTEMPTS;
    const errText = err
      ? err.slice(0, 460) + (retryable ? ` [try ${attempt}, will retry]` : ` [try ${attempt}]`)
      : null;
    const patch: Record<string, unknown> = {
      status, attempt_count: attempt, attempts: attempt,
      last_error: errText, error_text: errText,
      verification: checks, updated_at: nowIso(),
      /* completed_at means REACHED A TERMINAL STATE, not "the attempt ended". A failure that is
         going to be retried has not finished, and stamping it would make the dashboard's own
         definition of a finished call untrue. */
      completed_at: retryable ? null : nowIso(),
      ...extra,
    };
    await db.schema("acc").from("transcriptions").update(patch).eq("id", row.id);
    await rotatePending(db, row.id);
    return { id: row.id, lead_id: row.lead_id, status, attempt };
  };

  /* ---- 1. the audio, into memory only ---- */
  let audio: Uint8Array, mimeType = "audio/mpeg";
  try {
    // fetch follows the 302 to Knowlarity's presigned S3 URL, which expires in ~600s - which is why
    // the knowlarity link is what we store, never the redirect target.
    const res = await fetch(row.recording_url);
    if (!res.ok) throw new Error(`recording fetch failed (HTTP ${res.status})`);
    /* Knowlarity serves these as "binary/octet-stream". Passing that through is the bug that caused
       all the earlier trouble: Gemini got an unlabelled blob, could not treat it as audio, and
       answered from the prompt instead. octet-stream needs REPLACING, not exempting. */
    const served = (res.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
    mimeType = /^(audio|video)\/[a-z0-9.+-]+$/.test(served) ? served : "audio/mpeg";
    audio = new Uint8Array(await res.arrayBuffer());
    if (audio.length < 1024) throw new Error(`recording is empty (${audio.length} bytes)`);
    if (audio.length > MAX_AUDIO_BYTES) throw new Error(`recording too large (${Math.round(audio.length/1048576)} MB)`);
  } catch (e) {
    const msg = String((e as any)?.message || e);
    checks.push({ check: "recording_fetched", status: "fail", detail: msg });
    return finish("failed", {
      comparison_status: "NOT_COMPARABLE",
      comparison_reason: "The recording could not be fetched, so there is nothing to compare.",
    }, msg);
  }
  checks.push({ check: "recording_fetched", status: "pass",
    detail: `Fetched ${Math.round(audio.length/1024)} KB of ${mimeType}. The audio is held in memory for this one call and is never stored.` });

  const seconds = estimateDurationSeconds(audio);
  if (MIN_DURATION_SECONDS > 0 && seconds !== null && seconds <= MIN_DURATION_SECONDS) {
    checks.push({ check: "duration_floor", status: "fail",
      detail: `Recording is ~${seconds}s, at or under the ${MIN_DURATION_SECONDS}s floor - almost certainly a ring-out. Not sent to Gemini.` });
    return finish("non_transcribable", {
      duration_seconds: seconds,
      non_transcribable_reason: `Ring-out or unanswered: the recording is only ~${seconds}s, under the ${MIN_DURATION_SECONDS}s floor.`,
      comparison_status: "NOT_COMPARABLE",
      comparison_reason: "The recording holds no human conversation, so there is nothing to compare against the CRM's verdict.",
    });
  }
  checks.push({ check: "duration_floor", status: seconds === null ? "skip" : "pass",
    detail: seconds === null
      ? "Could not read the audio header - sent to Gemini without a duration check."
      : `Recording file is ~${seconds}s (includes ringing and any silence after hang-up).` });

  /* ---- 2. Gemini: pre-check, transcription, dashboard fields, QA, verdict ---- */
  let rawText = "";
  try {
    const gr = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${geminiModel}:generateContent`,
      { method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": geminiKey },
        body: JSON.stringify({
          contents: [{ parts: [
            { text: QA_PROMPT },
            { inline_data: { mime_type: mimeType, data: encodeBase64(audio) } },
          ] }],
          generationConfig: {
            temperature: 0,
            responseMimeType: "application/json",
            // A long call's reply carries the whole transcript plus the QA; left low, it truncates
            // mid-string and the JSON never closes.
            maxOutputTokens: 65536,
          },
        }) });
    const gj = await gr.json().catch(() => ({}));
    if (!gr.ok) throw new Error(`Gemini failed (${gr.status}): ${JSON.stringify(gj).slice(0, 300)}`);
    rawText = String(gj?.candidates?.[0]?.content?.parts?.[0]?.text || "").trim();
    if (!rawText) {
      const why = gj?.candidates?.[0]?.finishReason;
      throw new Error(why ? `Gemini returned no text (finishReason: ${why})` : "Gemini returned nothing");
    }
  } catch (e) {
    const msg = String((e as any)?.message || e);
    checks.push({ check: "gemini_call", status: "fail", detail: msg });
    return finish("failed", {
      comparison_status: "NOT_COMPARABLE",
      comparison_reason: "The transcription step failed, so there is nothing to compare.",
    }, msg);
  }
  // audio goes out of scope here and is never persisted. Only the URL is kept on the row.

  /* ---- 3. validate BEFORE saving anything as a success ---- */
  const parsed = parseGeminiJson(rawText);
  if (!parsed) {
    checks.push({ check: "gemini_json", status: "fail", detail: "The reply was not valid JSON." });
    return finish("failed", {
      // the raw reply is kept for debugging; it is explicitly NOT saved as a transcript
      gemini_raw: rawText.slice(0, 20000), gemini_model: geminiModel,
      comparison_status: "NOT_COMPARABLE",
      comparison_reason: "Gemini's reply could not be parsed, so there is nothing to compare.",
    }, "Gemini did not return valid JSON");
  }
  const shape = validateGemini(parsed);
  if (!shape.ok) {
    checks.push({ check: "gemini_json", status: "fail", detail: shape.why });
    return finish("failed", {
      gemini_raw: rawText.slice(0, 20000), gemini_model: geminiModel,
      comparison_status: "NOT_COMPARABLE",
      comparison_reason: "Gemini's reply did not match the required structure, so there is nothing to compare.",
    }, "invalid Gemini response: " + shape.why);
  }
  checks.push({ check: "gemini_json", status: "pass", detail: "Valid JSON in the required structure." });

  /* ---- 4a. no conversation in the recording ---- */
  if (shape.nonTranscribable) {
    const why = String(parsed.reason || "No conversation").trim();
    checks.push({ check: "human_conversation", status: "fail",
      detail: `Gemini's pre-check found no Agent-Customer conversation: ${why}.` });
    return finish("non_transcribable", {
      duration_seconds: seconds, gemini_model: geminiModel,
      non_transcribable_reason: why,
      summary_verdict: String(parsed.summary_verdict || "Call discarded due to lack of human conversation."),
      summary: String(parsed.summary_verdict || "Call discarded due to lack of human conversation."),
      transcription_status: "non_transcribable",
      comparison_status: "NOT_COMPARABLE",
      comparison_reason: `The recording holds no human conversation (${why}), so there is nothing to compare against the CRM's verdict.`,
      mismatch: null, mismatch_severity: null, mismatch_reason: null,
    });
  }

  /* ---- 4b. a real conversation: the CONTENT guards, then save ---- */
  const turns = normaliseTurns(parsed.transcript);
  const body = plainText(turns);
  const flat = flattenTurns(turns);

  const degen = degenerateRepeat(body);
  if (degen) {
    checks.push({ check: "human_conversation", status: "fail",
      detail: `${degen.count} of ${degen.total} words are just "${degen.word}" repeated - the model got stuck in a loop rather than genuinely hearing this call.` });
    return finish("failed", {
      duration_seconds: seconds, gemini_raw: rawText.slice(0, 20000), gemini_model: geminiModel,
      comparison_status: "NOT_COMPARABLE",
      comparison_reason: "The transcript is a stuck-loop artefact, so no comparison was made.",
    }, `stuck-loop transcription ("${degen.word}" repeated ${degen.count} of ${degen.total} words)`);
  }

  const density = seconds ? body.length / seconds : null;
  const tooThin = body.length < MIN_TRANSCRIPT_CHARS
    || (density !== null && seconds! > MIN_DURATION_SECONDS && density < MIN_CHARS_PER_SECOND);
  if (tooThin) {
    checks.push({ check: "enough_speech", status: "fail",
      detail: `Only ${body.length} characters came back for ~${seconds}s of audio`
        + (density !== null ? ` (${Math.round(density*10)/10} per second, against 6-16 on a real transcript)` : "")
        + ". Too little to be a transcript of this call." });
    return finish("failed", {
      duration_seconds: seconds, gemini_raw: rawText.slice(0, 20000), gemini_model: geminiModel,
      comparison_status: "NOT_COMPARABLE",
      comparison_reason: "The transcript is too thin to be a record of this call, so no comparison was made.",
    }, `transcript too thin: ${body.length} characters for ~${seconds}s of audio`);
  }
  checks.push({ check: "enough_speech", status: "pass",
    detail: `${turns.length} turns, ${body.length} characters for ~${seconds ?? "?"}s of audio`
      + (density !== null ? ` (${Math.round(density*10)/10} per second)` : "") + "." });

  const df = parsed.dashboard_fields && typeof parsed.dashboard_fields === "object" ? parsed.dashboard_fields : null;
  const category = df?.lead_category ? String(df.lead_category) : null;
  const crit = normaliseCriteria(parsed.criteria);
  const qual = qualifyFrom(crit);
  const derived = derivedStatusFrom(category, crit);

  /* Does what was heard agree with what the CRM independently knows? The only check that tests
     CONTENT rather than shape, and the one that exposed the old prompt writing fiction.
     Informational rather than fatal: plenty of agents never say a name, so one mismatch is a reason
     to look. A RUN where it almost never agrees is the alarm. */
  const heardName = String(parsed.customer_name || "").trim();
  const knownName = String(row.customer_name || "").trim();
  if (heardName && heardName.toLowerCase() !== "none" && knownName) {
    const firstOf = (x: string) => (x.toLowerCase().replace(/[^a-z ]/g, " ").trim().split(/ +/)[0] || "");
    const a = firstOf(knownName), b = firstOf(heardName);
    const agrees = !!a && !!b && (a === b || knownName.toLowerCase().includes(b) || heardName.toLowerCase().includes(a));
    checks.push({ check: "name_matches_crm", status: agrees ? "pass" : "fail",
      detail: agrees
        ? `The name heard on the call ("${heardName}") matches the CRM record ("${knownName}").`
        : `The CRM has this lead as "${knownName}" but the call was transcribed as being with "${heardName}". One of the two is wrong; if many calls in a run disagree like this, the transcripts are not reliable.` });
  } else {
    checks.push({ check: "name_matches_crm", status: "skip",
      detail: knownName
        ? "No name was spoken aloud on the call, so there was nothing to check the CRM name against."
        : "The CRM holds no name for this lead, so there was nothing to check against." });
  }

  const cmp = compareWithCrm(row.crm_status, derived, "completed");
  checks.push({ check: "crm_status_match",
    status: cmp.comparison_status === "MATCH" ? "pass" : cmp.comparison_status === "MISMATCH" ? "fail" : "skip",
    detail: cmp.comparison_reason });

  /* The CRM's name for the lead is authoritative; what was heard only fills a gap. */
  const customerName = row.customer_name || (heardName && heardName.toLowerCase() !== "none" ? heardName : null);
  /* The feed's project is where the lead came from, which is not always what the agent pitched - so
     the project NAMED in the conversation wins when there is one, and the feed's is the fallback. */
  const namedProject = String(parsed.project_discussed || df?.project_discussed || "").trim();
  const project = (namedProject && namedProject.toLowerCase() !== "unclear")
    ? namedProject : (row.business_unit_name || null);
  const aiLost = df?.lost_reason && String(df.lost_reason).toLowerCase() !== "none" ? String(df.lost_reason) : null;

  /* The existing Discrepancies tab reads `discrepancy` / `has_discrepancy`; keep them in step with
     the new comparison so that view does not go quiet. */
  const discrepancy: Check[] = [{
    check: "crm_status_match",
    status: cmp.comparison_status === "MISMATCH" ? "fail" : cmp.comparison_status === "MATCH" ? "pass" : "skip",
    detail: cmp.comparison_reason,
  }];
  if (row.crm_lost_reason && derived === "lost" && aiLost) {
    const same = String(row.crm_lost_reason).toLowerCase().slice(0, 12) === String(aiLost).toLowerCase().slice(0, 12);
    discrepancy.push({ check: "lost_reason_match", status: same ? "pass" : "fail",
      detail: `CRM recorded "${row.crm_lost_reason}"; the call reads as "${aiLost}".` });
  }

  return finish("completed", {
    duration_seconds: seconds,
    gemini_model: geminiModel, gemini_raw: null, gladia_id: "gemini",
    utterances: turns,
    transcript: flat, transcript_bn: flat, transcript_en: null,
    languages: languagesFrom(parsed.languages),
    dashboard_fields: df, ai_lead_category: category,
    criteria: crit, qualification: qual.qualification,
    reason: qual.qualification === "Qualified" ? null : (aiLost || qual.why),
    ai_lost_reason: aiLost,
    qa_evaluation: parsed.qa_evaluation || null, qa_score: qaScoreFor(parsed.qa_evaluation),
    summary_verdict: parsed.summary_verdict || null, summary: parsed.summary_verdict || null,
    customer_name: customerName, project,
    transcription_status: derived,
    comparison_status: cmp.comparison_status, comparison_reason: cmp.comparison_reason,
    mismatch: cmp.comparison_status === "MISMATCH" ? true : cmp.comparison_status === "MATCH" ? false : null,
    mismatch_severity: cmp.comparison_status === "MISMATCH"
      ? (derived === "qualified" && String(row.crm_status).toLowerCase() === "lost" ? "high" : "low") : null,
    mismatch_reason: cmp.comparison_reason,
    discrepancy, has_discrepancy: discrepancy.some((c) => c.status === "fail"),
    non_transcribable_reason: null,
  });
}

/* When the current call finishes and another call for the same lead was waiting, rotate it in:
   the finished call goes to history, the waiting one takes the row and re-enters the queue. This is
   what keeps "one row per lead" true without ever losing a call. */
async function rotatePending(db: DB, id: number) {
  const { data: row } = await db.schema("acc").from("transcriptions").select("*").eq("id", id).maybeSingle();
  if (!row) return;
  const q: any[] = Array.isArray(row.pending_calls) ? row.pending_calls : [];
  if (!q.length) return;
  const next = q[0], rest = q.slice(1);
  const archived = archiveCurrent(row);
  const history = (Array.isArray(row.call_history) ? row.call_history : []).concat(archived ? [archived] : []);
  await db.schema("acc").from("transcriptions").update({
    ...next,
    pending_calls: rest, call_history: history,
    status: "pending",
    queue_seq: await reserveQueueSeq(db, 1), queued_at: nowIso(),
    processing_started_at: null, completed_at: null,
    attempt_count: 0, attempts: 0, last_error: null, error_text: null,
    transcript: null, transcript_en: null, transcript_bn: null, utterances: null,
    dashboard_fields: null, criteria: null, qa_evaluation: null, qa_score: null,
    summary_verdict: null, summary: null, qualification: null, reason: null,
    ai_lead_category: null, transcription_status: null, non_transcribable_reason: null,
    gemini_raw: null, languages: null, duration_seconds: null,
    comparison_status: "NOT_COMPARABLE",
    comparison_reason: "This call has not been transcribed yet, so no comparison has been made.",
    mismatch: null, mismatch_severity: null, mismatch_reason: null,
    verification: null, discrepancy: null, has_discrepancy: null,
    updated_at: nowIso(),
  }).eq("id", id);
}

/* Anything worth another go goes back in the queue BEFORE the queue is read, so the ordinary path
   picks it up with no special casing. Also reclaims rows abandoned mid-flight by a killed
   invocation, which is what makes this restart-safe. */
async function promoteRetries(db: DB) {
  const cutoff = new Date(Date.now() - RETRY_AFTER_MINUTES * 60e3).toISOString();
  const stale = new Date(Date.now() - STALE_PROCESSING_MINUTES * 60e3).toISOString();
  let reclaimed = 0;

  const { data: retryRows } = await db.schema("acc").from("transcriptions")
    .update({ status: "retrying", queued_at: nowIso(), updated_at: nowIso() })
    .eq("source", SOURCE).eq("status", "failed").is("deleted_at", null)
    .lt("attempt_count", MAX_ATTEMPTS).lt("updated_at", cutoff)
    .not("recording_url", "is", null).select("id");
  const requeued = (retryRows || []).length;

  /* Reclaiming a killed invocation MUST count as an attempt. It did not, and that was a live
     runaway: a recording whose Gemini call always overruns the 150s edge worker limit (HTTP 546)
     gets killed before `finish` runs, so attempt_count stays where it was, so the cap is never
     reached, so it is reclaimed and re-billed every RETRY_AFTER_MINUTES forever. Counting it here
     is what makes the cap mean something for the one failure mode that never reaches finish().
     Rows already at the cap are left alone and land in `failed` below. */
  const { data: stuckAtCap } = await db.schema("acc").from("transcriptions")
    .update({ status: "failed", processing_started_at: null, completed_at: nowIso(), updated_at: nowIso(),
              last_error: "The attempt was cut off before it finished (edge worker limit) and the retry cap is reached - listen to this recording by hand, or lower the model's latency.",
              error_text: "The attempt was cut off before it finished (edge worker limit) and the retry cap is reached." })
    .eq("source", SOURCE).eq("status", "processing").is("deleted_at", null)
    .gte("attempt_count", MAX_ATTEMPTS).lt("processing_started_at", stale).select("id");

  const { data: stuck } = await db.schema("acc").from("transcriptions")
    .select("id, attempt_count")
    .eq("source", SOURCE).eq("status", "processing").is("deleted_at", null)
    .lt("attempt_count", MAX_ATTEMPTS).lt("processing_started_at", stale);
  for (const s of stuck || []) {
    const n = Number(s.attempt_count || 0) + 1;
    await db.schema("acc").from("transcriptions").update({
      status: "retrying", processing_started_at: null, updated_at: nowIso(),
      attempt_count: n, attempts: n,
      last_error: `Recovered: the previous attempt was cut off before it finished [try ${n}].`,
      error_text: `Recovered: the previous attempt was cut off before it finished [try ${n}].`,
    }).eq("id", s.id);
  }
  reclaimed = (stuck || []).length + (stuckAtCap || []).length;

  return { requeued, reclaimed };
}

async function doWork(db: DB, geminiKey: string, geminiModel: string) {
  const promoted = await promoteRetries(db);

  /* STRICT FIFO: refuse to start anything while a call is genuinely in flight. promoteRetries has
     already released rows abandoned by a killed invocation, so anything still `processing` here is
     a live one. */
  const { count: inFlight } = await db.schema("acc").from("transcriptions")
    .select("id", { count: "exact", head: true })
    .eq("source", SOURCE).eq("status", "processing").is("deleted_at", null);
  if ((inFlight ?? 0) > 0) {
    return { processed: 0, skipped: "a call is already being processed", ...promoted };
  }

  // Front of the queue. queue_seq is handed out in CRM feed order, so this is the first call in.
  const { data: queue, error } = await db.schema("acc").from("transcriptions")
    .select("id")
    .eq("source", SOURCE).in("status", ["pending", "retrying"]).is("deleted_at", null)
    .not("recording_url", "is", null)
    .order("queue_seq", { ascending: true, nullsFirst: false })
    .order("id", { ascending: true })
    .limit(BATCH);
  if (error) return j({ error: error.message }, 500);
  if (!queue || !queue.length) {
    return { processed: 0, remaining: 0, ...promoted };
  }

  /* Claim it. The status predicate is the lock: two overlapping ticks cannot both win, so the same
     recording is never paid for twice. */
  const { data: claimed } = await db.schema("acc").from("transcriptions")
    .update({ status: "processing", processing_started_at: nowIso(), updated_at: nowIso() })
    .eq("id", queue[0].id).in("status", ["pending", "retrying"])
    .select("id, lead_id, recording_url, crm_status, customer_name, business_unit_name, crm_lost_reason, crm_remarks, attempt_count, attempts, source_date")
    .maybeSingle();
  if (!claimed) return { processed: 0, skipped: "another tick claimed it first", ...promoted };

  let result: unknown;
  try {
    result = await processOne(db, claimed, geminiKey, geminiModel);
  } catch (e) {
    /* Never leave a claimed row in `processing`. An unexpected throw is a failed attempt, and it
       must say so on the row or the queue stalls behind it forever. */
    const msg = String((e as any)?.message || e);
    const attempt = Number(claimed.attempt_count || 0) + 1;
    await db.schema("acc").from("transcriptions").update({
      status: "failed", attempt_count: attempt, attempts: attempt,
      last_error: msg.slice(0, 460), error_text: msg.slice(0, 460),
      completed_at: nowIso(), updated_at: nowIso(),
      comparison_status: "NOT_COMPARABLE",
      comparison_reason: "Processing threw before a result was produced, so there is nothing to compare.",
    }).eq("id", claimed.id);
    result = { id: claimed.id, lead_id: claimed.lead_id, status: "failed", error: msg };
  }

  const { count: remaining } = await db.schema("acc").from("transcriptions")
    .select("id", { count: "exact", head: true })
    .eq("source", SOURCE).in("status", ["pending", "retrying"]).is("deleted_at", null);

  if ((remaining ?? 0) === 0) await clearFinishedJobPayloads(db);

  return { processed: 1, remaining: remaining ?? 0, model: geminiModel, ...promoted, result };
}

/* "Temporarily as JSON" - the raw feed is parked so the day can be replayed while it is being
   worked, and dropped once there is nothing left to replay. The durable audit is the per-row
   original_crm_response, which is never cleared; this only releases the duplicate copy of the whole
   array. Runs when the queue empties, so a day is never cleared mid-flight. */
async function clearFinishedJobPayloads(db: DB) {
  const { data: open } = await db.schema("acc").from("transcription_jobs")
    .select("job_date").is("completed_at", null).not("payload", "is", null);
  for (const jobRow of open || []) {
    const day = jobRow.job_date;
    const { count: unfinished } = await db.schema("acc").from("transcriptions")
      .select("id", { count: "exact", head: true })
      .eq("source", SOURCE).eq("source_date", day).is("deleted_at", null)
      .in("status", ["pending", "processing", "retrying"]);
    if ((unfinished ?? 0) > 0) continue;
    await db.schema("acc").from("transcription_jobs")
      .update({ payload: null, status: "completed", completed_at: nowIso() })
      .eq("job_date", day).is("completed_at", null);
  }
}

/* ------------------------------------------------------------------- HTTP */
Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return j({ error: "method not allowed" }, 405);

  const SB = Deno.env.get("SUPABASE_URL")!;
  const SRV = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const SECRET = Deno.env.get("SYNC_SECRET");
  const GEMINI_KEY = Deno.env.get("GEMINI_API_KEY") || "";

  const secretHeader = req.headers.get("x-sync-secret") || "";
  const bearer = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  const db = createClient(SB, SRV);
  let authorized = false, viaCron = false;

  if (secretHeader) {
    // acc.job_secrets has RLS on with no policies, so only the service role can read it.
    try {
      const { data } = await db.schema("acc").from("job_secrets")
        .select("value").eq("name", JOB_SECRET_NAME).maybeSingle();
      if (data?.value && secretHeader === data.value) { authorized = true; viaCron = true; }
    } catch { /* fall through */ }
    if (!authorized && SECRET && secretHeader === SECRET) { authorized = true; viaCron = true; }
  }
  if (!authorized && bearer) {
    const asUser = createClient(SB, Deno.env.get("SUPABASE_ANON_KEY") || SRV, {
      global: { headers: { Authorization: "Bearer " + bearer } } });
    const { data } = await asUser.auth.getUser();
    authorized = !!data?.user;
  }
  if (!authorized) return j({ error: "unauthorized" }, 401);

  let body: any = {};
  try { body = await req.json(); } catch { /* empty body is fine */ }

  const action = String(body.action || "run");
  const trigger = viaCron ? "cron" : "manual";
  /* Previous day in the application timezone, computed now. Never hardcoded. An explicit from/to is
     accepted so a missed day can be back-filled by hand. */
  const from = isDate(body.from) ? body.from : appYesterday();
  const to = isDate(body.to) ? body.to : (isDate(body.from) ? body.from : from);
  if (from > to) return j({ error: "`from` is after `to`" }, 400);
  if (to > appToday()) return j({ error: "`to` is in the future" }, 400);

  const reqModel = String(body.gemini_model || body.model || "").trim();
  if (reqModel && !/^[a-zA-Z0-9._-]{3,60}$/.test(reqModel)) {
    return j({ error: "that does not look like a model name" }, 400);
  }
  const geminiModel = reqModel || GEMINI_MODEL;

  const needsGemini = action === "work" || action === "run" || action === "retry";
  if (needsGemini && !GEMINI_KEY) return j({ error: "GEMINI_API_KEY not configured in Secrets" }, 500);

  try {
    if (action === "status") {
      const counts: Record<string, number> = {};
      for (const st of ["pending","processing","completed","failed","retrying","non_transcribable"]) {
        const { count } = await db.schema("acc").from("transcriptions")
          .select("id", { count: "exact", head: true })
          .eq("source", SOURCE).eq("status", st).is("deleted_at", null);
        counts[st] = count ?? 0;
      }
      const { data: last } = await db.schema("acc").from("lost_call_sync_runs")
        .select("id, from_date, to_date, trigger, feed_rows, inserted, duplicates, no_recording, appended_history, queued_behind, error_text, created_at")
        .order("created_at", { ascending: false }).limit(1).maybeSingle();
      return j({ ok: true, counts, last_run: last || null, model: geminiModel,
                 timezone: APP_TZ_NAME, next_pull_for: appYesterday() });
    }

    if (action === "retry") {
      const id = Number(body.id);
      if (!id) return j({ error: "missing id" }, 400);
      /* LOOK BEFORE WRITING. This used to be a single UPDATE with the conditions folded into its
         WHERE, which meant every refusal came back as one indistinguishable 404 and, worse, that a
         condition nobody had thought of simply was not enforced. Read the row, say exactly what is
         wrong, and only then write.

         REFUSING AN IN-FLIGHT ROW IS THE IMPORTANT ONE. There was no status check at all, so
         retrying a row that was mid-Gemini-call flipped it out of `processing`; doWork counts
         `processing` rows to decide whether anything is in flight, so that count went to zero, the
         next tick claimed the SAME recording, and two invocations transcribed it at once - paid for
         twice, with both racing to write the result. The dashboard only shows Retry on failed rows,
         so this was never reachable by clicking, but `retry` is a plain POST any signed-in user can
         send and the guard belongs on the server, not in the button's render condition.

         A retry asked for by hand does NOT reset attempt_count - the audit trail is the point, and
         spec 12 says increment it, which finish() does when the attempt ends. It goes to the BACK of
         the queue so it cannot starve the day's own calls, and the existing result is left untouched
         until a new one replaces it. */
      const { data: row, error: readErr } = await db.schema("acc").from("transcriptions")
        .select("id, status, deleted_at, recording_url")
        .eq("id", id).eq("source", SOURCE).maybeSingle();
      if (readErr) return j({ error: readErr.message }, 500);
      if (!row) return j({ error: "no such call" }, 404);
      /* doWork's queue skips deleted rows, so requeuing one reports success and then parks it in
         `retrying` where nothing will ever claim it - it just looks stuck forever. */
      if (row.deleted_at) {
        return j({ error: "that call is in the Deleted tab - restore it before retrying" }, 409);
      }
      if (!row.recording_url || row.recording_url === "None") {
        return j({ error: "that call has no recording to transcribe" }, 409);
      }
      if (IN_FLIGHT_STATUSES.includes(String(row.status))) {
        return j({ error: `that call is already ${row.status} - wait for it to finish`, call_status: row.status }, 409);
      }

      const { data, error } = await db.schema("acc").from("transcriptions")
        .update({ status: "retrying", queue_seq: await reserveQueueSeq(db, 1),
                  queued_at: nowIso(), processing_started_at: null, completed_at: null,
                  updated_at: nowIso() })
        .eq("id", id).eq("source", SOURCE).is("deleted_at", null)
        .not("status", "in", `(${IN_FLIGHT_STATUSES.join(",")})`)
        .select("id, status, attempt_count").maybeSingle();
      if (error) return j({ error: error.message }, 500);
      /* Lost the race between the read above and this write - something claimed it in between. */
      if (!data) return j({ error: "that call started processing just now - wait for it to finish" }, 409);
      // Work it immediately if nothing else is in flight; otherwise it waits its turn.
      return j({ ok: true, requeued: id, work: await doWork(db, GEMINI_KEY, geminiModel) });
    }

    if (action === "pull") {
      const pulled = await doPull(db, from, to, trigger);
      return pulled instanceof Response ? pulled : j({ ok: true, action, ...pulled });
    }
    if (action === "work") {
      const worked = await doWork(db, GEMINI_KEY, geminiModel);
      return worked instanceof Response ? worked : j({ ok: true, action, ...worked });
    }
    if (action === "run") {
      const pulled = await doPull(db, from, to, trigger);
      if (pulled instanceof Response) return pulled;
      const worked = await doWork(db, GEMINI_KEY, geminiModel);
      return worked instanceof Response ? worked : j({ ok: true, action, pull: pulled, work: worked });
    }
    return j({ error: `unknown action "${action}"` }, 400);
  } catch (e) {
    return j({ error: String((e as any)?.message || e) }, 500);
  }
});
