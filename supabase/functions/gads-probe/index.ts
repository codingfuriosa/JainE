/* OWN ADS (19 Nov 2026, Ayush: "I want to see the ads in Facebook and Google showing in Campaign Analytics ... their data
   won't come from Ads Transparency Center"). The Jain Group Fb Ads and Jain Group Google Ads tabs of Competitor Data show
   OUR OWN ads, read from our own ad accounts - the same ads, spend and results as Campaign Analytics - project by project.
   The slug is historical: the project is at its edge-function limit, and this slot held a one-off probe (switched off
   18 Nov 2026) before it was reused for this.

   Which ads: every ad that delivered (impressions > 0) in the last `days` days (7..180, default 30) in an included ad
   account, with its totals for those days from camp.ads_ad_daily (what Campaign Analytics shows). Then each ad's creative
   is read live:
     Meta    - the ad's creative: its text, headline, description, button, link; pictures (asset feed, link, carousel cards,
               looked up to their permanent links through the account's ad images), and for a video its video id and frame.
     Google  - the ad's headlines, long headlines, descriptions, final URL, button, business name; its images (full size)
               and YouTube videos.
   The answer is kept in storage (campaign-share/own-ads/<platform>-<days>.json) and answered at once; a copy over an hour
   old is refreshed in the background (see the handler). body.refresh = true reads afresh and waits.

   body: { platform: 'meta' | 'google', days?: number, refresh?: boolean }
   WHO MAY CALL: a signed-in JainE staff member (camp.pi_allowed - the same check as ad-reach / ad-video). */
const SB = Deno.env.get('SUPABASE_URL')!, SRV = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, ANON = Deno.env.get('SUPABASE_ANON_KEY') || '';
const ADS = Deno.env.get('META_SYSTEM_USER_TOKEN') || Deno.env.get('META_ACCESS_TOKEN') || '';
const FBV = 'v21.0', GV = 'v24';
const G_DEV = Deno.env.get('GOOGLE_ADS_DEVELOPER_TOKEN') || '', G_CID = Deno.env.get('GOOGLE_ADS_CLIENT_ID') || '';
const G_SEC = Deno.env.get('GOOGLE_ADS_CLIENT_SECRET') || '', G_REFRESH = Deno.env.get('GOOGLE_ADS_REFRESH_TOKEN') || '';
const G_LOGIN = (Deno.env.get('GOOGLE_ADS_LOGIN_CUSTOMER_ID') || '').replace(/\D/g, '');
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
const j = (o: unknown, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } });
const H = { apikey: SRV, Authorization: 'Bearer ' + SRV, 'Accept-Profile': 'camp' };
const num = (v: any) => { const n = Number(v); return isFinite(n) ? n : 0; };
const uniq = (a: any[]) => Array.from(new Set(a.filter((x) => typeof x === 'string' && x.trim()).map((x) => x.trim())));
const CACHE_MS = 7 * 24 * 3600e3, REFRESH_MS = 3600e3, BUCKET = 'campaign-share';

async function allowed(req: Request) {
  // the server's own jobs (and a check run from the database) send the ads job secret instead
  const sec = req.headers.get('x-ads-secret');
  if (sec) {
    const r = await fetch(`${SB}/rest/v1/job_secrets?select=value&name=eq.ads_daily`, { headers: { apikey: SRV, Authorization: 'Bearer ' + SRV, 'Accept-Profile': 'acc' } });
    const d = await r.json().catch(() => []);
    return Array.isArray(d) && d[0] && d[0].value === sec;
  }
  const auth = req.headers.get('Authorization') || '';
  if (!/^Bearer\s+\S+/.test(auth) || !ANON) return false;
  const can = await fetch(`${SB}/rest/v1/rpc/pi_allowed`, { method: 'POST', body: '{}', headers: { apikey: ANON, Authorization: auth, 'Content-Type': 'application/json', 'Content-Profile': 'camp' } });
  return can.ok && (await can.json()) === true;
}
async function rest(path: string) {
  const out: any[] = [];
  for (let p = 0; ; p += 1000) {
    const r = await fetch(`${SB}/rest/v1/${path}`, { headers: { ...H, Range: `${p}-${p + 999}` } });
    if (!r.ok) throw new Error(path.split('?')[0] + ': ' + r.status + ' ' + (await r.text()).slice(0, 200));
    const d = await r.json(); out.push(...d); if (d.length < 1000) break;
  }
  return out;
}
async function cacheGet(key: string) {
  const r = await fetch(`${SB}/storage/v1/object/${BUCKET}/own-ads/${key}.json`, { headers: { apikey: SRV, Authorization: 'Bearer ' + SRV } });
  if (!r.ok) return null;
  const d = await r.json().catch(() => null);
  return d && Date.now() - Date.parse(d.built_at || 0) < CACHE_MS ? d : null;   // a week-old copy is not served at all
}
async function cachePut(key: string, d: any) {
  await fetch(`${SB}/storage/v1/object/${BUCKET}/own-ads/${key}.json`, { method: 'POST',
    headers: { apikey: SRV, Authorization: 'Bearer ' + SRV, 'Content-Type': 'application/json', 'x-upsert': 'true' }, body: JSON.stringify(d) }).catch(() => {});
}

