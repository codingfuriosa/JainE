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

  // ---- send, one email each, and log every one
  const out: any[] = [];
  {
    for (const t of tests) {
      const subject = fill(st.subject, t), text = fill(st.body, t);
      const html = '<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.6;color:#111827;white-space:pre-wrap">' + esc(text) + "</div>";
      let ok = true, err: string | null = null;
      try {
        const r = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", { method: "POST",
          headers: { Authorization: "Bearer " + tok.access_token, "Content-Type": "application/json" },
          body: JSON.stringify({ raw: b64url(mime(U, t.email, subject, text, html, attachments)) }) });
        if (!r.ok) { ok = false; err = ("Gmail " + r.status + ": " + (await r.text())).slice(0, 300); }
      } catch (e) { ok = false; err = String((e as Error)?.message || e).slice(0, 300); }
      await PS.from("reminder_send_log").insert({ sent_by: me, from_email: U, recipient_email: t.email, customer_name: t.customer_name,
        booking_no: "TEST-" + t.id, subject, ok, error: err, test: true });
      out.push({ to: t.email, ok, error: err });
    }
  }
  return j({ ok: true, from: U, sent: out.filter((x) => x.ok).length, failed: out.filter((x) => !x.ok).length, results: out });
}
