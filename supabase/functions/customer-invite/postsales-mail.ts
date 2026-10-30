// POST SALES CUSTOMER TICKETS FROM GMAIL (30 Oct 2026, as asked).
// See supabase/migrations/20261030120000_postsales_customer_tickets.sql.
//
//   { action: "postsales_mail_sync" }   THE JOB ONLY (x-audit-secret), every 10 minutes.
//
// Pallabita Ghosh's mailbox is opened READ-ONLY (IMAP EXAMINE of Gmail's All Mail), so nothing is
// marked read, moved or deleted. Each message newer than the last one seen is read once:
//   - from a customer (anyone outside the company, not an automatic mail) -> it joins the ticket for
//     its Gmail conversation, or starts one, and the ticket is marked for Gemini to read;
//   - from Pallabita herself, in a conversation that already has a ticket -> it is her reply, which
//     is what moves a ticket from "open" to "answered" and gives the reply times.
// Gemini then reads each ticket's latest messages for its category, a one-line summary, urgency, and
// whether it is a real customer issue at all. The sender is matched to the customer from Farvision.

import { Imap } from "./booking-bounce.ts";

type J = (o: unknown, status?: number) => Response;
const GKEY = Deno.env.get("GEMINI_API_KEY") || Deno.env.get("GEMINI_KEY") || "";
const MODEL = Deno.env.get("TICKET_MODEL") || "gemini-flash-latest";
const PER_RUN = 50, AI_PER_RUN = 8, BUDGET_MS = 110_000, BACKFILL_DAYS = 30;
const CATEGORIES = ["Payment & Receipts", "Demand / Invoice", "Documents & Agreement", "Registration",
  "Possession & Handover", "Construction Progress", "Maintenance & Repairs", "Home Loan & Bank",
  "Cancellation & Refund", "Complaint", "General Enquiry", "Other"];
const MON = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const imapDate = (d: Date) => `${d.getUTCDate()}-${MON[d.getUTCMonth()]}-${d.getUTCFullYear()}`;

/* ---------------- the smallest MIME reader that does the job ---------------- */
function decodeQP(s: string) { return s.replace(/=\r?\n/g, "").replace(/=([0-9A-Fa-f]{2})/g, (_m, h) => String.fromCharCode(parseInt(h, 16))); }
function bytesToText(bin: string, charset: string) {
  const b = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) b[i] = bin.charCodeAt(i) & 255;
  try { return new TextDecoder(charset || "utf-8").decode(b); } catch { return new TextDecoder("utf-8").decode(b); }
}
// "=?UTF-8?B?...?=" and "=?utf-8?Q?...?=" words, as subjects and names are written.
function decodeWords(s: string) {
  return String(s || "").replace(/\?=\s+=\?/g, "?==?").replace(/=\?([^?]+)\?([BbQq])\?([^?]*)\?=/g, (_m, cs, enc, txt) => {
    try {
      const bin = enc.toUpperCase() === "B" ? atob(txt) : decodeQP(txt.replace(/_/g, " "));
      return bytesToText(bin, cs);
    } catch { return txt; }
  });
}
function headersOf(block: string) {
  const h: Record<string, string> = {};
  const lines = block.replace(/\r\n[ \t]+/g, " ").split(/\r?\n/);
  for (const l of lines) { const i = l.indexOf(":"); if (i > 0) { const k = l.slice(0, i).trim().toLowerCase(); if (!(k in h)) h[k] = l.slice(i + 1).trim(); } }
  return h;
}
function splitMsg(raw: string) { const i = raw.search(/\r?\n\r?\n/); return i < 0 ? { head: raw, body: "" } : { head: raw.slice(0, i), body: raw.slice(i).replace(/^\r?\n\r?\n/, "") }; }
function param(v: string, name: string) { const m = String(v || "").match(new RegExp(name + '\\s*=\\s*"?([^";]+)"?', "i")); return m ? m[1] : ""; }
// The readable text of a message: its text/plain part, or its HTML with the tags taken out.
function bodyText(raw: string, depth = 0): { text: string; html: boolean } {
  const { head, body } = splitMsg(raw); const h = headersOf(head);
  const ct = (h["content-type"] || "text/plain").toLowerCase(), enc = (h["content-transfer-encoding"] || "").toLowerCase();
  if (ct.startsWith("multipart/") && depth < 5) {
    const b = param(h["content-type"] || "", "boundary"); if (!b) return { text: "", html: false };
    const parts = body.split("--" + b).slice(1).filter((p) => !p.startsWith("--"));
    let html: { text: string; html: boolean } | null = null;
    for (const p of parts) { const r = bodyText(p.replace(/^\r?\n/, ""), depth + 1); if (r.text && !r.html) return r; if (r.text && !html) html = r; }
    return html || { text: "", html: false };
  }
  if (!ct.startsWith("text/")) return { text: "", html: false };
  let bin = body;
  if (enc === "base64") { try { bin = atob(body.replace(/\s+/g, "")); } catch { bin = ""; } }
  else if (enc === "quoted-printable") bin = decodeQP(body);
  let t = bytesToText(bin, param(h["content-type"] || "", "charset") || "utf-8");
  const isHtml = ct.startsWith("text/html");
  if (isHtml) t = t.replace(/<style[\s\S]*?<\/style>|<script[\s\S]*?<\/script>/gi, "").replace(/<br\s*\/?>|<\/p>|<\/div>|<\/tr>/gi, "\n")
    .replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"');
  return { text: t, html: isHtml };
}
// What the customer wrote this time: the earlier conversation quoted underneath is cut off.
function newText(t: string) {
  const lines = String(t || "").replace(/\r/g, "").split("\n"), out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (/^On .{6,200}(wrote|écrit):?\s*$/i.test(l) || (/^On .{6,120}$/.test(l) && /wrote:?\s*$/i.test(lines[i + 1] || ""))) break;
    if (/^-{2,}\s*Original Message\s*-{2,}/i.test(l) || /^_{6,}\s*$/.test(l)) break;
    if (/^From:\s.+/i.test(l) && /^(Sent|Date):\s/i.test(lines[i + 1] || "")) break;
    if (/^>/.test(l)) continue;
    out.push(l);
  }
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim().slice(0, 6000);
}
function addrOf(v: string) {
  const s = decodeWords(v || ""); const m = s.match(/^\s*"?([^"<]*)"?\s*<([^>]+)>/);
  if (m) return { name: m[1].trim(), email: m[2].trim().toLowerCase() };
  const e = (s.match(/[^\s<>,;"]+@[^\s<>,;"]+/) || [""])[0].toLowerCase(); return { name: "", email: e };
}
function addrList(v: string) { return String(v || "").split(",").map((x) => addrOf(x).email).filter(Boolean); }

