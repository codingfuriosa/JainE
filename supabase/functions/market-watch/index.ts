/* MARKET WATCH - COMPETITOR LAUNCHES (17 Nov 2026, Ayush).
   Which of the 18 listed competitors (camp.mw_developers) opened a new project to customers in the last 60 days.
   "Launched" = customers have started coming: EOI / pre-launch registration, bookings open, site visits offered,
   a sales office / experience centre / sample flat open, or a launch event with buyer offers. Not RERA registration,
   not the first ad, not "coming soon", not land deals or plans.

   WHERE IT LOOKS, every morning, for each developer:
   1. The developer's own website. Every link on its project pages (and home page) is remembered; a project page that
      was not there before is opened and read. On the first sweep, web.archive.org's first saved copy of each project
      page dates it, and only pages first saved within 60 days are read.
   2. News: Google News and Bing News for the developer's name. Bing gives the article's own link, so the article
      itself is read; Google News gives the headline and date.
   Gemini only READS what was fetched. It must quote the exact sentence that shows customers being invited in, and the
   code checks that the sentence really is in the page or article - otherwise nothing is recorded. If a day brings
   nothing, nothing is added.

   CONFIRMED when the developer's own website says it, or two different news sources do. Otherwise NEEDS CHECK until
   someone with the module confirms or rejects it on the page (camp.mw_decide).

   WHO MAY CALL: the cron only (x-mw-secret = acc.job_secrets 'market_watch'). */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.47.10";

const SB = Deno.env.get('SUPABASE_URL')!;
const SRV = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const GKEY = Deno.env.get('GEMINI_API_KEY') || Deno.env.get('GEMINI_KEY') || '';
const db = createClient(SB, SRV, { db: { schema: 'camp' } });
const acc = createClient(SB, SRV, { db: { schema: 'acc' } });
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-mw-secret', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
const j = (o: unknown, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } });
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const WINDOW_DAYS = 60;
const BUDGET_MS = 110_000;          // stop taking new developers after this; the next cron call carries on
const SITE_CHANGE_LIMIT = 15;       // more new links than this in one day = the site was rebuilt, not 15 launches
// dry run (x-mw-secret + {dry:true, developer:{...}}): reads and judges everything, writes nothing, returns what it would record
let DRY = false; let DRY_OUT: any[] = [];
// one developer must finish well inside the function's 150 s limit, or it would be retried (and cut off) for ever
let DEV_T0 = 0; const devElapsed = () => Date.now() - DEV_T0;
const STAGES = ['eoi', 'site_visits', 'sales_office', 'launch_event', 'bookings'];

// ---------------------------------------------------------------- small helpers
const istToday = () => new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10);
const daysAgo = (n: number) => new Date(Date.now() + 5.5 * 3600e3 - n * 86400e3).toISOString().slice(0, 10);
const validDate = (s: unknown) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(Date.parse(s));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
function decode(s: string) {
  return s.replace(/<!\[CDATA\[|\]\]>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&#0?39;|&apos;|&rsquo;|&lsquo;/g, "'")
    .replace(/&quot;|&ldquo;|&rdquo;/g, '"').replace(/&ndash;|&mdash;/g, '-').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n));
}
function textOf(html: string) {
  return decode(html.replace(/<(script|style|noscript|svg|head)[\s\S]*?<\/\1>/gi, ' ').replace(/<br\s*\/?>|<\/(p|div|li|h\d|tr|section)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')).replace(/[ \t\r\f\v]+/g, ' ').replace(/\n\s*/g, '\n').trim();
}
// for checking a quote against a text: letters and digits only
const flat = (s: string) => String(s || '').toLowerCase().replace(/[‘’]/g, "'").replace(/[^a-z0-9₹]+/g, ' ').trim();
const quoteIn = (quote: string, text: string) => { const q = flat(quote); return q.length >= 12 && flat(text).includes(q); };
function projectKey(name: string, dev: string) {
  const devWords = new Set(flat(dev).split(' ').filter((w) => !['group', 'realty', 'homes', 'properties'].includes(w)));
  return flat(name).split(' ').filter((w) => w && !devWords.has(w) && !['by', 'the', 'project', 'residences', 'residency'].includes(w)).join(' ');
}
async function get(url: string, ms = 15000): Promise<string> {
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), ms);
  try {
    const r = await fetch(url, { headers: { 'User-Agent': UA, 'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8', 'Accept-Language': 'en-IN,en;q=0.9' }, redirect: 'follow', signal: ctl.signal });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const txt = await r.text();
    return txt.length > 3_000_000 ? txt.slice(0, 3_000_000) : txt;
  } finally { clearTimeout(t); }
}
async function pool<T, R>(items: T[], n: number, f: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length); let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (i < items.length) { const k = i++; out[k] = await f(items[k]); } }));
  return out;
}

