/* MARKET WATCH - TRENDS (17 Nov 2026, Ayush: trends that grab attention, for thumb-stop ideas in our videos;
   a weekly search, everything listed, the video or photo attached when there is one, India and Worldwide apart).

   COLLECT (4 times a day, no AI): what is trending right now, kept in camp.mw_trend_raw -
     Google Trends trending searches   India (IN); Worldwide = US, UK, UAE, Singapore, Australia
     YouTube trending chart            India; Worldwide = US + UK                 (YOUTUBE_API_KEY)
     Apple Music top songs             India; Worldwide = US
   COMPILE (Monday morning): the week's snapshots + Wikipedia's most-read pages of the 7 days (India-only and
     worldwide) are handed to Gemini, which only GROUPS the items into trends, names the type and writes a 1-2 line
     "what happened" from the items' own text. It can only point at the items it was given (their ids are checked),
     so it cannot add a trend; every number, picture, video and link on a card comes from the source itself.
     Deaths, tragedies, crime, politics, courts, controversies and plain festivals are left out.
   No Meta Ad Library here: the daily Competitor / CP / Our Brand pulls use every Proxy credit (Ayush: Trends must
   not affect them). */

type Ctx = { db: any; ask: (p: string) => Promise<any>; dry: boolean };
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const YT_KEY = Deno.env.get('YOUTUBE_API_KEY') || '';
const WORLD_GEOS = ['US', 'GB', 'AE', 'SG', 'AU'];
export const TREND_TYPES = ['sports', 'movie_show', 'song', 'viral_moment', 'news_moment', 'local', 'celebrity', 'brand_campaign', 'search_spike'];

const istDay = (ms = Date.now()) => new Date(ms + 5.5 * 3600e3).toISOString().slice(0, 10);
const flat = (s: string) => String(s || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
function decode(s: string) {
  return String(s || '').replace(/<!\[CDATA\[|\]\]>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&#0?39;|&apos;/g, "'")
    .replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n)).trim();
}
const tag = (xml: string, t: string) => { const m = xml.match(new RegExp('<' + t + '[^>]*>([\\s\\S]*?)</' + t + '>')); return m ? decode(m[1]) : ''; };
async function get(url: string, ms = 15000, headers: Record<string, string> = {}): Promise<string> {
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), ms);
  try {
    const r = await fetch(url, { headers: { 'User-Agent': UA, ...headers }, signal: ctl.signal });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.text();
  } finally { clearTimeout(t); }
}
function trafficNum(s: string) { const m = String(s || '').replace(/,/g, '').match(/([\d.]+)\s*([KkMm]?)/); if (!m) return 0; return +m[1] * (/k/i.test(m[2]) ? 1e3 : /m/i.test(m[2]) ? 1e6 : 1); }
const short = (n: number) => n >= 1e7 ? (n / 1e7).toFixed(1).replace(/\.0$/, '') + ' Cr' : n >= 1e5 ? (n / 1e5).toFixed(1).replace(/\.0$/, '') + ' L' : n >= 1e3 ? (n / 1e3).toFixed(1).replace(/\.0$/, '') + 'K' : String(n);

type Raw = { source: string; region: string; country: string; key: string; title: string; summary: string; url: string; media_url: string | null;
  media_type: string | null; video_id: string | null; metric_label: string; metric_value: number; extra: any; day: string };

