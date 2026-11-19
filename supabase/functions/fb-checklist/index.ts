/* FB CHECKLIST (18 Nov 2026, Ayush: "Pre-emptive Alert - Checklists.xlsx", the Facebook sheet). Checks every running Facebook
   campaign, ad set and ad against the sheet's limits; whatever breaks a point is saved (camp.fb_check_flags, shown highlighted
   in Campaign Analytics > Checklist) and the whole run goes out as ONE email (a count per point, then what broke each).

   WHEN (18 Nov 2026, Ayush): cron fb-checklist-daily every day 00:00 IST {kind:'daily'}; cron fb-checklist-weekly every Monday
   01:00 IST {kind:'weekly'}, judging the 7 days to yesterday (Mon-Sun) against the 7 before. {kind:'all'} does both; {dry:true} (any signed-in staff member - the tab's "Run now")
   only works it out: nothing saved, nothing sent.
   SCOPE: active campaigns / ad sets / ads that spent in the period. Anything named "Diamond" is left out (Ayush: "Dream Diamond
   exclude completely"); a project whose campaigns are off is not judged (Dream One). Lead points (CPL, CPQL, QL %, no leads,
   click to lead) judge lead / chat campaigns only. "No leads" points need at least Rs 500 spent, so a few rupees on a
   placement do not raise an alert every week.

   THE POINTS (sheet section - limit):
   1) Campaign + ad set: QL target (weekly, project: Gurukul 25, Dream One 8, Eco City 6, Valley 4, DWC 20) | Budget (daily,
      ABO ad set / CBO campaign daily budget below Rs 800) | CPL above 500 (red above 800) | CPQL above 4,000 | CTR below 1% |
      Frequency above 3 (all-time) | CPM above 120 | Reach down 50%+ on the week before | Delivery: Learning / Learning limited |
      QL % below 10% | Ad set types (daily, project): each needs LAL / Lookalike, Adv+ / Advantage+, Rem (Remarketing /
      Re-targeting), Property Interest and Broad ad sets (read from the names).
      Remarketing ad sets / campaigns (section 6): CPL above 1,200, CPQL above 5,000, Frequency above 8.
   2) Audience, ad set (daily, ad sets made in the last 2 days): size below 2 lakh | age from below 25. (Advantage+ audience: skipped.)
   3) Platform & placement, ad set (weekly): Facebook / Instagram spent with no leads | Feed / Reels / Stories spent with no leads.
   4) Video ad (weekly): no leads | ThruPlay rate below 10% (ThruPlays / impressions) | average play time below 6 s |
      ThumbStop below 15% (3-second plays / impressions) | click to lead below 2% | CTR below 1% | CPL 500 / 800 | QL % below 7% |
      CPQL above 4,000 | Reach down 50% | Delivery | Frequency above 3.
   5) Image ad (weekly): the same less the video points; click to lead below 5%.
   7) Spend (weekly, project): this month's spend above the month's budget (running daily budgets x days in the month).
   Skipped for now (Ayush): Advantage+ audience, spend vs budget +/-20%, quality / engagement / conversion rankings, lost reasons,
   site visit cohort, lead discrepancy, telecalling, trends; the Google and Landing Page sheets. */
import { SMTPClient } from "https://deno.land/x/denomailer@1.6.0/mod.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const SB = Deno.env.get('SUPABASE_URL')!, SRV = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, ANON = Deno.env.get('SUPABASE_ANON_KEY') || '';
const ADS = Deno.env.get('META_SYSTEM_USER_TOKEN') || Deno.env.get('META_ACCESS_TOKEN') || '';
const FBV = 'v21.0';
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

const LEAD_OBJ: Record<string, 1> = { OUTCOME_LEADS: 1, LEAD_GENERATION: 1, OUTCOME_SALES: 1, CONVERSIONS: 1, MESSAGES: 1 };
const LEAD_GOAL: Record<string, 1> = { CONVERSATIONS: 1, LEAD_GENERATION: 1, QUALITY_LEAD: 1, OFFSITE_CONVERSIONS: 1, MESSAGING_PURCHASE_CONVERSION: 1, MESSAGING_APPOINTMENT_CONVERSION: 1 };
const QL_TARGET: Record<string, number> = { 'dream gurukul': 25, 'dream one': 8, 'dream eco city': 6, 'dream valley': 4, 'dream world city': 20 };
const EXCLUDED = /diamond/i;
const REM = /\b(rem|remarketing|re-?marketing|re-?targeting|retarget\w*)\b/i;
const TYPES: [string, RegExp][] = [['LAL / Lookalike', /\b(lal|look\s*-?\s*a\s*-?\s*like|lookalike)\b/i], ['Adv+ / Advantage+', /\badv\s*\+|\badvantage\s*\+?/i],
  ['Rem (Remarketing / Re-targeting)', REM], ['Property Interest', /property\s*-?\s*interest/i], ['Broad', /\bbroad\b/i]];
