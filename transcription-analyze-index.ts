// Supabase Edge Function: transcription-analyze
// Deployed to project rkxsgtauigjrpcjkmccu (JainE). This file is the source of
// record for the team — keep it in sync with the deployed function.
//
// Powers the Transcription module (Growth & Strategy). Two actions:
//   { action:"start", key, title, name, size }  -> submit a recording to Gladia
//   { action:"poll",  id }                       -> check Gladia + persist result
//
// Recordings live in S3 under portal/transcription/ (signed GET handed to Gladia).
// Transcription/analysis via Gladia v2 (Hindi/English/Bengali, code-switching aware),
// with summary, diarization, sentiment and named-entity recognition.
// Requires Secrets: GLADIA_API_KEY, S3_BUCKET, S3_REGION, AWS_ACCESS_KEY_ID,
// AWS_SECRET_ACCESS_KEY (+ the platform-provided SUPABASE_* vars).

import { AwsClient } from "https://esm.sh/aws4fetch@1.0.20";
import { createClient } from "jsr:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const j = (o: unknown, status = 200) =>
  new Response(JSON.stringify(o), { status, headers: { ...cors, "Content-Type": "application/json" } });

// Languages this system is built for: Hindi, English, Bengali.
const LANGS = ["hi", "en", "bn"];
const GLADIA = "https://api.gladia.io/v2";

async function signGet(key: string): Promise<string | null> {
  const bucket = Deno.env.get("S3_BUCKET");
  const region = Deno.env.get("S3_REGION");
  const ak = Deno.env.get("AWS_ACCESS_KEY_ID");
  const sk = Deno.env.get("AWS_SECRET_ACCESS_KEY");
  if (!bucket || !region || !ak || !sk) return null;
  const aws = new AwsClient({ accessKeyId: ak, secretAccessKey: sk, region, service: "s3" });
  const encKey = key.split("/").map(encodeURIComponent).join("/");
  const u = new URL(`https://${bucket}.s3.${region}.amazonaws.com/${encKey}`);
  u.searchParams.set("X-Amz-Expires", "3600");
  const signed = await aws.sign(u.toString(), { method: "GET", aws: { signQuery: true } });
  return signed.url;
}

