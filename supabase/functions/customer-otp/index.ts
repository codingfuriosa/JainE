// Customer Portal: sign in with a one-time code sent by email. No passwords.
//
//   { action: "send",   email }        -> emails a 6-digit code (valid 10 minutes)
//   { action: "verify", email, code }  -> checks it and returns a token_hash; the login page turns
//                                         that into a session with sb.auth.verifyOtp()
//
// Replaces staff-set passwords (customer-invite): nobody has to create or hand over a login any more.
// The auth account is created on the customer's first correct code - but only for an email that
// cust.login_customer_for_email() accepts: an active customer holding a live flat in a project with
// customer_login on. That rule is checked on send AND again on verify.
//
// Mail goes out through the same Gmail account as the staff password reset (GMAIL_USER /
// GMAIL_APP_PASSWORD), not Supabase's built-in mailer, which allows only a handful of emails an hour.
//
// Deployed with --no-verify-jwt: whoever calls this is, by definition, not signed in yet.

import { createClient } from "jsr:@supabase/supabase-js@2";
import { SMTPClient } from "https://deno.land/x/denomailer@1.6.0/mod.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const j = (o: unknown, status = 200) =>
  new Response(JSON.stringify(o), { status, headers: { "Content-Type": "application/json", ...CORS } });

const CODE_MINUTES = 10;
const MAX_TRIES = 5;         // wrong guesses allowed on one code
const RESEND_SECONDS = 60;   // gap between two codes for the same email
const MAX_PER_HOUR = 5;      // codes per email per hour

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

async function sha256(s: string) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(d)).map(b => b.toString(16).padStart(2, "0")).join("");
}
function sixDigits() {
  // Rejection sampling, so every code from 000000 to 999999 is equally likely.
  const buf = new Uint32Array(1);
  let n: number;
  do { crypto.getRandomValues(buf); n = buf[0]; } while (n >= 4294000000);
  return String(n % 1000000).padStart(6, "0");
}
const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
// "Mr. PROJJAL MUKHERJEE" -> "Projjal Mukherjee" for the greeting.
function niceName(full: string) {
  const n = (full || "").replace(/^(mr|mrs|ms|miss|dr|shri|smt)\.?\s+/i, "").trim().replace(/\.$/, "");
  return n.toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
}

