/* DIGITAL METRICS - pulls Google data for our brand and competitors into camp.dm_* (16 Oct 2026).

   Official APIs only, read-only, and every number is stored exactly as Google returned it. Nothing
   here estimates, fills a gap or smooths a series: a day Google has not reported is simply absent.

   PARTS ({action:'sync', part}) - each is independent; the nightly cron fires all six side by side:
     yt_public  YouTube Data API v3 with YOUTUBE_API_KEY - public subscriber / view / video counts for
                every CONFIRMED channel in camp.dm_yt_channels (ours and competitors'), plus EVERY upload
                of each (whole uploads playlist, resumed across runs via dm_yt_channels.list_cursor;
                afterwards only the newest page for new uploads) and each video's public view / like /
                comment counts, re-read daily for all stored videos. ~100-150 quota units a day.
     yt_own     YouTube Analytics API on the marketing connection - our channel(s) only.
     places     Places API (New) with GOOGLE_PLACES_API_KEY - rating, review count and the (at most 5)
                reviews Google shows, for every CONFIRMED place in camp.dm_places.
     gbp        Business Profile Performance API + reviews - our listings (marketing connection).
     gsc        Search Console - our sites (marketing connection).
     ga4        GA4 Data API - our properties (marketing connection).
   Other actions: discover (list what the connected account can see), find_channel, find_place
   (lookups for the brand-mapping screen).

   WHO MAY CALL. The cron, with the x-dm-secret header matching acc.job_secrets 'digital_metrics';
   or a signed-in JAIN-E person holding the Digital Metrics module (camp.dm_allowed()). verify_jwt is
   off because the cron sends no user session; the check is done here instead.

   Re-reads overlap the last few days on purpose: YouTube Analytics, GA4 and Search Console all
   revise the most recent 2-3 days, and an upsert simply replaces the earlier reading. */

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-dm-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const j = (o: unknown, s = 200) => new Response(JSON.stringify(o, null, 2), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } });

const SB = Deno.env.get('SUPABASE_URL')!;
const SRV = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ANON = Deno.env.get('SUPABASE_ANON_KEY') || '';
const YT_KEY = Deno.env.get('YOUTUBE_API_KEY') || '';
// One Google Cloud key may carry both APIs; a separate Places key is used when set.
const PLACES_KEY = Deno.env.get('GOOGLE_PLACES_API_KEY') || YT_KEY;
const H = { apikey: SRV, Authorization: 'Bearer ' + SRV, 'Content-Type': 'application/json' };
const BUDGET_MS = 135_000;
// Reset at the start of every request: a warm instance serves many requests, and a start time left
// over from an earlier one would make a run think it is already out of time.
let T0 = Date.now();
const timeLeft = () => BUDGET_MS - (Date.now() - T0);
// Set by a part for its log line (e.g. quota used), and when it stopped before finishing.
let partNote = '', stoppedEarly = false;

// ---------------------------------------------------------------- database (PostgREST, schema camp)
async function dbGet(path: string, schema = 'camp') {
  const r = await fetch(`${SB}/rest/v1/${path}`, { headers: { ...H, 'Accept-Profile': schema } });
  if (!r.ok) throw new Error(`db read ${path.split('?')[0]}: ${r.status} ${(await r.text()).slice(0, 200)}`);
  return await r.json();
}
async function dbUpsert(table: string, rows: any[], onConflict: string) {
  for (let i = 0; i < rows.length; i += 500) {
    const r = await fetch(`${SB}/rest/v1/${table}?on_conflict=${onConflict}`, {
      method: 'POST',
      headers: { ...H, 'Content-Profile': 'camp', Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify(rows.slice(i, i + 500)),
    });
    if (!r.ok) throw new Error(`db write ${table}: ${r.status} ${(await r.text()).slice(0, 300)}`);
  }
  return rows.length;
}
async function dbPatch(table: string, filter: string, body: any) {
  await fetch(`${SB}/rest/v1/${table}?${filter}`, { method: 'PATCH', headers: { ...H, 'Content-Profile': 'camp' }, body: JSON.stringify(body) });
}
async function logStart(part: string, trigger: string) {
  const r = await fetch(`${SB}/rest/v1/dm_sync_log`, {
    method: 'POST', headers: { ...H, 'Content-Profile': 'camp', Prefer: 'return=representation' },
    body: JSON.stringify({ part, trigger }),
  });
  const x = await r.json();
  return x && x[0] ? x[0].id : null;
}
async function logEnd(id: number | null, ok: boolean, rows: number, message: string) {
  if (!id) return;
  await dbPatch('dm_sync_log', `id=eq.${id}`, { ok, rows, message: message.slice(0, 2000), finished_at: new Date().toISOString() });
}

// ---------------------------------------------------------------- dates
const istToday = () => new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);
const addDays = (d: string, n: number) => new Date(Date.parse(d + 'T00:00:00Z') + n * 86400_000).toISOString().slice(0, 10);
const ymd = (s: string) => s.length === 8 ? `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}` : s;
/* Where to start reading: from a few days before the newest stored day (Google revises those), or
   `firstDays` back on the first run. */
