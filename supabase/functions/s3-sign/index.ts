// Presigned S3 links (view / upload / delete) for the portal.
//
// Until 5 Oct 2026 this only checked that the caller was signed in, then signed ANY key - so any
// signed-in account (a customer, or anyone who used the open staff sign-up) could fetch, overwrite or
// delete any file in the bucket given its key. It now asks the database first:
// app.s3_key_allowed(action, key), run AS THE CALLER (their own token, so the customer RLS on each
// table decides what is theirs). Staff are unchanged; everyone else may view only files whose row
// they can read, upload only into their own flat's / ticket's folders, and never delete.
// See supabase/migrations/20261005100000_s3_sign_access_check.sql.
//
// Deployed WITH JWT verification (the default) - no --no-verify-jwt.

import { AwsClient } from "https://esm.sh/aws4fetch@1.0.20";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const j = (o: unknown, status = 200) =>
  new Response(JSON.stringify(o), { status, headers: { ...cors, "Content-Type": "application/json" } });

// Top-level roots that manage their own key prefix and should NOT be
// auto-nested under portal/. Everything else defaults to portal/.
const OWN_ROOT_PREFIXES = ["portal/", "legal/"];

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return j({ error: "method not allowed" }, 405);
  try {
    const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    if (!token) return j({ error: "missing token" }, 401);
    const sbUrl = Deno.env.get("SUPABASE_URL")!;
    const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
    const who = await fetch(`${sbUrl}/auth/v1/user`, {
      headers: { Authorization: `Bearer ${token}`, apikey: anon },
    });
    if (!who.ok) return j({ error: "unauthorized" }, 401);

    const { action, key } = await req.json();
    const bucket = Deno.env.get("S3_BUCKET");
    const region = Deno.env.get("S3_REGION");
    const ak = Deno.env.get("AWS_ACCESS_KEY_ID");
    const sk = Deno.env.get("AWS_SECRET_ACCESS_KEY");
    if (!bucket || !region || !ak || !sk) return j({ error: "S3 secrets not configured" }, 500);

    let safeKey = String(key || "").replace(/^\/+/, "");
    if (!OWN_ROOT_PREFIXES.some(p => safeKey.startsWith(p))) safeKey = "portal/" + safeKey;
    const act = action === "put" ? "put" : action === "delete" ? "delete" : "get";

    // May THIS caller do THIS to THIS key? Asked as the caller, so RLS applies. Fails closed: any
    // error, or anything but a literal true, is a refusal.
    const chk = await fetch(`${sbUrl}/rest/v1/rpc/s3_key_allowed`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`, apikey: anon,
        "Content-Type": "application/json", "Content-Profile": "app", "Accept-Profile": "app",
      },
      body: JSON.stringify({ p_action: act, p_key: safeKey }),
    });
    const allowed = chk.ok ? await chk.json().catch(() => false) : false;
    if (allowed !== true) return j({ error: "You do not have access to this file." }, 403);

    const aws = new AwsClient({ accessKeyId: ak, secretAccessKey: sk, region, service: "s3" });
    const encKey = safeKey.split("/").map(encodeURIComponent).join("/");
    const u = new URL(`https://${bucket}.s3.${region}.amazonaws.com/${encKey}`);
    u.searchParams.set("X-Amz-Expires", "300");

    const method = act === "put" ? "PUT" : act === "delete" ? "DELETE" : "GET";
    const signed = await aws.sign(u.toString(), { method, aws: { signQuery: true } });
    return j({ url: signed.url, key: safeKey, method });
  } catch (e) {
    return j({ error: String(e) }, 500);
  }
});
