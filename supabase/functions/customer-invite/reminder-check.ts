// SENT REMINDERS CHECK (20 Nov 2026, Ayush: "check if any new Sent Email with Subject A Kind Request To Clear Your
// Dues"). Opens customercare1 (Pallabita Ghosh) and customercare2 (Riya Roy) READ-ONLY, the same way Customer
// Tickets reads Pallabita's mailbox (IMAP EXAMINE - nothing is marked, moved or deleted), and lists the sent emails
// whose subject has the reminder's wording, newest first. Signed-in people with the Post Sales module only.
//
//   { action: "reminder_sent_check", subject?: "...", days?: 30 }

import { Imap } from "./booking-bounce.ts";
type J = (o: unknown, status?: number) => Response;

async function sentIn(user: string, pass: string, subject: string, days: number, withBody = false, extra = "") {
  const imap = new Imap();
  try {
    await imap.open(user, pass);
    const list = await imap.cmd('LIST "" "*"');
    const allLine = list.split("\n").find((l: string) => /\\All\b/.test(l)) || "";
    const allBox = (allLine.match(/"([^"]+)"\s*$/) || allLine.match(/ (\S+)\s*$/) || [])[1] || "[Gmail]/All Mail";
    await imap.cmd(`EXAMINE "${allBox.replace(/"/g, '\\"')}"`);                       // read-only
    const q = `in:sent subject:"${subject.replace(/"/g, "")}" newer_than:${days}d${extra ? " " + extra : ""}`;
    const f = await imap.cmd(`UID SEARCH X-GM-RAW "${q.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`);
    const uids = ((f.match(/\* SEARCH([\d ]*)/) || [])[1] || "").trim().split(/\s+/).filter(Boolean).map(Number).sort((a, b) => b - a);
    const items: any[] = [];
    for (const uid of uids.slice(0, 60)) {
      const h = await imap.cmd(`UID FETCH ${uid} (INTERNALDATE BODY.PEEK[HEADER.FIELDS (TO SUBJECT DATE)])`);
      const get = (k: string) => ((h.match(new RegExp("^" + k + ":\\s*([^\\r\\n]*(?:\\r?\\n[ \\t][^\\r\\n]*)*)", "mi")) || [])[1] || "").replace(/\r?\n[ \t]+/g, " ").trim();
      const it: any = { date: (h.match(/INTERNALDATE "([^"]+)"/) || [])[1] || get("Date"), to: get("To"), subject: decodeWords(get("Subject")) };
      // with_body: the email's own text, to read the amount it gave (20 Nov 2026) - read-only (PEEK)
      if (withBody && items.length < 40) {
        const raw = await imap.cmd(`UID FETCH ${uid} (BODY.PEEK[]<0.120000>)`);
        it.text = bodyText(raw).slice(0, 1500);
        const m = it.text.match(/Rs\.?\s*([\d,]+(?:\.\d+)?)/i) || it.text.match(/₹\s*([\d,]+(?:\.\d+)?)/);
        it.amount = m ? Number(m[1].replace(/,/g, "")) : null;
        it.attachments = [...raw.matchAll(/filename\*?="?([^"\r\n;]+)/gi)].map((x) => x[1]);
      }
      items.push(it);
    }
    return { mailbox: user, count: uids.length, items };
  } finally { try { await imap.close(); } catch { /* ignore */ } }
}
// The readable text of a raw email: its text/plain part (or text/html, tags removed), decoded.
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
  } catch { /* leave as is */ }
  if (/text\/html/i.test(head)) body = body.replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&");
  return body.replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
}
// =?UTF-8?B?...?= / =?UTF-8?Q?...?= subjects, read back as text
function decodeWords(s: string) {
  return s.replace(/=\?([^?]+)\?([BQbq])\?([^?]*)\?=/g, (_m, _cs, enc, t) => {
    try {
      const bin = enc.toUpperCase() === "B" ? atob(t) : t.replace(/_/g, " ").replace(/=([0-9A-Fa-f]{2})/g, (_x: string, h: string) => String.fromCharCode(parseInt(h, 16)));
      return new TextDecoder().decode(Uint8Array.from(bin, (c: string) => c.charCodeAt(0) & 255));
    } catch { return t; }
  }).replace(/\?=\s+=\?/g, "");
}

