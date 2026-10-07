/* The public end of vendor self-registration. vendor-register.html is one static page; the registration
   link carries a token, and everything the page does goes through this function:

     action "get"     -> is the link good, and what does the form need (item groups)
     multipart upload -> one document (PAN, GST certificate, cancelled cheque ...) into S3
     action "submit"  -> the whole registration, validated and written in one transaction

   Deliberately the narrowest door that does the job (same shape as career-apply):
     * no Supabase key of any kind goes onto the public page
     * every request must carry a token that resolves to a live (unused, unexpired, unrevoked) invite
     * documents go into S3 from here, server-side, under purchase/vendors/invites/<invite id>/ only;
       the submit step accepts only paths under that prefix
     * the database functions it calls (purchase.vendor_invite_check / register_vendor) are executable
       by the service role only
     * nothing here can read a registration back out
*/
import { AwsClient } from "https://esm.sh/aws4fetch@1.0.20";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const j = (o: unknown, status = 200) =>
  new Response(JSON.stringify(o), { status, headers: { ...cors, "Content-Type": "application/json" } });

const DOC_EXT = ["pdf", "jpg", "jpeg", "png"];
const DOC_TYPES = ["pan", "gst_certificate", "cancelled_cheque", "msme_certificate", "other"];
const MAX_DOC_MB = 8;

const SB = Deno.env.get("SUPABASE_URL");
const SRV = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const H = {
  apikey: SRV ?? "", Authorization: "Bearer " + (SRV ?? ""),
  "Accept-Profile": "purchase", "Content-Profile": "purchase", "Content-Type": "application/json",
};

const clean = (v: unknown, max = 200) => String(v == null ? "" : v).replace(/[\r\n\t]+/g, " ").trim().slice(0, max);
const safeName = (n: string) => String(n || "document").replace(/[^A-Za-z0-9._-]+/g, "_").replace(/_+/g, "_").slice(-120);
const stamp = () => new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14) + "_" + Math.random().toString(36).slice(2, 6);

async function rpc(fn: string, args: Record<string, unknown>) {
  const r = await fetch(`${SB}/rest/v1/rpc/${fn}`, { method: "POST", headers: H, body: JSON.stringify(args) });
  const t = await r.text();
  let out: any = null;
  try { out = JSON.parse(t); } catch (_) { /* below */ }
  if (!r.ok) return { error: "server", detail: t.slice(0, 300) };
  return out;
}

