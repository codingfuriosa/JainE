// ads-daily-sync - Our Brand's Facebook and Google ad results, BY DAY, on the server (30 Oct 2026).
//
// Replaces two feeds that showed wrong numbers: Facebook rows written by a script on the office PC
// (stopped 12 Oct 2026) and google-ads-live, which ran only when somebody opened the page. Both
// stored one total per named period and never removed old rows, so periods mixed in stale months.
//
// WHAT A RUN DOES ({platform:'meta'|'google'}; the cron calls both every 3 hours):
//   for every included account (camp.ads_accounts), stalest first, as far as ~115 s allows (the
//   rest are first in line next run; Facebook runs hourly, Google every 3 hours):
//     1. the recent days again - Facebook the last 7 days, Google the last 30 (both platforms keep
//        revising recent days as late conversions are attributed), today included
//     2. one older chunk of history (Facebook 30 days, Google 60, read backwards) until 13 months
//        are held
//   Each read REPLACES the account's rows for exactly those days (delete, then insert), so a day
//   holds what the platform reports for it now and nothing else. Campaign and ad names, status,
//   budget, and the ad's picture / text are refreshed alongside.
//   results = Facebook: Ads Manager's "Results" column, whatever its kind (see fbResult - since
//             3 Nov 2026; before that form leads only). Never the sum of every
//             lead-like action - those overlap and double count.
//             Google conversions: metrics.conversions, Google's own "Conversions" column.
//   Facebook uses the account's own attribution setting (use_unified_attribution_setting), the
//   same numbers Ads Manager shows. Dates are the account's own time zone (Asia/Kolkata).
//
// WHO MAY CALL: the cron (x-ads-secret = acc.job_secrets 'ads_daily'), or a signed-in staff member.
// SECRETS: Facebook - META_SYSTEM_USER_TOKEN (a Business Manager system-user token with ads_read on
// the accounts), falling back to META_ACCESS_TOKEN. Google - the GOOGLE_ADS_* secrets that
// google-ads-live already uses.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.47.10";

const SB = Deno.env.get('SUPABASE_URL')!, SRV = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, ANON = Deno.env.get('SUPABASE_ANON_KEY') || '';
const db = createClient(SB, SRV, { db: { schema: 'camp' } });
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-ads-secret', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
const j = (o: unknown, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } });

const META_TOKEN = Deno.env.get('META_SYSTEM_USER_TOKEN') || Deno.env.get('META_ACCESS_TOKEN') || '';
const GV = 'v24', FBV = 'v21.0';
const G_DEV = Deno.env.get('GOOGLE_ADS_DEVELOPER_TOKEN') || '', G_CID = Deno.env.get('GOOGLE_ADS_CLIENT_ID') || '';
const G_SEC = Deno.env.get('GOOGLE_ADS_CLIENT_SECRET') || '', G_REFRESH = Deno.env.get('GOOGLE_ADS_REFRESH_TOKEN') || '';
const G_LOGIN = (Deno.env.get('GOOGLE_ADS_LOGIN_CUSTOMER_ID') || '').replace(/\D/g, '');
const G_CUSTS = (Deno.env.get('GOOGLE_ADS_CUSTOMER_IDS') || '').split(/[^0-9]+/).filter((s) => s.length >= 8);

// Meta keeps crediting leads and chats to the day of the ad for up to 28 days (3 Nov 2026: days
// 8-28 days old were found behind Ads Manager), so the last 28 days are read again - for Facebook
// every 3 hours, the last 3 days every run (see fbFullDue).
const RECENT = { meta: 28, google: 30 } as Record<string, number>;
const CHUNK = { meta: 30, google: 60 } as Record<string, number>, HISTORY = 395;   // history read per run, back to ~13 months
let T0 = Date.now();
const left = () => 115_000 - (Date.now() - T0);   // the platform stops a run at 150 s
const ist = () => new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);
const addD = (d: string, n: number) => new Date(Date.parse(d + 'T00:00:00Z') + n * 86400_000).toISOString().slice(0, 10);
const num = (v: any) => { const n = Number(v); return isFinite(n) ? n : 0; };

