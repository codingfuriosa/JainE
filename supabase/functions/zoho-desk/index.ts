// Customer Portal: raise a support ticket in Zoho Desk, and pull its current status back.
//
// cust.support_tickets is a local MIRROR, not the system of record - Zoho Desk is. The flow is:
//   1. Customer raises a ticket normally (client-side insert into cust.support_tickets, allowed by
//      its own RLS insert policy) - this happens BEFORE this function is ever called.
//   2. Client calls this function with {action:'create', ticketId} - it creates the matching ticket
//      in Zoho Desk and writes zoho_ticket_id/zoho_ticket_number/zoho_status/status back onto that
//      same local row.
//   3. Later, {action:'sync', ticketId} re-fetches that ticket's current status (its literal Zoho
//      label, kept verbatim in zoho_status precisely because orgs add their own custom statuses a
//      fixed enum can't predict), pulls down the conversation (see 5 below), and re-attempts any
//      attachment that's still unsynced - a ticket with a zoho_ticket_id only ever shows a "Refresh"
//      button, so that one button covers all three.
//   4. Any rows the client already inserted into cust.support_ticket_attachments for this ticket
//      (uploaded to S3, then a metadata row - same pattern as every other upload in this app) get
//      pushed to the matching Zoho Desk ticket as real attachments at the end of step 2, one file at
//      a time via Zoho's own attachments endpoint - best-effort, so one bad file doesn't fail the
//      whole create.
//   5. {action:'reply', ticketId, message} lets the customer add to the conversation from the portal.
//      Zoho's public API has no way to post an inbound thread attributed to the contact (confirmed
//      against the live API - POST .../threads is flat-out rejected), so this posts a public comment
//      instead, with the customer's name spelled out in the text since Zoho's own commenter metadata
//      will show whichever agent identity this integration is connected as, not the customer.
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

// Zoho's contact record has separate firstName/lastName fields - handing the whole name to lastName
// alone (the old behaviour here) left the contact showing as just one blob with no first name, which
// is why "show the customer's name properly" was asked for. Split on the last space so a full name
// still reads naturally either way Zoho displays it (and a single-word name just becomes lastName).
function splitName(fullName: string): { firstName?: string; lastName: string } {
  const parts = (fullName || "Customer").trim().split(/\s+/);
  if (parts.length < 2) return { lastName: parts[0] || "Customer" };
  return { firstName: parts.slice(0, -1).join(" "), lastName: parts[parts.length - 1] };
}

// Fetches a file via a presigned GET from the s3-sign function (same one the client uses, called
// here with the same caller bearer token) and re-posts it to Zoho Desk as a ticket attachment.
async function pushAttachmentToZoho(
  sb: string, anonKey: string, bearer: string, dc: string, accessToken: string,
  zohoTicketId: string, storagePath: string, fileName: string,
): Promise<{ ok: true; zohoAttachmentId: string } | { ok: false; error: string }> {
  const key = storagePath.replace(/^s3:/, "");
  const signRes = await fetch(`${sb}/functions/v1/s3-sign`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + bearer, apikey: anonKey },
    body: JSON.stringify({ action: "get", key }),
  });
  const signOut = await signRes.json().catch(() => ({}));
  if (!signRes.ok || !signOut?.url) return { ok: false, error: "Could not sign download URL: " + (signOut?.error || signRes.status) };

  const fileRes = await fetch(signOut.url);
  if (!fileRes.ok) return { ok: false, error: "Could not fetch the uploaded file (" + fileRes.status + ")" };
  const blob = await fileRes.blob();

  const form = new FormData();
  form.append("file", blob, fileName || "attachment");
  const upRes = await fetch(`https://desk.zoho.${dc}/api/v1/tickets/${zohoTicketId}/attachments`, {
    method: "POST",
    headers: { Authorization: "Zoho-oauthtoken " + accessToken },
    body: form,
  });
  const upOut = await upRes.json().catch(() => ({}));
  if (!upRes.ok) return { ok: false, error: zohoErrorText(upOut, upRes.status) };
  return { ok: true, zohoAttachmentId: upOut.id };
}

