// POSTS & REELS - organic Facebook (and, once linked, Instagram) into camp.social_* (rebuilt 6 Nov 2026).
// ORGANIC ONLY. Paid ads are ads-daily-sync / Campaign Analytics.
//
// WHO CALLS IT
//   - the 06:00 IST cron 'social-organic-daily' with x-sync-secret = acc.job_secrets 'social_organic'
//   - the Refresh now button on the Posts & Reels page, with the signed-in person's JWT (staff only)
//   body.mode: 'daily' (default - newest 100 posts, 50 reels, last 10 days of Page totals) or
//   'backfill' (up to 2,000 posts, Page totals back two years, reels 150 a run - pass back
//   body.reels_after = the reels_next it returns until it comes back empty).
//
// THE KEY. The saved system-user token (META_PAGES_TOKEN, else META_SYSTEM_TOKEN / META_ACCESS_TOKEN).
// Page tokens come from /me/accounts on every run.
//
// WHAT META GIVES - probed name by name on the live Jain Group Page on 6 Nov 2026 (meta-metric-probe):
//   PAGE (daily): page_total_media_view_unique (Viewers = the Page's reach), page_media_view (Views),
//     page_follows (follower total), page_daily_follows_unique / page_daily_unfollows_unique,
//     page_post_engagements, page_views_total (Page visits), page_video_views.
//   POSTS: post_media_view (Views), post_clicks (+ _by_type), post_reactions_by_type_total,
//     post_activity_by_action_type, post_video_views (+ _unique), post_video_avg_time_watched,
//     post_video_view_time, post_video_followers. post_impressions is REJECTED.
//   REELS (video_insights edge): fb_reels_total_plays, fb_reels_replay_count, post_video_view_time,
//     post_video_avg_time_watched, post_video_followers, post_video_likes_by_reaction_type,
//     post_video_social_actions (SHARE / COMMENT counts - the first time reel shares were available).
//   PER-POST REACH DOES NOT EXIST. post_total_media_view_unique and post_impressions_unique are
//     ACCEPTED but come back 0 / empty for every post and reel - so they are not stored as reach, which
//     would show a confident 0. Reach is only real at Page level (Viewers, per day).
//
// RULES CARRIED OVER FROM THE FIRST VERSION (Aug-Oct 2026)
//   - Graph fails a WHOLE insights request if ONE metric name is invalid. If Meta starts rejecting a
//     post metric (it did in Sep 2026 and silently stopped every post sync), the names are probed one
//     by one, the rejected ones dropped AND their columns left out of the upsert, so a stored figure is
//     never overwritten with 0. The run reports which were dropped.
//   - A reel appears twice: on video_reels (real play/watch numbers) and again on published_posts as a
//     plain video whose attachments.target.id is the reel id. Posts pointing at a known reel - fetched
//     this run OR already stored - are skipped.
//   - A reel whose insights call fails is skipped for the run, keeping its stored numbers.
//   - Reel insights have no inline form: concurrent batches of 6. Post insights are inline, one call
//     per 50 posts.
import { createClient } from "jsr:@supabase/supabase-js@2";

const G = "https://graph.facebook.com/v25.0";
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-sync-secret" };
const j = (o: unknown, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { ...cors, "Content-Type": "application/json" } });
const num = (x: unknown) => { const n = Number(x); return isFinite(n) ? Math.round(n) : 0; };

const POST_METRICS = ["post_media_view", "post_clicks", "post_clicks_by_type", "post_reactions_by_type_total",
  "post_activity_by_action_type", "post_video_views", "post_video_views_unique", "post_video_avg_time_watched",
  "post_video_view_time", "post_video_followers"];
// which social_posts column(s) each post metric fills - left out of the upsert if Meta rejects it
const POST_METRIC_COLS: Record<string, string[]> = { post_media_view: ["views"], post_clicks: ["clicks"],
  post_clicks_by_type: ["clicks_by_type"], post_reactions_by_type_total: ["reactions"], post_activity_by_action_type: [],
  post_video_views: ["video_views"], post_video_views_unique: ["viewers"], post_video_avg_time_watched: ["video_avg_watch_ms"],
  post_video_view_time: ["video_total_time_ms"], post_video_followers: ["follows"] };
