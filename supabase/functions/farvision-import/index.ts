// FARVISION GMAIL -> SUPABASE STORAGE
//
// Lightweight: downloads xlsx from Gmail, uploads to Storage, queues for import.
// Parsing happens browser-side (admin panel) where memory is unlimited.
//
// Actions:
//   poll       — daily safety-net (pg_cron)
//   push       — Gmail Pub/Sub webhook
//   renew      — renew Gmail watch (pg_cron every 6 days)
//   unlabel_all — one-time cleanup of test labels
//   debug      — diagnostic Gmail search

import { createClient } from "jsr:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
/* Read at call time, not module load. These were consts evaluated when the isolate booted, so a
   rotated GMAIL_REFRESH_TOKEN was ignored by every warm instance until the function was redeployed -
   which looked exactly like the new token being rejected. Gmail tokens get rotated; this makes that
   take effect on the next request. */
const gmailCreds = () => ({
  clientId: Deno.env.get("GMAIL_CLIENT_ID") || "",
  clientSecret: Deno.env.get("GMAIL_CLIENT_SECRET") || "",
  refreshToken: Deno.env.get("GMAIL_REFRESH_TOKEN") || "",
});
const GMAIL_PUBSUB_TOPIC = Deno.env.get("GMAIL_PUBSUB_TOPIC")!;
const GMAIL_SENDER = Deno.env.get("GMAIL_SENDER_EMAIL") || "customercare2@thejaingroup.com";
const IMPORT_LABEL = "farvision-imported";
const STORAGE_BUCKET = "farvision-imports";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (o: unknown, status = 200) =>
  new Response(JSON.stringify(o), { status, headers: { "Content-Type": "application/json", ...CORS } });

// ─── Gmail Auth ──────────────────────────────────────────────────────────────

let cachedToken: string | null = null;
let tokenExp = 0;
let cachedFor = "";

async function gmailToken(): Promise<string> {
  const { clientId, clientSecret, refreshToken } = gmailCreds();
  // Cache is keyed on the refresh token, so rotating it invalidates the cached access token too.
  if (cachedToken && cachedFor === refreshToken && Date.now() < tokenExp - 30000) return cachedToken;
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, refresh_token: refreshToken, grant_type: "refresh_token" }),
  });
  if (!res.ok) throw new Error("Token refresh failed: " + (await res.text()));
  const d = await res.json();
  cachedToken = d.access_token; tokenExp = Date.now() + (d.expires_in || 3600) * 1000;
  cachedFor = refreshToken;
  return cachedToken!;
}

