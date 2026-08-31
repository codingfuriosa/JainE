// Customer Portal: create a customer's portal login, or reset one, with a password STAFF set.
//
// There is no customer self-signup and no emailed reset link — staff pick (or generate) a password
// in Customer Portal Admin > Customers > "Create login" / "Reset password" and hand it to the
// customer directly (phone, WhatsApp, in person). This function is what actually sets it: it either
// creates the auth.users row for a customer with no login yet, or overwrites the password on an
// existing one, then links cust.customers.auth_user_id if that hadn't happened already.
//
// This needs the SERVICE ROLE key (auth.admin.createUser / updateUserById are admin-only
// operations), so it cannot live client-side the way the rest of the customer-portal admin screens
// do — same reason `s3-sign` exists as an edge function rather than a client-side S3 secret. The
// caller's own bearer token is re-validated server-side against app.is_custportal_staff() before
// anything runs; the client-side gate on the button is not trusted on its own.

import { createClient } from "jsr:@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const j = (o: unknown, status = 200) =>
  new Response(JSON.stringify(o), { status, headers: { "Content-Type": "application/json", ...CORS } });

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return j({ error: "method not allowed" }, 405);

  const SB = Deno.env.get("SUPABASE_URL")!;
  const SRV = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const ANON = Deno.env.get("SUPABASE_ANON_KEY") || SRV;

  const bearer = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (!bearer) return j({ error: "unauthorized" }, 401);

  // Runs AS the caller (their JWT, not the service role) so app.current_user_email()/auth.uid()
  // inside app.is_custportal_staff() resolve to whoever actually called this, not the service role.
  const asUser = createClient(SB, ANON, { global: { headers: { Authorization: "Bearer " + bearer } } });
  const { data: userData, error: userErr } = await asUser.auth.getUser();
  if (userErr || !userData?.user) return j({ error: "unauthorized" }, 401);

  let isStaff = false;
  try {
    const { data } = await asUser.schema("app").rpc("is_custportal_staff");
    isStaff = !!data;
  } catch { /* leaves isStaff false */ }
  if (!isStaff) return j({ error: "Not authorised to manage customer logins" }, 403);

  let body: any = {};
  try { body = await req.json(); } catch { /* empty body */ }
  const customerId = Number(body.customerId);
  const password = String(body.password || "");
  if (!customerId) return j({ error: "customerId is required" }, 400);
  if (password.length < 6) return j({ error: "Password must be at least 6 characters" }, 400);

  const db = createClient(SB, SRV);
  const { data: cust, error: custErr } = await db.schema("cust").from("customers")
    .select("id,email,full_name,auth_user_id").eq("id", customerId).is("deleted_at", null).maybeSingle();
  if (custErr) return j({ error: custErr.message }, 500);
  if (!cust) return j({ error: "Customer not found" }, 404);

  try {
    let authUserId = cust.auth_user_id as string | null;

    if (!authUserId) {
      // Brand new login, created with the password staff just chose — no email step at all.
      const created = await db.auth.admin.createUser({ email: cust.email, password, email_confirm: true });
      if (created.error) {
        // Duplicate email (e.g. an earlier attempt created the auth user but failed before linking
        // it back to cust.customers) — find that account and set ITS password instead of erroring.
        if (!/already.*registered|already.*exists/i.test(created.error.message || "")) {
          return j({ error: created.error.message }, 500);
        }
        const { data: list, error: listErr } = await db.auth.admin.listUsers();
        if (listErr) return j({ error: listErr.message }, 500);
        const existing = list.users.find(u => (u.email || "").toLowerCase() === cust.email.toLowerCase());
        if (!existing) return j({ error: "Could not find or create an account for this email" }, 500);
        const upd = await db.auth.admin.updateUserById(existing.id, { password });
        if (upd.error) return j({ error: upd.error.message }, 500);
        authUserId = existing.id;
      } else {
        authUserId = created.data.user!.id;
      }
      const { error: linkErr } = await db.schema("cust").from("customers")
        .update({ auth_user_id: authUserId }).eq("id", customerId);
      if (linkErr) return j({ error: linkErr.message }, 500);
    } else {
      // Existing login — this is an admin-initiated password reset.
      const upd = await db.auth.admin.updateUserById(authUserId, { password });
      if (upd.error) return j({ error: upd.error.message }, 500);
    }

    return j({ ok: true, email: cust.email });
  } catch (e) {
    return j({ error: String((e as Error).message || e) }, 500);
  }
});