async function startFrom(table: string, filter: string, dayCol: string, overlap: number, firstDays: number, end: string) {
  const r = await dbGet(`${table}?select=${dayCol}&${filter}&order=${dayCol}.desc&limit=1`);
  if (r.length && r[0][dayCol]) return addDays(String(r[0][dayCol]).slice(0, 10), -overlap);
  return addDays(end, -firstDays);
}

// ---------------------------------------------------------------- Google helpers
async function gfetch(url: string, init: RequestInit = {}) {
  const r = await fetch(url, init);
  const t = await r.text();
  let body: any = null;
  try { body = t ? JSON.parse(t) : null; } catch (_) { body = t; }
  if (!r.ok) {
    const msg = body && body.error ? (body.error.message || JSON.stringify(body.error)) : String(t).slice(0, 300);
    const e: any = new Error(`${r.status} ${msg}`); e.status = r.status; throw e;
  }
  return body;
}
/* A live access token for one connected marketing account, refreshed when it is within a minute of
   expiring. The refresh token never leaves this function. */
const tokenCache: Record<string, string> = {};
async function accessToken(email: string) {
  if (tokenCache[email]) return tokenCache[email];
  const rows = await dbGet(`dm_google_auth?google_email=eq.${encodeURIComponent(email)}&select=*`);
  const a = rows[0];
  if (!a) throw new Error(`no marketing Google connection for ${email}`);
  if (a.access_token && a.expiry && Date.parse(a.expiry) > Date.now() + 60_000) return (tokenCache[email] = a.access_token);
  if (!a.refresh_token) throw new Error(`the Google connection for ${email} has no refresh token - connect it again`);
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: Deno.env.get('GOOGLE_CLIENT_ID')!, client_secret: Deno.env.get('GOOGLE_CLIENT_SECRET')!,
      refresh_token: a.refresh_token, grant_type: 'refresh_token' }).toString(),
  });
  const t = await r.json();
  if (!r.ok || !t.access_token) {
    // invalid_grant = revoked, or a "Testing" consent screen's 7-day expiry. Say so plainly.
    throw new Error(`Google refused to refresh ${email} (${t.error || r.status}${t.error_description ? ': ' + t.error_description : ''}) - connect it again from Digital Metrics`);
  }
  await dbPatch('dm_google_auth', `google_email=eq.${encodeURIComponent(email)}`, {
    access_token: t.access_token, expiry: new Date(Date.now() + Number(t.expires_in || 3600) * 1000).toISOString(), updated_at: new Date().toISOString() });
  return (tokenCache[email] = t.access_token);
}
const bearer = async (email: string) => ({ Authorization: 'Bearer ' + await accessToken(email) });
async function connections(): Promise<string[]> {
  return (await dbGet('dm_google_auth?select=google_email&order=updated_at.desc')).map((r: any) => r.google_email);
}
async function enabledSources(kind: string) {
  return await dbGet(`dm_sources?kind=eq.${kind}&enabled=is.true&select=*`);
}

// ---------------------------------------------------------------- discover
async function discover() {
  const out: any = { gsc_site: 0, ga4_property: 0, gbp_location: 0, yt_channel: 0, errors: [] as string[] };
  for (const email of await connections()) {
    const auth = await bearer(email);
    const rows: any[] = [];
    const add = (kind: string, source_id: string, label: string, meta: any = {}) =>
      rows.push({ kind, source_id, label, meta, google_email: email, discovered_at: new Date().toISOString() });
    try {
      const s = await gfetch('https://www.googleapis.com/webmasters/v3/sites', { headers: auth });
      for (const x of (s.siteEntry || [])) if (x.permissionLevel !== 'siteUnverifiedUser') add('gsc_site', x.siteUrl, x.siteUrl, { permission: x.permissionLevel });
    } catch (e) { out.errors.push(`Search Console (${email}): ${(e as Error).message}`); }
    try {
      let tok = '';
      do {
        const s = await gfetch('https://analyticsadmin.googleapis.com/v1beta/accountSummaries?pageSize=200' + (tok ? '&pageToken=' + tok : ''), { headers: auth });
        for (const a of (s.accountSummaries || [])) for (const p of (a.propertySummaries || []))
          add('ga4_property', p.property, p.displayName, { account: a.account, account_name: a.displayName });
        tok = s.nextPageToken || '';
      } while (tok);
    } catch (e) { out.errors.push(`Analytics (${email}): ${(e as Error).message}`); }
    try {
      const acc = await gfetch('https://mybusinessaccountmanagement.googleapis.com/v1/accounts?pageSize=20', { headers: auth });
      for (const a of (acc.accounts || [])) {
        let tok = '';
        do {
          const l = await gfetch(`https://mybusinessbusinessinformation.googleapis.com/v1/${a.name}/locations?pageSize=100&readMask=name,title,storefrontAddress,metadata` + (tok ? '&pageToken=' + tok : ''), { headers: auth });
          for (const x of (l.locations || [])) {
            const ad = x.storefrontAddress || {};
            add('gbp_location', x.name, x.title, { account: a.name, account_name: a.accountName,
              address: [...(ad.addressLines || []), ad.locality, ad.postalCode].filter(Boolean).join(', '),
              place_id: x.metadata && x.metadata.placeId, maps_uri: x.metadata && x.metadata.mapsUri });
          }
          tok = l.nextPageToken || '';
        } while (tok);
      }
    } catch (e) { out.errors.push(`Business Profile (${email}): ${(e as Error).message}`); }
    try {
      const c = await gfetch('https://www.googleapis.com/youtube/v3/channels?part=snippet,contentDetails&mine=true&maxResults=50', { headers: auth });
      for (const x of (c.items || [])) {
        add('yt_channel', x.id, x.snippet.title, { handle: x.snippet.customUrl });
        await dbUpsert('dm_yt_channels', [{ channel_id: x.id, title: x.snippet.title, handle: x.snippet.customUrl || null,
          is_own: true, confirmed: true, uploads_playlist_id: x.contentDetails?.relatedPlaylists?.uploads || null,
          updated_at: new Date().toISOString() }], 'channel_id');
      }
    } catch (e) { out.errors.push(`YouTube (${email}): ${(e as Error).message}`); }
    // enabled is left out, so a source somebody switched off stays off when it is rediscovered
    await dbUpsert('dm_sources', rows, 'kind,source_id');
    for (const r of rows) out[r.kind]++;
  }
  return out;
}

