// Customer Portal: raise a support ticket in Zoho Desk, and pull its current status back.
//
// cust.support_tickets is a local MIRROR, not the system of record - Zoho Desk is. The flow is:
//   1. Customer raises a ticket normally (client-side insert into cust.support_tickets, allowed by
//      its own RLS insert policy) - this happens BEFORE this function is ever called.
//   2. Client calls this function with {action:'create', ticketId} - it creates the matching ticket
//      in Zoho Desk and writes zoho_ticket_id/zoho_ticket_number/zoho_status/status back onto that
//      same local row.
//   3. Later, {action:'sync', ticketId} re-fetches that ticket's current status from Zoho Desk and
//      updates the local mirror again - this is what "current status ... reflected here" means.
//
// Authorization is delegated to Postgres RLS wherever possible rather than reimplemented here: every
// lookup of the ticket row itself runs AS THE CALLER (their own JWT), so cust.support_tickets' own
// select policy (owning customer, or staff) is what decides whether they may act on that ticket at
// all. Only the actual Zoho API calls and the write-back of zoho_* columns use the service role -
// Zoho credentials, and writing a system-of-record status, are not something a customer's JWT does.
//
// Zoho credentials (ZOHO_DC/CLIENT_ID/CLIENT_SECRET/REFRESH_TOKEN/ORG_ID) live in Supabase Vault,
// read here via app.get_zoho_secrets() - a function grant()ed to service_role only - rather than as
// this function's own Secrets. Set them once via SQL:
//   select vault.create_secret('in', 'ZOHO_DC', '...');                 -- "com","in","eu","com.au","jp"
//   select vault.create_secret('<id>', 'ZOHO_CLIENT_ID', '...');
//   select vault.create_secret('<secret>', 'ZOHO_CLIENT_SECRET', '...');
//   select vault.create_secret('<token>', 'ZOHO_REFRESH_TOKEN', '...'); -- scope Desk.tickets.ALL,Desk.basic.READ
//   select vault.create_secret('<org id>', 'ZOHO_ORG_ID', '...');
//   select vault.create_secret('<dept id>', 'ZOHO_DEPARTMENT_ID', '...'); -- required by Zoho Desk to create a ticket;
//     find valid ids via GET https://desk.zoho.<dc>/api/v1/departments

import { createClient } from "jsr:@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const j = (o: unknown, status = 200) =>
  new Response(JSON.stringify(o), { status, headers: { "Content-Type": "application/json", ...CORS } });

// Zoho's own labels vary by org configuration - map generously, default to in_progress for anything
// unrecognised rather than silently mis-marking an active ticket as closed.
function normaliseStatus(zohoStatus: string): string {
  const s = (zohoStatus || "").toLowerCase();
  if (s.includes("closed") || s.includes("resolved")) return "closed";
  if (s.includes("hold")) return "on_hold";
  if (s === "open" || s.includes("new")) return "open";
  return "in_progress";
}

// Zoho's top-level `message` is often a generic "data is invalid" - the actionable detail lives in
// `errors[].fieldName`/`errorMessage`, so surface that too rather than just the generic wrapper.
function zohoErrorText(out: any, fallback: string | number): string {
  const detail = Array.isArray(out?.errors)
    ? out.errors.map((e: any) => `${e.fieldName || "field"}: ${e.errorMessage || e.errorType || "invalid"}`).join("; ")
    : "";
  return [out?.message || fallback, detail].filter(Boolean).join(" - ");
}

