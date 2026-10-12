// Competitor Ads sync - self-hosted version, no third-party actor.
//
// SPLIT ON PURPOSE: the actual browsing (the only part that needs a real, JS-executing browser to
// get past Meta's bot-wall - confirmed directly, a plain fetch() gets a 403 "Client challenge" on
// every Ad Library URL) happens on a separate machine running Playwright. That machine holds NO
// AWS or Supabase credentials - it only scrapes and hands back JSON. Everything that touches a
// secret - downloading media, writing to S3, writing to the database - happens here, inside the
// edge function, the same as every other integration in this codebase.
//
// REPLACES the Apify-based version: same table shapes (camp.competitor_watchlist,
// camp.competitor_ads), same replace_stale behaviour (an ad this fetch does not return for a
// competitor is deleted along with its S3 media, so the screen reflects this fetch only), same
// exclusive-end-date fix Meta's own start_date[max] needs. The self-hosted scraper is
// scraper-test/scrape.js + server.js in this repo.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.47.10";
import { AwsClient } from "https://esm.sh/aws4fetch@1.0.20";

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
const j = (o: any, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } });

function s3Client() {
  const bucket = Deno.env.get('S3_BUCKET'), region = Deno.env.get('S3_REGION'), ak = Deno.env.get('AWS_ACCESS_KEY_ID'), sk = Deno.env.get('AWS_SECRET_ACCESS_KEY');
  if (!bucket || !region || !ak || !sk) return null;
  return { bucket, region, aws: new AwsClient({ accessKeyId: ak, secretAccessKey: sk, region, service: 's3' }) };
}
function s3Url(c: any, key: string) { return 'https://' + c.bucket + '.s3.' + c.region + '.amazonaws.com/' + key.split('/').map(encodeURIComponent).join('/'); }
async function uploadToS3(key: string, bytes: Uint8Array, contentType: string) {
  const c = s3Client(); if (!c) return false;
  const r = await c.aws.fetch(s3Url(c, key), { method: 'PUT', body: bytes, headers: { 'Content-Type': contentType } });
  return r.ok;
}
/* Server-side copy, used by the media repair below. The bytes never leave S3 - this is a PUT with
   x-amz-copy-source, so repairing a thousand old thumbnails costs no download and no Meta round
   trip. The source has to be /<bucket>/<key> and URL-encoded the same way the request path is. */
async function copyInS3(srcKey: string, dstKey: string) {
  const c = s3Client(); if (!c) return false;
  try {
    const src = '/' + c.bucket + '/' + srcKey.split('/').map(encodeURIComponent).join('/');
    const r = await c.aws.fetch(s3Url(c, dstKey), { method: 'PUT', headers: { 'x-amz-copy-source': src } });
    return r.ok;
  } catch (_e) { return false; }
}
async function deleteFromS3(paths: string[]) {
  const c = s3Client(); if (!c) return 0;
  let n = 0;
  for (const p of paths) {
    const key = String(p || '').replace(/^s3:/, ''); if (!key) continue;
    try { const r = await c.aws.fetch(s3Url(c, key), { method: 'DELETE' }); if (r.ok) n++; } catch (_e) {}
  }
  return n;
}
function dayAfter(d: string) { const x = new Date(d + 'T00:00:00Z'); x.setUTCDate(x.getUTCDate() + 1); return x.toISOString().slice(0, 10); }
const MEDIA_TYPES = ['all', 'image', 'video', 'meme', 'none'];