async function replaceDays(table: string, platform: string, account: string, s: string, e: string, rows: any[], conflict: string) {
  const { error: de } = await db.from(table).delete().eq('platform', platform).eq('account_id', account).gte('day', s).lte('day', e);
  if (de) throw new Error(table + ' delete: ' + de.message);
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await db.from(table).upsert(rows.slice(i, i + 500), { onConflict: conflict });
    if (error) throw new Error(table + ' write: ' + error.message);
  }
}
/* AD SETS / AD GROUPS (6 Nov 2026, for Campaign Analytics' project > platform > campaign > ad set
   drill-down). Each ad's row carries its ad set (Facebook) or ad group (Google), and their names are
   kept as entities of kind 'adset'. Both need the adset_id column and the 'adset' kind (migration
   20261106200000); until that is in, they are simply not sent, so this can never stop a run. */
let HAS_ADSET: boolean | null = null;
async function hasAdset() {
  if (HAS_ADSET === null) { const { error } = await db.from('ads_ad_daily').select('adset_id').limit(1); HAS_ADSET = !error; }
  return HAS_ADSET;
}
async function upsertEntities(rows: any[]) {
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await db.from('ads_entities').upsert(rows.slice(i, i + 500), { onConflict: 'platform,kind,id' });
    if (error) throw new Error('ads_entities write: ' + error.message);
  }
}

// ---------------------------------------------------------------- Facebook (Graph API)
async function fbAll(url: string) {
  const out: any[] = []; let next: string | null = url;
  for (let i = 0; next && i < 60; i++) {
    const r = await fetch(next); const t = await r.json().catch(() => ({}));
    if (!r.ok || t.error) throw new Error('Meta: ' + ((t.error && (t.error.message + (t.error.code ? ' (code ' + t.error.code + ')' : ''))) || 'HTTP ' + r.status));
    out.push(...(t.data || [])); next = t.paging && t.paging.next ? t.paging.next : null;
  }
  return out;
}
function fbLeads(actions: any) {
  if (!Array.isArray(actions)) return 0;
  const f = (t: string) => { const a = actions.find((x: any) => x && x.action_type === t); return a ? num(a.value) : null; };
  const lead = f('lead'); if (lead !== null) return lead;
  const grouped = f('onsite_conversion.lead_grouped'); return grouped !== null ? grouped : 0;
}
/* RESULTS AS ADS MANAGER SHOWS THEM (3 Nov 2026, as asked: "the Results is equal to the Leads in
   JainE"). A WhatsApp lead campaign's Results column in Ads Manager is its WhatsApp chats started
   (Gurukul, 2 Nov: 14), which a form-lead count showed as 0. Meta's own `results` figure is read and
   kept whatever its kind - leads, chats started, ThruPlays (Eco City Awareness), post engagement -
   because Ads Manager's Results column shows them all (3 Nov, as asked: "some Campaign's results are
   not being taken"). If Meta will not give `results` (older API), it is worked out from the
   actions: form lead, else instant-form lead, else chats started. */
