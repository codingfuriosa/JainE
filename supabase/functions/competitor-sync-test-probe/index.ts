// Proxy sign-in + fetch for Competitor Ads. Slug is historical: the project is at its
// edge-function limit, so a spent one-shot probe's slot was reused with consent.
// Sign-in happened once on a laptop because Proxy refuses non-allow-listed redirects; refreshing
// carries no redirect, so this renews unattended for ever.
//
// THIS IS THE ONE ROUTE INTO THE COMPETITOR ADS TABLES. The nightly cron
// (competitor-ads-proxy-daily) and the Fetch from Meta button on the screen both call it, so the
// screen and the nightly job always pull the same way. competitor-ads-sync, the self-hosted
// Playwright scraper the button used to call, is no longer reached from the page.

import { AwsClient } from "https://esm.sh/aws4fetch@1.0.20";

const ISSUER = "https://mcp.useproxy.dev";
const SB = Deno.env.get("SUPABASE_URL")!;
const SRV = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const H = { apikey: SRV, Authorization: "Bearer " + SRV, "Content-Type": "application/json",
  "Accept-Profile": "camp", "Content-Profile": "camp" };

/* THE BROWSER ASKS FIRST. Until the Fetch from Meta button moved here this function was only ever
   called server-to-server by the cron, so it never answered the browser's CORS preflight - the
   OPTIONS came back 405, the browser refused to send the POST, and the button said "Fetch failed"
   without the function ever running. The caller is still checked: verify_jwt stays on. */
const CORS = { "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info" };
const json = (o: unknown, s = 200) => new Response(JSON.stringify(o, null, 2),
  { status: s, headers: { ...CORS, "Content-Type": "application/json" } });

