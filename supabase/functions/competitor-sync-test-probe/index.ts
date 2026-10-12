// Proxy sign-in + fetch for Competitor Ads. Slug is historical: the project is at its
// edge-function limit, so a spent one-shot probe's slot was reused with consent.
// Sign-in happened once on a laptop because Proxy refuses non-allow-listed redirects; refreshing
// carries no redirect, so this renews unattended for ever.
//
// THIS IS THE ONE ROUTE INTO THE COMPETITOR ADS TABLES. The nightly cron
// (competitor-ads-proxy-daily) and the Fetch from Meta button on the screen both call it, so the
// screen and the nightly job always pull the same way. competitor-ads-sync, the self-hosted
// Playwright scraper the button used to call, is no longer reached from the page.
//
// It pulls from ScrapeCreators when the SCRAPECREATORS_API_KEY secret is set, and from Proxy
// otherwise. Proxy's Free plan (20 credits a day) could not cover the 28-page watchlist; whichever
// pages the credits ran out on simply showed nothing.

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

// Calls a camp.* database function as the service role (H carries the camp profile).
async function rpc(fn: string, args: unknown) {
  const r = await fetch(SB + "/rest/v1/rpc/" + fn, { method: "POST", headers: H, body: JSON.stringify(args) });
  const text = await r.text();
  let data: any = null;
  try { data = JSON.parse(text); } catch (_e) { /* not JSON */ }
  return { ok: r.ok, data, text };
}

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
async function copyMedia(url: string, wlId: number, adId: string, slot = "0") {
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
    const key = "portal/competitors/" + wlId + "/" + adId + "_" + slot + "." + kind.ext;
    const dest = "https://" + c.bucket + ".s3." + c.region + ".amazonaws.com/"
      + key.split("/").map(encodeURIComponent).join("/");
    const put = await c.aws.fetch(dest, { method: "PUT", body: bytes,
      headers: { "Content-Type": kind.mime } });
    if (!put.ok) return { path: null, mediaType: null, why: "S3 refused the upload (" + put.status + ")" };
    return { path: "s3:" + key, mediaType: kind.mime.startsWith("video/") ? "video" : "image", why: null };
  } catch (e) { return { path: null, mediaType: null, why: String((e as Error)?.message || e) }; }
}

/* ONE SHAPE FOR EVERY SOURCE. Each provider's reply is turned into rows the competitor_ads table
   already holds plus a list of media to copy, so the writer below never needs to know which
   service answered. */
type NormMedia = { url: string; poster?: string | null };
type NormAd = { id: string; row: Record<string, unknown>; media: NormMedia[]; raw: any };

async function pool<T>(items: T[], n: number, fn: (x: T) => Promise<void>) {
  let i = 0;
  const run = async () => { while (i < items.length) { const x = items[i++]; await fn(x); } };
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, run));
}
const uniq = (xs: unknown[]) => Array.from(new Set(xs.filter((t) => typeof t === "string" && t.trim()) as string[]));