// Runs `fn` over `items` with at most `concurrency` in flight at once. The original per-ad loop
// awaited each ad's media downloads one at a time - fine for a handful of ads, but a big advertiser
// (100-300 ads, up to 6 media files each) pushed wall-clock time past the edge function's execution
// limit, cutting the sync off mid-run and needing several manual re-clicks to finish (confirmed
// directly: a 126-ad competitor stalled at 82 on one call). Running many ads concurrently instead of
// sequentially turns that into one click.
async function pMap<T, R>(items: T[], concurrency: number, fn: (item: T, i: number) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await fn(items[i], i);
    }
  }
  await Promise.all(new Array(Math.min(concurrency, items.length)).fill(0).map(worker));
  return results;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return j({ error: 'method not allowed' }, 405);

  const SB = Deno.env.get('SUPABASE_URL')!, ANON = Deno.env.get('SUPABASE_ANON_KEY')!, SRV = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const token = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  if (!token) return j({ error: 'missing token' }, 401);

  const SCRAPER_URL = Deno.env.get('SCRAPER_URL');
  const SCRAPER_SECRET = Deno.env.get('SCRAPER_SHARED_SECRET') || '';

  const db = createClient(SB, SRV);
  let body: any = {}; try { body = await req.json(); } catch (_e) {}

  // Manual push mode (body.ads present) is a backend/test path, never used by the JainE frontend
  // (which only ever sends filter params, not raw ad data). The platform's own verify_jwt gate has
  // already cryptographically verified the token's signature before this code even runs, so reading
  // its role claim here (without re-verifying) is safe - this path just needs to confirm the caller
  // held a real project key, not a logged-in user's session. The real production path below is
  // unaffected and still requires an actual user session.
  const isManualPush = Array.isArray(body.ads);
  let tokenRole = '';
  try { tokenRole = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))).role || ''; } catch (_e) {}
  if (!(isManualPush && (tokenRole === 'anon' || tokenRole === 'service_role'))) {
    const who = await fetch(SB + '/auth/v1/user', { headers: { Authorization: 'Bearer ' + token, apikey: ANON } });
    if (!who.ok) return j({ error: 'unauthorized' }, 401);
  }

  /* HOW MANY COMPETITORS ONE CALL MAY TAKE ON.
     Each competitor is a full browser session on the scraper box - up to two minutes of navigation
     before this function has even seen a byte. Twenty-two of those in one sequential loop does not
     fit in an edge function's lifetime: the call was dying about four competitors in, every night,
     and because replace_stale only runs when a scrape returns something, the other eighteen kept
     their old ads and the screen looked current. Nine days of "fresh" data that was not.
     So a scheduled run takes a BATCH of the least-recently-synced competitors and leaves the rest
     for the next tick; run often enough, every competitor comes round. A human asking for specific
     competitors still gets exactly those, with no cap - that path was never the one timing out. */
  const askedForSpecific = (Array.isArray(body.watchlist_ids) && body.watchlist_ids.length) || body.watchlist_id;
  const maxPerRun = Math.max(1, Math.min(Number(body.max_per_run) || 4, 25));

  let wl: any[] = [];
  if (Array.isArray(body.watchlist_ids) && body.watchlist_ids.length) { const { data } = await db.schema('camp').from('competitor_watchlist').select('*').in('id', body.watchlist_ids); wl = data || []; }
  else if (body.watchlist_id) { const { data } = await db.schema('camp').from('competitor_watchlist').select('*').eq('id', body.watchlist_id); wl = data || []; }
  else {
    // stalest first, and never synced counts as stalest of all
    const { data } = await db.schema('camp').from('competitor_watchlist').select('*').eq('active', true)
      .order('last_sync_at', { ascending: true, nullsFirst: true });
    wl = (data || []).slice(0, maxPerRun);
  }
  if (!wl.length) return j({ ok: true, synced: 0, message: 'No watchlist entries' });

  const { data: allWl } = await db.schema('camp').from('competitor_watchlist').select('id,page_id');
  const byPage = new Map<string, number>();
  (allWl || []).forEach((r: any) => { const p = String(r.page_id || '').trim(); if (p) byPage.set(p, r.id); });

  const activeStatus = ['active', 'inactive', 'all'].includes(body.active_status) ? body.active_status : 'all';
  const mediaType = MEDIA_TYPES.includes(body.media_type) ? body.media_type : 'all';
  const fromStr = body.date_from ? String(body.date_from).slice(0, 10) : null;
  const toStr = body.date_to ? String(body.date_to).slice(0, 10) : null;
  const dateFrom = fromStr ? new Date(fromStr + 'T00:00:00Z') : null;
  const dateTo = toStr ? new Date(toStr + 'T23:59:59Z') : null;
  const resultsLimit = Math.min(Number(body.results_limit) || 300, 300);
  const country = String(body.country || 'IN').toUpperCase().slice(0, 2);
  const replaceStale = body.replace_stale !== false;

  const report: any = { synced: 0, newAds: 0, replaced: 0, mediaFound: 0, mediaMissed: 0, mediaHealed: 0, mediaRepathed: 0, postersSaved: 0, mediaDeleted: 0, skippedWrongPage: 0, refiled: 0, batch: wl.map((w: any) => w.name), remaining: 0, errors: [] as string[], urls: [] as string[] };
  if (!askedForSpecific) {
    const { count } = await db.schema('camp').from('competitor_watchlist').select('id', { count: 'exact', head: true }).eq('active', true);
    report.remaining = Math.max(0, (count || 0) - wl.length);
  }

  async function saveMedia(items: any[], owner: number, id: string) {
    const slice = items.slice(0, 6);
    const out = await pMap(slice, slice.length, async (m: any, i: number) => {
      try {
        const mr = await fetch(m.url); if (!mr.ok) { report.mediaMissed++; return null; }
        const bytes = new Uint8Array(await mr.arrayBuffer());
        const ext = m.type === 'video' ? 'mp4' : 'jpg';
        // s3-sign (the edge function the frontend uses to get a viewable URL back) only recognizes
        // portal/ and legal/ as top-level roots and auto-prefixes anything else with portal/ before
        // signing - so the key actually uploaded to has to carry that same prefix, or the sign step
        // looks for a path that was never written.
        const key = 'portal/competitors/' + owner + '/' + id + '_' + i + '.' + ext;
        if (!(await uploadToS3(key, bytes, m.type === 'video' ? 'video/mp4' : 'image/jpeg'))) { report.mediaMissed++; return null; }
        const entry: any = { s3_path: 's3:' + key, media_type: m.type };
        if (m.type === 'video' && m.poster) {
          try {
            const pr = await fetch(m.poster);
            if (pr.ok) {
              const pb = new Uint8Array(await pr.arrayBuffer());
              const pkey = 'portal/competitors/' + owner + '/' + id + '_' + i + '_poster.jpg';
              if (await uploadToS3(pkey, pb, 'image/jpeg')) { entry.poster = 's3:' + pkey; report.postersSaved++; }
            }
          } catch (_e) {}
        }
        report.mediaFound++;
        return entry;
      } catch (_e) { report.mediaMissed++; return null; }
    });
    return out.filter(Boolean) as any[];
  }

  /* REPAIRING A WRONGLY-ROOTED KEY WITHOUT GOING BACK TO META.
     Early rows were written with a bare key - "s3:competitors/5/x.jpg" - and s3-sign always signs
     portal/<key>, so it looked for portal/competitors/5/x.jpg, which was never written. Those
     thumbnails have been reading "Media unavailable" ever since.
     The heal that existed re-downloaded the picture from Meta, which is why it never fixed
     anything: by the time an ad is seen again its creative URL has usually expired, saveMedia
     returned nothing, and the branch quietly gave up. But the bytes are not missing - they are
     sitting in the bucket under the wrong name. So copy them, server-side, and rewrite the paths.
     Re-downloading stays as the fallback for the genuinely-missing case. */
  async function repathMedia(prev: any) {
    const items: any[] = Array.isArray(prev.media_items) && prev.media_items.length
      ? prev.media_items
      : (prev.media_s3_path ? [{ s3_path: prev.media_s3_path, media_type: prev.media_type }] : []);
    if (!items.length) return null;
    const fixOne = async (p: string | null | undefined) => {
      if (!p) return { ok: true, val: p };
      const key = String(p).replace(/^s3:/, '');
      if (/^(portal|legal)\//.test(key)) return { ok: true, val: p };     // already right
      const dst = 'portal/' + key;
      return (await copyInS3(key, dst)) ? { ok: true, val: 's3:' + dst } : { ok: false, val: p };
    };
    const out: any[] = [];
    for (const m of items) {
      const a = await fixOne(m.s3_path);
      const b = await fixOne(m.poster);
      if (!a.ok || !b.ok) return null;                                    // fall back to re-download
      const e: any = { ...m, s3_path: a.val };
      if (b.val) e.poster = b.val; else delete e.poster;
      out.push(e);
    }
    return out;
  }

  for (const w of wl) {
    const wPage = String(w.page_id || '').trim();
    let scraped: { url: string; ads: any[] };
    if (Array.isArray(body.ads)) {
      // MANUAL PUSH MODE - for testing before the self-hosted scraper has a public address Supabase
      // can reach. The scraping still happens on a real machine (just run by hand right now, not by
      // a button click), and its output is POSTed straight here instead of this function reaching
      // out to fetch it. Everything after this point - S3 upload, the DB write, replace_stale - is
      // identical to the real flow, so this is a genuine end-to-end test, not a shortcut around it.
      scraped = { url: body.url || '', ads: body.ads };
    } else {
      if (!SCRAPER_URL) { report.errors.push(w.name + ': SCRAPER_URL secret is not set and no ads were pushed directly'); continue; }
      try {
        const sr = await fetch(SCRAPER_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-scraper-secret': SCRAPER_SECRET },
          body: JSON.stringify({
            pageId: wPage || undefined, searchTerm: wPage ? undefined : (w.search_term || w.name),
            country, activeStatus, mediaType, dateFrom: fromStr, dateTo: toStr, limit: resultsLimit,
          }),
        });
        if (!sr.ok) { report.errors.push(w.name + ': scraper http ' + sr.status); continue; }
        scraped = await sr.json();
      } catch (e) { report.errors.push(w.name + ': ' + String((e as any)?.message || e).slice(0, 150)); continue; }
    }
    if (report.urls.length < 5) report.urls.push(scraped.url);

    const ids = scraped.ads.map((a: any) => String(a.id)).filter(Boolean);
    const { data: existingRows } = ids.length
      ? await db.schema('camp').from('competitor_ads').select('id,watchlist_id,media_s3_path,media_items,media_type').in('id', ids)
      : { data: [] as any[] };
    const existing = new Map<string, any>();
    (existingRows || []).forEach((r: any) => existing.set(String(r.id), r));

    const seenIds = new Set<string>();
    // Process ads concurrently instead of one at a time - each ad only ever touches its own row
    // (keyed by its unique id), so there's no write collision between them. This is what turns a
    // 100+ ad competitor from "needs several manual re-clicks before it finishes" into one click.
    await pMap(scraped.ads, 15, async (a: any) => {
      const id = String(a.id); if (!id) return;
      if (dateFrom || dateTo) {
        const s = a.start_date ? new Date(a.start_date) : null;
        const e = a.end_date ? new Date(a.end_date) : null;
        if (s && dateTo && s > dateTo) return;
        if (e && dateFrom && e < dateFrom) return;
      }
      let owner = w.id;
      if (a.page_id && byPage.has(a.page_id)) owner = byPage.get(a.page_id)!;
      else if (wPage && a.page_id && a.page_id !== wPage) { report.skippedWrongPage++; return; }
      if (owner === w.id) seenIds.add(id);

      const prev = existing.get(id);
      if (prev) {
        const upd: any = { last_seen_at: new Date().toISOString(), page_name: a.page_name, ad_delivery_stop_time: a.is_active ? null : a.end_date, display_format: a.display_format };
        if (prev.watchlist_id !== owner) { upd.watchlist_id = owner; report.refiled++; }
        const staleMedia = prev.media_s3_path && !/^s3:(portal|legal)\//.test(String(prev.media_s3_path));
        if (staleMedia) {
          // copy within the bucket first; only pay for a re-download if that fails
          const repathed = await repathMedia(prev);
          if (repathed && repathed.length) {
            upd.media_items = repathed; upd.media_s3_path = repathed[0].s3_path; upd.media_type = repathed[0].media_type;
            report.mediaRepathed++;
          } else {
            const mediaItems = await saveMedia(a.media || [], owner, id);
            if (mediaItems.length) {
              upd.media_s3_path = mediaItems[0].s3_path; upd.media_type = mediaItems[0].media_type; upd.media_items = mediaItems;
              report.mediaHealed++;
            }
          }
        }
        await db.schema('camp').from('competitor_ads').update(upd).eq('id', id);
        report.synced++; return;
      }
      const mediaItems = await saveMedia(a.media || [], owner, id);
      const { error } = await db.schema('camp').from('competitor_ads').insert({
        id, watchlist_id: owner, page_id: a.page_id || null, page_name: a.page_name, display_format: a.display_format,
        ad_creative_bodies: a.body_text ? [a.body_text] : null, ad_creative_link_titles: a.headline ? [a.headline] : null,
        headline: a.headline || null, description: a.description || null, country,
        ad_snapshot_url: 'https://www.facebook.com/ads/library/?id=' + id,
        media_s3_path: mediaItems[0]?.s3_path || null, media_type: mediaItems[0]?.media_type || null,
        media_items: mediaItems.length ? mediaItems : null,
        ad_delivery_start_time: a.start_date, ad_delivery_stop_time: a.is_active ? null : a.end_date,
        publisher_platforms: a.publisher_platforms || null, cta_text: a.cta_text || null, redirect_url: a.link_url || null,
      });
      if (error) report.errors.push('save ' + id + ': ' + error.message); else { report.newAds++; report.synced++; }
      if (a.page_id && !wPage && !byPage.has(a.page_id)) {
        try { await db.schema('camp').from('competitor_watchlist').update({ page_id: a.page_id, page_name: a.page_name }).eq('id', w.id); w.page_id = a.page_id; byPage.set(a.page_id, w.id); } catch (_e) {}
      }
    });

    if (replaceStale && scraped.ads.length) {
      const { data: mine } = await db.schema('camp').from('competitor_ads').select('id,media_items,media_s3_path').eq('watchlist_id', w.id);
      const stale = (mine || []).filter((r: any) => !seenIds.has(String(r.id)));
      if (stale.length) {
        const paths: string[] = [];
        stale.forEach((r: any) => {
          (Array.isArray(r.media_items) ? r.media_items : []).forEach((m: any) => { if (m?.s3_path) paths.push(m.s3_path); if (m?.poster) paths.push(m.poster); });
          if (r.media_s3_path) paths.push(r.media_s3_path);
        });
        report.mediaDeleted += await deleteFromS3([...new Set(paths)]);
        const { error: delErr } = await db.schema('camp').from('competitor_ads').delete().in('id', stale.map((r: any) => r.id));
        if (delErr) report.errors.push('cleanup ' + w.name + ': ' + delErr.message); else report.replaced += stale.length;
      }
    }

    /* Stamped whatever happened - success, empty, or scraper error. A competitor that keeps
       failing must not become a permanent queue-jumper that starves the other twenty-one of
       their turn; it goes to the back of the line and its error is in the report either way. */
    try { await db.schema('camp').from('competitor_watchlist').update({ last_sync_at: new Date().toISOString() }).eq('id', w.id); } catch (_e) {}
  }
  return j({ ok: true, ...report });
});