// ---------------------------------------------------------------- sources (all public; no AI)
async function googleTrends(geo: string, region: string): Promise<Raw[]> {
  const xml = await get(`https://trends.google.com/trending/rss?geo=${geo}`);
  return xml.split('<item>').slice(1).map((it) => {
    const title = tag(it, 'title'); const traffic = tag(it, 'ht:approx_traffic');
    const news = [...it.matchAll(/<ht:news_item>([\s\S]*?)<\/ht:news_item>/g)].map((m) => ({
      title: tag(m[1], 'ht:news_item_title'), url: tag(m[1], 'ht:news_item_url'), source: tag(m[1], 'ht:news_item_source'), picture: tag(m[1], 'ht:news_item_picture') }))
      .filter((n) => n.title && n.url).slice(0, 3);
    const d = new Date(tag(it, 'pubDate'));
    const pic = tag(it, 'ht:picture');
    return { source: 'google', region, country: geo, key: 'g:' + flat(title), title, summary: news.map((n) => n.title).join(' | ').slice(0, 600),
      url: news[0]?.url || `https://trends.google.com/trends/explore?geo=${geo}&q=${encodeURIComponent(title)}`,
      media_url: pic || null, media_type: pic ? 'image' : null, video_id: null, metric_label: 'searches', metric_value: trafficNum(traffic),
      extra: { traffic, news, picture_source: tag(it, 'ht:picture_source') }, day: isNaN(+d) ? istDay() : istDay(+d) } as Raw;
  }).filter((x) => x.title);
}
async function youtube(regionCode: string, region: string): Promise<Raw[]> {
  if (!YT_KEY) throw new Error('YOUTUBE_API_KEY is not set');
  const t = await get(`https://www.googleapis.com/youtube/v3/videos?part=snippet,statistics&chart=mostPopular&maxResults=25&regionCode=${regionCode}&key=${YT_KEY}`);
  const j = JSON.parse(t);
  return (j.items || []).map((v: any) => {
    const s = v.snippet || {}, st = v.statistics || {}, th = s.thumbnails || {};
    return { source: 'youtube', region, country: regionCode, key: 'y:' + v.id, title: s.title || '', summary: ((s.channelTitle || '') + ' - ' + String(s.description || '').replace(/\s+/g, ' ')).slice(0, 400),
      url: 'https://www.youtube.com/watch?v=' + v.id, media_url: (th.high || th.medium || th.default || {}).url || null, media_type: 'video', video_id: v.id,
      metric_label: 'views', metric_value: +st.viewCount || 0, extra: { channel: s.channelTitle, published: s.publishedAt, category: s.categoryId, likes: +st.likeCount || null },
      day: istDay() } as Raw;
  });
}
async function apple(cc: string, region: string): Promise<Raw[]> {
  let txt = '';   // Apple's feed often refuses the 25 list and answers the 10 list
  for (const n of [25, 10, 10]) { try { txt = await get(`https://rss.marketingtools.apple.com/api/v2/${cc}/music/most-played/${n}/songs.json`, 12000); break; } catch { /* try the next size */ } }
  if (!txt) throw new Error('Apple Music chart did not answer');
  const j = JSON.parse(txt);
  return ((j.feed || {}).results || []).map((s: any, i: number) => ({ source: 'apple', region, country: cc.toUpperCase(), key: 'a:' + s.id,
    title: `${s.name} - ${s.artistName}`, summary: `${s.name} by ${s.artistName}${s.releaseDate ? ', released ' + s.releaseDate : ''}`, url: s.url,
    media_url: String(s.artworkUrl100 || '').replace('100x100', '400x400') || null, media_type: 'image', video_id: null,
    metric_label: 'Apple Music chart', metric_value: i + 1, extra: { artist: s.artistName, release: s.releaseDate }, day: istDay() } as Raw));
}
// Wikipedia's most-read pages, per day, for the compile only (it keeps history, the others do not)
const WIKI_SKIP = /^(Main_Page|Special:|Wikipedia:|Portal:|File:|Help:|Talk:|User:|Template:|Category:|List_of|Lists_of|Deaths_in|\.xxx|XXX|XNXX|Pornhub|XHamster|XVideos|OnlyFans|Porn|Sex|Cleopatra|Google|YouTube|Facebook|Instagram|WhatsApp|ChatGPT|Wiki)/i;
async function wikiTop(region: string, days: string[]): Promise<Map<string, { views: number; days: number; first: string }>> {
  const out = new Map<string, { views: number; days: number; first: string }>();
  for (const d of days) {
    const [y, m, dd] = d.split('-');
    const url = region === 'IN' ? `https://wikimedia.org/api/rest_v1/metrics/pageviews/top-per-country/IN/all-access/${y}/${m}/${dd}`
                                : `https://wikimedia.org/api/rest_v1/metrics/pageviews/top/en.wikipedia/all-access/${y}/${m}/${dd}`;
    try {
      const j = JSON.parse(await get(url, 15000, { 'User-Agent': 'JainE-MarketWatch/1.0 (internal research)' }));
      for (const a of (((j.items || [])[0] || {}).articles || [])) {
        if (a.project && a.project !== 'en.wikipedia') continue;
        if (WIKI_SKIP.test(a.article)) continue;
        const v = +(a.views ?? a.views_ceil) || 0; const o = out.get(a.article);
        out.set(a.article, o ? { views: o.views + v, days: o.days + 1, first: o.first < d ? o.first : d } : { views: v, days: 1, first: d });
      }
    } catch { /* a day the API has not published yet */ }
  }
  return out;
}
async function wikiSummary(title: string): Promise<{ extract: string; image: string | null; url: string }> {
  try {
    const j = JSON.parse(await get('https://en.wikipedia.org/api/rest_v1/page/summary/' + encodeURIComponent(title), 12000, { 'User-Agent': 'JainE-MarketWatch/1.0 (internal research)' }));
    return { extract: String(j.extract || '').slice(0, 400), image: (j.thumbnail || j.originalimage || {}).source || null, url: ((j.content_urls || {}).desktop || {}).page || 'https://en.wikipedia.org/wiki/' + encodeURIComponent(title) };
  } catch { return { extract: '', image: null, url: 'https://en.wikipedia.org/wiki/' + encodeURIComponent(title) }; }
}

