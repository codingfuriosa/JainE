// public-intel - public, logged-out competitor + own-brand data for Competitor Ads (Google Ads,
// RERA Projects, Search Trends tabs). Lives in the old qual-test slot (the project is at its
// edge-function limit; the user agreed to replace that unused test function).
//
// HOW. Each site is read through the same requests its own public page makes, without any login,
// account or key: adstransparency.google.com's SearchService RPC, rera.wb.gov.in's project list and
// project pages, and trends.google.com's explore -> widgetdata calls.
//
// GENTLE BY DESIGN. The cron calls `tick` every 5 minutes. A tick does at most ONE small unit per
// source, and only if that unit is due:
//   google_ads   one advertiser/domain, <= 5 pages 6 s apart; each target once a day, 10 min apart
//   rera_list    both public lists (approved, rejected), once a week
//   rera_detail  6 project pages 4 s apart (first pass: every project once, newest first; then
//                followed promoters weekly, everyone else every 90 days)
//   trends       one group in one region, 3 requests ~10 s apart; each once a week, 10 min apart
// A site that answers "too many requests" or shows a CAPTCHA page is left alone for 6 hours. The
// CAPTCHA is never solved or worked around.
//
// TRACEABLE. Every unit writes camp.pi_runs (ok or not, HTTP status, error), every stored row keeps
// fetched_at, the run id and the public URL it came from. A failed unit stores nothing partial.
//
// WHO MAY CALL. The cron (x-pi-secret = acc.job_secrets 'public_intel'), or a signed-in staff member
// (camp.pi_allowed()) for "Fetch now", which runs one unit of the chosen source even if not due.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.47.10";
import { gadsCreatives, reraList, reraDetail, trendsPoints } from "./parse.ts";

const SB = Deno.env.get('SUPABASE_URL')!, SRV = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, ANON = Deno.env.get('SUPABASE_ANON_KEY')!;
const db = createClient(SB, SRV, { db: { schema: 'camp' } });
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-pi-secret', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
const j = (o: unknown, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } });
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const HOUR = 3600e3;

class Refused extends Error { status: number; constructor(m: string, s: number) { super(m); this.status = s; } }
const looksBlocked = (status: number, text: string) => status === 429 || /recaptcha|unusual traffic|captcha-form/i.test(text.slice(0, 4000));

// ---------------------------------------------------------------- run log
async function runStart(source: string, unit: string, trigger: string) {
  const { data, error } = await db.from('pi_runs').insert({ source, unit, trigger }).select('id').single();
  if (error) throw new Error('pi_runs insert: ' + error.message);
  return data.id as number;
}
async function runEnd(id: number, r: { ok: boolean; http_status?: number | null; refused?: boolean; items?: number | null; note?: string | null; error?: string | null }) {
  await db.from('pi_runs').update({ finished_at: new Date().toISOString(), ok: r.ok, http_status: r.http_status ?? null, refused: !!r.refused, items: r.items ?? null, note: r.note ?? null, error: r.error ?? null }).eq('id', id);
}
async function lastRuns(source: string, sinceMs: number) {
  const { data } = await db.from('pi_runs').select('unit,ok,refused,started_at').eq('source', source)
    .gte('started_at', new Date(Date.now() - sinceMs).toISOString()).order('started_at', { ascending: false }).limit(1000);
  return data || [];
}
// Common gate: refused in the last 6 h -> wait; anything started in the last `gapMs` -> wait.
async function gate(source: string, gapMs: number) {
  const runs = await lastRuns(source, 6 * HOUR);
  if (runs.some((r: any) => r.refused)) return 'site refused us in the last 6 hours - waiting';
  if (runs.some((r: any) => Date.now() - Date.parse(r.started_at) < gapMs)) return 'spacing - a run started less than ' + Math.round(gapMs / 60000) + ' min ago';
  return null;
}
// Wraps one unit: run row, timing, refusal handling.
async function unit(source: string, name: string, trigger: string, fn: (runId: number) => Promise<{ items: number; note?: string; http_status?: number }>) {
  const id = await runStart(source, name, trigger);
  try {
    const r = await fn(id);
    await runEnd(id, { ok: true, items: r.items, note: r.note ?? null, http_status: r.http_status ?? 200 });
    return { source, unit: name, ok: true, ...r };
  } catch (e) {
    const refused = e instanceof Refused;
    await runEnd(id, { ok: false, refused, http_status: refused ? (e as Refused).status : null, error: String((e as Error).message || e).slice(0, 1000) });
    return { source, unit: name, ok: false, refused, error: String((e as Error).message || e) };
  }
}
async function upsertChunks(table: string, rows: any[], onConflict: string) {
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await db.from(table).upsert(rows.slice(i, i + 500), { onConflict });
    if (error) throw new Error(table + ' upsert: ' + error.message);
  }
}

