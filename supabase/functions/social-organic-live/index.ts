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
//   PER-POST VIEWERS (= Business Suite's Viewers, the post's reach): post_total_media_view_unique, but
//     ONLY asked of one post on its own (/{post}/insights?metric=...&period=lifetime). Inside the
//     published_posts list request it comes back 0 for every post - which is why 6 Nov concluded it did
//     not exist; the wide probe of 7 Nov found real figures (494, 375) asked singly, on v21, v23 and v25.
//     Stored in `reach`. Reels have no viewers on their video object; their Facebook post copy carries it.
//     post_impressions_unique (any version) is empty. FOLLOWS per post exist only for video and reels
//     (post_video_followers - follows gained); no follow or unfollow figure exists for photo posts.
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
async function viewersOf(ids: string[], pt: string) {
  const out = new Map<string, number>();
  await inBatches(Array.from(new Set(ids)), 10, async (id) => {
    const b: any = await gget(G + "/" + id + "/insights?metric=post_total_media_view_unique&period=lifetime&access_token=" + pt);
    const v = b?.data?.[0]?.values?.[0]?.value;
    if (!b.err && typeof v === "number") out.set(id, v);
  });
  return out;
}
const day = (d: Date) => d.toISOString().slice(0, 10);

/* POST NAME + CONTENT TYPE (7 Nov 2026, as asked). Every post gets a short name the way the team writes
   them ("Avishek Das - Work Anniversary", "Gandhi Jayanti", "Live from Holiday Inn - 1") and one of
   the team's own content types. Gemini reads the caption once; a post someone has corrected by hand
   (label_source 'manual') is never touched again - only posts with no content_type are sent. */
// 19 types, settled with the user on 7 Nov 2026 from their own sheets. Spelling variants in those
// sheets are the same type: "EGC Post" = EGC, "Blog Post" = Web Blog, "CARE" = CARE Post, "Testimonial
// Post" = Client Testimonial, "Office Event" = HR Activity. "Near Airport" is NOT a type.
// Same list in camp.social_post_set_label and ORG_CONTENT_TYPES (43-posts-and-reels.js).
const CONTENT_TYPES = ["Employee Post", "Birthday Post", "Wish Post", "Contest Post", "Quiz Post", "CP Testimonial",
  "Client Testimonial", "Channel Partner Post", "CP Post", "Event Post", "CARE Post", "Creative Post", "Project Post",
  "HR Activity", "EGC", "Web Blog", "PR Post", "Trending Post", "Moment Marketing"];
const LABEL_EXAMPLES = `Dhruti Patel - Employee Onboarding Post | Static Post | Employee Post
Gandhi Jayanti | Static Post | Wish Post
Durga Puja Contest Announcement | Static Post | Contest Post
Durga Puja Contest Quiz | Static Post | Quiz Post
Sudipto Karmakar - Propnex Realty CP Testimonial | Reel | CP Testimonial
September Month Birthday | Reel | Birthday Post
Channel Partner meet at Holiday Inn | Reel | Channel Partner Post
Avishek Das - Work Anniversary | Static Post | Employee Post
What goes into our policy making - Indirect CP | Carousel Post | CP Post
Announcement - Chocolate Durga Unveiling at Holiday Inn | Static Post | Event Post
CARE Post | Static Post | CARE Post
Mahalaya Post | Reel | Wish Post
Live from Holiday Inn - 1 | Reel | Event Post
Pre Durga Puja Celebration at Gurukul | Reel | Event Post
Quality aspect Post | Static Post | Creative Post
Media Coverage - Chocolate Durga Unveiling at Holiday Inn | Carousel Post | Event Post
Project Post - Dream One | Static Post | Project Post
Saree Draping at HQ | Reel | HR Activity
National Boss's Day | Static Post | Wish Post
Ramp Walk at HQ | Reel | EGC
Office Essentials EGC - DWC | Reel | EGC
VC Sir - Quote | Static Post | Creative Post
Web Blog | Static Post | Web Blog
Durga Puja - Contest winner announcement | Static Post | Contest Post
Halloween Bash in Office | Reel | HR Activity`;
const kindName = (k: string) => k === "reel" ? "Reel" : (k === "carousel" ? "Carousel Post" : (k === "video" ? "Video" : "Static Post"));

