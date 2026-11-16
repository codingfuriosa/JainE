/* MARKET WATCH - AI (16 Nov 2026, Ayush: "Can we put AI somewhere if free ... I get Launch data from its data. And the
   Trends too can it be better ... Trending means that it's going on lately, people are discussing it, it's blowing up -
   not necessarily a video ... Videos, Photos, Movies, a Phrase, Text, Song ... everything should be positive, no negative
   things (Ronaldo retires) ... the Hooks are not hooks, they are proper videos - I want hook ideas where the user's thumb
   stops on our video ... attracting hooks on photos as well." Free: Gemini's and Groq's free tiers (keys already set),
   about 30-40 calls a day; every data source is free and needs no key.

   TRENDS ("pulse", every 3 hours). Candidates from three places, each measured by how fast it is rising, not by size:
     - Google Trending Now (India, United States, United Kingdom): searches that jumped in the last hours, with Google's
       search volume and the news headlines behind them;
     - Wikipedia's most-read articles yesterday, kept only when read at least twice as much as their own 7-day average
       (a spike, so the always-popular pages drop out);
     - YouTube's Trending chart (already read by this function into camp.mkt_videos).
   Gemini merges the same story across sources into one topic, names its kind (movie, song, person, phrase ...), writes
   why it is up in one line and judges its tone: anything negative (deaths, retirements, accidents, disasters, crime,
   war, scandals, political fights) is dropped, with a word list as a second net. Score = how many sources carry it +
   Google volume + Wikipedia spike. first_seen is kept from run to run ("new today").

   HOOK IDEAS (daily). Gemini writes scroll-stopping openings for our projects - video (first 2 seconds: the picture,
   on-screen text, first line) and photo (the headline on the image) - riding today's positive trends and the patterns of
   competitor ads that have run 30+ days (an ad still paid for after a month is working). Honest: no invented prices,
   offers or amenities.

   LAUNCHES (daily): premium and luxury residential launches across India from Google News headlines read by AI
   (see the LAUNCHES section) - replaced the competitor-ad reading the same evening at Ayush's word.

   SAVED as JSON files in the private storage bucket 'market-watch' (trends.json, hooks.json, launches.json,
   launch-news.json), read back through this function - no new tables. */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.47.10";

const SB = Deno.env.get('SUPABASE_URL')!;
const SRV = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const GKEY = Deno.env.get('GEMINI_API_KEY') || '';
const GROQ = Deno.env.get('GROQ_API_KEY') || '';
const st = createClient(SB, SRV);
const camp = createClient(SB, SRV, { db: { schema: 'camp' } });
const BUCKET = 'market-watch';
const UA = 'JainE-MarketWatch/1.0 (internal research)';
let T0 = Date.now();
export function startClock() { T0 = Date.now(); }
const left = () => 140_000 - (Date.now() - T0);

// ---------------------------------------------------------------- storage
async function ensureBucket() {
  const { data } = await st.storage.getBucket(BUCKET);
  if (!data) await st.storage.createBucket(BUCKET, { public: false });
}
// read fresh every time: storage serves files through a cache (an hour by default), which showed an old Launches list
export async function getJson(name: string): Promise<any> {
  const r = await fetch(`${SB}/storage/v1/object/authenticated/${BUCKET}/${name}?t=${Date.now()}`, { headers: { Authorization: 'Bearer ' + SRV, apikey: SRV, 'Cache-Control': 'no-cache' } });
  if (!r.ok) return null;
  try { return await r.json(); } catch (_) { return null; }
}
async function putJson(name: string, obj: unknown) {
  await ensureBucket();
  const { error } = await st.storage.from(BUCKET).upload(name, new Blob([JSON.stringify(obj)], { type: 'application/json' }), { upsert: true, contentType: 'application/json', cacheControl: '0' });
  if (error) throw new Error('storage ' + name + ': ' + error.message);
}

// ---------------------------------------------------------------- AI (Gemini free tier, Groq free tier as fallback)
async function gemini(model: string, prompt: string): Promise<any> {
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': GKEY },
    body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: prompt }] }], generationConfig: { responseMimeType: 'application/json', temperature: 0.4 } }) });
  if (!r.ok) throw new Error('Gemini ' + r.status + ' ' + (await r.text()).slice(0, 200));
  const t = await r.json();
  const txt = ((((t.candidates || [])[0] || {}).content || {}).parts || []).map((p: any) => p.text || '').join('');
  return JSON.parse(txt);
}
async function groq(prompt: string): Promise<any> {
  const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + GROQ },
    body: JSON.stringify({ model: 'llama-3.3-70b-versatile', temperature: 0.4, response_format: { type: 'json_object' },
      messages: [{ role: 'system', content: 'Reply with one JSON object only.' }, { role: 'user', content: prompt }] }) });
  if (!r.ok) throw new Error('Groq ' + r.status + ' ' + (await r.text()).slice(0, 200));
  const t = await r.json();
  return JSON.parse(t.choices[0].message.content);
}
export async function ask(prompt: string, smart = false): Promise<any> {
  const errs: string[] = [];
  if (GKEY) for (const m of smart ? ['gemini-flash-latest', 'gemini-flash-lite-latest'] : ['gemini-flash-lite-latest', 'gemini-flash-latest']) {
    try { return await gemini(m, prompt); } catch (e) { errs.push(String((e as Error).message)); }
  }
  if (GROQ) { try { return await groq(prompt); } catch (e) { errs.push(String((e as Error).message)); } }
  throw new Error('AI unavailable: ' + errs.join(' | ').slice(0, 400));
}