// ---------------------------------------------------------------- YouTube, public (API key)
const isoDur = (s: string) => {
  const m = /^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(s || '');
  return m ? (+(m[1] || 0)) * 86400 + (+(m[2] || 0)) * 3600 + (+(m[3] || 0)) * 60 + (+(m[4] || 0)) : null;
};
const num = (x: any) => (x === undefined || x === null || x === '' ? null : Number(x));
async function ytPublic() {
  let units = 0;
  if (!YT_KEY) throw new Error('YOUTUBE_API_KEY is not set as a Supabase secret yet');
  const chans = await dbGet('dm_yt_channels?confirmed=is.true&active=is.true&select=channel_id,uploads_playlist_id,list_cursor,list_full_at');
  const today = istToday();
  let n = 0;
  for (let i = 0; i < chans.length; i += 50) {
    const ids = chans.slice(i, i + 50).map((c: any) => c.channel_id).join(',');
    const r = await gfetch(`https://www.googleapis.com/youtube/v3/channels?part=snippet,statistics,contentDetails&id=${ids}&key=${YT_KEY}`);
    const snaps: any[] = [];
    for (const x of (r.items || [])) {
      const st = x.statistics || {};
      snaps.push({ channel_id: x.id, snap_date: today, subscribers: st.hiddenSubscriberCount ? null : num(st.subscriberCount),
        hidden_subscribers: !!st.hiddenSubscriberCount, views: num(st.viewCount), videos: num(st.videoCount), fetched_at: new Date().toISOString() });
      await dbPatch('dm_yt_channels', `channel_id=eq.${x.id}`, { title: x.snippet.title, handle: x.snippet.customUrl || null,
        uploads_playlist_id: x.contentDetails?.relatedPlaylists?.uploads || null, updated_at: new Date().toISOString() });
      const c = chans.find((c: any) => c.channel_id === x.id); if (c) c.uploads_playlist_id = x.contentDetails?.relatedPlaylists?.uploads;
    }
    n += await dbUpsert('dm_yt_channel_daily', snaps, 'channel_id,snap_date');
  }
  units += Math.ceil(chans.length / 50);
  /* EVERY VIDEO. A channel not yet read to the end (or stopped mid-way - list_cursor) has its whole
     uploads playlist read, 50 a page, each page's videos looked up at once (title, length, counts).
     The page token is saved after every page, so a run that runs short of time carries on next run.
     A channel already read to the end has only its newest page read, which is where new uploads are. */
  const seenToday = new Set<string>();
  for (const c of chans) {
    if (!c.uploads_playlist_id) continue;
    const whole = !c.list_full_at || !!c.list_cursor;
    let token: string | null = whole ? (c.list_cursor || null) : null;
    do {
      if (timeLeft() < 30_000) { stoppedEarly = true; break; }
      let pl: any;
      try { pl = await gfetch(`https://www.googleapis.com/youtube/v3/playlistItems?part=contentDetails&maxResults=50&playlistId=${c.uploads_playlist_id}${token ? '&pageToken=' + token : ''}&key=${YT_KEY}`); }
      catch (e) { if ((e as any).status === 404) break; throw e; }   // a channel with no uploads has no playlist
      units++;
      const vids = (pl.items || []).map((x: any) => x.contentDetails.videoId);
      if (vids.length) {
        const v = await gfetch(`https://www.googleapis.com/youtube/v3/videos?part=snippet,contentDetails,statistics&id=${vids.join(',')}&key=${YT_KEY}`);
        units++;
        const meta: any[] = [], daily: any[] = [];
        for (const x of (v.items || [])) {
          meta.push({ video_id: x.id, channel_id: c.channel_id, title: x.snippet.title, published_at: x.snippet.publishedAt,
            duration_sec: isoDur(x.contentDetails.duration), thumbnail: x.snippet.thumbnails?.medium?.url || null, last_seen: new Date().toISOString() });
          const st = x.statistics || {};
          daily.push({ video_id: x.id, snap_date: today, views: num(st.viewCount), likes: num(st.likeCount), comments: num(st.commentCount), fetched_at: new Date().toISOString() });
          seenToday.add(x.id);
        }
        await dbUpsert('dm_yt_videos', meta, 'video_id');
        n += await dbUpsert('dm_yt_video_daily', daily, 'video_id,snap_date');
      }
      token = pl.nextPageToken || null;
      if (whole) await dbPatch('dm_yt_channels', `channel_id=eq.${c.channel_id}`,
        token ? { list_cursor: token } : { list_cursor: null, list_full_at: new Date().toISOString() });
    } while (whole && token);
  }
  /* TODAY'S COUNTS FOR EVERY STORED VIDEO not already read above: videos.list, statistics only, 50
     ids a call (1 quota unit each - ~3,600 videos is ~72 units). A video YouTube no longer returns
     (deleted or made private) simply gets no reading. */
  const ids: string[] = [];
  for (const c of chans) {
    for (let off = 0; ; off += 1000) {
      const r = await dbGet(`dm_yt_videos?channel_id=eq.${c.channel_id}&select=video_id&order=video_id&limit=1000&offset=${off}`);
      r.forEach((x: any) => { if (!seenToday.has(x.video_id)) ids.push(x.video_id); });
      if (r.length < 1000) break;
    }
  }
  const have = new Set<string>();
  for (let off = 0; ; off += 1000) {
    const r = await dbGet(`dm_yt_video_daily?snap_date=eq.${today}&select=video_id&order=video_id&limit=1000&offset=${off}`);
    r.forEach((x: any) => have.add(x.video_id));
    if (r.length < 1000) break;
  }
  const todo = ids.filter((id) => !have.has(id));
  for (let i = 0; i < todo.length; i += 50) {
    if (timeLeft() < 20_000) { stoppedEarly = true; break; }
    const v = await gfetch(`https://www.googleapis.com/youtube/v3/videos?part=statistics&id=${todo.slice(i, i + 50).join(',')}&key=${YT_KEY}`);
    units++;
    const daily = (v.items || []).map((x: any) => {
      const st = x.statistics || {};
      return { video_id: x.id, snap_date: today, views: num(st.viewCount), likes: num(st.likeCount), comments: num(st.commentCount), fetched_at: new Date().toISOString() };
    });
    n += await dbUpsert('dm_yt_video_daily', daily, 'video_id,snap_date');
  }
  partNote = units + ' YouTube API quota units used (daily limit 10,000)';
  return n;
}

