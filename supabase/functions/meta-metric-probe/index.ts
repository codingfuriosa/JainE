// READ-ONLY Facebook organic probe (6 Nov 2026). Reuses the retired meta-metric-probe slot - the
// project is at its edge-function limit. It reads the Jain Group Page through the saved
// META_PAGES_TOKEN (falling back to META_SYSTEM_TOKEN / META_ACCESS_TOKEN), finds which insight
// metric names Meta still accepts - each probed ON ITS OWN, because one bad name fails a whole
// insights request - and returns the latest posts and reels with every accepted number.
// It writes nothing anywhere. Only callers holding acc.job_secrets 'meta_probe' (sent as
// x-probe-secret) get an answer, so it is not open to the internet like the retired probe was.
const G = "https://graph.facebook.com/v25.0";
const SB = Deno.env.get("SUPABASE_URL")!;
const SRV = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const json = (o: unknown, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { "Content-Type": "application/json" } });

async function gget(url: string) {
  const r = await fetch(url);
  const b = await r.json().catch(() => ({}));
  if (b?.error) return { err: String(b.error.message || "graph error"), code: b.error.code };
  return b;
}
const ins = (b: any) => { const m: any = {}; (b?.data || []).forEach((x: any) => { m[x.name] = x.values?.[0]?.value ?? x.total_value?.value; }); return m; };

// Candidate names, newest replacements first. Anything Meta rejects is reported, not used.
const POST_CANDIDATES = ["post_total_media_view_unique", "post_media_view", "post_impressions_unique", "post_impressions",
  "post_clicks", "post_clicks_by_type", "post_reactions_by_type_total", "post_activity_by_action_type",
  "post_video_views", "post_video_views_unique", "post_video_avg_time_watched", "post_video_view_time", "post_video_followers"];
const REEL_CANDIDATES = ["fb_reels_total_plays", "fb_reels_replay_count", "blue_reels_play_count", "post_total_media_view_unique",
  "post_impressions_unique", "post_video_view_time", "post_video_avg_time_watched", "post_video_followers",
  "post_video_likes_by_reaction_type", "post_video_social_actions"];
const PAGE_CANDIDATES = ["page_total_media_view_unique", "page_media_view", "page_impressions_unique", "page_follows",
  "page_daily_follows_unique", "page_daily_unfollows_unique", "page_post_engagements", "page_views_total", "page_video_views"];

async function probe(objId: string, names: string[], tok: string, edge = "insights", extra = "") {
  const ok: string[] = [], bad: Record<string, string> = {};
  await Promise.all(names.map(async (m) => {
    const b: any = await gget(G + "/" + objId + "/" + edge + "?metric=" + m + extra + "&access_token=" + tok);
    if (b.err) bad[m] = b.err.slice(0, 90); else ok.push(m);
  }));
  return { ok: names.filter((n) => ok.includes(n)), bad };
}

