/* CAMPAIGN SHARE (17 Nov 2026, Ayush: "one Public Link which can be shared to people, and it's safe - no one can hack into
   JainE or see any confidential stuff or code. The link shows the full data of all projects with the ad cards, photos and
   videos. A toggle to allow or disallow viewing; if disallowed nothing is visible; anyone can be sent the link, not
   necessarily a JainE user").

   SAFE BY DESIGN
   - The public page (ads-report.html) carries no JainE code and no database key; it only calls this function.
   - This function answers the public with ONE thing: the rows Campaign Analytics shows, built here from a fixed list of
     fields - campaigns, ad sets and ads with their names, status, daily budget, spend, results, clicks and impressions,
     the ads' words, picture and YouTube id, and the CRM's lead / QL / site-visit / booked / lost counts. No account ids,
     no people, no customers, nothing else from the database, and only while sharing is ON and the link's key matches.
   - The key is a random 32-character code made when sharing is first switched on. Switching off makes the link show
     nothing at once; "new link" makes a new key, so the old link stops working for good.
   - Only a super admin, or someone in SHARE_PEOPLE (Manash, digital marketing), signed in to JainE can switch it on / off
     or read the key.
   The on/off switch and key live in the private storage bucket 'campaign-share' (settings.json) - no table needed. */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.47.10";

const SB = Deno.env.get('SUPABASE_URL')!, SRV = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, ANON = Deno.env.get('SUPABASE_ANON_KEY') || '';
const ADS_TOKEN = Deno.env.get('META_SYSTEM_USER_TOKEN') || Deno.env.get('META_ACCESS_TOKEN') || '';
const db = createClient(SB, SRV, { db: { schema: 'camp' } });
const st = createClient(SB, SRV);
const BUCKET = 'campaign-share';
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
const j = (o: unknown, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
const num = (v: any) => { const n = Number(v); return isFinite(n) ? n : 0; };
const ist = () => new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);
const addD = (d: string, n: number) => new Date(Date.parse(d + 'T00:00:00Z') + n * 86400_000).toISOString().slice(0, 10);

// ---------------------------------------------------------------- the switch
async function getSettings(): Promise<any> {
  const r = await fetch(`${SB}/storage/v1/object/authenticated/${BUCKET}/settings.json?t=${Date.now()}`, { headers: { Authorization: 'Bearer ' + SRV, apikey: SRV, 'Cache-Control': 'no-cache' } });
  if (!r.ok) return { on: false, token: '' };
  try { return await r.json(); } catch (_) { return { on: false, token: '' }; }
}
async function putSettings(s: any) {
  const { data } = await st.storage.getBucket(BUCKET);
  if (!data) await st.storage.createBucket(BUCKET, { public: false });
  const { error } = await st.storage.from(BUCKET).upload('settings.json', new Blob([JSON.stringify(s)], { type: 'application/json' }), { upsert: true, contentType: 'application/json', cacheControl: '0' });
  if (error) throw new Error('settings: ' + error.message);
}
function newToken() { const a = new Uint8Array(24); crypto.getRandomValues(a); return Array.from(a, (b) => b.toString(36).padStart(2, '0')).join('').slice(0, 32); }
// besides super admins, these people may switch the link on / off and copy it (17 Nov 2026, Ayush: "Yes, give Manash")
const SHARE_PEOPLE = ['digitalmarketing@thejaingroup.com'];
async function superAdmin(req: Request): Promise<string | null> {
  const auth = req.headers.get('Authorization') || '';
  if (!/^Bearer\s+\S+/.test(auth) || !ANON) return null;
  const who = await fetch(`${SB}/auth/v1/user`, { headers: { apikey: ANON, Authorization: auth } });
  if (!who.ok) return null;
  const email = String((await who.json()).email || '');
  if (SHARE_PEOPLE.includes(email.trim().toLowerCase())) return email;
  const r = await fetch(`${SB}/rest/v1/rpc/is_superadmin`, { method: 'POST', body: '{}', headers: { apikey: ANON, Authorization: auth, 'Content-Type': 'application/json', 'Content-Profile': 'app' } });
  return r.ok && (await r.json()) === true ? (email || 'admin') : null;
}
// constant-time comparison of the link's key
function same(a: string, b: string) { if (!a || !b || a.length !== b.length) return false; let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i); return d === 0; }

