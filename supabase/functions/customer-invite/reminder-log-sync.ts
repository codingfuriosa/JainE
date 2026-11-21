// REMINDER LOG FROM THE MAILBOXES (20 Nov 2026, Ayush: "weekly check if any new Reminder only emails have come and
// store it in the Log, and if done through JainE it stores automatically").
//
//   { action: "reminder_log_sync", days?: 8 }   the weekly job (x-audit-secret) or a signed-in Post Sales person
//
// Reads the Sent folders of customercare2 (Riya Roy) and customercare1 (Pallabita Ghosh) READ-ONLY (IMAP EXAMINE),
// finds the reminder emails ("A Kind Request To Clear Your Dues") that did NOT come from JAIN-E - those are already
// in the log, sent with a "Reminder Letter - <booking>.pdf" - i.e. the ones Farvision sends through the mailbox, and
// adds each to postsales.reminder_send_log once (by Gmail's message id, or same address within 2 minutes): when, to
// whom, which booking (matched by the email address and amount in Farvision's latest Outstanding file), the amount
// the email gave and the letter's file name. Nothing in the mailbox is changed. Stops after ~100 s and says so.

import { Imap } from "./booking-bounce.ts";
type J = (o: unknown, status?: number) => Response;
const SUBJECT = "A Kind Request To Clear Your Dues";

function bodyText(raw: string): string {
  const parts = raw.split(/\r?\n--[^\r\n]+\r?\n/);
  const pick = (type: string) => parts.find((p) => new RegExp("content-type:\\s*" + type, "i").test(p));
  const p = pick("text/plain") || pick("text/html") || raw;
  const i = p.search(/\r?\n\r?\n/); let body = i >= 0 ? p.slice(i).trim() : p;
  const head = i >= 0 ? p.slice(0, i) : "";
  const u8 = (bin: string) => new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0) & 255));
  try {
    if (/transfer-encoding:\s*base64/i.test(head)) body = u8(atob(body.replace(/[^A-Za-z0-9+/=]/g, "")));
    else if (/transfer-encoding:\s*quoted-printable/i.test(head)) body = u8(body.replace(/=\r?\n/g, "").replace(/=([0-9A-Fa-f]{2})/g, (_m, h) => String.fromCharCode(parseInt(h, 16))));
  } catch { /* as is */ }
  if (/text\/html/i.test(head)) body = body.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ");
  return body.replace(/\s+/g, " ").trim();
}
const projName = (s: unknown) => String(s || "").replace(/\(.*?\)/g, "").replace(/\s+/g, " ").trim().toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());