// ---------------------------------------------------------------- the ads and their totals (what Campaign Analytics shows)
async function adList(platform: string, days: number) {
  const since = new Date(Date.now() + 5.5 * 3600e3 - (days - 1) * 864e5).toISOString().slice(0, 10);
  const accs = await rest(`ads_accounts?select=account_id,name,project,include&platform=eq.${platform}`);
  const inc: Record<string, any> = {}; accs.filter((a) => a.include !== false).forEach((a) => { inc[a.account_id] = a; });
  const rows = await rest(`ads_ad_daily?select=ad_id,account_id,campaign_id,adset_id,day,spend,impressions,clicks,results&platform=eq.${platform}&day=gte.${since}&impressions=gt.0`);
  const by: Record<string, any> = {};
  for (const r of rows) {
    if (!inc[r.account_id]) continue;
    const a = by[r.ad_id] || (by[r.ad_id] = { id: String(r.ad_id), account_id: r.account_id, project: inc[r.account_id].project || inc[r.account_id].name || r.account_id,
      campaign_id: r.campaign_id, adset_id: r.adset_id || null, spend: 0, impressions: 0, clicks: 0, results: 0, first_day: r.day, last_day: r.day });
    a.spend += num(r.spend); a.impressions += num(r.impressions); a.clicks += num(r.clicks); a.results += num(r.results);
    if (r.day < a.first_day) a.first_day = r.day; if (r.day > a.last_day) a.last_day = r.day;
    if (!a.adset_id && r.adset_id) a.adset_id = r.adset_id;
  }
  const ads = Object.values(by);
  // names and status
  const ids = new Set<string>(); ads.forEach((a: any) => { ids.add('ad:' + a.id); ids.add('campaign:' + a.campaign_id); if (a.adset_id) ids.add('adset:' + a.adset_id); });
  const ent: Record<string, any> = {};
  const list = Array.from(ids).map((k) => k.split(':')[1]);
  const chunks: string[] = []; for (let i = 0; i < list.length; i += 150) chunks.push(list.slice(i, i + 150).map((x) => '"' + x + '"').join(','));
  await Promise.all(chunks.map(async (chunk) => {
    for (const e of await rest(`ads_entities?select=kind,id,name,status,thumbnail,body&platform=eq.${platform}&id=in.(${chunk})`)) ent[e.kind + ':' + e.id] = e;
  }));
  for (const a of ads as any[]) {
    const e = ent['ad:' + a.id] || {}; a.name = e.name || null; a.status = e.status || null; a.thumb = e.thumbnail || null; a.stored_text = e.body || null;
    a.campaign = (ent['campaign:' + a.campaign_id] || {}).name || null; a.campaign_status = (ent['campaign:' + a.campaign_id] || {}).status || null;
    a.adset = a.adset_id ? (ent['adset:' + a.adset_id] || {}).name || null : null; a.adset_status = a.adset_id ? (ent['adset:' + a.adset_id] || {}).status || null : null;
    a.spend = Math.round(a.spend * 100) / 100;
  }
  return ads as any[];
}