function rawKey(k: string): string {
  return String(k || "").replace(/^s3:/, "").replace(/^\/+/, "");
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return j({ error: "method not allowed" }, 405);

  const SB = Deno.env.get("SUPABASE_URL")!;
  const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
  const SRV = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const KEY = Deno.env.get("GLADIA_API_KEY");

  // ---- auth (mirror s3-sign: require a valid logged-in user) ----
  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (!token) return j({ error: "missing token" }, 401);
  const who = await fetch(`${SB}/auth/v1/user`, { headers: { Authorization: `Bearer ${token}`, apikey: ANON } });
  if (!who.ok) return j({ error: "unauthorized" }, 401);
  const me = await who.json().catch(() => ({}));
  const email: string = (me && me.email) || "";

  if (!KEY) return j({ error: "GLADIA_API_KEY not configured in Secrets" }, 500);
  const db = createClient(SB, SRV);

  let body: any = {};
  try { body = await req.json(); } catch { /* ignore */ }
  const action = body.action;

  try {
    // ---------------- START: submit a recording to Gladia ----------------
    if (action === "start") {
      const key = rawKey(body.key);
      if (!key) return j({ error: "missing key" }, 400);
      const url = await signGet(key);
      if (!url) return j({ error: "S3 secrets not configured / could not sign recording" }, 500);

      // Gladia v2: language_config.languages + code_switching enables per-utterance
      // auto-detection across Hindi / English / Bengali.
      const gladiaReq = {
        audio_url: url,
        diarization: true,
        language_config: { languages: LANGS, code_switching: true },
        summarization: true,
        summarization_config: { type: "general" },
        sentiment_analysis: true,
        named_entity_recognition: true,
      };
      const gr = await fetch(`${GLADIA}/pre-recorded`, {
        method: "POST",
        headers: { "x-gladia-key": KEY, "Content-Type": "application/json" },
        body: JSON.stringify(gladiaReq),
      });
      const gj = await gr.json().catch(() => ({}));
      if (!gr.ok || !gj.result_url) return j({ error: "Gladia submit failed (" + gr.status + ")", detail: gj }, 502);

      const { data, error } = await db.schema("acc").from("transcriptions").insert({
        title: body.title || null,
        file_name: body.name || "recording",
        s3_path: "s3:" + key,
        size_bytes: body.size || null,
        status: "processing",
        gladia_id: gj.id || null,
        result_url: gj.result_url,
        created_by: email || null,
      }).select("*").single();
      if (error) return j({ error: error.message }, 500);
      return j({ ok: true, row: data });
    }

    // ---------------- POLL: check Gladia + persist result ----------------
    if (action === "poll") {
      const id = body.id;
      if (!id) return j({ error: "missing id" }, 400);
      const { data: row } = await db.schema("acc").from("transcriptions").select("*").eq("id", id).single();
      if (!row) return j({ error: "not found" }, 404);
      if (row.status === "done" || row.status === "error") return j({ ok: true, row });
      if (!row.result_url) return j({ error: "no result_url on row" }, 400);

      const rr = await fetch(row.result_url, { headers: { "x-gladia-key": KEY } });
      const rj = await rr.json().catch(() => ({}));
      const st = rj && rj.status;

      if (st === "error") {
        await db.schema("acc").from("transcriptions").update({
          status: "error", error_text: JSON.stringify(rj.error || rj).slice(0, 500), updated_at: new Date().toISOString(),
        }).eq("id", id);
        return j({ ok: true, status: "error" });
      }
      if (st !== "done") return j({ ok: true, status: "processing" });

      // ---- parse a completed Gladia result ----
      const res = rj.result || {};
      const tr = res.transcription || {};
      const full: string = tr.full_transcript || "";
      const utterances = Array.isArray(tr.utterances) ? tr.utterances.map((u: any) => ({
        speaker: u.speaker ?? null,
        language: u.language || null,
        text: u.text || "",
        start: u.start ?? null,
        end: u.end ?? null,
      })) : [];
      const langs: string[] = Array.isArray(tr.languages) && tr.languages.length
        ? tr.languages
        : Array.from(new Set(utterances.map((u: any) => u.language).filter(Boolean)));
      const summary: string = (res.summarization && (res.summarization.results || res.summarization.result)) || "";

      // language + speaker breakdown for the analysis panel
      const langCount: Record<string, number> = {};
      const speakers = new Set<string | number>();
      for (const u of utterances) {
        if (u.language) langCount[u.language] = (langCount[u.language] || 0) + 1;
        if (u.speaker !== null && u.speaker !== undefined) speakers.add(u.speaker);
      }
      const meta = res.metadata || rj.metadata || {};
      const analysis = {
        duration: meta.audio_duration ?? null,
        num_speakers: speakers.size,
        languages: langs,
        language_breakdown: langCount,
        utterance_count: utterances.length,
        word_count: full ? full.trim().split(/\s+/).length : 0,
        sentiment: res.sentiment_analysis?.results ?? null,
        entities: res.named_entity_recognition?.results ?? null,
      };

      const { data: updated, error: uerr } = await db.schema("acc").from("transcriptions").update({
        status: "done",
        transcript: full,
        utterances,
        languages: langs,
        summary,
        analysis,
        duration_seconds: meta.audio_duration ?? null,
        updated_at: new Date().toISOString(),
      }).eq("id", id).select("*").single();
      if (uerr) return j({ error: uerr.message }, 500);
      return j({ ok: true, row: updated, status: "done" });
    }

    return j({ error: "unknown action" }, 400);
  } catch (e) {
    return j({ error: String((e as any)?.message || e) }, 500);
  }
});