async function pullProxy(ids: string[], country: string, perPage: number, rep: any) {
  const out = new Map<string, NormAd[]>();
  const token = await accessToken();
  const init = await mcp(token, "initialize", { protocolVersion: "2024-11-05",
    capabilities: {}, clientInfo: { name: "jaine", version: "1" } });
  await mcp(token, "notifications/initialized", {}, init.session, true);
  const call = await mcp(token, "tools/call", { name: "get_meta_ads", arguments: {
    platform_ids: ids, country, limit: perPage,
    context: "Collect competitor property ads for the Jain Group competitor board." } },
    init.session);
  if (call.payload?.error) { rep.errors.push(String(call.payload.error.message || "error")); return out; }
  const u = unwrap(call.payload?.result);
  if (!u.data) { rep.errors.push("unreadable reply: " + call.text.slice(0, 140)); return out; }
  /* A REFUSAL IS NOT AN EMPTY RESULT. When the plan's daily credits run out Proxy answers with a
     message and no ads at all, and this used to read that as "found 0, no errors" - pages that
     run 20 ads showed none and the run still looked clean. No ads key means Proxy did not answer
     the question, so its words are passed on as the error. */
  if (!u.data.ads) {
    rep.errors.push("Proxy returned no ads list: " + String(u.data.error || u.data.message || call.text).slice(0, 200));
    return out;
  }
  const media = u.media || {};
  for (const pageId of Object.keys(u.data.ads)) {
    const list = Array.isArray(u.data.ads[pageId]) ? u.data.ads[pageId] : [];
    out.set(String(pageId), list.filter((a: any) => String(a?.ad_id || "").trim()).map((a: any) => {
      const id = String(a.ad_id).trim();
      const row: any = { page_name: a?.page_name || a?.advertiser_name || null,
        ad_creative_bodies: a?.body ? [String(a.body)] : null,
        ad_creative_link_titles: a?.headline ? [String(a.headline)] : null,
        headline: a?.headline || null, description: a?.link_description || null,
        ad_snapshot_url: "https://www.facebook.com/ads/library/?id=" + id,
        ad_delivery_start_time: a?.start_date || null,
        ad_delivery_stop_time: a?.is_active ? null : (a?.end_date || null),
        publisher_platforms: a?.advertiser_platform ? [String(a.advertiser_platform)] : null,
        cta_text: a?.cta_text || null, redirect_url: a?.link_url || null,
        display_format: a?.media_type || null };
      const impr = readImpressions(a);
      if (impr.text !== null) row.impressions_text = impr.text;
      if (impr.low !== null) row.low_impression = impr.low;
      if (impr.activeTime !== null) row.total_active_time = impr.activeTime;
      return { id, row, media: media[id] ? [{ url: String(media[id]) }] : [], raw: a };
    }));
  }
  /* Proxy answered, so a page it left out simply has no ads: recorded as pulled-with-nothing, not
     as a failure the queue would retry and pay for again. */
  for (const p of ids) if (!out.has(p)) out.set(p, []);
  return out;
}

/* SCRAPECREATORS: one call per page, 1 credit each, answering with the Ad Library's own record -
   copy, cards, dates, platforms and fresh media links. Only the first page of results (about 20,
   newest first) is asked for: run nightly that keeps up with everything new, and each further
   page would cost another credit. The key is a Supabase secret, never in the repo or the page. */
const SC_URL = "https://api.scrapecreators.com/v1/facebook/adLibrary/company/ads";
const scIso = (s?: string | null, n?: number | null) =>
  (s ? String(s) : (n ? new Date(Number(n) * 1000).toISOString() : null));

function scNormalize(a: any): NormAd | null {
  const id = String(a?.ad_archive_id || a?.ad_id || "").trim();
  if (!id) return null;
  const s = a?.snapshot || {};
  const cards: any[] = Array.isArray(s.cards) ? s.cards : [];
  const c0 = cards[0] || {};
  const bodies = uniq([s?.body?.text, ...cards.map((c) => c?.body)]);
  const titles = uniq([s?.title, ...cards.map((c) => c?.title)]);
  const row: any = { page_name: s.page_name || a?.page_name || null,
    ad_creative_bodies: bodies.length ? bodies.slice(0, 5) : null,
    ad_creative_link_titles: titles.length ? titles.slice(0, 5) : null,
    headline: s.title || c0.title || null,
    description: s.link_description || c0.link_description || null,
    ad_snapshot_url: a?.url || ("https://www.facebook.com/ads/library/?id=" + id),
    ad_delivery_start_time: scIso(a?.start_date_string, a?.start_date),
    // Meta fills end_date with "today" while an ad still runs, so only a finished ad gets one.
    ad_delivery_stop_time: a?.is_active ? null : scIso(a?.end_date_string, a?.end_date),
    publisher_platforms: Array.isArray(a?.publisher_platform) ? a.publisher_platform.map(String) : null,
    cta_text: s.cta_text || c0.cta_text || null,
    redirect_url: s.link_url || c0.link_url || null,
    display_format: s.display_format || null };
  const links = uniq(Array.isArray(s.extra_links) ? s.extra_links : []);
  if (links.length) row.extra_links = links;
  const impr = a?.impressions_with_index?.impressions_text;
  if (impr) { row.impressions_text = String(impr); if (/^\s*<\s*100\s*$/.test(String(impr))) row.low_impression = true; }
  if (a?.total_active_time !== null && a?.total_active_time !== undefined) row.total_active_time = String(a.total_active_time);
  /* A carousel or dynamic ad keeps its creatives in cards; a single ad in images/videos. Up to
     three are copied - enough for the board to show it as a carousel without copying a 10-card
     catalogue in full. */
  const srcs: any[] = cards.length ? cards
    : [...(Array.isArray(s.videos) ? s.videos : []), ...(Array.isArray(s.images) ? s.images : [])];
  const media: NormMedia[] = [];
  for (const m of srcs) {
    const video = m?.video_sd_url || m?.video_hd_url;
    const image = m?.original_image_url || m?.resized_image_url;
    if (video) media.push({ url: String(video), poster: m?.video_preview_image_url || image || null });
    else if (image) media.push({ url: String(image) });
    if (media.length >= 3) break;
  }
  return { id, row, media, raw: a };
}

