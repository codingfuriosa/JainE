// BOUNCED BOOKING EMAILS - caught, the email re-read from the form, and the letter sent again
// (27 Oct 2026, as asked). See supabase/migrations/20261027100000_booking_email_bounces.sql.
//
//   { action: "booking_bounce_check" }   THE JOB ONLY (x-audit-secret), every 15 minutes.
//
// 1. Pallabita Ghosh's inbox (the same mailbox the letters go out from) is read over IMAP for
//    Gmail's returned-mail notices from the last 3 days. Only a permanent failure counts ("address
//    not found", 5.x.x) - a "delayed" notice is Gmail still trying, and is left alone.
// 2. The returned address is matched to the booking document last emailed to it (a live send, not
//    a test). Each notice is handled once: acc.booking_email_bounces holds its Message-ID.
// 3. booking-audit reads the email on the booking form again, told which reading bounced.
// 4. A different, well-formed address that has not bounced before is filed on the booking, and the
//    letter goes again - automatically for the Welcome Letters, which are text. The Allotment
//    Letter and Agreement Draft are PDFs built in the editor, and a letter Pallabita had edited
//    cannot be rebuilt here, so for those she is told the corrected address and sends it herself.
// 5. Anything else - the same reading again, nothing readable, a second bounce on the same letter -
//    is one email to Pallabita naming the booking, the address and Gmail's reason.
// Nothing goes to a customer while booking emails are in test mode.

import { SMTPClient } from "https://deno.land/x/denomailer@1.6.0/mod.ts";
import { welcomeEmail, welcome2Email, mailBody, bookingAmountProblem } from "./booking-mail.ts";