const REEL_METRICS = "fb_reels_total_plays,fb_reels_replay_count,post_video_view_time,post_video_avg_time_watched,"
  + "post_video_followers,post_video_likes_by_reaction_type,post_video_social_actions";
const PAGE_METRICS: Record<string, string> = { page_total_media_view_unique: "viewers", page_media_view: "views",
  page_follows: "followers", page_daily_follows_unique: "new_follows", page_daily_unfollows_unique: "unfollows",
  page_post_engagements: "engagements", page_views_total: "page_visits", page_video_views: "video_views" };
const IG_METRICS_EXT = "reach,saved,total_interactions,views,shares";
const IG_METRICS_BASE = "reach,saved,total_interactions";

async function gget(url: string) {
  const r = await fetch(url); const b = await r.json().catch(() => ({}));
  if (b?.error) return { err: String(b.error.message || "graph error"), code: b.error.code };
  return b;
}
async function gall(url: string, maxPages: number) {
  const out: any[] = []; let next: string | null = url;
  for (let i = 0; i < maxPages && next; i++) {
    const b: any = await gget(next);
    if (b?.err) return { err: b.err, data: out, next: null };
    (b.data || []).forEach((x: any) => out.push(x));
    next = b.paging?.next || null;
  }
  return { data: out, next };
}
async function inBatches<T, R>(items: T[], size: number, fn: (x: T) => Promise<R>) {
  const out: R[] = [];
  for (let i = 0; i < items.length; i += size) out.push(...await Promise.all(items.slice(i, i + size).map(fn)));
  return out;
}
const nested = (p: any) => { const m: any = {}; (p?.insights?.data || p?.data || []).forEach((x: any) => { m[x.name] = x.values?.[0]?.value; }); return m; };
function kindOf(p: any) {
  const a = p.attachments?.data?.[0] || {}; const t = String(a.type || "").toLowerCase(), mt = String(a.media_type || "").toLowerCase();
  if (t.includes("reel") || mt === "reel") return "reel";
  if (t.includes("album") || mt === "album") return "carousel";
  if (t.includes("video") || mt === "video") return "video";
  return "post";
}
const thumbOf = (p: any) => { const a = p.attachments?.data?.[0];
  return p.full_picture || a?.media?.image?.src || a?.subattachments?.data?.[0]?.media?.image?.src || null; };
const rxObj = (rx: any) => { rx = rx || {}; return { like: num(rx.like), love: num(rx.love), wow: num(rx.wow), haha: num(rx.haha),
  sad: num(rx.sorry ?? rx.sad), angry: num(rx.anger ?? rx.angry), care: num(rx.care) }; };
const reelRx = (o: any) => { o = o || {}; const g = (k: string) => num(o["REACTION_" + k] ?? o[k.toLowerCase()]);
  return { like: g("LIKE"), love: g("LOVE"), wow: g("WOW"), haha: g("HAHA"), sad: g("SORRY"), angry: g("ANGER"), care: g("CARE") }; };