// ---------------------------------------------------------------- Meta
async function fb(url: string) {
  const r = await fetch(url + (url.includes('?') ? '&' : '?') + 'access_token=' + ADS);
  const t = await r.json().catch(() => ({}));
  if (!r.ok || t.error) throw new Error('Meta: ' + ((t.error && t.error.message) || r.status));
  return t;
}
const CR = 'id,object_type,title,body,image_url,image_hash,thumbnail_url,video_id,call_to_action_type,link_url,object_story_spec,asset_feed_spec,effective_object_story_id';
async function metaCreatives(ads: any[], notes: string[]) {
  const info: Record<string, any> = {};
  // in parallel (19 Nov 2026, "faster like 5 sec or lower"): every batch is asked at the same time
  const batches: string[] = []; for (let i = 0; i < ads.length; i += 40) batches.push(ads.slice(i, i + 40).map((a) => a.id).join(','));
  await Promise.all(batches.map(async (ids) => {
    try {
      const t = await fb(`https://graph.facebook.com/${FBV}/?ids=${ids}&fields=effective_status,preview_shareable_link,creative.thumbnail_width(720).thumbnail_height(720){${CR}}`);
      Object.assign(info, t);
    } catch (e) { notes.push(String((e as Error).message || e).slice(0, 200)); }
  }));
  // picture hashes -> their permanent links, account by account
  const hashes: Record<string, Set<string>> = {};
  const addHash = (acc: string, h: any) => { if (h) (hashes[acc] = hashes[acc] || new Set()).add(String(h)); };
  for (const a of ads) {
    const c = (info[a.id] || {}).creative || {}; const s = c.object_story_spec || {}, f = c.asset_feed_spec || {};
    addHash(a.account_id, c.image_hash); addHash(a.account_id, s.link_data && s.link_data.image_hash);
    ((s.link_data && s.link_data.child_attachments) || []).forEach((x: any) => addHash(a.account_id, x.image_hash));
    (f.images || []).forEach((x: any) => addHash(a.account_id, x.hash));
  }
  const hashUrl: Record<string, string> = {};
  const picJobs: Array<[string, string[]]> = [];
  for (const acc of Object.keys(hashes)) { const hs = Array.from(hashes[acc]); for (let i = 0; i < hs.length; i += 50) picJobs.push([acc, hs.slice(i, i + 50)]); }
  await Promise.all(picJobs.map(async ([acc, hs]) => {
    try {
      const t = await fb(`https://graph.facebook.com/${FBV}/act_${acc}/adimages?fields=hash,url,permalink_url&hashes=${encodeURIComponent(JSON.stringify(hs))}`);
      for (const x of t.data || []) hashUrl[x.hash] = x.permalink_url || x.url;
    } catch (e) { notes.push('pictures: ' + String((e as Error).message || e).slice(0, 160)); }
  }));
  for (const a of ads) {
    const it = info[a.id] || {}, c = it.creative || {}, s = c.object_story_spec || {}, f = c.asset_feed_spec || {};
    const ld = s.link_data || {}, vd = s.video_data || {};
    const tx = (l: any) => (l || []).map((x: any) => x && x.text);
    a.status = it.effective_status || a.status;
    a.headlines = uniq([c.title, ld.name, vd.title, ...tx(f.titles)]);
    a.texts = uniq([c.body, ld.message, vd.message, ...tx(f.bodies)]);
    a.descriptions = uniq([ld.description, vd.link_description, ...tx(f.descriptions)]);
    const cta = c.call_to_action_type || (ld.call_to_action && ld.call_to_action.type) || (vd.call_to_action && vd.call_to_action.type) || (f.call_to_action_types || [])[0] || null;
    a.cta = cta ? String(cta).replace(/_/g, ' ').toLowerCase().replace(/^\w/, (m: string) => m.toUpperCase()) : null;
    a.url = c.link_url || ld.link || (vd.call_to_action && vd.call_to_action.value && vd.call_to_action.value.link) || ((f.link_urls || [])[0] || {}).website_url || null;
    const cards = (ld.child_attachments || []).map((x: any) => ({ image: hashUrl[x.image_hash] || x.picture || null, title: x.name || null, text: x.description || null, url: x.link || null }));
    const pics = uniq([hashUrl[c.image_hash], hashUrl[ld.image_hash], ld.picture, ...(f.images || []).map((x: any) => hashUrl[x.hash] || x.url), c.image_url]);
    const vid = c.video_id || vd.video_id || ((f.videos || [])[0] || {}).video_id || null;
    a.cards = cards.length > 1 ? cards : [];
    a.images = pics.length ? pics : (c.thumbnail_url ? [c.thumbnail_url] : (a.thumb ? [a.thumb] : []));
    a.video = vid ? { meta_id: String(vid), frame: vd.image_url || c.thumbnail_url || a.thumb || null } : null;
    a.format = a.video ? 'video' : a.cards.length ? 'carousel' : (f.images || []).length > 1 ? 'dynamic' : 'image';
    a.preview = it.preview_shareable_link || null;
    if (!a.texts.length && a.stored_text) a.texts = [a.stored_text];
  }
  return ads;
}

