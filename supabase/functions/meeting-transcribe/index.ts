// meeting-transcribe - JainE-Meetings recordings, step 2 of 3 (27 Nov 2026).
//
// Takes ONE saved recording (ops_rec_claim), joins its parts from S3 (portal/meetings/recordings/
// <meeting>/<recording>/part-00001.<ext>, part-00002...; the first part holds the file header, so the
// parts joined in order are the whole file), uploads it to Gemini's Files API with the meeting's people,
// and stores what comes back (ops_rec_done): the transcript as spoken, an English version, a summary and
// suggestions (tasks with who and by when, Trying / Future to-dos, obstacles / opportunities, decisions).
// Nothing is added to the meeting here - that is step 3, where the starter or an editor reviews each one.
//
// Who may call it:
//   - pg_cron every two minutes, with x-job-secret = acc.job_secrets 'meeting_transcribe';
//   - any signed-in user (the page pokes it right after a recording is saved, so it starts at once).
// Either way it only works the queue; nobody can point it at a recording or change what it stores.
// The work runs in the background (EdgeRuntime.waitUntil) and the call answers at once. A run that is
// cut off leaves the row 'transcribing'; ops_rec_claim takes it again after 15 minutes, three tries in all.
//
// Deployed with JWT verification OFF (--no-verify-jwt): the cron call carries the secret, not a user token;
// a user's token is checked here against /auth/v1/user.
import { AwsClient } from "https://esm.sh/aws4fetch@1.0.20";

const SB = Deno.env.get("SUPABASE_URL")!;
const SRV = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON = Deno.env.get("SUPABASE_ANON_KEY") || "";
const H = { apikey: SRV, Authorization: "Bearer " + SRV, "Content-Type": "application/json" };
const GKEY = Deno.env.get("GEMINI_API_KEY") || Deno.env.get("GEMINI_KEY") || "";
// The same default as the call transcriptions (transcription-sync): an alias Google repoints; a secret
// MEETING_TRANSCRIBE_MODEL overrides it without a redeploy.
const MODEL = Deno.env.get("MEETING_TRANSCRIBE_MODEL") || Deno.env.get("GEMINI_MODEL") || "gemini-flash-latest";
const MAX_BYTES = 150 * 1024 * 1024; // what one run can hold in memory; the page refuses bigger uploads
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-job-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const j = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { ...cors, "Content-Type": "application/json" } });

async function rpc(fn: string, args: Record<string, unknown>) {
  const r = await fetch(`${SB}/rest/v1/rpc/${fn}`, { method: "POST", headers: H, body: JSON.stringify(args) });
  const t = await r.text();
  if (!r.ok) throw new Error(`${fn} ${r.status} ${t.slice(0, 200)}`);
  try { return JSON.parse(t); } catch (_) { return t; }
}