// ---------------------------------------------------------------- Gemini (reads only; never asked what it "knows")
async function ask(prompt: string): Promise<any> {
  if (!GKEY) throw new Error('GEMINI_API_KEY is not set');
  const errs: string[] = [];
  for (const model of ['gemini-flash-latest', 'gemini-flash-lite-latest', 'gemini-flash-latest']) {
    try {
      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': GKEY },
        body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: prompt }] }], generationConfig: { responseMimeType: 'application/json', temperature: 0 } }) });
      if (r.status === 429 || r.status >= 500) { errs.push(`${model} ${r.status}`); await sleep(8000); continue; }
      if (!r.ok) { errs.push(`${model} ${r.status} ${(await r.text()).slice(0, 150)}`); continue; }
      const t = await r.json();
      const txt = ((((t.candidates || [])[0] || {}).content || {}).parts || []).map((p: any) => p.text || '').join('');
      return JSON.parse(txt);
    } catch (e) { errs.push(String((e as Error).message).slice(0, 150)); }
  }
  throw new Error('Gemini: ' + errs.join(' | '));
}

const LAUNCH_RULES = `"Launched" means CUSTOMERS ARE BEING INVITED IN NOW for a NEW project (or a new phase / tower with its own name):
- EOI or pre-launch registration open (often with an amount to pay), or
- bookings / sales open, or
- site visits offered for it, or a sales office / experience centre / sample flat opened, or
- a launch event or launch offer for buyers.
NOT launched: "coming soon", "upcoming" or a teaser with no way for buyers to come in; land purchase, joint venture or
"plans to launch"; RERA registration alone; a project that was already selling earlier (ready to move, handover,
possession, sold out, sales milestones of an old project); a generic "Enquire now" / "Contact us" form alone.
Only projects in Kolkata / West Bengal count (in_west_bengal); projects in other states are left out.`;
const STAGE_RULE = `stage: one of eoi, site_visits, sales_office, launch_event, bookings - the strongest one the text shows.`;