async function zohoAccessToken(dc: string, clientId: string, clientSecret: string, refreshToken: string) {
  const res = await fetch(`https://accounts.zoho.${dc}/oauth/v2/token?refresh_token=${encodeURIComponent(refreshToken)}&client_id=${encodeURIComponent(clientId)}&client_secret=${encodeURIComponent(clientSecret)}&grant_type=refresh_token`, { method: "POST" });
  const out = await res.json().catch(() => ({}));
  if (!res.ok || !out.access_token) throw new Error("Zoho OAuth failed: " + (out.error || res.status));
  return out.access_token as string;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return j({ error: "method not allowed" }, 405);

  const SB = Deno.env.get("SUPABASE_URL")!;
  const SRV = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const ANON = Deno.env.get("SUPABASE_ANON_KEY") || SRV;

  const db = createClient(SB, SRV);
  const { data: zohoSecrets, error: secretsErr } = await db.schema("app").rpc("get_zoho_secrets");
  if (secretsErr) return j({ error: "Could not read Zoho credentials from Vault: " + secretsErr.message }, 500);
  const ZOHO_DC = zohoSecrets?.ZOHO_DC || "com";
  const ZOHO_CLIENT_ID = zohoSecrets?.ZOHO_CLIENT_ID;
  const ZOHO_CLIENT_SECRET = zohoSecrets?.ZOHO_CLIENT_SECRET;
  const ZOHO_REFRESH_TOKEN = zohoSecrets?.ZOHO_REFRESH_TOKEN;
  const ZOHO_ORG_ID = zohoSecrets?.ZOHO_ORG_ID;
  const ZOHO_DEPARTMENT_ID = zohoSecrets?.ZOHO_DEPARTMENT_ID;

  if (!ZOHO_CLIENT_ID || !ZOHO_CLIENT_SECRET || !ZOHO_REFRESH_TOKEN || !ZOHO_ORG_ID) {
    return j({ error: "Zoho Desk is not configured yet - store ZOHO_CLIENT_ID/ZOHO_CLIENT_SECRET/ZOHO_REFRESH_TOKEN/ZOHO_ORG_ID in Vault (see the comment at the top of this file)" }, 500);
  }

  const bearer = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (!bearer) return j({ error: "unauthorized" }, 401);
  const asUser = createClient(SB, ANON, { global: { headers: { Authorization: "Bearer " + bearer } } });
  const { data: userData, error: userErr } = await asUser.auth.getUser();
  if (userErr || !userData?.user) return j({ error: "unauthorized" }, 401);

  let body: any = {};
  try { body = await req.json(); } catch { /* empty body */ }
  const action = String(body.action || "");
  const ticketId = Number(body.ticketId);
  if (!ticketId) return j({ error: "ticketId is required" }, 400);

  // RLS on cust.support_tickets decides whether this caller may see this ticket at all (their own
  // unit, or staff) - if this comes back empty, they aren't authorised, full stop.
  const { data: ticket, error: ticketErr } = await asUser.schema("cust").from("support_tickets")
    .select("id,unit_id,subject,description,zoho_ticket_id").eq("id", ticketId).is("deleted_at", null).maybeSingle();
  if (ticketErr) return j({ error: ticketErr.message }, 500);
  if (!ticket) return j({ error: "Ticket not found or not accessible" }, 404);

  try {
    const accessToken = await zohoAccessToken(ZOHO_DC, ZOHO_CLIENT_ID, ZOHO_CLIENT_SECRET, ZOHO_REFRESH_TOKEN);
    const zohoHeaders = { Authorization: "Zoho-oauthtoken " + accessToken, orgId: ZOHO_ORG_ID, "Content-Type": "application/json" };

    if (action === "create") {
      if (ticket.zoho_ticket_id) return j({ error: "This ticket was already created in Zoho Desk" }, 400);

      const { data: unit } = await db.schema("cust").from("units").select("customer_id").eq("id", ticket.unit_id).maybeSingle();
      const { data: customer } = unit?.customer_id
        ? await db.schema("cust").from("customers").select("full_name,email,phone").eq("id", unit.customer_id).maybeSingle()
        : { data: null };

      const payload: any = {
        subject: ticket.subject,
        description: ticket.description || "",
        channel: "Web",
        contact: { email: customer?.email, lastName: customer?.full_name || "Customer", phone: customer?.phone || undefined },
      };
      if (ZOHO_DEPARTMENT_ID) payload.departmentId = ZOHO_DEPARTMENT_ID;

      const res = await fetch(`https://desk.zoho.${ZOHO_DC}/api/v1/tickets`, { method: "POST", headers: zohoHeaders, body: JSON.stringify(payload) });
      const out = await res.json().catch(() => ({}));
      if (!res.ok) return j({ error: "Zoho Desk create failed: " + zohoErrorText(out, res.status) }, 500);

      const zohoStatus = out.status || "Open";
      const { error: updErr } = await db.schema("cust").from("support_tickets").update({
        zoho_ticket_id: out.id, zoho_ticket_number: out.ticketNumber, zoho_status: zohoStatus,
        status: normaliseStatus(zohoStatus), last_synced_at: new Date().toISOString(),
      }).eq("id", ticketId);
      if (updErr) return j({ error: updErr.message }, 500);
      return j({ ok: true, zoho_ticket_number: out.ticketNumber, status: normaliseStatus(zohoStatus) });
    }

    if (action === "sync") {
      if (!ticket.zoho_ticket_id) return j({ error: "This ticket hasn't been created in Zoho Desk yet" }, 400);
      const res = await fetch(`https://desk.zoho.${ZOHO_DC}/api/v1/tickets/${ticket.zoho_ticket_id}`, { headers: zohoHeaders });
      const out = await res.json().catch(() => ({}));
      if (!res.ok) return j({ error: "Zoho Desk fetch failed: " + zohoErrorText(out, res.status) }, 500);

      const zohoStatus = out.status || "Open";
      const { error: updErr } = await db.schema("cust").from("support_tickets").update({
        zoho_status: zohoStatus, status: normaliseStatus(zohoStatus), last_synced_at: new Date().toISOString(),
      }).eq("id", ticketId);
      if (updErr) return j({ error: updErr.message }, 500);
      return j({ ok: true, status: normaliseStatus(zohoStatus), zoho_status: zohoStatus });
    }

    return j({ error: "Unknown action - expected 'create' or 'sync'" }, 400);
  } catch (e) {
    return j({ error: String((e as Error).message || e) }, 500);
  }
});
