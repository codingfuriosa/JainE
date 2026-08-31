// CRM SNAPSHOT -> SEQUENTIAL TRANSCRIPTION -> CRM-vs-CONVERSATION QA.
//
// Deployed from supabase/functions/crm-snapshot-qa/. See TRANSCRIPTION-README.md.

import { createClient } from "jsr:@supabase/supabase-js@2";
import { encodeBase64 } from "https://deno.land/std@0.224.0/encoding/base64.ts";
import { TRANSCRIBE_PROMPT } from "./transcribe-prompt.ts";
import { QA_SYSTEM_PROMPT, buildQaUserMessage } from "./qa-prompt.ts";
import type { QaContext } from "./qa-prompt.ts";

type DB = ReturnType<typeof createClient>;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-sync-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const j = (o: unknown, status = 200) =>
  new Response(JSON.stringify(o), { status, headers: { "Content-Type": "application/json", ...CORS } });

const FEED_URL = Deno.env.get("LOST_CALL_FEED") || "https://www.realtybucket.com/report/lost_call_recordings";
const FEED_ATTEMPTS = 3;
const FEED_BACKOFF_MS = [0, 2000, 6000];

const GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/models";
const GEMINI_MODEL = Deno.env.get("GEMINI_MODEL") || "gemini-flash-latest";

/* BOTH HALVES RUN ON GEMINI. The judge was OpenAI until 2026-08-31; one model for both was asked for,
   and it retires a second vendor, a second key and a second way for the night to stall - a missing
   OpenAI key used to make the function refuse `work` outright, so recordings were transcribed and
   then never assessed. GEMINI_QA_MODEL lets the judge be moved to a stronger tier than the
   transcriber without touching either default; unset, they are the same model. */
const GEMINI_QA_MODEL = Deno.env.get("GEMINI_QA_MODEL") || GEMINI_MODEL;
/* Generous, because on a thinking model the reasoning tokens come out of this same budget and a reply
   that runs out mid-string is not valid JSON. The transcriber asks for 65536 against the same model,
   so a ceiling this size is not the constraint. */
const QA_MAX_TOKENS = Number(Deno.env.get("QA_MAX_TOKENS") || 16000);

const APP_TZ_OFFSET_MIN = Number(Deno.env.get("APP_TZ_OFFSET_MIN") || 330); // +05:30
const APP_TZ_NAME = Deno.env.get("APP_TZ") || "Asia/Kolkata";

const JOB_SECRET_NAME = "transcription_sync";

const MIN_DURATION_SECONDS = Number(Deno.env.get("MIN_DURATION_SECONDS") || 20);
const MAX_AUDIO_BYTES = 20 * 1024 * 1024;

const MAX_ATTEMPTS = Number(Deno.env.get("MAX_ATTEMPTS") || 3);
const RETRY_AFTER_MINUTES = Number(Deno.env.get("RETRY_AFTER_MINUTES") || 10);
const STALE_MINUTES = 15;

const MAX_STEPS_PER_TICK = Number(Deno.env.get("MAX_STEPS_PER_TICK") || 2);
const SOFT_BUDGET_MS = Number(Deno.env.get("SOFT_BUDGET_MS") || 60000);

const IN_FLIGHT = ["transcribing", "qa_running"];
const CLAIMABLE = ["pending", "qa_pending"];

const MIN_TRANSCRIPT_CHARS = 120;
const MIN_CHARS_PER_SECOND = 1.5;

const IVR_PATTERNS: RegExp[] = [
  /welcome\s+to\s+ja[iy]n\s+group[.,!]?/gi,
  /this\s+call\s+(?:will\s+be|is\s+being)\s+recorded\s+for\s+(?:monitoring\s+and\s+)?(?:training|quality)\s*(?:and\s+training\s*)?purposes?[.,!]?/gi,
  /please\s+wait\s+while\s+we\s+connect\s+your\s+call[.,!]?/gi,
  /please\s+hold\s+while\s+we\s+connect\s+you[.,!]?/gi,
];
function stripIvr(t: string): string {
  let out = String(t || "");
  for (const re of IVR_PATTERNS) out = out.replace(re, " ");
  return out.replace(/\s{2,}/g, " ").trim();
}
const SPELLINGS: [RegExp, string][] = [
  [/\bpoylan\b/gi, "Pailan"], [/\bpoilan\b/gi, "Pailan"],
  [/\bjems\s+group\b/gi, "Jain Group"], [/\bgems\s+group\b/gi, "Jain Group"],
  [/\bjoka\b/gi, "Joka"], [/\bmadhyamgram\b/gi, "Madhyamgram"],
];
function fixSpellings(t: string): string {
  let out = String(t || "");
  for (const [re, to] of SPELLINGS) out = out.replace(re, to);
  return out;
}
function degenerateRepeat(text: string): { word: string; count: number; total: number } | null {
  const words = String(text || "").toLowerCase().replace(/[^a-zऀ-ॿঀ-৿ ]/g, " ")
    .split(/\s+/).filter(Boolean);
  if (words.length < 40) return null;
  const freq = new Map<string, number>();
  for (const w of words) freq.set(w, (freq.get(w) || 0) + 1);
  let top = "", n = 0;
  for (const [w, c] of freq) if (c > n) { top = w; n = c; }
  return n / words.length > 0.6 ? { word: top, count: n, total: words.length } : null;
}

const nowIso = () => new Date().toISOString();
const appNow = () => new Date(Date.now() + APP_TZ_OFFSET_MIN * 60e3);
const appToday = () => appNow().toISOString().slice(0, 10);
const appYesterday = () => new Date(appNow().getTime() - 864e5).toISOString().slice(0, 10);
const isDate = (s: unknown) => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);

const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const DAYS = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];
/* call_start_time and next_follow_up_date arrive as IST WALL CLOCK wearing a Z, so the components are
   read straight out of the string and never put through a timezone conversion. */
function fmtWallClock(v: string | null | undefined, withWeekday = false): string | null {
  const m = String(v || "").match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/);
  if (!m) return null;
  const [, y, mo, d, hh, mi] = m;
  const h = Number(hh), suffix = h < 12 ? "AM" : "PM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  const label = `${Number(d)} ${MONTHS[Number(mo) - 1]} ${y}, ${h12}:${mi} ${suffix}`;
  if (!withWeekday) return label;
  const wd = DAYS[new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d))).getUTCDay()];
  return `${label} (${wd})`;
}
function fmtWallDate(v: string | null | undefined): string | null {
  const m = String(v || "").match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  const [, y, mo, d] = m;
  const wd = DAYS[new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d))).getUTCDay()];
  return `${Number(d)} ${MONTHS[Number(mo) - 1]} ${y} (${wd})`;
}