// ---------------------------------------------------------------- 1. collect (cron, 4 times a day)
export async function trendsCollect(ctx: Ctx) {
  const jobs: [string, () => Promise<Raw[]>][] = [
    ['google IN', () => googleTrends('IN', 'IN')], ...WORLD_GEOS.map((g) => ['google ' + g, () => googleTrends(g, 'WORLD')] as [string, () => Promise<Raw[]>]),
    ['youtube IN', () => youtube('IN', 'IN')], ['youtube US', () => youtube('US', 'WORLD')], ['youtube GB', () => youtube('GB', 'WORLD')],
    ['apple IN', () => apple('in', 'IN')], ['apple US', () => apple('us', 'WORLD')],
  ];
  const rows: Raw[] = []; const errs: string[] = []; const counts: Record<string, number> = {};
  for (const [name, f] of jobs) { try { const r = await f(); rows.push(...r); counts[name] = r.length; } catch (e) { errs.push(`${name}: ${(e as Error).message}`); } }
  // one row per source + region + item + day; the latest reading of the day wins (views keep growing)
  const uniq = new Map<string, Raw>(); for (const r of rows) uniq.set([r.source, r.region, r.key, r.day].join('|'), r);
  const list = [...uniq.values()];
  if (!ctx.dry) {
    for (let i = 0; i < list.length; i += 200) {
      const { error } = await ctx.db.from('mw_trend_raw').upsert(list.slice(i, i + 200).map((r) => ({ ...r, collected_at: new Date().toISOString() })), { onConflict: 'source,region,key,day' });
      if (error) errs.push('save: ' + error.message);
    }
    await ctx.db.from('mw_trend_runs').insert({ kind: 'collect', items: list.length, note: JSON.stringify(counts).slice(0, 400), error: errs.join(' | ').slice(0, 500) || null });
  }
  return { items: list.length, counts, errors: errs, sample: ctx.dry ? list.slice(0, 5) : undefined };
}

// ---------------------------------------------------------------- 2. compile (Monday morning)
type Cand = { id: string; source: string; title: string; text: string; metric: number; metricText: string; date: string; url: string;
  media_url: string | null; media_type: string | null; video_id: string | null; links: { label: string; title: string; url: string }[] };