const WHY: Record<string, string> = {
  not_found: "This registration link is not valid. Please use the exact link we emailed you.",
  revoked: "This registration link has been cancelled. Please contact the purchase team.",
  used: "This registration has already been submitted. Thank you - there is nothing more to do.",
  expired: "This registration link has expired. Please ask the purchase team to send a new one.",
};
const gone = (code: string) => j({ error: WHY[code] || "This link cannot be used.", gone: true, code }, 410);

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return j({ error: "method not allowed" }, 405);
  if (!SB || !SRV) return j({ error: "server not configured" }, 500);

  const ctype = req.headers.get("content-type") || "";

  /* ── a document ───────────────────────────────────────────────────────────────────────── */
  if (ctype.startsWith("multipart/form-data")) {
    let form: FormData;
    try { form = await req.formData(); } catch (_) { return j({ error: "Could not read the upload." }, 400); }

    const token = clean(form.get("token"), 200);
    const inv: any = token ? await rpc("vendor_invite_check", { p_token: token }) : { error: "not_found" };
    if (!inv || inv.error) return inv && WHY[inv.error] ? gone(inv.error) : j({ error: "Could not check your link. Please try again." }, 500);

    const docType = clean(form.get("doc_type"), 40);
    if (!DOC_TYPES.includes(docType)) return j({ error: "Unknown document type." }, 400);
    const file = form.get("file");
    if (!(file instanceof File)) return j({ error: "Please choose a file." }, 400);

    const name = safeName(file.name);
    const ext = (name.split(".").pop() || "").toLowerCase();
    if (!DOC_EXT.includes(ext)) return j({ error: `Please upload a ${DOC_EXT.join(", ").toUpperCase()} file.` }, 400);
    if (file.size > MAX_DOC_MB * 1024 * 1024) return j({ error: `That file is larger than ${MAX_DOC_MB}MB.` }, 400);
    if (file.size === 0) return j({ error: "That file appears to be empty." }, 400);

    const bucket = Deno.env.get("S3_BUCKET");
    const region = Deno.env.get("S3_REGION");
    const ak = Deno.env.get("AWS_ACCESS_KEY_ID");
    const sk = Deno.env.get("AWS_SECRET_ACCESS_KEY");
    if (!bucket || !region || !ak || !sk) return j({ error: "file storage is not configured" }, 500);

    // Same portal/ root and s3: prefix as the rest of JainE, so staff open it like any other file.
    const key = `portal/purchase/vendors/invites/${inv.id}/${stamp()}_${name}`;
    const aws = new AwsClient({ accessKeyId: ak, secretAccessKey: sk, region, service: "s3" });
    const url = `https://${bucket}.s3.${region}.amazonaws.com/${key.split("/").map(encodeURIComponent).join("/")}`;
    const put = await aws.fetch(url, {
      method: "PUT",
      body: new Uint8Array(await file.arrayBuffer()),
      headers: { "Content-Type": file.type || "application/octet-stream" },
    });
    if (!put.ok) return j({ error: "That file did not upload. Please try again.", status: put.status }, 502);
    return j({ ok: true, doc_type: docType, storage_path: "s3:" + key, file_name: name });
  }

  /* ── everything else is JSON ──────────────────────────────────────────────────────────── */
  let body: any = {};
  try { body = await req.json(); } catch (_) { /* handled below */ }
  const action = String(body?.action || "");
  const token = clean(body?.token, 200);
  if (!token) return j({ error: "This link is missing its registration reference. Please use the exact link we emailed you." }, 400);

  if (action === "get") {
    const inv: any = await rpc("vendor_invite_check", { p_token: token });
    if (!inv || inv.error) return inv && WHY[inv.error] ? gone(inv.error) : j({ error: "Could not check your link. Please try again." }, 500);
    return j({ ok: true, email: inv.email, contact_name: inv.contact_name, vendor_name: inv.vendor_name, groups: inv.groups });
  }

  if (action === "submit") {
    // A field no human sees and no human fills. Bots fill everything.
    if (clean(body?.website)) return j({ ok: true, ignored: true });

    const arr = (v: unknown, max: number) => (Array.isArray(v) ? v.slice(0, max) : []);
    const payload = {
      legal_name: clean(body?.legal_name, 200), trade_name: clean(body?.trade_name, 200),
      vendor_type: clean(body?.vendor_type, 20) || "supplier",
      gstin: clean(body?.gstin, 15), pan: clean(body?.pan, 10), msme_no: clean(body?.msme_no, 60),
      address: clean(body?.address, 300), city: clean(body?.city, 80), state: clean(body?.state, 80),
      pincode: clean(body?.pincode, 6), payment_terms: clean(body?.payment_terms, 200),
      contacts: arr(body?.contacts, 10).map((c: any) => ({
        name: clean(c?.name, 120), designation: clean(c?.designation, 120), email: clean(c?.email, 160).toLowerCase(),
        phone: clean(c?.phone, 40), is_primary: !!c?.is_primary, gets_rfq: c?.gets_rfq !== false,
      })),
      banks: arr(body?.banks, 5).map((b: any) => ({
        bank_name: clean(b?.bank_name, 120), account_name: clean(b?.account_name, 160), account_no: clean(b?.account_no, 40),
        ifsc: clean(b?.ifsc, 11), branch: clean(b?.branch, 120), is_default: !!b?.is_default,
      })),
      group_ids: arr(body?.group_ids, 300).map((g: any) => parseInt(g, 10)).filter((g: number) => Number.isFinite(g)),
      documents: arr(body?.documents, 12).map((d: any) => ({
        doc_type: clean(d?.doc_type, 40), storage_path: clean(d?.storage_path, 400), file_name: clean(d?.file_name, 160),
      })),
    };
    const out: any = await rpc("register_vendor", { p_token: token, p: payload });
    if (!out || out.error === "server") return j({ error: "We could not record your registration. Please try again.", detail: out?.detail }, 500);
    if (out.error === "invalid") return j({ error: out.message || "Please check the form and try again." }, 400);
    if (out.error) return gone(out.error);
    return j({ ok: true, message: "Thank you - your registration has reached us. We will be in touch once it has been reviewed." });
  }

  return j({ error: "unknown action" }, 400);
});