Deno.serve(async (req) => {
  const secret = req.headers.get("x-probe-secret") || "";
  const r = await fetch(SB + "/rest/v1/job_secrets?name=eq.meta_probe&select=value",
    { headers: { apikey: SRV, Authorization: "Bearer " + SRV, "Accept-Profile": "acc" } });
  const rows = await r.json().catch(() => []);
  if (!secret || !Array.isArray(rows) || rows[0]?.value !== secret) return json({ error: "unauthorized" }, 401);

  const body: any = await req.json().catch(() => ({}));
  const limit = Math.min(Number(body.limit) || 25, 100);
  const T = Deno.env.get("META_PAGES_TOKEN") || Deno.env.get("META_SYSTEM_TOKEN") || Deno.env.get("META_ACCESS_TOKEN");
  if (!T) return json({ error: "no Meta token secret" }, 500);

  const pg: any = await gget(G + "/me/accounts?fields=id,name,access_token,followers_count,fan_count,instagram_business_account{id,username,followers_count}&limit=50&access_token=" + encodeURIComponent(T));
  if (pg.err) return json({ error: "Cannot list Pages: " + pg.err, code: pg.code });
  const out: any = { pages: [] };
  for (const P of pg.data || []) {
    const pt = encodeURIComponent(P.access_token || "");
    const page: any = { id: P.id, name: P.name, followers: P.followers_count, fans: P.fan_count,
      instagram: P.instagram_business_account || null, has_page_token: !!P.access_token };
    if (!P.access_token) { out.pages.push(page); continue; }

    // Page-level daily numbers, last 28 days
    const pp = await probe(P.id, PAGE_CANDIDATES, pt, "insights", "&period=day&date_preset=last_28d");
    page.page_metrics_ok = pp.ok; page.page_metrics_rejected = pp.bad;
    if (pp.ok.length) {
      const b: any = await gget(G + "/" + P.id + "/insights?metric=" + pp.ok.join(",") + "&period=day&date_preset=last_28d&access_token=" + pt);
      page.page_last_28d = (b.data || []).map((x: any) => ({ metric: x.name,
        total: (x.values || []).reduce((a: number, v: any) => a + (typeof v.value === "number" ? v.value : 0), 0),
        days: (x.values || []).length }));
    }

    // Posts: probe each name on the newest post, then pull the latest posts with the good ones
    const one: any = await gget(G + "/" + P.id + "/published_posts?limit=1&fields=id&access_token=" + pt);
    const pid = one?.data?.[0]?.id;
    if (pid) {
      const pm = await probe(pid, POST_CANDIDATES, pt);
      page.post_metrics_ok = pm.ok; page.post_metrics_rejected = pm.bad;
      const b: any = await gget(G + "/" + P.id + "/published_posts?limit=" + limit
        + "&fields=id,message,created_time,permalink_url,status_type,attachments{media_type,type,target},shares,"
        + "comments.summary(true).limit(0),reactions.summary(true).limit(0)"
        + (pm.ok.length ? ",insights.metric(" + pm.ok.join(",") + ")" : "") + "&access_token=" + pt);
      if (b.err) page.posts_error = b.err;
      page.posts = (b.data || []).map((p: any) => ({ id: p.id, date: p.created_time, type: p.attachments?.data?.[0]?.type || p.status_type,
        text: String(p.message || "").replace(/\s+/g, " ").slice(0, 70), link: p.permalink_url,
        reactions: p.reactions?.summary?.total_count ?? 0, comments: p.comments?.summary?.total_count ?? 0, shares: p.shares?.count ?? 0,
        reel_target: p.attachments?.data?.[0]?.target?.id || null, insights: ins(p.insights) }));
    }

    // Reels: same, on the video_insights edge
    const rl: any = await gget(G + "/" + P.id + "/video_reels?limit=" + Math.min(limit, 50)
      + "&fields=id,description,created_time,permalink_url,length,views,likes.summary(true).limit(0),comments.summary(true).limit(0)&access_token=" + pt);
    if (rl.err) page.reels_error = rl.err;
    const reels = rl.data || [];
    if (reels.length) {
      const rm = await probe(reels[0].id, REEL_CANDIDATES, pt, "video_insights");
      page.reel_metrics_ok = rm.ok; page.reel_metrics_rejected = rm.bad;
      page.reels = [];
      for (let i = 0; i < reels.length; i += 6) {
        page.reels.push(...await Promise.all(reels.slice(i, i + 6).map(async (x: any) => {
          const vi: any = rm.ok.length ? await gget(G + "/" + x.id + "/video_insights?metric=" + rm.ok.join(",") + "&access_token=" + pt) : {};
          return { id: x.id, date: x.created_time, text: String(x.description || "").replace(/\s+/g, " ").slice(0, 70),
            link: x.permalink_url, length_s: x.length, likes: x.likes?.summary?.total_count ?? 0,
            comments: x.comments?.summary?.total_count ?? 0, insights: vi.err ? { error: vi.err } : ins(vi) };
        })));
      }
    }
    out.pages.push(page);
  }
  return json(out);
});
