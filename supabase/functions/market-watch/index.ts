/* MARKET WATCH (14 Nov 2026) - the videos behind the Market Watch page's Trends and Hook Library tabs.
   Ayush: "I just want the Trend Video, Project Names and data, and Hook Video - no Gemini required."

   TRENDS. YouTube's own "Trending" chart (videos.list chart=mostPopular) for India and for the world
   (United States, United Kingdom, UAE, Singapore and Australia read one by one), the whole chart plus its
   professional categories' charts, kept only from big channels - see TREND_CATEGORIES. 1 quota unit each.
   HOOKS. The most-watched professional Shorts (3 min or less) of the last 30 days - see HOOK_SEARCHES
   (search.list, 100 units each) - the videos whose first seconds held people - with their real
   view, like and comment counts read afterwards (videos.list, 1 unit per 50).
   Nothing is written, judged or rated by AI - every number is YouTube's own.

   STORED in camp.mkt_videos (one row per kind + tag + video; last_seen tells when YouTube last listed
   it). A refresh runs at most every 3 hours for trends and every 24 hours for hooks unless forced, so
   the free YouTube quota (10,000 units a day) is never near its limit (a full refresh is ~1,300 units).

   WHO MAY CALL. The cron (x-mw-secret = acc.job_secrets 'market_watch'), or a signed-in staff member
   (any valid JainE sign-in): "refresh" re-reads what is due; "preview" returns what YouTube says now
   without saving (used before the table exists). */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.47.10";
import { getJson, pulse, hookIdeas, launches, startClock } from "./ai.ts";   // AI trends / hook ideas / launches (16 Nov 2026)

const SB = Deno.env.get('SUPABASE_URL')!;
const SRV = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ANON = Deno.env.get('SUPABASE_ANON_KEY') || '';
const YT_KEY = Deno.env.get('YOUTUBE_API_KEY') || '';
const db = createClient(SB, SRV, { db: { schema: 'camp' } });
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-mw-secret', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
const j = (o: unknown, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } });
const HOUR = 3600 * 1000;

export const TREND_REGIONS: Record<string, string> = { IN: 'India', US: 'United States', GB: 'United Kingdom', AE: 'UAE', SG: 'Singapore', AU: 'Australia' };
/* Searches for the Hook Library [tag, query, region]. Ayush 14 Nov 2026: "Hooks don't need to be Real Estate
   themed - good, trending, eye catching, popular" and "professional, not low quality". Second pass, same day, Ayush: Trends and Hooks "India and World mostly", hooks "should not be low quality,
   unprofessional, local hooks - we are a professional company". The first pass still let through Hindi DIY / Diwali
   decor channels, product listings, "funny ads" compilations and regional songs. Now (all YouTube's own data):
   - searches are for brand films, launch films and campaign work, worldwide ('') and India ('IN');
   - the channel must have 1,000,000+ subscribers (brands and established studios, not small creators);
   - categories: Film & Animation, Autos, Sports, Travel, Science & Technology only (Howto & Style and Education,
     where the DIY / hack / review shorts sit, are left out);
   - the title must be mostly in English letters (regional-language local content is left out), carry no
     clickbait emoji and no "DIY / hack / funny / unboxing / review"-type words;
   - at most 2 videos per channel in a search, so one creator cannot fill a tab. */
export const HOOK_SEARCHES: [string, string, string][] = [
  ['ads', 'official commercial', ''],
  ['ads', 'brand film', ''],
  ['ads', 'brand film', 'IN'],
  ['cinematic', 'cinematic brand film', ''],
  ['cinematic', 'shot on iPhone', ''],
  ['luxury', 'luxury brand campaign', ''],
  ['design', 'architecture film', ''],
  ['travel', 'tourism campaign film', ''],
  ['travel', 'travel film', ''],
  ['cars', 'car commercial', ''],
  ['cars', 'car launch film', 'IN'],
  ['tech', 'product launch film', ''],
  ['tech', 'introducing the new', ''],
  // 16 Nov 2026 ("what's up with Market Watch" - the library had 14 videos, Design and Luxury empty): more professional
  // searches, incl. real-estate and hospitality brand work worldwide and in India; the same quality filters apply
  ['design', 'real estate brand film', ''],
  ['design', 'luxury residences film', ''],
  ['design', 'property launch film', 'IN'],
  ['luxury', 'luxury hotel brand film', ''],
  ['luxury', 'luxury watch commercial', ''],
  ['ads', 'tvc', 'IN'],
  ['cinematic', 'brand campaign film', 'IN'],
  ['travel', 'tourism board film', ''],
];
const HOOK_DAYS = 30, SHORT_MAX_S = 180;   // a Short is at most 3 minutes
const MIN_SUBS = 1000000;
const PRO_CATEGORIES = new Set(['1', '2', '17', '19', '28']);
const PER_CHANNEL = 2;
/* Trends: YouTube's Trending chart is mostly music videos, game streams and regional songs, so the list is read
   from the chart's professional categories (Film & Animation, Autos, Sports, Travel, Entertainment, News, Science &
   Technology) for each region, from channels with 1,000,000+ subscribers, titles mostly in English letters. */