async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

const BR_V1 = [0,32,40,48,56,64,80,96,112,128,160,192,224,256,320,0];
const BR_V2 = [0,8,16,24,32,40,48,56,64,80,96,112,128,144,160,0];
const SAMPLE_RATES: Record<number, number[]> = { 3:[44100,48000,32000], 2:[22050,24000,16000], 0:[11025,12000,8000] };
function estimateDurationSeconds(b: Uint8Array): number | null {
  let i = 0;
  if (b[0] === 0x49 && b[1] === 0x44 && b[2] === 0x33) {
    i = 10 + (((b[6] & 0x7f) << 21) | ((b[7] & 0x7f) << 14) | ((b[8] & 0x7f) << 7) | (b[9] & 0x7f));
  }
  for (; i < b.length - 4; i++) {
    if (b[i] !== 0xff || (b[i + 1] & 0xe0) !== 0xe0) continue;
    const verBits = (b[i + 1] >> 3) & 0x03;
    const layer = (b[i + 1] >> 1) & 0x03;
    if (layer !== 0x01) continue;
    const brIdx = (b[i + 2] >> 4) & 0x0f;
    const srIdx = (b[i + 2] >> 2) & 0x03;
    const rates = SAMPLE_RATES[verBits];
    if (!rates || srIdx > 2) continue;
    const bitrate = (verBits === 3 ? BR_V1 : BR_V2)[brIdx];
    if (!bitrate) continue;
    return Math.round((b.length - i) * 8 / (bitrate * 1000));
  }
  return null;
}

type Check = { check: string; status: "pass" | "fail" | "skip"; detail: string };
type Turn = { timestamp: string; speaker: string; text: string };

function parseModelJson(raw: string): any | null {
  let s = String(raw || "").trim();
  if (s.startsWith("```")) s = s.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
  if (!s) return null;
  try { return JSON.parse(s); } catch { /* fall through */ }
  const a = s.indexOf("{"), b = s.lastIndexOf("}");
  if (a >= 0 && b > a) { try { return JSON.parse(s.slice(a, b + 1)); } catch { /* give up */ } }
  return null;
}
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

const LANG_MAP: Record<string, string> = { hindi:"hi", english:"en", bengali:"bn", bangla:"bn", hi:"hi", en:"en", bn:"bn" };
function languagesFrom(v: unknown): string[] | null {
  if (!Array.isArray(v)) return null;
  const out = Array.from(new Set(v.map((x) => LANG_MAP[String(x).trim().toLowerCase()]).filter(Boolean)));
  return out.length ? out : null;
}
const LANG_LABEL: Record<string, string> = { hi:"Hindi", en:"English", bn:"Bengali" };

async function fetchFeed(from: string, to: string): Promise<{ leads: any[]; text: string }> {
  let lastErr = "";
  for (let i = 0; i < FEED_ATTEMPTS; i++) {
    if (FEED_BACKOFF_MS[i]) await new Promise((r) => setTimeout(r, FEED_BACKOFF_MS[i]));
    try {
      const res = await fetch(`${FEED_URL}?from=${from}&to=${to}`, { headers: { Accept: "application/json" } });
      if (!res.ok) throw new Error(`feed returned ${res.status}`);
      const text = await res.text();
      const body = JSON.parse(text);
      if (!Array.isArray(body)) throw new Error("feed did not return a JSON array");
      return { leads: body, text };
    } catch (e) {
      lastErr = String((e as any)?.message || e);
    }
  }
  throw new Error(lastErr || "feed fetch failed");
}

async function doSnapshot(db: DB, from: string, to: string, trigger: string) {
  let leads: any[], text: string;
  try {
    const got = await fetchFeed(from, to);
    leads = got.leads; text = got.text;
  } catch (e) {
    const error_text = String((e as any)?.message || e).slice(0, 500);
    const { data: current } = await db.schema("acc").from("crm_snapshots")
      .select("id, raw_sha").eq("snapshot_date", from).is("superseded_at", null).maybeSingle();
    if (!current) {
      await db.schema("acc").from("crm_snapshots").insert({
        snapshot_date: from, from_date: from, to_date: to, trigger,
        status: "failed", error_text, revision: 1,
      });
    }
    return j({ error: `CRM fetch failed after ${FEED_ATTEMPTS} attempts: ${error_text}`,
               existing_snapshot: current?.id ?? null }, 502);
  }

  const sha = await sha256Hex(text);
  const { data: current } = await db.schema("acc").from("crm_snapshots")
    .select("id, revision, raw_sha, status").eq("snapshot_date", from).is("superseded_at", null).maybeSingle();

  if (current && current.raw_sha === sha) {
    const norm = await db.rpc("crm_normalise_snapshot", { p_snapshot_id: current.id, p_tz_offset_min: APP_TZ_OFFSET_MIN });
    const q = await db.rpc("crm_build_queue", { p_snapshot_id: current.id, p_tz_offset_min: APP_TZ_OFFSET_MIN });
    return { snapshot_id: current.id, snapshot_date: from, unchanged: true,
             leads: leads.length, normalise: norm.data ?? norm.error?.message,
             queue: q.data ?? q.error?.message };
  }

  let revision = 1;
  if (current) {
    revision = Number(current.revision || 1) + 1;
    const { error } = await db.schema("acc").from("crm_snapshots")
      .update({ superseded_at: nowIso(), updated_at: nowIso() }).eq("id", current.id);
    if (error) return j({ error: "could not supersede the previous snapshot: " + error.message }, 500);
  }

  const { data: snap, error: insErr } = await db.schema("acc").from("crm_snapshots").insert({
    snapshot_date: from, from_date: from, to_date: to, trigger, revision,
    status: "fetched", raw: leads as any, raw_sha: sha, raw_bytes: text.length,
    lead_count: leads.length,
  }).select("id").single();
  if (insErr || !snap) {
    if (current) {
      await db.schema("acc").from("crm_snapshots")
        .update({ superseded_at: null, updated_at: nowIso() }).eq("id", current.id);
    }
    return j({ error: "could not store the CRM response: " + (insErr?.message || "no row returned") }, 500);
  }
  if (current) {
    await db.schema("acc").from("crm_snapshots")
      .update({ superseded_by: snap.id }).eq("id", current.id);
  }

  const norm = await db.rpc("crm_normalise_snapshot", { p_snapshot_id: snap.id, p_tz_offset_min: APP_TZ_OFFSET_MIN });
  if (norm.error) {
    await db.schema("acc").from("crm_snapshots")
      .update({ status: "failed", error_text: norm.error.message.slice(0, 500), updated_at: nowIso() })
      .eq("id", snap.id);
    return j({ error: "the response was stored but could not be normalised: " + norm.error.message,
               snapshot_id: snap.id }, 500);
  }
  const q = await db.rpc("crm_build_queue", { p_snapshot_id: snap.id, p_tz_offset_min: APP_TZ_OFFSET_MIN });
  if (q.error) {
    return j({ error: "the response was stored and normalised but the queue could not be built: " + q.error.message,
               snapshot_id: snap.id }, 500);
  }

  return { snapshot_id: snap.id, snapshot_date: from, from, to, revision,
           superseded: current?.id ?? null, timezone: APP_TZ_NAME,
           leads: leads.length, bytes: text.length,
           normalise: norm.data, queue: q.data };
}

