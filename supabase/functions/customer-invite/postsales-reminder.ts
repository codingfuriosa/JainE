// OUTSTANDING REMINDER - SENDING, TEST CUSTOMERS ONLY (30 Oct 2026, as asked).
//
//   { action: "reminder_send", test_ids: [1,2,3] }   signed-in caller; Ayush Ruia only.
//
// Sends the saved reminder email (postsales.reminder_settings), filled in for each recipient, through the
// sender's own Google connection (acc.google_tokens - the "Connect Google" from Meetings, which includes
// gmail.send), so it goes from their address and lands in their Sent folder - never Pallabita Ghosh's.
// No mail password is kept anywhere. Switched by acc.job_secrets 'reminder_send_mode':
//   off        nothing is sent
//   test_only  only the test customers in postsales.reminder_test_recipients can be sent to
// Real customers cannot be sent to in either mode: this action takes test customer ids only, so there is
// no way to name a real customer to it. Every email, sent or failed, is written to reminder_send_log.

import { AwsClient } from "https://esm.sh/aws4fetch@1.0.20";
import { SMTPClient } from "https://deno.land/x/denomailer@1.6.0/mod.ts";
import { mailBody } from "./booking-mail.ts";

type J = (o: unknown, status?: number) => Response;
const SENDERS = ["ayushruia1@gmail.com", "system.admin@thejaingroup.com"];
const esc = (s: unknown) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
const inr = (n: unknown) => Math.round(Number(n) || 0).toLocaleString("en-IN");
const b64 = (s: string) => { const b = new TextEncoder().encode(s); let x = ""; for (let i = 0; i < b.length; i += 0x8000) x += String.fromCharCode(...b.subarray(i, i + 0x8000)); return btoa(x); };
const wrap = (s: string) => s.replace(/.{1,76}/g, "$&\r\n");
const NL = "\r\n";
// One plain MIME message: text + html, and the attachment when there is one.
function mime(from: string, to: string, subject: string, text: string, html: string, att: any[]) {
  const alt = "alt_" + crypto.randomUUID(), mix = "mix_" + crypto.randomUUID();
  const altPart = "Content-Type: multipart/alternative; boundary=" + alt + NL + NL
    + "--" + alt + NL + "Content-Type: text/plain; charset=UTF-8" + NL + "Content-Transfer-Encoding: base64" + NL + NL + wrap(b64(text))
    + "--" + alt + NL + "Content-Type: text/html; charset=UTF-8" + NL + "Content-Transfer-Encoding: base64" + NL + NL + wrap(b64(html))
    + "--" + alt + "--" + NL;
  const head = "From: " + from + NL + "To: " + to + NL + "Subject: =?UTF-8?B?" + b64(subject) + "?=" + NL + "MIME-Version: 1.0" + NL;
  if (!att.length) return head + altPart;
  return head + "Content-Type: multipart/mixed; boundary=" + mix + NL + NL + "--" + mix + NL + altPart
    + att.map((a) => "--" + mix + NL + "Content-Type: " + a.contentType + '; name="' + a.filename + '"' + NL
      + 'Content-Disposition: attachment; filename="' + a.filename + '"' + NL + "Content-Transfer-Encoding: base64" + NL + NL + wrap(a.content)).join("")
    + "--" + mix + "--" + NL;
}
const b64url = (s: string) => b64(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

function fill(t: string, r: any) {
  const d = new Date().toLocaleDateString("en-IN", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "Asia/Kolkata" });
  return String(t || "").replace(/\{Customer Name\}/g, String(r.customer_name || "").trim()).replace(/\{Project\}/g, r.project || "Test Project")
    .replace(/\{Flat\}/g, r.flat || "Test").replace(/\{Net Outstanding\}/g, inr(r.net_outstanding)).replace(/\{Date\}/g, d);
}