const TREND_CATEGORIES = ['1', '2', '17', '19', '24', '25', '28'];
const TREND_MIN_SUBS = 1000000;
const CLICKBAIT = /[\u{1F631}\u{1F92F}\u{1F602}\u{1F923}\u{1F633}\u{1F62D}\u{1F525}\u{1F4A5}\u{1F440}\u{2049}\u{1F648}\u{1F480}\u{1F606}\u{1F605}\u{1F972}]|\b(diy|hack|hacks|funny|comedy|memes?|prank|under budget|unboxing|review|reaction|mistakes|save for later|tutorial|live|ideas|makeover|decoration|tips)\b/iu;
// hooks are ad / brand work: not news, explainers or multi-part talk videos
const NOT_A_HOOK = /\b(part \d|news|policy|explained|box office|report|movieclips|vs)\b/i;
// TV-serial episodes are not trends worth studying
const TV_EPISODE = /\b(full episode|episode \d+|ep\.? ?\d+)\b/i;
// India's national trends are often titled in Hindi: for India, Hindi (Devanagari) letters count with English ones
function scriptOk(t: string, rc: string): boolean {
  if (latinMostly(t)) return true;
  if (rc !== 'IN') return false;
  const all = (t.match(/\p{L}/gu) || []).length, ok = (t.match(/[A-Za-zऀ-ॿ]/g) || []).length;
  return all > 0 && ok / all >= 0.8;
}
// Howto & Style is where design, luxury and travel brand films are filed - allowed for those tags only
const HOWTO_OK_TAGS = new Set(['design', 'luxury', 'travel']);
const TREND_MIN_S = 90;   // trends are full videos (a trailer is ~2 min), not quick Shorts
/* India (Ayush 14 Nov: "Search India's top videos"): India's Trending chart is mostly regional songs, Shorts, serials
   and game streams, so India's list is YouTube's most-viewed English videos of the last 7 days in India on these
   subjects, through the same filters (1M+ channels, professional categories, no clickbait). ~5 x 100 units a read. */
const INDIA_SEARCHES = ['official trailer', 'cricket highlights', 'business news India', 'launch event India', 'India interview'];
const INDIA_DAYS = 7;
function latinMostly(t: string): boolean {   // English letters make up at least 80% of the title's letters
  const all = (t.match(/\p{L}/gu) || []).length, lat = (t.match(/[A-Za-z]/g) || []).length;
  return all > 0 && lat / all >= 0.8;
}
async function subsOf(chIds: string[]): Promise<Record<string, number>> {
  const subs: Record<string, number> = {};
  for (let i = 0; i < chIds.length; i += 50) {
    const r = await yt('channels', { part: 'statistics', id: chIds.slice(i, i + 50).join(','), maxResults: '50' });
    (r.items || []).forEach((c: any) => { subs[c.id] = c.statistics?.hiddenSubscriberCount ? 0 : Number(c.statistics?.subscriberCount || 0); });
  }
  return subs;
}

async function yt(path: string, params: Record<string, string>) {
  const u = new URL('https://www.googleapis.com/youtube/v3/' + path);
  for (const [k, v] of Object.entries(params)) if (v) u.searchParams.set(k, v);
  u.searchParams.set('key', YT_KEY);
  const r = await fetch(u.toString());
  const jr = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error('YouTube ' + path + ' ' + r.status + ': ' + ((jr as any)?.error?.message || ''));
  return jr as any;
}
function secs(iso: string): number | null {   // PT1H2M3S -> 3723
  const m = String(iso || '').match(/^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/);
  if (!m) return null;
  return (+(m[1] || 0)) * 86400 + (+(m[2] || 0)) * 3600 + (+(m[3] || 0)) * 60 + (+(m[4] || 0));
}
function row(kind: string, tag: string, v: any, rank: number, now: string) {
  const sn = v.snippet || {}, st = v.statistics || {}, th = sn.thumbnails || {};
  const n = (x: any) => (x == null || x === '' ? null : Number(x));
  return {
    kind, tag, video_id: v.id, rank, title: sn.title || '', channel: sn.channelTitle || '', channel_id: sn.channelId || null,
    published_at: sn.publishedAt || null, duration_s: secs(v.contentDetails?.duration), category_id: sn.categoryId || null,
    views: n(st.viewCount), likes: n(st.likeCount), comments: n(st.commentCount),
    thumb: (th.maxres || th.high || th.medium || th.default || {}).url || null, last_seen: now,
  };
}