// ---------------------------------------------------------------- YouTube, our channel (Analytics API)
const YT_METRICS = ['views', 'estimatedMinutesWatched', 'averageViewDuration', 'averageViewPercentage', 'subscribersGained',
  'subscribersLost', 'likes', 'comments', 'shares', 'videosAddedToPlaylists'];
const YT_COLS: Record<string, string> = { views: 'views', estimatedMinutesWatched: 'estimated_minutes_watched',
  averageViewDuration: 'average_view_duration', averageViewPercentage: 'average_view_percentage', subscribersGained: 'subscribers_gained',
  subscribersLost: 'subscribers_lost', likes: 'likes', comments: 'comments', shares: 'shares', videosAddedToPlaylists: 'videos_added_to_playlists' };
async function ytReport(auth: any, q: Record<string, string>) {
  return await gfetch('https://youtubeanalytics.googleapis.com/v2/reports?' + new URLSearchParams(q).toString(), { headers: auth });
}
const rowsOf = (r: any) => {
  const h = (r.columnHeaders || []).map((c: any) => c.name);
  return (r.rows || []).map((row: any[]) => Object.fromEntries(h.map((k: string, i: number) => [k, row[i]])));
};
async function ytOwn() {
  const srcs = await enabledSources('yt_channel');
  if (!srcs.length) throw new Error('no YouTube channel found on the marketing connection - connect Google, then Discover');
  const end = istToday();
  let n = 0;
  for (const s of srcs) {
    const auth = await bearer(s.google_email);
    const ch = s.source_id, ids = 'channel==' + ch;
    const start = await startFrom('dm_yt_own_daily', `channel_id=eq.${ch}&video_id=eq.`, 'day', 4, 365, end);
    // whole channel, by day
    const daily = rowsOf(await ytReport(auth, { ids, startDate: start, endDate: end, dimensions: 'day', metrics: YT_METRICS.join(','), sort: 'day' }));
    const put = (row: any, video_id: string) => {
      const o: any = { channel_id: ch, video_id, day: row.day, fetched_at: new Date().toISOString() };
      for (const m of YT_METRICS) if (m in row) o[YT_COLS[m]] = row[m];
      return o;
    };
    n += await dbUpsert('dm_yt_own_daily', daily.map((r: any) => put(r, '')), 'channel_id,video_id,day');
    // by video, by day - for the videos watched in this window (top 50 by views)
    const vstart = addDays(end, -30) > start ? addDays(end, -30) : start;
    const top = rowsOf(await ytReport(auth, { ids, startDate: vstart, endDate: end, dimensions: 'video', metrics: 'views', sort: '-views', maxResults: '50' }));
    for (const t of top) {
      if (timeLeft() < 40_000) break;
      const vr = rowsOf(await ytReport(auth, { ids, startDate: vstart, endDate: end, dimensions: 'day', filters: 'video==' + t.video,
        metrics: YT_METRICS.join(','), sort: 'day' }));
      n += await dbUpsert('dm_yt_own_daily', vr.map((r: any) => put(r, t.video)), 'channel_id,video_id,day');
    }
    // breakdowns: by day where the API allows it, otherwise totals for the window
    const bstart = addDays(end, -30) > start ? addDays(end, -30) : start;
    const span = Math.round((Date.parse(end) - Date.parse(bstart)) / 86400_000) + 1;
    for (const dim of ['insightTrafficSourceType', 'country', 'deviceType', 'subscribedStatus']) {
      if (timeLeft() < 20_000) break;
      const metrics = 'views,estimatedMinutesWatched';
      let rows: any[] = [], byDay = true;
      try { rows = rowsOf(await ytReport(auth, { ids, startDate: bstart, endDate: end, dimensions: 'day,' + dim, metrics, sort: 'day' })); }
      catch (e) { if ((e as any).status !== 400) throw e; byDay = false;
        rows = rowsOf(await ytReport(auth, { ids, startDate: bstart, endDate: end, dimensions: dim, metrics })); }
      n += await dbUpsert('dm_yt_own_breakdown', rows.map((r: any) => ({ channel_id: ch, day: byDay ? r.day : end, period_days: byDay ? 1 : span,
        dimension: dim, dim_value: String(r[dim] ?? ''), metrics: { views: r.views, estimatedMinutesWatched: r.estimatedMinutesWatched },
        fetched_at: new Date().toISOString() })), 'channel_id,dimension,day,period_days,dim_value');
    }
    if (timeLeft() > 15_000) {
      const demo = rowsOf(await ytReport(auth, { ids, startDate: addDays(end, -27), endDate: end, dimensions: 'ageGroup,gender', metrics: 'viewerPercentage' }));
      n += await dbUpsert('dm_yt_own_breakdown', demo.map((r: any) => ({ channel_id: ch, day: end, period_days: 28, dimension: 'ageGroup,gender',
        dim_value: r.ageGroup + '|' + r.gender, metrics: { viewerPercentage: r.viewerPercentage }, fetched_at: new Date().toISOString() })),
        'channel_id,dimension,day,period_days,dim_value');
    }
  }
  return n;
}

