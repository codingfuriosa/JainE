// Nightly Lost-Call QA. Pulls DreamCRM's report - recording_url, lead_id, lead_name, lead_mobile,
// business_unit_name and status (Lost | In Followup); still no call duration - then transcribes and
// audits each call. The report covers leads being followed up as well as lost ones, so the AI's own
// verdict (Qualified / Follow-Up / Not Qualified) is checked against the CRM's, and disagreement in
// either direction is what this exists to surface.
//
// AUDIO IS NEVER STORED: it lives in memory for one AI call. We keep the transcript and the ~90 byte
// link, and re-fetch audio live from Knowlarity. Storing it would be ~4.7 GB/year for no benefit.
//
// Two actions, because a day is 40-60 calls and one invocation cannot do them all:
//   pull  queue the day (seconds, no AI) - cron 00:30 IST, half an hour after the day ends
//   work  process a bounded batch      - cron every minute, no-ops when the queue is empty
//   run / retry / status
//
// Callers prove themselves via (1) acc.job_secrets, a token the DATABASE generated for itself, which
// pg_cron reads to build x-sync-secret and this function reads with its service-role key - no human
// ever invents or pastes a password; (2) SYNC_SECRET (legacy); (3) a signed-in user's token.

import { createClient } from "jsr:@supabase/supabase-js@2";
type DB = ReturnType<typeof createClient>;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-sync-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const j = (o: unknown, status = 200) =>
  new Response(JSON.stringify(o), { status, headers: { "Content-Type": "application/json", ...CORS } });

/* Full Flash, by moving alias. Pinned gemini-2.5-flash was retired under this project and failed 65
   of 77 calls; flash-LITE then translated Hindi to English against instruction and wrote one-line
   summaries. An alias cannot be retired the same way. */
const GEMINI_MODEL = Deno.env.get("GEMINI_MODEL") || "gemini-flash-latest";
// Was unset, which means a low default - one of the ways long output gets cut off.
const MAX_OUTPUT_TOKENS = Number(Deno.env.get("GEMINI_MAX_OUTPUT_TOKENS") || 32768);
const FEED_URL = Deno.env.get("LOST_CALL_FEED") || "https://www.realtybucket.com/report/lost_call_recordings";

const SOURCE = "lost_call_sync";
const JOB_SECRET_NAME = "transcription_sync";
const MIN_DURATION_SECONDS = 60;
const MAX_AUDIO_BYTES = 20 * 1024 * 1024;
/* Four calls in flight at once, not two. Each call is a ~2 minute recording that takes the AI 30-60s,
   so at two-at-a-time a 48 call backlog needed two dozen cron ticks - hours. Four fits inside the
   invocation wall clock with room to spare and stays well under the model's rate limit. */
const CONCURRENCY = 4;