// The file's kind for Gemini, from the recording's own type or the part's extension.
function mimeFor(rec: any, ext: string): string {
  const m = String(rec.mime || "").split(";")[0].trim().toLowerCase();
  const byExt: Record<string, string> = {
    webm: "audio/webm", ogg: "audio/ogg", opus: "audio/ogg", m4a: "audio/mp4", aac: "audio/aac", mp3: "audio/mp3",
    wav: "audio/wav", flac: "audio/flac", mp4: "video/mp4", "3gp": "video/3gpp", amr: "audio/amr",
  };
  if (m === "audio/mpeg") return "audio/mp3";
  if (m === "audio/x-m4a" || m === "audio/m4a") return "audio/mp4";
  if (/^(audio|video)\//.test(m)) return m;
  return byExt[ext] || "audio/webm";
}

// The same rule as the page's wmRecExt(mime, name): a file name's own extension first, else from the type.
function extFor(rec: any): string {
  const n = String(rec.file_name || "").match(/\.([a-z0-9]{2,5})$/i);
  if (n) return n[1].toLowerCase();
  const m = String(rec.mime || "");
  return /mp4|m4a|aac/.test(m) ? "m4a" : /ogg/.test(m) ? "ogg" : /mpeg|mp3/.test(m) ? "mp3" : /wav/.test(m) ? "wav" : "webm";
}

async function joinParts(rec: any): Promise<{ bytes: Uint8Array; ext: string }> {
  const bucket = Deno.env.get("S3_BUCKET"), region = Deno.env.get("S3_REGION");
  const ak = Deno.env.get("AWS_ACCESS_KEY_ID"), sk = Deno.env.get("AWS_SECRET_ACCESS_KEY");
  if (!bucket || !region || !ak || !sk) throw new Error("S3 secrets are not set");
  const aws = new AwsClient({ accessKeyId: ak, secretAccessKey: sk, region, service: "s3" });
  // The uploader (jaine-s3-uploader) may not list the bucket, so the parts are fetched by number:
  // 1..parts, with the extension worked out exactly as the page did (wmRecExt in 15-weekly-status.js).
  const ext = extFor(rec);
  const n = Number(rec.parts) || 0;
  if (!n) throw new Error("no parts of this recording reached the server");
  const keys = Array.from({ length: n }, (_, i) => `${rec.s3_prefix}part-${String(i + 1).padStart(5, "0")}.${ext}`);
  const chunks: Uint8Array[] = []; let total = 0;
  for (const k of keys) {
    const r = await aws.fetch(`https://${bucket}.s3.${region}.amazonaws.com/${k.split("/").map(encodeURIComponent).join("/")}`);
    if (!r.ok) throw new Error(`could not read ${k.split("/").pop()} (S3 ${r.status})`);
    const b = new Uint8Array(await r.arrayBuffer());
    total += b.byteLength;
    if (total > MAX_BYTES) throw new Error("the recording is over 150 MB - upload a smaller copy (sound only)");
    chunks.push(b);
  }
  const out = new Uint8Array(total); let o = 0;
  for (const c of chunks) { out.set(c, o); o += c.byteLength; }
  return { bytes: out, ext };
}

async function geminiUpload(bytes: Uint8Array, mime: string, name: string) {
  const start = await fetch("https://generativelanguage.googleapis.com/upload/v1beta/files", {
    method: "POST",
    headers: { "x-goog-api-key": GKEY, "X-Goog-Upload-Protocol": "resumable", "X-Goog-Upload-Command": "start",
      "X-Goog-Upload-Header-Content-Length": String(bytes.byteLength), "X-Goog-Upload-Header-Content-Type": mime,
      "Content-Type": "application/json" },
    body: JSON.stringify({ file: { display_name: name } }),
  });
  if (!start.ok) throw new Error(`Gemini upload start ${start.status}: ${(await start.text()).slice(0, 200)}`);
  const url = start.headers.get("x-goog-upload-url");
  if (!url) throw new Error("Gemini gave no upload link");
  const put = await fetch(url, { method: "POST",
    headers: { "Content-Length": String(bytes.byteLength), "X-Goog-Upload-Offset": "0", "X-Goog-Upload-Command": "upload, finalize" },
    body: bytes });
  if (!put.ok) throw new Error(`Gemini upload ${put.status}: ${(await put.text()).slice(0, 200)}`);
  const info = await put.json().catch(() => ({}));
  const uri = info?.file?.uri, fname = info?.file?.name;
  if (!uri) throw new Error("Gemini returned no file");
  let state = info?.file?.state || "PROCESSING";
  for (let i = 0; i < 60 && state === "PROCESSING"; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    const st = await fetch(`https://generativelanguage.googleapis.com/v1beta/${fname}`, { headers: { "x-goog-api-key": GKEY } });
    state = (await st.json().catch(() => ({})))?.state || state;
  }
  if (state !== "ACTIVE") throw new Error(`Gemini could not read the file (state ${state})`);
  return { uri, name: fname as string };
}

function prompt(rec: any): string {
  const d = new Date(String(rec.meeting_date) + "T00:00:00Z");
  const day = d.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
  const staff = (rec.staff || []).map((p: any) => `- ${p.name}${p.dept ? " (" + p.dept + (p.title ? ", " + p.title : "") + ")" : ""}`).join("\n");
  const att = (rec.attendees || []).join(", ") || "not recorded";
  return `This is the sound of a "${rec.kind || "team"}" meeting of the Jain Group (a real estate developer in Kolkata),
held in a room on ${day}${rec.start_time ? " at " + String(rec.start_time).slice(0, 5) : ""}. People speak English, Hindi and Bengali,
often mixed in one sentence. Words you will hear: JainE / JAIN-E (the company's own software), FarVision (a software; never
"Fire Vision"), CRM, RERA, site, flat, booking, possession, Dream Gurukul, Dream Pailan, Jain Group.

People marked present: ${att}
Everyone in the company (use these exact spellings when a name is said):
${staff}

Reply with ONE JSON object, nothing else:
{
  "languages": "the languages spoken, e.g. English, Hindi",
  "transcript": "everything said, in order, one line per turn: 'Name: words' when you can tell who is speaking from the talk itself (someone is addressed by name, or says who they are), otherwise 'Speaker 1:', 'Speaker 2:' kept the same for the same voice. Write each turn in the language it was spoken (Hindi in Devanagari, Bengali in Bengali script). Leave out only silence and noise.",
  "transcript_en": "the same transcript in English, turn by turn, with the same names / Speaker labels. If everything was in English, repeat it.",
  "summary": "5 to 10 short lines in plain English, each starting with '- ': what was discussed and agreed.",
  "decisions": ["each decision taken, one short English sentence"],
  "tasks": [{"title": "what is to be done, a short English imperative ('Send the revised price sheet to sales')",
             "person": "who will do it - EXACTLY a name from the company list above, or '' when no one is named or the name is not in the list",
             "person_said": "the name as it was said, or ''",
             "due": "the deadline as a date YYYY-MM-DD worked out from the meeting date (e.g. 'by Friday' = the coming Friday), or ''",
             "due_said": "the deadline as said ('by Friday', 'next week'), or ''",
             "list": "target (to be done by the next meeting), trying (something the team will try) or future (later)",
             "quote": "the few words where it was given, as spoken, under 20 words"}],
  "todos": [{"text": "an idea to try or work for later that no one was given, short English", "list": "trying or future"}],
  "notes": [{"text": "an obstacle in the way, or an opportunity, short English", "kind": "obstacle or opportunity"}]
}
Only list what was really said. A task needs something to be done; a person only when one was named or clearly answered
"I will do it". Do not invent dates. If the sound has no speech, return empty strings and empty lists.`;
}

function clean(s: unknown, n = 400): string { return String(s ?? "").replace(/\s+/g, " ").trim().slice(0, n); }
function shape(o: any) {
  return {
    languages: clean(o?.languages, 120),
    transcript: String(o?.transcript ?? "").trim(),
    transcript_en: String(o?.transcript_en ?? "").trim(),
    summary: String(o?.summary ?? "").trim().slice(0, 4000),
    decisions: (Array.isArray(o?.decisions) ? o.decisions : []).map((x: unknown) => clean(x)).filter(Boolean).slice(0, 40),
    tasks: (Array.isArray(o?.tasks) ? o.tasks : []).map((t: any) => ({
      title: clean(t?.title, 300), person: clean(t?.person, 120), person_said: clean(t?.person_said, 120),
      due: /^\d{4}-\d{2}-\d{2}$/.test(String(t?.due || "")) ? String(t.due) : "", due_said: clean(t?.due_said, 80),
      list: ["target", "trying", "future"].includes(String(t?.list)) ? String(t.list) : "target", quote: clean(t?.quote, 200),
    })).filter((t: any) => t.title).slice(0, 80),
    todos: (Array.isArray(o?.todos) ? o.todos : []).map((t: any) => ({ text: clean(t?.text, 300), list: t?.list === "future" ? "future" : "trying" }))
      .filter((t: any) => t.text).slice(0, 40),
    notes: (Array.isArray(o?.notes) ? o.notes : []).map((t: any) => ({ text: clean(t?.text, 300), kind: t?.kind === "opportunity" ? "opportunity" : "obstacle" }))
      .filter((t: any) => t.text).slice(0, 40),
  };
}

async function transcribe(rec: any) {
  if (!GKEY) throw new Error("GEMINI_API_KEY is not set");
  const { bytes, ext } = await joinParts(rec);
  const mime = mimeFor(rec, ext);
  const up = await geminiUpload(bytes, mime, `meeting-${rec.meeting_id}-rec-${rec.id}.${ext}`);
  try {
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`, {
      method: "POST", headers: { "Content-Type": "application/json", "x-goog-api-key": GKEY },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ file_data: { mime_type: mime, file_uri: up.uri } }, { text: prompt(rec) }] }],
        generationConfig: { temperature: 0, responseMimeType: "application/json", maxOutputTokens: 65536 },
      }),
    });
    const body = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(`Gemini ${r.status}: ${String(body?.error?.message || "").slice(0, 200)}`);
    const cand = body?.candidates?.[0];
    const text = (cand?.content?.parts || []).map((p: any) => p?.text || "").join("");
    if (!text) throw new Error(`Gemini returned nothing (${cand?.finishReason || body?.promptFeedback?.blockReason || "no reason given"})`);
    let o: any;
    try { o = JSON.parse(text); } catch (_) {
      throw new Error(cand?.finishReason === "MAX_TOKENS" ? "the meeting is too long for one reply - upload it in shorter pieces" : "Gemini's reply was not readable");
    }
    return shape(o);
  } finally {
    // the sound is not left with Google once it is read
    fetch(`https://generativelanguage.googleapis.com/v1beta/${up.name}`, { method: "DELETE", headers: { "x-goog-api-key": GKEY } }).catch(() => {});
  }
}

async function work() {
  const rec = await rpc("ops_rec_claim", {});
  if (!rec || !rec.id) return { idle: true };
  const job = async () => {
    try {
      const s = await transcribe(rec);
      const { transcript, transcript_en, summary, ...sugg } = s;
      await rpc("ops_rec_done", { p_id: rec.id, p_transcript: transcript, p_transcript_en: transcript_en, p_summary: summary,
        p_suggestions: sugg, p_model: MODEL, p_error: null });
      console.log(`[meeting-transcribe] recording ${rec.id}: ready, ${sugg.tasks.length} tasks`);
    } catch (e) {
      const msg = String((e as any)?.message || e);
      console.error(`[meeting-transcribe] recording ${rec.id} (try ${rec.attempt}): ${msg}`);
      try { await rpc("ops_rec_done", { p_id: rec.id, p_transcript: null, p_transcript_en: null, p_summary: null,
        p_suggestions: null, p_model: MODEL, p_error: msg }); } catch (e2) { console.error(String(e2)); }
    }
  };
  const wu = (globalThis as any).EdgeRuntime?.waitUntil;
  if (wu) { (globalThis as any).EdgeRuntime.waitUntil(job()); return { started: rec.id, background: true }; }
  await job();
  return { done: rec.id };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return j({ error: "method not allowed" }, 405);
  let ok = false;
  const secret = req.headers.get("x-job-secret") || "";
  if (secret) {
    const r = await fetch(`${SB}/rest/v1/job_secrets?name=eq.meeting_transcribe&select=value`, { headers: { ...H, "Accept-Profile": "acc" } });
    const rows = await r.json().catch(() => []);
    ok = Array.isArray(rows) && rows[0]?.value === secret;
  }
  if (!ok) {
    const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    if (token && token !== ANON) {
      const who = await fetch(`${SB}/auth/v1/user`, { headers: { Authorization: `Bearer ${token}`, apikey: ANON || SRV } });
      ok = who.ok;
    }
  }
  if (!ok) return j({ error: "unauthorized" }, 401);
  try { return j({ ok: true, ...(await work()) }); }
  catch (e) { return j({ error: String((e as any)?.message || e) }, 500); }
});