// ---------------------------------------------------------------- Places (public)
async function places() {
  if (!PLACES_KEY) throw new Error('GOOGLE_PLACES_API_KEY is not set as a Supabase secret yet');
  const list = await dbGet('dm_places?confirmed=is.true&active=is.true&select=place_id');
  const today = istToday();
  let n = 0;
  for (const p of list) {
    if (timeLeft() < 10_000) break;
    const x = await gfetch(`https://places.googleapis.com/v1/places/${encodeURIComponent(p.place_id)}`, { headers: {
      'X-Goog-Api-Key': PLACES_KEY, 'X-Goog-FieldMask': 'id,displayName,formattedAddress,rating,userRatingCount,reviews,googleMapsUri' } });
    n += await dbUpsert('dm_place_daily', [{ place_id: p.place_id, snap_date: today, name: x.displayName?.text || null,
      rating: x.rating ?? null, user_ratings_total: x.userRatingCount ?? null, fetched_at: new Date().toISOString() }], 'place_id,snap_date');
    await dbPatch('dm_places', `place_id=eq.${encodeURIComponent(p.place_id)}`, { address: x.formattedAddress || null, maps_uri: x.googleMapsUri || null, updated_at: new Date().toISOString() });
    const revs = (x.reviews || []).map((r: any) => ({ place_id: p.place_id, review_name: r.name, author: r.authorAttribution?.displayName || null,
      rating: r.rating ?? null, text: r.originalText?.text || r.text?.text || null, publish_time: r.publishTime || null }));
    // existing reviews keep their first_seen: ignore-duplicates, not merge
    if (revs.length) await fetch(`${SB}/rest/v1/dm_place_reviews?on_conflict=place_id,review_name`, { method: 'POST',
      headers: { ...H, 'Content-Profile': 'camp', Prefer: 'resolution=ignore-duplicates,return=minimal' }, body: JSON.stringify(revs) });
  }
  return n;
}

// ---------------------------------------------------------------- Business Profile (our listings)
const GBP_METRICS = ['BUSINESS_IMPRESSIONS_DESKTOP_MAPS', 'BUSINESS_IMPRESSIONS_DESKTOP_SEARCH', 'BUSINESS_IMPRESSIONS_MOBILE_MAPS',
  'BUSINESS_IMPRESSIONS_MOBILE_SEARCH', 'CALL_CLICKS', 'BUSINESS_DIRECTION_REQUESTS', 'WEBSITE_CLICKS', 'BUSINESS_CONVERSATIONS', 'BUSINESS_BOOKINGS'];