// Zoho's thread/comment content is HTML - strip it down to plain text for the portal's chat-style
// display rather than rendering raw HTML from an external system inside our own page.
function htmlToText(html: string): string {
  return (html || "")
    .replace(/<br\s*\/?>/gi, "\n").replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, "\n\n").trim();
}

// Pulls both Zoho conversation surfaces down into their mirror tables. Threads are immutable once
// sent, so a plain best-effort insert-if-missing is enough; comments are NOT re-inserted wholesale
// because a portal-posted comment already has posted_by_customer=true set locally the moment it was
// created, and a blind upsert would need to know not to clobber that back to false.
async function syncConversation(db: any, dc: string, accessToken: string, zohoTicketId: string, ticketId: number) {
  const zohoHeaders = { Authorization: "Zoho-oauthtoken " + accessToken };

  const threadsRes = await fetch(`https://desk.zoho.${dc}/api/v1/tickets/${zohoTicketId}/threads`, { headers: zohoHeaders });
  const threadsOut = await threadsRes.json().catch(() => ({}));
  const threads = (threadsOut?.data || []).filter((t: any) => t.visibility === "public");
  for (const t of threads) {
    await db.schema("cust").from("support_ticket_threads").upsert({
      ticket_id: ticketId, zoho_thread_id: t.id, direction: t.direction,
      author_name: (t.author && t.author.name) || null, author_type: (t.author && t.author.type) || null,
      content: htmlToText(t.content || t.summary || ""), zoho_created_time: t.createdTime || null,
    }, { onConflict: "ticket_id,zoho_thread_id", ignoreDuplicates: true });
  }

  const commentsRes = await fetch(`https://desk.zoho.${dc}/api/v1/tickets/${zohoTicketId}/comments`, { headers: zohoHeaders });
  const commentsOut = await commentsRes.json().catch(() => ({}));
  const comments = (commentsOut?.data || []).filter((c: any) => c.isPublic);
  if (comments.length) {
    const { data: existing } = await db.schema("cust").from("support_ticket_comments").select("zoho_comment_id").eq("ticket_id", ticketId);
    const known = new Set((existing || []).map((r: any) => r.zoho_comment_id));
    const toInsert = comments.filter((c: any) => !known.has(c.id)).map((c: any) => ({
      ticket_id: ticketId, zoho_comment_id: c.id, commenter_name: (c.commenter && c.commenter.name) || null,
      content: htmlToText(c.content || ""), posted_by_customer: false, zoho_commented_time: c.commentedTime || null,
    }));
    if (toInsert.length) await db.schema("cust").from("support_ticket_comments").insert(toInsert);
  }
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

      const { firstName, lastName } = splitName(customer?.full_name || "Customer");
      const payload: any = {
        subject: ticket.subject,
        description: ticket.description || "",
        channel: "Web",
        contact: { email: customer?.email, firstName, lastName, phone: customer?.phone || undefined },
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

      // Push any attachments the customer added when raising the ticket (client inserts these rows
      // right after the ticket row, before ever calling this function) - best-effort per file, since
      // one bad file shouldn't block the ticket itself from having been created successfully.
      const { data: attachments } = await db.schema("cust").from("support_ticket_attachments")
        .select("id,storage_path,file_name").eq("ticket_id", ticketId).is("zoho_attachment_id", null).is("deleted_at", null);
      let attachmentsSynced = 0;
      const attachmentErrors: string[] = [];
      for (const a of attachments || []) {
        const pushed = await pushAttachmentToZoho(SB, ANON, bearer, ZOHO_DC, accessToken, out.id, a.storage_path, a.file_name || "attachment");
        if (pushed.ok) {
          await db.schema("cust").from("support_ticket_attachments")
            .update({ zoho_attachment_id: pushed.zohoAttachmentId, zoho_synced_at: new Date().toISOString() }).eq("id", a.id);
          attachmentsSynced++;
        } else {
          attachmentErrors.push((a.file_name || "attachment") + ": " + pushed.error);
        }
      }

      return j({ ok: true, zoho_ticket_number: out.ticketNumber, status: normaliseStatus(zohoStatus), attachmentsSynced, attachmentErrors });
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

      // The ticket itself only ever gets created once, but an attachment can fail independently of
      // that (a flaky upload, a Zoho-side hiccup) - "Refresh" is the only button a ticket with a
      // zoho_ticket_id still shows, so it doubles as the retry path for any attachment left pending.
      const { data: attachments } = await db.schema("cust").from("support_ticket_attachments")
        .select("id,storage_path,file_name").eq("ticket_id", ticketId).is("zoho_attachment_id", null).is("deleted_at", null);
      let attachmentsSynced = 0;
      const attachmentErrors: string[] = [];
      for (const a of attachments || []) {
        const pushed = await pushAttachmentToZoho(SB, ANON, bearer, ZOHO_DC, accessToken, ticket.zoho_ticket_id, a.storage_path, a.file_name || "attachment");
        if (pushed.ok) {
          await db.schema("cust").from("support_ticket_attachments")
            .update({ zoho_attachment_id: pushed.zohoAttachmentId, zoho_synced_at: new Date().toISOString() }).eq("id", a.id);
          attachmentsSynced++;
        } else {
          attachmentErrors.push((a.file_name || "attachment") + ": " + pushed.error);
        }
      }

      await syncConversation(db, ZOHO_DC, accessToken, ticket.zoho_ticket_id, ticketId);

      return j({ ok: true, status: normaliseStatus(zohoStatus), zoho_status: zohoStatus, attachmentsSynced, attachmentErrors });
    }

    if (action === "reply") {
      if (!ticket.zoho_ticket_id) return j({ error: "This ticket hasn't been created in Zoho Desk yet" }, 400);
      const message = String(body.message || "").trim();
      if (!message) return j({ error: "message is required" }, 400);

      const { data: unit } = await db.schema("cust").from("units").select("customer_id").eq("id", ticket.unit_id).maybeSingle();
      const { data: customer } = unit?.customer_id
        ? await db.schema("cust").from("customers").select("full_name").eq("id", unit.customer_id).maybeSingle()
        : { data: null };
      const customerName = customer?.full_name || "Customer";

      // See the note at the top of this file: Zoho's API has no way to post this as the contact, so
      // it goes in as a public comment (visible in the ticket's Comments panel) with the customer's
      // name spelled out in the text itself, and the local mirror row is what actually carries "this
      // was the customer" for our own UI - Zoho's own commenter metadata will show our connected agent.
      const escaped = message.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\n/g, "<br>");
      const res = await fetch(`https://desk.zoho.${ZOHO_DC}/api/v1/tickets/${ticket.zoho_ticket_id}/comments`, {
        method: "POST", headers: zohoHeaders,
        body: JSON.stringify({ content: `Customer reply (${customerName}): ${escaped}`, isPublic: true }),
      });
      const out = await res.json().catch(() => ({}));
      if (!res.ok) return j({ error: "Could not send reply to Zoho Desk: " + zohoErrorText(out, res.status) }, 500);

      const { error: insErr } = await db.schema("cust").from("support_ticket_comments").insert({
        ticket_id: ticketId, zoho_comment_id: out.id, commenter_name: customerName,
        content: message, posted_by_customer: true, zoho_commented_time: out.commentedTime || new Date().toISOString(),
      });
      if (insErr) return j({ error: insErr.message }, 500);

      return j({ ok: true });
    }

    return j({ error: "Unknown action - expected 'create', 'sync' or 'reply'" }, 400);
  } catch (e) {
    return j({ error: String((e as Error).message || e) }, 500);
  }
});
