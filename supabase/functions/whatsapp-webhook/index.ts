// WHATSAPP INTO POST SALES CUSTOMER TICKETS (13 Nov 2026, Ayush: "make the Customer Tickets expand to Whatsapp as well
// from Gmail"). Meta's WhatsApp Cloud API calls this webhook with every message on the Post Sales number:
//   field "messages"            a customer wrote                      -> Customer side of the ticket
//   field "smb_message_echoes"  Post Sales replied from the WhatsApp   -> Post Sales side (Coexistence: the phone app
//                               Business App on the phone                 keeps working beside the Cloud API)
//   field "history"             the chats Meta shares when the number is connected (up to 6 months)
// Each customer's open conversation is one ticket (channel "whatsapp"), matched to the customer by phone number from
// Farvision. A solved ticket stays solved - the customer's next message starts a new one. Gemini reads the ticket on
// the next mailbox run (needs_ai), exactly as for email.
//
// PUBLIC on purpose (verify_jwt off): Meta has no JainE login. So:
//   GET  - Meta's one-time check: hub.verify_token must equal acc.job_secrets 'whatsapp_verify'.
//   POST - accepted only with Meta's signature (X-Hub-Signature-256, HMAC of the body with the app secret in
//          acc.job_secrets 'whatsapp_app_secret'), or for our own test with x-audit-secret = 'booking_audit'.
//          Until the app secret is saved, Meta's calls are refused, so nobody can post fake messages.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.47.10";

const SB = Deno.env.get("SUPABASE_URL")!, SRV = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const db = createClient(SB, SRV);
const PS = db.schema("postsales"), ACC = db.schema("acc"), CUST = db.schema("cust");
const j = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { "Content-Type": "application/json" } });

async function secret(name: string) {
  const { data } = await ACC.from("job_secrets").select("value").eq("name", name).maybeSingle();
  return (data && data.value) || "";
}
async function hmacHex(key: string, body: string) {
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(body)));
  return Array.from(sig).map((b) => b.toString(16).padStart(2, "0")).join("");
}
const digits = (p: string) => String(p || "").replace(/\D/g, "");
const tsIso = (t: any) => { const n = Number(t); return isFinite(n) && n > 0 ? new Date(n * 1000).toISOString() : new Date().toISOString(); };

// what a message says, whatever its kind
function textOf(m: any) {
  const t = m.type;
  if (t === "text") return String(m.text?.body || "");
  if (t === "image") return "[Photo]" + (m.image?.caption ? " " + m.image.caption : "");
  if (t === "video") return "[Video]" + (m.video?.caption ? " " + m.video.caption : "");
  if (t === "document") return "[Document" + (m.document?.filename ? ": " + m.document.filename : "") + "]" + (m.document?.caption ? " " + m.document.caption : "");
  if (t === "audio") return m.audio?.voice ? "[Voice note]" : "[Audio]";
  if (t === "sticker") return "[Sticker]";
  if (t === "location") return "[Location] " + [m.location?.name, m.location?.address].filter(Boolean).join(", ");
  if (t === "contacts") return "[Contact card]";
  if (t === "button") return String(m.button?.text || "[Button]");
  if (t === "interactive") return String(m.interactive?.button_reply?.title || m.interactive?.list_reply?.title || "[Reply]");
  if (t === "reaction") return "";                                    // a reaction is not a message
  return "[" + (t || "message") + "]";
}

// the customer for a phone number, from Farvision (last 10 digits, as numbers are written in many ways)
async function matchPhone(phone: string) {
  const last10 = digits(phone).slice(-10); if (last10.length < 10) return null;
  const { data } = await CUST.from("farvision_contacts").select("contact_name,contact_email,contact_phone,unit_id,is_current,created_at")
    .ilike("contact_phone", "%" + last10).is("deleted_at", null).order("is_current", { ascending: false }).order("created_at", { ascending: false }).limit(1);
  const c = data && data[0]; if (!c) return null;
  let unit: any = null, project = null;
  if (c.unit_id) {
    const { data: u } = await CUST.from("units").select("id,tower,unit_code,project_id").eq("id", c.unit_id).maybeSingle(); unit = u;
    if (u?.project_id) { const { data: p } = await CUST.from("projects").select("name").eq("id", u.project_id).maybeSingle(); project = p?.name || null; }
  }
  return { name: c.contact_name, email: c.contact_email, unit_id: unit?.id || null, tower: unit?.tower || null, unit_code: unit?.unit_code || null, project };
}

