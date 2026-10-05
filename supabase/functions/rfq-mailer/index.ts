/* Emails a vendor their personal RFQ link. Called from Inventory -> RFQ & Quotes by a signed-in staff member
   (verify_jwt on). The caller's own JWT is used to read the invitation, so row-level security decides who may
   send; the email goes to every contact of the vendor that is marked "RFQ emails".

   NOT DEPLOYED YET - the Supabase project is at its edge-function limit. */
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
  const SB = Deno.env.get("SUPABASE_URL")!, SRV = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
  const PORTAL = (Deno.env.get("PORTAL_URL") || "https://jaingroupe.netlify.app").replace(/\/$/, "");

  let body: any = {};
  try { body = await req.json(); } catch (_) { /* below */ }
  const id = parseInt(body?.rfq_vendor_id, 10);
  if (!Number.isFinite(id)) return j({ error: "which invitation?" }, 400);

  const asUser = { apikey: ANON, Authorization: req.headers.get("Authorization") || "", "Accept-Profile": "purchase" };
  const rvR = await fetch(`${SB}/rest/v1/rfq_vendors?id=eq.${id}&select=id,token,vendor_id,rfq_id`, { headers: asUser });
  const rv = (rvR.ok ? await rvR.json() : [])[0];
  if (!rv) return j({ error: "Invitation not found, or you are not allowed to send it." }, 403);
  const rfq = (await (await fetch(`${SB}/rest/v1/rfqs?id=eq.${rv.rfq_id}&select=doc_no,due_date,status,terms_requested,remarks`, { headers: asUser })).json())[0];
  if (!rfq || rfq.status !== "open") return j({ error: "This RFQ is not open." }, 400);
  const vendor = (await (await fetch(`${SB}/rest/v1/vendors?id=eq.${rv.vendor_id}&select=legal_name,trade_name,email`, { headers: asUser })).json())[0];
  // RFQ mails go to the vendor's one email address (Vendors tab -> Enlist / Edit vendor).
  const contacts: { email: string }[] = vendor?.email ? [{ email: vendor.email }] : [];
  if (!contacts.length) return j({ error: "This vendor has no email address - add one on the Vendors tab." }, 400);

  const link = `${PORTAL}/vendor-quote.html?t=${encodeURIComponent(rv.token)}`;
  const until = rfq.due_date ? new Date(rfq.due_date).toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" }) : "the date stated";
  const html = `<div style="margin:0;padding:24px;background:#f1f5f9;font-family:Segoe UI,Arial,sans-serif"><div style="max-width:600px;margin:0 auto;background:#fff;border:1px solid #e2e8f0;border-radius:12px;overflow:hidden">
<div style="background:#12141c;padding:18px 24px;border-bottom:3px solid #9c1420"><b style="color:#fff;font-size:16px;letter-spacing:1.5px">THE JAIN GROUP</b></div>
<div style="padding:24px;color:#1e293b;font-size:14.5px;line-height:1.6"><p style="margin:0 0 14px">Dear ${esc(vendor?.trade_name || vendor?.legal_name || "Sir / Madam")},</p>
<p style="margin:0 0 14px">We invite your quotation against <b>${esc(rfq.doc_no)}</b>. Please quote item-wise rates and your terms using the secure link below — no sign-in is needed. Quotations are accepted until <b>${until}</b>, and you may revise yours until then.</p>
${rfq.terms_requested ? `<p style="margin:0 0 14px;white-space:pre-wrap"><b>Please state:</b> ${esc(rfq.terms_requested)}</p>` : ""}
<p style="margin:22px 0"><a href="${link}" style="background:#9c1420;color:#fff;text-decoration:none;padding:12px 22px;border-radius:8px;font-weight:700;display:inline-block">Submit quotation</a></p>
<p style="margin:0;color:#64748b;font-size:12.5px;word-break:break-all">If the button does not work, copy this address into your browser:<br>${link}</p></div>
<div style="padding:12px 24px;background:#f8fafc;border-top:1px solid #e2e8f0;color:#94a3b8;font-size:12px">The link is personal to you. Sent by the Purchase department, The Jain Group.</div></div></div>`;
  const text = `We invite your quotation against ${rfq.doc_no}. Submit it here (no sign-in needed): ${link}\nLast date: ${until}.\n\nPurchase department, The Jain Group`;

  try {
    const client = new SMTPClient({ connection: { hostname: "smtp.gmail.com", port: 465, tls: true, auth: { username: GU, password: GP } } });
    for (const c of contacts) await client.send({ from: GU, to: c.email, subject: `Request for quotation ${rfq.doc_no} - The Jain Group`, content: text, html });
    await client.close();
  } catch (e) {
    return j({ error: "The email could not be sent.", detail: String(e).slice(0, 200) }, 502);
  }
  await fetch(`${SB}/rest/v1/rfq_vendors?id=eq.${id}`, {
    method: "PATCH",
    headers: { apikey: SRV, Authorization: "Bearer " + SRV, "Content-Profile": "purchase", "Content-Type": "application/json", Prefer: "return=minimal" },
    body: JSON.stringify({ emailed_at: new Date().toISOString() }),
  });
  return j({ ok: true, sent_to: contacts.length });
});