export async function reminderSend(req: Request, body: any, db: any, j: J, SB: string, createClient: any): Promise<Response> {
  // ---- who is asking
  const bearer = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
  const { data: who } = await createClient(SB, anon, { global: { headers: { Authorization: "Bearer " + bearer } } }).auth.getUser();
  const me = String(who?.user?.email || "").toLowerCase();
  if (!me) return j({ error: "Please sign in again." }, 401);
  if (!SENDERS.includes(me)) return j({ error: "Only Ayush Ruia can send the reminder for now." }, 403);

  // ---- switched on, and only for test customers
  const acc = db.schema("acc"), PS = db.schema("postsales");
  const { data: mode } = await acc.from("job_secrets").select("value").eq("name", "reminder_send_mode").maybeSingle();
  if (String(mode?.value || "off") !== "test_only") return j({ error: "Sending is switched off." }, 409);
  if (Array.isArray(body?.booking_nos) && body.booking_nos.length) return j({ error: "Real customers cannot be emailed yet - only the test customers." }, 403);
  const ids = (Array.isArray(body?.test_ids) ? body.test_ids : []).map(Number).filter((x: number) => x > 0).slice(0, 20);
  if (!ids.length) return j({ error: "Choose at least one test customer." }, 400);

  // ---- the sender's own Google connection: a fresh access token from the saved refresh token
  const { data: g } = await acc.from("google_tokens").select("refresh_token, scope").eq("email", me).maybeSingle();
  if (!g?.refresh_token || !String(g.scope || "").includes("gmail.send"))
    return j({ error: "Connect Google first (with permission to send email).", code: "google_not_connected" }, 409);
  const tr = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: Deno.env.get("GOOGLE_CLIENT_ID")!, client_secret: Deno.env.get("GOOGLE_CLIENT_SECRET")!,
      refresh_token: g.refresh_token, grant_type: "refresh_token" }).toString() });
  const tok = await tr.json().catch(() => ({}));
  if (!tr.ok || !tok.access_token) return j({ error: "Google connection has expired - connect Google again.", code: "google_not_connected" }, 409);
  const U = me;

  const [{ data: st }, { data: tests }] = await Promise.all([
    PS.from("reminder_settings").select("*").eq("id", 1).maybeSingle(),
    PS.from("reminder_test_recipients").select("*").in("id", ids)]);
  if (!st?.subject || !st?.body) return j({ error: "The reminder email has no subject or body." }, 500);
  if (!tests?.length) return j({ error: "Those test customers were not found." }, 404);

  // ---- the attachment, if one is set: the same file for everyone
  let attachments: any[] = [];
  if (st.attachment_path) {
    const key = String(st.attachment_path).replace(/^s3:/, "");
    const bucket = Deno.env.get("S3_BUCKET"), region = Deno.env.get("S3_REGION");
    const aws = new AwsClient({ accessKeyId: Deno.env.get("AWS_ACCESS_KEY_ID")!, secretAccessKey: Deno.env.get("AWS_SECRET_ACCESS_KEY")!, region: region!, service: "s3" });
    const r = await aws.fetch(`https://${bucket}.s3.${region}.amazonaws.com/${key.split("/").map(encodeURIComponent).join("/")}`);
    if (!r.ok) return j({ error: "The attachment could not be read (" + r.status + ")." }, 502);
    const b = new Uint8Array(await r.arrayBuffer()); let bin = ""; for (let i = 0; i < b.length; i += 0x8000) bin += String.fromCharCode(...b.subarray(i, i + 0x8000));
    attachments = [{ filename: st.attachment_name || "Attachment", content: btoa(bin), encoding: "base64", contentType: r.headers.get("content-type") || "application/octet-stream" }];
  }

  // ---- the Reminder Letter, drawn by the page from JAIN-E's data (a real customer's, as a sample, on a
  //      test send); attached as it is - it is a PDF and nothing else
  const lt = body?.letter;
  if (lt && typeof lt.pdf_base64 === "string") {
    if (lt.pdf_base64.length > 3_000_000) return j({ error: "The Reminder Letter is too large to attach." }, 400);
    if (!atob(lt.pdf_base64.slice(0, 8)).startsWith("%PDF")) return j({ error: "The Reminder Letter is not a PDF." }, 400);
    const fname = String(lt.filename || "Reminder Letter.pdf").replace(/[^\w\-. ]+/g, "_").slice(0, 120);
    attachments.push({ filename: fname.endsWith(".pdf") ? fname : fname + ".pdf", content: lt.pdf_base64, encoding: "base64", contentType: "application/pdf" });
  }

  // ---- a Reminder Letter for each test customer (sample figures, drawn by the page): { letters: { <test id>: {...} } }
  const perLetter: Record<string, any> = {};
  if (body?.letters && typeof body.letters === "object") {
    for (const [id, v] of Object.entries(body.letters as Record<string, any>)) {
      if (!v || typeof v.pdf_base64 !== "string") continue;
      if (v.pdf_base64.length > 3_000_000) return j({ error: "A Reminder Letter is too large to attach." }, 400);
      if (!atob(v.pdf_base64.slice(0, 8)).startsWith("%PDF")) return j({ error: "A Reminder Letter is not a PDF." }, 400);
      const fname = String(v.filename || "Reminder Letter.pdf").replace(/[^\w\-. ]+/g, "_").slice(0, 120);
      perLetter[id] = { filename: fname.endsWith(".pdf") ? fname : fname + ".pdf", content: v.pdf_base64, encoding: "base64", contentType: "application/pdf" };
    }
  }

  // ---- send, one email each, and log every one
  const out: any[] = [];
  {
    for (const t of tests) {
      const subject = fill(st.subject, t), text = fill(st.body, t);
      const att = perLetter[String(t.id)] ? attachments.concat([perLetter[String(t.id)]]) : attachments;
      const html = '<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.6;color:#111827;white-space:pre-wrap">' + esc(text) + "</div>";
      let ok = true, err: string | null = null;
      try {
        const r = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", { method: "POST",
          headers: { Authorization: "Bearer " + tok.access_token, "Content-Type": "application/json" },
          body: JSON.stringify({ raw: b64url(mime(U, t.email, subject, text, html, att)) }) });
        if (!r.ok) { ok = false; err = ("Gmail " + r.status + ": " + (await r.text())).slice(0, 300); }
      } catch (e) { ok = false; err = String((e as Error)?.message || e).slice(0, 300); }
      await PS.from("reminder_send_log").insert({ sent_by: me, from_email: U, recipient_email: t.email, customer_name: t.customer_name,
        booking_no: "TEST-" + t.id, subject, ok, error: err, test: true });
      out.push({ to: t.email, ok, error: err });
    }
  }
  return j({ ok: true, from: U, sent: out.filter((x) => x.ok).length, failed: out.filter((x) => !x.ok).length, results: out });
}