const STARS: Record<string, number> = { ONE: 1, TWO: 2, THREE: 3, FOUR: 4, FIVE: 5 };
async function gbp() {
  const srcs = await enabledSources('gbp_location');
  if (!srcs.length) throw new Error('no Business Profile listing found on the marketing connection (or API access not yet granted by Google)');
  const end = istToday();
  let n = 0;
  for (const s of srcs) {
    if (timeLeft() < 20_000) break;
    const auth = await bearer(s.google_email);
    const loc = s.source_id;
    const start = await startFrom('dm_gbp_daily', `location=eq.${encodeURIComponent(loc)}`, 'day', 5, 540, end);
    const [sy, sm, sd] = start.split('-').map(Number), [ey, em, ed] = end.split('-').map(Number);
    const q = new URLSearchParams();
    for (const m of GBP_METRICS) q.append('dailyMetrics', m);
    q.set('dailyRange.start_date.year', String(sy)); q.set('dailyRange.start_date.month', String(sm)); q.set('dailyRange.start_date.day', String(sd));
    q.set('dailyRange.end_date.year', String(ey)); q.set('dailyRange.end_date.month', String(em)); q.set('dailyRange.end_date.day', String(ed));
    const r = await gfetch(`https://businessprofileperformance.googleapis.com/v1/${loc}:fetchMultiDailyMetricsTimeSeries?${q}`, { headers: auth });
    const rows: any[] = [];
    for (const m of (r.multiDailyMetricTimeSeries || [])) for (const t of (m.dailyMetricTimeSeries || [])) {
      for (const dv of (t.timeSeries?.datedValues || [])) {
        const d = dv.date; if (!d) continue;
        // a day with no value field is a day Google reports nothing for - stored as 0 only if Google says 0
        rows.push({ location: loc, metric: t.dailyMetric, day: `${d.year}-${String(d.month).padStart(2, '0')}-${String(d.day).padStart(2, '0')}`,
          value: dv.value === undefined ? null : Number(dv.value), fetched_at: new Date().toISOString() });
      }
    }
    n += await dbUpsert('dm_gbp_daily', rows, 'location,day,metric');
    // search keywords, one call per month (a multi-month range comes back as one combined total)
    for (let k = 0; k < 3 && timeLeft() > 20_000; k++) {
      const md = new Date(Date.UTC(ey, em - 1 - k, 1));
      const yy = md.getUTCFullYear(), mm = md.getUTCMonth() + 1;
      const kw: any[] = [];
      let tok = '';
      do {
        const kq = new URLSearchParams({ 'monthlyRange.start_month.year': String(yy), 'monthlyRange.start_month.month': String(mm),
          'monthlyRange.end_month.year': String(yy), 'monthlyRange.end_month.month': String(mm), pageSize: '100' });
        if (tok) kq.set('pageToken', tok);
        const kr = await gfetch(`https://businessprofileperformance.googleapis.com/v1/${loc}/searchkeywords/impressions/monthly?${kq}`, { headers: auth });
        for (const x of (kr.searchKeywordsCounts || [])) kw.push({ location: loc, month: `${yy}-${String(mm).padStart(2, '0')}-01`, keyword: x.searchKeyword,
          value: x.insightsValue?.value !== undefined ? Number(x.insightsValue.value) : null,
          threshold: x.insightsValue?.threshold !== undefined ? Number(x.insightsValue.threshold) : null, fetched_at: new Date().toISOString() });
        tok = kr.nextPageToken || '';
      } while (tok && timeLeft() > 15_000);
      n += await dbUpsert('dm_gbp_keywords_monthly', kw, 'location,month,keyword');
    }
    // reviews (v4 is still Google's only reviews API); newest first, stop at ones already stored and unchanged
    if (s.meta?.account) {
      let tok = '', pages = 0;
      do {
        const rr = await gfetch(`https://mybusiness.googleapis.com/v4/${s.meta.account}/${loc}/reviews?pageSize=50&orderBy=updateTime desc` + (tok ? '&pageToken=' + tok : ''), { headers: auth });
        const revs = (rr.reviews || []).map((x: any) => ({ review_id: x.reviewId, location: loc, reviewer: x.reviewer?.displayName || null,
          star_rating: STARS[x.starRating] ?? null, comment: x.comment || null, create_time: x.createTime || null, update_time: x.updateTime || null,
          reply_comment: x.reviewReply?.comment || null, reply_time: x.reviewReply?.updateTime || null, fetched_at: new Date().toISOString() }));
        n += await dbUpsert('dm_gbp_reviews', revs, 'review_id');
        tok = rr.nextPageToken || ''; pages++;
      } while (tok && pages < 20 && timeLeft() > 15_000);
    }
  }
  return n;
}

// ---------------------------------------------------------------- Search Console
async function gsc() {
  const srcs = await enabledSources('gsc_site');
  if (!srcs.length) throw new Error('no Search Console site found on the marketing connection');
  const end = istToday();
  let n = 0;
  for (const s of srcs) {
    const auth = { ...(await bearer(s.google_email)), 'Content-Type': 'application/json' };
    const site = s.source_id;
    for (const dim of ['date', 'device', 'country', 'page', 'query']) {
      if (timeLeft() < 25_000) break;
      const start = await startFrom('dm_gsc_rows', `site_url=eq.${encodeURIComponent(site)}&dim=eq.${dim}`, 'day', 4, dim === 'query' || dim === 'page' ? 60 : 480, end);
      let startRow = 0;
      for (;;) {
        const body = { startDate: start, endDate: end, dimensions: dim === 'date' ? ['date'] : ['date', dim], rowLimit: 25000, startRow, dataState: 'all', type: 'web' };
        const r = await gfetch(`https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(site)}/searchAnalytics/query`, { method: 'POST', headers: auth, body: JSON.stringify(body) });
        const rows = (r.rows || []).map((x: any) => ({ site_url: site, day: x.keys[0], dim, key: dim === 'date' ? '' : String(x.keys[1]),
          clicks: x.clicks, impressions: x.impressions, ctr: x.ctr, position: x.position, fetched_at: new Date().toISOString() }));
        n += await dbUpsert('dm_gsc_rows', rows, 'site_url,day,dim,key');
        if (rows.length < 25000 || timeLeft() < 25_000) break;
        startRow += 25000;
      }
    }
  }
  return n;
}