function codeEmail(name: string, code: string) {
  const hello = name ? `Dear ${esc(name)},` : "Hello,";
  const text = `${name ? "Dear " + name + "," : "Hello,"}\n\nYour Jain Group Customer Portal sign-in code is ${code}\n\n` +
    `It works for ${CODE_MINUTES} minutes and only once. If you did not try to sign in, you can ignore this email.\n\n` +
    `Jain Group (automated message, please do not reply)`;
  const html = `<div style="margin:0;padding:24px;background:#f4f6fb;font-family:'Segoe UI',Arial,sans-serif">
  <div style="max-width:440px;margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #e5e9f0">
    <div style="background:#0f1e3d;padding:20px 26px">
      <div style="color:#ffffff;font-size:16px;font-weight:700;letter-spacing:.3px">Jain Group</div>
      <div style="color:#9db2d6;font-size:12px;margin-top:2px">Customer Portal</div>
    </div>
    <div style="padding:26px">
      <p style="margin:0 0 10px;color:#0b1220;font-size:15px">${hello}</p>
      <p style="margin:0 0 18px;color:#475569;font-size:14px;line-height:1.6">Use this code to sign in to your Customer Portal:</p>
      <div style="font-size:34px;font-weight:700;letter-spacing:10px;color:#0f1e3d;background:#f1f5fb;border:1px solid #dbe4f3;border-radius:10px;padding:16px 0;text-align:center">${code}</div>
      <p style="margin:18px 0 0;color:#64748b;font-size:13px;line-height:1.6">It works for ${CODE_MINUTES} minutes and can be used only once. Never share this code with anyone &mdash; Jain Group staff will never ask you for it.</p>
      <p style="margin:12px 0 0;color:#94a3b8;font-size:12.5px;line-height:1.6">If you did not try to sign in, you can safely ignore this email.</p>
    </div>
    <div style="padding:14px 26px;background:#f8fafc;border-top:1px solid #e5e9f0">
      <p style="margin:0;color:#94a3b8;font-size:12px">Automated message from Jain Group. Please do not reply to this email.</p>
    </div>
  </div>
</div>`;
  return { text, html };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return j({ error: "POST only" }, 405);

  const SB = Deno.env.get("SUPABASE_URL")!;
  const SRV = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const GU = Deno.env.get("GMAIL_USER"), GP = Deno.env.get("GMAIL_APP_PASSWORD");
  const db = createClient(SB, SRV);
  const cust = db.schema("cust");

  let body: any = {};
  try { body = await req.json(); } catch { /* empty body */ }
  const action = String(body.action || "");
  const email = String(body.email || "").trim().toLowerCase();
  if (!EMAIL_RE.test(email)) return j({ error: "Please enter a valid email address." }, 400);

  const { data: rows, error: lookErr } = await cust.rpc("login_customer_for_email", { p_email: email });
  if (lookErr) return j({ error: "Sign-in is unavailable right now. Please try again shortly." }, 500);
  const customer = (rows || [])[0] as { id: number; email: string; full_name: string; auth_user_id: string | null } | undefined;

  // ---------------------------------------------------------------- send
  if (action === "send") {
    // The page says the same thing whether or not the email is ours, so this cannot be used to find
    // out who is a customer.
    if (!customer) return j({ ok: true });
    if (!GU || !GP) return j({ error: "Sign-in email is not configured. Please contact us." }, 500);

    const hourAgo = new Date(Date.now() - 3600_000).toISOString();
    const { data: recent } = await cust.from("login_codes").select("created_at")
      .eq("customer_id", customer.id).gte("created_at", hourAgo).order("created_at", { ascending: false });
    const last = recent && recent[0] ? new Date(recent[0].created_at).getTime() : 0;
    const wait = Math.ceil((last + RESEND_SECONDS * 1000 - Date.now()) / 1000);
    if (wait > 0) return j({ ok: true, wait });
    if ((recent || []).length >= MAX_PER_HOUR) {
      return j({ error: "Too many codes requested. Please wait an hour and try again, or contact us." }, 429);
    }

    const code = sixDigits();
    // Only one code is live at a time: asking for a new one retires the old.
    await cust.from("login_codes").update({ used_at: new Date().toISOString() })
      .eq("customer_id", customer.id).is("used_at", null);
    const { error: insErr } = await cust.from("login_codes").insert({
      email, customer_id: customer.id, code_hash: await sha256(`${customer.id}:${code}:${SRV}`),
      expires_at: new Date(Date.now() + CODE_MINUTES * 60_000).toISOString(),
    });
    if (insErr) return j({ error: "Could not create a code. Please try again." }, 500);

    const { text, html } = codeEmail(niceName(customer.full_name), code);
    let client: any = null;
    try {
      client = new SMTPClient({ connection: { hostname: "smtp.gmail.com", port: 465, tls: true, auth: { username: GU, password: GP } } });
      await client.send({ from: `Jain Group Customer Portal <${GU}>`, to: email,
        subject: `${code} is your Jain Group sign-in code`, content: text, html });
    } catch (_e) {
      return j({ error: "We could not send the email just now. Please try again in a minute." }, 502);
    } finally { try { if (client) await client.close(); } catch { /* ignore */ } }
    return j({ ok: true });
  }

  // -------------------------------------------------------------- verify
  if (action === "verify") {
    const code = String(body.code || "").replace(/\D/g, "");
    if (code.length !== 6) return j({ error: "Enter the 6-digit code from the email." }, 400);
    // Same message as a wrong code: nothing here reveals whether the email is a customer's.
    if (!customer) return j({ error: "That code is not right, or it has expired. Please request a new one." }, 400);

    const { data: live } = await cust.from("login_codes").select("id,code_hash,attempts,expires_at")
      .eq("customer_id", customer.id).is("used_at", null).gt("expires_at", new Date().toISOString())
      .order("created_at", { ascending: false }).limit(1);
    const row = live && live[0];
    if (!row) return j({ error: "That code has expired. Please request a new one." }, 400);
    if (row.attempts >= MAX_TRIES) return j({ error: "Too many wrong tries. Please request a new code." }, 400);

    if ((await sha256(`${customer.id}:${code}:${SRV}`)) !== row.code_hash) {
      const tries = row.attempts + 1;
      await cust.from("login_codes").update({ attempts: tries, ...(tries >= MAX_TRIES ? { used_at: new Date().toISOString() } : {}) }).eq("id", row.id);
      const left = MAX_TRIES - tries;
      return j({ error: left > 0 ? `That code is not right. ${left} ${left === 1 ? "try" : "tries"} left.` : "Too many wrong tries. Please request a new code." }, 400);
    }
    // Spent before anything else, so the same code can never be used twice.
    const { data: spent } = await cust.from("login_codes").update({ used_at: new Date().toISOString() })
      .eq("id", row.id).is("used_at", null).select("id");
    if (!spent || !spent.length) return j({ error: "That code has already been used. Please request a new one." }, 400);

    // The auth account: the linked one, or a new one on the first sign-in.
    let authEmail = email;
    let authId = customer.auth_user_id;
    if (authId) {
      const { data: u, error } = await db.auth.admin.getUserById(authId);
      if (error || !u?.user) return j({ error: "Your account could not be opened. Please contact us." }, 500);
      authEmail = u.user.email || email;
    } else {
      const { data: existing } = await cust.rpc("login_auth_user_for_email", { p_email: email });
      const ex = (existing || [])[0] as { id: string; is_staff: boolean; linked_customer_id: number | null } | undefined;
      if (ex) {
        // Never turn a staff account, or another customer's, into this customer's login.
        if (ex.is_staff || (ex.linked_customer_id && ex.linked_customer_id !== customer.id)) {
          return j({ error: "This email cannot be used to sign in here. Please contact us." }, 409);
        }
        authId = ex.id;
      } else {
        const { data: created, error } = await db.auth.admin.createUser({
          email, email_confirm: true, app_metadata: { portal: "customer" },
        });
        if (error || !created?.user) return j({ error: "Your account could not be created. Please contact us." }, 500);
        authId = created.user.id;
      }
      const { error: linkErr } = await cust.from("customers").update({ auth_user_id: authId })
        .eq("id", customer.id).is("auth_user_id", null);
      if (linkErr) return j({ error: "Your account could not be linked. Please contact us." }, 500);
    }

    // A magic-link token, used straight away by the page to open the session. Nothing is emailed.
    const { data: link, error: linkGenErr } = await db.auth.admin.generateLink({ type: "magiclink", email: authEmail });
    const tokenHash = link?.properties?.hashed_token;
    if (linkGenErr || !tokenHash) return j({ error: "Could not sign you in. Please try again." }, 500);
    return j({ ok: true, token_hash: tokenHash });
  }

  return j({ error: "Unknown action" }, 400);
});
