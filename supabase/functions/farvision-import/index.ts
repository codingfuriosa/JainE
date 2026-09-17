// FARVISION GMAIL -> SUPABASE STORAGE (Phase 1)
//
// Lightweight edge function that:
//   1. Searches Gmail for unprocessed Farvision xlsx emails
//   2. Downloads the attachments
//   3. Uploads them to Supabase Storage (farvision-imports bucket)
//   4. Inserts a pending row in cust.import_queue
//   5. Labels the email so it's not reprocessed
//
// The actual xlsx parsing happens in the browser (Admin Panel → Farvision Import tab)
// using the existing SheetJS parsers — no heavy xlsx library needed here.
//
// Actions:
//   POST { action: "poll" }   — daily safety-net scan (pg_cron)
//   POST { action: "push" }   — Gmail Pub/Sub webhook (near-instant)
//   POST { action: "renew" }  — renew Gmail watch() (pg_cron every 6 days)

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

let cachedAccessToken: string | null = null;
let tokenExpiresAt = 0;

async function gmailToken(): Promise<string> {
  if (cachedAccessToken && Date.now() < tokenExpiresAt - 30_000) return cachedAccessToken;
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: GMAIL_CLIENT_ID,
      client_secret: GMAIL_CLIENT_SECRET,
      refresh_token: GMAIL_REFRESH_TOKEN,
      grant_type: "refresh_token",
    }),
  });
  if (!res.ok) throw new Error("Gmail token refresh failed: " + (await res.text()));
  const data = await res.json();
  cachedAccessToken = data.access_token;
  tokenExpiresAt = Date.now() + (data.expires_in || 3600) * 1000;
  return cachedAccessToken!;
}