async function transcribePhase(db: DB, item: any, geminiKey: string, geminiModel: string) {
  const attempt = Number(item.attempt_count || 0) + 1;
  const checks: Check[] = [];

  const failQueue = async (msg: string) => {
    const retryable = attempt < MAX_ATTEMPTS;
    await db.schema("acc").from("transcription_queue").update({
      status: "failed", fail_phase: "transcribe", attempt_count: attempt,
      last_error: msg.slice(0, 460) + (retryable ? ` [try ${attempt}, will retry]` : ` [try ${attempt}]`),
      finished_at: retryable ? null : nowIso(), updated_at: nowIso(),
    }).eq("id", item.id);
    return { follow_up_id: item.follow_up_id, phase: "transcribe", status: "failed", attempt, error: msg };
  };

  // ---- 1. already transcribed? THE deduplication check.
  const { data: existing } = await db.schema("acc").from("call_transcripts")
    .select("id, status, non_transcribable_reason").eq("recording_url", item.recording_url).maybeSingle();

  const saveTranscript = async (patch: Record<string, unknown>) => {
    const { data, error } = await db.schema("acc").from("call_transcripts").upsert({
      recording_url: item.recording_url,
      callid: item.callid || null,
      attempt_count: attempt,
      updated_at: nowIso(),
      ...(existing ? {} : {
        first_follow_up_id: item.follow_up_id,
        first_seen_date: item.call_date || item.snapshot_date || null,
      }),
      ...patch,
    }, { onConflict: "recording_url" }).select("id").single();
    if (error) throw new Error("could not save the transcript: " + error.message);
    return data.id as number;
  };

  if (existing && existing.status === "completed") {
    await db.schema("acc").from("transcription_queue").update({
      status: "qa_pending", transcript_id: existing.id, reused_transcription: true,
      last_error: null, fail_phase: null, updated_at: nowIso(),
    }).eq("id", item.id);
    return { follow_up_id: item.follow_up_id, phase: "transcribe", status: "skipped_existing",
             transcript_id: existing.id, reused: true };
  }
  if (existing && existing.status === "non_transcribable") {
    await db.schema("acc").from("transcription_queue").update({
      status: "skipped_existing", transcript_id: existing.id, reused_transcription: true,
      fail_phase: null, last_error: null, finished_at: nowIso(), updated_at: nowIso(),
    }).eq("id", item.id);
    return { follow_up_id: item.follow_up_id, phase: "transcribe", status: "non_transcribable",
             reused: true, reason: existing.non_transcribable_reason };
  }

  // ---- 2. the CRM's own duration, checked before a single byte of audio is fetched.
  const crmDur = item.fu_duration === null || item.fu_duration === undefined ? null : Number(item.fu_duration);
  if (MIN_DURATION_SECONDS > 0 && crmDur !== null && crmDur <= MIN_DURATION_SECONDS) {
    checks.push({ check: "duration_floor", status: "fail",
      detail: `The CRM records this call as ${crmDur}s, at or under the ${MIN_DURATION_SECONDS}s floor - a ring-out. Not sent to a model.` });
    const tid = await saveTranscript({
      status: "non_transcribable", crm_duration: crmDur, verification: checks,
      non_transcribable_reason: `Ring-out or unanswered: the CRM records this call as ${crmDur} seconds, under the ${MIN_DURATION_SECONDS}s floor.`,
      completed_at: nowIso(),
    });
    await db.schema("acc").from("transcription_queue").update({
      status: "completed", transcript_id: tid, fail_phase: null, last_error: null,
      attempt_count: attempt, finished_at: nowIso(), updated_at: nowIso(),
    }).eq("id", item.id);
    return { follow_up_id: item.follow_up_id, phase: "transcribe", status: "non_transcribable", crm_duration: crmDur };
  }

  // ---- 3. the audio, into memory only.
  let audio: Uint8Array, mimeType = "audio/mpeg";
  try {
    const res = await fetch(item.recording_url);
    if (!res.ok) throw new Error(`recording fetch failed (HTTP ${res.status})`);
    /* Knowlarity serves these as "binary/octet-stream". octet-stream needs REPLACING, not exempting. */
    const served = (res.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
    mimeType = /^(audio|video)\/[a-z0-9.+-]+$/.test(served) ? served : "audio/mpeg";
    audio = new Uint8Array(await res.arrayBuffer());
    if (audio.length < 1024) throw new Error(`recording is empty (${audio.length} bytes)`);
    if (audio.length > MAX_AUDIO_BYTES) throw new Error(`recording too large (${Math.round(audio.length/1048576)} MB)`);
  } catch (e) {
    return failQueue(String((e as any)?.message || e));
  }
  checks.push({ check: "recording_fetched", status: "pass",
    detail: `Fetched ${Math.round(audio.length/1024)} KB of ${mimeType}. The audio is held in memory for this one call and is never stored.` });

  const headerSeconds = estimateDurationSeconds(audio);
  const seconds = crmDur ?? headerSeconds;
  if (MIN_DURATION_SECONDS > 0 && crmDur === null && headerSeconds !== null && headerSeconds <= MIN_DURATION_SECONDS) {
    checks.push({ check: "duration_floor", status: "fail",
      detail: `The CRM sent no duration and the audio header reads ~${headerSeconds}s, at or under the ${MIN_DURATION_SECONDS}s floor.` });
    const tid = await saveTranscript({
      status: "non_transcribable", duration_seconds: headerSeconds, crm_duration: null, verification: checks,
      non_transcribable_reason: `Ring-out or unanswered: the recording is only ~${headerSeconds}s, under the ${MIN_DURATION_SECONDS}s floor.`,
      completed_at: nowIso(),
    });
    await db.schema("acc").from("transcription_queue").update({
      status: "completed", transcript_id: tid, attempt_count: attempt,
      fail_phase: null, last_error: null, finished_at: nowIso(), updated_at: nowIso(),
    }).eq("id", item.id);
    return { follow_up_id: item.follow_up_id, phase: "transcribe", status: "non_transcribable", header_seconds: headerSeconds };
  }
  checks.push({ check: "duration", status: "pass",
    detail: `CRM duration ${crmDur ?? "(none)"}s; audio header ~${headerSeconds ?? "?"}s (the file includes ringing and any silence after hang-up).` });

  // ---- 4. Gemini. Listening only: no CRM data and no project figures are in this prompt.
  let rawText = "";
  try {
    const gr = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${geminiModel}:generateContent`,
      { method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": geminiKey },
        body: JSON.stringify({
          contents: [{ parts: [
            { text: TRANSCRIBE_PROMPT },
            { inline_data: { mime_type: mimeType, data: encodeBase64(audio) } },
          ] }],
          generationConfig: {
            temperature: 0,
            responseMimeType: "application/json",
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
    return failQueue(String((e as any)?.message || e));
  }

  // ---- 5. validate BEFORE anything is saved as a success.
  const parsed = parseModelJson(rawText);
  if (!parsed || typeof parsed !== "object") {
    await saveTranscript({ status: "failed", last_error: "reply was not valid JSON",
      raw_reply: rawText.slice(0, 20000), model: geminiModel, verification: checks });
    return failQueue("Gemini did not return valid JSON");
  }
  const st = String(parsed.status || "").trim().toLowerCase();

  if (st === "non-transcribable" || st === "non_transcribable") {
    const why = String(parsed.reason || "").trim() || "No conversation";
    checks.push({ check: "human_conversation", status: "fail",
      detail: `The pre-check found no Agent-Customer conversation: ${why}.` });
    const tid = await saveTranscript({
      status: "non_transcribable", non_transcribable_reason: why, model: geminiModel,
      duration_seconds: headerSeconds, crm_duration: crmDur, verification: checks,
      raw_reply: null, completed_at: nowIso(),
    });
    await db.schema("acc").from("transcription_queue").update({
      status: "completed", transcript_id: tid, attempt_count: attempt,
      fail_phase: null, last_error: null, finished_at: nowIso(), updated_at: nowIso(),
    }).eq("id", item.id);
    return { follow_up_id: item.follow_up_id, phase: "transcribe", status: "non_transcribable", reason: why };
  }
  if (st !== "completed") {
    await saveTranscript({ status: "failed", last_error: `unrecognised status "${parsed.status}"`,
      raw_reply: rawText.slice(0, 20000), model: geminiModel, verification: checks });
    return failQueue(`invalid reply: unrecognised status "${parsed.status}"`);
  }

  const turns = normaliseTurns(parsed.transcript);
  if (!turns.length) {
    await saveTranscript({ status: "failed", last_error: "status was Completed but the transcript was empty",
      raw_reply: rawText.slice(0, 20000), model: geminiModel, verification: checks });
    return failQueue('invalid reply: status was "Completed" but the transcript was empty');
  }

  /* THE CONTENT GUARDS. Shape validation is necessary and not sufficient. Do not remove these. */
  const body = plainText(turns);
  const degen = degenerateRepeat(body);
  if (degen) {
    const msg = `stuck-loop transcription ("${degen.word}" repeated ${degen.count} of ${degen.total} words)`;
    checks.push({ check: "human_conversation", status: "fail",
      detail: `${degen.count} of ${degen.total} words are just "${degen.word}" repeated - the model got stuck in a loop rather than genuinely hearing this call.` });
    await saveTranscript({ status: "failed", last_error: msg, raw_reply: rawText.slice(0, 20000),
      model: geminiModel, verification: checks, duration_seconds: headerSeconds, crm_duration: crmDur });
    return failQueue(msg);
  }
  const density = seconds ? body.length / seconds : null;
  const tooThin = body.length < MIN_TRANSCRIPT_CHARS
    || (density !== null && seconds! > MIN_DURATION_SECONDS && density < MIN_CHARS_PER_SECOND);
  if (tooThin) {
    const msg = `transcript too thin: ${body.length} characters for ~${seconds}s of audio`;
    checks.push({ check: "enough_speech", status: "fail",
      detail: `Only ${body.length} characters came back for ~${seconds}s of audio`
        + (density !== null ? ` (${Math.round(density*10)/10} per second, against 6-16 on a real transcript)` : "")
        + ". Too little to be a transcript of this call." });
    await saveTranscript({ status: "failed", last_error: msg, raw_reply: rawText.slice(0, 20000),
      model: geminiModel, verification: checks, duration_seconds: headerSeconds, crm_duration: crmDur });
    return failQueue(msg);
  }
  checks.push({ check: "enough_speech", status: "pass",
    detail: `${turns.length} turns, ${body.length} characters for ~${seconds ?? "?"}s of audio`
      + (density !== null ? ` (${Math.round(density*10)/10} per second)` : "") + "." });

  /* The transcriber was never told the name, so this stays an honest check. Informational, not fatal.
     A RUN where it almost never agrees is the alarm. */
  const heardName = String(parsed.customer_name || "").trim();
  const knownName = String(item.fu_lead_name || "").trim();
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

  const tid = await saveTranscript({
    status: "completed", transcript: turns as any, transcript_text: flattenTurns(turns),
    turn_count: turns.length, languages: languagesFrom(parsed.languages),
    duration_seconds: headerSeconds, crm_duration: crmDur,
    heard_customer_name: heardName && heardName.toLowerCase() !== "none" ? heardName : null,
    non_transcribable_reason: null, verification: checks, model: geminiModel,
    last_error: null, raw_reply: null, completed_at: nowIso(),
  });
  await db.schema("acc").from("transcription_queue").update({
    status: "qa_pending", transcript_id: tid, attempt_count: attempt,
    fail_phase: null, last_error: null, updated_at: nowIso(),
  }).eq("id", item.id);
  return { follow_up_id: item.follow_up_id, phase: "transcribe", status: "completed",
           transcript_id: tid, turns: turns.length, characters: body.length };
}

/* The four mismatch categories, derived HERE from the two statuses rather than trusted from the
   model's own field. */
function deriveStatusMatch(crmStatus: string | null, ai: string | null):
  { status_match: boolean | null; mismatch_type: string | null; note: string } {
  const crm = String(crmStatus || "").trim();
  const a = String(ai || "").trim();
  if (!a || a === "Unclear") {
    return { status_match: null, mismatch_type: null,
      note: "The conversation did not establish an outcome, so it neither agrees nor disagrees with the CRM." };
  }
  if (!["Lost", "Qualified", "In Follow Up"].includes(crm)) {
    return { status_match: null, mismatch_type: null,
      note: `CRM status "${crm || "(none)"}" is outside the four mismatch categories, so no status verdict was counted.` };
  }
  if (crm === a) {
    return { status_match: true, mismatch_type: null,
      note: `The CRM has this follow-up as "${crm}" and the call agrees.` };
  }
  if (crm === "Lost") {
    return { status_match: false, mismatch_type: "lost_should_not_have_been_lost",
      note: `The CRM marked this follow-up Lost, but the call reads as "${a}" - the lead was written off while still live.` };
  }
  if (crm === "Qualified") {
    return { status_match: false, mismatch_type: "qualified_should_not_have_been_qualified",
      note: `The CRM marked this follow-up Qualified, but the call does not carry the evidence to qualify the lead (it reads as "${a}").` };
  }
  if (a === "Lost") {
    return { status_match: false, mismatch_type: "in_followup_should_have_been_lost",
      note: "The CRM still has this lead In Follow Up, but on the call the customer closed the door - the team is chasing a closed lead." };
  }
  return { status_match: false, mismatch_type: "in_followup_should_have_been_qualified",
    note: "The CRM has this lead In Follow Up, but the call meets the qualification test - it should be moved on." };
}

function qaScoreFor(qa: unknown): number | null {
  if (!Array.isArray(qa) || !qa.length) return null;
  let got = 0, counted = 0;
  for (const p of qa as any[]) {
    const s = String(p?.status || "").toLowerCase();
    if (s === "not applicable") continue;
    counted++;
    if (s === "pass") got += 1; else if (s === "partial") got += 0.5;
  }
  return counted ? Math.round((got / counted) * 100) : null;
}

/* The judge call. Text in, JSON out - no audio, and the SAME arrangement the transcriber uses one
   stage earlier: responseMimeType asks for bare JSON and the prompt states the shape, because the
   OpenAPI subset behind Gemini's responseSchema cannot express this contract (nullable unions, a null
   member inside an enum) without quietly relaxing it. The guarantee therefore lives in qaPhase's
   validation, which refuses and retries anything missing an assessment.
   temperature 0 is what makes two runs over the same call comparable. */
async function callGeminiQa(key: string, model: string, system: string, user: string): Promise<string> {
  const res = await fetch(`${GEMINI_URL}/${model}:generateContent`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": key },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: "user", parts: [{ text: user }] }],
      generationConfig: {
        temperature: 0,
        responseMimeType: "application/json",
        maxOutputTokens: QA_MAX_TOKENS,
      },
    }),
  });
  const out = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`Gemini QA failed (${res.status}): ${String((out as any)?.error?.message || JSON.stringify(out)).slice(0, 300)}`);
  }
  const cand = (out as any)?.candidates?.[0];
  const text = String(cand?.content?.parts?.[0]?.text || "").trim();
  if (!text) {
    const why = cand?.finishReason;
    /* MAX_TOKENS names itself rather than arriving as "invalid JSON", because the fix is QA_MAX_TOKENS
       and no number of retries will produce a different outcome. */
    if (why === "MAX_TOKENS") {
      throw new Error(`Gemini QA ran out of output budget (${QA_MAX_TOKENS} tokens) before finishing the JSON - raise QA_MAX_TOKENS`);
    }
    throw new Error(why ? `Gemini QA returned no text (finishReason: ${why})` : "Gemini QA returned nothing");
  }
  return text;
}

async function qaPhase(db: DB, item: any, geminiKey: string, qaModel: string) {
  const attempt = Number(item.qa_attempt_count || 0) + 1;
  const failQueue = async (msg: string) => {
    const retryable = attempt < MAX_ATTEMPTS;
    await db.schema("acc").from("transcription_queue").update({
      status: "failed", fail_phase: "qa", qa_attempt_count: attempt,
      last_error: msg.slice(0, 460) + (retryable ? ` [QA try ${attempt}, will retry]` : ` [QA try ${attempt}]`),
      finished_at: retryable ? null : nowIso(), updated_at: nowIso(),
    }).eq("id", item.id);
    return { follow_up_id: item.follow_up_id, phase: "qa", status: "failed", attempt, error: msg };
  };
  const finish = async () => {
    await db.schema("acc").from("transcription_queue").update({
      status: item.reused_transcription ? "skipped_existing" : "completed",
      qa_attempt_count: attempt, fail_phase: null, last_error: null,
      finished_at: nowIso(), updated_at: nowIso(),
    }).eq("id", item.id);
  };

  // ---- 1. already assessed? One QA result per follow-up, ever.
  const { data: already } = await db.schema("acc").from("followup_qa")
    .select("id").eq("follow_up_id", item.follow_up_id).maybeSingle();
  if (already) {
    await finish();
    return { follow_up_id: item.follow_up_id, phase: "qa", status: "already_assessed", qa_id: already.id };
  }

  // ---- 2. the CRM record and the conversation, read separately and kept separate.
  const { data: fu } = await db.schema("acc").from("crm_followups")
    .select("*").eq("follow_up_id", item.follow_up_id).maybeSingle();
  if (!fu) return failQueue("the follow-up is no longer in the normalised history");

  const { data: lead } = await db.schema("acc").from("crm_leads")
    .select("status, lost_reason, lead_name, business_unit_name").eq("lead_id", fu.lead_id).maybeSingle();

  const { data: tr } = await db.schema("acc").from("call_transcripts")
    .select("id, status, transcript_text, transcript, languages, duration_seconds")
    .eq("recording_url", item.recording_url).maybeSingle();
  if (!tr || tr.status !== "completed" || !tr.transcript_text) {
    if (tr && tr.status === "non_transcribable") {
      await finish();
      return { follow_up_id: item.follow_up_id, phase: "qa", status: "no_conversation" };
    }
    const n = Number(item.attempt_count || 0);
    if (n >= MAX_ATTEMPTS) {
      await db.schema("acc").from("transcription_queue").update({
        status: "failed", fail_phase: "transcribe", finished_at: nowIso(), updated_at: nowIso(),
        last_error: `There is no usable transcript for this recording (${tr?.status || "none stored"}) and the transcription retry cap is reached.`,
      }).eq("id", item.id);
      return { follow_up_id: item.follow_up_id, phase: "qa", status: "failed",
               error: "no usable transcript, transcription cap reached" };
    }
    await db.schema("acc").from("transcription_queue").update({
      status: "pending", fail_phase: "transcribe", transcript_id: null,
      reused_transcription: false, started_at: null, updated_at: nowIso(),
      last_error: `Sent back for transcription: the stored transcript for this recording is ${tr?.status || "missing"}.`,
    }).eq("id", item.id);
    return { follow_up_id: item.follow_up_id, phase: "qa", status: "returned_to_transcription",
             transcription_status: tr?.status || "missing" };
  }

  const ctx: QaContext = {
    lead_id: Number(fu.lead_id),
    lead_name: fu.lead_name ?? lead?.lead_name ?? null,
    business_unit_name: fu.business_unit_name ?? lead?.business_unit_name ?? null,
    lead_current_status: lead?.status ?? null,
    lead_current_lost_reason: lead?.lost_reason ?? null,
    follow_up_id: Number(fu.follow_up_id),
    crm_status: fu.status ?? null,
    crm_status_raw: fu.status_raw ?? null,
    crm_remarks: fu.remarks ?? null,
    crm_next_follow_up: fu.next_follow_up_text ?? null,
    crm_lost_reason: fu.lost_reason ?? null,
    call_started: fmtWallClock(fu.call_start_text, true),
    call_date_label: fmtWallDate(fu.call_start_text) ?? (fu.call_date ? fmtWallDate(fu.call_date + "T00:00") : null),
    next_follow_up_label: fmtWallClock(fu.next_follow_up_text, true),
    call_duration: fu.call_duration === null || fu.call_duration === undefined ? null : Number(fu.call_duration),
    languages: Array.isArray(tr.languages) ? tr.languages.map((l: string) => LANG_LABEL[l] || l) : null,
    transcript: String(tr.transcript_text),
  };

  let raw = "";
  try {
    raw = await callGeminiQa(geminiKey, qaModel, QA_SYSTEM_PROMPT, buildQaUserMessage(ctx));
  } catch (e) {
    return failQueue(String((e as any)?.message || e));
  }
  const p = parseModelJson(raw);
  if (!p || typeof p !== "object") {
    await db.schema("acc").from("transcription_queue")
      .update({ updated_at: nowIso() }).eq("id", item.id);
    return failQueue("the QA reply was not valid JSON");
  }

  const pitch = p.pitch_accuracy && typeof p.pitch_accuracy === "object" ? p.pitch_accuracy : null;
  const fdate = p.followup_date_accuracy && typeof p.followup_date_accuracy === "object" ? p.followup_date_accuracy : null;
  const lreason = p.lost_reason_accuracy && typeof p.lost_reason_accuracy === "object" ? p.lost_reason_accuracy : null;
  const rem = p.remarks_accuracy && typeof p.remarks_accuracy === "object" ? p.remarks_accuracy : null;
  const sa = p.status_assessment && typeof p.status_assessment === "object" ? p.status_assessment : null;
  if (!pitch || !fdate || !lreason || !rem || !sa) {
    return failQueue("the QA reply was missing one of the five required assessments");
  }

  const derived = deriveStatusMatch(ctx.crm_status, String(sa.ai_assessed_status || ""));
  /* A pitch that never happened has no score. Storing 0 would drag the day's average down as though
     the agent had pitched badly. */
  const pitchStatus = String(pitch.status || "").trim() || null;
  const pitchScore = pitchStatus === "Not Verifiable" || pitch.score === null || pitch.score === undefined
    ? null : Math.max(0, Math.min(100, Math.round(Number(pitch.score))));

  const { data: saved, error: saveErr } = await db.schema("acc").from("followup_qa").upsert({
    follow_up_id: Number(fu.follow_up_id),
    lead_id: Number(fu.lead_id),
    lead_name: ctx.lead_name,
    business_unit_name: ctx.business_unit_name,
    call_date: fu.call_date ?? null,
    snapshot_date: item.snapshot_date ?? null,
    recording_url: item.recording_url,
    transcript_id: tr.id,
    reused_transcription: !!item.reused_transcription,

    crm_status: fu.status ?? null,
    crm_status_raw: fu.status_raw ?? null,
    crm_remarks: fu.remarks ?? null,
    crm_next_follow_up: fu.next_follow_up_text ?? null,
    crm_lost_reason: fu.lost_reason ?? null,
    call_start_text: fu.call_start_text ?? null,
    call_duration: fu.call_duration ?? null,

    pitch_accuracy: pitch, followup_date_accuracy: fdate,
    lost_reason_accuracy: lreason, remarks_accuracy: rem,
    status_assessment: { ...sa, derived_status_match: derived.status_match,
                         derived_mismatch_type: derived.mismatch_type, derived_note: derived.note },
    pitch_score: pitchScore, pitch_status: pitchStatus,
    followup_date_status: String(fdate.status || "").trim() || null,
    lost_reason_status: String(lreason.status || "").trim() || null,
    remarks_status: String(rem.status || "").trim() || null,
    ai_assessed_status: String(sa.ai_assessed_status || "").trim() || null,
    status_match: derived.status_match,
    mismatch_type: derived.mismatch_type,
    agent_qa: Array.isArray(p.agent_qa) ? p.agent_qa : null,
    qa_score: qaScoreFor(p.agent_qa),
    summary_verdict: p.summary_verdict ? String(p.summary_verdict) : null,
    qa_model: qaModel, qa_raw: null, qa_error: null,
    updated_at: nowIso(),
  }, { onConflict: "follow_up_id" }).select("id").single();

  if (saveErr) return failQueue("could not save the QA result: " + saveErr.message);

  await finish();
  return { follow_up_id: item.follow_up_id, phase: "qa", status: "completed", qa_id: saved.id,
           pitch: pitchStatus, pitch_score: pitchScore,
           followup_date: fdate.status, lost_reason: lreason.status, remarks: rem.status,
           crm_status: ctx.crm_status, ai_assessed_status: sa.ai_assessed_status,
           status_match: derived.status_match, mismatch_type: derived.mismatch_type };
}

async function promoteRetries(db: DB) {
  const cutoff = new Date(Date.now() - RETRY_AFTER_MINUTES * 60e3).toISOString();
  const stale = new Date(Date.now() - STALE_MINUTES * 60e3).toISOString();

  /* A failure resumes at the PHASE THAT FAILED. A QA call that 429'd must not send the recording back
     through Gemini - the transcript is already stored and paid for. */
  const { data: reTranscribe } = await db.schema("acc").from("transcription_queue")
    .update({ status: "pending", updated_at: nowIso() })
    .eq("status", "failed").eq("fail_phase", "transcribe")
    .lt("attempt_count", MAX_ATTEMPTS).lt("updated_at", cutoff).select("id");
  const { data: reQa } = await db.schema("acc").from("transcription_queue")
    .update({ status: "qa_pending", updated_at: nowIso() })
    .eq("status", "failed").eq("fail_phase", "qa")
    .lt("qa_attempt_count", MAX_ATTEMPTS).lt("updated_at", cutoff).select("id");

  /* RECLAIMING A KILLED INVOCATION MUST COUNT AS AN ATTEMPT, or a recording whose model call always
     overruns the worker limit is reclaimed and re-billed for ever. */
  let reclaimed = 0;
  const { data: stuckT } = await db.schema("acc").from("transcription_queue")
    .select("id, attempt_count").eq("status", "transcribing").lt("started_at", stale);
  for (const s of stuckT || []) {
    const n = Number(s.attempt_count || 0) + 1;
    await db.schema("acc").from("transcription_queue").update({
      status: n >= MAX_ATTEMPTS ? "failed" : "pending",
      fail_phase: "transcribe", attempt_count: n, started_at: null, updated_at: nowIso(),
      finished_at: n >= MAX_ATTEMPTS ? nowIso() : null,
      last_error: n >= MAX_ATTEMPTS
        ? "The transcription was cut off before it finished (edge worker limit) and the retry cap is reached - listen to this recording by hand."
        : `Recovered: the previous transcription attempt was cut off before it finished [try ${n}].`,
    }).eq("id", s.id);
    reclaimed++;
  }
  const { data: stuckQ } = await db.schema("acc").from("transcription_queue")
    .select("id, qa_attempt_count").eq("status", "qa_running").lt("started_at", stale);
  for (const s of stuckQ || []) {
    const n = Number(s.qa_attempt_count || 0) + 1;
    await db.schema("acc").from("transcription_queue").update({
      status: n >= MAX_ATTEMPTS ? "failed" : "qa_pending",
      fail_phase: "qa", qa_attempt_count: n, started_at: null, updated_at: nowIso(),
      finished_at: n >= MAX_ATTEMPTS ? nowIso() : null,
      last_error: n >= MAX_ATTEMPTS
        ? "The QA call was cut off before it finished and the retry cap is reached - the transcript is stored, so retrying only re-runs the QA."
        : `Recovered: the previous QA attempt was cut off before it finished [try ${n}].`,
    }).eq("id", s.id);
    reclaimed++;
  }
  return { requeued_transcribe: (reTranscribe || []).length, requeued_qa: (reQa || []).length, reclaimed };
}

async function oneStep(db: DB, geminiKey: string, geminiModel: string, qaModel: string) {
  /* STRICTLY ONE AT A TIME. */
  const { count: inFlight } = await db.schema("acc").from("transcription_queue")
    .select("id", { count: "exact", head: true }).in("status", IN_FLIGHT);
  if ((inFlight ?? 0) > 0) return { done: false, skipped: "a recording is already being processed" };

  const { data: queue, error } = await db.schema("acc").from("transcription_queue")
    .select("id, status").in("status", CLAIMABLE)
    .order("queue_seq", { ascending: true }).order("id", { ascending: true }).limit(1);
  if (error) throw new Error(error.message);
  if (!queue || !queue.length) return { done: false, empty: true };

  const head = queue[0];
  const wasPending = head.status === "pending";
  /* The status predicate IS the lock: two overlapping ticks cannot both win. */
  const { data: claimed } = await db.schema("acc").from("transcription_queue")
    .update({ status: wasPending ? "transcribing" : "qa_running", started_at: nowIso(), updated_at: nowIso() })
    .eq("id", head.id).eq("status", head.status)
    .select("id, follow_up_id, lead_id, recording_url, callid, snapshot_date, call_date, status, " +
            "attempt_count, qa_attempt_count, reused_transcription, transcript_id")
    .maybeSingle();
  if (!claimed) return { done: false, skipped: "another tick claimed it first" };

  const { data: fu } = await db.schema("acc").from("crm_followups")
    .select("call_duration, lead_name").eq("follow_up_id", claimed.follow_up_id).maybeSingle();
  const item = { ...claimed, fu_duration: fu?.call_duration ?? null, fu_lead_name: fu?.lead_name ?? null };

  try {
    const result = wasPending
      ? await transcribePhase(db, item, geminiKey, geminiModel)
      : await qaPhase(db, item, geminiKey, qaModel);
    return { done: true, result };
  } catch (e) {
    /* Never leave a claimed row mid-phase, or the queue stalls behind it for ever. */
    const msg = String((e as any)?.message || e);
    const phase = wasPending ? "transcribe" : "qa";
    const n = Number(wasPending ? claimed.attempt_count || 0 : claimed.qa_attempt_count || 0) + 1;
    await db.schema("acc").from("transcription_queue").update({
      status: "failed", fail_phase: phase,
      ...(wasPending ? { attempt_count: n } : { qa_attempt_count: n }),
      last_error: msg.slice(0, 460) + ` [${phase} try ${n}]`,
      finished_at: n >= MAX_ATTEMPTS ? nowIso() : null, updated_at: nowIso(),
    }).eq("id", claimed.id);
    return { done: true, result: { follow_up_id: claimed.follow_up_id, phase, status: "failed", error: msg } };
  }
}

async function doWork(db: DB, geminiKey: string, geminiModel: string, qaModel: string) {
  const t0 = Date.now();
  const promoted = await promoteRetries(db);
  const steps: unknown[] = [];
  let note: string | undefined;

  for (let i = 0; i < Math.max(1, MAX_STEPS_PER_TICK); i++) {
    if (i > 0 && Date.now() - t0 > SOFT_BUDGET_MS) { note = "stopped early to stay inside the worker limit"; break; }
    const step = await oneStep(db, geminiKey, geminiModel, qaModel);
    if (!step.done) { if (i === 0) note = step.skipped || (step.empty ? "the queue is empty" : undefined); break; }
    steps.push(step.result);
  }

  const { count: remaining } = await db.schema("acc").from("transcription_queue")
    .select("id", { count: "exact", head: true }).in("status", CLAIMABLE);

  return { processed: steps.length, remaining: remaining ?? 0, note,
           transcription_model: geminiModel, qa_model: qaModel, ...promoted, steps };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return j({ error: "method not allowed" }, 405);

  const SB = Deno.env.get("SUPABASE_URL")!;
  const SRV = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const SECRET = Deno.env.get("SYNC_SECRET");
  const GEMINI_KEY = Deno.env.get("GEMINI_API_KEY") || "";
  /* ONE KEY, BOTH HALVES. GEMINI_API_KEY transcribes and judges; there is no second vendor to
     configure and no second key to rotate. It is never logged, returned or written to a row. */

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
  try { body = await req.json(); } catch { /* an empty body is fine */ }

  const action = String(body.action || "run");
  const trigger = viaCron ? "cron" : "manual";
  const from = isDate(body.from) ? body.from : appYesterday();
  const to = isDate(body.to) ? body.to : (isDate(body.from) ? body.from : from);
  if (from > to) return j({ error: "`from` is after `to`" }, 400);
  if (to > appToday()) return j({ error: "`to` is in the future" }, 400);

  const modelOk = (m: string) => /^[a-zA-Z0-9._:-]{3,80}$/.test(m);
  const reqGemini = String(body.gemini_model || "").trim();
  const reqQa = String(body.qa_model || body.gemini_qa_model || "").trim();
  if (reqGemini && !modelOk(reqGemini)) return j({ error: "that does not look like a Gemini model name" }, 400);
  if (reqQa && !modelOk(reqQa)) return j({ error: "that does not look like a Gemini model name" }, 400);
  const geminiModel = reqGemini || GEMINI_MODEL;
  const qaModel = reqQa || GEMINI_QA_MODEL;

  const needsModels = action === "work" || action === "run" || action === "retry";
  if (needsModels && !GEMINI_KEY) return j({ error: "GEMINI_API_KEY is not set in Edge Function Secrets" }, 500);

  try {
    if (action === "status") {
      const queue: Record<string, number> = {};
      for (const st of ["pending","transcribing","qa_pending","qa_running","completed","skipped_existing","failed"]) {
        const { count } = await db.schema("acc").from("transcription_queue")
          .select("id", { count: "exact", head: true }).eq("status", st);
        queue[st] = count ?? 0;
      }
      /* `*`, not `id`: crm_followups is keyed on follow_up_id and crm_leads on lead_id, so selecting
         an `id` column errored and this reported 0 known follow-ups while the table held 1,267. */
      const one = async (table: string, filter?: (q: any) => any) => {
        let q = db.schema("acc").from(table).select("*", { count: "exact", head: true });
        if (filter) q = filter(q);
        const { count } = await q;
        return count ?? 0;
      };
      const { data: snap } = await db.schema("acc").from("crm_snapshots")
        .select("id, snapshot_date, revision, status, lead_count, followup_count, recording_count, new_recording_count, raw_bytes, error_text, fetched_at")
        .order("fetched_at", { ascending: false }).limit(1).maybeSingle();
      const { data: today } = await db.schema("acc").from("daily_qa_summary_v")
        .select("*").order("date", { ascending: false }).limit(3);
      return j({ ok: true, queue,
                 transcripts: { total: await one("call_transcripts"),
                                completed: await one("call_transcripts", (q) => q.eq("status", "completed")),
                                non_transcribable: await one("call_transcripts", (q) => q.eq("status", "non_transcribable")),
                                failed: await one("call_transcripts", (q) => q.eq("status", "failed")) },
                 qa_results: await one("followup_qa"),
                 followups_known: await one("crm_followups"),
                 leads_known: await one("crm_leads"),
                 last_snapshot: snap || null, recent_days: today || [],
                 transcription_model: geminiModel, qa_model: qaModel,
                 timezone: APP_TZ_NAME, next_snapshot_for: appYesterday(),
                 gemini_key_present: !!GEMINI_KEY });
    }

    if (action === "retry") {
      /* LOOK BEFORE WRITING. A retry resumes at the phase that failed, so retrying a QA failure never
         re-transcribes and never re-bills the audio call. */
      const followUpId = Number(body.follow_up_id || body.id);
      if (!followUpId) return j({ error: "missing follow_up_id" }, 400);
      const { data: row, error: readErr } = await db.schema("acc").from("transcription_queue")
        .select("id, status, fail_phase, transcript_id, attempt_count, qa_attempt_count")
        .eq("follow_up_id", followUpId).maybeSingle();
      if (readErr) return j({ error: readErr.message }, 500);
      if (!row) return j({ error: "no queued recording for that follow-up" }, 404);
      if (IN_FLIGHT.includes(String(row.status))) {
        return j({ error: `that recording is already ${row.status} - wait for it to finish`, queue_status: row.status }, 409);
      }
      if (CLAIMABLE.includes(String(row.status))) {
        return j({ error: `that recording is already queued (${row.status})`, queue_status: row.status }, 409);
      }
      const resumeQa = !body.force_transcribe && (row.fail_phase === "qa" || !!row.transcript_id);
      /* To the BACK of the queue, so a call retried by hand cannot starve the day's own work. */
      const { data: seq } = await db.rpc("next_crm_queue_block", { n: 1 });
      const { data: updated, error } = await db.schema("acc").from("transcription_queue")
        .update({ status: resumeQa ? "qa_pending" : "pending",
                  queue_seq: Number(seq) || Date.now(),
                  started_at: null, finished_at: null, updated_at: nowIso() })
        .eq("id", row.id).eq("status", row.status).select("id, status").maybeSingle();
      if (error) return j({ error: error.message }, 500);
      if (!updated) return j({ error: "that recording changed state just now - try again" }, 409);
      if (resumeQa && body.replace_qa !== false) {
        await db.schema("acc").from("followup_qa").delete().eq("follow_up_id", followUpId);
      }
      return j({ ok: true, follow_up_id: followUpId, resumed_at: updated.status,
                 work: await doWork(db, GEMINI_KEY, geminiModel, qaModel) });
    }

    if (action === "snapshot") {
      const out = await doSnapshot(db, from, to, trigger);
      return out instanceof Response ? out : j({ ok: true, action, ...out });
    }
    if (action === "work") {
      return j({ ok: true, action, ...(await doWork(db, GEMINI_KEY, geminiModel, qaModel)) });
    }
    if (action === "run") {
      const snap = await doSnapshot(db, from, to, trigger);
      if (snap instanceof Response) return snap;
      return j({ ok: true, action, snapshot: snap,
                 work: await doWork(db, GEMINI_KEY, geminiModel, qaModel) });
    }
    return j({ error: `unknown action "${action}"` }, 400);
  } catch (e) {
    return j({ error: String((e as any)?.message || e) }, 500);
  }
});