// ---------------------------------------------------------------- helpers
const NEG = /\b(dies|died|death|dead|passes away|passed away|killed|kills|murder|rape|assault|attack|terror|blast|bomb|war|strike[sd]? on|missile|crash|accident|collapse|suicide|arrest(ed)?|jail|scam|fraud|scandal|lawsuit|sued|flood|cyclone|earthquake|tsunami|landslide|wildfire|outbreak|virus|pandemic|riot|protest|violence|shooting|stampede|layoffs?|recession|retire[sd]?|retirement|injur(y|ed)|ruled out|banned|ban on|resigns?|sacked|fired|divorce|controvers|feud|slams|row over|nazi|concentration camp|9\/11|funeral|tribute|condolence|obituar|deaths in)\b/i;
function trafficNum(s: string) { const m = String(s || '').replace(/,/g, '').match(/([\d.]+)\s*([KkMm]?)/); if (!m) return 0; return +m[1] * (m[2] && /k/i.test(m[2]) ? 1e3 : m[2] && /m/i.test(m[2]) ? 1e6 : 1); }
function tag(xml: string, t: string) { const m = xml.match(new RegExp('<' + t + '>([\\s\\S]*?)</' + t + '>')); return m ? m[1].replace(/<!\[CDATA\[|\]\]>/g, '').replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"').trim() : ''; }
function tags(xml: string, t: string) { const out: string[] = []; const re = new RegExp('<' + t + '>([\\s\\S]*?)</' + t + '>', 'g'); let m; while ((m = re.exec(xml))) out.push(m[1].replace(/<!\[CDATA\[|\]\]>/g, '').replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"').trim()); return out; }
const ymd = (d: Date) => d.toISOString().slice(0, 10).replace(/-/g, '');
async function pool<T, R>(items: T[], n: number, f: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length); let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (i < items.length) { const k = i++; try { out[k] = await f(items[k]); } catch (_) { out[k] = null as any; } } }));
  return out;
}