async function pullScrapeCreators(key: string, ids: string[], country: string, rep: any) {
  const out = new Map<string, NormAd[]>();
  await pool(ids, 4, async (pageId) => {
    try {
      const r = await fetch(SC_URL + "?pageId=" + encodeURIComponent(pageId) + "&country=" + country,
        { headers: { "x-api-key": key } });
      const d: any = await r.json().catch(() => ({}));
      if (!r.ok || d?.success === false) {
        rep.errors.push("ScrapeCreators " + r.status + " for page " + pageId + ": "
          + String(d?.message || d?.error || "").slice(0, 160));
        return;
      }
      if (typeof d?.credits_remaining === "number") {
        rep.credits_remaining = Math.min(rep.credits_remaining ?? Infinity, d.credits_remaining);
      }
      const list = (Array.isArray(d?.results) ? d.results : []).map(scNormalize).filter(Boolean) as NormAd[];
      out.set(String(pageId), list);
    } catch (e) {
      rep.errors.push("ScrapeCreators failed for page " + pageId + ": " + String((e as Error)?.message || e).slice(0, 160));
    }
  });
  return out;
}

/* ONE PULL, SHARED. The "sync" action (a slice of the watchlist) and the "work" action (whatever
   the weekly/manual queue hands it) both come here, so a page is pulled, stored and stamped the
   same way whichever route asked for it. wl rows need id, name and page_id. */