async function gmail(path: string, opts?: RequestInit) {
  const token = await gmailToken();
  const res = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/${path}`, { ...opts, headers: { Authorization: `Bearer ${token}`, ...(opts?.headers || {}) } });
  if (!res.ok) throw new Error(`Gmail ${path}: ${res.status} ${await res.text()}`);
  return res.json();
}

// ─── Label ───────────────────────────────────────────────────────────────────

async function getOrCreateLabel(): Promise<string> {
  const { labels } = await gmail("labels");
  const e = labels.find((l: any) => l.name === IMPORT_LABEL);
  if (e) return e.id;
  const c = await gmail("labels", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: IMPORT_LABEL, labelListVisibility: "labelShow", messageListVisibility: "show" }) });
  return c.id;
}

async function labelMsg(id: string, labelId: string) {
  await gmail(`messages/${id}/modify`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ addLabelIds: [labelId] }) });
}

// ─── Search & Download ──────────────────────────────────────────────────────

async function findEmails(): Promise<string[]> {
  const q = `from:${GMAIL_SENDER} has:attachment filename:xlsx -label:${IMPORT_LABEL}`;
  // 50: about seventeen emails arrive each morning now (the daily reports plus one Sales Details per
  // project) and a backlog day can carry more. Anything beyond this page is simply left unlabelled
  // and picked up next run.
  const res = await gmail(`messages?q=${encodeURIComponent(q)}&maxResults=50`);
  return (res.messages || []).map((m: any) => m.id);
}

async function emailMeta(id: string) {
  const msg = await gmail(`messages/${id}?format=metadata&metadataHeaders=Subject&metadataHeaders=Date`);
  const h = msg.payload?.headers || [];
  return { subject: h.find((x: any) => x.name === "Subject")?.value || "", date: h.find((x: any) => x.name === "Date")?.value || "" };
}

async function xlsxParts(id: string) {
  const msg = await gmail(`messages/${id}?format=full`);
  return (msg.payload?.parts || []).filter((p: any) => p.filename && /\.xlsx$/i.test(p.filename) && p.body?.attachmentId)
    .map((p: any) => ({ name: p.filename, attId: p.body.attachmentId }));
}

async function downloadAtt(msgId: string, attId: string): Promise<Uint8Array> {
  const att = await gmail(`messages/${msgId}/attachments/${attId}`);
  const b64 = att.data.replace(/-/g, "+").replace(/_/g, "/");
  return Uint8Array.from(atob(b64), c => c.charCodeAt(0));
}

// ─── Upload & Queue ─────────────────────────────────────────────────────────

async function processEmails(db: any) {
  const log: string[] = [];
  const ids = await findEmails();
  log.push(`Found ${ids.length} email(s)`);
  if (!ids.length) return { processed: 0, queued: 0, log };

  // Dedup: skip emails already in the queue
  const { data: existingQueue } = await db.schema("cust").from("import_queue").select("gmail_message_id").not("gmail_message_id", "is", null);
  const alreadyQueued = new Set((existingQueue || []).map((r: any) => r.gmail_message_id));
  const labelId = await getOrCreateLabel();

  // Already queued means the work is done - labelling those is safe and stops them being re-found.
  for (const id of ids.filter((i: string) => alreadyQueued.has(i))) {
    try { await labelMsg(id, labelId); } catch {}
  }

  // EVERY new email, not just the newest. This used to take newIds[0] and then label all of them,
  // which marked emails as imported that were never downloaded - and since the search excludes the
  // label, those reports became permanently invisible rather than merely delayed.
  //
  // Oldest first (Gmail returns newest first) so that when one report type arrives twice in a
  // batch, the newest is processed last and is the one the auto-dismiss below leaves pending.
  const newIds = ids.filter((id: string) => !alreadyQueued.has(id)).reverse();
  log.push(`${newIds.length} new email(s) after dedup`);
  if (!newIds.length) return { processed: 0, queued: 0, log };

  await db.storage.createBucket(STORAGE_BUCKET, { public: false }).catch(() => {});
  let queued = 0, processed = 0;

  for (const msgId of newIds) {
    try {
      const meta = await emailMeta(msgId);
      const parts = await xlsxParts(msgId);
      log.push(`"${meta.subject}" — ${parts.length} xlsx`);
      let allOk = parts.length > 0;
      for (const p of parts) {
        try {
          const data = await downloadAtt(msgId, p.attId);
          const ts = new Date().toISOString().replace(/[:.]/g, "-");
          const path = `${ts}/${p.name}`;
          const { error: ue } = await db.storage.from(STORAGE_BUCKET).upload(path, data, { contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
          if (ue) { log.push(`Upload fail ${p.name}: ${ue.message}`); allOk = false; continue; }
          // Auto-dismiss older pending files of the same report type
          // Report type is the filename prefix before the date stamp (e.g. "Invoice Register Details")
          //
          // EXCEPT Sales Details, which Farvision sends as one file PER PROJECT - eleven files in one
          // thread every morning, all named "Sales Details_<stamp>.xlsx". Dismissing by report type
          // made each one cancel the one before, so only the last project ever got imported (seen
          // 30.09.2026: 10 of 11 marked completed without an import). For Sales Details only an exact
          // re-delivery of the same file, or a file from an earlier day (older than 12 hours), is
          // dismissed; every project file from today's batch stays pending.
          const baseType = p.name.replace(/_\d{14,}\.xlsx$/i, '').replace(/\.xlsx$/i, '').trim();
          if (baseType) {
            const pendingQ = () => db.schema("cust").from("import_queue").select("id").eq("status", "pending");
            let older: any[] | null;
            if (/^sales details$/i.test(baseType)) {
              const dayAgo = new Date(Date.now() - 12 * 3600 * 1000).toISOString();
              const [{ data: same }, { data: stale }] = await Promise.all([
                pendingQ().eq("file_name", p.name),
                pendingQ().ilike("file_name", baseType + "%").lt("created_at", dayAgo),
              ]);
              const dupIds = new Set([...(same || []), ...(stale || [])].map((r: any) => r.id));
              older = [...dupIds].map((id) => ({ id }));
            } else {
              ({ data: older } = await pendingQ().ilike("file_name", baseType + "%"));
            }
            if (older && older.length) {
              await db.schema("cust").from("import_queue").update({ status: "completed", processed_at: new Date().toISOString() }).in("id", older.map((r: any) => r.id));
              log.push(`Auto-dismissed ${older.length} older ${baseType} file(s)`);
            }
          }
          const { error: ie } = await db.schema("cust").from("import_queue").insert({ storage_path: path, file_name: p.name, file_size: data.length, gmail_message_id: msgId, email_subject: meta.subject, email_date: meta.date, status: "pending" });
          if (ie) { log.push(`Queue fail ${p.name}: ${ie.message}`); allOk = false; continue; }
          log.push(`Queued ${p.name} (${(data.length/1024).toFixed(0)}KB)`);
          queued++;
        } catch (e) { log.push(`Fail ${p.name}: ${(e as Error).message}`); allOk = false; }
      }
      // Label ONLY once this email's attachments are safely stored and queued. The label is what
      // removes an email from every future search, so it must never run ahead of the work.
      if (allOk) { try { await labelMsg(msgId, labelId); processed++; } catch (e) { log.push(`Label fail ${msgId}: ${(e as Error).message}`); } }
      else log.push(`Left unlabelled for retry: ${msgId}`);
    } catch (e) { log.push(`Error on ${msgId}: ${(e as Error).message}`); }
  }

  return { processed, queued, log };
}

// ─── Handler ─────────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  try {
    const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
    let body: any = {}; try { body = await req.json(); } catch {}
    const action = body.action || "push";

    if (action === "renew") {
      const r = await gmail("watch", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ topicName: GMAIL_PUBSUB_TOPIC, labelIds: ["INBOX"] }) });
      return json({ ok: true, action: "renew", expiration: r.expiration });
    }
    if (action === "unlabel_all") {
      const labelId = await getOrCreateLabel();
      const { messages } = await gmail(`messages?q=label:${IMPORT_LABEL}&maxResults=50`);
      for (const m of (messages || [])) { await gmail(`messages/${m.id}/modify`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ removeLabelIds: [labelId] }) }); }
      return json({ ok: true, unlabeled: (messages || []).length });
    }
    if (action === "debug") {
      const qs = [`from:${GMAIL_SENDER} has:attachment filename:xlsx -label:${IMPORT_LABEL}`, `from:${GMAIL_SENDER} has:attachment`, `has:attachment filename:xlsx newer_than:1d`];
      const r: any[] = [];
      for (const q of qs) { const res = await gmail(`messages?q=${encodeURIComponent(q)}&maxResults=3`); r.push({ query: q, count: (res.messages || []).length }); }
      return json({ ok: true, results: r });
    }
    /* AUTOMATIC IMPORT (9 Oct 2026). The GitHub Actions job (.github/workflows/farvision-import.yml)
       cannot read the private bucket or write the staging table itself, so it asks here, with the
       shared key kept in acc.job_secrets ('farvision_import'):
         auto_files - today's files, each with a short-lived download link
         auto_stage - one chunk of parsed rows for one file
       Nothing customer facing changes here; cust.fv_import_tick() applies the staged day. */
    if (action === "auto_files" || action === "auto_stage") {
      const key = String(body.key || "");
      const { data: sec } = await db.schema("acc").from("job_secrets").select("value").eq("name", "farvision_import").maybeSingle();
      if (!sec?.value || !key || key !== sec.value) return json({ error: "unauthorized" }, 401);
      if (action === "auto_files") {
        const { data, error } = await db.schema("cust").rpc("fv_auto_files");
        if (error) return json({ error: error.message }, 500);
        const files: any[] = (data as any)?.files || [];
        for (const f of files) {
          if (f.staged) continue;
          const { data: s } = await db.storage.from(STORAGE_BUCKET).createSignedUrl(f.storage_path, 1800);
          f.url = s?.signedUrl || null;
        }
        return json({ ok: true, run_id: (data as any)?.run_id, mode: (data as any)?.mode, files });
      }
      const { error } = await db.schema("cust").rpc("fv_auto_stage", {
        p_run: body.run_id, p_queue: body.queue_id, p_file: body.file_name, p_created: body.created_at || null,
        p_type: body.report_type || null, p_rows_total: body.row_count ?? null, p_chunk: body.chunk ?? 0,
        p_chunks: body.chunks ?? 1, p_rows: body.rows || [], p_parse_error: body.parse_error || null,
      });
      if (error) return json({ error: error.message }, 500);
      return json({ ok: true });
    }
    if (action === "poll" || action === "push") {
      return json({ ok: true, action, ...await processEmails(db) });
    }
    return json({ error: "Unknown action" }, 400);
  } catch (e) { return json({ error: (e as Error).message }, 500); }
});
