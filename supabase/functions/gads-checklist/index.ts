/* GOOGLE ADS CHECKLIST (19 Nov 2026, Ayush: "Pre-emptive Alert - Checklists.xlsx", the Google sheet). Twin of fb-checklist. Judges every
   running Google campaign and (Search) ad against the sheet's limits from the STORED figures only (no Google call): whatever breaks a
   point is saved (camp.gads_check_flags) and the whole run goes out as ONE email (a count per point, then what broke each).

   WHEN: cron gads-checklist-daily every day 00:15 IST {kind:'daily'}; cron gads-checklist-weekly every Monday 01:15 IST {kind:'weekly'},
   judging the 7 days to yesterday (Mon-Sun). {kind:'all'} does both; {dry:true} (any signed-in staff member) only works it out:
   nothing saved, nothing sent (dry mode never touches the gads_check tables).
   SCOPE: ENABLED campaigns that spent in the last 3 days; anything named "Diamond" and excluded accounts are left out.
   "Leads" = the Leads figure the dashboard shows (ads_daily.form_leads; results only where form_leads was never stored); QL = the CRM's
   qualified leads of the same Google campaign id (camp.crm_google_daily.campaign_id = the Google campaign id, not Facebook rows).
   Campaign kinds: competitor = name has "competitor" (section 6 limits INSTEAD of section 1); brand = name has "brand"; the other
   SEARCH campaigns are location / other search; Demand Gen = objective DEMAND_GEN; Display / Video are not judged (they only count in Spend).
   Impression share over a period: eligible impressions e = impressions / imp_share per day (days without imp_share skipped),
   period IS = sum(impressions) / sum(e); period lost IS = sum(e * lost) / sum(e). The stored shares are ratios 0..1.

   THE POINTS (sheet section - limit):
   1) Campaign (weekly, not competitor): CPL above 1,200 | CPQL above 4,000 | CTR below 2% (Demand Gen) / 3% (Search) | Search impression
      share below 30% (location search) / 80% (brand search) | Lost IS (rank) above 40% | Lost IS (budget) above 30% | QL % below 7% |
      No leads (spend 500+, 0 leads).
   2) Ad copy (weekly, ads of Search campaigns): No leads (spend 500+) | CPL above 1,500 | CTR below 3%.
   5) Spend: daily - yesterday's spend more than 20% over / under the campaign's daily budget | weekly - this month's spend above the
      month's budget (daily budgets x days in the month) per project = red | weekly - month-to-date spend vs daily budgets x days so far,
      off by more than 20% either way, per project.
   6) Competitor Search Campaign (weekly): CPL above 1,500 | CPQL above 4,000 | CTR below 2% | impression share below 15% | Lost IS (rank)
      above 60% | Lost IS (budget) above 20% | QL % below 7%.
   1) Age (daily, Demand Gen): enabled spending campaign with 18-24 spend in camp.ads_age (last 28 days; 20 Nov 2026).
   Not built (data not stored / doubtful): Auction insight, Keywords (ad relevance / expected CTR / landing page / quality score),
   Lost reasons, Site visit, Lead discrepancy, Telecalling, Negative keywords, escalation, tCPA, bid adjustments, reconcile. */
import { SMTPClient } from "https://deno.land/x/denomailer@1.6.0/mod.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const SB = Deno.env.get('SUPABASE_URL')!, SRV = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, ANON = Deno.env.get('SUPABASE_ANON_KEY') || '';
const TO = ['ayushruia1@gmail.com', 'digitalmarketing@thejaingroup.com'];
const db = createClient(SB, SRV, { db: { schema: 'camp' } });
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-ads-secret', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
const j = (o: unknown, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } });
const num = (v: any) => { const n = Number(v); return isFinite(n) ? n : 0; };
const istDay = (off = 0) => new Date(Date.now() + 5.5 * 3600_000 + off * 86400_000).toISOString().slice(0, 10);
const addD = (d: string, n: number) => new Date(Date.parse(d + 'T00:00:00Z') + n * 86400_000).toISOString().slice(0, 10);
const esc = (s: any) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const inr = (n: number) => '₹' + Math.round(n).toLocaleString('en-IN');
const pc = (n: number, dp = 2) => n.toFixed(dp) + '%';
const cnt = (n: number) => String(Math.round(n * 10) / 10);   // leads can be fractional (Google splits a conversion across clicks)
const signed = (n: number) => (n > 0 ? '+' : '') + Math.round(n) + '%';

