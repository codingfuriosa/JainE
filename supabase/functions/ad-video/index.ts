/* AD VIDEO (17 Nov 2026, Ayush: "In Campaign Analytics the video thumbnail is showing, I want the video to play").
   A Facebook ad's video, asked for when someone opens or plays the ad on Campaign Analytics. In order:
     1. the video file itself (`source`, a playable MP4 link Meta signs for a few hours) - read with the ads key, else the
        Pages key (ad videos belong to the Facebook Page, which the ads key often cannot open);
     2. else Meta's own ad preview: an embeddable frame (facebook.com) that shows and plays the ad as it looks in the feed.
   Nothing is stored. Google video ads are YouTube videos and need no call here.
   WHO MAY CALL: a signed-in JainE staff member (the same check as ads-daily-sync's manual calls).
   Deployed 17 Nov 2026 through the Supabase connection (the CLI was blocked by Windows Application Control that day). */
const SB = Deno.env.get('SUPABASE_URL')!, ANON = Deno.env.get('SUPABASE_ANON_KEY') || '';
const ADS = Deno.env.get('META_SYSTEM_USER_TOKEN') || Deno.env.get('META_ACCESS_TOKEN') || '';
const PAGES = Deno.env.get('META_PAGES_TOKEN') || '';
const FBV = 'v21.0';
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
const j = (o: unknown, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } });
async function allowed(req: Request) {
  const auth = req.headers.get('Authorization') || '';
  if (!/^Bearer\s+\S+/.test(auth) || !ANON) return false;
  const can = await fetch(`${SB}/rest/v1/rpc/pi_allowed`, { method: 'POST', body: '{}', headers: { apikey: ANON, Authorization: auth, 'Content-Type': 'application/json', 'Content-Profile': 'camp' } });
  return can.ok && (await can.json()) === true;
}
async function g(path: string, tok: string) {
  const r = await fetch(`https://graph.facebook.com/${FBV}/${path}${path.includes('?') ? '&' : '?'}access_token=${tok}`);
  const t = await r.json().catch(() => ({}));
  if (!r.ok || t.error) throw new Error('Meta: ' + ((t.error && t.error.message) || r.status));
  return t;
}
// a Page key that can open this page's videos: the Pages key itself, or (if it is a user key) the page's own key from /me/accounts
let pageKeys: Record<string, string> | null = null;
async function keysForPages() {
  if (pageKeys) return pageKeys;
  pageKeys = {};
  if (!PAGES) return pageKeys;
  try { const t = await g('me/accounts?fields=id,access_token&limit=100', PAGES); for (const p of t.data || []) if (p.access_token) pageKeys[p.id] = p.access_token; } catch (_) { /* a page key, not a user key */ }
  return pageKeys;
}
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (!(await allowed(req))) return j({ error: 'not allowed' }, 401);
  let body: any = {}; try { body = await req.json(); } catch (_) { /* empty */ }
  const ids: string[] = (Array.isArray(body.ads) ? body.ads : [body.ad_id]).map((x: any) => String(x || '').replace(/\D/g, '')).filter(Boolean).slice(0, 30);
  if (!ids.length) return j({ error: 'ad_id?' }, 400);
  const out: Record<string, any> = {};
  await Promise.all(ids.map(async (id) => {
    try {
      const a = await g(`${id}?fields=creative{video_id,actor_id,object_story_spec{page_id,video_data{video_id}},asset_feed_spec{videos{video_id}}}`, ADS);
      const cr = a.creative || {}, os = cr.object_story_spec || {}, af = cr.asset_feed_spec || {};
      const vid = cr.video_id || (os.video_data && os.video_data.video_id) || (Array.isArray(af.videos) && af.videos[0] && af.videos[0].video_id);
      if (!vid) { out[id] = { video: false }; return; }
      const page = String(os.page_id || cr.actor_id || '');
      const keys = [ADS, PAGES, (await keysForPages())[page]].filter(Boolean) as string[];
      for (const k of keys) {
        try { const v = await g(`${vid}?fields=source,picture,length`, k); if (v.source) { out[id] = { video: true, src: v.source, poster: v.picture || null }; return; } } catch (_) { /* next key */ }
      }
      // the ad as Meta previews it - a frame that plays the video
      try {
        const p = await g(`${id}/previews?ad_format=MOBILE_FEED_STANDARD`, ADS);
        const html = String(((p.data || [])[0] || {}).body || '');
        const m = html.match(/src="([^"]+)"/);
        if (m) { out[id] = { video: true, iframe: m[1].replace(/&amp;/g, '&') }; return; }
      } catch (_) { /* nothing more to try */ }
      out[id] = { video: true, error: 'Meta would not give this video' };
    } catch (e) { out[id] = { error: String((e as Error).message || e).slice(0, 200) }; }
  }));
  return j({ ok: true, ads: out });
});
