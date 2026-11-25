// SCHEDULED REMINDERS (20 Nov 2026, Ayush: "a schedule system where a person can choose some customers and then select in
// what frequency their email will go - Daily, Weekly, Fortnightly or Monthly ... when the files are imported, after 15
// mins the Email will go ... if on that day the Import does not happen then the Email won't go, it is skipped").
//
//   { action: "reminder_schedule_run" }   THE JOB ONLY (x-audit-secret)
//
// postsales.reminder_schedule_tick() (every 3 minutes) waits until today's Farvision Outstanding import has been
// complete for 15 minutes, then puts every schedule due today into postsales.reminder_schedule_queue and calls this.
// Each call takes up to 12 queued customers (claimed in the database, so two calls never take the same one) and, ONE
// AT A TIME: checks the customer can still be reminded (Active in today's file, Rs 5,000 or more, email on record, not
// held, not already reminded today by anyone), builds their Reminder Letter here on the server, checks it (whole PDF,
// total = Net Outstanding), sends it from customercare2 - up to 3 tries, a few seconds apart - and logs it. One that
// still fails stays in the queue for the next call (3 calls at most). No import today -> nothing is queued -> skipped.

import { SMTPClient } from "https://deno.land/x/denomailer@1.6.0/mod.ts";
import { mailBody } from "./booking-mail.ts";
import { letterData, letterPdf, b64 } from "./reminder-letter.ts";
type J = (o: unknown, status?: number) => Response;
const MIN_AMOUNT = 5000, PER_CALL = 12;
const esc = (s: unknown) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
const inr = (n: unknown) => Math.round(Number(n) || 0).toLocaleString("en-IN");
const projName = (s: unknown) => String(s || "").replace(/\(.*?\)/g, "").replace(/\s+/g, " ").trim().toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
function asciiSubject(s: string) {
  const M: Record<string, string> = { "—": "-", "–": "-", "‘": "'", "’": "'", "“": '"', "”": '"', "…": "...", "₹": "Rs." };
  return String(s ?? "").normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^\x00-\x7f]/g, (c) => M[c] ?? "").replace(/[\r\n]+/g, " ").replace(/\s{2,}/g, " ").trim();
}
function fill(t: string, r: any) {
  const d = new Date().toLocaleDateString("en-IN", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "Asia/Kolkata" });
  return String(t || "").replace(/\{Customer Name\}/g, String(r.customer_name || "").trim()).replace(/\{Project\}/g, r.project || "")
    .replace(/\{Flat\}/g, r.flat || "").replace(/\{Net Outstanding\}/g, inr(r.net_outstanding)).replace(/\{Date\}/g, d);
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function reminderScheduleRun(req: Request, db: any, j: J): Promise<Response> {
  const t0 = Date.now();
  const acc = db.schema("acc"), PS = db.schema("postsales");
  const secret = req.headers.get("x-audit-secret") || "";
  const { data: s } = await acc.from("job_secrets").select("value").eq("name", "booking_audit").maybeSingle();
  if (!secret || !s?.value || s.value !== secret) return j({ error: "unauthorized" }, 401);
  const { data: mode } = await acc.from("job_secrets").select("value").eq("name", "reminder_send_mode").maybeSingle();
  if (String(mode?.value || "off") !== "live") return j({ ok: true, skipped: "sending is switched off" });
  const CU = Deno.env.get("REMINDER_MAIL_USER"), CP = Deno.env.get("REMINDER_MAIL_APP_PASSWORD");
  if (!CU || !CP) return j({ error: "The reminder mailbox (customercare2) is not connected." }, 500);

  const { data: claimed, error: ce } = await PS.rpc("reminder_queue_claim", { p_n: PER_CALL });
  if (ce) return j({ error: "claim: " + ce.message }, 500);
  if (!claimed?.length) return j({ ok: true, nothing: true });

  const [{ data: st }, { data: ob }, { data: holds }] = await Promise.all([
    PS.from("reminder_settings").select("*").eq("id", 1).maybeSingle(),
    db.schema("cust").from("import_batches").select("id,raw_rows").eq("import_type", "outstanding").eq("status", "completed").order("imported_at", { ascending: false }).limit(1).maybeSingle(),
    PS.from("reminder_holds").select("booking_no")]);
  const file: Record<string, any> = {}; ((ob?.raw_rows) || []).forEach((x: any) => { if (x?.bookingNo) file[x.bookingNo] = x; });
  const held = new Set((holds || []).map((h: any) => h.booking_no));
  const dayStart = new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10) + "T00:00:00+05:30";
  const done = async (id: number, status: string, error: string | null, extra: any = {}) =>
    await PS.from("reminder_schedule_queue").update({ status, error, ...extra }).eq("id", id);

  const out: any[] = [];
  const client = new SMTPClient({ connection: { hostname: "smtp.gmail.com", port: 465, tls: true, auth: { username: CU, password: CP } } });
  try {
    for (const q of claimed) {
      if (Date.now() - t0 > 115_000) { await done(q.id, "pending", "time ran out - next run"); continue; }
      const bno = q.booking_no, x = file[bno];
      // TEST RECORDS (23 Nov 2026, Ayush: "make a Test Record for me in Reminders ... Weekly ... Wednesday ... a new Test
      // Record ... Daily"). A schedule whose booking_no is "TEST-<id>-<anything>" is a made-up customer: postsales.
      // reminder_test_recipients row <id> gives the name, email and amount; the letter is a sample; the subject says
      // [TEST]; it is logged as a test. It goes only to that test address - never to a customer.
      const tm = String(bno || "").match(/^TEST-(\d+)/);
      if (tm) {
        const { data: tr } = await PS.from("reminder_test_recipients").select("*").eq("id", Number(tm[1])).maybeSingle();
        const temail = String(tr?.email || "").trim().toLowerCase();
        const { count: tdone } = await PS.from("reminder_send_log").select("id", { count: "exact", head: true }).eq("booking_no", bno).eq("ok", true).eq("test", true).gte("sent_at", dayStart);
        const twhy = !tr ? "test address not found" : !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(temail) ? "test address has no email" : (tdone || 0) > 0 ? "already sent today" : null;
        if (twhy) { await done(q.id, "skipped", twhy); out.push({ booking_no: bno, skipped: twhy }); continue; }
        const tnet = Number(tr.net_outstanding) > 0 ? Number(tr.net_outstanding) : 10000, tday = dayStart.slice(0, 10);
        const td = { booking_no: bno, unit: { id: "TEST", unit_code: tr.flat || "Test", tower: "TEST", application_no: "TEST" }, project: tr.project || "TEST", setup: {},
          contact: { contact_email: temail, contact_address: "Test record - not a customer", contact_phone: "" }, name: tr.customer_name || "Test", pan: "", floor: "", category: "",
          lines: [{ particulars: "TEST - sample instalment", bill_no: "TEST", bill_date: tday, due_date: tday, days: "0", bill: tnet, rec: 0, bal: tnet }],
          summary: false, onacc: 0, total: tnet, net: tnet, late: 0, ref: "JRM/TEST/" + tday.replace(/-/g, "") };
        let tpdf: Uint8Array;
        try { tpdf = await letterPdf(td); } catch (e) { await done(q.id, "failed", "letter: " + String((e as Error)?.message || e).slice(0, 200), { attempts: 99 }); continue; }
        const trow = { customer_name: String(tr.customer_name || "").trim(), project: tr.project || "TEST", flat: tr.flat || "Test", net_outstanding: tnet };
        const tsubject = "[TEST] " + fill(st?.subject || "", trow), ttext = fill(st?.body || "", trow);
        const thtml = '<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.6;color:#111827;white-space:pre-wrap">' + esc(ttext) + "</div>";
        const tfname = "Reminder Letter - " + bno.replace(/[^\w\-]+/g, "_") + ".pdf";
        let tok = false, terr: string | null = null;
        for (let t = 1; t <= 3 && !tok; t++) {
          try { await client.send({ from: `The Jain Group <${CU}>`, to: temail, subject: asciiSubject(tsubject), ...mailBody(ttext, thtml),
            attachments: [{ filename: tfname, content: b64(tpdf), encoding: "base64", contentType: "application/pdf" }] }); tok = true; terr = null; }
          catch (e) { terr = String((e as Error)?.message || e).slice(0, 300); if (t < 3) await sleep(4000); }
        }
        const tbase = { sent_by: "Schedule test (" + (q.frequency || "") + ")", from_email: CU, recipient_email: temail, customer_name: trow.customer_name, booking_no: bno, subject: tsubject, ok: tok, error: terr, test: true };
        const tins = await PS.from("reminder_send_log").insert({ ...tbase, amount: tnet, project: trow.project, unit: trow.flat, source: "Schedule", attachment: tfname });
        if (tins.error) await PS.from("reminder_send_log").insert(tbase);
        if (tok) { await done(q.id, "sent", null, { sent_at: new Date().toISOString() }); await PS.from("reminder_schedules").update({ last_sent_on: tday, last_note: "sent" }).eq("id", q.schedule_id); }
        else { await done(q.id, Number(q.attempts || 0) >= 3 ? "failed" : "pending", terr); await PS.from("reminder_schedules").update({ last_note: "failed: " + (terr || "") }).eq("id", q.schedule_id); }
        out.push({ booking_no: bno, ok: tok, error: terr, test: true });
        continue;
      }
      // can they still be reminded today?
      const { data: em } = await db.schema("cust").from("farvision_contacts").select("contact_email").eq("booking_no", bno).is("deleted_at", null)
        .not("contact_email", "is", null).order("is_current", { ascending: false }).order("created_at", { ascending: false }).limit(1).maybeSingle();
      const email = String(em?.contact_email || "").trim().toLowerCase();
      const { count: already } = await PS.from("reminder_send_log").select("id", { count: "exact", head: true }).eq("booking_no", bno).eq("ok", true).eq("test", false).gte("sent_at", dayStart);
      const net = Number(x?.netOutstanding || 0);
      const why = !x ? "not in today's Outstanding file" : x.status !== "Active" ? "booking not active in Farvision" : held.has(bno) ? "held back"
        : !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? "no email on record" : net < MIN_AMOUNT ? "under Rs 5,000" : (already || 0) > 0 ? "already reminded today" : null;
      if (why) { await done(q.id, "skipped", why); out.push({ booking_no: bno, skipped: why }); continue; }
      // the letter, built here, and checked
      let pdf: Uint8Array, d: any;
      try { d = await letterData(db, bno); pdf = await letterPdf(d); }
      catch (e) { await done(q.id, "failed", "letter: " + String((e as Error)?.message || e).slice(0, 200), { attempts: 99 }); out.push({ booking_no: bno, failed: "letter" }); continue; }
      if (d.net == null || Math.abs(d.total - net) > 1) { await done(q.id, "skipped", `letter total ${inr(d.total)} does not match Net Outstanding ${inr(net)}`); out.push({ booking_no: bno, skipped: "total" }); continue; }
      const row = { customer_name: String(x.customerName || "").trim(), project: projName(x.businessUnit), flat: [x.unitCode, x.tower].filter(Boolean).join(", "), net_outstanding: net };
      const subject = fill(st?.subject || "", row), text = fill(st?.body || "", row);
      if (!subject || /\{[A-Za-z ]+\}/.test(subject + text)) { await done(q.id, "skipped", "the email has a {field} that was not filled in"); continue; }
      const html = '<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.6;color:#111827;white-space:pre-wrap">' + esc(text) + "</div>";
      const fname = "Reminder Letter - " + bno.replace(/[^\w\-]+/g, "_") + ".pdf";
      // send - up to 3 tries, a few seconds apart
      let ok = false, err: string | null = null;
      for (let t = 1; t <= 3 && !ok; t++) {
        try { await client.send({ from: `The Jain Group <${CU}>`, to: email, subject: asciiSubject(subject), ...mailBody(text, html),
          attachments: [{ filename: fname, content: b64(pdf), encoding: "base64", contentType: "application/pdf" }] }); ok = true; err = null; }
        catch (e) { err = String((e as Error)?.message || e).slice(0, 300); if (t < 3) await sleep(4000); }
      }
      const base = { sent_by: "Schedule (" + (q.frequency || "") + ")", from_email: CU, recipient_email: email, customer_name: row.customer_name, booking_no: bno, subject, ok, error: err, test: false };
      const ins = await PS.from("reminder_send_log").insert({ ...base, amount: net, project: row.project, unit: [x.tower, x.unitCode].filter(Boolean).join(" "), source: "Schedule", attachment: fname });
      if (ins.error) await PS.from("reminder_send_log").insert(base);
      if (ok) { await done(q.id, "sent", null, { sent_at: new Date().toISOString() }); await PS.from("reminder_schedules").update({ last_sent_on: dayStart.slice(0, 10), last_note: "sent" }).eq("id", q.schedule_id); }
      else { await done(q.id, Number(q.attempts || 0) >= 3 ? "failed" : "pending", err); await PS.from("reminder_schedules").update({ last_note: "failed: " + (err || "") }).eq("id", q.schedule_id); }
      out.push({ booking_no: bno, ok, error: err });
    }
  } finally { try { await client.close(); } catch { /* ignore */ } }
  return j({ ok: true, processed: out.length, sent: out.filter((o) => o.ok).length, results: out });
}

// { action: "reminder_letter_check", booking_nos: [...] } - the job secret only: builds each letter on the server and
// says what it came to (nothing is sent), so the server's letters can be checked against the page's.
export async function reminderLetterCheck(req: Request, body: any, db: any, j: J): Promise<Response> {
  const secret = req.headers.get("x-audit-secret") || "";
  const { data: s } = await db.schema("acc").from("job_secrets").select("value").eq("name", "booking_audit").maybeSingle();
  if (!secret || !s?.value || s.value !== secret) return j({ error: "unauthorized" }, 401);
  const out: any[] = [];
  for (const bno of (Array.isArray(body?.booking_nos) ? body.booking_nos : []).slice(0, 40)) {
    try { const d = await letterData(db, String(bno)); const pdf = await letterPdf(d);
      out.push({ booking_no: bno, total: Math.round(d.total * 100) / 100, net: d.net, lines: d.lines.length, summary: d.summary, company: d.setup?.company_name || null, bytes: pdf.length }); }
    catch (e) { out.push({ booking_no: bno, error: String((e as Error)?.message || e).slice(0, 200) }); }
  }
  return j({ ok: true, letters: out });
}