async function trends(now: string) {
  const per: Record<string, Record<string, any>> = {};
  for (const rc of Object.keys(TREND_REGIONS)) {
    const got: Record<string, any> = (per[rc] = {});
    if (rc === 'IN') {   // India: a search, not the chart (see INDIA_SEARCHES)
      const after = new Date(Date.now() - INDIA_DAYS * 24 * HOUR).toISOString(), ids = new Set<string>();
      for (const q of INDIA_SEARCHES) {
        try {
          const r = await yt('search', { part: 'id', type: 'video', q, regionCode: 'IN', relevanceLanguage: 'en', order: 'viewCount', publishedAfter: after, maxResults: '50', safeSearch: 'strict' });
          (r.items || []).forEach((x: any) => { if (x.id?.videoId) ids.add(x.id.videoId); });
        } catch (_) { /* one search failing leaves the others */ }
      }
      const list = [...ids];
      for (let i = 0; i < list.length; i += 50) {
        const r = await yt('videos', { part: 'snippet,statistics,contentDetails', id: list.slice(i, i + 50).join(','), maxResults: '50' });
        (r.items || []).forEach((v: any) => { got[v.id] = v; });
      }
      continue;
    }
    for (const cat of ['', ...TREND_CATEGORIES]) {   // the whole chart, then each professional category's own chart
      try {
        const r = await yt('videos', { part: 'snippet,statistics,contentDetails', chart: 'mostPopular', regionCode: rc, videoCategoryId: cat, maxResults: '50' });
        (r.items || []).forEach((v: any) => { got[v.id] = v; });
      } catch (_) { /* a category YouTube has no chart for in that country */ }
    }
  }
  const all = Object.values(per).flatMap((g) => Object.values(g));
  const subs = await subsOf([...new Set(all.map((v: any) => v.snippet?.channelId).filter(Boolean))] as string[]);
  const out: any[] = [];
  for (const rc of Object.keys(per)) {
    Object.values(per[rc])
      .filter((v: any) => {
        const t = String(v.snippet?.title || '');
        return TREND_CATEGORIES.includes(String(v.snippet?.categoryId)) && (subs[v.snippet?.channelId] || 0) >= TREND_MIN_SUBS
          && (secs(v.contentDetails?.duration) ?? 0) >= TREND_MIN_S && scriptOk(t, rc) && !CLICKBAIT.test(t) && !TV_EPISODE.test(t) && (t.match(/#/g) || []).length < 2;
      })
      .sort((a: any, b: any) => Number(b.statistics?.viewCount || 0) - Number(a.statistics?.viewCount || 0))
      .slice(0, 50)
      .forEach((v: any, i: number) => out.push(row('trend', rc, v, i + 1, now)));
  }
  return out;
}
async function hooks(now: string) {
  const after = new Date(Date.now() - HOOK_DAYS * 24 * HOUR).toISOString();
  const found: { tag: string; id: string; rank: number }[] = [], seen = new Set<string>();
  for (const [tag, q, rc] of HOOK_SEARCHES) {
    const r = await yt('search', { part: 'id', type: 'video', q, videoDuration: 'short', order: 'viewCount', publishedAfter: after, maxResults: '50', regionCode: rc, relevanceLanguage: 'en', safeSearch: 'strict' });
    (r.items || []).forEach((x: any, i: number) => { const id = x.id?.videoId; if (id && !seen.has(tag + id)) { seen.add(tag + id); found.push({ tag, id, rank: i + 1 }); } });
  }
  const ids = [...new Set(found.map((f) => f.id))], byId: Record<string, any> = {};
  for (let i = 0; i < ids.length; i += 50) {
    const r = await yt('videos', { part: 'snippet,statistics,contentDetails', id: ids.slice(i, i + 50).join(','), maxResults: '50' });
    (r.items || []).forEach((v: any) => { byId[v.id] = v; });
  }
  const subs = await subsOf([...new Set(Object.values(byId).map((v: any) => v.snippet?.channelId).filter(Boolean))] as string[]);
  const perCh: Record<string, number> = {};
  return found.filter((f) => {
    const v = byId[f.id]; if (!v) return false;
    const title = String(v.snippet?.title || '');
    if ((secs(v.contentDetails?.duration) ?? 999) > SHORT_MAX_S) return false;
    const cat = String(v.snippet?.categoryId);
    if (!PRO_CATEGORIES.has(cat) && !(cat === '26' && HOWTO_OK_TAGS.has(f.tag))) return false;
    if ((subs[v.snippet?.channelId] || 0) < MIN_SUBS) return false;
    if ((title.match(/#/g) || []).length >= 3) return false;
    if (!latinMostly(title) || CLICKBAIT.test(title) || NOT_A_HOOK.test(title)) return false;
    const ck = f.tag + '|' + v.snippet?.channelId;
    if ((perCh[ck] = (perCh[ck] || 0) + 1) > PER_CHANNEL) return false;
    return true;
  }).map((f) => row('hook', f.tag, byId[f.id], f.rank, now));
}

async function lastSeen(kind: string): Promise<number> {
  const { data, error } = await db.from('mkt_videos').select('last_seen').eq('kind', kind).order('last_seen', { ascending: false }).limit(1);
  if (error) throw error;
  return data && data[0] ? Date.parse(data[0].last_seen) : 0;
}
async function save(rows: any[]) {
  for (let i = 0; i < rows.length; i += 200) {
    const { error } = await db.from('mkt_videos').upsert(rows.slice(i, i + 200), { onConflict: 'kind,tag,video_id' });
    if (error) throw error;
  }
}

async function caller(req: Request): Promise<string | null> {
  const sec = req.headers.get('x-mw-secret');
  if (sec) {
    const { data } = await createClient(SB, SRV, { db: { schema: 'acc' } }).from('job_secrets').select('value').eq('name', 'market_watch').maybeSingle();
    return data && data.value === sec ? 'cron' : null;
  }
  const auth = req.headers.get('Authorization') || '';
  if (!/^Bearer\s+\S+/.test(auth)) return null;
  const who = await fetch(`${SB}/auth/v1/user`, { headers: { apikey: ANON, Authorization: auth } });
  if (!who.ok) return null;
  const email = String((await who.json()).email || '').toLowerCase();
  return email ? 'manual:' + email : null;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return j({ error: 'method not allowed' }, 405);
  let body: any = {}; try { body = await req.json(); } catch (_) { /* empty */ }
  const who = await caller(req);
  if (!who) return j({ error: 'not allowed' }, 401);
  if (!YT_KEY) return j({ error: 'YOUTUBE_API_KEY is not set' }, 500);
  const now = new Date().toISOString();
  startClock();
  try {
    // AI: ai_get reads the saved result, ai_refresh makes it afresh (what: trends | hooks | launches)
    if (body.action === 'ai_get') {
      const w = String(body.what || ''); if (!['trends', 'hooks', 'launches'].includes(w)) return j({ error: 'what?' }, 400);
      return j({ ok: true, data: await getJson(w + '.json') });
    }
    if (body.action === 'ai_refresh') {
      const w = String(body.what || ''), save = body.save !== false;
      if (w === 'trends') return j({ ok: true, data: await pulse(save) });
      if (w === 'hooks') return j({ ok: true, data: await hookIdeas(save) });
      if (w === 'launches') return j({ ok: true, data: await launches(save, Math.min(20, +body.batches || 12)) });
      return j({ error: 'what?' }, 400);
    }
    if (body.action === 'preview') {
      const kinds = body.kind === 'hook' ? ['hook'] : body.kind === 'trend' ? ['trend'] : ['trend', 'hook'];
      const out: any = {};
      if (kinds.includes('trend')) out.trend = await trends(now);
      if (kinds.includes('hook')) out.hook = await hooks(now);
      return j({ ok: true, ...out });
    }
    if (body.action === 'refresh') {
      const force = !!body.force && who !== 'cron' ? true : !!body.force;
      const done: any = {};
      if (force || Date.now() - (await lastSeen('trend')) > 3 * HOUR - 5 * 60000) { const r = await trends(now); await save(r); done.trend = r.length; }
      if (force || Date.now() - (await lastSeen('hook')) > 24 * HOUR - 5 * 60000) { const r = await hooks(now); await save(r); done.hook = r.length; }
      return j({ ok: true, by: who, saved: done });
    }
    return j({ error: 'unknown action' }, 400);
  } catch (e) {
    return j({ error: (e as Error).message }, 500);
  }
});