const PROMPT = `### ROLE
You are an expert Sales Quality Assurance Analyst for JainGroup, a Kolkata real-estate developer.

### TASK 1: TRANSCRIPT (COMPLETE, IN ENGLISH, WITH THE ORIGINAL KEPT)
Transcribe the ENTIRE audio from the first word to the last. Do not stop early, do not summarise the
later part, do not write "conversation continues". Do not skip or merge turns.

TRANSCRIBE EVERY HUMAN WORD YOU CAN HEAR. Recordings begin with ringing and often carry a caller
tune, an IVR message, background noise or long silences - SKIP those parts, they are not speech, but
they are NEVER a reason to abandon the call. Even a handful of words counts: "hello", "wrong number",
"I am busy" are a real conversation and must be transcribed. Poor line quality, heavy accents,
overlapping voices and half-audible words are all still speech - transcribe your best reading and
note uncertainty in the summary. Never refuse a recording because it is short, noisy or unclear.

Each turn is an object with FOUR keys:
  speaker    "Agent" or "Customer"
  timestamp  MM:SS
  text       the turn TRANSLATED INTO ENGLISH. Always English, even when Hindi or Bengali was spoken.
  original   the turn exactly as spoken, in that language's OWN script - Hindi in Devanagari, Bengali
             in Bengali script. Never romanise: write हाँ जी सर, not "Haan ji sir". If the turn was already
             English, repeat it unchanged.

ONLY if you have listened to the whole recording and there is genuinely not one human word anywhere
in it - purely ringing, tune, IVR or silence from start to finish - return "transcript": [] and put
one short phrase in "no_speech_reason" (for example "Ringing only", "Caller tune only",
"IVR recording only"). Do not use this to skip a call you found hard to hear.

### TASK 2: LANGUAGES
Every language actually spoken, from "Hindi", "Bengali", "English". JSON array, commonest first.

### TASK 3: DASHBOARD FIELDS
number_asked ("Yes"/"No"), pincode_provided (value or "None"), lead_category (EXACTLY one of
'Not Interested','Qualified','Interested Not Qualified','Interested Site Visit','Interested in Booking'),
lost_reason (reason or "None"), customer_name (name or "None"), project_discussed (project or "Unclear").

### TASK 4: QUALIFICATION CRITERIA (booleans - these decide the outcome)
site_visit_interested  the customer agreed to visit a site, or asked to
location_match         the location they want is one JainGroup builds in
bhk_match              the configuration they want (1/2/3 BHK) is available
budget_match           their budget fits the project discussed
ready_move_match       what they want (ready-to-move vs under-construction) matches what was offered
follow_up_requested    the customer did not decide on this call but asked to be contacted again -
                       "call me later", "I am busy right now", "call me next week", "I will think and
                       tell you", or the agent agreed a specific callback time. TRUE only when they
                       left the door open. If they said they have NO requirement, have already bought,
                       or are simply not interested, this is FALSE - that is a closed lead, not a
                       pending one.
Use false when the call gives no evidence either way - do not guess true.

### TASK 5: AGENT QA AUDIT
The 7 criteria below, each "Pass", "Fail" or "Partial". Judge only what is actually in the call; if
something never arose because the customer ended it early, say so in notes rather than a plain Fail.
Script, Etiquette, Query Handling, Call to Action, Leakage Avoidance, Follow-up Accuracy,
Hyper-personalization.

### TASK 6: SUMMARY
summary_verdict: several sentences - what the customer wanted, how the agent handled it, what was
agreed, what the agent should have done differently. Not one line. If the call was only a few words,
say what was said and why it ended there.

### OUTPUT
Return ONLY valid JSON, no markdown fences, no extra fields. "transcript" must be an ARRAY.
{"languages":["Hindi","English"],
 "transcript":[{"speaker":"Agent","timestamp":"00:00","text":"Hello, good morning sir.","original":"हैलो, गुड मॉर्निंग सर।"}],
 "no_speech_reason":null,
 "dashboard_fields":{"number_asked":"Yes/No","pincode_provided":"value or None","lead_category":"...","lost_reason":"... or None","customer_name":"... or None","project_discussed":"... or Unclear"},
 "criteria":{"site_visit_interested":false,"location_match":false,"bhk_match":false,"budget_match":false,"ready_move_match":false,"follow_up_requested":false},
 "qa_evaluation":[{"point":"Script","status":"Pass/Fail/Partial","evidence":"...","notes":"..."}],
 "summary_verdict":"Several sentences."}`;

// Calls are Indian, so "yesterday" must be yesterday in IST - at 19:00 UTC when the cron fires, UTC
// is still on the previous day.
const istToday = () => new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10);
const istYesterday = () => new Date(Date.now() + 5.5 * 3600e3 - 864e5).toISOString().slice(0, 10);
const isDate = (s: unknown) => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);

/* Duration without decoding. Knowlarity sends CBR MPEG 2.5 Layer III, 16 kbps, 8 kHz mono, so bytes
   over bitrate is exact enough - verified against ffprobe within 0.3s, and against a real 166,752
   byte file that came to 83.4s. The feed sends no duration, so this is the only way to apply the
   ">1 minute" rule, and it is what stops us paying to listen to ring-outs.
   NOTE it measures the FILE, which includes ringing and post-hangup silence: an 83s file held 15s of
   talk. So it is a cost gate, not a measure of conversation length. null never fails the gate. */
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

// 8192 stays well under V8's argument-count ceiling for a spread call; larger chunks work today but
// are a latent crash on a longer recording.
function toBase64(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i += 8192) out += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(out);
}