let fbHasResults = true;
function fbResult(r: any) {
  const res = Array.isArray(r.results) ? r.results : null;
  if (res) {
    let n = 0, hit = false;
    for (const x of res) {
      if (!x) continue;
      const v = (x.values || []).find((y: any) => !y.attribution_windows || y.attribution_windows.includes('default')) || (x.values || [])[0];
      if (v) { n += num(v.value); hit = true; }
    }
    if (hit) return n;
    if (res.length) return 0;          // Meta says "not available" for that day: no results
  }
  const l = fbLeads(r.actions); if (l) return l;
  const a = Array.isArray(r.actions) ? r.actions.find((x: any) => x && x.action_type === 'onsite_conversion.messaging_conversation_started_7d') : null;
  return a ? num(a.value) : 0;
}
async function fbInsights(base: string, fields: string) {
  if (fbHasResults) {
    try { return await fbAll(base + '&fields=' + fields + ',results'); }
    catch (e) { if (!/results|\(#100\)|code 100/i.test(String((e as Error).message))) throw e; fbHasResults = false; console.log('meta: no results field - ' + String((e as Error).message).slice(0, 160)); }
  }
  return await fbAll(base + '&fields=' + fields);
}
// Whether an account's days 4-28 back are due a fresh read: any of them last read over 3 hours ago.
async function fbFullDue(acc: string, today: string) {
  const { data } = await db.from('ads_daily').select('day').eq('platform', 'meta').eq('account_id', acc)
    .gte('day', addD(today, -(RECENT.meta - 1))).lte('day', addD(today, -3)).lt('synced_at', new Date(Date.now() - 3 * 3600_000).toISOString()).limit(1);
  return !!(data && data.length);
}
// Names, status, budgets and pictures: once an hour per account is plenty.
async function fbEntitiesDue(acc: string) {
  const { data } = await db.from('ads_entities').select('updated_at').eq('platform', 'meta').eq('account_id', acc).order('updated_at', { ascending: false }).limit(1);
  return !(data && data[0] && Date.parse(data[0].updated_at) > Date.now() - 3600_000);
}
// The same read in 10-day pieces, newest first - a month of every ad by day is too heavy for Meta
// on the bigger accounts.
async function fbReadPieces(acc: string, s: string, e: string) {
  let n = 0;
  for (let to = e; to >= s; ) { const from = addD(to, -9) < s ? s : addD(to, -9); n += await fbRead(acc, from, to); to = addD(from, -1); }
  return n;
}
/* CHECK AGAINST META ({platform:'meta', verify:{from,to,account?}}; 3 Nov 2026). Reads every
   campaign's every day afresh from Meta and compares it with what JainE holds - spend, impressions,
   clicks and results. Changes nothing; returns each day that differs. */
async function fbVerify(from: string, to: string, only?: string) {
  const { data: accs } = await db.from('ads_accounts').select('account_id,project').eq('platform', 'meta').eq('include', true);
  const out: any[] = []; let checked = 0; const done: string[] = [];
  for (const a of accs || []) {
    if (only && a.account_id !== only) continue;
    if (left() < 25_000) { out.push({ project: a.project, note: 'not checked - out of time' }); continue; }
    const meta: Record<string, any> = {};
    for (let e = to; e >= from; ) {
      const s = addD(e, -9) < from ? from : addD(e, -9);
      const base = `https://graph.facebook.com/${FBV}/act_${a.account_id}/insights?time_increment=1&use_unified_attribution_setting=true&limit=500`
        + `&time_range=${encodeURIComponent(JSON.stringify({ since: s, until: e }))}&access_token=${META_TOKEN}&level=campaign`;
      for (const r of await fbInsights(base, 'campaign_id,spend,impressions,clicks,actions'))
        meta[r.campaign_id + '|' + r.date_start] = { spend: num(r.spend), impressions: num(r.impressions), clicks: num(r.clicks), results: fbResult(r) };
      e = addD(s, -1);
    }
    const mine: Record<string, any> = {};
    for (let p = 0; ; p += 1000) {
      const { data } = await db.from('ads_daily').select('campaign_id,day,spend,impressions,clicks,results').eq('platform', 'meta').eq('account_id', a.account_id).gte('day', from).lte('day', to).range(p, p + 999);
      for (const r of data || []) mine[r.campaign_id + '|' + r.day] = r;
      if (!data || data.length < 1000) break;
    }
    for (const k of new Set([...Object.keys(meta), ...Object.keys(mine)])) {
      const m = meta[k] || { spend: 0, impressions: 0, clicks: 0, results: 0 }, j0 = mine[k] || { spend: 0, impressions: 0, clicks: 0, results: 0 };
      checked++;
      const d: any = {};
      for (const f of ['spend', 'impressions', 'clicks', 'results']) if (Math.abs(num(m[f]) - num(j0[f])) > 0.005) d[f] = { meta: num(m[f]), jaine: num(j0[f]) };
      if (Object.keys(d).length) out.push({ project: a.project, campaign: k.split('|')[0], day: k.split('|')[1], ...d });
    }
    done.push(a.project);
  }
  return { checked, done, mismatches: out.length, rows: out.slice(0, 300) };
}
async function fbRead(acc: string, s: string, e: string) {
  const base = `https://graph.facebook.com/${FBV}/act_${acc}/insights?time_increment=1&use_unified_attribution_setting=true&limit=500`
    + `&time_range=${encodeURIComponent(JSON.stringify({ since: s, until: e }))}&access_token=${META_TOKEN}`;
  const camp = await fbInsights(base + '&level=campaign', 'campaign_id,spend,impressions,clicks,actions');
  const ads = await fbInsights(base + '&level=ad', 'ad_id,adset_id,campaign_id,spend,impressions,clicks,actions');
  const withSet = await hasAdset();
  const now = new Date().toISOString();
  const cRows = camp.filter((r) => r.campaign_id && r.date_start).map((r) => ({ platform: 'meta', account_id: acc, campaign_id: r.campaign_id, day: r.date_start,
    spend: num(r.spend), impressions: num(r.impressions), clicks: num(r.clicks), results: fbResult(r), synced_at: now }));
  const aRows = ads.filter((r) => r.ad_id && r.date_start).map((r) => ({ platform: 'meta', account_id: acc, campaign_id: r.campaign_id || null, ad_id: r.ad_id, day: r.date_start,
    ...(withSet ? { adset_id: r.adset_id || null } : {}),
    spend: num(r.spend), impressions: num(r.impressions), clicks: num(r.clicks), results: fbResult(r), synced_at: now }));
  await replaceDays('ads_daily', 'meta', acc, s, e, cRows, 'platform,campaign_id,day');
  await replaceDays('ads_ad_daily', 'meta', acc, s, e, aRows, 'platform,ad_id,day');
  return cRows.length + aRows.length;
}
async function fbEntities(acc: string) {
  const tok = `&access_token=${META_TOKEN}`;
  const now = new Date().toISOString();
  const camps = await fbAll(`https://graph.facebook.com/${FBV}/act_${acc}/campaigns?fields=id,name,effective_status,objective,daily_budget,lifetime_budget&limit=500${tok}`);
  // A campaign without its own budget spends its ad sets' budgets: add up the running ones.
  const sets = await fbAll(`https://graph.facebook.com/${FBV}/act_${acc}/adsets?fields=id,name,campaign_id,daily_budget,lifetime_budget,effective_status&limit=500${tok}`);
  const sd: Record<string, number> = {}, sl: Record<string, number> = {};
  for (const a of sets) {
    if (String(a.effective_status || '') !== 'ACTIVE') continue;
    if (a.daily_budget != null) sd[a.campaign_id] = (sd[a.campaign_id] || 0) + num(a.daily_budget);
    if (a.lifetime_budget != null && num(a.lifetime_budget) > 0) sl[a.campaign_id] = (sl[a.campaign_id] || 0) + num(a.lifetime_budget);
  }
  const rows: any[] = camps.map((c) => ({ platform: 'meta', kind: 'campaign', id: c.id, account_id: acc, campaign_id: c.id, name: c.name, status: c.effective_status || null, objective: c.objective || null,
    daily_budget: c.daily_budget != null ? num(c.daily_budget) / 100 : (sd[c.id] != null ? sd[c.id] / 100 : null),
    lifetime_budget: c.lifetime_budget != null && num(c.lifetime_budget) > 0 ? num(c.lifetime_budget) / 100 : (sl[c.id] != null ? sl[c.id] / 100 : null), updated_at: now }));
  if (await hasAdset()) for (const a of sets) rows.push({ platform: 'meta', kind: 'adset', id: a.id, account_id: acc, campaign_id: a.campaign_id || null, name: a.name || null,
    status: a.effective_status || null, daily_budget: a.daily_budget != null ? num(a.daily_budget) / 100 : null,
    lifetime_budget: a.lifetime_budget != null && num(a.lifetime_budget) > 0 ? num(a.lifetime_budget) / 100 : null, updated_at: now });
  // The picture size has to be asked for on the creative itself (a size on the ads edge is ignored,
  // and Meta then sends a 64 x 64 thumbnail that looks blurred on the card). image_url is the
  // full-size picture of an image ad; videos and carousels have none, so their 640 px frame is used.
  const ads = await fbAll(`https://graph.facebook.com/${FBV}/act_${acc}/ads?fields=id,name,campaign_id,effective_status,creative.thumbnail_width(640).thumbnail_height(640){thumbnail_url,image_url,body,title}&limit=200${tok}`);
  for (const a of ads) {
    const cr = a.creative || {};
    rows.push({ platform: 'meta', kind: 'ad', id: a.id, account_id: acc, campaign_id: a.campaign_id || null, name: a.name, status: a.effective_status || null,
      thumbnail: cr.image_url || cr.thumbnail_url || null, body: [cr.title, cr.body].filter(Boolean).join(' - ') || null, updated_at: now });
  }
  await upsertEntities(rows);
}

// ---------------------------------------------------------------- Google (Google Ads API)
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
  for (let i = 0; i < 60; i++) {
    const body: any = { query }; if (pageToken) body.pageToken = pageToken;
    const r = await fetch(`https://googleads.googleapis.com/${GV}/customers/${cust}/googleAds:search`, { method: 'POST',
      headers: { Authorization: 'Bearer ' + at, 'developer-token': G_DEV, 'login-customer-id': G_LOGIN, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (!r.ok) throw new Error('Google HTTP ' + r.status + ' ' + (await r.text()).replace(/\s+/g, ' ').slice(0, 300));
    const t = await r.json(); rows.push(...(t.results || [])); pageToken = t.nextPageToken || ''; if (!pageToken) break;
  }
  return rows;
}
function gAdText(x: any) {
  const ad = (x.adGroupAd && x.adGroupAd.ad) || {};
  const h = (ad.responsiveSearchAd && ad.responsiveSearchAd.headlines) || (ad.responsiveDisplayAd && ad.responsiveDisplayAd.headlines) || [];
  return h.slice(0, 3).map((y: any) => y.text).filter(Boolean).join(' | ') || null;
}
async function gRead(cust: string, s: string, e: string) {
  const clause = `segments.date BETWEEN '${s}' AND '${e}'`;
  const now = new Date().toISOString();
  const camp = await gaql(cust, `SELECT segments.date, campaign.id, metrics.cost_micros, metrics.impressions, metrics.clicks, metrics.conversions FROM campaign WHERE ${clause}`);
  const ads = await gaql(cust, `SELECT segments.date, ad_group_ad.ad.id, ad_group.id, campaign.id, metrics.cost_micros, metrics.impressions, metrics.clicks, metrics.conversions FROM ad_group_ad WHERE ${clause}`);
  const withSet = await hasAdset();
  const cRows = camp.map((x) => ({ platform: 'google', account_id: cust, campaign_id: String(x.campaign.id), day: x.segments.date,
    spend: num(x.metrics.costMicros) / 1e6, impressions: num(x.metrics.impressions), clicks: num(x.metrics.clicks), results: num(x.metrics.conversions), synced_at: now }));
  const aRows = ads.map((x) => ({ platform: 'google', account_id: cust, campaign_id: String(x.campaign.id), ad_id: String(x.adGroupAd.ad.id), day: x.segments.date,
    ...(withSet ? { adset_id: x.adGroup && x.adGroup.id != null ? String(x.adGroup.id) : null } : {}),
    spend: num(x.metrics.costMicros) / 1e6, impressions: num(x.metrics.impressions), clicks: num(x.metrics.clicks), results: num(x.metrics.conversions), synced_at: now }));
  // An ad can sit in more than one ad group; one row per ad and day, added together.
  const merged: Record<string, any> = {};
  for (const r of aRows) { const k = r.ad_id + '|' + r.day; const m = merged[k]; if (!m) merged[k] = r; else { m.spend += r.spend; m.impressions += r.impressions; m.clicks += r.clicks; m.results += r.results; } }
  await replaceDays('ads_daily', 'google', cust, s, e, cRows, 'platform,campaign_id,day');
  await replaceDays('ads_ad_daily', 'google', cust, s, e, Object.values(merged), 'platform,ad_id,day');
  return cRows.length + aRows.length;
}
async function gEntities(cust: string) {
  const now = new Date().toISOString();
  const info = await gaql(cust, 'SELECT customer.descriptive_name, customer.currency_code FROM customer LIMIT 1');
  const c0 = (info[0] && info[0].customer) || {};
  await db.from('ads_accounts').update({ name: c0.descriptiveName || null, currency: c0.currencyCode || null }).eq('platform', 'google').eq('account_id', cust);
  const camps = await gaql(cust, 'SELECT campaign.id, campaign.name, campaign.status, campaign.advertising_channel_type, campaign_budget.amount_micros, campaign_budget.period FROM campaign');
  const rows: any[] = camps.map((x) => { const c = x.campaign || {}, b = x.campaignBudget || {}; const amt = b.amountMicros != null ? num(b.amountMicros) / 1e6 : null;
    const daily = String(b.period || 'DAILY') === 'DAILY';
    return { platform: 'google', kind: 'campaign', id: String(c.id), account_id: cust, campaign_id: String(c.id), name: c.name, status: c.status || null, objective: c.advertisingChannelType || null,
      daily_budget: daily ? amt : null, lifetime_budget: daily ? null : amt, updated_at: now }; });
  if (await hasAdset()) {
    const groups = await gaql(cust, "SELECT ad_group.id, ad_group.name, ad_group.status, campaign.id FROM ad_group WHERE ad_group.status != 'REMOVED'");
    for (const x of groups) { const g = x.adGroup || {}; if (g.id == null) continue;
      rows.push({ platform: 'google', kind: 'adset', id: String(g.id), account_id: cust, campaign_id: String((x.campaign || {}).id || ''), name: g.name || null, status: g.status || null, updated_at: now }); }
  }
  const ads = await gaql(cust, "SELECT ad_group_ad.ad.id, ad_group_ad.ad.name, ad_group_ad.ad.type, ad_group_ad.ad.responsive_search_ad.headlines, ad_group_ad.ad.responsive_display_ad.headlines, ad_group_ad.status, campaign.id FROM ad_group_ad WHERE ad_group_ad.status != 'REMOVED'");
  const seen: Record<string, boolean> = {};
  let look: Record<string, { pic: string | null, txt: string | null }> = {};
  try { look = await gCreatives(cust); } catch (e) { console.log('google creatives ' + cust + ': ' + String((e as Error).message || e).slice(0, 200)); }
  for (const x of ads) {
    const ad = (x.adGroupAd && x.adGroupAd.ad) || {}; const id = String(ad.id || ''); if (!id || seen[id]) continue; seen[id] = true;
    const lk = look[id] || { pic: null, txt: null };
    const txt = lk.txt || gAdText(x);
    rows.push({ platform: 'google', kind: 'ad', id, account_id: cust, campaign_id: String((x.campaign || {}).id || ''), name: ad.name || gAdText(x) || String(ad.type || 'Ad').replace(/_/g, ' ').toLowerCase(),
      status: (x.adGroupAd && x.adGroupAd.status) || null, objective: ad.type || null, body: txt, thumbnail: lk.pic, updated_at: now });
  }
  await upsertEntities(rows);
}
// Each ad's picture and words as Google shows them: headlines, then the first description on a new
// line; the picture is the ad's first image, or its first YouTube video's frame. Read apart from the
// names above, so a failure here leaves names, status and budget still refreshed.
async function gCreatives(cust: string) {
  const ads = await gaql(cust, "SELECT ad_group_ad.ad.id, ad_group_ad.ad.responsive_search_ad.headlines, ad_group_ad.ad.responsive_search_ad.descriptions, "
    + "ad_group_ad.ad.responsive_display_ad.headlines, ad_group_ad.ad.responsive_display_ad.descriptions, ad_group_ad.ad.responsive_display_ad.marketing_images, ad_group_ad.ad.responsive_display_ad.square_marketing_images, "
    + "ad_group_ad.ad.demand_gen_multi_asset_ad.headlines, ad_group_ad.ad.demand_gen_multi_asset_ad.descriptions, ad_group_ad.ad.demand_gen_multi_asset_ad.marketing_images, ad_group_ad.ad.demand_gen_multi_asset_ad.square_marketing_images, ad_group_ad.ad.demand_gen_multi_asset_ad.portrait_marketing_images, "
    + "ad_group_ad.ad.demand_gen_video_responsive_ad.headlines, ad_group_ad.ad.demand_gen_video_responsive_ad.descriptions, ad_group_ad.ad.demand_gen_video_responsive_ad.videos "
    + "FROM ad_group_ad WHERE ad_group_ad.status != 'REMOVED'");
  const want: Record<string, { img: string[], vid: string[], txt: string | null }> = {}; const assets: Record<string, boolean> = {};
  const texts = (l: any) => (l || []).map((y: any) => y && y.text).filter(Boolean);
  const refs = (l: any) => (l || []).map((y: any) => y && y.asset).filter(Boolean);
  for (const x of ads) {
    const ad = (x.adGroupAd && x.adGroupAd.ad) || {}; const id = String(ad.id || ''); if (!id || want[id]) continue;
    const p = ad.responsiveSearchAd || ad.responsiveDisplayAd || ad.demandGenMultiAssetAd || ad.demandGenVideoResponsiveAd || {};
    const head = texts(p.headlines).slice(0, 3).join(' | '), desc = texts(p.descriptions)[0] || '';
    const img = refs(p.marketingImages).concat(refs(p.squareMarketingImages), refs(p.portraitMarketingImages)), vid = refs(p.videos);
    img.concat(vid).forEach((r: string) => { assets[r] = true; });
    want[id] = { img, vid, txt: [head, desc].filter(Boolean).join('\n') || null };
  }
  const url: Record<string, string> = {};
  if (Object.keys(assets).length) {
    const a = await gaql(cust, "SELECT asset.resource_name, asset.image_asset.full_size.url, asset.youtube_video_asset.youtube_video_id FROM asset WHERE asset.type IN ('IMAGE', 'YOUTUBE_VIDEO')");
    for (const r of a) { const s = r.asset || {}; if (!assets[s.resourceName]) continue;
      const u = (s.imageAsset && s.imageAsset.fullSize && s.imageAsset.fullSize.url) || (s.youtubeVideoAsset && s.youtubeVideoAsset.youtubeVideoId ? 'https://i.ytimg.com/vi/' + s.youtubeVideoAsset.youtubeVideoId + '/hqdefault.jpg' : '');
      if (u) url[s.resourceName] = u; }
  }
  const out: Record<string, { pic: string | null, txt: string | null }> = {};
  for (const id in want) { const w = want[id]; const pic = w.img.concat(w.vid).map((r) => url[r]).filter(Boolean)[0] || null; out[id] = { pic, txt: w.txt }; }
  return out;
}

// ---------------------------------------------------------------- run
async function run(platform: string, histOnly = false) {
  if (platform === 'meta' && !META_TOKEN) throw new Error('No Facebook access key yet: add META_SYSTEM_USER_TOKEN as a Supabase secret (see the Facebook tab for the steps)');
  if (platform === 'google' && (!G_DEV || !G_REFRESH || !G_CUSTS.length)) throw new Error('Google Ads secrets are missing');
  if (platform === 'google') {
    const { error } = await db.from('ads_accounts').upsert(G_CUSTS.map((c) => ({ platform: 'google', account_id: c })), { onConflict: 'platform,account_id', ignoreDuplicates: true });
    if (error) throw new Error('ads_accounts: ' + error.message);
  }
  // Stalest account first, so when a run runs out of time the next run starts with the ones it missed.
  const { data: all } = await db.from('ads_accounts').select('*').eq('platform', platform).eq('include', true).order('last_ok_at', { ascending: true, nullsFirst: true });
  // Catching up: the accounts whose history is furthest from done first, finished ones left out.
  const accs = !histOnly ? all : (all || []).filter((a: any) => !a.backfilled_from || a.backfilled_from > addD(ist(), -HISTORY))
    .sort((x: any, y: any) => String(y.backfilled_from || '9999').localeCompare(String(x.backfilled_from || '9999')));
  const today = ist(), oldest = addD(today, -HISTORY);
  let rows = 0; const notes: string[] = [];
  for (const a of accs || []) {
    if (left() < 50_000) { notes.push('left for the next run: ' + (a.name || a.account_id)); continue; }
    try {
      const s = addD(today, -(RECENT[platform] - 1));
      // histOnly ({backfill:true}): skip the recent days and names, which the hourly run keeps
      // fresh, and spend the whole run on older months - used to catch up a re-read of history.
      if (!histOnly && platform === 'meta') {
        /* FEWER REQUESTS TO META (5 Nov 2026: "Application request limit reached" twice in a day,
           with every account read 28 days deep, plus every name and picture, every 15 minutes).
           Each run: the last 3 days (today, yesterday, the day before - what Meta is still moving).
           The full 28 days only when that account's older days were last read over 3 hours ago,
           and names / status / budgets / pictures once an hour. Same figures, a fraction of the calls. */
        rows += await fbReadPieces(a.account_id, (await fbFullDue(a.account_id, today)) ? s : addD(today, -2), today);
        if (await fbEntitiesDue(a.account_id)) await fbEntities(a.account_id);
      } else if (!histOnly) {
        rows += await gRead(a.account_id, s, today);
        await gEntities(a.account_id);
      }
      let from = a.backfilled_from && a.backfilled_from < s ? a.backfilled_from : s;
      // Facebook's older months go 10 days at a time: a month of a big account in one request
      // fails at Meta, and short pieces let a run stop between them when its time is up.
      while (platform === 'meta' && from > oldest && left() > 40_000) {
        const ps = addD(from, -10) < oldest ? oldest : addD(from, -10);
        rows += await fbRead(a.account_id, ps, addD(from, -1));
        from = ps;
      }
      while (platform !== 'meta' && from > oldest && left() > 75_000) {
        const cs = addD(from, -CHUNK[platform]) < oldest ? oldest : addD(from, -CHUNK[platform]), ce = addD(from, -1);
        try {
          rows += platform === 'meta' ? await fbRead(a.account_id, cs, ce) : await gRead(a.account_id, cs, ce);
          from = cs;
        } catch (e) {
          // A month of every ad, day by day, can be too heavy for Meta on a big account (Gurukul,
          // 3 Nov 2026: "unknown error" / "temporarily unavailable" every time). Read it again in
          // 10-day pieces, newest first, keeping each piece that arrives; the rest waits for the next run.
          const msg = String((e as Error).message || e);
          if (platform !== 'meta' || !/code [12]\)|temporarily|unknown error|reduce the amount/i.test(msg)) throw e;
          while (from > cs && left() > 40_000) {
            const ps = addD(from, -10) < cs ? cs : addD(from, -10);
            rows += await fbRead(a.account_id, ps, addD(from, -1));
            from = ps;
          }
          notes.push((a.name || a.account_id) + ': older days read in 10-day pieces');
          break;
        }
      }
      await db.from('ads_accounts').update({ backfilled_from: from, last_ok_at: new Date().toISOString(), last_error: null }).eq('platform', platform).eq('account_id', a.account_id);
    } catch (e) {
      const msg = String((e as Error).message || e).slice(0, 500);
      notes.push((a.name || a.account_id) + ': ' + msg);
      // Meta's request limit: asking again for the other accounts only keeps it closed for longer.
      if (platform === 'meta' && /(code (4|17|32|613))|request limit/i.test(msg)) {
        await db.from('ads_accounts').update({ last_error: msg }).eq('platform', platform).eq('account_id', a.account_id);
        notes.push('stopped early: Meta request limit - the next run carries on');
        break;
      }
      await db.from('ads_accounts').update({ last_error: msg }).eq('platform', platform).eq('account_id', a.account_id);
    }
  }
  return { rows, notes };
}

async function caller(req: Request) {
  const sec = req.headers.get('x-ads-secret');
  if (sec) {
    const { data } = await createClient(SB, SRV, { db: { schema: 'acc' } }).from('job_secrets').select('value').eq('name', 'ads_daily').maybeSingle();
    return data && data.value === sec ? 'cron' : null;
  }
  const auth = req.headers.get('Authorization') || '';
  if (!/^Bearer\s+\S+/.test(auth) || !ANON) return null;
  const can = await fetch(`${SB}/rest/v1/rpc/pi_allowed`, { method: 'POST', body: '{}', headers: { apikey: ANON, Authorization: auth, 'Content-Type': 'application/json', 'Content-Profile': 'camp' } });
  return can.ok && (await can.json()) === true ? 'manual' : null;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  T0 = Date.now(); gTok = '';
  let body: any = {}; try { body = await req.json(); } catch (_) { /* empty */ }
  if (!(await caller(req))) return j({ error: 'not allowed' }, 401);
  const platform = body.platform === 'google' ? 'google' : body.platform === 'meta' ? 'meta' : '';
  if (!platform) return j({ error: 'platform must be meta or google' }, 400);
  if (body.verify && platform === 'meta') return j(await fbVerify(String(body.verify.from), String(body.verify.to), body.verify.account || undefined));
  const { data: log } = await db.from('ads_sync_log').insert({ platform }).select('id').single();
  try {
    const r = await run(platform, !!body.backfill);
    await db.from('ads_sync_log').update({ finished_at: new Date().toISOString(), ok: !r.notes.some((n) => !n.startsWith('left for the next run')), rows: r.rows, message: r.notes.join(' | ') || 'ok' }).eq('id', log?.id);
    return j({ ok: true, ...r });
  } catch (e) {
    await db.from('ads_sync_log').update({ finished_at: new Date().toISOString(), ok: false, rows: 0, message: String((e as Error).message || e).slice(0, 1000) }).eq('id', log?.id);
    return j({ ok: false, error: String((e as Error).message || e) }, 200);
  }
});