// ---------------------------------------------------------------- Google Ads Transparency Center
const GADS = 'https://adstransparency.google.com/anji/_/rpc/SearchService/SearchCreatives?authuser=';
async function gadsTick(trigger: string, force: boolean) {
  const wait = await gate('google_ads', force ? 2 * 60e3 : 10 * 60e3);
  if (wait) return { source: 'google_ads', skipped: wait };
  const { data: targets } = await db.from('pi_targets').select('*').eq('source', 'google_ads').eq('active', true).order('sort');
  const okRecently = new Set((await lastRuns('google_ads', 20 * HOUR)).filter((r: any) => r.ok).map((r: any) => r.unit));
  const key = (t: any) => t.kind + ':' + t.value;
  // forced: the stalest target even if done today; otherwise only targets not done in 20 h
  const due = (targets || []).filter((t: any) => !okRecently.has(key(t)));
  const t = due[0] || (force ? (targets || [])[0] : null);
  if (!t) return { source: 'google_ads', skipped: 'nothing due' };
  return unit('google_ads', key(t), trigger, async (runId) => {
    const filter: any = { '8': [2356] };   // 2356 = India, as the site's own region picker sends it
    if (t.kind === 'advertiser') filter['13'] = { '1': [t.value] }; else filter['12'] = { '1': t.value, '2': true };
    let token: string | null = null, page = 0, n = 0, status = 200, more = false;
    const seen: any[] = [];
    do {
      if (page) await sleep(6000);
      const req: any = { '2': 40, '3': filter, '7': { '1': 1, '2': 0, '3': 2356 } };
      if (token) req['4'] = token;
      const r = await fetch(GADS, { method: 'POST', headers: { 'User-Agent': UA, 'Content-Type': 'application/x-www-form-urlencoded', Origin: 'https://adstransparency.google.com', Referer: 'https://adstransparency.google.com/?region=IN' }, body: 'f.req=' + encodeURIComponent(JSON.stringify(req)) });
      const text = await r.text(); status = r.status;
      if (looksBlocked(r.status, text)) throw new Refused('Google showed a rate-limit/CAPTCHA page (HTTP ' + r.status + ') on page ' + (page + 1), r.status);
      if (!r.ok) throw new Error('HTTP ' + r.status + ' on page ' + (page + 1));
      let json: any; try { json = JSON.parse(text); } catch (_) { throw new Error('reply was not JSON on page ' + (page + 1)); }
      const { creatives, next } = gadsCreatives(json);
      seen.push(...creatives); n += creatives.length; page++;
      token = next; more = !!next;
    } while (token && page < 5);
    const now = new Date().toISOString();
    await upsertChunks('pi_gads_creatives', seen.map((c) => ({ ...c, region: 'IN', target_id: t.id, watchlist_id: t.watchlist_id, fetched_at: now, run_id: runId })), 'creative_id');
    return { items: n, http_status: status, note: page + ' page(s)' + (more ? '; more exist beyond 5 pages (newest kept)' : '') };
  });
}