type FeedRow = {
  recording_url?: unknown; lead_id?: unknown; business_unit_name?: unknown;
  lead_name?: unknown; lead_mobile?: unknown; status?: unknown;
};
// The feed writes absence as text rather than as null, and not always the same text.
const FEED_BLANKS = ["none", "null", "undefined", "na", "n/a", "-", ""];
function feedText(v: unknown): string | null {
  const s = String(v ?? "").trim();
  return FEED_BLANKS.includes(s.toLowerCase()) ? null : s;
}
const realUrl = feedText;

/* The CRM's own verdict on the lead, which is a different thing from the AI's. It sends "lost" and
   "In Followup" - inconsistent casing, so it is normalised here rather than at every place that
   reads it. An unrecognised value is kept as-is instead of dropped, so a new status shows up on
   screen as itself rather than silently becoming blank. */
const CRM_STATUSES: Record<string, string> = {
  "lost": "Lost", "in followup": "In Followup", "followup": "In Followup", "follow up": "In Followup",
};
function crmStatusFrom(v: unknown): string | null {
  const s = feedText(v);
  return s ? (CRM_STATUSES[s.toLowerCase()] || s) : null;
}

/* What each recording is called: "Full Name_Lead Id", or the lead id on its own when the CRM has no
   name for the lead. The lead id is always sent, so a recording can never end up nameless.
   Characters that are illegal in a file name are stripped, since this is used as one. */