async function row() {
  const r = await fetch(SB + "/rest/v1/proxy_oauth?id=eq.1&select=*", { headers: H });
  const rows = await r.json().catch(() => []);
  return Array.isArray(rows) ? rows[0] ?? null : null;
}
async function save(p: Record<string, unknown>) {
  await fetch(SB + "/rest/v1/proxy_oauth?on_conflict=id", { method: "POST",
    headers: { ...H, Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify({ id: 1, ...p, updated_at: new Date().toISOString() }) });
}
const b64 = (b: Uint8Array) => btoa(String.fromCharCode(...b))
  .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const rnd = (n = 32) => b64(crypto.getRandomValues(new Uint8Array(n)));

async function accessToken() {
  const r = await row();
  if (!r?.refresh_token) throw new Error("Proxy is not connected - run proxy-signin.js once.");
  if (r.access_token && r.expires_at && new Date(r.expires_at).getTime() > Date.now() + 60000) {
    return r.access_token as string;
  }
  const form = new URLSearchParams({ grant_type: "refresh_token", refresh_token: r.refresh_token,
    client_id: r.client_id, client_secret: r.client_secret, resource: ISSUER + "/mcp" });
  const t = await fetch(ISSUER + "/token", { method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: form.toString() });
  const tok = await t.json().catch(() => ({}));
  if (!t.ok || !tok?.access_token) throw new Error("Proxy would not renew: " + String(tok?.error || t.status));
  await save({ access_token: tok.access_token, refresh_token: tok.refresh_token || r.refresh_token,
    expires_at: new Date(Date.now() + (Number(tok.expires_in) || 3600) * 1000).toISOString() });
  return tok.access_token as string;
}

async function mcp(token: string, method: string, params: unknown, sid?: string, notify = false) {
  const headers: Record<string, string> = { "Content-Type": "application/json",
    Accept: "application/json, text/event-stream", Authorization: "Bearer " + token };
  if (sid) headers["mcp-session-id"] = sid;
  const msg: any = notify ? { jsonrpc: "2.0", method, params }
                          : { jsonrpc: "2.0", id: Date.now(), method, params };
  const r = await fetch(ISSUER + "/mcp", { method: "POST", headers, body: JSON.stringify(msg) });
  const session = r.headers.get("mcp-session-id") || sid;
  const text = await r.text();
  let payload: any = null;
  try { payload = JSON.parse(text); } catch (_e) {
    for (const line of text.split("\n")) {
      const s = line.trim();
      if (!s.startsWith("data:")) continue;
      try { const o = JSON.parse(s.slice(5).trim()); if (o?.result || o?.error) payload = o; }
      catch (_x) { /* not this line */ }
    }
  }
  return { ok: r.ok, status: r.status, payload, text, session };
}

/* PROXY ANSWERS IN SEVERAL PARTS AND THE FIRST IS NOT THE ADS - it holds only a conversation_id.
   A parser taking the first readable part therefore finds nothing and reports a cheerful zero,
   which is what happened on the first run across all 24 competitors. Every text part is read and
   the one carrying ads wins. Image links live elsewhere again, in result._meta.media_urls. */
function unwrap(result: any) {
  const out: any = { data: null, media: (result?._meta?.media_urls) || null };
  let fallback: any = null;
  for (const p of (Array.isArray(result?.content) ? result.content : [])) {
    if (p?.type !== "text" || typeof p.text !== "string") continue;
    let o: any = null;
    try { o = JSON.parse(p.text); } catch (_e) { continue; }
    if (o && typeof o === "object") {
      if (o.ads || o.brands) { out.data = o; break; }
      if (!fallback) fallback = o;
    }
  }
  if (!out.data) out.data = result?.structuredContent ?? fallback;
  if (!out.media && out.data?.media_urls) out.media = out.data.media_urls;
  return out;
}

/* THE PICTURE IS COPIED, NOT LINKED. Proxy returns a Facebook CDN url carrying its own expiry
   (the oe= parameter), so a stored link works today and is a dead image next week. The page also
   signs S3 keys rather than loading third-party urls. So each creative is fetched once into the
   same bucket and the same shape the Apify path uses - media_items[{s3_path, media_type}] - and
   the Competitor Ads page renders it with no change at all. */
function s3() {
  const bucket = Deno.env.get("S3_BUCKET"), region = Deno.env.get("S3_REGION");
  const ak = Deno.env.get("AWS_ACCESS_KEY_ID"), sk = Deno.env.get("AWS_SECRET_ACCESS_KEY");
  if (!bucket || !region || !ak || !sk) return null;
  return { bucket, region, aws: new AwsClient({ accessKeyId: ak, secretAccessKey: sk, region, service: "s3" }) };
}
/* THE KEY MUST START WITH portal/ AND FOR MONTHS IT DID NOT.
   s3-sign, which is what the page calls to turn a stored key into something a browser can load,
   only treats portal/ and legal/ as real roots and quietly prefixes anything else with portal/
   before signing. This wrote "competitors/3/<id>_0.jpg", so the signer went looking for
   "portal/competitors/3/<id>_0.jpg", which was never written, and the tile read "Media
   unavailable" for ever. Sixty-nine ads were sitting like that - every single ad this nightly
   job had ever saved - while the ads from the other path, which did prefix correctly, were fine.
   Writing the prefix here repairs them on the next run as a side effect, because this job
   re-copies the creative each night and overwrites the stored key with it. */
/* WHAT CAME BACK IS CHECKED BEFORE IT IS KEPT, AND KEPT AS WHAT IT ACTUALLY IS.

   The second time this screen filled with "Media unavailable" (see the note above for the first)
   the files were present in S3 and served a clean 200 - they simply were not pictures. Every DTC
   page failed on every ad, Godrej never failed, and opening one of the files directly gave a
   broken-image icon. The download had answered 200 with something that was not an image - an
   expired-link page, an error document, a redirect body - and this function wrote it out under a
   .jpg name with an image/jpeg label. S3 then served that garbage faithfully and the browser could
   not decode it. "Did the request succeed" and "is this a picture" are not the same question, and
   only the first was being asked.

   So the first bytes are read before anything is stored. A JPEG begins FF D8 FF, a PNG with the
   8-byte signature, GIF with "GIF8", WebP with "RIFF....WEBP", and an MP4/MOV carries "ftyp" at
   offset 4. Anything else is not media this screen can show, and is refused rather than saved -
   a tile that stays empty is recoverable on the next run, a stored impostor is not.

   The extension and the content type now follow the bytes. Everything used to be written as .jpg
   whatever it was, which is why not one video has been recorded since 24 September while the
   September run captured 360 of them: a video ad was saved as a picture and could never display. */
const MEDIA_KINDS: Array<{ ext: string; mime: string; is: (b: Uint8Array) => boolean }> = [
  { ext: "jpg",  mime: "image/jpeg", is: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { ext: "png",  mime: "image/png",  is: (b) => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 },
  { ext: "gif",  mime: "image/gif",  is: (b) => b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38 },
  { ext: "webp", mime: "image/webp", is: (b) => b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46
                                                && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50 },
  { ext: "mp4",  mime: "video/mp4",  is: (b) => b[4] === 0x66 && b[5] === 0x74 && b[6] === 0x79 && b[7] === 0x70 },
];
function sniffMedia(bytes: Uint8Array) {
  if (bytes.byteLength < 12) return null;
  return MEDIA_KINDS.find((k) => k.is(bytes)) || null;
}
/* HOW FAR THE AD ACTUALLY GOT, WHICH IS THE ONE THING ON THIS BOARD WORTH KNOWING.

   The Ad Library puts a "Low impression count" badge beside Active on some ads, with
   "Impressions: <100" and "Total active time 22 hrs" under it. Everything else the board shows
   says what a competitor IS running; this says whether it went anywhere.

   THE FIELD NAMES ARE NOT KNOWN. Proxy's get_meta_ads reply is not documented anywhere we hold,
   and the live call returns no ads today, so there was no way to look. Rather than guess one name
   and quietly record nothing, each value is read from any of several plausible names, and the
   union of keys actually present is reported back as ad_fields_seen. The next run that returns
   ads therefore tells us what Proxy really calls these - at which point this list can be cut down
   to the real name and the guessing removed.

   The impression figure is kept as Meta's own words. It is a RANGE ("<100", "1K-5K"), and turning
   it into a number would invent a precision Meta deliberately withholds. */
function pickText(a: any, names: string[]) {
  for (const n of names) {
    const v = a?.[n];
    if (v === null || v === undefined || v === "") continue;
    if (typeof v === "object") continue;
    return String(v);
  }
  return null;
}
function pickBool(a: any, names: string[]) {
  for (const n of names) {
    const v = a?.[n];
    if (v === true || v === false) return v;
    if (typeof v === "string" && /^(true|false)$/i.test(v)) return /^true$/i.test(v);
  }
  return null;
}
const IMPRESSION_KEYS = ["impressions", "impressions_text", "impression_range", "total_impressions",
                         "impressions_range", "reach", "eu_total_reach"];
const LOW_KEYS = ["low_impression", "is_low_impression", "low_impression_count", "has_low_impressions"];
const ACTIVE_TIME_KEYS = ["total_active_time", "active_time", "total_time_active", "duration"];
/* The badge is Meta's own judgement and an ad can carry a range without being flagged, so the two
   are read separately. When only the range is given, "<100" is itself the low-impression case -
   that is the exact wording the badge accompanies - so it is inferred rather than left blank. */
function readImpressions(a: any) {
  const text = pickText(a, IMPRESSION_KEYS);
  let low = pickBool(a, LOW_KEYS);
  if (low === null && text) low = /^\s*<\s*100\s*$/.test(text) ? true : null;
  return { text, low, activeTime: pickText(a, ACTIVE_TIME_KEYS) };
}

/* Returns {path, mediaType} so the caller can record what it really is, or a reason when nothing
   was stored - the reason is counted in the run's report rather than thrown away, because a job
   that writes nothing and still calls itself "succeeded" is how both of these faults survived for
   weeks. */
async function copyMedia(url: string, wlId: number, adId: string) {
  const c = s3();
  if (!c) return { path: null, mediaType: null, why: "no S3 credentials" };
  try {
    const r = await fetch(url);
    if (!r.ok) return { path: null, mediaType: null, why: "source returned " + r.status };
    const bytes = new Uint8Array(await r.arrayBuffer());
    if (!bytes.byteLength) return { path: null, mediaType: null, why: "source returned 0 bytes" };
    const kind = sniffMedia(bytes);
    if (!kind) {
      /* Said with the first bytes in hex, because the useful question afterwards is always "what
         WAS it then" - HTML starts 3c 21 or 3c 68, JSON 7b 22. */
      const head = Array.from(bytes.slice(0, 4)).map((x) => x.toString(16).padStart(2, "0")).join(" ");
      return { path: null, mediaType: null,
               why: "not an image or video (" + bytes.byteLength + " bytes, starts " + head + ")" };
    }
    const key = "portal/competitors/" + wlId + "/" + adId + "_0." + kind.ext;
    const dest = "https://" + c.bucket + ".s3." + c.region + ".amazonaws.com/"
      + key.split("/").map(encodeURIComponent).join("/");
    const put = await c.aws.fetch(dest, { method: "PUT", body: bytes,
      headers: { "Content-Type": kind.mime } });
    if (!put.ok) return { path: null, mediaType: null, why: "S3 refused the upload (" + put.status + ")" };
    return { path: "s3:" + key, mediaType: kind.mime.startsWith("video/") ? "video" : "image", why: null };
  } catch (e) { return { path: null, mediaType: null, why: String((e as Error)?.message || e) }; }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  const url = new URL(req.url);
  const action = url.searchParams.get("action") || "";
  try {
    if (action === "status") {
      const r = await row();
      return json({ registered: !!r?.client_id, connected: !!r?.refresh_token,
        connected_at: r?.connected_at ?? null, token_fresh_until: r?.expires_at ?? null });
    }
    if (action === "prepare") {
      const nonce = rnd(24); await save({ state: "adopt:" + nonce });
      return json({ nonce, expires_in_minutes: 10 });
    }
    if (action === "adopt") {
      if (req.method !== "POST") return json({ error: "POST only" }, 405);
      const b = await req.json().catch(() => ({}));
      const r = await row(); const want = String(r?.state || "");
      if (!want.startsWith("adopt:")) return json({ error: "call ?action=prepare first" }, 400);
      if (Date.now() - new Date(r?.updated_at || 0).getTime() > 600000) {
        await save({ state: null }); return json({ error: "took over ten minutes" }, 400);
      }
      if (String(b?.nonce || "") !== want.slice(6)) return json({ error: "wrong nonce" }, 403);
      const form = new URLSearchParams({ grant_type: "refresh_token",
        refresh_token: String(b.refresh_token), client_id: String(b.client_id),
        client_secret: String(b.client_secret), resource: ISSUER + "/mcp" });
      const t = await fetch(ISSUER + "/token", { method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: form.toString() });
      const tok = await t.json().catch(() => ({}));
      if (!t.ok || !tok?.access_token) return json({ error: "refresh did not work" }, 502);
      await save({ client_id: String(b.client_id), client_secret: String(b.client_secret),
        refresh_token: String(tok.refresh_token || b.refresh_token), access_token: tok.access_token,
        expires_at: new Date(Date.now() + (Number(tok.expires_in) || 3600) * 1000).toISOString(),
        connected_at: new Date().toISOString(), state: null, code_verifier: null });
      return json({ ok: true, connected: true });
    }

    if (action === "sync") {
      if (req.method !== "POST") return json({ error: "POST only" }, 405);
      const body = await req.json().catch(() => ({}));
      const write = body?.write === true;
      const withMedia = body?.media !== false;
      const country = String(body?.country || "IN").toUpperCase().slice(0, 2);
      const perPage = Math.min(Number(body?.limit) || 25, 100);
      /* IT RUNS IN SLICES BECAUSE ONE INVOCATION CANNOT DO THE LOT. Copying every creative for 24
         competitors in a single call exceeded Supabase's resource ceiling and came back 546 with
         nothing written. skip/take walk the watchlist a few at a time; next_skip in the reply says
         where to carry on, and is null when there is no more. */
      const skip = Math.max(0, Number(body?.skip) || 0);
      const take = Math.max(1, Math.min(Number(body?.take) || 4, 24));
      /* ...AND NOTHING WAS CARRYING ON. The cron posted {"write":true} and nothing else, so every
         run started at skip 0, did the first four competitors and stopped - twice a night, the
         same four. Eighteen competitors had not been touched since 22 September and nobody could
         tell, because an untouched competitor keeps its old ads and they read as current.
         So the slice now hands over to the next one itself. waitUntil lets the handover outlive
         this response, hops is a hard stop against a loop that will not end, and auto:false still
         gives you a single slice when you want to test one by hand. */
      const auto = body?.auto !== false;
      const hops = Math.max(0, Number(body?.hops) || 0);
      /* THE SCREEN ASKS FOR A SUBSET. The Fetch from Meta button sends the watchlist ids on the tab
         it is showing (Competitors or Our Brands, or the one row picked), and skip/take then walk
         that subset rather than the whole list. The cron sends none and gets everything. */
      const only = Array.isArray(body?.watchlist_ids)
        ? new Set(body.watchlist_ids.map((x: unknown) => Number(x)).filter((x: number) => x > 0))
        : null;

      const wlRes = await fetch(SB + "/rest/v1/competitor_watchlist"
        + "?select=id,name,page_id&active=is.true&page_id=not.is.null&order=id", { headers: H });
      const listed: any[] = await wlRes.json().catch(() => []);
      const all = only ? listed.filter((w) => only.has(Number(w.id))) : listed;
      const wl = all.slice(skip, skip + take);
      const ids = wl.map((w) => String(w.page_id || "").trim()).filter(Boolean);
      if (!ids.length) return json({ ok: true, done: true, next_skip: null, of_watchlist: all.length,
        found: 0, written: 0, message: "nothing left in the watchlist from skip " + skip });
      const byPage = new Map<string, any>(); wl.forEach((w) => byPage.set(String(w.page_id).trim(), w));

      const token = await accessToken();
      const init = await mcp(token, "initialize", { protocolVersion: "2024-11-05",
        capabilities: {}, clientInfo: { name: "jaine", version: "1" } });
      await mcp(token, "notifications/initialized", {}, init.session, true);

      const rep: any = { of_watchlist: all.length, slice: { skip, take, names: wl.map((w) => w.name) },
        found: 0, written: 0, media_copied: 0, media_failed: 0,
        media_why: {} as Record<string, number>, media_examples: [] as string[],
        ad_fields_seen: [] as string[], impressions_seen: 0, low_flagged: 0, dry_run: !write,
        per_page: {} as Record<string, number>, errors: [] as string[] };

      const call = await mcp(token, "tools/call", { name: "get_meta_ads", arguments: {
        platform_ids: ids, country, limit: perPage,
        context: "Collect competitor property ads for the Jain Group competitor board." } },
        init.session);
      if (call.payload?.error) rep.errors.push(String(call.payload.error.message || "error"));
      else {
        const u = unwrap(call.payload?.result);
        if (!u.data) rep.errors.push("unreadable reply: " + call.text.slice(0, 140));
        else {
          const ads = u.data.ads || {};
          const media = u.media || {};
          for (const pageId of Object.keys(ads)) {
            const list = Array.isArray(ads[pageId]) ? ads[pageId] : [];
            const w = byPage.get(String(pageId));
            rep.per_page[(w?.name || pageId)] = list.length;
            rep.found += list.length;
            if (!w || !write) continue;
            for (const a of list) {
              const id = String(a?.ad_id || "").trim(); if (!id) continue;
              const src = media[id] || null;
              let items: any = null, first: string | null = null, firstType: string | null = null;
              if (src && withMedia) {
                const got = await copyMedia(String(src), w.id, id);
                if (got.path) {
                  first = got.path; firstType = got.mediaType;
                  items = [{ s3_path: got.path, media_type: got.mediaType }];
                  rep.media_copied++;
                } else {
                  rep.media_failed++;
                  /* Kept per reason rather than as one total, so "the link had expired" and "S3
                     refused it" are not reported as the same thing. Capped: a page that fails on
                     every ad must not turn the report into a wall of identical lines. */
                  const why = got.why || "unknown";
                  rep.media_why[why] = (rep.media_why[why] || 0) + 1;
                  if (rep.media_examples.length < 5) {
                    rep.media_examples.push((w?.name || pageId) + " / " + id + ": " + why);
                  }
                }
              }
              const out: any = { id, watchlist_id: w.id, page_id: String(pageId),
                page_name: a?.page_name || a?.advertiser_name || w.name,
                ad_creative_bodies: a?.body ? [String(a.body)] : null,
                ad_creative_link_titles: a?.headline ? [String(a.headline)] : null,
                headline: a?.headline || null, description: a?.link_description || null, country,
                ad_snapshot_url: "https://www.facebook.com/ads/library/?id=" + id,
                ad_delivery_start_time: a?.start_date || null,
                ad_delivery_stop_time: a?.is_active ? null : (a?.end_date || null),
                publisher_platforms: a?.advertiser_platform ? [String(a.advertiser_platform)] : null,
                cta_text: a?.cta_text || null, redirect_url: a?.link_url || null,
                display_format: a?.media_type || null,
                last_seen_at: new Date().toISOString() };
              const impr = readImpressions(a);
              if (impr.text !== null) { out.impressions_text = impr.text; rep.impressions_seen++; }
              if (impr.low !== null) { out.low_impression = impr.low; if (impr.low) rep.low_flagged++; }
              if (impr.activeTime !== null) out.total_active_time = impr.activeTime;
              /* Every key this ad carried, so one real run names the fields instead of us
                 guessing. Union across the slice, capped - it is a diagnostic, not a dump. */
              for (const key of Object.keys(a || {})) {
                if (rep.ad_fields_seen.length < 60 && !rep.ad_fields_seen.includes(key)) {
                  rep.ad_fields_seen.push(key);
                }
              }
              /* Only overwrite the picture when a new one was actually copied - a failed download
                 must not wipe a good image stored on an earlier run. */
              if (items) { out.media_items = items; out.media_s3_path = first; out.media_type = firstType; }
              const ins = await fetch(SB + "/rest/v1/competitor_ads?on_conflict=id", { method: "POST",
                headers: { ...H, Prefer: "resolution=merge-duplicates,return=minimal" },
                body: JSON.stringify(out) });
              if (ins.ok) rep.written++;
              else if (rep.errors.length < 5) rep.errors.push("save " + id + ": " + (await ins.text()).slice(0, 140));
            }
          }
        }
      }
      /* Stamped only when Proxy actually answered, so "last synced" on the screen means a pull
         that worked - including one that honestly found no ads - and never a failed call. */
      if (write && !rep.errors.length) {
        await fetch(SB + "/rest/v1/competitor_watchlist?id=in.(" + wl.map((w) => Number(w.id)).join(",") + ")", {
          method: "PATCH", headers: { ...H, Prefer: "return=minimal" },
          body: JSON.stringify({ last_sync_at: new Date().toISOString() }) }).catch(() => {});
      }
      const next = skip + take;
      rep.next_skip = next < all.length ? next : null;
      rep.done = rep.next_skip === null;
      rep.hops = hops;

      if (auto && write && rep.next_skip !== null && hops < 12) {
        const carryOn = fetch(url.origin + "/functions/v1/competitor-sync-test-probe?action=sync", {
          method: "POST",
          headers: { "Content-Type": "application/json", apikey: SRV, Authorization: "Bearer " + SRV },
          body: JSON.stringify({ ...body, skip: rep.next_skip, hops: hops + 1 }),
        }).catch(() => {});
        try { (globalThis as any).EdgeRuntime?.waitUntil?.(carryOn); } catch (_e) { /* best effort */ }
        rep.handed_on_to_skip = rep.next_skip;
      }
      return json({ ok: true, ...rep });
    }

    return json({ actions: ["status", "prepare", "adopt (POST)", "sync (POST, skip/take, watchlist_ids)"] });
  } catch (e) {
    return json({ error: String((e as any)?.message || e) }, 500);
  }
});