// ---------------------------------------------------------------- the summary
const PERIODS: Record<string, string> = { last_7d: 'Last 7 days', last_30d: 'Last 30 days', this_month: 'This month', last_month: 'Last month', last_90d: 'Last 90 days' };
function range(p: string) {
  const t = ist(), y = addD(t, -1);
  if (p === 'last_7d') return { s: addD(t, -7), e: y };
  if (p === 'this_month') return { s: t.slice(0, 8) + '01', e: t.slice(8) === '01' ? t : y };
  if (p === 'last_month') { const f = new Date(Date.UTC(+t.slice(0, 4), +t.slice(5, 7) - 2, 1)).toISOString().slice(0, 10); return { s: f, e: addD(t.slice(0, 8) + '01', -1) }; }
  if (p === 'last_90d') return { s: addD(t, -90), e: y };
  return { s: addD(t, -30), e: y };
}
const LEAD_OBJ: Record<string, 1> = { OUTCOME_LEADS: 1, LEAD_GENERATION: 1, OUTCOME_SALES: 1, CONVERSIONS: 1, MESSAGES: 1 };
const LEAD_GOAL: Record<string, 1> = { CONVERSATIONS: 1, LEAD_GENERATION: 1, QUALITY_LEAD: 1, OFFSITE_CONVERSIONS: 1, MESSAGING_PURCHASE_CONVERSION: 1, MESSAGING_APPOINTMENT_CONVERSION: 1 };
const live = (s: any) => s === 'ACTIVE' || s === 'ENABLED';
// every row, four pages at a time until a page comes back short
async function all(q: () => any) { let out: any[] = []; for (let f = 0; ; f += 4000) { const got = await Promise.all([0, 1, 2, 3].map((i) => q().range(f + i * 1000, f + i * 1000 + 999))); for (const g of got) { if (g.error) throw new Error(g.error.message); out = out.concat(g.data || []); if ((g.data || []).length < 1000) return out; } } }
function ytId(u: any) { const m = String(u || '').match(/ytimg\.com\/vi\/([A-Za-z0-9_-]{6,})\//); return m ? m[1] : null; }

/* THE SAME TREE AS CAMPAIGN ANALYTICS (17 Nov 2026, Ayush: "they will see the data that we do ... the table and ads which
   open in hierarchy should be similar to how our JainE users see"). The page gets the rows Campaign Analytics itself works
   from - campaigns, ad sets / ad groups, ads per ad set, their status, daily budgets and the CRM's figures at each level -
   and builds the same table. Still only these fields: no account ids, people or anything else. */
async function summary(period: string) {
  const p = PERIODS[period] ? period : 'last_30d', r = range(p);
  const accs = (await db.from('ads_accounts').select('platform,account_id,project').eq('include', true)).data || [];
  const proj: Record<string, string> = {}; for (const a of accs) proj[a.platform + ':' + a.account_id] = a.project || 'Other';
  const ents = await all(() => db.from('ads_entities').select('platform,kind,id,account_id,campaign_id,name,status,objective,daily_budget,thumbnail,body').order('platform').order('kind').order('id'));
  const E: Record<string, any> = {}; const leadSet: Record<string, 1> = {};
  for (const e of ents) { E[e.platform + ':' + e.kind + ':' + e.id] = e; if (e.kind === 'adset' && LEAD_GOAL[e.objective]) leadSet[e.campaign_id] = 1; }
  const isLead = (pl: string, cid: string) => pl === 'google' || !!LEAD_OBJ[(E['meta:campaign:' + cid] || {}).objective] || !!leadSet[cid];
  const d3 = addD(ist(), -2);
  const [mt, gt, ma, ga, act] = await Promise.all([
    db.rpc('ads_campaign_totals', { p_platform: 'meta', p_from: r.s, p_to: r.e }),
    db.rpc('ads_campaign_totals_v2', { p_platform: 'google', p_from: r.s, p_to: r.e }),
    db.rpc('ads_ad_totals_v4', { p_platform: 'meta', p_from: r.s, p_to: r.e, p_limit: 5000 }),
    db.rpc('ads_ad_totals_v4', { p_platform: 'google', p_from: r.s, p_to: r.e, p_limit: 5000 }),
    db.from('ads_daily').select('campaign_id').gte('day', d3).or('spend.gt.0,impressions.gt.0,clicks.gt.0').limit(20000)]);
  const active3: Record<string, 1> = {}; for (const x of act.data || []) active3[x.campaign_id] = 1;
  // a campaign's daily budget: its own, or (Facebook ad-set budgets) its ad sets' - the running ones, else all
  const setsOf: Record<string, any[]> = {}; for (const e of ents) if (e.kind === 'adset' && e.daily_budget != null) (setsOf[e.platform + ':' + e.campaign_id] = setsOf[e.platform + ':' + e.campaign_id] || []).push(e);
  const budOf = (pl: string, cid: string) => { const e = E[pl + ':campaign:' + cid] || {}; if (e.daily_budget != null) return num(e.daily_budget);
    const s = setsOf[pl + ':' + cid] || [], run = s.filter((x) => live(x.status)), use = run.length ? run : s; return use.length ? use.reduce((t, x) => t + num(x.daily_budget), 0) : null; };
  const camps: any[] = [];
  for (const [pl, res] of [['meta', mt], ['google', gt]] as [string, any][]) for (const x of res.data || []) {
    const pr = proj[pl + ':' + x.account_id]; if (!pr) continue;
    const e = E[pl + ':campaign:' + x.campaign_id] || {};
    camps.push({ id: String(x.campaign_id), pl, project: pr, name: e.name || 'Campaign', status: e.status || '', live: live(e.status), lead: isLead(pl, x.campaign_id),
      budget: budOf(pl, x.campaign_id), active3: !!active3[x.campaign_id],
      spend: num(x.spend), results: pl === 'google' ? (x.form_leads == null ? null : num(x.form_leads)) : num(x.results), clicks: num(x.clicks), impressions: num(x.impressions) });
  }
  const adrows: any[] = [], adinfo: Record<string, any> = {}, sets: Record<string, any> = {};
  for (const [pl, res] of [['meta', ma], ['google', ga]] as [string, any][]) for (const x of res.data || []) {
    if (!proj[pl + ':' + x.account_id]) continue;
    adrows.push({ id: String(x.ad_id), cid: String(x.campaign_id), sid: x.adset_id ? String(x.adset_id) : '', pl, spend: num(x.spend), results: pl === 'google' ? (x.form_leads == null ? null : num(x.form_leads)) : num(x.results), clicks: num(x.clicks), impressions: num(x.impressions) });
    if (!adinfo[x.ad_id]) { const e = E[pl + ':ad:' + x.ad_id] || {}; adinfo[x.ad_id] = { name: e.name || 'Ad', status: e.status || '', live: live(e.status), picture: e.thumbnail || null, youtube: pl === 'google' ? ytId(e.thumbnail) : null, words: String(e.body || '').slice(0, 600) }; }
    if (x.adset_id && !sets[x.adset_id]) { const e = E[pl + ':adset:' + x.adset_id] || {}; sets[x.adset_id] = { name: e.name || 'Ad set', status: e.status || '', live: live(e.status), budget: e.daily_budget == null ? null : num(e.daily_budget) }; }
  }
  // the CRM: per campaign (WhatsApp lines per project), per ad set and per ad
  const [crm, crmS] = await Promise.all([
    all(() => db.from('crm_google_daily').select('campaign_type,campaign_id,business_unit,leads,qualified,site_visited,booked,lost').gte('day', r.s).lte('day', r.e).order('day').order('campaign_id').order('business_unit')),
    all(() => db.from('crm_adset_daily').select('src,level,adset_id,ad_id,leads,qualified,site_visited,booked,lost').gte('day', r.s).lte('day', r.e).order('day').order('src').order('level').order('adset_id').order('ad_id'))]);
  const pn = (x: any) => String(x || '').toLowerCase().replace(/dream|banquets?/g, '').replace(/[^a-z0-9]/g, '');
  const byPn: Record<string, string> = {}; for (const a of accs) byPn[pn(a.project)] = a.project;
  const add = (m: Record<string, any>, k: string, x: any, extra: any) => { const o = m[k] = m[k] || { ...extra, leads: 0, ql: 0, sv: 0, booked: 0, lost: 0 }; o.leads += num(x.leads); o.ql += num(x.qualified); o.sv += num(x.site_visited); o.booked += num(x.booked); o.lost += num(x.lost); };
  const crmC: Record<string, any> = {};
  for (const x of crm) {
    const fb = x.campaign_type === 'facebook', pl = fb ? 'meta' : 'google', id = String(x.campaign_id || '');
    const e = E[pl + ':campaign:' + id];
    if (e && proj[pl + ':' + e.account_id]) add(crmC, pl + ':' + id, x, { pl, cid: id, project: proj[pl + ':' + e.account_id] });
    else if (fb && /^whatsapp/i.test(id)) { const pr = byPn[pn(x.business_unit)]; if (pr) add(crmC, 'wa:' + pr, x, { pl: 'meta', wa: true, project: pr }); }
  }
  const crmSet: Record<string, any> = {}, crmAd: Record<string, any> = {};
  for (const x of crmS) { if (x.level === 'adset') add(crmSet, String(x.adset_id), x, {}); else if (x.level === 'ad' && x.ad_id) add(crmAd, String(x.ad_id), x, {}); }
  // only what the rows above use
  const usedAds: Record<string, 1> = {}; for (const a of adrows) usedAds[a.id] = 1;
  for (const k of Object.keys(crmAd)) if (!usedAds[k]) delete crmAd[k];
  for (const k of Object.keys(crmSet)) if (!sets[k]) delete crmSet[k];
  const projects = [...new Set(accs.map((a: any) => a.project || 'Other'))];
  const hasAcc: Record<string, 1> = {}; for (const a of accs) hasAcc[(a.project || 'Other') + '|' + a.platform] = 1;
  return { period: p, label: PERIODS[p], from: r.s, to: r.e, at: new Date().toISOString(), projects, hasAcc, camps, sets, adrows, adinfo, crm: Object.values(crmC), crmSet, crmAd };
}

// a Facebook video ad: Meta's preview of the ad, which plays it (the same as Campaign Analytics' popup)
async function fbVideo(id: string) {
  const g = async (path: string) => { const r = await fetch(`https://graph.facebook.com/v21.0/${path}${path.includes('?') ? '&' : '?'}access_token=${ADS_TOKEN}`); const t = await r.json().catch(() => ({})); if (!r.ok || t.error) throw new Error('meta'); return t; };
  const a = await g(`${id}?fields=account_id,creative{video_id,object_story_spec{video_data{video_id}},asset_feed_spec{videos{video_id}}}`);
  // only our own included ad accounts
  const { data } = await db.from('ads_accounts').select('account_id').eq('platform', 'meta').eq('include', true).eq('account_id', String(a.account_id || ''));
  if (!data || !data.length) return { video: false };
  const cr = a.creative || {}, os = cr.object_story_spec || {}, af = cr.asset_feed_spec || {};
  const vid = cr.video_id || (os.video_data && os.video_data.video_id) || (Array.isArray(af.videos) && af.videos[0] && af.videos[0].video_id);
  if (!vid) return { video: false };
  const p = await g(`${id}/previews?ad_format=MOBILE_FEED_STANDARD`);
  const m = String(((p.data || [])[0] || {}).body || '').match(/src="([^"]+)"/);
  return m ? { video: true, iframe: m[1].replace(/&amp;/g, '&') } : { video: true };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return j({ error: 'method' }, 405);
  let body: any = {}; try { body = await req.json(); } catch (_) { /* empty */ }
  try {
    // ---- staff: the switch (super admins only)
    if (body.action === 'status' || body.action === 'set' || body.action === 'renew') {
      const who = await superAdmin(req); if (!who) return j({ error: 'not allowed' }, 401);
      const s = await getSettings();
      if (body.action === 'set') { s.on = !!body.on; if (!s.token) s.token = newToken(); s.by = who; s.at = new Date().toISOString(); await putSettings(s); }
      if (body.action === 'renew') { s.token = newToken(); s.by = who; s.at = new Date().toISOString(); await putSettings(s); }
      return j({ ok: true, on: !!s.on, token: s.token || null });
    }
    // ---- public: the summary / a video, only while ON and with the right key
    const s = await getSettings();
    if (!s.on || !same(String(body.k || ''), String(s.token || ''))) return j({ off: true });
    if (body.action === 'video') { const id = String(body.ad_id || '').replace(/\D/g, ''); if (!id) return j({ video: false }); try { return j(await fbVideo(id)); } catch (_) { return j({ video: false }); } }
    return j(await summary(String(body.period || 'last_30d')));
  } catch (e) {
    return j({ error: 'Something went wrong' }, 500);   // no details to the public
  }
});