async function candidates(ctx: Ctx, region: string, from: string, to: string, days: string[]): Promise<Cand[]> {
  const { data, error } = await ctx.db.from('mw_trend_raw').select('*').eq('region', region).gte('day', from).lte('day', to);
  if (error) throw new Error('read: ' + error.message);
  // the same item over several days / countries -> one, with its biggest reading
  const agg = new Map<string, any>();
  for (const r of data || []) {
    const k = r.source + '|' + r.key; const o = agg.get(k);
    const better = !o || (r.source === 'apple' ? r.metric_value < o.metric_value : r.metric_value > o.metric_value);
    const days = new Set([...(o?._days || []), r.day]); const ctry = new Set([...(o?._c || []), r.country]);
    agg.set(k, { ...(better ? r : o), _days: [...days], _c: [...ctry], _first: o && o._first < r.day ? o._first : r.day });
  }
  const pick = (src: string, n: number, by: (a: any, b: any) => number) => [...agg.values()].filter((r) => r.source === src).sort(by).slice(0, n);
  const google = pick('google', 90, (a, b) => b._c.length - a._c.length || b.metric_value - a.metric_value);
  const yt = pick('youtube', 45, (a, b) => b.metric_value - a.metric_value);
  const ap = pick('apple', 25, (a, b) => a.metric_value - b.metric_value);
  const out: Cand[] = []; let n = 0;
  for (const r of google) out.push({ id: 'c' + n++, source: 'Google Trends', title: r.title, text: r.summary || '', metric: r.metric_value,
    metricText: `${r.extra?.traffic || short(r.metric_value) + '+'} searches${r._c.length > 1 ? ' in ' + r._c.length + ' countries' : ''}`, date: r._first, url: r.url,
    media_url: r.media_url, media_type: r.media_url ? 'image' : null, video_id: null,
    links: (r.extra?.news || []).slice(0, 2).map((x: any) => ({ label: x.source || 'News', title: x.title, url: x.url })) });
  for (const r of yt) out.push({ id: 'c' + n++, source: 'YouTube trending', title: r.title, text: r.summary || '', metric: r.metric_value,
    metricText: `${short(r.metric_value)} views on YouTube`, date: String(r.extra?.published || r._first).slice(0, 10), url: r.url,
    media_url: r.media_url, media_type: 'video', video_id: r.video_id, links: [{ label: 'YouTube', title: r.title, url: r.url }] });
  for (const r of ap) out.push({ id: 'c' + n++, source: 'Apple Music chart', title: r.title, text: r.summary || '', metric: r.metric_value,
    metricText: `#${r.metric_value} on Apple Music ${region === 'IN' ? 'India' : 'US'}`, date: r._first, url: r.url,
    media_url: r.media_url, media_type: 'image', video_id: null, links: [{ label: 'Apple Music', title: r.title, url: r.url }] });
  const wiki = [...(await wikiTop(region, days)).entries()].sort((a, b) => b[1].views - a[1].views).slice(0, 35);
  const sums = await Promise.all(wiki.map(([t]) => wikiSummary(t)));
  wiki.forEach(([t, w], i) => out.push({ id: 'c' + n++, source: 'Wikipedia most-read', title: t.replace(/_/g, ' '), text: sums[i].extract, metric: w.views,
    metricText: `${short(w.views)} Wikipedia reads${region === 'IN' ? ' from India' : ''} this week`, date: w.first, url: sums[i].url,
    media_url: sums[i].image, media_type: sums[i].image ? 'image' : null, video_id: null, links: [{ label: 'Wikipedia', title: t.replace(/_/g, ' '), url: sums[i].url }] }));
  return out;
}