async function gmail(path: string, opts?: RequestInit) {
  const token = await gmailToken();
  const res = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/${path}`, {
    ...opts,
    headers: { Authorization: `Bearer ${token}`, ...(opts?.headers || {}) },
  });
  if (!res.ok) throw new Error(`Gmail ${path}: ${res.status} ${await res.text()}`);
  return res.json();
}

// ─── Gmail Label ─────────────────────────────────────────────────────────────

async function getOrCreateLabel(): Promise<string> {
  const { labels } = await gmail("labels");
  const existing = labels.find((l: any) => l.name === IMPORT_LABEL);
  if (existing) return existing.id;
  const created = await gmail("labels", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: IMPORT_LABEL, labelListVisibility: "labelShow", messageListVisibility: "show" }),
  });
  return created.id;
}

async function labelMessage(messageId: string, labelId: string) {
  await gmail(`messages/${messageId}/modify`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ addLabelIds: [labelId] }),
  });
}

// ─── Gmail Search & Download ─────────────────────────────────────────────────

async function findUnprocessedEmails(): Promise<string[]> {
  const q = `from:${GMAIL_SENDER} has:attachment filename:xlsx -label:${IMPORT_LABEL}`;
  const res = await gmail(`messages?q=${encodeURIComponent(q)}&maxResults=5`);
  return (res.messages || []).map((m: any) => m.id);
}

interface EmailMeta { messageId: string; subject: string; date: string; }

async function getEmailMeta(messageId: string): Promise<EmailMeta> {
  const msg = await gmail(`messages/${messageId}?format=metadata&metadataHeaders=Subject&metadataHeaders=Date`);
  const headers = msg.payload?.headers || [];
  const subject = headers.find((h: any) => h.name === "Subject")?.value || "";
  const date = headers.find((h: any) => h.name === "Date")?.value || "";
  return { messageId, subject, date };
}

interface AttachmentInfo { filename: string; attachmentId: string; size: number; }

async function listXlsxAttachments(messageId: string): Promise<AttachmentInfo[]> {
  const msg = await gmail(`messages/${messageId}?format=full`);
  return (msg.payload?.parts || [])
    .filter((p: any) => p.filename && /\.xlsx$/i.test(p.filename) && p.body?.attachmentId)
    .map((p: any) => ({ filename: p.filename, attachmentId: p.body.attachmentId, size: p.body.size || 0 }));
}

async function downloadAttachment(messageId: string, attachmentId: string): Promise<Uint8Array> {
  const att = await gmail(`messages/${messageId}/attachments/${attachmentId}`);
  const b64 = att.data.replace(/-/g, "+").replace(/_/g, "/");
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

// ─── Storage & Queue ─────────────────────────────────────────────────────────

async function ensureBucket(db: any) {
  // Create bucket if it doesn't exist (private, no public access)
  await db.storage.createBucket(STORAGE_BUCKET, { public: false }).catch(() => {/* already exists */});
}

async function uploadAndQueue(
  db: any, data: Uint8Array, filename: string, emailMeta: EmailMeta, log: string[]
): Promise<boolean> {
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const storagePath = `${ts}/${filename}`;

  // Upload to storage
  const { error: uploadErr } = await db.storage
    .from(STORAGE_BUCKET)
    .upload(storagePath, data, { contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  if (uploadErr) {
    log.push(`UPLOAD FAILED ${filename}: ${uploadErr.message}`);
    return false;
  }
  log.push(`Uploaded ${filename} (${(data.length / 1024).toFixed(0)}KB) → ${storagePath}`);

  // Insert queue row
  const { error: qErr } = await db.schema("cust").from("import_queue").insert({
    storage_path: storagePath,
    file_name: filename,
    file_size: data.length,
    gmail_message_id: emailMeta.messageId,
    email_subject: emailMeta.subject,
    email_date: emailMeta.date,
    status: "pending",
  });
  if (qErr) {
    log.push(`QUEUE INSERT FAILED ${filename}: ${qErr.message}`);
    return false;
  }
  log.push(`Queued ${filename} for import`);
  return true;
}

// ─── Core ────────────────────────────────────────────────────────────────────

async function processEmails(db: any): Promise<{ processed: number; queued: number; log: string[] }> {
  const log: string[] = [];
  const messageIds = await findUnprocessedEmails();
  log.push(`Found ${messageIds.length} unprocessed email(s)`);
  if (!messageIds.length) return { processed: 0, queued: 0, log };

  await ensureBucket(db);
  const labelId = await getOrCreateLabel();
  let processed = 0, queued = 0;

  for (const msgId of messageIds) {
    try {
      const meta = await getEmailMeta(msgId);
      const attachments = await listXlsxAttachments(msgId);
      log.push(`Email "${meta.subject}" (${msgId}): ${attachments.length} xlsx file(s)`);

      let anyQueued = false;
      for (const att of attachments) {
        try {
          const data = await downloadAttachment(msgId, att.attachmentId);
          const ok = await uploadAndQueue(db, data, att.filename, meta, log);
          if (ok) { anyQueued = true; queued++; }
        } catch (err) {
          log.push(`FAILED ${att.filename}: ${(err as Error).message}`);
        }
      }

      if (anyQueued || attachments.length === 0) {
        await labelMessage(msgId, labelId);
        log.push(`Labeled email ${msgId}`);
        processed++;
      }
    } catch (err) {
      log.push(`ERROR email ${msgId}: ${(err as Error).message}`);
    }
  }

  return { processed, queued, log };
}

// ─── Gmail Watch ─────────────────────────────────────────────────────────────

async function renewWatch(): Promise<any> {
  return gmail("watch", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ topicName: GMAIL_PUBSUB_TOPIC, labelIds: ["INBOX"] }),
  });
}

// ─── HTTP Handler ────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });

  try {
    const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
    let body: any = {};
    try { body = await req.json(); } catch { /* empty body ok for push */ }

    const action = body.action || "push";

    if (action === "renew") {
      const result = await renewWatch();
      return json({ ok: true, action: "renew", expiration: result.expiration });
    }

    if (action === "debug") {
      // Broad search to diagnose why emails aren't found
      const token = await gmailToken();
      const queries = [
        `from:${GMAIL_SENDER} has:attachment filename:xlsx -label:${IMPORT_LABEL}`,
        `from:${GMAIL_SENDER} has:attachment`,
        `from:${GMAIL_SENDER}`,
        `has:attachment filename:xlsx`,
        `newer_than:1d has:attachment`,
      ];
      const results: any[] = [];
      for (const q of queries) {
        const res = await gmail(`messages?q=${encodeURIComponent(q)}&maxResults=3`);
        results.push({ query: q, count: (res.messages || []).length, ids: (res.messages || []).map((m: any) => m.id) });
      }
      return json({ ok: true, sender: GMAIL_SENDER, label: IMPORT_LABEL, results });
    }

    if (action === "poll" || action === "push") {
      const result = await processEmails(db);
      return json({ ok: true, action, ...result });
    }

    if (action === "process_id" && body.messageId) {
      // Force-process a specific email by ID (ignores label)
      const log: string[] = [];
      await ensureBucket(db);
      const meta = await getEmailMeta(body.messageId);
      const attachments = await listXlsxAttachments(body.messageId);
      log.push(`Email "${meta.subject}" (${body.messageId}): ${attachments.length} xlsx file(s)`);
      let queued = 0;
      for (const att of attachments) {
        const data = await downloadAttachment(body.messageId, att.attachmentId);
        const ok = await uploadAndQueue(db, data, att.filename, meta, log);
        if (ok) queued++;
      }
      return json({ ok: true, action, queued, log });
    }

    return json({ error: "Unknown action: " + action }, 400);
  } catch (err) {
    console.error("farvision-import error:", err);
    return json({ error: (err as Error).message }, 500);
  }
});