// ---------------------------------------------------------------- TRENDS
async function googleNow(geo: string) {
  const r = await fetch('https://trends.google.com/trending/rss?geo=' + geo, { headers: { 'User-Agent': UA } });
  if (!r.ok) return [];
  const xml = await r.text();
  return xml.split('<item>').slice(1).map((it) => ({ src: 'google', geo: geo === 'IN' ? 'IN' : 'WORLD', title: tag(it, 'title'), traffic: trafficNum(tag(it, 'ht:approx_traffic')),
    picture: tag(it, 'ht:picture'), news: tags(it, 'ht:news_item_title').slice(0, 2), url: tags(it, 'ht:news_item_url')[0] || '' })).filter((x) => x.title);
}
const WIKI_SKIP = /^(Main_Page|Special:|Wikipedia:|Portal:|File:|Help:|Template:|Category:|Talk:|User:|Deaths_in|List_of_|XXX|Pornhub|Archive_of_Our_Own|Cleopatra|Google|Facebook|YouTube|Instagram|ChatGPT|Bible|Sex|Porn|Xvideos|Xnxx)/i;
async function wikiSpikes() {
  const y = new Date(Date.now() - 86400_000), p = (n: number) => new Date(Date.now() - n * 86400_000);
  const d = y.toISOString().slice(0, 10).split('-').join('/');
  const r = await fetch(`https://wikimedia.org/api/rest_v1/metrics/pageviews/top/en.wikipedia/all-access/${d}`, { headers: { 'User-Agent': UA } });
  if (!r.ok) return [];
  const arts = ((((await r.json()).items || [])[0] || {}).articles || []).filter((a: any) => !WIKI_SKIP.test(a.article)).slice(0, 70);
  const rows = await pool(arts, 8, async (a: any) => {
    // rising = yesterday, or the last 7 days on average, read at least twice as much as the 3 weeks before (median):
    // catches a sudden spike (Jensen Huang) and a story that has been big all week but was not before (Ramayana: Part 1)
    const u = `https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article/en.wikipedia/all-access/user/${encodeURIComponent(a.article)}/daily/${ymd(p(29))}/${ymd(y)}`;
    const q = await fetch(u, { headers: { 'User-Agent': UA } }); if (!q.ok) return null;
    const v = ((await q.json()).items || []).map((x: any) => +x.views || 0); if (!v.length) return null;
    const last = v[v.length - 1], wk = v.slice(-7), base = v.slice(0, -7).sort((x: number, z: number) => x - z);
    const med = base.length ? base[base.length >> 1] : 0, wAvg = wk.reduce((s: number, x: number) => s + x, 0) / wk.length;
    const spike = med > 0 ? Math.max(last, wAvg) / med : 99;
    return spike >= 2 ? { src: 'wikipedia', geo: 'WORLD', title: a.article.replace(/_/g, ' '), views: last, spike: Math.round(spike * 10) / 10, url: 'https://en.wikipedia.org/wiki/' + a.article } : null;
  });
  return rows.filter(Boolean) as any[];
}
async function wikiThumb(title: string) {
  try { const r = await fetch('https://en.wikipedia.org/api/rest_v1/page/summary/' + encodeURIComponent(title.replace(/ /g, '_')), { headers: { 'User-Agent': UA } });
    if (!r.ok) return ''; const t = await r.json(); return (t.thumbnail && t.thumbnail.source) || ''; } catch (_) { return ''; }
}
async function ytNow() {
  const { data } = await camp.from('mkt_videos').select('video_id,title,channel,views,tag,thumb,last_seen').eq('kind', 'trend').order('last_seen', { ascending: false }).limit(400);
  const rows = data || []; if (!rows.length) return [];
  const latest = Date.parse(rows[0].last_seen);
  const by: Record<string, any> = {};
  rows.filter((x: any) => latest - Date.parse(x.last_seen) < 30 * 60000).forEach((x: any) => { if (!by[x.video_id]) by[x.video_id] = x; });
  return Object.values(by).slice(0, 60).map((x: any) => ({ src: 'youtube', geo: x.tag === 'IN' ? 'IN' : 'WORLD', title: x.title, channel: x.channel, views: +x.views || 0, picture: x.thumb, url: 'https://www.youtube.com/watch?v=' + x.video_id }));
}
export async function pulse(save: boolean) {
  const [gIN, gUS, gGB, wk, yt] = await Promise.all([googleNow('IN'), googleNow('US'), googleNow('GB'), wikiSpikes().catch(() => []), ytNow().catch(() => [])]);
  const cands = [...gIN, ...gUS, ...gGB, ...wk, ...yt].map((c: any, i: number) => ({ id: i, ...c }));
  if (!cands.length) throw new Error('no trend sources answered');
  const lines = cands.map((c: any) => `${c.id} | ${c.src} ${c.geo} | ${c.title}` + (c.news && c.news.length ? ' | news: ' + c.news.join(' / ') : '') + (c.channel ? ' | channel: ' + c.channel : '')
    + (c.traffic ? ' | searches ' + c.traffic : '') + (c.spike ? ' | read ' + c.spike + 'x usual' : '')).join('\n');
  const out = await ask(`You are the trend desk of a premium real-estate brand in Kolkata, India. Below are things rising RIGHT NOW (Google searches that jumped, Wikipedia pages read far more than usual, YouTube's trending chart). Group lines about the same story into ONE topic. For each topic return:
- topic: short natural name people would recognise (e.g. "Ramayana: Part 1", "Jensen Huang", a song title, a viral phrase)
- kind: one of movie, show, song, person, sport, tech, business, phrase, event, festival, other
- why: one plain sentence on why people are talking about it now
- tone: positive, neutral or negative. Positive = exciting, celebratory, inspiring, fun: releases, trailers, launches, wins, records, festivals, achievements, viral fun moments, new music. Negative = death, retirement, injury, accident, disaster, illness, crime, war, terror, scandal, lawsuit, layoffs, prices falling, outages, security breaches, political fight, anything sad, worrying or divisive. Plain news with no feel-good angle is neutral.
- safe: true only if a premium family-oriented brand could comfortably reference it (no politics, religion disputes, health/disease, adult content, gambling, alcohol, crime)
- relevant: true if urban Indians (especially Kolkata, 25-45, aspirational) would know or care about it - Indian and global movies, shows, music, cricket and football, big tech and business names, viral moments, festivals. False for niche foreign topics (American football coaching, local US/UK politics or weather, minor celebrities)
- region: IN if mainly an India story, else WORLD
- ids: the line numbers you grouped into it
- hook: one short, tasteful idea for how our brand could ride this topic in a social post (only if tone is positive and safe; else "")
Skip routine sports fixtures with no story, stock tickers, generic words, and anything you cannot identify. Also return relevant (true/false). Return {"topics":[...]} with at most 50 topics, most talked-about first.

${lines}`, true);
  const prev = (await getJson('trends.json')) || { topics: [] };
  const firstSeen: Record<string, string> = {}; (prev.topics || []).forEach((t: any) => { firstSeen[String(t.topic).toLowerCase()] = t.first_seen; });
  const now = new Date().toISOString();
  const topics: any[] = [];
  for (const t of (out.topics || [])) {
    if (!t || !t.topic || t.tone !== 'positive' || t.safe === false || t.relevant === false) continue;   // positive only (Ayush)
    if (NEG.test(t.topic + ' ' + (t.why || ''))) continue;
    const src = (t.ids || []).map((i: any) => cands[+i]).filter(Boolean);
    if (!src.length) continue;
    if (src.some((c: any) => NEG.test(c.title + ' ' + (c.news || []).join(' ')))) continue;
    const kinds = new Set(src.map((c: any) => c.src));
    const g = src.filter((c: any) => c.src === 'google').reduce((s: number, c: any) => s + (c.traffic || 0), 0);
    const sp = Math.max(0, ...src.filter((c: any) => c.src === 'wikipedia').map((c: any) => c.spike || 0));
    const ytv = Math.max(0, ...src.filter((c: any) => c.src === 'youtube').map((c: any) => c.views || 0));
    const score = kinds.size * 2 + Math.log10(g + 1) + Math.log2(Math.min(sp, 50) + 1) + (ytv ? Math.log10(ytv + 1) / 3 : 0);
    const pic = (src.find((c: any) => c.picture) || {}).picture || '';
    const wiki = src.find((c: any) => c.src === 'wikipedia');
    topics.push({ topic: t.topic, kind: t.kind || 'other', why: t.why || '', region: t.region === 'IN' ? 'IN' : 'WORLD', hook: t.hook || '',
      score: Math.round(score * 10) / 10, searches: g || null, spike: sp || null, yt_views: ytv || null, sources: [...kinds],
      picture: pic, wiki: wiki ? wiki.title : '', links: src.slice(0, 4).map((c: any) => ({ src: c.src, title: c.title, url: c.url })),
      first_seen: firstSeen[String(t.topic).toLowerCase()] || now });
  }
  // a picture for topics that have none: the Wikipedia article's own
  await pool(topics.filter((t) => !t.picture && t.wiki), 6, async (t: any) => { t.picture = await wikiThumb(t.wiki); });
  topics.sort((a, b) => b.score - a.score);
  const res = { at: now, topics, candidates: { google: gIN.length + gUS.length + gGB.length, wikipedia: wk.length, youtube: yt.length } };
  if (save) await putJson('trends.json', res);
  return res;
}