const SRC_WEIGHT: Record<string, number> = { 'Google Trends': 1, 'YouTube trending': 0.8, 'Apple Music chart': 0.6, 'Wikipedia most-read': 0.7 };
export async function trendsCompile(ctx: Ctx, opts: { region?: string } = {}) {
  const to = istDay();                                           // up to this morning's snapshot
  const from = istDay(Date.now() - 7 * 86400e3);                 // 7 days back
  const days: string[] = []; for (let i = 7; i >= 1; i--) days.push(istDay(Date.now() - i * 86400e3));
  const report: any = { from, to, regions: {} };
  for (const region of opts.region ? [opts.region] : ['IN', 'WORLD']) {
    const cands = await candidates(ctx, region, from, to, days);
    if (!cands.length) { report.regions[region] = { trends: 0, note: 'nothing collected for this week yet' }; continue; }
    const byId = new Map(cands.map((c) => [c.id, c]));
    const r = await ctx.ask(`These items were trending ${region === 'IN' ? 'in INDIA' : 'WORLDWIDE (outside India)'} between ${from} and ${to}. They come from Google Trends (what people searched), the YouTube trending chart, the Apple Music top songs chart and Wikipedia's most-read pages. Each item has an id.
Group them into TRENDS: specific things that happened or caught people's attention in this period, which a real-estate brand's marketing team could reference in a short video or post to make people stop scrolling.
RULES
- Use ONLY these items. Never add a trend, fact, name, number or date that is not in the items' own text.
- One trend = one specific thing (a match or result, a film / show release, a song, a viral clip or meme, an announcement or launch, a celebrity moment). Items about the same thing go together.
- type: sports, movie_show, song, viral_moment, news_moment, local (Kolkata / West Bengal; India only), celebrity, brand_campaign (an ad or campaign by a brand), search_spike (only when the items say nothing beyond the search itself).
- LEAVE OUT: deaths, tragedies, accidents, disasters, crime, violence, war, terrorism, politics, elections, politicians, courts and legal cases, religious disputes, controversies, scandals, adult content; routine searches (exam results, admit cards, lottery, government schemes, share prices, weather, holidays lists); a festival or holiday by itself (keep only a specific moment around it that went viral); evergreen pages that are always read.
- title: a short English name (translate if needed). what: one or two plain English sentences on what happened, from the items' text only.
Reply JSON {"trends":[{"title":"...","type":"...","what":"...","items":["c3","c17"]}]} - at most 40, the ones drawing the most attention first. If nothing qualifies reply {"trends":[]}.
ITEMS
${cands.map((c) => `${c.id} | ${c.source} | ${c.date} | ${c.metricText} | ${c.title.slice(0, 140)}${c.text ? ' | ' + c.text.slice(0, 260).replace(/\s+/g, ' ') : ''}`).join('\n')}`);
    const raw: any[] = (r && Array.isArray(r.trends)) ? r.trends : [];
    const cards: any[] = []; const used = new Set<string>();
    for (const t of raw) {
      const items = (Array.isArray(t.items) ? t.items : []).map((x: any) => byId.get(String(x))).filter((c: Cand | undefined): c is Cand => !!c && !used.has(c.id));
      if (!items.length || !t.title || !t.what) continue;          // a trend must stand on at least one real item
      items.forEach((c) => used.add(c.id));
      const media = items.find((c) => c.video_id) || items.find((c) => c.source === 'Wikipedia most-read' && c.media_url) || items.find((c) => c.media_url) || null;
      const links: any[] = []; for (const c of items) for (const l of c.links) if (l.url && !links.some((x) => x.url === l.url)) links.push(l);
      const score = items.reduce((s, c) => s + (SRC_WEIGHT[c.source] || 0.5) * (c.source === 'Apple Music chart' ? Math.max(1, 6 - Math.log2(c.metric)) : Math.log10(Math.max(10, c.metric))), 0)
        + new Set(items.map((c) => c.source)).size * 2;
      cards.push({ period_from: from, period_to: to, region, type: TREND_TYPES.includes(t.type) ? t.type : 'search_spike',
        title: String(t.title).slice(0, 140), what: String(t.what).slice(0, 500),
        happened_on: items.map((c) => c.date).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d) && d >= from && d <= to).sort()[0] || from,
        media_url: media?.media_url || null, media_type: media ? (media.video_id ? 'video' : 'image') : null, video_id: media?.video_id || null,
        metrics: items.map((c) => c.metricText).filter((v, i, a) => a.indexOf(v) === i).slice(0, 4), sources: links.slice(0, 6),
        items: items.map((c) => ({ source: c.source, title: c.title })), score: Math.round(score * 100) / 100 });
    }
    cards.sort((a, b) => b.score - a.score);
    if (!ctx.dry) {
      await ctx.db.from('mw_trends').delete().eq('region', region).eq('period_from', from);
      if (cards.length) { const { error } = await ctx.db.from('mw_trends').insert(cards); if (error) throw new Error('save trends: ' + error.message); }
      await ctx.db.from('mw_trend_runs').insert({ kind: 'compile', region, items: cards.length, note: `${cands.length} items read, ${from} to ${to}` });
    }
    report.regions[region] = { candidates: cands.length, trends: cards.length, cards: ctx.dry ? cards : undefined };
  }
  return report;
}