export async function reminderLogSync(req: Request, body: any, db: any, j: J, SB: string, createClient: any): Promise<Response> {
  const t0 = Date.now();
  // who may run it: the weekly job, or a signed-in person with the Post Sales module
  const acc = db.schema("acc"), PS = db.schema("postsales");
  const secret = req.headers.get("x-audit-secret") || "";
  let runBy = "weekly job";
  if (secret) {
    const { data: s } = await acc.from("job_secrets").select("value").eq("name", "booking_audit").maybeSingle();
    if (!s?.value || s.value !== secret) return j({ error: "unauthorized" }, 401);
  } else {
    const bearer = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    const asUser = createClient(SB, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: "Bearer " + bearer } } });
    const { data: who } = await asUser.auth.getUser();
    if (!who?.user?.email) return j({ error: "Please sign in again." }, 401);
    const { data: ok } = await asUser.schema("app").rpc("has_module", { p_module: "postsales" });
    if (ok !== true) return j({ error: "Only people with the Post Sales module can do this." }, 403);
    runBy = String(who.user.email).toLowerCase();
  }
  const days = Math.min(400, Math.max(1, Number(body?.days) || 8));
  const since = new Date(Date.now() - (days + 1) * 864e5).toISOString();

  // Farvision's latest Outstanding file: email -> bookings (to name the customer)
  const { data: ob } = await db.schema("cust").from("import_batches").select("raw_rows").eq("import_type", "outstanding").eq("status", "completed")
    .order("imported_at", { ascending: false }).limit(1).maybeSingle();
  const byEmail: Record<string, any[]> = {};
  ((ob?.raw_rows) || []).forEach((x: any) => { const e = String(x?.email || "").trim().toLowerCase(); if (e && x.bookingNo) (byEmail[e] = byEmail[e] || []).push(x); });
  const { data: ct } = await db.schema("cust").from("farvision_contacts").select("booking_no, contact_email").is("deleted_at", null).not("contact_email", "is", null);
  const rowsByBk: Record<string, any> = {}; ((ob?.raw_rows) || []).forEach((x: any) => { if (x?.bookingNo) rowsByBk[x.bookingNo] = x; });
  (ct || []).forEach((c: any) => { const e = String(c.contact_email || "").trim().toLowerCase(), x = rowsByBk[c.booking_no];
    if (e && x && !(byEmail[e] || []).some((y) => y.bookingNo === x.bookingNo)) (byEmail[e] = byEmail[e] || []).push(x); });

  // what the log already has, to add each email once
  let hasMailId = true;
  let ex: any = await PS.from("reminder_send_log").select("recipient_email, sent_at, mail_id").gte("sent_at", since).limit(20000);
  if (ex.error) { hasMailId = false; ex = await PS.from("reminder_send_log").select("recipient_email, sent_at").gte("sent_at", since).limit(20000); }
  const ids = new Set((ex.data || []).map((r: any) => r.mail_id).filter(Boolean));
  const seen = (ex.data || []).map((r: any) => ({ to: String(r.recipient_email || "").toLowerCase(), t: Date.parse(r.sent_at) }));
  const already = (to: string, t: number, id: string) => (id && ids.has(id)) || seen.some((s: any) => s.to === to && Math.abs(s.t - t) < 120e3);

  const boxes = [["customercare2@ (Riya Roy)", Deno.env.get("REMINDER_MAIL_USER"), Deno.env.get("REMINDER_MAIL_APP_PASSWORD")],
                 ["customercare1@ (Pallabita Ghosh)", Deno.env.get("CUSTOMER_MAIL_USER"), Deno.env.get("CUSTOMER_MAIL_APP_PASSWORD")]];
  const rep: any[] = []; let more = false;
  for (const [label, u, p] of boxes) {
    if (!u || !p) { rep.push({ mailbox: label, error: "not connected" }); continue; }
    const r = { mailbox: label, found: 0, jaine: 0, known: 0, added: 0, unmatched: 0, errors: 0 };
    const imap = new Imap();
    try {
      await imap.open(u, p);
      const list = await imap.cmd('LIST "" "*"');
      const allLine = list.split("\n").find((l: string) => /\\All\b/.test(l)) || "";
      const allBox = (allLine.match(/"([^"]+)"\s*$/) || allLine.match(/ (\S+)\s*$/) || [])[1] || "[Gmail]/All Mail";
      await imap.cmd(`EXAMINE "${allBox.replace(/"/g, '\\"')}"`);
      const q = `in:sent subject:"${SUBJECT}" newer_than:${days}d`;
      const f = await imap.cmd(`UID SEARCH X-GM-RAW "${q.replace(/"/g, '\\"')}"`);
      const uids = ((f.match(/\* SEARCH([\d ]*)/) || [])[1] || "").trim().split(/\s+/).filter(Boolean).map(Number).sort((a, b) => a - b);
      r.found = uids.length;
      for (const uid of uids) {
        if (Date.now() - t0 > 100_000) { more = true; break; }
        try {
          const h = await imap.cmd(`UID FETCH ${uid} (X-GM-MSGID INTERNALDATE BODY.PEEK[HEADER.FIELDS (TO)])`);
          const mid = (h.match(/X-GM-MSGID (\d+)/) || [])[1] || "";
          const when = Date.parse((h.match(/INTERNALDATE "([^"]+)"/) || [])[1] || "");
          const to = (((h.match(/^To:\s*([^\r\n]*)/mi) || [])[1] || "").match(/[^\s<>",;]+@[^\s<>",;]+/) || [""])[0].toLowerCase();
          if (!to || !isFinite(when)) continue;
          if (already(to, when, mid)) { r.known++; continue; }
          const raw = await imap.cmd(`UID FETCH ${uid} (BODY.PEEK[]<0.150000>)`);
          const att = ([...raw.matchAll(/filename\*?="?([^"\r\n;]+)/gi)].map((x) => x[1]))[0] || "";
          if (/^Reminder Letter - /i.test(att)) { r.jaine++; continue; }              // JAIN-E's own - logged when sent
          const text = bodyText(raw);
          const m = text.match(/Rs\.?\s*([\d,]+(?:\.\d+)?)/i);
          const amount = m ? Number(m[1].replace(/,/g, "")) : null;
          const cands = byEmail[to] || [];
          const hit = cands.find((x) => amount != null && Math.abs(Number(x.netOutstanding || 0) - amount) < 1) || (cands.length === 1 ? cands[0] : null);
          if (!hit) r.unmatched++;
          const row: any = { sent_at: new Date(when).toISOString(), sent_by: "Farvision (read from " + label.split(" ")[0] + " Sent)", from_email: u,
            recipient_email: to, customer_name: hit ? String(hit.customerName || "").trim() : null, booking_no: hit ? hit.bookingNo : null,
            subject: SUBJECT, ok: true, error: null, test: false };
          const full = { ...row, amount, project: hit ? projName(hit.businessUnit) : null, unit: hit ? [hit.tower, hit.unitCode].filter(Boolean).join(" ") : null,
            source: "Farvision", attachment: att || null, ...(hasMailId ? { mail_id: mid || null } : {}) };
          let ins = await PS.from("reminder_send_log").insert(full);
          if (ins.error) ins = await PS.from("reminder_send_log").insert({ ...row, error: "amount " + (amount ?? "") + " | attachment " + att });
          if (ins.error) { r.errors++; continue; }
          r.added++; seen.push({ to, t: when }); if (mid) ids.add(mid);
        } catch { r.errors++; }
      }
    } catch (e) { (r as any).error = String((e as Error)?.message || e).slice(0, 200); }
    finally { try { await imap.close(); } catch { /* ignore */ } }
    rep.push(r);
    if (more) break;
  }
  return j({ ok: true, run_by: runBy, days, more, mailboxes: rep });
}

