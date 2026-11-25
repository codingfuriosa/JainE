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

// 14 Nov 2026: denomailer 1.6.0 writes a non-ASCII subject as =?utf-8?Q?...?= WITHOUT escaping spaces or "?" and folds it with "=" line breaks. That is an invalid header, so some
// mail apps then show the WHOLE message as raw source (headers, boundaries, base64). A subject that is plain ASCII is passed through untouched, so make every subject ASCII first.
function asciiSubject(s: string) {
  const M: Record<string, string> = { "—": "-", "–": "-", "‒": "-", "−": "-", "‘": "'", "’": "'", "“": '"', "”": '"', "…": "...", "₹": "Rs.", " ": " ", "•": "-", "·": "-", "×": "x" };
  return String(s ?? "").normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^\x00-\x7f]/g, (c) => M[c] ?? "").replace(/[\r\n]+/g, " ").replace(/\s{2,}/g, " ").trim().replace(/^=\?/, "= ?");
}

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
  const asUser = createClient(SB, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: "Bearer " + bearer } } });
  const { data: who } = await asUser.auth.getUser();
  const me = String(who?.user?.email || "").toLowerCase();
  if (!me) return j({ error: "Please sign in again." }, 401);
  /* the Post Sales module, as JAIN-E's own app.has_module decides it - asked as the signed-in person.
     20 Nov 2026: this read adm.users with the service key, which no longer has access to the adm schema, so it
     said "no" to everyone, Ayush included. */
  const { data: allowed, error: ae } = await asUser.schema("app").rpc("has_module", { p_module: "postsales" });
  if (ae) return j({ error: "Could not check your Post Sales access: " + ae.message }, 500);
  if (allowed !== true) return j({ error: "Only people with the Post Sales module can send reminders." }, 403);

  const acc = db.schema("acc"), PS = db.schema("postsales");
  /* TESTS (20 Nov 2026, Ayush: "Bring Tests again, I want to test"): { test_to: [test recipient ids] } sends the very
     same email and Reminder Letter a real customer would get - same mailbox, same template, same letter - but to the
     test addresses only (postsales.reminder_test_recipients), subject marked [TEST], logged as test. Allowed even
     while customer sending is off; at most 5 customers x 5 test addresses a call. */
  const testIds = (Array.isArray(body?.test_to) ? body.test_to : []).map(Number).filter((x: number) => x > 0).slice(0, 5);
  const isTest = testIds.length > 0;
  const { data: mode } = await acc.from("job_secrets").select("value").eq("name", "reminder_send_mode").maybeSingle();
  if (!isTest && String(mode?.value || "off") !== "live") return j({ error: "Sending reminders to customers is not switched on yet." }, 409);
  let testTo: any[] = [];
  if (isTest) {
    const { data: tt } = await PS.from("reminder_test_recipients").select("id,email,customer_name").in("id", testIds);
    testTo = (tt || []).filter((t: any) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(t.email || "").trim()));
    if (!testTo.length) return j({ error: "Choose at least one test address." }, 400);
  }

  const want: string[] = [...new Set<string>((Array.isArray(body?.booking_nos) ? body.booking_nos : []).map((x: unknown) => String(x)))].slice(0, isTest ? 5 : 25);
  if (!want.length) return j({ error: "Choose at least one customer." }, 400);
  /* 20 Nov 2026 (Ayush): reminders go from customercare2@thejaingroup.com - its own mailbox, kept apart from
     customercare1 (CUSTOMER_MAIL_*), which still sends the booking emails. Nothing is sent until its app password
     is saved as the REMINDER_MAIL_* secrets; there is no falling back to customercare1. */
  /* Tests go from Ayush's own Gmail instead (20 Nov 2026: "Test will go through my email, real Reminders through
     customercare2") - sent with his Google connection (acc.google_tokens, gmail.send), never from customercare2. */
  const TEST_SENDER = "ayushruia1@gmail.com";
  let CU = Deno.env.get("REMINDER_MAIL_USER"), gTok = "";
  const CP = Deno.env.get("REMINDER_MAIL_APP_PASSWORD");
  if (isTest) {
    const { data: g } = await acc.from("google_tokens").select("refresh_token, scope").eq("email", TEST_SENDER).maybeSingle();
    if (!g?.refresh_token || !String(g.scope || "").includes("gmail.send")) return j({ error: "Your Google connection (" + TEST_SENDER + ") cannot send email - connect Google again." }, 409);
    const tr = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_id: Deno.env.get("GOOGLE_CLIENT_ID")!, client_secret: Deno.env.get("GOOGLE_CLIENT_SECRET")!, refresh_token: g.refresh_token, grant_type: "refresh_token" }).toString() });
    const tok = await tr.json().catch(() => ({}));
    if (!tr.ok || !tok.access_token) return j({ error: "Your Google connection (" + TEST_SENDER + ") has expired - connect Google again." }, 409);
    gTok = tok.access_token; CU = TEST_SENDER;
  } else if (!CU || !CP) return j({ error: "The reminder mailbox (customercare2) is not connected yet." }, 500);

  const [{ data: list, error: le }, { data: st }] = await Promise.all([
    // read as the signed-in person - the service key may not run this function (20 Nov 2026)
    asUser.schema("postsales").rpc("outstanding_reminder_list"), PS.from("reminder_settings").select("*").eq("id", 1).maybeSingle()]);
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
  const client = isTest ? null : new SMTPClient({ connection: { hostname: "smtp.gmail.com", port: 465, tls: true, auth: { username: CU!, password: CP! } } });
  try {
    for (const bno of want) {
      const r = byNo[bno];
      const why = !r ? "not on the reminder list" : r.change === "removed" ? "no longer outstanding" : status[bno] !== "Active" ? "booking not active in Farvision"
        : r.held ? "held back" : !r.email ? "no email on record"
        : Number(r.net_outstanding || 0) < MIN_AMOUNT ? "under Rs 5,000" : (!isTest && sentToday.has(bno)) ? "already reminded today" : null;
      const lt = letters[bno];
      // 20 Nov 2026 - every email is checked before it goes, so nothing goes out cut short or wrong:
      //   the letter is a whole PDF (starts %PDF, ends %%EOF), its total is this customer's Net Outstanding,
      //   and the filled-in subject and text have no {placeholder} left in them.
      const bad = letterProblem(lt, r.net_outstanding);
      if (why || bad) { out.push({ booking_no: bno, ok: false, skipped: true, error: why || bad }); continue; }
      const row = { customer_name: String(r.customer_name || "").trim(), project: projName(r.project),
                    flat: [r.unit_code, r.tower].filter(Boolean).join(", "), net_outstanding: r.net_outstanding };
      const subject = (isTest ? "[TEST] " : "") + fill(st.subject, row), text = fill(st.body, row);
      if (/\{[A-Za-z ]+\}/.test(subject + text)) { out.push({ booking_no: bno, ok: false, skipped: true, error: "a {field} in the email was not filled in" }); continue; }
      const html = '<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.6;color:#111827;white-space:pre-wrap">' + esc(text) + "</div>";
      const fname = String(lt.filename || ("Reminder Letter - " + bno + ".pdf")).replace(/[^\w\-. ]+/g, "_").slice(0, 120);
      const att = [{ filename: fname.endsWith(".pdf") ? fname : fname + ".pdf", content: lt.pdf_base64, encoding: "base64", contentType: "application/pdf" }];
      const targets = isTest ? testTo.map((t: any) => String(t.email).trim()) : [String(r.email).trim()];
      for (const to of targets) {
        let ok = true, err: string | null = null;
        try {
          if (isTest) {
            const g = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", { method: "POST",
              headers: { Authorization: "Bearer " + gTok, "Content-Type": "application/json" },
              body: JSON.stringify({ raw: b64url(mime(CU!, to, subject, text, html, att)) }) });
            if (!g.ok) { ok = false; err = ("Gmail " + g.status + ": " + (await g.text())).slice(0, 300); }
          } else {
            await client!.send({ from: `The Jain Group <${CU}>`, to, subject: asciiSubject(subject), ...mailBody(text, html), attachments: att });
          }
        } catch (e) { ok = false; err = String((e as Error)?.message || e).slice(0, 300); }
        // the log keeps what went: amount, project, flat and letter too (20 Nov 2026, "a proper Log System");
        // until those columns exist (added 20 Nov night) the row is written without them
        const base = { sent_by: me, from_email: CU, recipient_email: to, customer_name: row.customer_name, booking_no: bno, subject, ok, error: err, test: isTest };
        const { error: le2 } = await PS.from("reminder_send_log").insert({ ...base, amount: Number(r.net_outstanding || 0), project: projName(r.project),
          unit: [r.tower, r.unit_code].filter(Boolean).join(" "), source: "JAIN-E", attachment: att[0].filename });
        if (le2) await PS.from("reminder_send_log").insert(base);
        out.push({ booking_no: bno, to, ok, error: err });
      }
    }
  } finally { try { if (client) await client.close(); } catch { /* ignore */ } }
  return j({ ok: true, from: CU, test: isTest, sent: out.filter((x) => x.ok).length, failed: out.filter((x) => !x.ok && !x.skipped).length,
             skipped: out.filter((x) => x.skipped).length, results: out });
}

// What is wrong with a Reminder Letter, or null when it is whole and adds up to the customer's Net Outstanding.
function letterProblem(lt: any, net: unknown): string | null {
  if (!lt || typeof lt.pdf_base64 !== "string" || lt.pdf_base64.length < 200) return "no Reminder Letter";
  if (lt.pdf_base64.length > 3_000_000) return "Reminder Letter too large";
  try {
    if (!atob(lt.pdf_base64.slice(0, 8)).startsWith("%PDF")) return "Reminder Letter is not a PDF";
    const s = lt.pdf_base64.replace(/\s+/g, ""); const tail = atob(s.slice(Math.max(0, s.length - 64 - (s.length % 4))));
    if (tail.indexOf("%%EOF") < 0) return "Reminder Letter is incomplete";
  } catch { return "Reminder Letter could not be read"; }
  if (lt.total == null || Math.abs(Number(lt.total) - Number(net || 0)) > 1) return "letter total does not match Net Outstanding";
  return null;
}