type J = (o: unknown, status?: number) => Response;
const EMAIL_RE = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;
const DOC_NAME: Record<string, string> = {
  welcome: "Welcome Letter", welcome2: "2nd Welcome Letter",
  allotment: "Allotment Letter", agreement: "Agreement Draft",
};
const esc = (s: unknown) => String(s ?? "").replace(/[&<>"]/g,
  (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));

/* ---------------- a small IMAP reader: just enough to list and read the returned-mail notices ---- */
export class Imap {
  private conn!: Deno.TlsConn;
  private buf = new Uint8Array(0);
  private n = 0;
  private dec = new TextDecoder();
  async open(user: string, pass: string) {
    this.conn = await Deno.connectTls({ hostname: "imap.gmail.com", port: 993 });
    await this.readLine();                                   // server greeting
    const q = (s: string) => '"' + s.replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '"';
    await this.cmd(`LOGIN ${q(user)} ${q(pass)}`);
  }
  private async fill() {
    const chunk = new Uint8Array(65536);
    const r = await this.conn.read(chunk);
    if (r === null) throw new Error("IMAP connection closed");
    const next = new Uint8Array(this.buf.length + r);
    next.set(this.buf); next.set(chunk.subarray(0, r), this.buf.length);
    this.buf = next;
  }
  private async readLine(): Promise<string> {
    for (;;) {
      const i = this.buf.indexOf(10);
      if (i >= 0) { const line = this.dec.decode(this.buf.subarray(0, i + 1)); this.buf = this.buf.slice(i + 1); return line; }
      await this.fill();
    }
  }
  private async readBytes(len: number): Promise<string> {
    while (this.buf.length < len) await this.fill();
    const s = this.dec.decode(this.buf.subarray(0, len)); this.buf = this.buf.slice(len); return s;
  }
  // Sends one command; returns everything up to its tagged reply, literals ({n}) included.
  async cmd(c: string): Promise<string> {
    const tag = "a" + (++this.n);
    await this.conn.write(new TextEncoder().encode(`${tag} ${c}\r\n`));
    let out = "";
    for (;;) {
      const line = await this.readLine();
      const lit = line.match(/\{(\d+)\}\r?\n$/);
      out += line;
      if (lit) { out += await this.readBytes(Number(lit[1])); continue; }
      if (line.startsWith(tag + " ")) {
        if (!/^\S+ OK/i.test(line)) throw new Error("IMAP " + c.split(" ")[0] + ": " + line.trim().slice(0, 200));
        return out;
      }
    }
  }
  async close() { try { await this.cmd("LOGOUT"); } catch { /* ignore */ } try { this.conn.close(); } catch { /* ignore */ } }
}

const MON = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
function imapDate(d: Date) { return `${d.getUTCDate()}-${MON[d.getUTCMonth()]}-${d.getUTCFullYear()}`; }

/* What the notice says: the address that failed, whether it is permanent, and Gmail's reason. */
function parseNotice(raw: string) {
  const text = raw.replace(/=\r?\n/g, "").replace(/=([0-9A-F]{2})/g, (_m, h) => String.fromCharCode(parseInt(h, 16)));
  const msgId = (text.match(/^Message-ID:\s*(<[^>\r\n]+>)/im) || [])[1] || null;
  const addrs = new Set<string>();
  for (const m of text.matchAll(/^(?:Final-Recipient|Original-Recipient):\s*rfc822;\s*<?([^\s>;]+@[^\s>;]+)>?/gim)) addrs.add(m[1].toLowerCase());
  for (const m of text.matchAll(/^X-Failed-Recipients:\s*([^\r\n]+)/gim))
    for (const a of m[1].split(/[,\s]+/)) if (a.includes("@")) addrs.add(a.toLowerCase());
  const action = (text.match(/^Action:\s*(\w+)/im) || [])[1]?.toLowerCase() || "";
  const status = (text.match(/^Status:\s*([0-9.]+)/im) || [])[1] || "";
  const diag = (text.match(/^Diagnostic-Code:\s*([^\r\n]+(?:\r?\n[ \t][^\r\n]+)*)/im) || [])[1] || "";
  const human = (text.match(/(Address not found[\s\S]{0,40}|The (?:email )?account that you tried to reach does not exist[^\r\n]*|wasn't delivered to [^\r\n]+)/i) || [])[1] || "";
  const permanent = action === "failed" || /^5\./.test(status) || /does not exist|address not found|no such user|user unknown/i.test(text);
  const delayed = action === "delayed" || /^4\./.test(status) || /delivery incomplete|delayed/i.test(human);
  return { msgId, addrs: [...addrs].filter((a) => EMAIL_RE.test(a)), permanent: permanent && !delayed,
           reason: (diag || human || status).replace(/\s+/g, " ").trim().slice(0, 300) };
}

async function sendMail(CU: string, CP: string, to: string[], subject: string, html: string, text: string) {
  const client = new SMTPClient({ connection: { hostname: "smtp.gmail.com", port: 465, tls: true, auth: { username: CU, password: CP } } });
  try { await client.send({ from: `Pallabita Ghosh - The Jain Group <${CU}>`, to, subject, ...mailBody(text, html) }); }
  finally { try { await client.close(); } catch { /* ignore */ } }
}

export async function bounceCheck(req: Request, acc: any, j: J, SB: string): Promise<Response> {
  const secret = req.headers.get("x-audit-secret") || "";
  const { data: s } = await acc.from("job_secrets").select("value").eq("name", "booking_audit").maybeSingle();
  if (!secret || !s?.value || s.value !== secret) return j({ error: "unauthorized" }, 401);
  const CU = Deno.env.get("CUSTOMER_MAIL_USER"), CP = Deno.env.get("CUSTOMER_MAIL_APP_PASSWORD");
  if (!CU || !CP) return j({ error: "Pallabita Ghosh's mailbox is not connected." }, 500);

  const { data: modeRow } = await acc.from("job_secrets").select("value").eq("name", "booking_mail_mode").maybeSingle();
  const live = String(modeRow?.value || "") === "live";

  // ---- the notices
  const imap = new Imap();
  const notices: Array<{ uid: string; raw: string }> = [];
  try {
    await imap.open(CU, CP);
    const sel = await imap.cmd("SELECT INBOX");
    const uv = (sel.match(/UIDVALIDITY (\d+)/i) || [])[1] || "0";
    const since = imapDate(new Date(Date.now() - 3 * 86400e3));
    const found = await imap.cmd(`UID SEARCH SINCE ${since} OR FROM "mailer-daemon" FROM "postmaster"`);
    const uids = ((found.match(/^\* SEARCH([^\r\n]*)/m) || [])[1] || "").trim().split(/\s+/).filter(Boolean).slice(-40);
    for (const uid of uids) {
      const key = `imap:${uv}:${uid}`;
      const { data: seen } = await acc.from("booking_email_bounces").select("id").eq("message_key", key).maybeSingle();
      if (seen) continue;
      const got = await imap.cmd(`UID FETCH ${uid} (BODY.PEEK[]<0.80000>)`);
      notices.push({ uid: key, raw: got });
    }
  } catch (e) {
    await imap.close();
    return j({ error: "Could not read Pallabita's inbox: " + String((e as Error).message || e).slice(0, 300) }, 502);
  }
  await imap.close();

  const report: any[] = [];
  for (const n of notices) {
    const p = parseNotice(n.raw);
    if (!p.permanent || !p.addrs.length) {
      // recorded so it is not fetched again; nothing to do
      await acc.from("booking_email_bounces").insert({ message_key: n.uid, bounced_to: p.addrs[0] || "(none)",
        reason: p.reason, outcome: p.permanent ? "no_address" : "not_permanent" });
      continue;
    }
    for (const addr of p.addrs.slice(0, 3)) {
      const key = p.addrs.length > 1 ? `${n.uid}:${addr}` : n.uid;
      // the booking document last emailed (for real) to this address
      const { data: docs } = await acc.from("booking_doc_status")
        .select("case_id,kind,last_email_to,last_email_test,last_email_modified,last_emailed_at,email_count")
        .contains("last_email_to", [addr]).eq("last_email_test", false)
        .order("last_emailed_at", { ascending: false }).limit(1);
      const doc = docs?.[0];
      // claimed first: a notice is handled once, however often the job runs
      const { error: claimErr } = await acc.from("booking_email_bounces").insert({ message_key: key, case_id: doc?.case_id ?? null,
        kind: doc?.kind ?? null, bounced_to: addr, reason: p.reason, outcome: doc ? "checking" : "no_match" });
      if (claimErr) continue;
      if (!doc) { report.push({ addr, outcome: "no_match" }); continue; }

      const done = async (outcome: string, extra: Record<string, unknown> = {}) =>
        await acc.from("booking_email_bounces").update({ outcome, ...extra }).eq("message_key", key);

      const { data: audit } = await acc.from("booking_audits").select("result").eq("case_id", doc.case_id).maybeSingle();
      const res = audit?.result || {};
      const customer = welcomeEmail(res).customer;

      // ---- a second reading of the form
      let rr: any = null;
      try {
        const r = await fetch(`${SB}/functions/v1/booking-audit`, { method: "POST",
          headers: { "Content-Type": "application/json", "x-audit-secret": secret,
                     apikey: Deno.env.get("SUPABASE_ANON_KEY") || "" },
          body: JSON.stringify({ case_id: doc.case_id, email_reread: true, bounced: addr }) });
        rr = await r.json().catch(() => null);
      } catch (e) { rr = { error: String(e) }; }
      const reread = String(rr?.email || "").toLowerCase();
      const { data: prior } = await acc.from("booking_email_bounces").select("id").eq("bounced_to", reread).limit(1);
      const { data: resentBefore } = await acc.from("booking_email_bounces").select("id")
        .eq("case_id", doc.case_id).eq("kind", doc.kind).eq("outcome", "resent").limit(1);
      const usable = rr?.ok && EMAIL_RE.test(reread) && reread !== addr && !(prior && prior.length)
        && !(resentBefore && resentBefore.length);
      const textKind = doc.kind === "welcome" || doc.kind === "welcome2";

      const tellPallabita = async (headline: string, extraHtml: string) => {
        const html = `<div style="font-family:Arial,sans-serif;font-size:14px;line-height:1.6">`
          + `<p><b>${esc(headline)}</b></p>`
          + `<p>Booking: <b>${esc(customer)}</b> (instance ${doc.case_id}) - ${esc(DOC_NAME[doc.kind] || doc.kind)}</p>`
          + `<p>Returned by Gmail: <b>${esc(addr)}</b><br>Reason: ${esc(p.reason || "address not found")}</p>`
          + extraHtml + `<p style="color:#6b7280;font-size:12px">Sent automatically by JainE.</p></div>`;
        const text = html.replace(/<br>/g, "\n").replace(/<\/p>/g, "\n\n").replace(/<[^>]+>/g, "").replace(/&amp;/g, "&");
        await sendMail(CU, CP, [CU], `Booking email bounced - ${customer}`, html, text);
      };

      try {
        if (!usable) {
          await tellPallabita("A booking email could not be delivered - please check the address on the form.",
            rr?.ok ? `<p>Read again from the form: <b>${esc(reread || "-")}</b>${reread === addr ? " (the same as before)" : ""}`
                     + `${(rr.alternatives || []).length ? `<br>Other possible readings: ${esc(rr.alternatives.join(", "))}` : ""}</p>`
                   : `<p>The form could not be read again just now.</p>`);
          await done("told_pallabita", { reread_email: reread || null, reread_sure: rr?.sure ?? null, reread_steps: rr?.steps ?? null });
          report.push({ addr, outcome: "told_pallabita" }); continue;
        }

        // ---- the corrected address goes on the booking
        const fixed = JSON.parse(JSON.stringify(res));
        fixed.validation = fixed.validation || {};
        fixed.validation.email = { ...(fixed.validation.email || {}), verdict: "Ok",
          reason: `${reread.toUpperCase()} - read again on ${new Date().toISOString().slice(0, 10)} after ${addr} bounced.`,
          addresses: [{ valid: true, printed: reread.toUpperCase() }] };
        fixed.kyc = fixed.kyc || {};
        fixed.kyc.emails = [reread.toUpperCase()];
        await acc.from("booking_audits").update({ result: fixed }).eq("case_id", doc.case_id);

        const amountProblem = doc.kind === "welcome" ? bookingAmountProblem(fixed) : null;
        if (!live || !textKind || doc.last_email_modified || amountProblem) {
          await tellPallabita(`The email has been corrected to ${reread} - please send the ${DOC_NAME[doc.kind] || "document"} again.`,
            `<p>Read again from the form: <b>${esc(reread)}</b>. It is now saved on the booking, so the Email button will use it.</p>`
            + (!live ? "<p>(Booking emails are in test mode, so nothing was re-sent to the customer.)</p>"
               : doc.last_email_modified ? "<p>The letter that bounced had been edited, so it was not re-sent automatically.</p>"
               : amountProblem ? `<p>It was not re-sent automatically, because ${esc(amountProblem)}.</p>` : ""));
          await done("told_pallabita", { reread_email: reread, reread_sure: rr.sure, reread_steps: rr.steps });
          report.push({ addr, outcome: "corrected_told_pallabita", reread }); continue;
        }

        // ---- a Welcome Letter goes again, to the corrected address
        const m = doc.kind === "welcome2" ? welcome2Email(fixed) : welcomeEmail(fixed);
        const subject = doc.kind === "welcome2" ? "Allotment Payment Letter" : `Welcome Letter - ${customer}`;
        await sendMail(CU, CP, [reread], subject, m.html, m.text);
        await acc.from("booking_doc_status").update({ last_emailed_at: new Date().toISOString(),
          last_emailed_by: "system (re-sent after bounce)", last_email_to: [reread],
          email_count: Number(doc.email_count || 0) + 1 }).eq("case_id", doc.case_id).eq("kind", doc.kind);
        await tellPallabita(`The ${DOC_NAME[doc.kind]} bounced and has been re-sent to ${reread}.`,
          `<p>Read again from the form: <b>${esc(reread)}</b> - saved on the booking and the letter sent to it.</p>`);
        await done("resent", { reread_email: reread, reread_sure: rr.sure, reread_steps: rr.steps, resent_to: reread });
        report.push({ addr, outcome: "resent", to: reread });
      } catch (e) {
        await done("error", { note: String((e as Error).message || e).slice(0, 300) });
        report.push({ addr, outcome: "error", error: String(e).slice(0, 200) });
      }
    }
  }
  return j({ ok: true, live, notices: notices.length, handled: report });
}