/* REFILL (21 Nov 2026, Ayush: "fill them in"): Farvision reminders in the log with no amount (the older ones, Mar-Jun 2026)
   are read again from customercare2's Sent folder, by Gmail id or by address + time, and the amount is taken from the
   email's words or, failing that, from its Farvision letter. The booking is matched again from the address and amount.
     { action: "reminder_log_refill", diag?: true }   the job secret only */
function amountIn(s: string): number | null {
  const pats = [/Rs\.?\s*([\d,]+(?:\.\d+)?)/i, /amount currently due is\s*(?:Rs\.?\s*)?([\d,]+(?:\.\d+)?)/i, /INR\s*([\d,]+(?:\.\d+)?)/i, /₹\s*([\d,]+(?:\.\d+)?)/, /amount of\s*([\d,]{4,}(?:\.\d+)?)/i,
    /Total Payable[^0-9]{0,80}([\d,]{4,}\.\d{2})/i, /Net Outstanding[^0-9]{0,40}([\d,]{4,}(?:\.\d+)?)/i];
  for (const p of pats) { const m = s.match(p); if (m) { const n = Number(m[1].replace(/,/g, "")); if (n > 0) return n; } }
  return null;
}
// text drawn in a PDF, where the page streams are not compressed or are FlateDecode
async function pdfText(b64: string): Promise<string> {
  let bin = ""; try { bin = atob(b64.replace(/[^A-Za-z0-9+/=]/g, "")); } catch { return ""; }
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0) & 255);
  let out = "";
  const re = /stream\r?\n/g; let m: RegExpExecArray | null;
  while ((m = re.exec(bin))) {
    const start = m.index + m[0].length, end = bin.indexOf("endstream", start); if (end < 0) break;
    const dict = bin.slice(Math.max(0, m.index - 300), m.index);
    let chunk = bytes.subarray(start, end);
    try {
      if (/FlateDecode/.test(dict)) {
        const ds = new DecompressionStream("deflate");
        const r = new Response(new Blob([chunk]).stream().pipeThrough(ds)); chunk = new Uint8Array(await r.arrayBuffer());
      }
      const t = new TextDecoder("latin1").decode(chunk);
      const parts = [...t.matchAll(/\(((?:\\.|[^\\)])*)\)\s*Tj|\[((?:[^\]])*)\]\s*TJ/g)].map((x) => x[1] ?? (x[2] || "").replace(/\(((?:\\.|[^\\)])*)\)|-?\d+(\.\d+)?/g, (_a, s1) => s1 || ""));
      out += parts.join(" ") + "\n";
    } catch { /* skip this stream */ }
    re.lastIndex = end;
  }
  return out.replace(/\\\)/g, ")").replace(/\\\(/g, "(");
}
export async function reminderLogRefill(req: Request, body: any, db: any, j: J): Promise<Response> {
  const t0 = Date.now(), PS = db.schema("postsales");
  const secret = req.headers.get("x-audit-secret") || "";
  const { data: s } = await db.schema("acc").from("job_secrets").select("value").eq("name", "booking_audit").maybeSingle();
  if (!secret || !s?.value || s.value !== secret) return j({ error: "unauthorized" }, 401);
  const U = Deno.env.get("REMINDER_MAIL_USER"), P = Deno.env.get("REMINDER_MAIL_APP_PASSWORD");
  if (!U || !P) return j({ error: "customercare2 is not connected" }, 500);
  const { data: rows } = await PS.from("reminder_send_log").select("id,sent_at,recipient_email,mail_id,booking_no,from_email")
    .eq("source", "Farvision").is("amount", null).is("error", null).order("sent_at").limit(body?.diag ? 3 : 60);
  if (!rows?.length) return j({ ok: true, left: 0 });
  // Farvision contacts, every version: email -> bookings
  const { data: ct } = await db.schema("cust").from("farvision_contacts").select("booking_no,contact_email,contact_name").not("contact_email", "is", null).limit(20000);
  const byEmail: Record<string, any[]> = {}; (ct || []).forEach((c: any) => { const e = String(c.contact_email || "").trim().toLowerCase(); if (e) (byEmail[e] = byEmail[e] || []).push(c); });
  const { data: units } = await db.schema("cust").from("units").select("booking_no,tower,unit_code,project_id").is("deleted_at", null).limit(20000);
  const unitOf: Record<string, any> = {}; (units || []).forEach((u: any) => { unitOf[u.booking_no] = u; });
  const { data: projs } = await db.schema("cust").from("projects").select("id,name"); const pName: Record<string, string> = {}; (projs || []).forEach((p: any) => { pName[p.id] = p.name; });
  const imap = new Imap(); const rep: any = { done: 0, amount: 0, booking: 0, diag: [] as any[] };
  try {
    await imap.open(U, P);
    const list = await imap.cmd('LIST "" "*"');
    const allLine = list.split("\n").find((l: string) => /\\All\b/.test(l)) || "";
    const allBox = (allLine.match(/"([^"]+)"\s*$/) || allLine.match(/ (\S+)\s*$/) || [])[1] || "[Gmail]/All Mail";
    await imap.cmd(`EXAMINE "${allBox.replace(/"/g, '\\"')}"`);
    for (const r of rows) {
      if (Date.now() - t0 > 100_000) break;
      const t = Date.parse(r.sent_at), d1 = new Date(t - 864e5), d2 = new Date(t + 2 * 864e5);
      const ymd = (d: Date) => d.toISOString().slice(0, 10).replace(/-/g, "/");
      const q = r.mail_id ? `rfc822msgid:x` : `in:sent to:${r.recipient_email} after:${ymd(d1)} before:${ymd(d2)}`;
      let uid = 0;
      if (r.mail_id) { const f = await imap.cmd(`UID SEARCH X-GM-MSGID ${r.mail_id}`); uid = Number(((f.match(/\* SEARCH([\d ]*)/) || [])[1] || "").trim().split(/\s+/)[0] || 0); }
      if (!uid) {
        const f = await imap.cmd(`UID SEARCH X-GM-RAW "${q.replace(/"/g, '\\"')}"`);
        const uids = ((f.match(/\* SEARCH([\d ]*)/) || [])[1] || "").trim().split(/\s+/).filter(Boolean).map(Number);
        for (const u of uids) { const h = await imap.cmd(`UID FETCH ${u} (INTERNALDATE)`); const w = Date.parse((h.match(/INTERNALDATE "([^"]+)"/) || [])[1] || ""); if (Math.abs(w - t) < 180e3) { uid = u; break; } }
      }
      if (!uid) { rep.diag.push({ id: r.id, note: "email not found" }); continue; }
      const raw = await imap.cmd(`UID FETCH ${uid} (BODY.PEEK[])`);
      const text = bodyText(raw);
      let amount = amountIn(text), from = "text";
      if (amount == null) {
        const parts = raw.split(/\r?\n--[^\r\n]+\r?\n/);
        const att = parts.find((x: string) => /application\/pdf|\.pdf/i.test(x.slice(0, 500)));
        if (att) { const k = att.search(/\r?\n\r?\n/); const pt = await pdfText(att.slice(k)); amount = amountIn(pt); from = "letter";
          if (body?.diag) rep.diag.push({ id: r.id, pdf: pt.replace(/\s+/g, " ").slice(0, 600) }); }
      }
      if (body?.diag) rep.diag.push({ id: r.id, text: text.slice(0, 600), amount, from });
      // booking: the address (any version of the contacts) - one booking, or the one whose name matches
      let bk = r.booking_no;
      if (!bk) { const c = byEmail[String(r.recipient_email || "").toLowerCase()] || []; const uniq = [...new Set(c.map((x) => x.booking_no))]; if (uniq.length === 1) bk = uniq[0]; }
      const u = bk ? unitOf[bk] : null;
      const upd: any = { amount, ...(amount == null ? { error: "amount not found in the email or its letter" } : {}) };
      if (bk && !r.booking_no) { upd.booking_no = bk; const c = (byEmail[String(r.recipient_email || "").toLowerCase()] || []).find((x) => x.booking_no === bk); if (c) upd.customer_name = String(c.contact_name || "").trim() || null; rep.booking++; }
      if (u) { upd.project = projName(pName[u.project_id]); upd.unit = [u.tower, u.unit_code].filter(Boolean).join(" "); }
      if (!body?.diag) await PS.from("reminder_send_log").update(upd).eq("id", r.id);
      rep.done++; if (amount != null) rep.amount++;
    }
  } finally { try { await imap.close(); } catch { /* ignore */ } }
  const { count } = await PS.from("reminder_send_log").select("id", { count: "exact", head: true }).eq("source", "Farvision").is("amount", null);
  return j({ ok: true, ...rep, left_without_amount: count });
}