async function labelPosts(camp: any, max: number, rep: any) {
  const GKEY = Deno.env.get("GEMINI_API_KEY");
  if (!GKEY) { rep.errors.push("labels: GEMINI_API_KEY is not set"); return; }
  const { data, error } = await camp.from("social_posts").select("id,kind,message,created_time")
    .is("content_type", null).is("label_source", null).order("created_time", { ascending: false }).limit(max);
  if (error) { rep.errors.push("labels: " + error.message); return; }
  let done = 0;
  const todo = data || [];
  // 25 posts a request, five requests at a time, no thinking: one request at a time took ~90 s per 40
  // posts, so 400 never finished inside the edge-function time limit (7 Nov).
  const one = async (slice: any[]) => {
    const batch = slice.map((p: any) => ({ id: p.id, post_type: kindName(p.kind),
      date: String(p.created_time || "").slice(0, 10), caption: String(p.message || "").slice(0, 700) }));
    const prompt = "You name and classify social media posts of The Jain Group, a Kolkata real-estate developer.\n"
      + "For each post give:\n- name: a short title (2-8 words) in the team's style, e.g. 'Person Name - Work Anniversary', "
      + "'Festival name', 'Event - venue'. No hashtags, no emojis.\n- content_type: EXACTLY one of: " + CONTENT_TYPES.join(", ") + ".\n"
      + "Meaning: Employee Post = onboarding/welcome, work anniversary, staff achievements; Birthday Post = staff birthdays (e.g. a month's birthdays); "
      + "Wish Post = festival or day greetings; "
      + "Contest Post / Quiz Post = contests, winners, quizzes; CP Testimonial = a channel partner speaking about Jain Group; "
      + "Client Testimonial = a customer / home buyer speaking about Jain Group; "
      + "Channel Partner Post = channel-partner meets/events; CP Post = information aimed at channel partners; Event Post = company events, "
      + "launches, media coverage; CARE Post = the CARE initiative; Creative Post = brand creatives, quotes, location or quality messages; "
      + "Project Post = a specific project (Dream One, Dream World City, Gurukul, etc.); HR Activity = office fun activities, office events and celebrations; "
      + "EGC = employee-generated content (staff in fun/trend videos); Web Blog = blog article promotion; "
      + "PR Post = press releases, news / media mentions and awards; Trending Post = riding a social-media trend or meme format; "
      + "Moment Marketing = reacting to a current news moment (a match result, a viral event, a public moment).\n"
      + "Examples (name | post type | content type):\n" + LABEL_EXAMPLES + "\n\n"
      + "Answer with a JSON array only: [{\"id\":\"...\",\"name\":\"...\",\"content_type\":\"...\"}] - one item per post, same ids.\n"
      + "Posts:\n" + JSON.stringify(batch);
    const r = await fetch("https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent", {
      method: "POST", headers: { "Content-Type": "application/json", "x-goog-api-key": GKEY },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0, responseMimeType: "application/json", maxOutputTokens: 8000, thinkingConfig: { thinkingBudget: 0 } } }) });
    if (!r.ok) { rep.errors.push("labels: Gemini " + r.status); return; }
    const gj: any = await r.json().catch(() => ({}));
    let out: any[] = [];
    try { out = JSON.parse(String(gj?.candidates?.[0]?.content?.parts?.[0]?.text || "[]")); } catch (_e) { out = []; }
    if (!Array.isArray(out)) out = [];
    const ok = out.filter((x: any) => x && x.id && CONTENT_TYPES.includes(String(x.content_type)));
    await Promise.all(ok.map((x: any) => camp.from("social_posts")
      .update({ post_name: String(x.name || "").slice(0, 120) || null, content_type: String(x.content_type), label_source: "ai", label_at: new Date().toISOString() })
      .eq("id", String(x.id)).is("label_source", null)));
    done += ok.length;
  };
  const slices: any[][] = [];
  for (let i = 0; i < todo.length; i += 25) slices.push(todo.slice(i, i + 25));
  for (let i = 0; i < slices.length; i += 5) await Promise.all(slices.slice(i, i + 5).map(one));
  rep.labelled = done;
}

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
  // BACKFILL IN STEPS. One run doing everything was stopped by the edge-function time limit halfway
  // through the posts (6 Nov). body.only = 'page' | 'reels' | 'posts' runs one part; posts and reels
  // page on with posts_after / reels_after, returned as posts_next / reels_next until they come back null.
  const only = String(body.only || "");
  if (only === "label") {
    const rep0: any = { mode: "label", labelled: 0, errors: [] as string[] };
    await labelPosts(camp, 250, rep0);
    return j({ ok: true, ...rep0 });
  }
  const doPage = !only || only === "page", doReels = !only || only === "reels", doPosts = !only || only === "posts";
  const postPages = backfill ? 10 : 2, reelCap = backfill ? 150 : 50;
  const rep: any = { mode: backfill ? "backfill" : "daily", pages: 0, posts: 0, reels: 0, ig: 0, page_days: 0,
    skipped_reel_copies: 0, reels_kept_from_before: 0, reels_next: null, posts_next: null, errors: [] as string[] };
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
    for (const [s, u] of (doPage ? windows : [])) {
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
    if (!doReels) rurl = "";
    if (rurl && body.reels_after) rurl += "&after=" + encodeURIComponent(String(body.reels_after));
    const rl: any = rurl ? await gall(rurl, Math.ceil(reelCap / 50)) : { data: [] };
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
    if (doPosts && !body.reels_after) {
      let metrics = POST_METRICS.slice(); let dropped: string[] = [];
      const purl = (ms: string[]) => G + "/" + P.id + "/published_posts?limit=50&fields=id,message,story,created_time,permalink_url,"
        + "full_picture,status_type,attachments{media_type,type,url,media,target,subattachments},shares,"
        + "comments.summary(true).limit(0),reactions.summary(true).limit(0),insights.metric(" + ms.join(",") + ")&access_token=" + pt
        + (body.posts_after ? "&after=" + encodeURIComponent(String(body.posts_after)) : "")
        + (body.posts_until ? "&until=" + encodeURIComponent(String(body.posts_until)) : "");
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
      // OLD POSTS. Meta keeps post insights for about two years; asking for them on older posts can fail
      // the whole page ("unexpected error"). Those pages are fetched again without insights, so the
      // post and its reactions / comments / shares still come in.
      let noIns = false; const withIns = new Set<string>();
      if (posts.err && backfill && !/valid insights metric/i.test(posts.err)) {
        rep.errors.push(P.name + " posts (retried without insights): " + posts.err);
        const bare = purl(metrics).replace(/,insights.metric([^)]*)/, "");
        const again: any = await gall(bare, postPages);
        (posts.data || []).forEach((p: any) => withIns.add(String(p.id)));
        if ((again.data || []).length) { posts = { data: (posts.data || []).concat(again.data), next: again.next, err: again.err }; noIns = true; }
      }
      if (posts.err) rep.errors.push(P.name + " posts: " + posts.err);
      if (backfill && posts.next) { const m = /[?&]after=([^&]+)/.exec(posts.next); rep.posts_next = m ? decodeURIComponent(m[1]) : null; }
      const reelCopies: [string, string][] = [];   // [post id, reel id]
      const rows = (posts.data || []).filter((p: any) => {
        const tid = p.attachments?.data?.[0]?.target?.id;
        if (tid && reelIds.has(String(tid))) { rep.skipped_reel_copies++; reelCopies.push([String(p.id), String(tid)]); return false; }
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
        // fetched without insights: leave every insight column out, never write them as 0
        if (noIns && !withIns.has(row.id)) POST_METRICS.forEach((m) => (POST_METRIC_COLS[m] || []).forEach((c) => delete row[c]));
        return row;
      }).filter((r: any, i: number, a: any[]) => a.findIndex((x: any) => x.id === r.id) === i);   // one row per id per upsert
      // VIEWERS (7 Nov 2026). post_total_media_view_unique is Business Suite's "Viewers" for a post -
      // but ONLY when asked of that one post on its own: inside the list request above it comes back 0
      // for every post, which is why it was first thought unavailable. One call per post, 10 at a time.
      // A post Meta has no figure for (older than ~2 years) keeps whatever is stored.
      const vw = await viewersOf(rows.map((r: any) => r.id).concat(reelCopies.map((c) => c[0])), pt);
      rows.forEach((r: any) => { if (vw.has(r.id)) r.reach = vw.get(r.id); });
      rep.viewers = (rep.viewers || 0) + rows.filter((r: any) => vw.has(r.id)).length;
      // a reel's viewers live on its Facebook post copy, not on the reel's video object
      await inBatches(reelCopies.filter((c) => vw.has(c[0])), 10, (c) =>
        camp.from("social_posts").update({ reach: vw.get(c[0]) }).eq("id", c[1]));
      // Saved in groups with the same columns: a bulk upsert writes NULL into any column one row lacks
      // and another has, which would wipe a stored figure (viewers, or insights Meta refused) on rows
      // that simply had nothing new for it this run.
      const groups = new Map<string, any[]>();
      rows.forEach((r: any) => { const k = Object.keys(r).sort().join(","); if (!groups.has(k)) groups.set(k, []); groups.get(k)!.push(r); });
      for (const g of groups.values()) {
        for (let i = 0; i < g.length; i += 100) {
          const { error } = await camp.from("social_posts").upsert(g.slice(i, i + 100), { onConflict: "id" });
          if (error) rep.errors.push("save posts: " + error.message);
        }
      }
      rep.posts += rows.length;
    }

    // ---- Instagram (only once it is linked to this Page) ----
    if (ig?.id && doPosts && !body.reels_after && !body.posts_after) {
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
          likes, comments, shares, saves, interactions: num(M.total_interactions),   // Meta's own figure, as is
          reach: num(M.reach), views: num(M.views), plays: kind === "reel" ? num(M.views) : 0, synced_at: new Date().toISOString() };
      });
      for (let i = 0; i < irows.length; i += 100) {
        const { error } = await camp.from("social_posts").upsert(irows.slice(i, i + 100), { onConflict: "id" });
        if (error) rep.errors.push("save instagram: " + error.message);
      }
      rep.ig += irows.length;
    }
  }

  // new posts get their name and content type in the same run
  if (!only || only === "posts") await labelPosts(camp, backfill ? 0 : 120, rep);

  await setState({ last_sync_at: new Date().toISOString(), last_trigger: trigger, last_result: rep,
    last_error: rep.errors.length ? rep.errors.slice(0, 3).join(" | ") : null,
    last_error_at: rep.errors.length ? new Date().toISOString() : null });
  return j({ ok: true, ...rep });
});