const EXCLUDED = /diamond/i;
const COMPETITOR = /competitor/i;
const BRAND = /brand/i;
const MIN_SPEND_NO_LEADS = 500;

async function allowed(req: Request) {
  const sec = req.headers.get('x-ads-secret');
  if (sec) { const { data } = await createClient(SB, SRV, { db: { schema: 'acc' } }).from('job_secrets').select('value').eq('name', 'ads_daily').maybeSingle(); return data && data.value === sec ? 'cron' : null; }
  const auth = req.headers.get('Authorization') || '';
  if (!/^Bearer\s+\S+/.test(auth) || !ANON) return null;
  const can = await fetch(`${SB}/rest/v1/rpc/pi_allowed`, { method: 'POST', body: '{}', headers: { apikey: ANON, Authorization: auth, 'Content-Type': 'application/json', 'Content-Profile': 'camp' } });
  return can.ok && (await can.json()) === true ? 'staff' : null;
}
async function pages(q: () => any) { const out: any[] = []; for (let p = 0; p < 200000; p += 1000) { const { data, error } = await q().range(p, p + 999); if (error) throw new Error(error.message); out.push(...(data || [])); if (!data || data.length < 1000) break; } return out; }

type Flag = { kind: string; section: string; point: string; level: string; project: string; campaign_id?: string | null; adset_id?: string | null; ad_id?: string | null; name: string; campaign_name?: string | null; adset_name?: string | null; value: string; lim: string; sev: 'alert' | 'red' };