const MIN_SPEND_NO_LEADS = 500;

async function allowed(req: Request) {
  const sec = req.headers.get('x-ads-secret');
  if (sec) { const { data } = await createClient(SB, SRV, { db: { schema: 'acc' } }).from('job_secrets').select('value').eq('name', 'ads_daily').maybeSingle(); return data && data.value === sec ? 'cron' : null; }
  const auth = req.headers.get('Authorization') || '';
  if (!/^Bearer\s+\S+/.test(auth) || !ANON) return null;
  const can = await fetch(`${SB}/rest/v1/rpc/pi_allowed`, { method: 'POST', body: '{}', headers: { apikey: ANON, Authorization: auth, 'Content-Type': 'application/json', 'Content-Profile': 'camp' } });
  return can.ok && (await can.json()) === true ? 'staff' : null;
}
async function fb(url: string) {
  const out: any[] = []; let next: string | null = url + (url.includes('?') ? '&' : '?') + 'access_token=' + ADS;
  for (let i = 0; next && i < 30; i++) {
    const r = await fetch(next); const t = await r.json().catch(() => ({}));
    if (!r.ok || t.error) throw new Error('Meta: ' + ((t.error && t.error.message) || r.status));
    out.push(...(t.data || [])); next = t.paging && t.paging.next ? t.paging.next : null;
    if (next && !/[?&]access_token=/.test(next)) next += '&access_token=' + ADS;
  }
  return out;
}
async function fbOne(path: string) { const r = await fetch(`https://graph.facebook.com/${FBV}/${path}${path.includes('?') ? '&' : '?'}access_token=${ADS}`); const t = await r.json().catch(() => ({})); if (!r.ok || t.error) throw new Error('Meta: ' + ((t.error && t.error.message) || r.status)); return t; }
async function pages(q: () => any) { const out: any[] = []; for (let p = 0; p < 200000; p += 1000) { const { data, error } = await q().range(p, p + 999); if (error) throw new Error(error.message); out.push(...(data || [])); if (!data || data.length < 1000) break; } return out; }
const act = (l: any, t: string) => { const x = (Array.isArray(l) ? l : []).find((y: any) => y && y.action_type === t); return x ? num(x.value) : 0; };
const actSum = (l: any) => (Array.isArray(l) ? l.reduce((s: number, x: any) => s + num(x && x.value), 0) : 0);
const leadsOf = (l: any) => (act(l, 'lead') || act(l, 'onsite_conversion.lead_grouped')) + act(l, 'onsite_conversion.messaging_conversation_started_7d');
const pn = (x: any) => String(x || '').toLowerCase().replace(/dream|banquets?/g, '').replace(/[^a-z0-9]/g, '');

type Flag = { kind: string; section: string; point: string; level: string; project: string; campaign_id?: string | null; adset_id?: string | null; ad_id?: string | null; name: string; campaign_name?: string | null; adset_name?: string | null; value: string; lim: string; sev: 'alert' | 'red' };