// ---------------------------------------------------------------- HOOK IDEAS
const OUR_PROJECTS = [
  'Dream Gurukul - Madhyamgram, North Kolkata (residential)', 'Dream Ananta - Madhyamgram, North Kolkata (residential)',
  'Dream World City - Joka, South Kolkata (large township)', 'Dream One - Kolkata (residential)', 'Dream Eco City - Kolkata (residential township)',
  'Dream Valley - Hill Cart Road, Siliguri (ready 3 BHK flats)'];
export async function provenAds() {
  const since = new Date(Date.now() - 30 * 86400_000).toISOString(), live = new Date(Date.now() - 5 * 86400_000).toISOString();
  const { data } = await camp.from('competitor_ads').select('id,watchlist_id,page_name,headline,ad_creative_bodies,ad_creative_link_titles,media_type,media_items,media_s3_path,ad_snapshot_url,ad_delivery_start_time,last_seen_at')
    .lt('ad_delivery_start_time', since).gt('last_seen_at', live).limit(1000);
  const seen = new Set<string>(), out: any[] = [];
  for (const a of data || []) {
    const body = ((a.ad_creative_bodies || [])[0] || '').trim();
    const first = (body.split(/\n|(?<=[.!?।|])\s/)[0] || a.headline || '').trim().slice(0, 160);
    if (!first || first.length < 12) continue;
    const k = first.toLowerCase().replace(/[^a-z0-9]/g, ''); if (seen.has(k)) continue; seen.add(k);
    out.push({ id: a.id, brand: a.page_name, first, headline: a.headline || '', media_type: a.media_type, media_items: a.media_items, media_s3_path: a.media_s3_path,
      snapshot: a.ad_snapshot_url, days: Math.round((Date.parse(a.last_seen_at) - Date.parse(a.ad_delivery_start_time)) / 86400_000) });
  }
  return out.sort((a, b) => b.days - a.days).slice(0, 60);
}
export async function hookIdeas(save: boolean) {
  const tr = (await getJson('trends.json')) || { topics: [] };
  const topics = (tr.topics || []).slice(0, 15).map((t: any) => `- ${t.topic} (${t.kind}): ${t.why}`).join('\n');
  const proven = await provenAds();
  const pl = proven.slice(0, 40).map((p: any, i: number) => `${i} | ${p.brand} | ran ${p.days} days | ${p.first}`).join('\n');
  const out = await ask(`You are the creative director of The Jain Group, a premium real-estate developer in Kolkata, India. Write scroll-stopping HOOKS - the first thing a person sees in a Facebook/Instagram feed that stops their thumb.

What a hook must be: bold, click-worthy, impossible to scroll past - the way top Reels creators and the best ad agencies open. Use a curiosity gap (the viewer must watch/read on to find out), a pattern interrupt (an unexpected first shot or line), a sharp contrast, a striking number, a direct "you" line, a "POV:", a challenge, a myth-buster, or riding a trending topic people are already talking about. Short and punchy: spoken lines under 10 words, on-screen text under 7. Video visuals must be a strong first 2 seconds (movement, a surprise, a face reacting, a dramatic reveal), photo hooks a striking image with a headline that teases.
NEVER write soft brochure language ("timeless", "elegance", "epic proportions", "redefine", "discover", "experience luxury", "nestled", "where dreams..."). Clickbait-style teasing is wanted, but stay honest: the payoff must be real.

Our projects (use only these facts; do NOT invent prices, offers, sizes, amenities or awards):
${OUR_PROJECTS.map((p) => '- ' + p).join('\n')}

Trending now (positive topics people are talking about):
${topics || '- (none today)'}

Competitor real-estate ads that have kept running 30+ days (their opening line works - learn the pattern, never copy):
${pl || '- (none)'}

Return JSON {"ideas":[...], "proven":[...]}:
ideas: 16 hooks - 8 with format "video" and 8 with format "photo". Each: {format, project, pattern (one of Curiosity, Question, Bold contrast, Number, Trend-jack, Story, Before-after, Myth-buster, POV, Challenge), hook (the opening line, max 10 words, bold and teasing), visual (what is on screen in the first 2 seconds, or what the photo shows), on_screen (the big text on the video/photo, max 8 words), why (why it stops the scroll, one short line), trend (the trending topic it rides, or "")}. At least 5 should ride a trending topic tastefully. Professional, positive, aspirational; English with an occasional Bengali or Hindi word is fine. No fear, no negativity, no fake urgency, no false claims.
proven: for each competitor line above that is a genuinely strong hook (max 20): {i (its number), pattern (same list), why (one short line on why it works)}.`, true);
  const ideas = (out.ideas || []).filter((x: any) => x && x.hook && !NEG.test(x.hook + ' ' + (x.on_screen || '')));
  const pmap: Record<number, any> = {}; (out.proven || []).forEach((p: any) => { if (p && proven[+p.i]) pmap[+p.i] = p; });
  const res = { at: new Date().toISOString(), ideas, proven: proven.map((p: any, i: number) => (pmap[i] ? { ...p, pattern: pmap[i].pattern, why: pmap[i].why } : null)).filter(Boolean) };
  if (save) await putJson('hooks.json', res);
  return res;
}