async function pullAndWrite(wl: any[], body: any) {
  const write = body?.write === true;
  const withMedia = body?.media !== false;
  const country = String(body?.country || "IN").toUpperCase().slice(0, 2);
  const perPage = Math.min(Number(body?.limit) || 25, 100);
  const ids = wl.map((w) => String(w.page_id || "").trim()).filter(Boolean);
  if (!ids.length) return { rep: { found: 0, written: 0, per_page: {}, errors: [] as string[] } as any,
    pulled: new Map<string, NormAd[]>(), answered: [] as any[] };
  const byPage = new Map<string, any>(); wl.forEach((w) => byPage.set(String(w.page_id).trim(), w));

  /* WHICH SERVICE ANSWERS. "both" (the default once the ScrapeCreators key is set): Proxy is
     asked first because its 20 credits a day are free, and every page it refuses (credits
     spent) or returns nothing for is asked again of ScrapeCreators, at 1 credit a page from a
     pack that never expires. Without the key it is Proxy alone. body.provider forces one
     ("proxy", "scrapecreators" or "both"), for testing them side by side. */
  const scKey = Deno.env.get("SCRAPECREATORS_API_KEY") || "";
  const provider = ["proxy", "scrapecreators", "both"].includes(String(body?.provider))
    ? String(body.provider) : (scKey ? "both" : "proxy");
  if (provider !== "proxy" && !scKey) throw new Error("SCRAPECREATORS_API_KEY is not set");
  const refresh = body?.refresh_media === true;
  /* A pull that copies media for a page's whole history the first time can outrun the edge
     function's time limit, and a timed-out run writes nothing. So media copying stops at the
     budget; the ads are still saved, and their pictures arrive on the next run because an ad
     without media_items is always picked up again. */
  const deadline = Date.now() + Math.max(20, Math.min(Number(body?.budget_s) || 110, 300)) * 1000;

  const rep: any = { provider,
    found: 0, written: 0, media_copied: 0, media_failed: 0, media_skipped_for_time: 0,
    media_why: {} as Record<string, number>, media_examples: [] as string[],
    ad_fields_seen: [] as string[], impressions_seen: 0, low_flagged: 0, dry_run: !write,
    per_page: {} as Record<string, number>, errors: [] as string[] };

  let pulled: Map<string, NormAd[]>;
  rep.source = {} as Record<string, string>;   // page name -> which service its ads came from
  if (provider === "scrapecreators") pulled = await pullScrapeCreators(scKey, ids, country, rep);
  else {
    try { pulled = await pullProxy(ids, country, perPage, rep); }
    catch (e) {
      // Proxy unreachable or signed out: on its own that ends the run; with both, it is a gap.
      if (provider === "proxy") throw e;
      rep.errors.push("Proxy: " + String((e as Error)?.message || e).slice(0, 160));
      pulled = new Map();
    }
    if (provider === "both") {
      /* Proxy's refusals are not failures of the run when ScrapeCreators can cover them, so
         they are moved aside as notes; only what ScrapeCreators cannot answer stays an error. */
      rep.proxy_notes = rep.errors.splice(0);
      const gaps = ids.filter((p) => !(pulled.get(p) || []).length);
      if (gaps.length) {
        const more = await pullScrapeCreators(scKey, gaps, country, rep);
        for (const [p, list] of more) { pulled.set(p, list); rep.source[byPage.get(p)?.name || p] = "scrapecreators"; }
      }
    }
    for (const p of pulled.keys()) {
      const n = byPage.get(p)?.name || p;
      if (!rep.source[n]) rep.source[n] = "proxy";
    }
  }

  /* Ads that already hold their media are not copied again unless asked (Rebuild previews).
     ScrapeCreators gives up to three creatives per ad and Proxy only one, so with both in
     play a later Proxy pull must not replace a carousel with a single picture - and only new
     ads cost downloads. Proxy on its own keeps its old behaviour (re-copy every night),
     which is what repaired its older storage keys. */
  const haveMedia = new Set<string>();
  if (write && provider !== "proxy" && !refresh) {
    const r = await fetch(SB + "/rest/v1/competitor_ads?select=id&media_items=not.is.null&watchlist_id=in.("
      + wl.map((w) => Number(w.id)).join(",") + ")", { headers: H });
    const rows: any[] = await r.json().catch(() => []);
    if (Array.isArray(rows)) rows.forEach((x) => haveMedia.add(String(x.id)));
  }

  for (const [pageId, list] of pulled) {
    const w = byPage.get(String(pageId));
    rep.per_page[(w?.name || pageId)] = list.length;
    rep.found += list.length;
    if (!w || !write) continue;
    await pool(list, 4, async (n: NormAd) => {
      const id = n.id;
      let items: any[] | null = null;
      const wantMedia = withMedia && n.media.length && (refresh || !haveMedia.has(id));
      if (wantMedia && Date.now() > deadline) rep.media_skipped_for_time++;
      else if (wantMedia) {
        items = [];
        for (let i = 0; i < n.media.length; i++) {
          const m = n.media[i];
          const got = await copyMedia(m.url, w.id, id, String(i));
          if (got.path) {
            const it: any = { s3_path: got.path, media_type: got.mediaType };
            /* A video gets its own still, so the grid shows a picture without downloading
               the clip - the page uses `poster` whenever it is there. */
            if (got.mediaType === "video" && m.poster) {
              const p = await copyMedia(m.poster, w.id, id, i + "p");
              if (p.path && p.mediaType === "image") it.poster = p.path;
            }
            items.push(it);
            rep.media_copied++;
          } else {
            rep.media_failed++;
            /* Kept per reason rather than as one total, so "the link had expired" and "S3
               refused it" are not reported as the same thing. Capped: a page that fails on
               every ad must not turn the report into a wall of identical lines. */
            const why = got.why || "unknown";
            rep.media_why[why] = (rep.media_why[why] || 0) + 1;
            if (rep.media_examples.length < 5) rep.media_examples.push((w?.name || pageId) + " / " + id + ": " + why);
          }
        }
        if (!items.length) items = null;
      }
      const out: any = { ...n.row, id, watchlist_id: w.id, page_id: String(pageId), country,
        page_name: n.row.page_name || w.name, last_seen_at: new Date().toISOString() };
      if (out.impressions_text) rep.impressions_seen++;
      if (out.low_impression) rep.low_flagged++;
      /* Every key this ad carried, so one real run names the fields instead of us guessing.
         Union across the slice, capped - it is a diagnostic, not a dump. */
      for (const key of Object.keys(n.raw || {})) {
        if (rep.ad_fields_seen.length < 60 && !rep.ad_fields_seen.includes(key)) rep.ad_fields_seen.push(key);
      }
      /* Only overwrite the picture when a new one was actually copied - a failed download
         must not wipe a good image stored on an earlier run. */
      if (items) { out.media_items = items; out.media_s3_path = items[0].s3_path; out.media_type = items[0].media_type; }
      const ins = await fetch(SB + "/rest/v1/competitor_ads?on_conflict=id", { method: "POST",
        headers: { ...H, Prefer: "resolution=merge-duplicates,return=minimal" },
        body: JSON.stringify(out) });
      if (ins.ok) rep.written++;
      else if (rep.errors.length < 5) rep.errors.push("save " + id + ": " + (await ins.text()).slice(0, 140));
    });
  }
  /* Stamped only for the pages the service actually answered for, so "last pulled" on the
     screen means a pull that worked - including one that honestly found no ads - and never a
     failed call or a refusal. */
  const answered = wl.filter((w) => pulled.has(String(w.page_id).trim()));
  if (write && answered.length) {
    await fetch(SB + "/rest/v1/competitor_watchlist?id=in.(" + answered.map((w) => Number(w.id)).join(",") + ")", {
      method: "PATCH", headers: { ...H, Prefer: "return=minimal" },
      body: JSON.stringify({ last_sync_at: new Date().toISOString() }) }).catch(() => {});
  }
  return { rep, pulled, answered };
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

    /* THE QUEUE WORKER - the route that spends credits. The cron wakes it every ten minutes when
       something is waiting, and the screen calls it straight after a manual pull is requested so
       the first pages land at once. It never decides how much to pull: competitor_claim_pulls hands
       it only what today's credit budget allows (at most four pages, one Proxy call), and
       competitor_finish_pulls takes the outcome back, so the budget holds however often it is
       called and by whom. */
    if (action === "work") {
      if (req.method !== "POST") return json({ error: "POST only" }, 405);
      const body = await req.json().catch(() => ({}));
      const max = Math.max(1, Math.min(Number(body?.max) || 4, 4));
      const claim = await rpc("competitor_claim_pulls", { p_max: max });
      if (!claim.ok) return json({ error: "could not claim from the queue: " + claim.text.slice(0, 200) }, 500);
      const rows: any[] = Array.isArray(claim.data) ? claim.data : [];
      if (!rows.length) return json({ ok: true, idle: true, claimed: 0 });

      const wl = rows.map((r) => ({ id: r.watchlist_id, name: r.name, page_id: r.page_id, queue_id: r.queue_id }));
      let rep: any = { errors: [] as string[], per_page: {} };
      let answered: any[] = [];
      try {
        ({ rep, answered } = await pullAndWrite(wl, { write: true, provider: body?.provider }));
      } catch (e) {
        rep.errors.push(String((e as Error)?.message || e).slice(0, 300));
      }
      const ok = new Set(answered.map((w) => Number(w.id)));
      const said = [...(rep.errors || []), ...(rep.proxy_notes || [])].join(" | ");
      /* Nothing answered and Proxy talked about credits or limits: the day's allowance is gone,
         whatever our own count says. Those pages go back in line and the day is closed. */
      const refused = !ok.size && /credit|limit|quota|exhaust/i.test(said);
      const results = wl.map((w) => ({ queue_id: w.queue_id, ok: ok.has(Number(w.id)),
        ads: rep.per_page?.[w.name] ?? 0, error: ok.has(Number(w.id)) ? null : (said.slice(0, 300) || "no answer") }));
      const fin = await rpc("competitor_finish_pulls", { p_results: results, p_refused: refused });
      if (!fin.ok) rep.errors.push("could not report back to the queue: " + fin.text.slice(0, 200));
      return json({ ok: true, claimed: wl.length, answered: ok.size, refused,
        pages: wl.map((w) => w.name), ...rep });
    }

    if (action === "sync") {
      if (req.method !== "POST") return json({ error: "POST only" }, 405);
      const body = await req.json().catch(() => ({}));
      const write = body?.write === true;
      /* Writing through sync skips the credit budget, so only the server itself may do it - for a
         one-off backfill run by hand. The screen and the cron go through "work". A dry run (no
         write) stays open for checking what Proxy returns. */
      if (write && req.headers.get("Authorization") !== "Bearer " + SRV) {
        return json({ error: "Pulls go through the queue now (action=work); sync with write is server-only." }, 403);
      }
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
      if (!wl.length) return json({ ok: true, done: true, next_skip: null, of_watchlist: all.length,
        found: 0, written: 0, message: "nothing left in the watchlist from skip " + skip });
      const { rep } = await pullAndWrite(wl, body);
      rep.of_watchlist = all.length;
      rep.slice = { skip, take, names: wl.map((w) => w.name) };
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

    return json({ actions: ["status", "prepare", "adopt (POST)", "work (POST, max)",
      "sync (POST, skip/take, watchlist_ids; write is server-only)"] });
  } catch (e) {
    return json({ error: String((e as any)?.message || e) }, 500);
  }
});