// ---------------------------------------------------------------- WBRERA
const RERA = 'https://rera.wb.gov.in/';
async function reraGet(path: string) {
  const r = await fetch(RERA + path, { headers: { 'User-Agent': UA, 'Accept-Language': 'en-IN,en;q=0.9', Referer: RERA } });
  const text = await r.text();
  if (looksBlocked(r.status, text)) throw new Refused('RERA refused (HTTP ' + r.status + ')', r.status);
  if (!r.ok) throw new Error('HTTP ' + r.status + ' for ' + path);
  return text;
}
async function existingRera(cols: string) {
  const out: any[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db.from('pi_rera_projects').select(cols).range(from, from + 999);
    if (error) throw new Error(error.message);
    out.push(...(data || [])); if (!data || data.length < 1000) break;
  }
  return out;
}
async function reraListTick(trigger: string, force: boolean) {
  const runs = await lastRuns('rera_list', 7 * 24 * HOUR);
  if (runs.some((r: any) => r.refused && Date.now() - Date.parse(r.started_at) < 6 * HOUR)) return { source: 'rera_list', skipped: 'site refused us in the last 6 hours - waiting' };
  if (!force && runs.some((r: any) => r.ok)) return { source: 'rera_list', skipped: 'done this week' };
  if (runs.some((r: any) => Date.now() - Date.parse(r.started_at) < 4 * 60e3)) return { source: 'rera_list', skipped: 'spacing' };
  return unit('rera_list', 'district_project.php?dcode=0 (approved + rejected)', trigger, async (runId) => {
    const appr = reraList(await reraGet('district_project.php?dcode=0'), 'approved');
    if (appr.error) throw new Error('approved list: ' + appr.error);
    await sleep(5000);
    const rej = reraList(await reraGet('district_project.php?dcode=0&page=rejected'), 'rejected');
    if (rej.error) throw new Error('rejected list: ' + rej.error);
    const now = new Date().toISOString();
    const old = new Map((await existingRera('procode,completion_date,name')).map((r: any) => [r.procode, r]));
    const changes: any[] = [];
    for (const r of appr.rows) {
      const o: any = old.get(r.procode);
      if (o && o.completion_date && r.completion_date && o.completion_date !== r.completion_date) changes.push({ procode: r.procode, field: 'completion_date (list)', old_value: o.completion_date, new_value: r.completion_date, run_id: runId });
    }
    await upsertChunks('pi_rera_projects', appr.rows.map((r: any) => ({ procode: r.procode, project_id: r.project_id, name: r.name, reg_no: r.reg_no, reg_date: r.reg_date, completion_date: r.completion_date, list_status: 'approved', list_seen_at: now })), 'procode');
    await upsertChunks('pi_rera_rejected', rej.rows.map((r: any) => ({ project_id: r.project_id, name: r.name, completion_date: r.completion_date, rejected_date: r.rejected_date, list_seen_at: now, source_url: RERA + 'district_project.php?dcode=0&page=rejected' })), 'project_id');
    if (changes.length) await db.from('pi_rera_changes').insert(changes);
    return { items: appr.rows.length + rej.rows.length, note: appr.rows.length + ' approved, ' + rej.rows.length + ' rejected/revoked, ' + changes.length + ' completion-date changes' };
  });
}
const TRACKED = ['name', 'project_status', 'completion_date', 'extension_date', 'apartments', 'promoter_name', 'litigations'];
async function reraDetailTick(trigger: string, force: boolean) {
  const wait = await gate('rera_detail', force ? 60e3 : 4 * 60e3);
  if (wait) return { source: 'rera_detail', skipped: wait };
  // 1) never fetched, newest registration first
  let { data: pick } = await db.from('pi_rera_projects').select('*').is('detail_fetched_at', null).eq('list_status', 'approved')
    .order('reg_date', { ascending: false, nullsFirst: false }).limit(6);
  if (!pick?.length) {
    // 2) followed promoters, weekly; 3) everyone else, every 90 days
    const { data: tg } = await db.from('pi_targets').select('value').eq('source', 'rera').eq('active', true);
    const names = (tg || []).map((t: any) => t.value);
    const weekAgo = new Date(Date.now() - 7 * 24 * HOUR).toISOString();
    if (names.length) ({ data: pick } = await db.from('pi_rera_projects').select('*').in('promoter_name', names).lt('detail_fetched_at', weekAgo).order('detail_fetched_at').limit(6));
    if (!pick?.length) ({ data: pick } = await db.from('pi_rera_projects').select('*').lt('detail_fetched_at', new Date(Date.now() - 90 * 24 * HOUR).toISOString()).order('detail_fetched_at').limit(6));
  }
  if (!pick?.length) return { source: 'rera_detail', skipped: 'nothing due' };
  return unit('rera_detail', pick.map((p: any) => p.procode).join(','), trigger, async (runId) => {
    let ok = 0; const errs: string[] = []; const changes: any[] = [];
    for (let i = 0; i < pick!.length; i++) {
      const p: any = pick![i];
      if (i) await sleep(4000);
      const url = RERA + 'project_details.php?procode=' + p.procode;
      const now = new Date().toISOString();
      let html: string;
      try { html = await reraGet('project_details.php?procode=' + p.procode); }
      catch (e) {
        if (e instanceof Refused) throw e;             // stop the unit; gate waits 6 h
        errs.push(p.procode + ': ' + (e as Error).message);
        await db.from('pi_rera_projects').update({ detail_error: (e as Error).message, detail_fetched_at: now, run_id: runId }).eq('procode', p.procode);
        continue;
      }
      const d = reraDetail(html);
      if (d.error) {
        errs.push(p.procode + ': ' + d.error);
        await db.from('pi_rera_projects').update({ detail_error: d.error, detail_fetched_at: now, run_id: runId, source_url: url }).eq('procode', p.procode);
        continue;
      }
      // The page must be the project we asked for.
      if (d.project_id && p.project_id && d.project_id !== p.project_id) {
        errs.push(p.procode + ': page shows ' + d.project_id + ', list says ' + p.project_id);
        await db.from('pi_rera_projects').update({ detail_error: 'page project id ' + d.project_id + ' does not match list ' + p.project_id, detail_fetched_at: now, run_id: runId, source_url: url }).eq('procode', p.procode);
        continue;
      }
      const missing = !d.promoter_name ? 'promoter name not found on page' : null;
      if (p.detail_fetched_at && !p.detail_error) for (const f of TRACKED) {
        const a = p[f] == null ? null : String(p[f]), b = d[f] == null ? null : String(d[f]);
        if (b != null && a !== b) changes.push({ procode: p.procode, field: f, old_value: a, new_value: b, run_id: runId });
      }
      delete d.project_id;
      const row: any = { ...d, detail_fetched_at: now, detail_error: missing, run_id: runId, source_url: url };
      for (const k of Object.keys(row)) if (row[k] === undefined) delete row[k];
      if (row.completion_date == null) delete row.completion_date;   // keep the list's date if the page has none
      const { error } = await db.from('pi_rera_projects').update(row).eq('procode', p.procode);
      if (error) errs.push(p.procode + ': save ' + error.message); else ok++;
    }
    if (changes.length) await db.from('pi_rera_changes').insert(changes);
    if (!ok && errs.length) throw new Error(errs.join(' | '));
    return { items: ok, note: (errs.length ? errs.length + ' failed: ' + errs.join(' | ') + '. ' : '') + changes.length + ' changes' };
  });
}

