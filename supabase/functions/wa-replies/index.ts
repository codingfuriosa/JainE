// WHATSAPP REPLY TEXT FOR MARKETING (25 Nov 2026, Ayush: "I want ... 3" - what customers actually write back to the
// marketing WhatsApp numbers, and who). Meta's WhatsApp Cloud API calls this webhook for every message a customer sends
// to a number whose WhatsApp account is subscribed to JAIN-E's app ("JainE Wa2"). Each one is kept in camp.wa_inbound and
// shown in WhatsApp Templates > Replies. Read only: nothing is ever sent from here.
//
// PUBLIC on purpose (verify_jwt off): Meta has no JainE login. So:
//   GET  - Meta's one-time check: hub.verify_token must equal acc.job_secrets 'wa_replies_verify'.
//   POST - accepted only with Meta's signature (X-Hub-Signature-256 = HMAC-SHA256 of the body with the app secret of
//          "JainE Wa2", saved by Ayush as acc.job_secrets 'wa_replies_app_secret'). Until it is saved every POST is refused,
//          so nobody can post fake replies.
// Status updates (sent / delivered / read) that come on the same webhook are ignored - those figures come from
// wa-deliveries-sync.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.47.10";

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const ACC = db.schema("acc"), CAMP = db.schema("camp");
const j = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { "Content-Type": "application/json" } });
async function secret(name: string) { const { data } = await ACC.from("job_secrets").select("value").eq("name", name).maybeSingle(); return (data && data.value) || ""; }
async function hmacHex(key: string, body: string) {
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(body)));
  return Array.from(sig).map((b) => b.toString(16).padStart(2, "0")).join("");
}
function same(a: string, b: string) { if (!a || !b || a.length !== b.length) return false; let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i); return d === 0; }
const tsIso = (t: any) => { const n = Number(t); return isFinite(n) && n > 0 ? new Date(n * 1000).toISOString() : new Date().toISOString(); };
function textOf(m: any) {
  const t = m.type;
  if (t === "text") return String(m.text?.body || "");
  if (t === "button") return String(m.button?.text || m.button?.payload || "");
  if (t === "interactive") return String(m.interactive?.button_reply?.title || m.interactive?.list_reply?.title || "");
  if (t === "image") return "[Photo]" + (m.image?.caption ? " " + m.image.caption : "");
  if (t === "video") return "[Video]" + (m.video?.caption ? " " + m.video.caption : "");
  if (t === "document") return "[Document]" + (m.document?.filename ? " " + m.document.filename : "");
  if (t === "audio") return "[Voice note]";
  if (t === "location") return "[Location]";
  if (t === "reaction") return "[Reaction " + (m.reaction?.emoji || "") + "]";
  if (t === "sticker") return "[Sticker]";
  return "[" + (t || "message") + "]";
}

Deno.serve(async (req) => {
  const url = new URL(req.url);
  if (req.method === "GET") {
    const want = await secret("wa_replies_verify");
    if (want && url.searchParams.get("hub.mode") === "subscribe" && same(String(url.searchParams.get("hub.verify_token") || ""), want))
      return new Response(url.searchParams.get("hub.challenge") || "", { status: 200 });
    return new Response("forbidden", { status: 403 });
  }
  if (req.method !== "POST") return j({ error: "method not allowed" }, 405);
  const raw = await req.text();
  const appSecret = await secret("wa_replies_app_secret");
  const sig = String(req.headers.get("x-hub-signature-256") || "").replace(/^sha256=/, "");
  if (!appSecret || !same(sig, await hmacHex(appSecret, raw))) return j({ error: "unauthorized" }, 401);
  let body: any; try { body = JSON.parse(raw); } catch (_) { return j({ ok: true }); }
  const rows: any[] = [];
  for (const e of body.entry || []) for (const ch of e.changes || []) {
    if (ch.field !== "messages") continue;
    const v = ch.value || {}, md = v.metadata || {}, names: Record<string, string> = {};
    for (const c of v.contacts || []) names[String(c.wa_id || "")] = c.profile?.name || "";
    for (const m of v.messages || []) rows.push({ id: String(m.id), waba_id: String(e.id || ""), phone_number_id: String(md.phone_number_id || ""),
      business_number: String(md.display_phone_number || ""), from_phone: String(m.from || ""), from_name: names[String(m.from || "")] || null,
      ts: tsIso(m.timestamp), kind: m.type || null, body: textOf(m), reply_to: m.context?.id || null, raw: m });
  }
  if (rows.length) { const { error } = await CAMP.from("wa_inbound").upsert(rows, { onConflict: "id", ignoreDuplicates: true }); if (error) return j({ error: "save failed" }, 500); }
  return j({ ok: true, saved: rows.length });
});