function recordingName(name: string | null, leadId: number): string {
  const clean = String(name || "").replace(/[\\/:*?"<>|]+/g, " ").replace(/\s+/g, " ").trim();
  return clean ? clean + "_" + leadId : String(leadId);
}
const callUuidFrom = (url: string) => url.match(/callid=([0-9a-fA-F-]{36})/)?.[1] ?? null;

type Check = { check: string; status: "pass" | "fail" | "skip"; detail: string };

/* Does the CRM's verdict match what the call actually contains? The report used to be lost calls
   only; it now also sends leads still In Followup, and the two disagree in opposite directions:
   a Lost lead that wanted to buy was written off too early, while a lead still being chased who
   said no is effort going nowhere. Surfacing both is the point of this dashboard. */
const HIGH_INTENT = ["qualified", "interested site visit", "interested in booking"];
function judgeMismatch(crmStatus: string | null, category: string | null) {
  const st = String(crmStatus || "").toLowerCase();
  const cat = String(category || "").trim(), c = cat.toLowerCase();
  if (!cat) return { mismatch: null, severity: null, reason: null };

  if (st === "lost") {
    if (c === "not interested") {
      return { mismatch: false, severity: null,
        reason: "CRM marked this lead Lost and the call confirms the customer was not interested." };
    }
    if (HIGH_INTENT.includes(c)) {
      return { mismatch: true, severity: "high",
        reason: `CRM marked this lead Lost, but the call shows buying intent - the AI graded it "${cat}". This lead was written off while still active and should be re-opened.` };
    }
    if (c === "interested not qualified") {
      return { mismatch: true, severity: "low",
        reason: "CRM marked this lead Lost. The customer was interested but did not fit current inventory, so closing it is defensible - worth nurturing rather than discarding." };
    }
    return { mismatch: true, severity: "low",
      reason: `CRM marked this lead Lost; the AI returned an unrecognised category "${cat}" - review manually.` };
  }

  if (st === "in followup") {
    if (c === "not interested") {
      return { mismatch: true, severity: "low",
        reason: "CRM still has this lead In Followup, but on the call the customer said they are not interested - the team is chasing a lead that is already closed." };
    }
    return { mismatch: false, severity: null,
      reason: `CRM has this lead In Followup and the call agrees - the AI graded it "${cat}", so it is rightly still open.` };
  }

  return { mismatch: null, severity: null,
    reason: `CRM status "${crmStatus}" is not one this report has sent before, so it was not checked against the call.` };
}

/* THE OUTCOME, from the SAME criteria the dashboard renders, by the same rule it prints, so the panel
   and the badge cannot disagree. Previously this was
   `category === 'not interested' ? 'Not Qualified' : 'Qualified'` and `criteria` was never written at
   all - so the panel showed five red crosses beside a Qualified badge, two unrelated sources.

   Three outcomes, not two. A customer who asked to be called back later has neither matched nor been
   lost, and forcing them into Not Qualified is how a live lead gets written off. Order matters: a
   firm yes outranks a maybe, and a maybe outranks nothing. */
const CRIT_KEYS = ["site_visit_interested","location_match","bhk_match","budget_match","ready_move_match","follow_up_requested"];
function normaliseCriteria(v: unknown): Record<string, boolean> | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const out: Record<string, boolean> = {};
  for (const k of CRIT_KEYS) out[k] = (v as any)[k] === true;
  return out;
}
function qualifyFrom(c: Record<string, boolean> | null) {
  if (!c) return { qualification: null as string | null, why: null as string | null };
  if (c.site_visit_interested) {
    return { qualification: "Qualified", why: "The customer agreed to a site visit." };
  }
  if (c.location_match && c.bhk_match && c.budget_match && c.ready_move_match) {
    return { qualification: "Qualified", why: "Location, configuration, budget and possession timeline all match." };
  }
  if (c.follow_up_requested) {
    return { qualification: "Follow-Up",
      why: "The customer did not decide on this call but asked to be contacted again - still open, not lost." };
  }
  const missing = ([["location_match","location"],["bhk_match","configuration"],
                    ["budget_match","budget"],["ready_move_match","possession timeline"]] as const)
    .filter(([k]) => !c[k]).map(([, label]) => label);
  return {
    qualification: "Not Qualified",
    why: "No site visit was agreed and no callback was asked for" +
         (missing.length ? `; ${missing.join(", ")} did not match` : "") + ".",
  };
}

// Share of the 7 criteria passed, Partial counting as half.
function qaScoreFor(qa: unknown): number | null {
  if (!Array.isArray(qa) || !qa.length) return null;
  let got = 0;
  for (const it of qa) {
    const s = String((it as any)?.status || "").toLowerCase();
    if (s === "pass") got += 1; else if (s === "partial") got += 0.5;
  }
  return Math.round((got / qa.length) * 100);
}

// Flat searchable text for the list/export/detail view. English, since that is what the columns show;
// the original wording stays per-turn in `utterances`.
function flattenTranscript(turns: unknown): string | null {
  if (!Array.isArray(turns) || !turns.length) return null;
  return turns.map((t: any) =>
    `${t?.timestamp ? `[${t.timestamp}] ` : ""}${t?.speaker || "Speaker"}: ${t?.text || t?.original || ""}`
  ).join("\n");
}

// Only the three languages these calls are in, so a hallucinated value cannot reach the column.
const KNOWN_LANGUAGES = ["hindi", "bengali", "english"];
function languagesFrom(v: unknown): string[] | null {
  if (!Array.isArray(v)) return null;
  const out: string[] = [];
  for (const x of v) {
    const s = String(x || "").trim(), k = s.toLowerCase();
    if (KNOWN_LANGUAGES.includes(k) && !out.some((y) => y.toLowerCase() === k)) {
      out.push(k.charAt(0).toUpperCase() + k.slice(1));
    }
  }
  return out.length ? out : null;
}

// ---------------------------------------------------------------- PULL
async function doPull(db: DB, from: string, to: string, trigger: string) {
  let feed: FeedRow[];
  try {
    const res = await fetch(`${FEED_URL}?from=${from}&to=${to}`, { headers: { Accept: "application/json" } });
    if (!res.ok) throw new Error(`feed returned ${res.status}`);
    const body = await res.json();
    if (!Array.isArray(body)) throw new Error("feed did not return a JSON array");
    feed = body;
  } catch (e) {
    const error_text = String((e as any)?.message || e).slice(0, 500);
    await db.schema("acc").from("lost_call_sync_runs").insert({ from_date: from, to_date: to, trigger, error_text });
    return j({ error: "feed fetch failed: " + error_text }, 502);
  }

  // The feed repeats rows, and sends exact duplicates when recording_url is "None". Dedupe so the
  // no-recording rows collapse to one per lead rather than inflating "calls received".
  const seen = new Set<string>();
  const queued: Record<string, unknown>[] = [];
  let noRecording = 0;

  for (const row of feed) {
    const leadId = Number(row.lead_id) || null;
    if (!leadId) continue;
    const bu = row.business_unit_name ? String(row.business_unit_name) : null;
    const rec = realUrl(row.recording_url);
    // Straight from the CRM, so these are facts rather than the AI's reading of the audio.
    const nm = feedText(row.lead_name);
    const mob = feedText(row.lead_mobile);
    const crm = crmStatusFrom(row.status) || "Lost";
    const label = recordingName(nm, leadId);

    if (!rec) {
      const key = `norec:${leadId}`;
      if (seen.has(key)) continue;
      seen.add(key); noRecording++;
      queued.push({
        source: SOURCE, title: label, file_name: label, lead_id: leadId,
        customer_name: nm, lead_mobile: mob, phone: mob,
        business_unit_name: bu, project: bu, crm_status: crm, report_date: from,
        status: "no_recording", synced_at: new Date().toISOString(),
        verification: [{ check: "recording_present", status: "fail",
          detail: 'The CRM feed returned "None" for this call - there is no recording to transcribe.' }] satisfies Check[],
      });
      continue;
    }
    const uuid = callUuidFrom(rec);
    const key = uuid ? `uuid:${uuid}` : `url:${rec}`;
    if (seen.has(key)) continue;
    seen.add(key);
    // project comes from the feed and is known now; the AI returns "Unclear" most of the time.
    queued.push({
      source: SOURCE, title: label, file_name: label, lead_id: leadId,
      customer_name: nm, lead_mobile: mob, phone: mob,
      business_unit_name: bu, project: bu, crm_status: crm, report_date: from,
      recording_url: rec, call_uuid: uuid, status: "queued", synced_at: new Date().toISOString(),
    });
  }

  // Skip what we already hold, so a re-run never re-bills for a call.
  const uuids = queued.map((r) => r.call_uuid).filter(Boolean) as string[];
  const urls = queued.map((r) => r.recording_url).filter(Boolean) as string[];
  const known = new Set<string>();
  if (uuids.length) {
    const { data } = await db.schema("acc").from("transcriptions").select("call_uuid").in("call_uuid", uuids);
    for (const r of data || []) if (r.call_uuid) known.add("uuid:" + r.call_uuid);
  }
  if (urls.length) {
    const { data } = await db.schema("acc").from("transcriptions").select("recording_url").in("recording_url", urls);
    for (const r of data || []) if (r.recording_url) known.add("url:" + r.recording_url);
  }
  {
    const { data } = await db.schema("acc").from("transcriptions")
      .select("lead_id").eq("report_date", from).eq("status", "no_recording");
    for (const r of data || []) if (r.lead_id) known.add("norec:" + r.lead_id);
  }
  const fresh = queued.filter((r) =>
    r.status === "no_recording" ? !known.has("norec:" + r.lead_id)
    : r.call_uuid ? !known.has("uuid:" + r.call_uuid)
    : !known.has("url:" + r.recording_url));

  let inserted = 0;
  for (let i = 0; i < fresh.length; i += 100) {
    const { data, error } = await db.schema("acc").from("transcriptions").insert(fresh.slice(i, i + 100)).select("id");
    // 23505 is a duplicate key: two overlapping runs, not worth aborting on.
    if (error && error.code !== "23505") {
      await db.schema("acc").from("lost_call_sync_runs").insert({
        from_date: from, to_date: to, trigger, feed_rows: feed.length, inserted,
        duplicates: queued.length - fresh.length, no_recording: noRecording,
        error_text: error.message.slice(0, 500) });
      return j({ error: error.message }, 500);
    }
    inserted += (data || []).length;
  }
  await db.schema("acc").from("lost_call_sync_runs").insert({
    from_date: from, to_date: to, trigger, feed_rows: feed.length, inserted,
    duplicates: queued.length - fresh.length, no_recording: noRecording });

  return { from, to, feed_rows: feed.length, unique_calls: queued.length, inserted,
           duplicates: queued.length - fresh.length, no_recording: noRecording };
}

// ---------------------------------------------------------------- WORK
async function processOne(db: DB, row: any, geminiKey: string) {
  const checks: Check[] = [{ check: "recording_present", status: "pass", detail: "CRM feed supplied a recording URL." }];
  const fail = async (status: string, errorText: string | null, extra: Record<string, unknown> = {}) => {
    await db.schema("acc").from("transcriptions").update({
      status, error_text: errorText ? errorText.slice(0, 500) : null, verification: checks,
      mismatch: null, mismatch_severity: null, mismatch_reason: null,
      updated_at: new Date().toISOString(), ...extra }).eq("id", row.id);
    return { id: row.id, lead_id: row.lead_id, status };
  };

  let audio: Uint8Array;
  let mimeType = "audio/mpeg";
  try {
    // fetch follows the 302 to Knowlarity's presigned S3 URL, which expires in ~600s - which is why
    // we store the knowlarity link and not the redirect target.
    const res = await fetch(row.recording_url);
    if (!res.ok) throw new Error(`recording fetch failed (HTTP ${res.status})`);
    mimeType = (res.headers.get("content-type") || "").split(";")[0] || mimeType;
    if (!/^audio\/|octet-stream$/i.test(mimeType)) mimeType = "audio/mpeg";
    audio = new Uint8Array(await res.arrayBuffer());
    if (audio.length < 1024) throw new Error(`recording is empty (${audio.length} bytes)`);
    if (audio.length > MAX_AUDIO_BYTES) throw new Error(`recording too large (${Math.round(audio.length/1048576)} MB)`);
  } catch (e) {
    const msg = String((e as any)?.message || e);
    checks.push({ check: "recording_fetched", status: "fail", detail: msg });
    return fail("error", msg);
  }
  checks.push({ check: "recording_fetched", status: "pass",
    detail: `Fetched ${Math.round(audio.length/1024)} KB of ${mimeType}.` });

  const seconds = estimateDurationSeconds(audio);
  if (seconds === null) {
    checks.push({ check: "duration_over_60s", status: "skip",
      detail: "Could not read the audio header - sending to the AI without a duration check." });
  } else if (seconds <= MIN_DURATION_SECONDS) {
    checks.push({ check: "duration_over_60s", status: "fail",
      detail: `Recording is ~${seconds}s, at or under the ${MIN_DURATION_SECONDS}s floor - almost certainly a ring-out. Skipped without calling the AI.` });
    return fail("too_short", null, { duration_seconds: seconds });
  } else {
    checks.push({ check: "duration_over_60s", status: "pass",
      detail: `Recording file is ~${seconds}s (includes ringing and any silence after hang-up).` });
  }

  let parsed: any;
  try {
    const gr = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${geminiKey}`,
      { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: PROMPT }, { inline_data: { mime_type: mimeType, data: toBase64(audio) } }] }],
          generationConfig: { responseMimeType: "application/json", temperature: 0, maxOutputTokens: MAX_OUTPUT_TOKENS },
        }) });
    const gj = await gr.json().catch(() => ({}));
    if (!gr.ok) throw new Error(`Gemini call failed (${gr.status}): ${JSON.stringify(gj).slice(0,300)}`);
    const raw: string = gj?.candidates?.[0]?.content?.parts?.[0]?.text || "";
    if (!raw) {
      // MAX_TOKENS with no text means the budget went entirely on the response - say which.
      const why = gj?.candidates?.[0]?.finishReason;
      throw new Error(why ? `Gemini returned no text (finishReason: ${why})` : "Gemini returned an empty response");
    }
    parsed = JSON.parse(raw.replace(/```json/g, "").replace(/```/g, "").trim());
  } catch (e) {
    const msg = String((e as any)?.message || e);
    checks.push({ check: "human_conversation", status: "skip", detail: "Not reached: " + msg });
    return fail("error", msg, { duration_seconds: seconds });
  }
  // audio goes out of scope here and is never persisted.

  const turns = Array.isArray(parsed?.transcript) ? parsed.transcript : null;

  /* "No conversation" is now a CONSEQUENCE of an empty transcript, never a decision the AI is invited
     to make up front. The prompt used to open with a pre-check that let it bail out before listening,
     and it took that exit on 48 of 69 calls in one night - recordings averaging two minutes - where
     the previous model rejected 8. Asking a model whether it need bother working gets the answer you
     would expect. Now it is asked only to transcribe, and an empty result is what we react to. */
  if (!turns || !turns.length) {
    const reason = String(parsed?.no_speech_reason || parsed?.reason || "").trim() || "No speech found in the recording";
    checks.push({ check: "human_conversation", status: "fail",
      detail: `The AI transcribed the whole recording and found no human speech in it: ${reason}.` });
    checks.push({ check: "crm_status_match", status: "skip",
      detail: "No conversation to judge the CRM's Lost status against." });
    await db.schema("acc").from("transcriptions").update({
      status: "non_transcribable", non_transcribable_reason: reason,
      summary_verdict: parsed?.summary_verdict || null, duration_seconds: seconds,
      verification: checks, mismatch: null, mismatch_severity: null, mismatch_reason: null,
      error_text: null, updated_at: new Date().toISOString() }).eq("id", row.id);
    return { id: row.id, lead_id: row.lead_id, status: "non_transcribable", reason };
  }

  checks.push({ check: "human_conversation", status: "pass",
    detail: `Agent/Customer conversation transcribed in ${turns.length} turns.` });

  const df = parsed?.dashboard_fields || null;
  const category = df?.lead_category ? String(df.lead_category) : null;
  const crit = normaliseCriteria(parsed?.criteria);
  const qual = qualifyFrom(crit);
  const verdict = judgeMismatch(row.crm_status, category);

  checks.push({ check: "crm_status_match",
    status: verdict.mismatch === true ? "fail" : verdict.mismatch === false ? "pass" : "skip",
    detail: verdict.reason || "The AI did not return a lead category, so the CRM status could not be verified." });
  if (qual.qualification) {
    checks.push({ check: "outcome", status: qual.qualification === "Not Qualified" ? "fail" : "pass",
      detail: `${qual.qualification} - ${qual.why}` });
  }

  /* The CRM's name for the lead is authoritative; the AI only fills in where the CRM had none,
     since what it hears on a bad line is a guess and the CRM's own record is not. */
  const heard = df?.customer_name && String(df.customer_name).toLowerCase() !== "none"
    ? String(df.customer_name) : null;
  const customerName = row.customer_name || heard;
  // The feed's project name is authoritative; the AI's guess is only a fallback.
  const aiProject = df?.project_discussed ? String(df.project_discussed) : "";
  const project = row.business_unit_name ||
    (aiProject && aiProject.toLowerCase() !== "unclear" ? aiProject : null);
  /* Reason explains why a lead is not simply won, so a Qualified one carries none. A Follow-Up keeps
     one because "call back later" is only useful with the circumstances attached. */
  const aiLost = df?.lost_reason && String(df.lost_reason).toLowerCase() !== "none" ? String(df.lost_reason) : null;
  const reason = qual.qualification === "Qualified" ? null
    : qual.qualification === "Follow-Up" ? (qual.why + (aiLost ? ` (${aiLost})` : ""))
    : (aiLost || qual.why);

  const { error } = await db.schema("acc").from("transcriptions").update({
    status: "done", duration_seconds: seconds,
    utterances: turns, transcript: flattenTranscript(turns),
    languages: languagesFrom(parsed?.languages),
    dashboard_fields: df, ai_lead_category: category,
    criteria: crit, qualification: qual.qualification, reason,
    qa_evaluation: parsed?.qa_evaluation || null, qa_score: qaScoreFor(parsed?.qa_evaluation),
    summary_verdict: parsed?.summary_verdict || null, summary: parsed?.summary_verdict || null,
    customer_name: customerName, project,
    mismatch: verdict.mismatch, mismatch_severity: verdict.severity, mismatch_reason: verdict.reason,
    verification: checks, non_transcribable_reason: null, error_text: null,
    updated_at: new Date().toISOString() }).eq("id", row.id);

  if (error) return fail("error", "could not save result: " + error.message, { duration_seconds: seconds });

  return { id: row.id, lead_id: row.lead_id, status: "done", lead_category: category,
           qualification: qual.qualification, languages: languagesFrom(parsed?.languages),
           turns: turns.length, mismatch: verdict.mismatch };
}

async function doWork(db: DB, limit: number, geminiKey: string) {
  const cols = "id, lead_id, recording_url, crm_status, report_date, business_unit_name, customer_name";
  const { data: queue, error } = await db.schema("acc").from("transcriptions").select(cols)
    .eq("source", SOURCE).eq("status", "queued").is("deleted_at", null)
    .order("id", { ascending: true }).limit(limit);
  if (error) return j({ error: error.message }, 500);
  if (!queue || !queue.length) return { processed: 0, remaining: 0, results: [] };

  // Claim first, so an overlapping tick takes different rows instead of paying twice.
  const { data: claimed } = await db.schema("acc").from("transcriptions")
    .update({ status: "processing", updated_at: new Date().toISOString() })
    .in("id", queue.map((r) => r.id)).eq("status", "queued").select(cols);

  const mine = claimed || [];
  const results: unknown[] = [];
  for (let i = 0; i < mine.length; i += CONCURRENCY) {
    results.push(...await Promise.all(mine.slice(i, i + CONCURRENCY).map((r) =>
      processOne(db, r, geminiKey).catch((e) => ({
        id: r.id, lead_id: r.lead_id, status: "error", error: String((e as any)?.message || e) })))));
  }
  const { count } = await db.schema("acc").from("transcriptions")
    .select("id", { count: "exact", head: true })
    .eq("source", SOURCE).eq("status", "queued").is("deleted_at", null);
  return { processed: results.length, remaining: count ?? 0, results };
}

// ---------------------------------------------------------------- HTTP
Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return j({ error: "method not allowed" }, 405);

  const SB = Deno.env.get("SUPABASE_URL")!;
  const SRV = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const SECRET = Deno.env.get("SYNC_SECRET");
  const GEMINI_KEY = Deno.env.get("GEMINI_API_KEY");

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
  if (!GEMINI_KEY) return j({ error: "GEMINI_API_KEY not configured in Secrets" }, 500);

  let body: any = {};
  try { body = await req.json(); } catch { /* empty body is fine */ }

  const action = String(body.action || "run");
  const trigger = viaCron ? "cron" : "manual";
  const from = isDate(body.from) ? body.from : istYesterday();
  const to = isDate(body.to) ? body.to : (isDate(body.from) ? body.from : istYesterday());
  if (from > to) return j({ error: "`from` is after `to`" }, 400);
  if (to > istToday()) return j({ error: "`to` is in the future" }, 400);
  // 8 per invocation at 4 abreast is two rounds - comfortably inside the wall clock, and it clears a
  // 50 call night in minutes rather than hours.
  const limit = Math.min(Math.max(Number(body.limit) || 8, 1), 24);

  try {
    if (action === "status") {
      const counts: Record<string, number> = {};
      for (const st of ["queued","processing","done","non_transcribable","no_recording","too_short","error"]) {
        const { count } = await db.schema("acc").from("transcriptions")
          .select("id", { count: "exact", head: true })
          .eq("source", SOURCE).eq("status", st).is("deleted_at", null);
        counts[st] = count ?? 0;
      }
      const { data: last } = await db.schema("acc").from("lost_call_sync_runs")
        .select("*").order("created_at", { ascending: false }).limit(1).maybeSingle();
      return j({ ok: true, counts, last_run: last || null, model: GEMINI_MODEL });
    }
    if (action === "retry") {
      const id = Number(body.id);
      if (!id) return j({ error: "missing id" }, 400);
      const { data, error } = await db.schema("acc").from("transcriptions")
        .update({ status: "queued", error_text: null, verification: null,
                  mismatch: null, mismatch_severity: null, mismatch_reason: null,
                  updated_at: new Date().toISOString() })
        .eq("id", id).not("recording_url", "is", null).select("id, status").maybeSingle();
      if (error) return j({ error: error.message }, 500);
      if (!data) return j({ error: "no such call, or it has no recording URL to retry" }, 404);
      return j({ ok: true, requeued: id, work: await doWork(db, 1, GEMINI_KEY) });
    }
    if (action === "pull") {
      const pulled = await doPull(db, from, to, trigger);
      return pulled instanceof Response ? pulled : j({ ok: true, action, ...pulled });
    }
    if (action === "work") {
      const worked = await doWork(db, limit, GEMINI_KEY);
      return worked instanceof Response ? worked : j({ ok: true, action, ...worked });
    }
    if (action === "run") {
      const pulled = await doPull(db, from, to, trigger);
      if (pulled instanceof Response) return pulled;
      const worked = await doWork(db, limit, GEMINI_KEY);
      return worked instanceof Response ? worked : j({ ok: true, action, pull: pulled, work: worked });
    }
    return j({ error: `unknown action "${action}"` }, 400);
  } catch (e) {
    return j({ error: String((e as any)?.message || e) }, 500);
  }
});