async function check(kinds: string[]) {
  const today = istDay(0), Y = addD(today, -1), W = { s: addD(Y, -6), e: Y };
  const flags: Flag[] = [], notes: string[] = [];
  const add = (f: Flag) => flags.push(f);
  const { data: accs } = await db.from('ads_accounts').select('account_id,project,name').eq('platform', 'google').eq('include', true);
  const accProj: Record<string, string> = {}; for (const a of accs || []) accProj[a.account_id] = a.project || a.name || a.account_id;
  const ent = await pages(() => db.from('ads_entities').select('id,account_id,name,status,objective,daily_budget').eq('platform', 'google').eq('kind', 'campaign').order('id'));
  const C: Record<string, any> = {}; for (const e of ent) { if (accProj[e.account_id]) C[e.id] = e; }
  const live = (x: any) => x && String(x.status || '') === 'ENABLED';
  const campOk = (cid: string) => live(C[cid]) && !EXCLUDED.test(C[cid].name || '');
  const projOf = (cid: string) => (C[cid] ? accProj[C[cid].account_id] : '');
  const isSearch = (cid: string) => C[cid] && C[cid].objective === 'SEARCH';
  const isDG = (cid: string) => C[cid] && C[cid].objective === 'DEMAND_GEN';
  const isComp = (cid: string) => COMPETITOR.test((C[cid] && C[cid].name) || '');
  const isBrand = (cid: string) => !isComp(cid) && BRAND.test((C[cid] && C[cid].name) || '');
  // spending = spent something in the last 3 days (a campaign marked enabled that is not spending is not judged)
  const sp3: Record<string, 1> = {}; for (const r of await pages(() => db.from('ads_daily').select('campaign_id').eq('platform', 'google').gte('day', addD(today, -3)).gt('spend', 0).order('campaign_id'))) sp3[r.campaign_id] = 1;
  const activeProjects = new Set(Object.keys(C).filter((c) => campOk(c) && sp3[c]).map(projOf));
  const m0 = Y.slice(0, 8) + '01', dim = new Date(Date.UTC(+Y.slice(0, 4), +Y.slice(5, 7), 0)).getUTCDate();
  const elapsed = +Y.slice(8, 10);
  const rows = await pages(() => db.from('ads_daily').select('campaign_id,day,spend,impressions,clicks,results,form_leads,imp_share,budget_lost_is,rank_lost_is').eq('platform', 'google').gte('day', m0 < W.s ? m0 : W.s).lte('day', Y).order('day').order('campaign_id'));

  /* ------------------------------------------------------------------ DAILY */
  if (kinds.includes('daily')) {
    const K = 'daily', S5 = '5) Spend';
    // yesterday's spend against the campaign's daily budget: more than 20% over or under
    const ySp: Record<string, number> = {}; for (const r of rows) if (r.day === Y) ySp[r.campaign_id] = (ySp[r.campaign_id] || 0) + num(r.spend);
    for (const cid of Object.keys(C).filter((c) => campOk(c) && sp3[c] && (ySp[c] || 0) > 0)) {
      const b = num(C[cid].daily_budget); if (!(b > 0)) continue;
      const dev = (ySp[cid] - b) / b * 100;
      if (Math.abs(dev) > 20) add({ kind: K, section: S5, point: 'Daily spend vs budget', level: 'campaign', project: projOf(cid), campaign_id: cid, name: C[cid].name, value: inr(ySp[cid]) + ' spent yesterday (' + signed(dev) + ')', lim: 'Within 20% of the ' + inr(b) + ' daily budget', sev: 'alert' });
    }
    /* AGE (20 Nov 2026, Ayush: "Yes, add it"; sheet: "Age - below 25 - show alert [Demand Gen only]", within 24 hours): an ENABLED, spending
       Demand Gen campaign that delivered to the 18-24 age band. camp.ads_age holds the last 28 days per campaign and age band
       (ads-daily-sync age read, nightly 01:25 IST), so the alert stays while any 18-24 spend is inside those 28 days. Not there
       yet (table not made / not filled): the point is skipped and a note says so. */
    try {
      const ag = await pages(() => db.from('ads_age').select('campaign_id,age_range,spend,impressions').eq('platform', 'google').order('campaign_id').order('age_range'));
      const tot: Record<string, number> = {}, u25: Record<string, number> = {};
      for (const r of ag) { tot[r.campaign_id] = (tot[r.campaign_id] || 0) + num(r.spend); if (r.age_range === '18_24') u25[r.campaign_id] = (u25[r.campaign_id] || 0) + num(r.spend); }
      if (!ag.length) notes.push('Age: no age figures stored yet');
      for (const cid of Object.keys(u25).filter((c) => campOk(c) && sp3[c] && isDG(c) && u25[c] > 0))
        add({ kind: K, section: '1) Campaign', point: 'Age under 25 (Demand Gen)', level: 'campaign', project: projOf(cid), campaign_id: cid, name: C[cid].name, value: inr(u25[cid]) + ' on ages 18-24 (' + pc(u25[cid] / tot[cid] * 100, 1) + ' of spend, last 28 days)', lim: 'No spend below age 25', sev: 'alert' });
    } catch (e) { notes.push('Age: ' + String((e as Error).message || e).slice(0, 120)); }
  }

  /* ------------------------------------------------------------------ WEEKLY */
  if (kinds.includes('weekly')) {
    const K = 'weekly', S1 = '1) Campaign', S2 = '2) Ad copy', S5 = '5) Spend', S6 = '6) Competitor Search Campaign';
    // stored figures for the week, per campaign
    type Agg = { spend: number; imp: number; clk: number; fl: number; fln: number; res: number; e: number; ie: number; eb: number; ebl: number; er: number; erl: number };
    const cW: Record<string, Agg> = {};
    for (const r of rows) {
      if (r.day < W.s || r.day > W.e) continue;
      const x = cW[r.campaign_id] = cW[r.campaign_id] || { spend: 0, imp: 0, clk: 0, fl: 0, fln: 0, res: 0, e: 0, ie: 0, eb: 0, ebl: 0, er: 0, erl: 0 };
      const imp = num(r.impressions); x.spend += num(r.spend); x.imp += imp; x.clk += num(r.clicks); x.res += num(r.results);
      if (r.form_leads != null) { x.fl += num(r.form_leads); x.fln++; }
      const sh = r.imp_share == null ? 0 : num(r.imp_share);
      if (sh > 0) { const e = imp / sh; x.e += e; x.ie += imp;
        if (r.budget_lost_is != null) { x.eb += e; x.ebl += e * num(r.budget_lost_is); }
        if (r.rank_lost_is != null) { x.er += e; x.erl += e * num(r.rank_lost_is); } }
    }
    const leadsOf = (x: { fl: number; fln: number; res: number }) => (x.fln > 0 ? x.fl : x.res);
    // the CRM's qualified leads per Google campaign id
    const crm = await pages(() => db.from('crm_google_daily').select('campaign_id,leads,qualified').neq('campaign_type', 'facebook').gte('day', W.s).lte('day', W.e).order('day').order('campaign_id').order('business_unit'));
    const qlC: Record<string, number> = {}; for (const r of crm) { const id = String(r.campaign_id || ''); qlC[id] = (qlC[id] || 0) + num(r.qualified); }
    // campaign points
    for (const cid of Object.keys(cW)) {
      const x = cW[cid]; if (!campOk(cid) || x.spend <= 0) continue;
      const search = isSearch(cid), dg = isDG(cid); if (!search && !dg) continue;   // Display / Video / others are not judged
      const comp = search && isComp(cid), brand = search && isBrand(cid);
      const sec = comp ? S6 : S1, ld = leadsOf(x), ql = qlC[cid] || 0, sp = x.spend;
      const base = { kind: K, section: sec, level: 'campaign', project: projOf(cid), campaign_id: cid, name: C[cid].name };
      const cplLim = comp ? 1500 : 1200;
      if (ld > 0 && sp / ld > cplLim) add({ ...base, point: 'CPL', value: inr(sp / ld) + ' (' + cnt(ld) + ' leads)', lim: 'Not above ' + inr(cplLim), sev: 'alert' });
      if (ql > 0 ? sp / ql > 4000 : sp > 4000) add({ ...base, point: 'CPQL', value: ql > 0 ? inr(sp / ql) + ' (' + ql + ' QL)' : 'No QL, ' + inr(sp) + ' spent', lim: 'Not above ₹4,000', sev: 'alert' });
      const ctrLim = comp ? 2 : search ? 3 : 2;
      if (x.imp > 0 && x.clk / x.imp * 100 < ctrLim) add({ ...base, point: 'CTR', value: pc(x.clk / x.imp * 100), lim: 'Not below ' + ctrLim + '%', sev: 'alert' });
      if (search) {
        const isLim = comp ? 15 : brand ? 80 : 30;
        if (x.e > 0) { const is = x.ie / x.e * 100; if (is < isLim) add({ ...base, point: 'Search impression share', value: pc(is, 1), lim: 'Not below ' + isLim + '%' + (comp ? ' (competitor)' : brand ? ' (brand)' : ' (location)'), sev: 'alert' }); }
        const rkLim = comp ? 60 : 40, bdLim = comp ? 20 : 30;
        if (x.er > 0) { const v = x.erl / x.er * 100; if (v > rkLim) add({ ...base, point: 'Search lost IS (rank)', value: pc(v, 1), lim: 'Not above ' + rkLim + '%', sev: 'alert' }); }
        if (x.eb > 0) { const v = x.ebl / x.eb * 100; if (v > bdLim) add({ ...base, point: 'Search lost IS (budget)', value: pc(v, 1), lim: 'Not above ' + bdLim + '%', sev: 'alert' }); }
      }
      if (ld > 0 && ql / ld * 100 < 7) add({ ...base, point: 'QL %', value: pc(ql / ld * 100, 1) + ' (' + ql + ' of ' + cnt(ld) + ')', lim: 'Not below 7%', sev: 'alert' });
      if (!comp && ld === 0 && sp >= MIN_SPEND_NO_LEADS) add({ ...base, point: 'Leads', value: inr(sp) + ' spent, 0 leads', lim: 'Leads expected', sev: 'alert' });
    }
    // ad copy: the ads of the Search campaigns
    const adr = await pages(() => db.from('ads_ad_daily').select('ad_id,campaign_id,spend,impressions,clicks,results,form_leads').eq('platform', 'google').gte('day', W.s).lte('day', W.e).order('day').order('ad_id'));
    const aW: Record<string, any> = {};
    for (const r of adr) { if (!isSearch(r.campaign_id) || !campOk(r.campaign_id) || !sp3[r.campaign_id]) continue;
      const x = aW[r.ad_id] = aW[r.ad_id] || { campaign_id: r.campaign_id, spend: 0, imp: 0, clk: 0, fl: 0, fln: 0, res: 0 };
      x.spend += num(r.spend); x.imp += num(r.impressions); x.clk += num(r.clicks); x.res += num(r.results); if (r.form_leads != null) { x.fl += num(r.form_leads); x.fln++; } }
    const AE: Record<string, any> = {}, adIds = Object.keys(aW);
    for (let i = 0; i < adIds.length; i += 200) { const { data } = await db.from('ads_entities').select('id,name,status').eq('platform', 'google').eq('kind', 'ad').in('id', adIds.slice(i, i + 200)); for (const x of data || []) AE[x.id] = x; }
    for (const aid of adIds) {
      const x = aW[aid]; if (x.spend <= 0) continue; if (AE[aid] && String(AE[aid].status || '') !== 'ENABLED') continue;   // paused / removed ads are not judged
      const cid = x.campaign_id, ld = leadsOf(x), sp = x.spend;
      const base = { kind: K, section: S2, level: 'ad', project: projOf(cid), campaign_id: cid, adset_id: null, ad_id: aid, name: ((AE[aid] && AE[aid].name) || 'Ad') + ' #' + aid };
      if (ld === 0 && sp >= MIN_SPEND_NO_LEADS) add({ ...base, point: 'Text ad – no leads', value: inr(sp) + ' spent, 0 leads', lim: 'Leads expected', sev: 'alert' });
      if (ld > 0 && sp / ld > 1500) add({ ...base, point: 'Text ad – CPL', value: inr(sp / ld) + ' (' + cnt(ld) + ' leads)', lim: 'Not above ₹1,500', sev: 'alert' });
      if (x.imp > 0 && x.clk / x.imp * 100 < 3) add({ ...base, point: 'Text ad – CTR', value: pc(x.clk / x.imp * 100), lim: 'Not below 3%', sev: 'alert' });
    }
    /* FIRST POSITION (21 Nov 2026, Ayush: Auction Insights - "if our Ads, You, is in 2nd position or below then Alert"; Google keeps
       auction_insight_* to allowlisted tokens, so he chose the top-of-page share instead). Per spending Search campaign over the week:
       absolute top impression share = how often our ad was the very first ad. Below 50% means that, in most auctions we showed in,
       another advertiser was above us - we were 2nd or lower. Weighted by the impressions we were eligible for (impressions / impression share). */
    try {
      const tr = await pages(() => db.from('ads_daily').select('campaign_id,day,impressions,imp_share,top_is,abs_top_is').eq('platform', 'google').gte('day', W.s).lte('day', W.e).order('day').order('campaign_id'));
      const tW: Record<string, { e: number; at: number; t: number; n: number }> = {};
      for (const r of tr) {
        if (r.abs_top_is == null || !(num(r.imp_share) > 0)) continue;
        const e = num(r.impressions) / num(r.imp_share), x = tW[r.campaign_id] = tW[r.campaign_id] || { e: 0, at: 0, t: 0, n: 0 };
        x.e += e; x.at += e * num(r.abs_top_is); x.t += e * num(r.top_is); x.n++; }
      if (!tr.some((r: any) => r.abs_top_is != null)) notes.push('First position: no top-of-page figures stored yet');
      for (const cid of Object.keys(tW).filter((c) => isSearch(c) && campOk(c) && sp3[c])) {
        const x = tW[cid]; if (!(x.e > 0)) continue;
        const at = x.at / x.e * 100, t = x.t / x.e * 100;
        if (at < 50) add({ kind: K, section: S1, point: 'First position (Auction)', level: 'campaign', project: projOf(cid), campaign_id: cid, name: C[cid].name,
          value: 'First ad in ' + pc(at, 1) + ' of auctions (top of page ' + pc(t, 1) + ') - 2nd or lower in the rest', lim: 'First ad in at least 50% (absolute top impression share)', sev: 'alert' });
      }
    } catch (e) { notes.push('First position: ' + String((e as Error).message || e).slice(0, 120)); }
    /* KEYWORD QUALITY (21 Nov 2026, Ayush: "Landing Page Experience, Ad Relevance, Expected CTR, Quality Score ... some don't have the
       value, leave them; whichever has a value should not be Below Average, and Quality Score below 5 then Alert"). camp.ads_kw_quality =
       every enabled keyword of the enabled ad groups and campaigns, read nightly (ads-daily-sync quality, 01:00 IST). One alert per keyword,
       naming each thing that broke; keywords Google gives no values for are left out. Only spending campaigns are judged. */
    try {
      const kq = await pages(() => db.from('ads_kw_quality').select('campaign_id,ad_group_id,ad_group_name,keyword_id,keyword,match_type,quality_score,ad_relevance,landing_page,expected_ctr').eq('platform', 'google').order('campaign_id').order('keyword_id'));
      if (!kq.length) notes.push('Keyword quality: no keyword figures stored yet');
      const BA = 'BELOW_AVERAGE';
      for (const k of kq) {
        if (!campOk(k.campaign_id) || !sp3[k.campaign_id]) continue;
        const bad: string[] = [];
        if (k.quality_score != null && num(k.quality_score) < 5) bad.push('Quality Score ' + k.quality_score);
        if (k.landing_page === BA) bad.push('Landing page experience Below average');
        if (k.ad_relevance === BA) bad.push('Ad relevance Below average');
        if (k.expected_ctr === BA) bad.push('Expected CTR Below average');
        if (!bad.length) continue;
        // 21 Nov 2026 (Ayush: "the other Column data of Keywords??"): all four of Google's values are shown, the ones that broke marked with !
        const lbl = (x: unknown) => x == null ? '-' : String(x).replace('BELOW_AVERAGE', 'Below average').replace('ABOVE_AVERAGE', 'Above average').replace('AVERAGE', 'Average');
        const mk = (s: string, b: boolean) => (b ? '! ' : '') + s;
        const all4 = [mk('Quality Score ' + (k.quality_score ?? '-'), k.quality_score != null && num(k.quality_score) < 5), mk('Landing page experience ' + lbl(k.landing_page), k.landing_page === BA),
          mk('Ad relevance ' + lbl(k.ad_relevance), k.ad_relevance === BA), mk('Expected CTR ' + lbl(k.expected_ctr), k.expected_ctr === BA)];
        add({ kind: K, section: '3) Keywords', point: 'Keyword quality', level: 'keyword', project: projOf(k.campaign_id), campaign_id: k.campaign_id, adset_id: k.ad_group_id, ad_id: null,
          name: '"' + k.keyword + '"' + (k.match_type ? ' (' + String(k.match_type).toLowerCase() + ')' : ''), adset_name: k.ad_group_name, value: all4.join(' · '),
          lim: 'Quality Score 5 or more; none Below average', sev: 'alert' });
      }
    } catch (e) { notes.push('Keyword quality: ' + String((e as Error).message || e).slice(0, 120)); }
    // spend per project: this month's spend above the month's budget (red) and the month-to-date pace
    const spP: Record<string, number> = {}; for (const r of rows) { if (r.day < m0 || !C[r.campaign_id] || EXCLUDED.test(C[r.campaign_id].name || '')) continue; const p = projOf(r.campaign_id); spP[p] = (spP[p] || 0) + num(r.spend); }
    const budP: Record<string, number> = {}; for (const cid of Object.keys(C).filter((c) => campOk(c) && sp3[c])) { if (C[cid].daily_budget == null) continue; const p = projOf(cid); budP[p] = (budP[p] || 0) + num(C[cid].daily_budget); }
    for (const p of activeProjects) {
      const bm = (budP[p] || 0) * dim, s = spP[p] || 0, pace = (budP[p] || 0) * elapsed;
      if (bm > 0 && s > bm) add({ kind: K, section: S5, point: 'Monthly budget', level: 'project', project: p, name: p, value: inr(s) + ' spent this month', lim: 'Budget ' + inr(bm) + ' (' + inr(budP[p]) + ' a day × ' + dim + ' days)', sev: 'red' });
      if (pace > 0) { const dev = (s - pace) / pace * 100;
        if (Math.abs(dev) > 20) add({ kind: K, section: S5, point: 'Month-to-date pace', level: 'project', project: p, name: p, value: inr(s) + ' in ' + elapsed + ' days (' + signed(dev) + ')', lim: 'Within 20% of ' + inr(pace) + ' (' + inr(budP[p]) + ' a day × ' + elapsed + ' days)', sev: 'alert' }); }
    }
  }
  for (const f of flags) f.campaign_name = f.campaign_id && C[f.campaign_id] ? C[f.campaign_id].name : null;
  return { today, W, flags, notes };
}