// ---------------------------------------------------------------- LAUNCHES
/* PREMIUM AND LUXURY LAUNCHES ACROSS INDIA (16 Nov 2026, Ayush: "I want Premium and Luxury Launches but all over India
   ... don't consider launches through Ads ... add API ... Get My Ghar is a CP, not a developer - don't consider CPs").
   Source: Google News (its free RSS search, India edition) for launch news over the last 90 days - general searches plus
   one per big city. AI reads each headline once (kept in launch-news.json, so each morning only new articles are sent)
   and keeps only a specific NEW residential project actually launched (not plans, pipelines, sales figures or land
   deals), with the developer (the builder - never a broker, channel partner or portal), city, locality, segment,
   starting price and size. Only luxury and premium projects are kept. One project reported by many papers is one row;
   "launched" = the earliest report. */
const LN_QUERIES = ['luxury residential project launch', 'launches luxury housing project', 'launches premium residential project',
  'ultra luxury apartments launched', 'launches luxury villas project', 'new luxury project launched crore', 'launches luxury project homes',
  'premium housing project launched', 'luxury tower launch developer', 'launches high-end residential project'];
const LN_CITIES = ['Mumbai', 'Gurugram', 'Noida', 'Delhi', 'Bengaluru', 'Pune', 'Hyderabad', 'Chennai', 'Kolkata', 'Ahmedabad', 'Goa', 'Thane'];
const NOT_DEV = /\b(anarock|square ?yards|proptiger|housing\.com|magicbricks|99acres|nobroker|get ?my ?ghar|wordsmith|jll|knight frank|cbre|colliers|propequity|liases foras|realtors?|broker|channel partner|consultan|propert(y|ies) advisor)/i;
/* ONLY THESE DEVELOPERS (16 Nov 2026, Ayush: "If the projects are limited to these companies or brands it would be nice").
   Each is also searched by name over the last 6 months, so a brand's launch is found even when it is not in a general
   "luxury launch" story. Matched in the developer or project name the AI read from the headline. */
export const LN_BRANDS: [string, RegExp][] = [
  ['DTC Group', /\bdtc\b/i], ['Siddha Group', /\bsiddha\b/i], ['Srijan Realty', /\bsrijan\b/i], ['Diamond Group', /\bdiamond group\b/i],
  ['Merlin Group', /\bmerlin\b/i], ['Eden Group', /\beden (group|realty|real estate)\b/i], ['Ambuja Neotia', /\bambuja\b|\bneotia\b/i],
  ['Alcove Realty', /\balcove\b/i], ['Godrej Properties', /\bgodrej\b/i], ['Mani Group', /\bmani (group|casa|square)\b/i],
  ['Vinayak Group', /\bvinayak\b/i], ['Unimark Group', /\bunimark\b/i], ['Emami Realty', /\bemami\b/i], ['Sugam Homes', /\bsugam\b/i],
  ['Primarc Group', /\bprimarc\b/i], ['Orbit Group', /\borbit (group|developers|realty)\b/i], ['Gems Group', /\bgems (group|city|realty)\b/i]];
const LN_BRAND_Q = ['DTC Group', 'Siddha Group', 'Srijan Realty', 'Diamond Group Kolkata', 'Merlin Group', 'Eden Group Kolkata', 'Eden Realty',
  'Ambuja Neotia', 'Alcove Realty', 'Godrej Properties', 'Mani Group Kolkata', 'Vinayak Group Kolkata', 'Unimark Group', 'Emami Realty',
  'Sugam Homes', 'Primarc Group', 'Orbit Group Kolkata', 'Gems Group Kolkata'];
