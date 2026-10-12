/* Emails a vendor their registration link. Called from Inventory -> Vendors by a signed-in staff member
   (verify_jwt is on). The caller's own JWT is used to read the invitation, so the existing row-level
   security decides who may send: a customer-portal session reads nothing and is refused. */
import { SMTPClient } from "https://deno.land/x/denomailer@1.6.0/mod.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const j = (o: unknown, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { ...cors, "Content-Type": "application/json" } });
const esc = (s: unknown) => String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return j({ error: "method not allowed" }, 405);

  const GU = Deno.env.get("GMAIL_USER"), GP = Deno.env.get("GMAIL_APP_PASSWORD");
  if (!GU || !GP) return j({ error: "Gmail secrets (GMAIL_USER / GMAIL_APP_PASSWORD) are not set." }, 500);
  const SB = Deno.env.get("SUPABASE_URL")!, SRV = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
  const PORTAL = (Deno.env.get("PORTAL_URL") || "https://jaingroupe.netlify.app").replace(/\/$/, "");

  let body: any = {};
  try { body = await req.json(); } catch (_) { /* below */ }
  const id = parseInt(body?.invite_id, 10);
  if (!Number.isFinite(id)) return j({ error: "which invitation?" }, 400);

  // Read it AS THE CALLER. No row back = not allowed (or not there).
  const mine = await fetch(`${SB}/rest/v1/vendor_invites?id=eq.${id}&select=id,token,email,contact_name,vendor_name,expires_at,used_at,revoked_at`, {
    headers: { apikey: ANON, Authorization: req.headers.get("Authorization") || "", "Accept-Profile": "purchase" },
  });
  const rows = mine.ok ? await mine.json() : [];
  const inv = Array.isArray(rows) ? rows[0] : null;
  if (!inv) return j({ error: "Invitation not found, or you are not allowed to send it." }, 403);
  if (inv.used_at) return j({ error: "This vendor has already registered." }, 400);
  if (inv.revoked_at) return j({ error: "This invitation has been cancelled." }, 400);
  if (new Date(inv.expires_at) < new Date()) return j({ error: "This invitation has expired." }, 400);

  const link = `${PORTAL}/vendor-register.html?t=${encodeURIComponent(inv.token)}`;
  const hello = inv.contact_name ? `Dear ${esc(inv.contact_name)},` : "Dear Sir / Madam,";
  const until = new Date(inv.expires_at).toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" });
  const html = `<div style="margin:0;padding:24px;background:#f1f5f9;font-family:Segoe UI,Arial,sans-serif"><div style="max-width:600px;margin:0 auto;background:#fff;border:1px solid #e2e8f0;border-radius:12px;overflow:hidden">
<div style="background:#12141c;padding:18px 24px;border-bottom:3px solid #9c1420"><b style="color:#fff;font-size:16px;letter-spacing:1.5px">THE JAIN GROUP</b></div>
<div style="padding:24px;color:#1e293b;font-size:14.5px;line-height:1.6"><p style="margin:0 0 14px">${hello}</p>
<p style="margin:0 0 14px">${inv.vendor_name ? `We would like to enlist <b>${esc(inv.vendor_name)}</b> as a vendor with The Jain Group.` : "We would like to enlist you as a vendor with The Jain Group."} Please complete your registration using the secure link below. It takes about five minutes; keep your GST certificate, PAN card and a cancelled cheque handy.</p>
<p style="margin:22px 0"><a href="${link}" style="background:#9c1420;color:#fff;text-decoration:none;padding:12px 22px;border-radius:8px;font-weight:700;display:inline-block">Complete registration</a></p>
<p style="margin:0 0 6px;color:#64748b;font-size:12.5px">The link is personal to you and works once. It expires on ${until}.</p>
<p style="margin:0;color:#64748b;font-size:12.5px;word-break:break-all">If the button does not work, copy this address into your browser:<br>${link}</p></div>
<div style="padding:12px 24px;background:#f8fafc;border-top:1px solid #e2e8f0;color:#94a3b8;font-size:12px">Sent by the Purchase department, The Jain Group.</div></div></div>`;
  const text = `${inv.contact_name ? `Dear ${inv.contact_name},` : "Dear Sir / Madam,"}\n\nPlease complete your vendor registration with The Jain Group: ${link}\n\nThe link is personal to you, works once, and expires on ${until}.\n\nPurchase department, The Jain Group`;

  try {
    const client = new SMTPClient({ connection: { hostname: "smtp.gmail.com", port: 465, tls: true, auth: { username: GU, password: GP } } });
    await client.send({ from: GU, to: inv.email, subject: "Vendor registration - The Jain Group", content: text, html });
    await client.close();
  } catch (e) {
    return j({ error: "The email could not be sent.", detail: String(e).slice(0, 200) }, 502);
  }

  await fetch(`${SB}/rest/v1/vendor_invites?id=eq.${id}`, {
    method: "PATCH",
    headers: { apikey: SRV, Authorization: "Bearer " + SRV, "Content-Profile": "purchase", "Content-Type": "application/json", Prefer: "return=minimal" },
    body: JSON.stringify({ emailed_at: new Date().toISOString() }),
  });
  return j({ ok: true });
});