// ---------------------------------------------------------------- Google Trends
const TRENDS_GEOS = ['IN-WB', 'IN'];
async function trendsTick(trigger: string, force: boolean) {
  const wait = await gate('trends', force ? 2 * 60e3 : 10 * 60e3);
  if (wait) return { source: 'trends', skipped: wait };
  const { data: rows } = await db.from('pi_targets').select('*').eq('source', 'trends').eq('active', true).order('grp').order('sort');
  const groups = new Map<string, string[]>();
  for (const r of rows || []) { if (!groups.has(r.grp)) groups.set(r.grp, []); groups.get(r.grp)!.push(r.value); }
  const units: string[] = [];
  for (const g of groups.keys()) for (const geo of TRENDS_GEOS) units.push(g + '|' + geo);
  const okWeek = new Set((await lastRuns('trends', 6.5 * 24 * HOUR)).filter((r: any) => r.ok).map((r: any) => r.unit));
  const name = units.find((u) => !okWeek.has(u)) || (force ? units[0] : null);
  if (!name) return { source: 'trends', skipped: 'nothing due' };
  const [grp, geo] = name.split('|');
  const terms = groups.get(grp)!.slice(0, 5);
  return unit('trends', name, trigger, async (runId) => {
    const jar = new Map<string, string>();
    const take = (r: Response) => { for (const c of r.headers.getSetCookie()) { const kv = c.split(';')[0]; const i = kv.indexOf('='); jar.set(kv.slice(0, i), kv.slice(i + 1)); } };
    const H = () => ({ 'User-Agent': UA, 'Accept-Language': 'en-US,en;q=0.9', Cookie: [...jar].map(([k, v]) => k + '=' + v).join('; '), Referer: 'https://trends.google.com/trends/explore?geo=' + geo });
    const get = async (url: string, what: string) => {
      const r = await fetch(url, { headers: H() }); take(r); const t = await r.text();
      if (looksBlocked(r.status, t)) throw new Refused('Google Trends refused (HTTP ' + r.status + ') at ' + what, r.status);
      if (!r.ok) throw new Error('HTTP ' + r.status + ' at ' + what);
      return t;
    };
    await get('https://trends.google.com/?geo=' + geo.split('-')[0], 'home');
    await sleep(8000);
    const req = { comparisonItem: terms.map((k) => ({ keyword: k, geo, time: 'today 12-m' })), category: 0, property: '' };
    const ex = await get('https://trends.google.com/trends/api/explore?hl=en-US&tz=-330&req=' + encodeURIComponent(JSON.stringify(req)), 'explore');
    const w = JSON.parse(ex.slice(ex.indexOf('{'))).widgets.find((x: any) => x.id === 'TIMESERIES');
    if (!w) throw new Error('no interest-over-time widget in explore reply');
    await sleep(10000);
    const ml = await get('https://trends.google.com/trends/api/widgetdata/multiline?hl=en-US&tz=-330&req=' + encodeURIComponent(JSON.stringify(w.request)) + '&token=' + encodeURIComponent(w.token), 'interest over time');
    const pts = trendsPoints(ml, terms);
    if (!pts.length) throw new Error('reply had no weekly points');
    const now = new Date().toISOString();
    // Google rescales a group every time it is asked, so the group's weeks are replaced together.
    await db.from('pi_trends_points').delete().eq('grp', grp).eq('geo', geo);
    await upsertChunks('pi_trends_points', pts.map((p) => ({ ...p, grp, geo, fetched_at: now, run_id: runId })), 'grp,geo,term,week_start');
    const noData = terms.filter((t) => !pts.some((p) => p.term === t && p.has_data));
    return { items: pts.length, note: 'https://trends.google.com/trends/explore?date=today%2012-m&geo=' + geo + '&q=' + terms.map(encodeURIComponent).join(',') + (noData.length ? ' | no data for: ' + noData.join(', ') : '') };
  });
}