async function newsSearch(q: string, days = 90) {
  const r = await fetch('https://news.google.com/rss/search?q=' + encodeURIComponent(q + ' when:' + days + 'd') + '&hl=en-IN&gl=IN&ceid=IN:en', { headers: { 'User-Agent': UA } });
  if (!r.ok) return [];
  const xml = await r.text();
  return xml.split('<item>').slice(1).map((it) => {
    const full = tag(it, 'title'), sm = it.match(/<source[^>]*>([\s\S]*?)<\/source>/), src = sm ? sm[1].replace(/&amp;/g, '&').trim() : '';   // <source url=...>Paper</source>
    const t = src && full.endsWith(' - ' + src) ? full.slice(0, -(src.length + 3)) : full.replace(/\s+-\s+[^-]+$/, '');
    const d = new Date(tag(it, 'pubDate'));
    return { title: t, source: src, link: tag(it, 'link'), date: isNaN(+d) ? '' : d.toISOString().slice(0, 10) };
  }).filter((x) => x.title && x.date);
}
/* DAILY WEB SEARCH FOR NEW BUILDINGS (16 Nov 2026, Ayush: "just daily it will report if any new building has been launched
   and it will be added in the list - only maximum 60 days"). Besides the news headlines, every morning Gemini searches
   the web (Google Search, free tier - 4 searches a day) for each group of the listed developers: any new residential
   project / tower launched or newly RERA-registered in the last 60 days. Answers come back one line per project and keep
   the pages they came from. */
