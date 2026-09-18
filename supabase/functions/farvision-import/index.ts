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
const GMAIL_CLIENT_ID = Deno.env.get("GMAIL_CLIENT_ID")!;
const GMAIL_CLIENT_SECRET = Deno.env.get("GMAIL_CLIENT_SECRET")!;
const GMAIL_REFRESH_TOKEN = Deno.env.get("GMAIL_REFRESH_TOKEN")!;
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

async function gmailToken(): Promise<string> {
  if (cachedToken && Date.now() < tokenExp - 30000) return cachedToken;
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: GMAIL_CLIENT_ID, client_secret: GMAIL_CLIENT_SECRET, refresh_token: GMAIL_REFRESH_TOKEN, grant_type: "refresh_token" }),
  });
  if (!res.ok) throw new Error("Token refresh failed: " + (await res.text()));
  const d = await res.json();
  cachedToken = d.access_token; tokenExp = Date.now() + (d.expires_in || 3600) * 1000;
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
  const res = await gmail(`messages?q=${encodeURIComponent(q)}&maxResults=5`);
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
  const newIds = ids.filter((id: string) => !alreadyQueued.has(id));
  log.push(`${newIds.length} new email(s) after dedup`);
  if (!newIds.length) {
    // All already queued — just label them so they stop appearing
    const labelId = await getOrCreateLabel();
    for (const id of ids) { try { await labelMsg(id, labelId); } catch {} }
    return { processed: 0, queued: 0, log };
  }

  // Only queue the NEWEST email — older versions of the same report are stale.
  // Gmail returns newest first, so take only the first new one.
  const latestId = newIds[0];
  log.push(`Processing only newest email: ${latestId}`);

  await db.storage.createBucket(STORAGE_BUCKET, { public: false }).catch(() => {});
  const labelId = await getOrCreateLabel();
  let queued = 0;

  try {
    const meta = await emailMeta(latestId);
    const parts = await xlsxParts(latestId);
    log.push(`"${meta.subject}" — ${parts.length} xlsx`);
    for (const p of parts) {
      try {
        const data = await downloadAtt(latestId, p.attId);
        const ts = new Date().toISOString().replace(/[:.]/g, "-");
        const path = `${ts}/${p.name}`;
        const { error: ue } = await db.storage.from(STORAGE_BUCKET).upload(path, data, { contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
        if (ue) { log.push(`Upload fail: ${ue.message}`); return { processed: 0, queued, log }; }
        await db.schema("cust").from("import_queue").insert({ storage_path: path, file_name: p.name, file_size: data.length, gmail_message_id: latestId, email_subject: meta.subject, email_date: meta.date, status: "pending" });
        log.push(`Queued ${p.name} (${(data.length/1024).toFixed(0)}KB)`);
        queued++;
      } catch (e) { log.push(`Fail ${p.name}: ${(e as Error).message}`); }
    }
    // Label ALL emails (including older ones) so they don't reappear
    for (const id of ids) { try { await labelMsg(id, labelId); } catch {} }
  } catch (e) { log.push(`Error: ${(e as Error).message}`); }

  return { processed: 1, queued, log };
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
    if (action === "poll" || action === "push") {
      return json({ ok: true, action, ...await processEmails(db) });
    }
    return json({ error: "Unknown action" }, 400);
  } catch (e) { return json({ error: (e as Error).message }, 500); }
});