/* ONE COMBINED EMAIL PER RUN. A count of every point at the top, then each point with what broke it - red first, at most 10 per
   point so the mail stays under Gmail's clipping size; the rest are in the plain-text part. */
const PER_POINT = 10;
function emailHtml(groups: [string, Flag[]][], period: string, total: number, reds: number) {
  const PORTAL = (Deno.env.get('PORTAL_URL') || 'https://jaingroupe.netlify.app').replace(/\/$/, '');
  const lv: Record<string, string> = { project: 'Project', campaign: 'Campaign', adset: 'Ad group', ad: 'Ad' };
  const summary = groups.map(([k, rows]) => { const [section, point] = k.split('|'), r = rows.filter((f) => f.sev === 'red').length;
    return '<tr><td class=g>' + esc(section) + '</td><td><b>' + esc(point) + '</b></td><td class=n>' + rows.length + (r ? ' <span class=r>(' + r + ' red)</span>' : '') + '</td></tr>'; }).join('');
  const blocks = groups.map(([k, rows]) => { const [section, point] = k.split('|');
    const list = rows.slice().sort((x, y) => (x.sev === 'red' ? 0 : 1) - (y.sev === 'red' ? 0 : 1)).slice(0, PER_POINT);
    return '<h3>' + esc(point) + ' <span class=g>· ' + esc(section) + ' · ' + rows.length + ' · limit: ' + esc(rows[0].lim) + '</span></h3><table>'
      + list.map((f) => '<tr class=' + (f.sev === 'red' ? 'x' : 'a') + '><td class=g>' + esc(f.project) + '</td><td class=g>' + esc(lv[f.level] || f.level) + '</td><td>' + esc(f.name) + '</td><td class=v>' + esc(f.value) + '</td></tr>').join('')
      + (rows.length > PER_POINT ? '<tr><td colspan=4 class=g>+' + (rows.length - PER_POINT) + ' more</td></tr>' : '') + '</table>'; }).join('');
  return '<html><head><style>body{margin:0;background:#f1f5f9;font-family:Segoe UI,Arial,sans-serif}.w{max-width:780px;margin:20px auto;background:#fff;border:1px solid #e2e8f0;border-radius:12px;overflow:hidden}.h{background:#111;padding:14px 22px;border-bottom:2px solid #e0121c;color:#e5e7eb;font-size:12px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase}.b{padding:18px 22px}table{width:100%;border-collapse:collapse;font-size:12.5px}td{padding:5px 8px;border-bottom:1px solid #eef1f4;vertical-align:top}.g{color:#64748b}.n{text-align:right;font-weight:700}.r{color:#dc2626}h3{margin:18px 0 6px;font-size:14px;color:#0f172a}h3 .g{font-weight:500;font-size:12px}tr.a td:first-child{border-left:3px solid #d97706}tr.x td:first-child{border-left:3px solid #dc2626}tr.a .v{color:#b45309;font-weight:700;white-space:nowrap}tr.x .v{color:#dc2626;font-weight:700;white-space:nowrap}.f{padding:12px 22px;background:#f8fafc;border-top:1px solid #e2e8f0;color:#94a3b8;font-size:12px}.btn{display:inline-block;background:#e0121c;color:#fff;text-decoration:none;padding:9px 18px;border-radius:8px;font-size:13px;font-weight:600}</style></head><body><div class=w>'
    + '<div class=h>JAIN-E · Google Checklist</div><div class=b><p style="margin:0 0 4px;font-size:16px;font-weight:700">' + total + ' to look at' + (reds ? ' · <span class=r>' + reds + ' red</span>' : '') + '</p><p class=g style="margin:0 0 14px;font-size:13px">' + esc(period) + '</p>'
    + '<table>' + summary + '</table>' + blocks
    // white text set on the link itself and on a span inside it: Gmail drops a stylesheet's link colour and paints links blue
    + '<p style="margin-top:18px"><a class=btn href="' + PORTAL + '/campaigns.html" style="display:inline-block;background:#e0121c;color:#ffffff !important;text-decoration:none;padding:9px 18px;border-radius:8px;font-size:13px;font-weight:600"><span style="color:#ffffff">Open Campaign Analytics</span></a></p></div><div class=f>Automated alert from JAIN-E Campaign Analytics. Please do not reply.</div></div></body></html>';
}
function b64Part(mimeType: string, s: string) {
  const bytes = new TextEncoder().encode(s); let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return { mimeType: `${mimeType}; charset="utf-8"`, content: btoa(bin).replace(/.{76}(?=.)/g, '$&\r\n'), transferEncoding: 'base64' };
}
// every mail body goes out as base64 parts (14 Nov 2026: quoted-printable parts showed as raw source in some mail apps)
function mailBody(text: string, html: string) { return { mimeContent: [b64Part('text/plain', text), b64Part('text/html', html)] }; }
// 14 Nov 2026: denomailer 1.6.0 writes a non-ASCII subject as =?utf-8?Q?...?= WITHOUT escaping spaces or "?" and folds it with "=" line breaks. That is an invalid header, so some
// mail apps then show the WHOLE message as raw source (headers, boundaries, base64). A subject that is plain ASCII is passed through untouched, so make every subject ASCII first.
function asciiSubject(s: string) {
  const M: Record<string, string> = { "—": "-", "–": "-", "‒": "-", "−": "-", "‘": "'", "’": "'", "“": '"', "”": '"', "…": "...", "₹": "Rs.", [String.fromCharCode(160)]: " ", "•": "-", "·": "-", "×": "x" };
  return String(s ?? "").normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^\x00-\x7f]/g, (c) => M[c] ?? "").replace(/[\r\n]+/g, " ").replace(/\s{2,}/g, " ").trim().replace(/^=\?/, "= ?");
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  const who = await allowed(req); if (!who) return j({ error: 'not allowed' }, 401);
  let body: any = {}; try { body = await req.json(); } catch (_) { /* empty */ }
  const dry = who !== 'cron' || !!body.dry;   // only the cron saves and sends
  const monday = new Date(Date.parse(istDay(0) + 'T00:00:00Z')).getUTCDay() === 1;
  const kinds = body.kind === 'all' ? ['daily', 'weekly'] : body.kind === 'weekly' ? ['weekly'] : body.kind === 'daily' ? ['daily'] : (monday ? ['daily', 'weekly'] : ['daily']);
  let r: Awaited<ReturnType<typeof check>>;
  try { r = await check(kinds); } catch (e) { return j({ error: String((e as Error).message || e).slice(0, 300) }, 500); }
  if (dry) return j({ ok: true, dry: true, kinds, period: r.W, flags: r.flags, notes: r.notes });
  const out: any = { ok: true, kinds, saved: {}, emailed: 0, notes: r.notes };
  const GU = Deno.env.get('GMAIL_USER'), GP = Deno.env.get('GMAIL_APP_PASSWORD');
  const runIds: number[] = [], mail: Flag[] = [];
  for (const kind of kinds) {
    const fl = r.flags.filter((f) => f.kind === kind);
    const per = kind === 'weekly' ? { from: r.W.s, to: r.W.e } : { from: r.today, to: r.today };
    const { data: run, error } = await db.from('gads_check_runs').insert({ kind, run_day: r.today, period_from: per.from, period_to: per.to, flags: fl.length, notes: r.notes.join(' | ').slice(0, 2000) || null }).select('id').single();
    if (error) { out.saved[kind] = 'not saved: ' + error.message; continue; }   // already ran today, or the table is not there yet
    for (let i = 0; i < fl.length; i += 500) await db.from('gads_check_flags').insert(fl.slice(i, i + 500).map((f) => ({ ...f, run_id: run.id })));
    out.saved[kind] = fl.length; runIds.push(run.id); mail.push(...fl);
  }
  // one email for the whole run (Monday: the daily and the weekly points together)
  if (GU && GP && mail.length) {
    const groups: Record<string, Flag[]> = {}; for (const f of mail) (groups[f.section + '|' + f.point] = groups[f.section + '|' + f.point] || []).push(f);
    const list = Object.entries(groups).sort((a, b) => a[0].localeCompare(b[0]));
    const reds = mail.filter((f) => f.sev === 'red').length;
    const period = (runIds.length && kinds.includes('weekly') ? 'Weekly points: ' + r.W.s + ' to ' + r.W.e + ' · ' : '') + 'Checked ' + r.today;
    const text = mail.length + ' to look at (' + period + ')\n' + list.map(([k, rows]) => '\n' + k.split('|')[1] + ' - ' + rows.length + ' (' + k.split('|')[0] + ', limit: ' + rows[0].lim + ')\n' + rows.map((f) => '- ' + f.project + ' | ' + f.name + ': ' + f.value).join('\n')).join('\n');
    let client: any = null;
    try {
      client = new SMTPClient({ connection: { hostname: 'smtp.gmail.com', port: 465, tls: true, auth: { username: GU, password: GP } } });
      await client.send({ from: GU, to: TO, subject: asciiSubject('Google Checklist: ' + mail.length + ' to look at, ' + reds + ' red (' + r.today + ')'), ...mailBody(text, emailHtml(list, period, mail.length, reds)) });
      out.emailed = 1;
      await db.from('gads_check_runs').update({ emailed: 1 }).in('id', runIds);
    } catch (e) { out.notes.push('email: ' + String((e as Error).message).slice(0, 160)); }
    finally { try { if (client) await client.close(); } catch (_) { /* ignore */ } }
  }
  return j(out);
});
