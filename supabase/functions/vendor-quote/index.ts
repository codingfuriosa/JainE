/* The public end of vendor quotations. vendor-quote.html is one static page; the RFQ link carries a personal
   token and everything the page does goes through this function:

     action "get"     -> is the link good, and what is being asked (items, terms requested, previous quote)
     action "submit"  -> the quotation (or a decline), validated and saved as a new revision in the database

   Same shape as vendor-register: no Supabase key on the public page, every request needs a token that
   resolves to a live invitation (RFQ open, last date not passed), and the database functions it calls
   (purchase.rfq_quote_get / rfq_quote_submit) are executable by the service role only.

   NOT DEPLOYED YET - the Supabase project is at its edge-function limit. Deploy it (or fold it into the
   single vendor-facing function) once a slot is free. */
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const j = (o: unknown, status = 200) =>
  new Response(JSON.stringify(o), { status, headers: { ...cors, "Content-Type": "application/json" } });

const SB = Deno.env.get("SUPABASE_URL");
const SRV = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const H = {
  apikey: SRV ?? "", Authorization: "Bearer " + (SRV ?? ""),
  "Accept-Profile": "purchase", "Content-Profile": "purchase", "Content-Type": "application/json",
};
const clean = (v: unknown, max = 200) => String(v == null ? "" : v).replace(/[\r\n\t]+/g, " ").trim().slice(0, max);

async function rpc(fn: string, args: Record<string, unknown>) {
  const r = await fetch(`${SB}/rest/v1/rpc/${fn}`, { method: "POST", headers: H, body: JSON.stringify(args) });
  const t = await r.text();
  let out: any = null;
  try { out = JSON.parse(t); } catch (_) { /* below */ }
  if (!r.ok) return { error: "server", detail: t.slice(0, 300) };
  return out;
}

const WHY: Record<string, string> = {
  not_found: "This quotation link is not valid. Please use the exact link we emailed you.",
  cancelled: "This request for quotation has been cancelled. Thank you.",
  closed: "This request for quotation is no longer accepting quotations.",
  expired: "The last date for quotations on this request has passed. Please contact the purchase team.",
};
const gone = (code: string) => j({ error: WHY[code] || "This link cannot be used.", gone: true, code }, 410);

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return j({ error: "method not allowed" }, 405);
  if (!SB || !SRV) return j({ error: "server not configured" }, 500);

  let body: any = {};
  try { body = await req.json(); } catch (_) { /* below */ }
  const action = String(body?.action || "");
  const token = clean(body?.token, 200);
  if (!token) return j({ error: "This link is missing its reference. Please use the exact link we emailed you." }, 400);

  if (action === "get") {
    const out: any = await rpc("rfq_quote_get", { p_token: token });
    if (!out || out.error === "server") return j({ error: "Could not check your link. Please try again." }, 500);
    if (out.error) return gone(out.error);
    return j(out);
  }

  if (action === "submit") {
    if (clean(body?.website)) return j({ ok: true, ignored: true });   // honeypot
    let payload: any;
    if (body?.decline) {
      payload = { decline: true, reason: clean(body?.reason, 300) };
    } else {
      const arr = (v: unknown, max: number) => (Array.isArray(v) ? v.slice(0, max) : []);
      payload = {
        lines: arr(body?.lines, 300).map((l: any) => ({
          rfq_line_id: parseInt(l?.rfq_line_id, 10), quoting: l?.quoting !== false,
          uom_id: l?.uom_id == null ? null : parseInt(l.uom_id, 10), rate: l?.rate == null || l.rate === "" ? null : Number(l.rate),
          gst_rate: l?.gst_rate == null || l.gst_rate === "" ? 0 : Number(l.gst_rate), make: clean(l?.make, 120), remark: clean(l?.remark, 200),
        })),
        payment_terms: clean(body?.payment_terms, 300), delivery_terms: clean(body?.delivery_terms, 300), warranty_terms: clean(body?.warranty_terms, 300),
        freight_terms: clean(body?.freight_terms, 300), price_validity: clean(body?.price_validity, 200), other_terms: clean(body?.other_terms, 500), remarks: clean(body?.remarks, 500),
      };
    }
    const out: any = await rpc("rfq_quote_submit", { p_token: token, p: payload });
    if (!out || out.error === "server") return j({ error: "We could not record your quotation. Please try again.", detail: out?.detail }, 500);
    if (out.error === "invalid") return j({ error: out.message || "Please check the form and try again." }, 400);
    if (out.error) return gone(out.error);
    return j({ ok: true, declined: !!out.declined, revision: out.revision,
      message: out.declined ? "Thank you - we have noted that you will not be quoting." : "Thank you - your quotation has been received." });
  }

  return j({ error: "unknown action" }, 400);
});
