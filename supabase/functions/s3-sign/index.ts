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

    const { action, key, keys } = await req.json();
    const bucket = Deno.env.get("S3_BUCKET");
    const region = Deno.env.get("S3_REGION");
    const ak = Deno.env.get("AWS_ACCESS_KEY_ID");
    const sk = Deno.env.get("AWS_SECRET_ACCESS_KEY");
    if (!bucket || !region || !ak || !sk) return j({ error: "S3 secrets not configured" }, 500);

    // MANY KEYS, ONE CALL (26 Oct 2026) - view links only. A grid of ad pictures used to make one
    // call per tile; now it sends the page's keys together and gets back {urls: {key: url}}. The
    // access rule is the same as below, asked once for the whole list (app.s3_keys_allowed). A key
    // the caller may not read is simply left out of the answer.
    if (Array.isArray(keys)) {
      const asked = keys.slice(0, 200).map((k: unknown) => String(k || "").replace(/^\/+/, ""));
      const full = asked.map((k) => OWN_ROOT_PREFIXES.some((p) => k.startsWith(p)) ? k : "portal/" + k);
      const chk = await fetch(`${sbUrl}/rest/v1/rpc/s3_keys_allowed`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`, apikey: anon,
          "Content-Type": "application/json", "Content-Profile": "app", "Accept-Profile": "app",
        },
        body: JSON.stringify({ p_action: "get", p_keys: full }),
      });
      const ok: string[] = chk.ok ? await chk.json().catch(() => []) : [];
      const allowed = new Set(Array.isArray(ok) ? ok : []);
      const aws = new AwsClient({ accessKeyId: ak, secretAccessKey: sk, region, service: "s3" });
      const urls: Record<string, string> = {};
      await Promise.all(asked.map(async (k, i) => {
        if (!allowed.has(full[i])) return;
        const u = new URL(`https://${bucket}.s3.${region}.amazonaws.com/${full[i].split("/").map(encodeURIComponent).join("/")}`);
        u.searchParams.set("X-Amz-Expires", "900");
        urls[k] = (await aws.sign(u.toString(), { method: "GET", aws: { signQuery: true } })).url;
      }));
      return j({ urls });
    }

    let safeKey = String(key || "").replace(/^\/+/, "");
    if (!OWN_ROOT_PREFIXES.some(p => safeKey.startsWith(p))) safeKey = "portal/" + safeKey;
    const act = action === "put" ? "put" : action === "delete" ? "delete" : "get";

    // May THIS caller do THIS to THIS key? Asked as the caller, so RLS applies. Fails closed: any
    // error, or anything but a literal true, is a refusal.
    /* A refusal and a failed check are not the same thing. Anything but a literal true is still
       "no" - it fails closed - but only an ANSWER of false is told to the person as "you do not
       have access". When the database could not answer (a timeout, a busy moment, an error), the
       check is tried again, and if it still cannot be answered they are told to try again, not that
       they are blocked: a staff member whose upload failed in a busy moment was shown "You do not
       have access to this file" and had no way to know it was not about them. */
    let allowed: unknown = undefined;
    let why = "";
    for (let attempt = 0; attempt < 3 && allowed === undefined; attempt++) {
      if (attempt) await new Promise((r) => setTimeout(r, 400 * attempt));
      try {
        const chk = await fetch(`${sbUrl}/rest/v1/rpc/s3_key_allowed`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`, apikey: anon,
            "Content-Type": "application/json", "Content-Profile": "app", "Accept-Profile": "app",
          },
          body: JSON.stringify({ p_action: act, p_key: safeKey }),
        });
        if (chk.ok) {
          const v = await chk.json().catch(() => undefined);
          if (typeof v === "boolean") allowed = v; else why = "unreadable answer";
        } else {
          why = `HTTP ${chk.status} ${(await chk.text().catch(() => "")).slice(0, 200)}`;
          // a 4xx the database answered with (not a timeout or a throttle) is a real refusal
          if (chk.status >= 400 && chk.status < 500 && chk.status !== 408 && chk.status !== 429) {
            console.error(`s3_key_allowed refused ${act} ${safeKey}: ${why}`);
            allowed = false;
          }
        }
      } catch (e) {
        why = String(e);
      }
    }
    if (allowed === undefined) {
      console.error(`s3_key_allowed could not be answered for ${act} ${safeKey}: ${why}`);
      return j({ error: "Could not check your access to this file just now - please try again in a moment." }, 503);
    }
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