export async function reminderSentCheck(req: Request, body: any, j: J, SB: string, createClient: any): Promise<Response> {
  const bearer = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  const asUser = createClient(SB, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: "Bearer " + bearer } } });
  const { data: who } = await asUser.auth.getUser();
  if (!who?.user?.email) return j({ error: "Please sign in again." }, 401);
  const { data: allowed } = await asUser.schema("app").rpc("has_module", { p_module: "postsales" });
  if (allowed !== true) return j({ error: "Only people with the Post Sales module can check this." }, 403);
  const subject = String(body?.subject || "A Kind Request To Clear Your Dues").slice(0, 120);
  // { attachment_to: "<customer email>" } - the PDF attached to the newest sent reminder to that address (read-only)
  if (body?.attachment_to) {
    const to = String(body.attachment_to).trim().toLowerCase();
    if (!/^[^\s@"]+@[^\s@"]+$/.test(to)) return j({ error: "Give one email address." }, 400);
    const boxes2 = [[Deno.env.get("REMINDER_MAIL_USER"), Deno.env.get("REMINDER_MAIL_APP_PASSWORD")], [Deno.env.get("CUSTOMER_MAIL_USER"), Deno.env.get("CUSTOMER_MAIL_APP_PASSWORD")]];
    for (const [u, p] of boxes2) {
      if (!u || !p) continue;
      const imap = new Imap();
      try {
        await imap.open(u, p);
        const list = await imap.cmd('LIST "" "*"');
        const allLine = list.split("\n").find((l: string) => /\\All\b/.test(l)) || "";
        const allBox = (allLine.match(/"([^"]+)"\s*$/) || allLine.match(/ (\S+)\s*$/) || [])[1] || "[Gmail]/All Mail";
        await imap.cmd(`EXAMINE "${allBox.replace(/"/g, '\\"')}"`);
        const q = `in:sent to:${to} subject:"${subject.replace(/"/g, "")}" newer_than:${Math.min(365, Number(body?.days) || 30)}d`;
        const f = await imap.cmd(`UID SEARCH X-GM-RAW "${q.replace(/"/g, '\\"')}"`);
        const uids = ((f.match(/\* SEARCH([\d ]*)/) || [])[1] || "").trim().split(/\s+/).filter(Boolean).map(Number).sort((a, b) => b - a);
        if (!uids.length) continue;
        const raw = await imap.cmd(`UID FETCH ${uids[0]} (INTERNALDATE BODY.PEEK[])`);
        const parts = raw.split(/\r?\n--[^\r\n]+\r?\n/);
        const att = parts.find((x: string) => /content-disposition:\s*attachment/i.test(x) || /application\/pdf/i.test(x.slice(0, 400)));
        if (!att) return j({ ok: true, mailbox: u, error: "That email has no attachment." });
        const k = att.search(/\r?\n\r?\n/);
        const name = (att.match(/filename\*?="?([^"\r\n;]+)/i) || [])[1] || "attachment.pdf";
        const b64 = att.slice(k).replace(/[^A-Za-z0-9+/=]/g, "");
        return j({ ok: true, mailbox: u, date: (raw.match(/INTERNALDATE "([^"]+)"/) || [])[1] || "", filename: name, pdf_base64: b64 });
      } finally { try { await imap.close(); } catch { /* ignore */ } }
    }
    return j({ ok: true, error: "No sent reminder to " + to + " found." });
  }
  const days = Math.min(365, Math.max(1, Number(body?.days) || 30));
  const boxes = [
    ["customercare1 (Pallabita Ghosh)", Deno.env.get("CUSTOMER_MAIL_USER"), Deno.env.get("CUSTOMER_MAIL_APP_PASSWORD")],
    ["customercare2 (Riya Roy)", Deno.env.get("REMINDER_MAIL_USER"), Deno.env.get("REMINDER_MAIL_APP_PASSWORD")]];
  const out: any[] = [];
  for (const [label, u, p] of boxes) {
    if (!u || !p) { out.push({ label, error: "not connected" }); continue; }
    try { out.push({ label, ...(await sentIn(u, p, subject, days, !!body?.with_body, String(body?.extra || "").replace(/["\\]/g, "").slice(0, 80))) }); }
    catch (e) { out.push({ label, mailbox: u, error: String((e as Error)?.message || e).slice(0, 200) }); }
  }
  return j({ ok: true, subject, days, mailboxes: out });
}