const AUTO_FROM = /(mailer-daemon|postmaster|no-?reply|donotreply|do-not-reply|notifications?@|alerts?@|newsletter|bounce|calendar-notification|@.*\.(amazonses|sendgrid|mailchimp)\.)/i;
function isAutomatic(h: Record<string, string>, from: string) {
  if (AUTO_FROM.test(from)) return true;
  const auto = (h["auto-submitted"] || "").toLowerCase(); if (auto && auto !== "no") return true;
  if (h["list-unsubscribe"] || h["list-id"]) return true;
  if (/bulk|list|junk/i.test(h["precedence"] || "")) return true;
  return false;
}

/* ---------------- Gemini: what the ticket is about ---------------- */
async function classify(msgs: any[]) {
  const convo = msgs.map((m) => `[${m.direction === "in" ? "CUSTOMER" : "JAIN GROUP"} · ${m.sent_at}]\nSubject: ${m.subject}\n${String(m.body || "").slice(0, 2500)}`).join("\n\n---\n\n");
  const prompt = `This is an email conversation between a home buyer (or someone else) and the Post Sales team of
The Jain Group, a real estate developer in Kolkata. Read it and answer ONLY with JSON:
{"is_ticket": true if the customer is raising an issue, request or question that Post Sales has to act on or answer;
  false for a thank-you, an advertisement, a newsletter, spam, or an automatic message,
 "category": one of ${JSON.stringify(CATEGORIES)},
 "summary": one sentence, at most 25 words, saying what the customer wants or what is wrong,
 "urgency": "high" (a legal threat, a cancellation, money already overdue, a safety or water/power problem, a repeated complaint), "normal", or "low"}

${convo}`;
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`, {
    method: "POST", headers: { "Content-Type": "application/json", "x-goog-api-key": GKEY },
    body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { temperature: 0, responseMimeType: "application/json", maxOutputTokens: 1024 } }) });
  if (!r.ok) throw new Error("Gemini " + r.status + " " + (await r.text()).slice(0, 160));
  const g = await r.json();
  const raw = String(g?.candidates?.[0]?.content?.parts?.[0]?.text || "");
  let a: any = null; try { a = JSON.parse(raw); } catch { const m = raw.match(/\{[\s\S]*\}/); a = m ? JSON.parse(m[0]) : null; }
  if (Array.isArray(a)) a = a[0];
  if (!a) throw new Error("Gemini gave no answer");
  return { is_ticket: a.is_ticket !== false, category: CATEGORIES.includes(a.category) ? a.category : "Other",
    summary: String(a.summary || "").slice(0, 300), urgency: ["high", "normal", "low"].includes(a.urgency) ? a.urgency : "normal" };
}

/* ---------------- the job ---------------- */
export async function postsalesMailSync(req: Request, db: any, j: J): Promise<Response> {
  const acc = db.schema("acc"), PS = db.schema("postsales");
  const secret = req.headers.get("x-audit-secret") || "";
  const { data: s } = await acc.from("job_secrets").select("value").eq("name", "booking_audit").maybeSingle();
  if (!secret || !s?.value || s.value !== secret) return j({ error: "unauthorized" }, 401);
  const CU = Deno.env.get("CUSTOMER_MAIL_USER"), CP = Deno.env.get("CUSTOMER_MAIL_APP_PASSWORD");
  if (!CU || !CP) return j({ error: "Pallabita Ghosh's mailbox is not connected." }, 500);
  const me = CU.toLowerCase(), started = Date.now();
  const rep: any = { read: 0, tickets_new: 0, replies: 0, skipped: 0, classified: 0, errors: [] as string[] };

  const { data: st } = await PS.from("mail_sync_state").select("*").eq("mailbox", me).maybeSingle();
  const imap = new Imap();
  try {
    await imap.open(CU, CP);
    // Gmail's All Mail holds both the customers' emails and her replies; found by its \All flag.
    const list = await imap.cmd('LIST "" "*"');
    const allLine = list.split(/\r?\n/).find((l) => /\\All\b/.test(l)) || "";
    const allBox = (allLine.match(/"([^"]+)"\s*$/) || allLine.match(/ (\S+)\s*$/) || [])[1] || "[Gmail]/All Mail";
    const sel = await imap.cmd(`EXAMINE "${allBox.replace(/"/g, '\\"')}"`);      // read-only
    const uv = (sel.match(/UIDVALIDITY (\d+)/i) || [])[1] || "0";
    let uids: number[];
    if (st && st.uidvalidity === uv && st.last_uid > 0) {
      const f = await imap.cmd(`UID SEARCH UID ${Number(st.last_uid) + 1}:*`);
      uids = ((f.match(/^\* SEARCH([^\r\n]*)/m) || [])[1] || "").trim().split(/\s+/).filter(Boolean).map(Number).filter((u) => u > Number(st.last_uid));
    } else {
      const f = await imap.cmd(`UID SEARCH SINCE ${imapDate(new Date(Date.now() - BACKFILL_DAYS * 86400e3))}`);
      uids = ((f.match(/^\* SEARCH([^\r\n]*)/m) || [])[1] || "").trim().split(/\s+/).filter(Boolean).map(Number);
    }
    uids.sort((a, b) => a - b);
    let last = (st && st.uidvalidity === uv) ? Number(st.last_uid) : 0;
    for (const uid of uids.slice(0, PER_RUN)) {
      if (Date.now() - started > BUDGET_MS) break;
      const got = await imap.cmd(`UID FETCH ${uid} (X-GM-THRID X-GM-MSGID BODY.PEEK[]<0.200000>)`);
      last = uid; rep.read++;
      const thr = (got.match(/X-GM-THRID (\d+)/) || [])[1] || "";
      const gmid = (got.match(/X-GM-MSGID (\d+)/) || [])[1] || "";
      const mk = got.match(/BODY\[\]<0> \{\d+\}\r\n/);
      if (!mk || !thr) { rep.skipped++; continue; }
      let raw = got.slice(got.indexOf(mk[0]) + mk[0].length);
      const end = raw.lastIndexOf(")\r\n"); if (end > 0) raw = raw.slice(0, end);
      const { head } = splitMsg(raw); const h = headersOf(head);
      const from = addrOf(h["from"] || ""), dir = from.email === me ? "out" : "in";
      const internal = /@thejaingroup\.com$/i.test(from.email);
      if (dir === "in" && (internal || isAutomatic(h, from.email))) { rep.skipped++; continue; }
      const sent = new Date(h["date"] || Date.now()); const sentAt = isNaN(sent.getTime()) ? new Date().toISOString() : sent.toISOString();
      const subject = decodeWords(h["subject"] || "").slice(0, 300);
      const thread = "gmail:" + thr;
      let { data: t } = await PS.from("tickets").select("*").eq("thread_key", thread).maybeSingle();
      if (!t && dir === "out") { rep.skipped++; continue; }        // her own mail with no customer in it: not a ticket
      const body = newText(bodyText(raw).text);
      if (!t) {
        const { data: cust } = await PS.rpc("match_customer", { p_email: from.email });
        const c = Array.isArray(cust) ? cust[0] : null;
        const { data: ins, error } = await PS.from("tickets").insert({ channel: "email", thread_key: thread, customer_email: from.email,
          customer_name: (c && c.customer_name) || from.name || null, customer_phone: c?.customer_phone || null, unit_id: c?.unit_id || null,
          project: c?.project || null, tower: c?.tower || null, unit_code: c?.unit_code || null,
          subject, status: "open", first_received_at: sentAt, last_customer_at: sentAt, messages: 0, needs_ai: true }).select("*").single();
        if (error) { rep.errors.push(error.message); continue; }
        t = ins; rep.tickets_new++;
      }
      const { error: me2 } = await PS.from("ticket_messages").insert({ ticket_id: t.id, mailbox: me, message_key: `${me}:${uv}:${uid}`,
        thread_key: thread, gmail_msgid: gmid, rfc_message_id: h["message-id"] || null, direction: dir,
        from_email: from.email, from_name: from.name || null, to_emails: addrList(h["to"] || ""), subject, sent_at: sentAt, body });
      if (me2) { if (!/duplicate/i.test(me2.message)) rep.errors.push(me2.message); continue; }
      const upd: any = { messages: (t.messages || 0) + 1, updated_at: new Date().toISOString() };
      if (dir === "in") {
        upd.last_customer_at = (!t.last_customer_at || sentAt > t.last_customer_at) ? sentAt : t.last_customer_at;
        if (!t.first_received_at || sentAt < t.first_received_at) upd.first_received_at = sentAt;
        upd.needs_ai = true;
        if (t.status === "resolved" || !t.last_reply_at || upd.last_customer_at > t.last_reply_at) upd.status = "open";
      } else {
        rep.replies++;
        if (!t.first_reply_at && sentAt >= (t.first_received_at || sentAt)) upd.first_reply_at = sentAt;
        upd.last_reply_at = (!t.last_reply_at || sentAt > t.last_reply_at) ? sentAt : t.last_reply_at;
        if (t.status !== "resolved" && upd.last_reply_at >= (t.last_customer_at || "")) upd.status = "answered";
      }
      await PS.from("tickets").update(upd).eq("id", t.id);
    }
    await PS.from("mail_sync_state").upsert({ mailbox: me, uidvalidity: uv, last_uid: last, last_run_at: new Date().toISOString(),
      last_error: rep.errors[0] || null, last_count: rep.read }, { onConflict: "mailbox" });
    rep.remaining = Math.max(0, uids.length - rep.read);
  } catch (e) {
    const m = String((e as Error)?.message || e).slice(0, 300);
    await PS.from("mail_sync_state").upsert({ mailbox: me, last_run_at: new Date().toISOString(), last_error: m }, { onConflict: "mailbox" });
    return j({ error: "Mailbox read failed: " + m, ...rep }, 502);
  } finally { await imap.close(); }

  // ---- Gemini on the tickets that have something new to read
  if (GKEY) {
    const { data: due } = await PS.from("tickets").select("id").eq("needs_ai", true).order("last_customer_at", { ascending: false }).limit(AI_PER_RUN);
    for (const d of due || []) {
      if (Date.now() - started > BUDGET_MS + 25_000) break;
      try {
        const { data: msgs } = await PS.from("ticket_messages").select("direction,subject,body,sent_at").eq("ticket_id", d.id).order("sent_at", { ascending: false }).limit(5);
        const a = await classify((msgs || []).reverse());
        await PS.from("tickets").update({ ...a, needs_ai: false, ai_at: new Date().toISOString(), ai_error: null }).eq("id", d.id);
        rep.classified++;
      } catch (e) { await PS.from("tickets").update({ ai_error: String((e as Error)?.message || e).slice(0, 200) }).eq("id", d.id); }
    }
  }
  return j({ ok: true, ...rep });
}