// ---------------------------------------------------------------- evidence -> launch
async function addEvidence(dev: any, project: string, locality: string, ev: { kind: string; url: string; source: string; title?: string; published: string; quote: string; stage: string }): Promise<number> {
  const key = projectKey(project, dev.name);
  if (key.length < 3 || !validDate(ev.published)) return 0;
  if (DRY) { DRY_OUT.push({ developer: dev.name, project, key, locality, ...ev }); return 1; }
  const { data: rows } = await db.from('mw_launches').select('id,project_key').eq('developer_id', dev.id);
  let hit = (rows || []).find((r: any) => r.project_key === key || (key.length >= 5 && r.project_key.length >= 5 && (r.project_key.includes(key) || key.includes(r.project_key))));
  let isNew = 0;
  if (!hit) {
    const { data, error } = await db.from('mw_launches').insert({ developer_id: dev.id, project: project.trim().slice(0, 120), project_key: key, locality: (locality || '').slice(0, 120) || null,
      stage: STAGES.includes(ev.stage) ? ev.stage : null, launch_date: ev.published }).select('id').single();
    if (error) throw new Error('launch insert: ' + error.message);
    hit = data; isNew = 1;
  }
  await db.from('mw_evidence').upsert({ launch_id: hit.id, kind: ev.kind, url: ev.url, source: ev.source, title: ev.title || null, published: ev.published,
    quote: ev.quote.slice(0, 600), stage: STAGES.includes(ev.stage) ? ev.stage : null }, { onConflict: 'launch_id,url', ignoreDuplicates: true });
  // the launch's date, stage and automatic status come from all its evidence
  const { data: evs } = await db.from('mw_evidence').select('kind,source,published,stage').eq('launch_id', hit.id);
  const list = evs || [];
  const first = list.map((e: any) => e.published).filter(Boolean).sort()[0];
  const stage = list.map((e: any) => e.stage).filter((s: any) => STAGES.includes(s)).sort((a: string, b: string) => STAGES.indexOf(b) - STAGES.indexOf(a))[0] || null;
  const own = list.some((e: any) => e.kind === 'website' || e.kind === 'archive');
  const papers = new Set(list.filter((e: any) => e.kind === 'news').map((e: any) => flat(e.source))).size;
  const auto = own || papers >= 2 ? 'confirmed' : 'needs_check';
  const { data: cur } = await db.from('mw_launches').select('decided_by,locality').eq('id', hit.id).single();
  const upd: any = { launch_date: first, stage, auto_status: auto, updated_at: new Date().toISOString() };
  if (!cur?.decided_by) upd.status = auto;
  if (!cur?.locality && locality) upd.locality = locality.slice(0, 120);
  await db.from('mw_launches').update(upd).eq('id', hit.id);
  return isNew;
}