// ---------------------------------------------------------------- GA4
const GA_REPORTS: { report: string; dims: string[]; metrics: string[] }[] = [
  { report: 'overview', dims: [], metrics: ['totalUsers', 'newUsers', 'activeUsers', 'sessions', 'engagedSessions', 'engagementRate', 'averageSessionDuration', 'screenPageViews', 'keyEvents', 'eventCount'] },
  { report: 'source', dims: ['sessionSource', 'sessionMedium', 'sessionCampaignName'], metrics: ['sessions', 'totalUsers', 'engagedSessions', 'keyEvents'] },
  { report: 'landing', dims: ['landingPage'], metrics: ['sessions', 'totalUsers', 'engagedSessions', 'keyEvents'] },
  { report: 'city', dims: ['city'], metrics: ['totalUsers', 'sessions', 'keyEvents'] },
  { report: 'device', dims: ['deviceCategory'], metrics: ['totalUsers', 'sessions', 'engagedSessions', 'keyEvents'] },
  { report: 'event', dims: ['eventName'], metrics: ['eventCount', 'keyEvents', 'totalUsers'] },
];
async function gaRun(auth: any, prop: string, body: any) {
  const rows: any[] = [];
  let offset = 0;
  for (;;) {
    const r = await gfetch(`https://analyticsdata.googleapis.com/v1beta/${prop}:runReport`, { method: 'POST', headers: auth,
      body: JSON.stringify({ ...body, limit: 100000, offset }) });
    const dh = (r.dimensionHeaders || []).map((h: any) => h.name), mh = (r.metricHeaders || []).map((h: any) => h.name);
    for (const x of (r.rows || [])) rows.push({ d: Object.fromEntries(dh.map((k: string, i: number) => [k, x.dimensionValues[i].value])),
      m: Object.fromEntries(mh.map((k: string, i: number) => [k, Number(x.metricValues[i].value)])) });
    offset += (r.rows || []).length;
    if (!r.rows || offset >= Number(r.rowCount || 0) || timeLeft() < 15_000) break;
  }
  return rows;
}
async function ga4() {
  const srcs = await enabledSources('ga4_property');
  if (!srcs.length) throw new Error('no GA4 property found on the marketing connection');
  const end = istToday();
  let n = 0;
  for (const s of srcs) {
    const auth = { ...(await bearer(s.google_email)), 'Content-Type': 'application/json' };
    const prop = s.source_id;
    for (const rep of GA_REPORTS) {
      if (timeLeft() < 25_000) break;
      const start = await startFrom('dm_ga4_rows', `property_id=eq.${encodeURIComponent(prop)}&report=eq.${rep.report}`, 'day', 3, 180, end);
      const rows = await gaRun(auth, prop, { dateRanges: [{ startDate: start, endDate: end }],
        dimensions: [{ name: 'date' }, ...rep.dims.map((name) => ({ name }))], metrics: rep.metrics.map((name) => ({ name })), keepEmptyRows: false });
      n += await dbUpsert('dm_ga4_rows', rows.map((x) => {
        const dims = { ...x.d }; delete dims.date;
        return { property_id: prop, day: ymd(x.d.date), report: rep.report, key: rep.dims.map((k) => dims[k]).join(' | '), dims, metrics: x.m, fetched_at: new Date().toISOString() };
      }), 'property_id,day,report,key');
    }
    // Users are not additive across days - somebody who came on two days is one user in the month but
    // two in the daily rows. So the period totals are asked of Google directly, never summed here.
    const yday = addDays(end, -1);
    for (const p of [7, 28, 90]) {
      if (timeLeft() < 15_000) break;
      const rows = await gaRun(auth, prop, { dateRanges: [{ startDate: addDays(yday, -(p - 1)), endDate: yday }], metrics: GA_REPORTS[0].metrics.map((name) => ({ name })) });
      if (rows[0]) n += await dbUpsert('dm_ga4_rows', [{ property_id: prop, day: yday, report: 'period', key: p + 'd', dims: { days: p }, metrics: rows[0].m, fetched_at: new Date().toISOString() }], 'property_id,day,report,key');
    }
  }
  return n;
}