async function webFind(devs: string[], from: string, to: string): Promise<any[]> {
  if (!GKEY) return [];
  const prompt = `Search the web for NEW residential real-estate projects (or a new tower / phase with its own name) launched, unveiled or newly registered on RERA in India between ${from} and ${to} by these developers: ${devs.join(', ')}.
Only real projects you find on the web with their own marketed name - never invent one, never include a project launched before ${from}, never a commercial / office / hotel project, never a broker's listing.
Reply with one line per project exactly in this form and nothing else:
PROJECT | DEVELOPER | LOCALITY | CITY | LAUNCH DATE (YYYY-MM-DD, or YYYY-MM) | SEGMENT (luxury, premium, mid or affordable) | PRICE FROM (or -)
If you find none, reply NONE.`;
  for (const m of ['gemini-flash-latest', 'gemini-2.5-flash']) {
    try {
      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': GKEY },
        body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: prompt }] }], tools: [{ google_search: {} }], generationConfig: { temperature: 0.1 } }) });
      if (!r.ok) continue;
      const t = await r.json(), c = (t.candidates || [])[0] || {};
      const text = ((c.content || {}).parts || []).map((p: any) => p.text || '').join('');
      const gm = c.groundingMetadata || {}, chunks = gm.groundingChunks || [], supports = gm.groundingSupports || [];
      const lines = text.split('\n').map((l: string) => l.trim()).filter((l: string) => (l.match(/\|/g) || []).length >= 5);
      return lines.map((l: string) => {
        const f = l.replace(/^[-*•\s]+/, '').split('|').map((x: string) => x.replace(/\*/g, '').trim());
        // the pages Google says this line came from
        const src: any[] = [];
        for (const s of supports) {
          const seg = String((s.segment || {}).text || '');
          if (!seg || l.indexOf(seg.trim().slice(0, 30)) === -1) continue;
          for (const i of s.groundingChunkIndices || []) { const w = (chunks[i] || {}).web; if (w && w.uri && !src.some((x) => x.link === w.uri)) src.push({ title: w.title || 'Web', source: w.title || 'Web', link: w.uri }); }
        }
        let d = String(f[4] || ''); if (/^\d{4}-\d{2}$/.test(d)) d += '-01';
        return { p: f[0], d: f[1], l: f[2] === '-' ? '' : f[2], c: f[3] === '-' ? '' : f[3], date: /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : '',
          s: String(f[5] || '').toLowerCase(), pr: f[6] && f[6] !== '-' ? f[6] : '', sources: src.slice(0, 3) };
      }).filter((x: any) => x.p && x.date);
    } catch (_) { /* next model */ }
  }
  return [];
}
export async function launches(save: boolean, maxBatches = 12) {
  const cache: Record<string, any> = (await getJson('launch-news-v4.json')) || {};
  const qs: [string, number][] = [...LN_QUERIES.map((q): [string, number] => [q, 60]), ...LN_CITIES.map((c): [string, number] => ['luxury project launch ' + c, 60]),
    ...LN_BRAND_Q.map((b): [string, number] => ['"' + b.replace(/ Kolkata$/, '') + '"' + (/ Kolkata$/.test(b) ? ' Kolkata' : '') + ' launch project', 60]),
    ...LN_BRAND_Q.map((b): [string, number] => ['"' + b.replace(/ Kolkata$/, '') + '"' + (/ Kolkata$/.test(b) ? ' Kolkata' : '') + ' new project', 60]),
    ...LN_BRAND_Q.map((b): [string, number] => ['"' + b.replace(/ Kolkata$/, '') + '"' + (/ Kolkata$/.test(b) ? ' Kolkata' : '') + ' launches', 60]),
    ...LN_BRAND_Q.map((b): [string, number] => ['"' + b.replace(/ Kolkata$/, '') + '"' + (/ Kolkata$/.test(b) ? ' Kolkata' : '') + ' unveils', 60])];
  const lists = await pool(qs, 6, (q) => newsSearch(q[0], q[1]));
  const arts: Record<string, any> = {};
  for (const l of lists) for (const a of l || []) { const k = a.title.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 160); if (k.length > 15 && !arts[k]) arts[k] = { ...a, k }; }
  const todo = Object.values(arts).filter((a: any) => !cache[a.k]);
  let done = 0;
  for (let i = 0; i < todo.length && done < maxBatches; i += 50) {
    if (left() < 25_000) break;
    const b = todo.slice(i, i + 50);
    try {
      const out = await ask(`Each numbered line is an Indian news headline (with its date and paper). For each, decide whether it reports a SPECIFIC NEW residential real-estate project being launched, unveiled or introduced (or launching within weeks) - this includes a new tower or phase launched, and sales or bookings reported AT a new project's launch ("sells homes worth Rs 2,000 cr at Bengaluru project launch" is a launch). Not a launch: a developer's plans or pipeline for the year ("plans Rs 32,000 cr of launches"), yearly sales or booking figures, quarterly results, land purchases, joint ventures, commercial/office/retail/warehouse projects, hotels or resorts (unless homes / branded residences are sold), or an older project's phase being sold out.
Return {"items":[{"i":number,"launch":true/false,"project":"project name","developer":"the builder / developer company - NEVER a broker, channel partner, property consultant or portal (Anarock, Square Yards, PropTiger, JLL, Knight Frank...); empty if not stated","city":"city (from the headline or, for a well-known project, where it is)","country":"country the project is in","locality":"area / sector, or empty","segment":"luxury | premium | mid | affordable - luxury = ultra-luxury / luxury or homes from about Rs 3 Cr; premium = premium / high-end or about Rs 1.5-3 Cr; judge from the words and price","price_from":"starting price as written, or empty","size":"project size as written, e.g. Rs 4,000 crore revenue potential, 500 units, 12 acres - or empty"}]}. Only what the headline says; do not guess project names. "project" must be the housing project's own marketed name (e.g. "Siddha Sky", "Orizon", "Godrej City Panvel") - leave it EMPTY when the headline does not name one, and never put a sales campaign, collection, event, amenity, street, promenade or a description ("Bengaluru project", "luxury towers", "The Elevated Living Edit") there.

${b.map((a: any, j: number) => `${j} | ${a.date} | ${a.source} | ${a.title}`).join('\n')}`);
      for (const x of out.items || []) { const a = b[+x.i]; if (a) cache[a.k] = { ln: !!x.launch, p: x.project || '', d: x.developer || '', c: x.city || '', co: x.country || '', l: x.locality || '', s: x.segment || '', pr: x.price_from || '', sz: x.size || '' }; }
      b.forEach((a: any) => { if (!cache[a.k]) cache[a.k] = { ln: false }; });
      done++;
    } catch (_) { break; }
  }
  await putJson('launch-news-v4.json', cache);
  // one row per project: developer's first word + the project name without it
  const norm = (v: string) => String(v || '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
  const by: Record<string, any> = {};
  for (const a of Object.values(arts) as any[]) {
    const x = cache[a.k]; if (!x || !x.ln) continue;
    // only the listed developers (any segment - the list is the premium set); the brand from the developer or project name
    const br = LN_BRANDS.find((b) => b[1].test(x.d + ' ' + x.p) || (!x.d && b[1].test(a.title)));
    if (!br) continue;
    x.d = x.d || br[0];
    if (!/india/i.test(String(x.co || ''))) continue;   // India only (Ayush: "all over India")
    // a hotel opening is not a home launch - kept only when it sells residences / villas
    if (/hotel|hospitality|accor|marriott|hyatt|hilton|ihcl|sofitel|radisson|anantara|minor hotels|taj hotels/i.test(x.d + ' ' + x.p) && !/residen|villa|home|apartment|condo/i.test(x.p + ' ' + a.title)) continue;
    // offices, shops, malls and warehouses are not home launches
    if (/commercial|office|retail|mall|warehouse|logistics|data cent/i.test(x.p + ' ' + x.sz + ' ' + a.title) && !/residen|villa|home|apartment|flat|bhk/i.test(x.p + ' ' + a.title)) continue;
    if (NOT_DEV.test(x.d) || /jain group|dream gateway/i.test(x.d)) continue;
    // only a named project (16 Nov 2026, Ayush: "these are not projects, some are named New Project in Bengaluru")
    if (!x.p || /^(new|the)?\s*(project|projects|launch|tower|towers|homes|residences)\b/i.test(x.p) || /\b(edit|edition|campaign|collection|promenade|festival|offer)\b/i.test(x.p)) continue;
    const dw = norm(br[0]).split(' ')[0], pk = norm(x.p).split(' ').filter((w) => w !== dw && w !== norm(x.d).split(' ')[0]).join('');
    if (pk.length < 3) continue;
    const k = dw + '|' + pk;
    const o = by[k] = by[k] || { project: x.p, developer: x.d, brand: br[0], city: '', locality: '', segment: String(x.s).toLowerCase(), price: '', size: '', launched: a.date, reports: 0, news: [] as any[] };
    if (a.date < o.launched) o.launched = a.date;
    o.city = o.city || x.c; o.locality = o.locality || x.l; o.price = o.price || x.pr; o.size = o.size || x.sz;
    if (String(x.s).toLowerCase() === 'luxury') o.segment = 'luxury';
    o.reports++; o.news.push({ title: a.title, source: a.source, link: a.link, date: a.date });
  }
  // the daily web search, the listed developers in 4 groups; a project found there joins the same rows as the news
  const istToday = new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);
  const cut60 = new Date(Date.now() + 5.5 * 3600_000 - 60 * 86400_000).toISOString().slice(0, 10);
  const groups = [LN_BRANDS.slice(0, 5), LN_BRANDS.slice(5, 9), LN_BRANDS.slice(9, 13), LN_BRANDS.slice(13)].map((g) => g.map((b) => b[0]));
  const web = left() > 40_000 ? (await pool(groups, 2, (g) => webFind(g, cut60, istToday))).flat().filter(Boolean) : [];
  for (const x of web as any[]) {
    const br = LN_BRANDS.find((b) => b[1].test(x.d + ' ' + x.p)); if (!br) continue;
    if (NOT_DEV.test(x.d) || /jain group|dream gateway/i.test(x.d)) continue;
    if (/hotel|resort|commercial|office|retail|mall|warehouse|logistics/i.test(x.p)) continue;
    if (/^(new|the)?\s*(project|projects|launch|tower|towers|homes|residences)\b/i.test(x.p) || /\b(edit|edition|campaign|collection|promenade|festival|offer)\b/i.test(x.p)) continue;
    const dw = norm(br[0]).split(' ')[0], pk = norm(x.p).split(' ').filter((w) => w !== dw && w !== norm(x.d).split(' ')[0]).join('');
    if (pk.length < 3) continue;
    const k = dw + '|' + pk;
    const o = by[k] = by[k] || { project: x.p, developer: x.d || br[0], brand: br[0], city: '', locality: '', segment: x.s, price: '', size: '', launched: x.date, reports: 0, news: [] as any[] };
    if (x.date < o.launched) o.launched = x.date;
    o.city = o.city || x.c; o.locality = o.locality || x.l; o.price = o.price || x.pr; o.segment = o.segment || x.s;
    o.reports++; for (const s of x.sources) o.news.push({ ...s, date: x.date });
  }
  // the same project under two names / two company names ("The Ridge" and "The Ridge Luxury Villas"; HoABL and House
  // of Abhinandan Lodha): a name inside the other, in the same city or with no city, is one project
  const core = (v: string) => norm(v).replace(/\b(the|luxury|ultra|villas?|residences?|homes|apartments?|tower|towers|collection|estates?|resort|and|at|by|promenade|phase|godrej|siddha|srijan|merlin|eden|dtc|ambuja|neotia|alcove|mani|vinayak|unimark|emami|sugam|primarc|orbit|gems|diamond)\b/g, ' ').replace(/[^a-z0-9]/g, '');
  const ks = Object.keys(by).sort((a, b) => core(by[a].project).length - core(by[b].project).length);
  for (const k of ks) {
    const o = by[k]; if (!o) continue; const c = core(o.project); if (c.length < 5) continue;
    for (const k2 of ks) {
      const t = by[k2]; if (!t || k2 === k) continue; const c2 = core(t.project);
      if (c2.indexOf(c) === -1) continue;   // same core name, or one inside the other
      if (o.city && t.city && norm(o.city) !== norm(t.city)) continue;
      if (t.launched < o.launched) o.launched = t.launched; o.city = o.city || t.city; o.locality = o.locality || t.locality; o.price = o.price || t.price; o.size = o.size || t.size;
      if (t.segment === 'luxury') o.segment = 'luxury'; o.reports += t.reports; o.news.push(...t.news); delete by[k2];
    }
  }
  // the list grows day by day and keeps 60 days (Ayush): a project found on an earlier day stays until 60 days after its
  // launch even if today's search does not bring it up again; first_seen = the day it was first added ("new" on the page)
  const prevL = (await getJson('launches.json')) || { projects: [] };
  const pkey = (o: any) => norm(o.brand || '') + '|' + core(o.project);
  const prevMap: Record<string, any> = {}; for (const o of prevL.projects || []) if (o && o.brand && o.project) prevMap[pkey(o)] = o;
  const nowIso = new Date().toISOString();
  const cur = Object.values(by).map((o: any) => ({ ...o, first_seen: (prevMap[pkey(o)] || {}).first_seen || nowIso }));
  const curKeys = new Set(cur.map(pkey));
  for (const o of Object.values(prevMap)) if (!curKeys.has(pkey(o))) cur.push(o);
  const projects = cur.filter((o: any) => String(o.launched) >= cut60).map((o: any) => ({ ...o, news: (o.news || []).sort((p: any, q: any) => String(p.date).localeCompare(String(q.date))).slice(0, 3) }))
    .sort((a: any, b: any) => String(b.launched).localeCompare(String(a.launched)));
  const waiting = Object.values(arts).filter((a: any) => !cache[a.k]).length;
  const res = { at: new Date().toISOString(), projects, web_found: web.length, articles_read: Object.keys(arts).length - waiting, articles_waiting: waiting };
  if (save) await putJson('launches.json', res);
  return res;
}

