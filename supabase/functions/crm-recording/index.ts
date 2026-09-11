/* Hands ONE call recording's bytes to a logged-in user, as a file.

   WHY A PROXY AT ALL, WHEN THE RECORDING URL IS ALREADY A LINK THE BROWSER CAN FOLLOW.
   Following it does not reliably produce a download, and cannot be made to:

     1. download="call-recording-123.mp3" is honoured SAME-ORIGIN ONLY. Cross-origin, the browser
        ignores the name we ask for and falls back to the one in the final URL's path - so the file
        lands in the reader's downloads folder as 0a9fbfcb-115b-4565-a342-34ff4fbe2c42_0_r.mp3,
        which is not findable by any lead, caller or date.
     2. The chain ends on PLAIN HTTP. sr.knowlarity.com 302s to kservices.knowlarity.com, which 302s
        to a presigned http://kstoragerecording.s3.amazonaws.com/... URL. Chrome BLOCKS an insecure
        download started from an https:// page ("Insecure download blocked"), so on the live domain
        the click can end in nothing happening at all - which is exactly the complaint this answers.
     3. Fetching it in the page instead is not an option either: no hop in that chain sends
        Access-Control-Allow-Origin, so a browser fetch() is refused before it starts.

   Read here, with the app's own credentials, all three problems go away at once: this response is
   same-origin as far as CORS is concerned, it is https, and it carries an explicit
   Content-Disposition naming the file after the lead and the call.

   WHAT IT WILL NOT DO. This is not an open proxy. A URL is fetched only if it is BOTH on a
   Knowlarity host AND already stored against a follow-up or a transcription in our own database, so
   it can only ever return a recording the caller could already reach from the page they asked from.
   Everything else is refused without being fetched.

   AUDIO IS NEVER STORED. It is held in memory for exactly one response, the same rule
   transcription-sync follows. */

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  // Without this the page can read the body but not the filename we picked for it.
  "Access-Control-Expose-Headers": "content-disposition, content-length, content-type",
};
const j = (o: unknown, s = 200) =>
  new Response(JSON.stringify(o), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

/* The only hosts a recording URL is ever on. sr.* is what we store and what the app links to;
   kservices.* is the hop it redirects through, allowed so a URL captured mid-chain still works. */
const ALLOWED_HOSTS = new Set(["sr.knowlarity.com", "kservices.knowlarity.com"]);
/* A 10-minute pre-sales call at Knowlarity's 16 kbps is about 1.2 MB. 40 MB is a ceiling for the
   pathological case, not a target. */
const MAX_BYTES = 40 * 1024 * 1024;

/* Only [A-Za-z0-9._-] survives, so the name cannot carry a quote, a semicolon or a path separator
   into the Content-Disposition header or out onto the reader's filesystem. */
function safeName(s: string): string {
  const cleaned = String(s || "").replace(/[^A-Za-z0-9._-]/g, "");
  return cleaned || "call-recording.mp3";
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return j({ error: "method not allowed" }, 405);

  const sbUrl = Deno.env.get("SUPABASE_URL")!;
  const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  // Who is asking. verify_jwt is on, but this is what makes an expired or forged token a 401 with
  // a reason rather than a confusing 500 further down.
  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (!token) return j({ error: "missing token" }, 401);
  const who = await fetch(`${sbUrl}/auth/v1/user`, { headers: { Authorization: `Bearer ${token}`, apikey: anon } });
  if (!who.ok) return j({ error: "unauthorized" }, 401);

  let body: any = {};
  try { body = await req.json(); } catch (_) { /* caught by the checks below */ }

  const url = String(body?.url || "").trim();
  if (!url) return j({ error: "url is required" }, 400);

  let parsed: URL;
  try { parsed = new URL(url); } catch (_) { return j({ error: "not a url" }, 400); }
  if (parsed.protocol !== "https:") return j({ error: "only https recording urls are fetched" }, 400);
  if (!ALLOWED_HOSTS.has(parsed.hostname)) {
    return j({ error: `${parsed.hostname} is not a recording host` }, 403);
  }

  /* The second gate, and the one that matters: this exact URL has to be one we already stored.
     Service role deliberately - the point is to confirm the recording EXISTS, not to re-decide who
     may see it (RLS already settled that on the page the click came from, and every signed-in
     non-customer user can read these tables). */
  const enc = encodeURIComponent(url);
  const known = await Promise.all([
    fetch(`${sbUrl}/rest/v1/crm_followups?select=follow_up_id,lead_id&recording_url=eq.${enc}&limit=1`,
      { headers: { apikey: service, Authorization: `Bearer ${service}`, "Accept-Profile": "acc" } }),
    fetch(`${sbUrl}/rest/v1/transcriptions?select=id,lead_id&recording_url=eq.${enc}&limit=1`,
      { headers: { apikey: service, Authorization: `Bearer ${service}`, "Accept-Profile": "acc" } }),
  ]);
  let match: any = null;
  for (const res of known) {
    if (!res.ok) continue;
    const rows = await res.json().catch(() => []);
    if (Array.isArray(rows) && rows.length) { match = rows[0]; break; }
  }
  if (!match) return j({ error: "that recording is not on file" }, 404);

  /* The name the reader gets. Whatever the page asked for, as long as it is safe; otherwise built
     from the ids we just looked up, so the file is still traceable to a lead and a call. */
  const fallback = "call-recording"
    + (match.lead_id ? `-lead${match.lead_id}` : "")
    + (match.follow_up_id ? `-${match.follow_up_id}` : (match.id ? `-${match.id}` : ""))
    + ".mp3";
  const filename = safeName(body?.filename || fallback);

  let upstream: Response;
  try {
    // Follows the 302 chain, including the last plain-http hop - which is fine from here and is the
    // hop the browser refuses to make.
    upstream = await fetch(url, { redirect: "follow" });
  } catch (e) {
    return j({ error: "could not reach the recording host", detail: String((e as any)?.message || e) }, 502);
  }
  if (!upstream.ok) return j({ error: `the recording host returned ${upstream.status}` }, 502);

  const declared = Number(upstream.headers.get("content-length") || "0");
  if (declared > MAX_BYTES) return j({ error: `recording is too large (${declared} bytes)` }, 413);

  const buf = await upstream.arrayBuffer();
  if (buf.byteLength > MAX_BYTES) return j({ error: "recording is too large" }, 413);
  if (buf.byteLength < 1024) return j({ error: `the recording host sent an empty file (${buf.byteLength} bytes)` }, 502);

  /* Knowlarity serves these as "binary/octet-stream", which is not a media type any player will
     take - so it is REPLACED, not passed through. Same rule as transcription-sync.  */
  const served = (upstream.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
  const type = /^(audio|video)\/[a-z0-9.+-]+$/.test(served) ? served : "audio/mpeg";

  return new Response(buf, {
    status: 200,
    headers: {
      ...cors,
      "Content-Type": type,
      "Content-Length": String(buf.byteLength),
      "Content-Disposition": `attachment; filename="${filename}"`,
      // A presigned upstream URL dies in ~10 minutes; the audio behind it never changes. Private
      // and short is the honest pair - long enough for a double-click, not long enough to matter.
      "Cache-Control": "private, max-age=60",
    },
  });
});