// ---------------------------------------------------------------- Google
let gTok = '';
async function gToken() {
  if (gTok) return gTok;
  const r = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: G_CID, client_secret: G_SEC, refresh_token: G_REFRESH, grant_type: 'refresh_token' }).toString() });
  const t = await r.json(); if (!t.access_token) throw new Error('Google sign-in failed: ' + (t.error_description || t.error || r.status));
  return (gTok = t.access_token);
}
async function gaql(cust: string, query: string) {
  const at = await gToken(); const rows: any[] = []; let pageToken = '';
  for (let i = 0; i < 40; i++) {
    const body: any = { query }; if (pageToken) body.pageToken = pageToken;
    const r = await fetch(`https://googleads.googleapis.com/${GV}/customers/${cust}/googleAds:search`, { method: 'POST',
      headers: { Authorization: 'Bearer ' + at, 'developer-token': G_DEV, 'login-customer-id': G_LOGIN, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (!r.ok) throw new Error('Google HTTP ' + r.status + ' ' + (await r.text()).replace(/\s+/g, ' ').slice(0, 300));
    const t = await r.json(); rows.push(...(t.results || [])); pageToken = t.nextPageToken || ''; if (!pageToken) break;
  }
  return rows;
}
const P = 'ad_group_ad.ad.';
const G_FIELDS = [P + 'id', P + 'type', P + 'final_urls',
  P + 'responsive_search_ad.headlines', P + 'responsive_search_ad.descriptions', P + 'responsive_search_ad.path1', P + 'responsive_search_ad.path2',
  P + 'responsive_display_ad.headlines', P + 'responsive_display_ad.long_headline', P + 'responsive_display_ad.descriptions', P + 'responsive_display_ad.marketing_images',
  P + 'responsive_display_ad.square_marketing_images', P + 'responsive_display_ad.business_name', P + 'responsive_display_ad.call_to_action_text', P + 'responsive_display_ad.youtube_videos',
  P + 'demand_gen_multi_asset_ad.headlines', P + 'demand_gen_multi_asset_ad.descriptions', P + 'demand_gen_multi_asset_ad.marketing_images', P + 'demand_gen_multi_asset_ad.square_marketing_images',
  P + 'demand_gen_multi_asset_ad.portrait_marketing_images', P + 'demand_gen_multi_asset_ad.business_name', P + 'demand_gen_multi_asset_ad.call_to_action_text',
  P + 'demand_gen_video_responsive_ad.headlines', P + 'demand_gen_video_responsive_ad.long_headlines', P + 'demand_gen_video_responsive_ad.descriptions', P + 'demand_gen_video_responsive_ad.videos',
  P + 'demand_gen_video_responsive_ad.business_name', P + 'demand_gen_video_responsive_ad.call_to_actions',
  P + 'video_responsive_ad.headlines', P + 'video_responsive_ad.long_headlines', P + 'video_responsive_ad.descriptions', P + 'video_responsive_ad.videos', P + 'video_responsive_ad.call_to_actions',
  P + 'image_ad.image_url', P + 'video_ad.video.asset', 'ad_group_ad.status'];
// the fields Campaign Analytics' own reader already uses - the fallback if Google refuses one of the above
const G_BASIC = [P + 'id', P + 'type', P + 'final_urls', P + 'responsive_search_ad.headlines', P + 'responsive_search_ad.descriptions',
  P + 'responsive_display_ad.headlines', P + 'responsive_display_ad.descriptions', P + 'responsive_display_ad.marketing_images', P + 'responsive_display_ad.square_marketing_images',
  P + 'demand_gen_multi_asset_ad.headlines', P + 'demand_gen_multi_asset_ad.descriptions', P + 'demand_gen_multi_asset_ad.marketing_images', P + 'demand_gen_multi_asset_ad.square_marketing_images',
  P + 'demand_gen_multi_asset_ad.portrait_marketing_images', P + 'demand_gen_video_responsive_ad.headlines', P + 'demand_gen_video_responsive_ad.descriptions', P + 'demand_gen_video_responsive_ad.videos', 'ad_group_ad.status'];
async function googleCreatives(ads: any[], notes: string[]) {
  const byAcc: Record<string, any[]> = {}; ads.forEach((a) => { (byAcc[a.account_id] = byAcc[a.account_id] || []).push(a); });
  await gToken();   // one sign-in shared by the accounts below, which are all read at the same time
  await Promise.all(Object.keys(byAcc).map(async (acc) => {
    const list = byAcc[acc], want: Record<string, any> = {}; list.forEach((a) => { want[a.id] = a; });
    let rows: any[] = [];
    const where = ` FROM ad_group_ad WHERE ad_group_ad.ad.id IN (${list.map((a) => a.id).join(',')})`;
    try { rows = await gaql(acc, 'SELECT ' + G_FIELDS.join(', ') + where); }
    catch (e) {
      notes.push((list[0].project || acc) + ': full read refused, basic read used - ' + String((e as Error).message || e).slice(0, 220));
      try { rows = await gaql(acc, 'SELECT ' + G_BASIC.join(', ') + where); } catch (e2) { notes.push((list[0].project || acc) + ': ' + String((e2 as Error).message || e2).slice(0, 200)); return; }
    }
    const assets: Record<string, boolean> = {};
    const txt = (l: any) => (l || []).map((y: any) => y && y.text);
    const ref = (l: any) => (l || []).map((y: any) => y && y.asset).filter(Boolean);
    const got: Record<string, any> = {};
    for (const x of rows) {
      const ad = (x.adGroupAd && x.adGroupAd.ad) || {}; const id = String(ad.id || ''); if (!want[id] || got[id]) continue;
      const rsa = ad.responsiveSearchAd || {}, rda = ad.responsiveDisplayAd || {}, dgm = ad.demandGenMultiAssetAd || {}, dgv = ad.demandGenVideoResponsiveAd || {}, vra = ad.videoResponsiveAd || {};
      const imgs = [...ref(rda.marketingImages), ...ref(rda.squareMarketingImages), ...ref(dgm.marketingImages), ...ref(dgm.squareMarketingImages), ...ref(dgm.portraitMarketingImages)];
      const vids = [...ref(dgv.videos), ...ref(vra.videos), ...ref(rda.youtubeVideos), ...(ad.videoAd && ad.videoAd.video && ad.videoAd.video.asset ? [ad.videoAd.video.asset] : [])];
      imgs.concat(vids).forEach((r: string) => { assets[r] = true; });
      got[id] = { type: ad.type || null, urls: ad.finalUrls || [], imgs, vids, image_url: ad.imageAd && ad.imageAd.imageUrl,
        headlines: uniq([...txt(rsa.headlines), ...txt(rda.headlines), ...txt(dgm.headlines), ...txt(dgv.headlines), ...txt(vra.headlines)]),
        long: uniq([rda.longHeadline && rda.longHeadline.text, ...txt(dgv.longHeadlines), ...txt(vra.longHeadlines)]),
        desc: uniq([...txt(rsa.descriptions), ...txt(rda.descriptions), ...txt(dgm.descriptions), ...txt(dgv.descriptions), ...txt(vra.descriptions)]),
        biz: (rda.businessName || dgm.businessName || (dgv.businessName && dgv.businessName.text) || null),
        cta: rda.callToActionText || dgm.callToActionText || txt(dgv.callToActions)[0] || txt(vra.callToActions)[0] || null,
        path: [rsa.path1, rsa.path2].filter(Boolean).join('/') };
    }
    const aurl: Record<string, any> = {};
    const names = Object.keys(assets);
    for (let i = 0; i < names.length; i += 200) {
      try {
        const a = await gaql(acc, "SELECT asset.resource_name, asset.image_asset.full_size.url, asset.youtube_video_asset.youtube_video_id, asset.youtube_video_asset.youtube_video_title FROM asset WHERE asset.resource_name IN ("
          + names.slice(i, i + 200).map((n) => "'" + n + "'").join(',') + ')');
        for (const r of a) { const s = r.asset || {};
          aurl[s.resourceName] = { img: s.imageAsset && s.imageAsset.fullSize && s.imageAsset.fullSize.url, yt: s.youtubeVideoAsset && s.youtubeVideoAsset.youtubeVideoId, title: s.youtubeVideoAsset && s.youtubeVideoAsset.youtubeVideoTitle }; }
      } catch (e) { notes.push((list[0].project || acc) + ' pictures: ' + String((e as Error).message || e).slice(0, 160)); }
    }
    for (const a of list) {
      const g = got[a.id];
      if (!g) { a.headlines = []; a.texts = a.stored_text ? [a.stored_text] : []; a.images = a.thumb ? [a.thumb] : []; a.format = 'text'; continue; }
      const yts = uniq(g.vids.map((r: string) => aurl[r] && aurl[r].yt));
      a.headlines = g.headlines; a.long_headlines = g.long; a.texts = g.desc; a.descriptions = [];
      a.cta = g.cta; a.business = g.biz; a.url = g.urls[0] || null; a.path = g.path || null;
      a.images = uniq([g.image_url, ...g.imgs.map((r: string) => aurl[r] && aurl[r].img)]);
      a.videos = yts.map((y: string) => ({ youtube: y, frame: 'https://i.ytimg.com/vi/' + y + '/hqdefault.jpg' }));
      a.video = a.videos[0] || null;
      if (!a.images.length && a.video) a.images = [];
      const t = String(g.type || '');
      a.type = t;
      a.format = a.video ? 'video' : /SEARCH/.test(t) ? 'search' : a.images.length ? 'image' : 'text';
    }
  }));
  return ads;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (!(await allowed(req))) return j({ error: 'not allowed' }, 401);
  let body: any = {}; try { body = await req.json(); } catch (_) { /* empty */ }
  const platform = body.platform === 'google' ? 'google' : 'meta';
  const days = Math.max(7, Math.min(180, Math.round(Number(body.days) || 30)));
  const key = platform + '-' + days;
  const build = async () => {
    const notes: string[] = [];
    let ads = await adList(platform, days);
    ads = platform === 'meta' ? await metaCreatives(ads, notes) : await googleCreatives(ads, notes);
    ads.forEach((a) => { delete a.stored_text; delete a.thumb; });
    ads.sort((x, y) => y.spend - x.spend);
    const out = { ok: true, platform, days, built_at: new Date().toISOString(), notes, ads };
    await cachePut(key, out);
    return out;
  };
  try {
    /* ALWAYS AT ONCE (19 Nov 2026, Ayush: "it should be pre-loaded, its loading takes so much time"). A fresh read takes
       11-16 s, so the last saved copy is answered straight away whatever its age, and when it is over an hour old a fresh
       read is started in the background for the next visit. Only the very first visit for a period waits. */
    if (!body.refresh) {
      const c = await cacheGet(key);
      if (c) {
        if (Date.now() - Date.parse(c.built_at || 0) > REFRESH_MS) {
          try { (globalThis as any).EdgeRuntime?.waitUntil?.(build().catch(() => {})); } catch (_) { /* best effort */ }
        }
        return j({ ...c, cached: true });
      }
    }
    return j(await build());
  } catch (e) {
    return j({ ok: false, error: String((e as Error).message || e).slice(0, 400) }, 500);
  }
});