// ---------------------------------------------------------------- mapping lookups
async function findChannel(q: string) {
  if (!YT_KEY) throw new Error('YOUTUBE_API_KEY is not set as a Supabase secret yet');
  q = q.trim();
  const uc = /(UC[A-Za-z0-9_-]{22})/.exec(q), handle = /@([A-Za-z0-9._-]{3,})/.exec(q);
  let url;
  if (uc) url = `https://www.googleapis.com/youtube/v3/channels?part=snippet,statistics&id=${uc[1]}&key=${YT_KEY}`;
  else if (handle) url = `https://www.googleapis.com/youtube/v3/channels?part=snippet,statistics&forHandle=${encodeURIComponent('@' + handle[1])}&key=${YT_KEY}`;
  if (url) {
    const r = await gfetch(url);
    return (r.items || []).map((x: any) => ({ channel_id: x.id, title: x.snippet.title, handle: x.snippet.customUrl, subscribers: x.statistics?.subscriberCount, videos: x.statistics?.videoCount, thumbnail: x.snippet.thumbnails?.default?.url }));
  }
  // free-text search costs 100 quota units of the 10,000 a day - fine for a person looking something up
  const s = await gfetch(`https://www.googleapis.com/youtube/v3/search?part=snippet&type=channel&maxResults=8&regionCode=IN&q=${encodeURIComponent(q)}&key=${YT_KEY}`);
  return (s.items || []).map((x: any) => ({ channel_id: x.snippet.channelId, title: x.snippet.channelTitle || x.snippet.title, description: x.snippet.description, thumbnail: x.snippet.thumbnails?.default?.url }));
}
async function findPlace(q: string) {
  if (!PLACES_KEY) throw new Error('GOOGLE_PLACES_API_KEY is not set as a Supabase secret yet');
  const r = await gfetch('https://places.googleapis.com/v1/places:searchText', { method: 'POST', headers: { 'Content-Type': 'application/json',
    'X-Goog-Api-Key': PLACES_KEY, 'X-Goog-FieldMask': 'places.id,places.displayName,places.formattedAddress,places.rating,places.userRatingCount,places.googleMapsUri' },
    body: JSON.stringify({ textQuery: q, regionCode: 'IN', locationBias: { circle: { center: { latitude: 22.5726, longitude: 88.3639 }, radius: 50000 } }, pageSize: 10 }) });
  return (r.places || []).map((x: any) => ({ place_id: x.id, name: x.displayName?.text, address: x.formattedAddress, rating: x.rating, user_ratings_total: x.userRatingCount, maps_uri: x.googleMapsUri }));
}

// ---------------------------------------------------------------- entry
const PARTS: Record<string, () => Promise<number>> = { yt_public: ytPublic, yt_own: ytOwn, places, gbp, gsc, ga4 };

async function caller(req: Request): Promise<string | null> {
  const sec = req.headers.get('x-dm-secret');
  if (sec) {
    const r = await dbGet('job_secrets?name=eq.digital_metrics&select=value', 'acc');
    return r[0] && r[0].value === sec ? 'cron' : null;
  }
  const auth = req.headers.get('Authorization') || '';
  if (!/^Bearer\s+\S+/.test(auth) || !ANON) return null;
  const who = await fetch(`${SB}/auth/v1/user`, { headers: { apikey: ANON, Authorization: auth } });
  if (!who.ok) return null;
  const email = String((await who.json()).email || '').toLowerCase();
  const can = await fetch(`${SB}/rest/v1/rpc/dm_allowed`, { method: 'POST', body: '{}',
    headers: { apikey: ANON, Authorization: auth, 'Content-Type': 'application/json', 'Content-Profile': 'camp' } });
  return can.ok && (await can.json()) === true ? 'manual:' + email : null;
}

Deno.serve(async (req) => {
  T0 = Date.now();
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  let body: any = {};
  try { body = await req.json(); } catch (_) { /* empty */ }
  const who = await caller(req);
  if (!who) return j({ error: 'not allowed' }, 401);
  try {
    if (body.action === 'find_channel') return j({ results: await findChannel(String(body.q || '')) });
    if (body.action === 'find_place') return j({ results: await findPlace(String(body.q || '')) });
    if (body.action === 'discover') {
      const id = await logStart('discover', who);
      try { const r = await discover(); await logEnd(id, !r.errors.length, 0, JSON.stringify(r)); return j(r); }
      catch (e) { await logEnd(id, false, 0, (e as Error).message); throw e; }
    }
    if (body.action === 'sync') {
      const parts = body.part ? [String(body.part)] : Object.keys(PARTS);
      const out: any = {};
      for (const p of parts) {
        if (!PARTS[p]) { out[p] = { ok: false, error: 'unknown part' }; continue; }
        // The nightly run rediscovers (once - in the gsc call), so a new site, property or listing is
        // picked up by itself; the parts running beside it see it from the following night.
        if (who === 'cron' && p === 'gsc') { try { await discover(); } catch (_) { /* reported by the part itself */ } }
        const id = await logStart(p, who);
        partNote = ''; stoppedEarly = false;
        try { const rows = await PARTS[p](); await logEnd(id, true, rows, (partNote ? partNote + '; ' : '') + (stoppedEarly || timeLeft() < 25_000 ? 'stopped early for time - the rest continues on the next run' : 'ok')); out[p] = { ok: true, rows, note: partNote || undefined, more: stoppedEarly || undefined }; }
        catch (e) { await logEnd(id, false, 0, (e as Error).message); out[p] = { ok: false, error: (e as Error).message }; }
      }
      return j(out);
    }
    return j({ error: 'unknown action' }, 400);
  } catch (e) {
    return j({ error: (e as Error).message }, 500);
  }
});