/* one message into its ticket. dir "in" = the customer, "out" = Post Sales. */
async function addMessage(o: { phone: string; name?: string; dir: "in" | "out"; id: string; ts: string; text: string; business: string }, rep: any) {
  const phone = digits(o.phone); if (!phone || !o.id) { rep.skipped++; return; }
  if (!o.text) { rep.skipped++; return; }
  // already have it (Meta can send the same message more than once)
  const { data: dup } = await PS.from("ticket_messages").select("id").eq("message_key", "wa:" + o.id).maybeSingle();
  if (dup) { rep.skipped++; return; }
  // the customer's open WhatsApp ticket; a solved one is left alone
  const { data: open } = await PS.from("tickets").select("*").eq("channel", "whatsapp").like("thread_key", "wa:" + phone + ":%")
    .neq("status", "resolved").order("created_at", { ascending: false }).limit(1);
  let t = open && open[0];
  if (!t && o.dir === "out") { rep.skipped++; return; }               // Post Sales writing first, with no customer conversation: not a ticket
  if (!t) {
    const c = await matchPhone(phone);
    const { data: ins, error } = await PS.from("tickets").insert({ channel: "whatsapp", thread_key: "wa:" + phone + ":" + Date.parse(o.ts),
      customer_email: c?.email || null, customer_name: c?.name || o.name || null, customer_phone: "+" + phone, unit_id: c?.unit_id || null,
      project: c?.project || null, tower: c?.tower || null, unit_code: c?.unit_code || null,
      subject: "WhatsApp: " + o.text.replace(/\s+/g, " ").slice(0, 90), status: "open", first_received_at: o.ts, last_customer_at: o.ts,
      messages: 0, needs_ai: true }).select("*").single();
    if (error) { rep.errors.push(error.message); return; }
    t = ins; rep.tickets_new++;
  }
  const { error: me } = await PS.from("ticket_messages").insert({ ticket_id: t.id, mailbox: "whatsapp:" + digits(o.business), message_key: "wa:" + o.id,
    thread_key: t.thread_key, direction: o.dir, from_email: o.dir === "in" ? "+" + phone : "+" + digits(o.business),
    from_name: o.dir === "in" ? (o.name || t.customer_name || null) : "Post Sales", to_emails: [], subject: t.subject, sent_at: o.ts, body: o.text.slice(0, 6000) });
  if (me) { if (!/duplicate/i.test(me.message)) rep.errors.push(me.message); return; }
  const upd: any = { messages: (t.messages || 0) + 1, updated_at: new Date().toISOString() };
  if (o.dir === "in") {
    upd.last_customer_at = (!t.last_customer_at || o.ts > t.last_customer_at) ? o.ts : t.last_customer_at;
    if (!t.first_received_at || o.ts < t.first_received_at) upd.first_received_at = o.ts;
    upd.needs_ai = true;
    if (!t.last_reply_at || upd.last_customer_at > t.last_reply_at) upd.status = "open";
    if (o.name && !t.customer_name) upd.customer_name = o.name;
  } else {
    if (!t.first_reply_at && o.ts >= (t.first_received_at || o.ts)) upd.first_reply_at = o.ts;
    upd.last_reply_at = (!t.last_reply_at || o.ts > t.last_reply_at) ? o.ts : t.last_reply_at;
    if (upd.last_reply_at >= (t.last_customer_at || "")) upd.status = "answered";
  }
  await PS.from("tickets").update(upd).eq("id", t.id);
  rep[o.dir === "in" ? "customer_msgs" : "post_sales_msgs"]++;
}

async function handle(payload: any) {
  const rep: any = { customer_msgs: 0, post_sales_msgs: 0, tickets_new: 0, skipped: 0, errors: [] as string[] };
  for (const e of payload?.entry || []) for (const ch of e.changes || []) {
    const v = ch.value || {}, business = v.metadata?.display_phone_number || "";
    const names: Record<string, string> = {}; for (const c of v.contacts || []) if (c.wa_id) names[digits(c.wa_id)] = c.profile?.name || "";
    if (ch.field === "messages") {
      for (const m of v.messages || []) await addMessage({ phone: m.from, name: names[digits(m.from)], dir: "in", id: m.id, ts: tsIso(m.timestamp), text: textOf(m), business }, rep);
    } else if (ch.field === "smb_message_echoes") {
      for (const m of v.message_echoes || []) await addMessage({ phone: m.to, dir: "out", id: m.id, ts: tsIso(m.timestamp), text: textOf(m), business }, rep);
    } else if (ch.field === "history") {
      // past chats, oldest first so each conversation is built in order
      const all: any[] = [];
      for (const h of v.history || []) for (const th of h.threads || []) for (const m of th.messages || []) {
        const fromBiz = digits(m.from) === digits(business);
        all.push({ phone: fromBiz ? (m.to || th.id) : m.from, dir: fromBiz ? "out" : "in", id: m.id, ts: tsIso(m.timestamp), text: textOf(m), business });
      }
      all.sort((a, b) => a.ts.localeCompare(b.ts));
      for (const x of all) await addMessage(x, rep);
    }
  }
  return rep;
}

Deno.serve(async (req) => {
  const url = new URL(req.url);
  if (req.method === "GET") {
    const vt = await secret("whatsapp_verify");
    if (url.searchParams.get("hub.mode") === "subscribe" && vt && url.searchParams.get("hub.verify_token") === vt)
      return new Response(url.searchParams.get("hub.challenge") || "", { status: 200 });
    return new Response("forbidden", { status: 403 });
  }
  if (req.method !== "POST") return new Response("method not allowed", { status: 405 });
  const raw = await req.text();
  const test = req.headers.get("x-audit-secret") || "";
  let ok = false;
  if (test) { ok = test === await secret("booking_audit"); }
  else {
    const app = await secret("whatsapp_app_secret"), sig = (req.headers.get("x-hub-signature-256") || "").replace(/^sha256=/, "");
    ok = !!app && !!sig && sig === await hmacHex(app, raw);
  }
  if (!ok) return new Response("unauthorized", { status: 401 });
  let payload: any = null; try { payload = JSON.parse(raw); } catch { return j({ error: "bad json" }, 400); }
  try { return j({ ok: true, ...(await handle(payload)) }); }
  catch (e) { return j({ ok: false, error: String((e as Error).message || e).slice(0, 300) }, 200); }   // 200: Meta must not resend endlessly
});