// ---------------------------------------------------------------- 1. the developer's own website
const SKIP_LINK = /\.(jpe?g|png|gif|webp|svg|pdf|zip|mp4|css|js|ico)(\?|$)|\/(wp-content|wp-json|feed|tag|category|author|careers?|jobs|contact|about|privacy|terms|disclaimer|blog|news|media|press|csr|investors?|login|cart|sitemap)(\/|$)|^(mailto|tel|javascript|whatsapp):/i;
function linksOf(html: string, base: string, filter: RegExp | null): Map<string, string> {
  const out = new Map<string, string>(); const host = new URL(base).hostname.replace(/^www\./, '');
  const re = /<a\b[^>]*href\s*=\s*["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi; let m;
  while ((m = re.exec(html))) {
    let u: URL; try { u = new URL(decode(m[1]).trim(), base); } catch { continue; }
    if (!/^https?:$/.test(u.protocol) || u.hostname.replace(/^www\./, '') !== host) continue;
    u.hash = ''; const s = u.toString().replace(/\/$/, '');
    if (SKIP_LINK.test(s) || s === base.replace(/\/$/, '') || u.pathname === '/' ) continue;
    if (filter && !filter.test(s)) continue;
    const label = textOf(m[2]).replace(/\s+/g, ' ').slice(0, 80);
    if (!out.has(s) || (label && !out.get(s))) out.set(s, label);
  }
  return out;
}
async function sitemapLinks(url: string, filter: RegExp | null, depth = 0): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const xml = await get(url);
  const locs = [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map((m) => decode(m[1]));
  if (/<sitemapindex/i.test(xml) && depth === 0) {
    const kids = locs.filter((l) => /project|propert|residen|page/i.test(l)).slice(0, 4);
    for (const k of kids.length ? kids : locs.slice(0, 3)) { try { for (const [a, b] of await sitemapLinks(k, filter, 1)) out.set(a, b); } catch { /* skip */ } }
    return out;
  }
  for (const l of locs.slice(0, 600)) { const s = l.replace(/\/$/, ''); if (!SKIP_LINK.test(s) && (!filter || filter.test(s))) out.set(s, ''); }
  return out;
}
// the day web.archive.org first saved a page: a date, null (never saved) or 'err' (archive.org did not answer)
async function firstArchived(url: string): Promise<string | null> {
  const q = 'https://web.archive.org/cdx/search/cdx?output=json&limit=1&fl=timestamp&filter=statuscode:200&url=' + encodeURIComponent(url.replace(/^https?:\/\//, ''));
  for (let a = 0; a < 2; a++) {
    try {
      const t = await get(q, 20000);
      const rows = JSON.parse(t || '[]'); const ts = rows[1] && rows[1][0];
      return ts ? `${ts.slice(0, 4)}-${ts.slice(4, 6)}-${ts.slice(6, 8)}` : null;
    } catch { await sleep(3000); }
  }
  return 'err';
}
// open one project page and read it
async function readProjectPage(dev: any, url: string, date: string, kind: 'website' | 'archive'): Promise<number> {
  let text = ''; try { text = textOf(await get(url)).slice(0, 14000); } catch { return 0; }
  if (text.length < 200) return 0;
  const r = await ask(`You are reading one page of the website of ${dev.name}, a real-estate developer in Kolkata, India. URL: ${url}
${LAUNCH_RULES}
Answer from THIS PAGE'S TEXT ONLY - never from what you know. Reply JSON:
{"is_project_page":true|false,"project":"the project's own marketed name","locality":"area/city or empty","in_west_bengal":true|false,"already_selling_long":true|false (ready to move, completed, possession, sold out),"open_to_customers":true|false,"stage":"...","quote":"the exact sentence copied character for character from the page that shows customers are being invited in now, or empty"}
${STAGE_RULE}
PAGE TEXT:
${text}`);
  if (!r || !r.is_project_page || r.in_west_bengal === false || r.already_selling_long || !r.open_to_customers || !r.project) return 0;
  if (!quoteIn(String(r.quote || ''), text)) return 0;          // the sentence must really be on the page
  return await addEvidence(dev, String(r.project), String(r.locality || ''), { kind, url, source: new URL(url).hostname.replace(/^www\./, ''), published: date, quote: String(r.quote), stage: String(r.stage || '') });
}
async function websiteStep(dev: any, baseline: boolean, note: string[]): Promise<{ found: number; links: number }> {
  const filter = dev.link_filter ? new RegExp(dev.link_filter, 'i') : null;
  const links = new Map<string, string>(); const errs: string[] = [];
  for (const u of dev.projects_urls || []) {
    try { for (const [a, b] of linksOf(await get(u), u, filter)) if (!links.has(a) || (b && !links.get(a))) links.set(a, b); } catch (e) { errs.push(`${u}: ${(e as Error).message}`); }
  }
  if (dev.sitemap || links.size < 3) {   // a sitemap given for this developer, or a page built in the browser / blocked
    const sm = dev.sitemap || (dev.website ? dev.website.replace(/\/$/, '') + '/sitemap.xml' : null);
    if (sm) { try { for (const [a, b] of await sitemapLinks(sm, filter)) if (!links.has(a)) links.set(a, b); } catch (e) { errs.push(`sitemap: ${(e as Error).message}`); } }
  }
  if (!links.size) throw new Error('could not read the website' + (errs.length ? ' (' + errs.join('; ').slice(0, 200) + ')' : ''));
  const { data: known } = DRY ? { data: [] } : await db.from('mw_site_links').select('url').eq('developer_id', dev.id);
  const seen = new Set((known || []).map((r: any) => r.url));
  const fresh = [...links.entries()].filter(([u]) => !seen.has(u));
  if (!fresh.length) return { found: 0, links: 0 };
  const today = istToday();
  // new links are remembered only at the END, once read: if anything fails on the way, they are simply new again next time
  const rows = new Map(fresh.map(([u, l]) => [u, { developer_id: dev.id, url: u, label: l || null, first_seen: today, is_project: null as boolean | null, archive_first: null as string | null }]));
  const remember = async (skip: Set<string> = new Set()) => {
    if (DRY) return;
    const list = [...rows.values()].filter((r) => !skip.has(r.url));
    for (let i = 0; i < list.length; i += 200) await db.from('mw_site_links').upsert(list.slice(i, i + 200), { onConflict: 'developer_id,url' });
  };
  if (!baseline && fresh.length > SITE_CHANGE_LIMIT) {
    note.push(`website changed: ${fresh.length} new links at once - remembered, not read as launches`);
    await remember();
    return { found: 0, links: fresh.length };
  }
  // which of the new links are project pages
  const pick = await ask(`These links are from the website of ${dev.name}, a real-estate developer. Which ones are pages of ONE real-estate project (a residential or commercial project, phase or tower)? Leave out lists, blogs, news, offers, amenities, gallery, floor-plan sub-pages, contact and general pages.
Reply JSON {"projects":[index numbers]}.
${fresh.slice(0, 200).map(([u, l], i) => `${i} | ${u} | ${l}`).join('\n')}`);
  const idx = new Set<number>((pick && Array.isArray(pick.projects) ? pick.projects : []).map((n: any) => +n).filter((n: number) => Number.isInteger(n)));
  const proj = fresh.slice(0, 200).filter((_, i) => idx.has(i)).map(([u]) => u);
  for (const [u] of fresh.slice(0, 200)) rows.get(u)!.is_project = proj.includes(u);
  let found = 0;
  if (baseline) {
    // first sweep: a project page is read only when web.archive.org first saved it within the last 60 days
    const from = daysAgo(WINDOW_DAYS);
    const dated: { u: string; d: string | null }[] = [];
    let cut = 0;
    for (const u of proj.slice(0, 30)) {   // one at a time (archive.org refuses bursts); give up if it is not answering at all
      if (devElapsed() > 55_000) { cut = Math.min(proj.length, 30) - dated.length; break; }
      dated.push({ u, d: await firstArchived(u) });
      if (dated.length === 3 && dated.every((x) => x.d === 'err')) { for (const v of proj.slice(3, 30)) dated.push({ u: v, d: 'err' }); break; }
    }
    const ok = (d: string | null) => !!d && d !== 'err';
    for (const x of dated) if (ok(x.d)) rows.get(x.u)!.archive_first = x.d;
    for (const x of dated) if (ok(x.d) && x.d! >= from && devElapsed() < 85_000) found += await readProjectPage(dev, x.u, x.d!, 'archive');
    const recent = dated.filter((x) => ok(x.d) && x.d! >= from).length, old = dated.filter((x) => ok(x.d) && x.d! < from).length;
    const never = dated.filter((x) => !x.d).length, failed = dated.filter((x) => x.d === 'err').length;
    note.push(`${proj.length} project page(s) on the site; web.archive.org first saved ${recent} within ${WINDOW_DAYS} days (read) and ${old} earlier`
      + (never ? `; ${never} never saved (age unknown, not counted)` : '') + (failed ? `; ${failed} could not be checked (archive.org did not answer)` : '')
      + (cut ? `; ${cut} not dated (time limit)` : '') + (proj.length > 30 ? '; only the first 30 were dated' : ''));
    await remember();   // the first look remembers everything, so tomorrow only truly new pages count
  } else {
    const unread = new Set<string>();
    for (const u of proj) { if (devElapsed() < 85_000 && proj.indexOf(u) < 8) found += await readProjectPage(dev, u, today, 'website'); else unread.add(u); }
    if (unread.size) note.push(`${unread.size} new project page(s) left for the next check (time limit)`);
    await remember(unread);
  }
  return { found, links: fresh.length };
}

// ---------------------------------------------------------------- 2. news
type Item = { key: string; title: string; source: string; url: string; date: string; text: string; direct: boolean };
function tag(xml: string, t: string) { const m = xml.match(new RegExp('<' + t + '[^>]*>([\\s\\S]*?)</' + t + '>')); return m ? decode(m[1]).trim() : ''; }
async function googleNews(q: string, days: number): Promise<Item[]> {
  const url = 'https://news.google.com/rss/search?q=' + encodeURIComponent(q + ' when:' + days + 'd') + '&hl=en-IN&gl=IN&ceid=IN:en';
  let xml = '';
  try { xml = await get(url); } catch (e) { if (!/429/.test(String((e as Error).message))) throw e; await sleep(6000); xml = await get(url); }   // Google refuses quick repeats
  return xml.split('<item>').slice(1).map((it) => {
    const full = tag(it, 'title'), src = tag(it, 'source');
    const title = src && full.endsWith(' - ' + src) ? full.slice(0, -(src.length + 3)) : full;
    const d = new Date(tag(it, 'pubDate'));
    return { key: 'g:' + flat(title).slice(0, 160), title, source: src || 'Google News', url: tag(it, 'link'), date: isNaN(+d) ? '' : new Date(+d + 5.5 * 3600e3).toISOString().slice(0, 10), text: '', direct: false };
  }).filter((x) => x.title && x.date);
}
async function bingNews(q: string): Promise<Item[]> {
  const xml = await get('https://www.bing.com/news/search?q=' + encodeURIComponent(q) + '&format=rss&mkt=en-IN');
  return xml.split('<item>').slice(1).map((it) => {
    const link = tag(it, 'link'); let url = link;
    try { const u = new URL(link); url = u.searchParams.get('url') || link; } catch { /* keep */ }
    const d = new Date(tag(it, 'pubDate'));
    const src = tag(it, 'News:Source') || (() => { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return 'Bing News'; } })();
    const title = tag(it, 'title');
    return { key: 'g:' + flat(title).slice(0, 160), title, source: src, url, date: isNaN(+d) ? '' : new Date(+d + 5.5 * 3600e3).toISOString().slice(0, 10), text: textOf(tag(it, 'description')), direct: url !== link };
  }).filter((x) => x.title && x.date);
}
async function newsStep(dev: any, days: number): Promise<{ found: number; items: number }> {
  const q = dev.news_query || `"${dev.name}" Kolkata`;
  const from = daysAgo(days);
  const all: Item[] = [];
  try { all.push(...await bingNews(q)); } catch { /* one feed may fail */ }
  try { all.push(...await googleNews(q, days)); } catch { /* idem */ }
  if (!all.length) return { found: 0, items: 0 };
  // one item per headline; Bing's (with the article's own link) wins
  const byKey = new Map<string, Item>();
  for (const it of all) { if (it.date < from) continue; const o = byKey.get(it.key); if (!o || (!o.direct && it.direct)) byKey.set(it.key, it); }
  const keys = [...byKey.keys()];
  if (!keys.length) return { found: 0, items: 0 };
  const { data: seenRows } = DRY ? { data: [] } : await db.from('mw_news_seen').select('key').in('key', keys);
  const seen = new Set((seenRows || []).map((r: any) => r.key));
  const items = keys.filter((k) => !seen.has(k)).map((k) => byKey.get(k)!).slice(0, 25);
  if (!items.length) return { found: 0, items: 0 };
  // read the articles themselves where the link is the paper's own
  await pool(items.filter((x) => x.direct).slice(0, 12), 4, async (x) => { if (devElapsed() > 100_000) return; try { const t = textOf(await get(x.url, 12000)); if (t.length > x.text.length) x.text = t.slice(0, 6000); } catch { /* headline + summary only */ } });
  const r = await ask(`News items found for "${dev.name}" (a real-estate developer in Kolkata, India). For each item decide, from ITS OWN TEXT ONLY, whether it reports that ${dev.name} has launched a new project.
Be careful with similar names: only "${dev.name}" counts${dev.name.startsWith('Eden') ? ' (Eden Group and Eden Realty are DIFFERENT companies)' : ''}.
${LAUNCH_RULES}
Reply JSON {"items":[{"i":index,"about_developer":true|false,"is_new_launch":true|false,"project":"marketed name or empty","locality":"area or empty","in_west_bengal":true|false,"stage":"...","opened_on":"YYYY-MM-DD only if the text gives the exact day customers were first invited in, else empty","quote":"the exact sentence copied character for character from the item's title or text that shows the launch, or empty"}]}
${STAGE_RULE}
${items.map((x, i) => `--- ITEM ${i} | ${x.date} | ${x.source}\nTITLE: ${x.title}\nTEXT: ${x.text.slice(0, 3000)}`).join('\n')}`);
  const verdicts: any[] = (r && Array.isArray(r.items)) ? r.items : [];
  let found = 0;
  for (let i = 0; i < items.length; i++) {
    const x = items[i]; const v = verdicts.find((y) => +y.i === i) || null;
    if (DRY) DRY_OUT.push({ news: x.title.slice(0, 120), source: x.source, date: x.date, verdict: v });
    else await db.from('mw_news_seen').upsert({ key: x.key, developer_id: dev.id, url: x.url, title: x.title.slice(0, 300), source: x.source, published: x.date, verdict: v }, { onConflict: 'key', ignoreDuplicates: true });
    if (!v || !v.about_developer || !v.is_new_launch || v.in_west_bengal === false || !v.project) continue;
    const body = x.title + '\n' + x.text;
    if (!quoteIn(String(v.quote || ''), body)) continue;      // the sentence must really be in the item
    const devWord = flat(dev.name).split(' ')[0];
    if (!flat(body).includes(devWord)) continue;               // and the developer must be named in it
    let date = x.date;
    if (validDate(v.opened_on) && v.opened_on <= x.date && v.opened_on >= daysAgo(400)) date = v.opened_on;
    found += await addEvidence(dev, String(v.project), String(v.locality || ''), { kind: 'news', url: x.url, source: x.source, title: x.title, published: date, quote: String(v.quote), stage: String(v.stage || '') });
  }
  return { found, items: items.length };
}

// ---------------------------------------------------------------- one developer
async function checkDeveloper(dev: any) {
  const baseline = !dev.baseline_at;
  DEV_T0 = Date.now();
  const note: string[] = []; const errs: string[] = [];
  let found = 0, links = 0, news = 0;
  try { const w = await websiteStep(dev, baseline, note); found += w.found; links = w.links; } catch (e) { errs.push('website: ' + (e as Error).message); }
  try { const n = await newsStep(dev, baseline ? WINDOW_DAYS : 4); found += n.found; news = n.items; } catch (e) { errs.push('news: ' + (e as Error).message); }
  const now = new Date().toISOString();
  if (DRY) return { developer: dev.name, baseline, found, links, news, note, error: errs.join(' | ') || null };
  await db.from('mw_developers').update({ last_checked_at: now, baseline_at: dev.baseline_at || now, last_error: errs.join(' | ').slice(0, 500) || null }).eq('id', dev.id);
  await db.from('mw_runs').insert({ developer_id: dev.id, baseline, links_new: links, news_new: news, found, note: note.join(' | ').slice(0, 500) || null, error: errs.join(' | ').slice(0, 500) || null });
  return { developer: dev.name, baseline, found, links, news, error: errs.join(' | ') || null };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    const { data: s } = await acc.from('job_secrets').select('value').eq('name', 'market_watch').maybeSingle();
    if (!s?.value || req.headers.get('x-mw-secret') !== s.value) return j({ error: 'not allowed' }, 401);
    const body = await req.json().catch(() => ({}));
    DRY = false; DRY_OUT = [];
    if (body.dry && body.developer) {
      DRY = true;
      try { const r = await checkDeveloper({ id: 0, baseline_at: body.baseline === false ? 'x' : null, ...body.developer }); return j({ ok: true, dry: true, result: r, would_record: DRY_OUT }); }
      finally { DRY = false; }
    }
    const t0 = Date.now();
    // developers not yet checked today (IST); never-checked first
    const startIst = new Date(Date.parse(istToday() + 'T00:00:00+05:30')).toISOString();
    let q = db.from('mw_developers').select('*').eq('active', true).order('baseline_at', { ascending: true, nullsFirst: true }).order('sort');
    if (body.developer_id) q = q.eq('id', +body.developer_id);
    const { data: devs, error } = await q;
    if (error) return j({ error: error.message }, 500);
    const due = (devs || []).filter((d: any) => body.developer_id || !d.last_checked_at || d.last_checked_at < startIst);
    const done: any[] = [];
    for (const d of due) {
      if (done.length && (d.baseline_at == null || Date.now() - t0 > BUDGET_MS - 75_000)) break;   // a first look takes a whole call
      done.push(await checkDeveloper(d));
    }
    return j({ ok: true, checked: done, left: due.length - done.length });
  } catch (e) {
    return j({ error: String((e as Error).message || e).slice(0, 400) }, 500);
  }
});