const sumObj = (o: any) => Object.values(o || {}).reduce((a: number, v) => a + (Number(v) || 0), 0);
const day = (d: Date) => d.toISOString().slice(0, 10);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return j({ error: "method not allowed" }, 405);
  const SB = Deno.env.get("SUPABASE_URL")!, ANON = Deno.env.get("SUPABASE_ANON_KEY")!, SRV = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const db = createClient(SB, SRV); const camp = db.schema("camp");
  const body: any = await req.json().catch(() => ({}));

  // ---- who is calling: the cron (shared secret) or a signed-in staff member ----
  let trigger = "button";
  const secret = req.headers.get("x-sync-secret") || "";
  if (secret) {
    const { data } = await db.schema("acc").from("job_secrets").select("value").eq("name", "social_organic").maybeSingle();
    if (!data?.value || data.value !== secret) return j({ error: "unauthorized" }, 401);
    trigger = body.trigger === "backfill" ? "backfill" : "cron";
  } else {
    const jwt = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    if (!jwt) return j({ error: "missing token" }, 401);
    const asUser = createClient(SB, ANON, { global: { headers: { Authorization: "Bearer " + jwt } } });
    const { data: u } = await asUser.auth.getUser(jwt);
    if (!u?.user) return j({ error: "unauthorized" }, 401);
    const { data: cust } = await asUser.schema("app").rpc("is_customer");
    if (cust === true) return j({ error: "forbidden" }, 403);
  }

  const backfill = body.mode === "backfill";
  const postPages = backfill ? 40 : 2, reelCap = backfill ? 150 : 50;
  const rep: any = { mode: backfill ? "backfill" : "daily", pages: 0, posts: 0, reels: 0, ig: 0, page_days: 0,
    skipped_reel_copies: 0, reels_kept_from_before: 0, reels_next: null, errors: [] as string[] };
  const setState = (o: any) => camp.from("social_sync_state").update({ ...o, updated_at: new Date().toISOString() }).eq("id", 1);

  const T = Deno.env.get("META_PAGES_TOKEN") || Deno.env.get("META_SYSTEM_TOKEN") || Deno.env.get("META_ACCESS_TOKEN");
  if (!T) { await setState({ last_error: "No Meta key saved on the server", last_error_at: new Date().toISOString() }); return j({ error: "No Meta key saved on the server" }, 500); }
  const pg: any = await gget(G + "/me/accounts?fields=id,name,username,access_token,followers_count,fan_count,picture{url},"
    + "instagram_business_account{id,username,followers_count,follows_count,media_count,profile_picture_url}&limit=50&access_token=" + encodeURIComponent(T));
  if (pg.err || !(pg.data || []).length) {
    const msg = pg.err ? "Meta refused the saved key: " + pg.err : "The saved Meta key sees no Pages";
    await setState({ last_error: msg, last_error_at: new Date().toISOString(), last_trigger: trigger });
    return j({ error: msg }, 400);
  }

  // reels already stored, so their published_posts copies are recognised even outside this run's window
  const { data: storedReels } = await camp.from("social_posts").select("id").eq("kind", "reel").eq("network", "facebook").limit(5000);
  const reelIds = new Set<string>((storedReels || []).map((r: any) => String(r.id)));

  for (const P of pg.data) {
    if (!P.access_token) { rep.errors.push(P.name + ": no Page token"); continue; }
    const pt = encodeURIComponent(P.access_token);
    const ig = P.instagram_business_account;
    await camp.from("social_pages").upsert({ id: P.id, network: "facebook", name: P.name, username: P.username || null,
      picture: P.picture?.data?.url || null, followers: num(P.followers_count), fan_count: num(P.fan_count),
      ig_id: ig?.id || null, ig_username: ig?.username || null, updated_at: new Date().toISOString() }, { onConflict: "id" });
    rep.pages++;

    // ---- Page totals by day (Viewers = the Page's daily reach) ----
    const today = new Date(); const windows: [string, string][] = [];
    const span = backfill ? 730 : 10;
    for (let back = span; back > 0; back -= 90) {
      const s = new Date(today.getTime() - back * 864e5), u = new Date(today.getTime() - Math.max(back - 90, 0) * 864e5);
      windows.push([day(s), day(u)]);
    }
    const daily: Record<string, any> = {};
    for (const [s, u] of windows) {
      const b: any = await gget(G + "/" + P.id + "/insights?metric=" + Object.keys(PAGE_METRICS).join(",")
        + "&period=day&since=" + s + "&until=" + u + "&access_token=" + pt);
      if (b.err) { rep.errors.push("Page totals " + s + ": " + b.err); continue; }
      for (const m of b.data || []) {
        const col = PAGE_METRICS[m.name]; if (!col) continue;
        for (const v of m.values || []) {
          const d = String(v.end_time || "").slice(0, 10); if (!d) continue;
          // Meta stamps a day's value at the END of that day (next day 07:00 UTC): step back one day
          const dd = day(new Date(new Date(d + "T00:00:00Z").getTime() - 864e5));
          (daily[dd] = daily[dd] || { page_id: P.id, day: dd })[col] = typeof v.value === "number" ? v.value : num(v.value);
        }
      }
    }
    const drows = Object.values(daily).map((r: any) => ({ ...r, synced_at: new Date().toISOString() }));
    for (let i = 0; i < drows.length; i += 200) {
      const { error } = await camp.from("social_page_daily").upsert(drows.slice(i, i + 200), { onConflict: "page_id,day" });
      if (error) rep.errors.push("save Page totals: " + error.message);
    }
    rep.page_days += drows.length;

    // ---- Reels first (so their copies on published_posts can be skipped) ----
    let rurl = G + "/" + P.id + "/video_reels?limit=50&fields=id,description,title,created_time,permalink_url,picture,length,"
      + "likes.summary(true).limit(0),comments.summary(true).limit(0)&access_token=" + pt;
    if (body.reels_after) rurl += "&after=" + encodeURIComponent(String(body.reels_after));
    const rl: any = await gall(rurl, Math.ceil(reelCap / 50));
    if (rl.err) rep.errors.push(P.name + " reels: " + rl.err);
    if (backfill && rl.next) { const m = /[?&]after=([^&]+)/.exec(rl.next); rep.reels_next = m ? decodeURIComponent(m[1]) : null; }
    (rl.data || []).forEach((r: any) => reelIds.add(String(r.id)));
    const built = await inBatches(rl.data || [], 6, async (r: any) => {
      const vi: any = await gget(G + "/" + r.id + "/video_insights?metric=" + REEL_METRICS + "&access_token=" + pt);
      if (vi?.err) { if (rep.errors.length < 8) rep.errors.push("reel insights: " + vi.err); return null; }
      const M = nested(vi); const rx = reelRx(M.post_video_likes_by_reaction_type); const sa = M.post_video_social_actions || {};
      const likes = num(r.likes?.summary?.total_count) || sumObj(rx), comments = num(r.comments?.summary?.total_count) || num(sa.COMMENT);
      const shares = num(sa.SHARE);
      return { id: String(r.id), page_id: P.id, page_name: P.name, network: "facebook", kind: "reel",
        message: r.description || r.title || "", permalink: r.permalink_url ? (String(r.permalink_url).startsWith("http") ? r.permalink_url : "https://www.facebook.com" + r.permalink_url) : null,
        thumbnail: r.picture || null, created_time: r.created_time || null, video_length_s: r.length || null,
        likes, comments, shares, interactions: likes + comments + shares, reactions: rx,
        plays: num(M.fb_reels_total_plays), replays: num(M.fb_reels_replay_count), views: num(M.fb_reels_total_plays),
        follows: num(M.post_video_followers), video_total_time_ms: num(M.post_video_view_time),
        video_avg_watch_ms: num(M.post_video_avg_time_watched), synced_at: new Date().toISOString() };
    });
    const rrows = built.filter(Boolean) as any[];
    rep.reels_kept_from_before += built.length - rrows.length;
    for (let i = 0; i < rrows.length; i += 100) {
      const { error } = await camp.from("social_posts").upsert(rrows.slice(i, i + 100), { onConflict: "id" });
      if (error) rep.errors.push("save reels: " + error.message);
    }
    rep.reels += rrows.length;

    // ---- Posts ----
    if (!body.reels_after) {
      let metrics = POST_METRICS.slice(); let dropped: string[] = [];
      const purl = (ms: string[]) => G + "/" + P.id + "/published_posts?limit=50&fields=id,message,story,created_time,permalink_url,"
        + "full_picture,status_type,attachments{media_type,type,url,media,target,subattachments},shares,"
        + "comments.summary(true).limit(0),reactions.summary(true).limit(0),insights.metric(" + ms.join(",") + ")&access_token=" + pt;
      let posts: any = await gall(purl(metrics), postPages);
      if (posts.err && /valid insights metric/i.test(posts.err)) {
        const one: any = await gget(G + "/" + P.id + "/published_posts?limit=1&fields=id&access_token=" + pt);
        const pid = one?.data?.[0]?.id;
        if (pid) {
          const ok = await inBatches(POST_METRICS, 5, async (m) => { const t: any = await gget(G + "/" + pid + "/insights?metric=" + m + "&access_token=" + pt); return t?.err ? null : m; });
          metrics = ok.filter(Boolean) as string[]; dropped = POST_METRICS.filter((m) => !metrics.includes(m));
          rep.errors.push("Meta no longer accepts post metric(s): " + (dropped.join(", ") || "none") + " - synced without them");
          posts = await gall(purl(metrics), postPages);
        }
      }
      if (posts.err) rep.errors.push(P.name + " posts: " + posts.err);
      const rows = (posts.data || []).filter((p: any) => {
        const tid = p.attachments?.data?.[0]?.target?.id;
        if (tid && reelIds.has(String(tid))) { rep.skipped_reel_copies++; return false; }
        return true;
      }).map((p: any) => {
        const M = nested(p); const act = M.post_activity_by_action_type || {};
        const rx = rxObj(M.post_reactions_by_type_total);
        const likes = num(p.reactions?.summary?.total_count) || sumObj(rx);
        const comments = num(p.comments?.summary?.total_count), shares = num(p.shares?.count) || num(act.share);
        const kind = kindOf(p);
        const row: any = { id: String(p.id), page_id: P.id, page_name: P.name, network: "facebook", kind,
          message: p.message || p.story || "", permalink: p.permalink_url || null,
          media_url: p.attachments?.data?.[0]?.url || null, thumbnail: thumbOf(p), created_time: p.created_time || null,
          likes, comments, shares, interactions: likes + comments + shares, reactions: rx,
          clicks: num(M.post_clicks), clicks_by_type: M.post_clicks_by_type || null, views: num(M.post_media_view),
          video_views: num(M.post_video_views), viewers: num(M.post_video_views_unique), follows: num(M.post_video_followers),
          video_avg_watch_ms: num(M.post_video_avg_time_watched), video_total_time_ms: num(M.post_video_view_time),
          synced_at: new Date().toISOString() };
        dropped.forEach((m) => (POST_METRIC_COLS[m] || []).forEach((c) => delete row[c]));
        return row;
      });
      for (let i = 0; i < rows.length; i += 100) {
        const { error } = await camp.from("social_posts").upsert(rows.slice(i, i + 100), { onConflict: "id" });
        if (error) rep.errors.push("save posts: " + error.message);
      }
      rep.posts += rows.length;
    }

    // ---- Instagram (only once it is linked to this Page) ----
    if (ig?.id && !body.reels_after) {
      await camp.from("social_pages").upsert({ id: ig.id, network: "instagram", name: "@" + (ig.username || ""), username: ig.username || null,
        picture: ig.profile_picture_url || null, followers: num(ig.followers_count), updated_at: new Date().toISOString() }, { onConflict: "id" });
      const iurl = (m: string) => G + "/" + ig.id + "/media?limit=50&fields=id,caption,media_type,media_product_type,media_url,thumbnail_url,"
        + "permalink,timestamp,like_count,comments_count,insights.metric(" + m + ")&access_token=" + pt;
      let im: any = await gall(iurl(IG_METRICS_EXT), backfill ? 20 : 2);
      if (im.err) { rep.errors.push("instagram (retried with the base metrics): " + im.err); im = await gall(iurl(IG_METRICS_BASE), backfill ? 20 : 2); }
      if (im.err) rep.errors.push("instagram: " + im.err);
      const irows = (im.data || []).map((m: any) => {
        const M = nested(m);
        const kind = String(m.media_product_type || "").toUpperCase() === "REELS" ? "reel"
          : (String(m.media_type || "").toUpperCase() === "CAROUSEL_ALBUM" ? "carousel" : "post");
        const likes = num(m.like_count), comments = num(m.comments_count), shares = num(M.shares), saves = num(M.saved);
        return { id: String(m.id), page_id: ig.id, page_name: "@" + (ig.username || ""), network: "instagram", kind,
          message: m.caption || "", permalink: m.permalink || null, media_url: m.media_url || null,
          thumbnail: m.thumbnail_url || m.media_url || null, created_time: m.timestamp || null,
          likes, comments, shares, saves, interactions: num(M.total_interactions) || (likes + comments + shares + saves),
          reach: num(M.reach), views: num(M.views), plays: kind === "reel" ? num(M.views) : 0, synced_at: new Date().toISOString() };
      });
      for (let i = 0; i < irows.length; i += 100) {
        const { error } = await camp.from("social_posts").upsert(irows.slice(i, i + 100), { onConflict: "id" });
        if (error) rep.errors.push("save instagram: " + error.message);
      }
      rep.ig += irows.length;
    }
  }

  await setState({ last_sync_at: new Date().toISOString(), last_trigger: trigger, last_result: rep,
    last_error: rep.errors.length ? rep.errors.slice(0, 3).join(" | ") : null,
    last_error_at: rep.errors.length ? new Date().toISOString() : null });
  return j({ ok: true, ...rep });
});