async function check(kinds: string[]) {
  const today = istDay(0), Y = addD(today, -1), W = { s: addD(Y, -6), e: Y }, P = { s: addD(Y, -13), e: addD(Y, -7) };
  const flags: Flag[] = [], notes: string[] = [];
  const add = (f: Flag) => flags.push(f);
  const { data: accs } = await db.from('ads_accounts').select('account_id,project,name').eq('platform', 'meta').eq('include', true);
  const accProj: Record<string, string> = {}; for (const a of accs || []) accProj[a.account_id] = a.project || a.name || a.account_id;
  const ent = await pages(() => db.from('ads_entities').select('kind,id,account_id,campaign_id,name,status,objective,daily_budget').eq('platform', 'meta').in('kind', ['campaign', 'adset']).order('id'));
  const C: Record<string, any> = {}, S: Record<string, any> = {};
  for (const e of ent) { if (!accProj[e.account_id]) continue; (e.kind === 'campaign' ? C : S)[e.id] = e; }
  const leadSet: Record<string, 1> = {}; for (const s of Object.values(S)) if (LEAD_GOAL[s.objective]) leadSet[s.campaign_id] = 1;
  const isLead = (cid: string) => !!(C[cid] && LEAD_OBJ[C[cid].objective]) || !!leadSet[cid];
  const live = (x: any) => x && String(x.status || '') === 'ACTIVE';
  const campOk = (cid: string) => live(C[cid]) && !EXCLUDED.test(C[cid].name || '');
  const setOk = (sid: string) => live(S[sid]) && campOk(S[sid].campaign_id) && !EXCLUDED.test(S[sid].name || '');
  const projOf = (cid: string) => (C[cid] ? accProj[C[cid].account_id] : '');
  const remC = (cid: string) => REM.test((C[cid] && C[cid].name) || '');
  const remS = (sid: string) => REM.test((S[sid] && S[sid].name) || '') || remC(S[sid] && S[sid].campaign_id);
  // spending = spent something in the last 3 days (a campaign marked active that is not spending is not judged)
  const sp3: Record<string, 1> = {}; for (const r of await pages(() => db.from('ads_daily').select('campaign_id').eq('platform', 'meta').gte('day', addD(today, -3)).gt('spend', 0).order('campaign_id'))) sp3[r.campaign_id] = 1;
  const activeProjects = new Set(Object.keys(C).filter((c) => campOk(c) && sp3[c]).map(projOf));
  const accsLive = [...new Set(Object.keys(C).filter(campOk).map((c) => C[c].account_id))];

  /* ------------------------------------------------------------------ DAILY */
  if (kinds.includes('daily')) {
    const K = 'daily', S1 = '1) Campaign + Ad Set', S2 = '2) Audience (Ad Set)';
    // Budget: ABO ad sets / CBO campaigns, daily budget below Rs 800
    // (an ad set on a lifetime budget shows a daily budget of 0 - not judged here)
    for (const cid of Object.keys(C).filter((c) => campOk(c) && sp3[c])) {
      const sets = Object.keys(S).filter((s) => S[s].campaign_id === cid && setOk(s));
      const abo = sets.some((s) => num(S[s].daily_budget) > 0);
      if (abo) { for (const s of sets) if (num(S[s].daily_budget) > 0 && num(S[s].daily_budget) < 800) add({ kind: K, section: S1, point: 'Budget', level: 'adset', project: projOf(cid), campaign_id: cid, adset_id: s, name: S[s].name, value: inr(num(S[s].daily_budget)) + ' a day (ABO)', lim: 'Not less than ₹800', sev: 'alert' }); }
      else if (num(C[cid].daily_budget) > 0 && num(C[cid].daily_budget) < 800) add({ kind: K, section: S1, point: 'Budget', level: 'campaign', project: projOf(cid), campaign_id: cid, name: C[cid].name, value: inr(num(C[cid].daily_budget)) + ' a day (CBO)', lim: 'Not less than ₹800', sev: 'alert' });
    }
    // Ad set types each project's running ad sets should have, read from their names
    for (const p of activeProjects) {
      const names = Object.keys(S).filter((s) => setOk(s) && sp3[S[s].campaign_id] && projOf(S[s].campaign_id) === p).map((s) => S[s].name || '');
      const miss = TYPES.filter(([, re]) => !names.some((n) => re.test(n))).map(([t]) => t);
      if (miss.length) add({ kind: K, section: S1, point: 'Ad set types', level: 'project', project: p, name: p, value: 'Missing: ' + miss.join(', '), lim: 'LAL, Adv+, Rem, Property Interest and Broad ad sets', sev: 'alert' });
    }
    // Audience of ad sets made in the last 2 days: size below 2 lakh, age from below 25
    const since = Date.now() - 2 * 86400_000;
    await Promise.all(accsLive.map(async (acc) => {
      try {
        const filt = encodeURIComponent(JSON.stringify([{ field: 'effective_status', operator: 'IN', value: ['ACTIVE'] }]));
        const sets = await fb(`https://graph.facebook.com/${FBV}/act_${acc}/adsets?fields=id,name,campaign_id,created_time,targeting&filtering=${filt}&limit=200`);
        for (const s of sets) {
          if (!s.created_time || Date.parse(s.created_time) < since || !campOk(s.campaign_id) || !sp3[s.campaign_id] || EXCLUDED.test(s.name || '')) continue;
          const t = s.targeting || {}, p = projOf(s.campaign_id);
          if (t.age_min != null && num(t.age_min) < 25) add({ kind: K, section: S2, point: 'Age', level: 'adset', project: p, campaign_id: s.campaign_id, adset_id: s.id, name: s.name, value: 'From ' + t.age_min, lim: 'Not below 25', sev: 'alert' });
          try { const d = ((await fbOne(`${s.id}/delivery_estimate?fields=estimate_mau_lower_bound,estimate_mau_upper_bound`)).data || [])[0];
            if (d && d.estimate_mau_lower_bound != null && num(d.estimate_mau_lower_bound) < 200000) add({ kind: K, section: S2, point: 'Audience size', level: 'adset', project: p, campaign_id: s.campaign_id, adset_id: s.id, name: s.name, value: num(d.estimate_mau_lower_bound).toLocaleString('en-IN') + ' – ' + num(d.estimate_mau_upper_bound).toLocaleString('en-IN'), lim: 'Not below 2,00,000', sev: 'alert' }); } catch (_) { /* no estimate */ }
        }
      } catch (e) { notes.push(acc + ' audience: ' + String((e as Error).message).slice(0, 140)); }
    }));
  }

  /* ------------------------------------------------------------------ WEEKLY */
  if (kinds.includes('weekly')) {
    const K = 'weekly', S1 = '1) Campaign + Ad Set', S3 = '3) Platform & Placement (Ad Set)', S4 = '4) Video creative (Ad)', S5 = '5) Image creative (Ad)', S7 = '7) Spend';
    // stored figures for the week
    const camp = await pages(() => db.from('ads_daily').select('campaign_id,spend,impressions,clicks,results').eq('platform', 'meta').gte('day', W.s).lte('day', W.e).order('day').order('campaign_id'));
    const adr = await pages(() => db.from('ads_ad_daily').select('ad_id,adset_id,campaign_id,spend,impressions,clicks,results').eq('platform', 'meta').gte('day', W.s).lte('day', W.e).order('day').order('ad_id').order('adset_id'));
    const sum = (m: Record<string, any>, k: string, r: any) => { const x = m[k] = m[k] || { spend: 0, impressions: 0, clicks: 0, results: 0, campaign_id: r.campaign_id, adset_id: r.adset_id }; x.spend += num(r.spend); x.impressions += num(r.impressions); x.clicks += num(r.clicks); x.results += num(r.results); };
    const cW: Record<string, any> = {}, sW: Record<string, any> = {}, aW: Record<string, any> = {};
    for (const r of camp) sum(cW, r.campaign_id, r);
    for (const r of adr) { if (r.adset_id) sum(sW, r.adset_id, r); sum(aW, r.ad_id, r); }
    // the CRM's qualified leads: per campaign (and per project), per ad set, per ad
    const crm = await pages(() => db.from('crm_google_daily').select('business_unit,campaign_id,leads,qualified').eq('campaign_type', 'facebook').gte('day', W.s).lte('day', W.e).order('day').order('campaign_id').order('business_unit'));
    const projN: Record<string, string> = {}; for (const p of Object.values(accProj)) projN[pn(p)] = p;
    const qlC: Record<string, number> = {}, qlP: Record<string, number> = {}, qlWa: Record<string, number> = {};
    for (const r of crm) { const id = String(r.campaign_id || ''); qlC[id] = (qlC[id] || 0) + num(r.qualified); const p = C[id] ? projOf(id) : (projN[pn(r.business_unit)] || r.business_unit); qlP[p] = (qlP[p] || 0) + num(r.qualified);
      if (/^whatsapp/i.test(id)) qlWa[p] = (qlWa[p] || 0) + num(r.qualified); }
    /* WHATSAPP CAMPAIGNS: the CRM counts all of a project's WhatsApp campaigns on one line, not per campaign. A project's only
       WhatsApp campaign gets that line (as on the Campaigns tab); with two or more, a campaign's QL is unknown - not 0. */
    const waSet: Record<string, 1> = {}; for (const sd of Object.values(S)) if (/CONVERSATIONS|MESSAGING/.test(String(sd.objective || ''))) waSet[sd.campaign_id] = 1;
    const waBy: Record<string, string[]> = {}; for (const cid of Object.keys(cW)) if (waSet[cid] && campOk(cid) && cW[cid].spend > 0) (waBy[projOf(cid)] = waBy[projOf(cid)] || []).push(cid);
    const qlCamp = (cid: string) => { if (waSet[cid]) { const l = waBy[projOf(cid)] || []; return l.length === 1 ? (qlWa[projOf(cid)] || 0) : null; } return qlC[cid] != null ? qlC[cid] : 0; };
    const crmS = await pages(() => db.from('crm_adset_daily').select('level,campaign_id,adset_id,ad_id,qualified').eq('src', 'facebook').gte('day', W.s).lte('day', W.e).order('day').order('level').order('adset_id').order('ad_id'));
    const qlS: Record<string, number> = {}, qlA: Record<string, number> = {}, setsTracked: Record<string, 1> = {}, adsTracked: Record<string, 1> = {};
    for (const r of crmS) { if (r.level === 'adset') { qlS[r.adset_id] = (qlS[r.adset_id] || 0) + num(r.qualified); setsTracked[r.campaign_id] = 1; } else if (r.level === 'ad') { qlA[r.ad_id] = (qlA[r.ad_id] || 0) + num(r.qualified); adsTracked[r.campaign_id] = 1; } }
    // a campaign the CRM keeps no ad set / ad tracking for (WhatsApp ones): its ad sets' / ads' QL is unknown, not 0
    // ads that ran: names and status
    const adIds = Object.keys(aW); const AE: Record<string, any> = {};
    for (let i = 0; i < adIds.length; i += 200) { const { data } = await db.from('ads_entities').select('id,name,status').eq('platform', 'meta').eq('kind', 'ad').in('id', adIds.slice(i, i + 200)); for (const x of data || []) AE[x.id] = x; }
    // QL target per project
    for (const p of activeProjects) { const tg = QL_TARGET[String(p).toLowerCase()]; if (tg == null) continue; const q = qlP[p] || 0;
      if (q < tg) add({ kind: K, section: S1, point: 'QL target', level: 'project', project: p, name: p, value: q + ' QL in 7 days', lim: 'Target ' + tg, sev: 'alert' }); }
    // live from Meta per account: reach this week / last week, all-time frequency, delivery, placements, video
    const reachW: Record<string, number> = {}, reachP: Record<string, number> = {}, freq: Record<string, number> = {}, learn: Record<string, string> = {};
    const plat: Record<string, Record<string, { spend: number; leads: number }>> = {}, vid: Record<string, any> = {};
    const tr = (x: { s: string; e: string }) => encodeURIComponent(JSON.stringify({ since: x.s, until: x.e }));
    const activeF = encodeURIComponent(JSON.stringify([{ field: 'campaign.effective_status', operator: 'IN', value: ['ACTIVE'] }]));
    await Promise.all(accsLive.map(async (acc) => {
      const base = `https://graph.facebook.com/${FBV}/act_${acc}/insights?use_unified_attribution_setting=true&limit=500&filtering=${activeF}`;
      const tryIt = async (what: string, fn: () => Promise<void>) => { try { await fn(); } catch (e) { notes.push(acc + ' ' + what + ': ' + String((e as Error).message).slice(0, 140)); } };
      await Promise.all([
        ...['campaign', 'adset', 'ad'].map((lv) => tryIt('reach ' + lv, async () => {
          for (const r of await fb(`${base}&level=${lv}&time_range=${tr(W)}&fields=${lv}_id,reach`)) reachW[lv + ':' + r[lv + '_id']] = num(r.reach);
          for (const r of await fb(`${base}&level=${lv}&time_range=${tr(P)}&fields=${lv}_id,reach`)) reachP[lv + ':' + r[lv + '_id']] = num(r.reach);
          for (const r of await fb(`${base}&level=${lv}&date_preset=maximum&fields=${lv}_id,frequency`)) freq[lv + ':' + r[lv + '_id']] = num(r.frequency);
        })),
        tryIt('delivery', async () => {
          const f = encodeURIComponent(JSON.stringify([{ field: 'effective_status', operator: 'IN', value: ['ACTIVE'] }]));
          for (const s of await fb(`https://graph.facebook.com/${FBV}/act_${acc}/adsets?fields=id,learning_stage_info&filtering=${f}&limit=200`)) {
            const st = s.learning_stage_info && s.learning_stage_info.status; if (st === 'LEARNING') learn[s.id] = 'Learning'; else if (st === 'FAIL') learn[s.id] = 'Learning limited'; }
        }),
        tryIt('placements', async () => {
          for (const r of await fb(`${base}&level=adset&time_range=${tr(W)}&breakdowns=publisher_platform,platform_position&fields=adset_id,spend,actions`)) {
            const m = plat[r.adset_id] = plat[r.adset_id] || {}; const pp = String(r.publisher_platform || ''), pos = String(r.platform_position || '');
            const keys = [pp === 'facebook' ? 'Facebook' : pp === 'instagram' ? 'Instagram' : '', /feed/.test(pos) ? 'Feed' : /reels/.test(pos) ? 'Reels' : /stor/.test(pos) ? 'Stories' : ''].filter(Boolean);
            for (const k of keys) { const x = m[k] = m[k] || { spend: 0, leads: 0 }; x.spend += num(r.spend); x.leads += leadsOf(r.actions); } }
        }),
        tryIt('video', async () => {
          for (const r of await fb(`${base}&level=ad&time_range=${tr(W)}&fields=ad_id,impressions,actions,video_play_actions,video_thruplay_watched_actions,video_avg_time_watched_actions`))
            vid[r.ad_id] = { imp: num(r.impressions), plays: actSum(r.video_play_actions), thru: actSum(r.video_thruplay_watched_actions), avg: actSum(r.video_avg_time_watched_actions), v3: act(r.actions, 'video_view') };
        }),
      ]);
    }));
    // the campaign / ad set / ad points
    const judge = (level: 'campaign' | 'adset' | 'ad', id: string, x: any, ctx: { cid: string; sid?: string | null; name: string; rem: boolean; lead: boolean; ql: number | null; section: string; qlMin: number; isVideo?: boolean }) => {
      const p = projOf(ctx.cid), base = { kind: K, section: ctx.section, level, project: p, campaign_id: ctx.cid, adset_id: level === 'campaign' ? null : ctx.sid || null, ad_id: level === 'ad' ? id : null, name: ctx.name };
      const sp = x.spend, imp = x.impressions, clk = x.clicks, ld = x.results;
      if (ctx.lead) {
        if (level === 'ad' && ld === 0 && sp >= MIN_SPEND_NO_LEADS) add({ ...base, point: ctx.isVideo ? 'Video – no leads' : 'Image – no leads', value: inr(sp) + ' spent, 0 leads', lim: 'Leads expected', sev: 'alert' });
        if (ld > 0) { const cpl = sp / ld, lim = ctx.rem ? 1200 : 500;
          if (cpl > lim) add({ ...base, point: 'CPL', value: inr(cpl) + ' (' + ld + ' leads)', lim: ctx.rem ? 'Remarketing: not above ₹1,200' : 'Not above ₹500 (red above ₹800)', sev: !ctx.rem && cpl > 800 ? 'red' : 'alert' }); }
        if (ctx.ql != null) { const lim = ctx.rem ? 5000 : 4000;
          if (ctx.ql > 0 ? sp / ctx.ql > lim : sp > lim) add({ ...base, point: 'CPQL', value: ctx.ql > 0 ? inr(sp / ctx.ql) + ' (' + ctx.ql + ' QL)' : 'No QL, ' + inr(sp) + ' spent', lim: 'Not above ' + inr(lim) + (ctx.rem ? ' (Remarketing)' : ''), sev: 'alert' });
          if (ld > 0 && ctx.ql / ld * 100 < ctx.qlMin) add({ ...base, point: 'QL %', value: pc(ctx.ql / ld * 100, 1) + ' (' + ctx.ql + ' of ' + ld + ')', lim: 'Not below ' + ctx.qlMin + '%', sev: 'alert' }); }
        if (level === 'ad' && clk > 0) { const ctl = ld / clk * 100, lim = ctx.isVideo ? 2 : 5; if (ctl < lim) add({ ...base, point: 'Click to lead', value: pc(ctl), lim: 'Not below ' + lim + '%', sev: 'alert' }); }
      }
      if (imp > 0 && clk / imp * 100 < 1) add({ ...base, point: 'CTR', value: pc(clk / imp * 100), lim: 'Not below 1%', sev: 'alert' });
      if (level !== 'ad' && imp > 0 && sp / imp * 1000 > 120) add({ ...base, point: 'CPM', value: inr(sp / imp * 1000), lim: 'Not above ₹120', sev: 'alert' });
      const f = freq[level + ':' + id], fl = ctx.rem ? 8 : 3;
      if (f != null && f > fl) add({ ...base, point: 'Frequency', value: f.toFixed(2) + ' (all time)', lim: 'Not above ' + fl + (ctx.rem ? ' (Remarketing)' : ''), sev: 'alert' });
      const rw = reachW[level + ':' + id], rp = reachP[level + ':' + id];
      if (rp > 0 && (rw || 0) < rp * 0.5) add({ ...base, point: 'Reach drop', value: (rw || 0).toLocaleString('en-IN') + ' vs ' + rp.toLocaleString('en-IN') + ' the week before', lim: 'Not down 50% or more', sev: 'alert' });
      const lsid = level === 'campaign' ? null : ctx.sid; if (lsid && learn[lsid]) add({ ...base, point: 'Delivery', value: learn[lsid], lim: 'Active', sev: learn[lsid] === 'Learning limited' ? 'red' : 'alert' });
    };
    for (const cid of Object.keys(cW)) { if (!campOk(cid) || cW[cid].spend <= 0) continue;
      judge('campaign', cid, cW[cid], { cid, name: C[cid].name, rem: remC(cid), lead: isLead(cid), ql: qlCamp(cid), section: S1, qlMin: 10 }); }
    for (const sid of Object.keys(sW)) { if (!setOk(sid) || sW[sid].spend <= 0) continue; const cid = S[sid].campaign_id;
      judge('adset', sid, sW[sid], { cid, sid, name: S[sid].name, rem: remS(sid), lead: isLead(cid), ql: qlS[sid] != null ? qlS[sid] : (setsTracked[cid] ? 0 : null), section: S1, qlMin: 10 });
      // platform & placement: spent with no leads (lead campaigns)
      if (isLead(cid)) for (const [k, x] of Object.entries(plat[sid] || {})) if (x.spend >= MIN_SPEND_NO_LEADS && x.leads === 0)
        add({ kind: K, section: S3, point: k === 'Facebook' || k === 'Instagram' ? k + ' platform – no leads' : 'Placement – no leads', level: 'adset', project: projOf(cid), campaign_id: cid, adset_id: sid, name: S[sid].name + (k === 'Facebook' || k === 'Instagram' ? '' : ' · ' + k), value: inr(x.spend) + ' spent on ' + k + ', 0 leads', lim: 'Leads expected', sev: 'alert' }); }
    for (const aid of Object.keys(aW)) { const x = aW[aid], sid = x.adset_id, cid = x.campaign_id; if (!sid || !setOk(sid) || x.spend <= 0) continue; if (AE[aid] && !live(AE[aid])) continue;
      const v = vid[aid], isVideo = !!(v && v.plays > 0), name = (AE[aid] && AE[aid].name) || aid, section = isVideo ? S4 : S5;
      judge('ad', aid, x, { cid, sid, name, rem: remS(sid), lead: isLead(cid), ql: qlA[aid] != null ? qlA[aid] : (adsTracked[cid] ? 0 : null), section, qlMin: 7, isVideo });
      if (isVideo && v.imp > 0) { const base = { kind: K, section: S4, level: 'ad', project: projOf(cid), campaign_id: cid, adset_id: sid, ad_id: aid, name };
        if (v.thru / v.imp * 100 < 10) add({ ...base, point: 'ThruPlay rate', value: pc(v.thru / v.imp * 100), lim: 'Not below 10%', sev: 'alert' });
        if (v.avg > 0 && v.avg < 6) add({ ...base, point: 'Average video play time', value: v.avg.toFixed(1) + ' s', lim: 'Not below 6 s', sev: 'alert' });
        if (v.v3 / v.imp * 100 < 15) add({ ...base, point: 'ThumbStop ratio', value: pc(v.v3 / v.imp * 100), lim: 'Not below 15%', sev: 'alert' }); } }
    // Spend: this month's spend above the month's budget (running daily budgets x days in the month)
    const m0 = Y.slice(0, 8) + '01', dim = new Date(Date.UTC(+Y.slice(0, 4), +Y.slice(5, 7), 0)).getUTCDate();
    const mtd = await pages(() => db.from('ads_daily').select('campaign_id,spend').eq('platform', 'meta').gte('day', m0).lte('day', Y).order('day').order('campaign_id'));
    const spP: Record<string, number> = {}; for (const r of mtd) { if (!C[r.campaign_id] || EXCLUDED.test(C[r.campaign_id].name || '')) continue; const p = projOf(r.campaign_id); spP[p] = (spP[p] || 0) + num(r.spend); }
    const budP: Record<string, number> = {}; for (const cid of Object.keys(C).filter((c) => campOk(c) && sp3[c])) { if (C[cid].daily_budget == null) continue; const p = projOf(cid); budP[p] = (budP[p] || 0) + num(C[cid].daily_budget); }
    for (const p of activeProjects) { const b = (budP[p] || 0) * dim, s = spP[p] || 0;
      if (b > 0 && s > b) add({ kind: K, section: S7, point: 'Monthly budget', level: 'project', project: p, name: p, value: inr(s) + ' spent this month', lim: 'Budget ' + inr(b) + ' (' + inr(budP[p]) + ' a day × ' + dim + ' days)', sev: 'red' }); }
  }
  // where each ad set / ad sits - the campaign and ad set names go with every alert (the Checklist tab, the public link, the PDF)
  for (const f of flags) { f.campaign_name = f.campaign_id && C[f.campaign_id] ? C[f.campaign_id].name : null; f.adset_name = f.adset_id && S[f.adset_id] ? S[f.adset_id].name : null; }
  return { today, W, P, flags, notes };
}