// ---------------------------------------------------------------- entry
async function caller(req: Request): Promise<string | null> {
  const sec = req.headers.get('x-pi-secret');
  if (sec) {
    const { data } = await createClient(SB, SRV, { db: { schema: 'acc' } }).from('job_secrets').select('value').eq('name', 'public_intel').maybeSingle();
    return data && data.value === sec ? 'cron' : null;
  }
  const auth = req.headers.get('Authorization') || '';
  if (!/^Bearer\s+\S+/.test(auth)) return null;
  const who = await fetch(`${SB}/auth/v1/user`, { headers: { apikey: ANON, Authorization: auth } });
  if (!who.ok) return null;
  const email = String((await who.json()).email || '').toLowerCase();
  const can = await fetch(`${SB}/rest/v1/rpc/pi_allowed`, { method: 'POST', body: '{}', headers: { apikey: ANON, Authorization: auth, 'Content-Type': 'application/json', 'Content-Profile': 'camp' } });
  return can.ok && (await can.json()) === true ? 'manual:' + email : null;
}

const SOURCES: Record<string, (trigger: string, force: boolean) => Promise<any>> = {
  google_ads: gadsTick, rera_list: reraListTick, rera_detail: reraDetailTick, trends: trendsTick,
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return j({ error: 'method not allowed' }, 405);
  let body: any = {}; try { body = await req.json(); } catch (_) { /* empty */ }
  const who = await caller(req);
  if (!who) return j({ error: 'not allowed' }, 401);
  if (body.action !== 'tick') return j({ error: 'unknown action' }, 400);
  // A person may ask for one source now ("Fetch now"); the cron runs every source that is due.
  const manual = who !== 'cron';
  const only: string[] = manual ? [String(body.source || '')].filter((s) => SOURCES[s]) : Object.keys(SOURCES);
  if (!only.length) return j({ error: 'pick a source: ' + Object.keys(SOURCES).join(', ') }, 400);
  const results = await Promise.all(only.map((s) => SOURCES[s](who, manual).catch((e) => ({ source: s, ok: false, error: String(e?.message || e) }))));
  return j({ ok: true, by: who, results });
});