/* REMINDERS TO CUSTOMERS (2 Nov 2026, Ayush: "anyone who has access to the Post Sales module").

     { action: "reminder_send_customers", booking_nos: [...], letters: { <booking no>: {filename, pdf_base64} } }

   From Pallabita Ghosh's customer-care mailbox (CUSTOMER_MAIL_USER), the same one the booking emails use.
   Only with acc.job_secrets 'reminder_send_mode' = 'live'. The page only names bookings: who gets an email,
   at which address and for how much is read here from postsales.outstanding_reminder_list - customers with
   Net Outstanding of Rs 5,000 or more, an email on record, not held back and not removed - so nothing the
   page sends can point a reminder at anybody else. Each email carries that customer's Reminder Letter
   (drawn by the page from JAIN-E's data); one without its letter is not sent. A customer already reminded
   today is not reminded again. At most 25 a call. Every email, sent or failed, is in reminder_send_log. */
const MIN_AMOUNT = 5000;
const projName = (s: unknown) => String(s || "").replace(/\(.*?\)/g, "").replace(/\s+/g, " ").trim().toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
export async function reminderSendCustomers(req: Request, body: any, db: any, j: J, SB: string, createClient: any): Promise<Response> {
  const bearer = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  const { data: who } = await createClient(SB, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: "Bearer " + bearer } } }).auth.getUser();
  const me = String(who?.user?.email || "").toLowerCase();
  if (!me) return j({ error: "Please sign in again." }, 401);
  // the Post Sales module, as JAIN-E's own app.has_module decides it
  const [{ data: au }, { data: sa }] = await Promise.all([
    db.schema("adm").from("users").select("active,modules").ilike("email", me).maybeSingle(),
    db.schema("adm").from("user_permissions").select("super_admin").ilike("email", me).maybeSingle()]);
  const allowed = !!sa?.super_admin || (!!au?.active && Array.isArray(au?.modules) && au.modules.includes("postsales"));
  if (!allowed) return j({ error: "Only people with the Post Sales module can send reminders." }, 403);

  const acc = db.schema("acc"), PS = db.schema("postsales");
  const { data: mode } = await acc.from("job_secrets").select("value").eq("name", "reminder_send_mode").maybeSingle();
  if (String(mode?.value || "off") !== "live") return j({ error: "Sending reminders to customers is not switched on yet." }, 409);

  const want: string[] = [...new Set<string>((Array.isArray(body?.booking_nos) ? body.booking_nos : []).map((x: unknown) => String(x)))].slice(0, 25);
  if (!want.length) return j({ error: "Choose at least one customer." }, 400);
  const CU = Deno.env.get("CUSTOMER_MAIL_USER"), CP = Deno.env.get("CUSTOMER_MAIL_APP_PASSWORD");
  if (!CU || !CP) return j({ error: "The customer-care mailbox is not connected." }, 500);

  const [{ data: list, error: le }, { data: st }] = await Promise.all([
    PS.rpc("outstanding_reminder_list"), PS.from("reminder_settings").select("*").eq("id", 1).maybeSingle()]);
  if (le) return j({ error: "Could not read the reminder list: " + le.message }, 500);
  if (!st?.subject || !st?.body) return j({ error: "The reminder email has no subject or body." }, 500);
  const byNo: Record<string, any> = {};
  (list || []).forEach((r: any) => { byNo[r.booking_no] = r; });
  // Farvision's Customer Status from the latest Outstanding file - a cancelled booking is never reminded (3 Nov 2026)
  const { data: ob } = await db.schema("cust").from("import_batches").select("raw_rows").eq("import_type", "outstanding").eq("status", "completed")
    .order("imported_at", { ascending: false }).limit(1).maybeSingle();
  const status: Record<string, string> = {};
  ((ob?.raw_rows) || []).forEach((x: any) => { if (x?.bookingNo) status[x.bookingNo] = String(x.status || ""); });

  const dayStart = new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10) + "T00:00:00+05:30";   // today, IST
  const { data: done } = await PS.from("reminder_send_log").select("booking_no").eq("test", false).eq("ok", true).gte("sent_at", dayStart).in("booking_no", want);
  const sentToday = new Set((done || []).map((x: any) => x.booking_no));

  const letters = (body?.letters && typeof body.letters === "object") ? body.letters : {};
  const out: any[] = [];
  const client = new SMTPClient({ connection: { hostname: "smtp.gmail.com", port: 465, tls: true, auth: { username: CU, password: CP } } });
  try {
    for (const bno of want) {
      const r = byNo[bno];
      const why = !r ? "not on the reminder list" : r.change === "removed" ? "no longer outstanding" : status[bno] !== "Active" ? "booking not active in Farvision"
        : r.held ? "held back" : !r.email ? "no email on record"
        : Number(r.net_outstanding || 0) < MIN_AMOUNT ? "under Rs 5,000" : sentToday.has(bno) ? "already reminded today" : null;
      const lt = letters[bno];
      const letterOk = lt && typeof lt.pdf_base64 === "string" && lt.pdf_base64.length < 3_000_000 && atob(lt.pdf_base64.slice(0, 8)).startsWith("%PDF");
      if (why || !letterOk) { out.push({ booking_no: bno, ok: false, skipped: true, error: why || "no Reminder Letter" }); continue; }
      const row = { customer_name: String(r.customer_name || "").trim(), project: projName(r.project),
                    flat: [r.unit_code, r.tower].filter(Boolean).join(", "), net_outstanding: r.net_outstanding };
      const subject = fill(st.subject, row), text = fill(st.body, row);
      const html = '<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.6;color:#111827;white-space:pre-wrap">' + esc(text) + "</div>";
      const fname = String(lt.filename || ("Reminder Letter - " + bno + ".pdf")).replace(/[^\w\-. ]+/g, "_").slice(0, 120);
      let ok = true, err: string | null = null;
      try {
        await client.send({ from: `Pallabita Ghosh - The Jain Group <${CU}>`, to: String(r.email).trim(), subject, ...mailBody(text, html),
          attachments: [{ filename: fname.endsWith(".pdf") ? fname : fname + ".pdf", content: lt.pdf_base64, encoding: "base64", contentType: "application/pdf" }] });
      } catch (e) { ok = false; err = String((e as Error)?.message || e).slice(0, 300); }
      await PS.from("reminder_send_log").insert({ sent_by: me, from_email: CU, recipient_email: String(r.email).trim(), customer_name: row.customer_name,
        booking_no: bno, subject, ok, error: err, test: false });
      out.push({ booking_no: bno, ok, error: err });
    }
  } finally { try { await client.close(); } catch { /* ignore */ } }
  return j({ ok: true, from: CU, sent: out.filter((x) => x.ok).length, failed: out.filter((x) => !x.ok && !x.skipped).length,
             skipped: out.filter((x) => x.skipped).length, results: out });
}