/* ONE COMBINED EMAIL PER RUN (18 Nov 2026, Ayush: "One combined email"). A count of every point at the top, then each point
   with what broke it - red first, at most 10 per point so the mail stays under Gmail's clipping size; the rest are in the
   Checklist tab (and all of them in the plain-text part). */
const PER_POINT = 10;
function emailHtml(groups: [string, Flag[]][], period: string, total: number, reds: number) {
  const PORTAL = (Deno.env.get('PORTAL_URL') || 'https://jaingroupe.netlify.app').replace(/\/$/, '');
  const lv: Record<string, string> = { project: 'Project', campaign: 'Campaign', adset: 'Ad set', ad: 'Ad' };
  const summary = groups.map(([k, rows]) => { const [section, point] = k.split('|'), r = rows.filter((f) => f.sev === 'red').length;
    return '<tr><td class=g>' + esc(section) + '</td><td><b>' + esc(point) + '</b></td><td class=n>' + rows.length + (r ? ' <span class=r>(' + r + ' red)</span>' : '') + '</td></tr>'; }).join('');
  const blocks = groups.map(([k, rows]) => { const [section, point] = k.split('|');
    const list = rows.slice().sort((x, y) => (x.sev === 'red' ? 0 : 1) - (y.sev === 'red' ? 0 : 1)).slice(0, PER_POINT);
    return '<h3>' + esc(point) + ' <span class=g>· ' + esc(section) + ' · ' + rows.length + ' · limit: ' + esc(rows[0].lim) + '</span></h3><table>'
      + list.map((f) => '<tr class=' + (f.sev === 'red' ? 'x' : 'a') + '><td class=g>' + esc(f.project) + '</td><td class=g>' + esc(lv[f.level] || f.level) + '</td><td>' + esc(f.name) + '</td><td class=v>' + esc(f.value) + '</td></tr>').join('')
      + (rows.length > PER_POINT ? '<tr><td colspan=4 class=g>+' + (rows.length - PER_POINT) + ' more in the Checklist tab</td></tr>' : '') + '</table>'; }).join('');
  return '<html><head><style>body{margin:0;background:#f1f5f9;font-family:Segoe UI,Arial,sans-serif}.w{max-width:780px;margin:20px auto;background:#fff;border:1px solid #e2e8f0;border-radius:12px;overflow:hidden}.h{background:#111;padding:14px 22px;border-bottom:2px solid #e0121c;color:#e5e7eb;font-size:12px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase}.b{padding:18px 22px}table{width:100%;border-collapse:collapse;font-size:12.5px}td{padding:5px 8px;border-bottom:1px solid #eef1f4;vertical-align:top}.g{color:#64748b}.n{text-align:right;font-weight:700}.r{color:#dc2626}h3{margin:18px 0 6px;font-size:14px;color:#0f172a}h3 .g{font-weight:500;font-size:12px}tr.a td:first-child{border-left:3px solid #d97706}tr.x td:first-child{border-left:3px solid #dc2626}tr.a .v{color:#b45309;font-weight:700;white-space:nowrap}tr.x .v{color:#dc2626;font-weight:700;white-space:nowrap}.f{padding:12px 22px;background:#f8fafc;border-top:1px solid #e2e8f0;color:#94a3b8;font-size:12px}.btn{display:inline-block;background:#e0121c;color:#fff;text-decoration:none;padding:9px 18px;border-radius:8px;font-size:13px;font-weight:600}</style></head><body><div class=w>'
    + '<div class=h>JAIN-E · Facebook Checklist</div><div class=b><p style="margin:0 0 4px;font-size:16px;font-weight:700">' + total + ' to look at' + (reds ? ' · <span class=r>' + reds + ' red</span>' : '') + '</p><p class=g style="margin:0 0 14px;font-size:13px">' + esc(period) + '</p>'
    + '<table>' + summary + '</table>' + blocks
    // white text set on the link itself and on a span inside it: Gmail drops a stylesheet's link colour and paints links blue (19 Nov 2026)
    + '<p style="margin-top:18px"><a class=btn href="' + PORTAL + '/campaigns.html" style="display:inline-block;background:#e0121c;color:#ffffff !important;text-decoration:none;padding:9px 18px;border-radius:8px;font-size:13px;font-weight:600"><span style="color:#ffffff">Open the Checklist</span></a></p></div><div class=f>Automated alert from JAIN-E Campaign Analytics. Please do not reply.</div></div></body></html>';
}
function b64Part(mimeType: string, s: string) {
  const bytes = new TextEncoder().encode(s); let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return { mimeType: `${mimeType}; charset="utf-8"`, content: btoa(bin).replace(/.{76}(?=.)/g, '$&\r\n'), transferEncoding: 'base64' };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  const who = await allowed(req); if (!who) return j({ error: 'not allowed' }, 401);
  let body: any = {}; try { body = await req.json(); } catch (_) { /* empty */ }
  const dry = who !== 'cron' || !!body.dry;   // only the cron saves and sends
  const monday = new Date(Date.parse(istDay(0) + 'T00:00:00Z')).getUTCDay() === 1;
  const kinds = body.kind === 'all' ? ['daily', 'weekly'] : body.kind === 'weekly' ? ['weekly'] : body.kind === 'daily' ? ['daily'] : (monday ? ['daily', 'weekly'] : ['daily']);
  if (!ADS) return j({ error: 'no Facebook key' }, 500);
  const r = await check(kinds);
  if (dry) return j({ ok: true, dry: true, kinds, period: r.W, flags: r.flags, notes: r.notes });
  const out: any = { ok: true, kinds, saved: {}, emailed: 0, notes: r.notes };
  const GU = Deno.env.get('GMAIL_USER'), GP = Deno.env.get('GMAIL_APP_PASSWORD');
  const runIds: number[] = [], mail: Flag[] = [];
  for (const kind of kinds) {
    const fl = r.flags.filter((f) => f.kind === kind);
    const per = kind === 'weekly' ? { from: r.W.s, to: r.W.e } : { from: r.today, to: r.today };
    const { data: run, error } = await db.from('fb_check_runs').insert({ kind, run_day: r.today, period_from: per.from, period_to: per.to, flags: fl.length, notes: r.notes.join(' | ').slice(0, 2000) || null }).select('id').single();
    if (error) { out.saved[kind] = 'not saved: ' + error.message; continue; }   // already ran today, or the table is not there yet
    for (let i = 0; i < fl.length; i += 500) await db.from('fb_check_flags').insert(fl.slice(i, i + 500).map((f) => ({ ...f, run_id: run.id })));
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
      await client.send({ from: GU, to: TO, subject: 'Facebook Checklist: ' + mail.length + ' to look at' + (reds ? ', ' + reds + ' red' : '') + ' (' + r.today + ')', mimeContent: [b64Part('text/plain', text), b64Part('text/html', emailHtml(list, period, mail.length, reds))] });
      out.emailed = 1;
      await db.from('fb_check_runs').update({ emailed: 1 }).in('id', runIds);
    } catch (e) { out.notes.push('email: ' + String((e as Error).message).slice(0, 160)); }
    finally { try { if (client) await client.close(); } catch (_) { /* ignore */ } }
  }
  return j(out);
});
