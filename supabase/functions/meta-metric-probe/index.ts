// READ-ONLY Meta metric probe (6-7 Nov 2026). Reuses the retired meta-metric-probe slot - the project
// is at its edge-function limit. Reads the Jain Group Page with the saved META_PAGES_TOKEN and asks
// each candidate metric ON ITS OWN (one bad name fails a whole insights request) on a few real posts
// and reels, across Graph API versions and periods, returning what came back. Writes nothing.
// Only callers holding acc.job_secrets 'meta_probe' (sent as x-probe-secret) get an answer.
//
// 7 Nov: asked to find an automatic source for per-post Viewers and Net Follows, which Business Suite
// shows but v25 post_total_media_view_unique / post_impressions_unique return as 0 / empty.
const SB = Deno.env.get("SUPABASE_URL")!;
const SRV = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const json = (o: unknown, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { "Content-Type": "application/json" } });

async function gget(url: string) {
  const r = await fetch(url);
  const b = await r.json().catch(() => ({}));
  if (b?.error) return { err: String(b.error.message || "graph error").slice(0, 120), code: b.error.code };
  return b;
}
const val = (b: any) => { const x = b?.data?.[0]; if (!x) return b?.err ? "ERR: " + b.err : "no data";
  const v = x.values?.[0]?.value ?? x.total_value?.value; return v === undefined ? "no value" : v; };

// 7 Nov, second pass: is there ANY follow / unfollow figure on a photo post?
// 7 Nov, third pass: Meta's own per-post Interactions figure.
const POST_CANDIDATES = ["post_total_interactions", "post_interactions", "total_interactions", "post_engagements", "post_engagement",
  "post_interaction_count", "post_engaged_users", "post_total_engagements", "post_reactions_like_total", "post_activity", "post_activity_unique"];
const REEL_CANDIDATES = ["post_total_interactions", "post_interactions", "total_interactions", "post_video_social_actions",
  "post_engagements", "post_video_engagement", "fb_reels_interactions", "post_activity"];

Deno.serve(async (req) => {
  const secret = req.headers.get("x-probe-secret") || "";
  const r = await fetch(SB + "/rest/v1/job_secrets?name=eq.meta_probe&select=value",
    { headers: { apikey: SRV, Authorization: "Bearer " + SRV, "Accept-Profile": "acc" } });
  const rows = await r.json().catch(() => []);
  if (!secret || !Array.isArray(rows) || rows[0]?.value !== secret) return json({ error: "unauthorized" }, 401);
  const body: any = await req.json().catch(() => ({}));
  const versions: string[] = body.versions || ["v21.0", "v23.0", "v25.0"];
  const periods: string[] = body.periods || ["lifetime", ""];
  const T = Deno.env.get("META_PAGES_TOKEN") || Deno.env.get("META_SYSTEM_TOKEN") || Deno.env.get("META_ACCESS_TOKEN");
  if (!T) return json({ error: "no Meta token secret" }, 500);
  const G0 = "https://graph.facebook.com/v25.0";
  // 7 Nov: "check I have given access to that system user" - which Instagram account the saved key can
  // reach through the Page, and which permissions the key itself carries. Returns no tokens.
  if (body.check === "instagram") {
    const tk = encodeURIComponent(T);
    const me: any = await gget(G0 + "/me?fields=id,name&access_token=" + tk);
    const perms: any = await gget(G0 + "/me/permissions?access_token=" + tk);
    const acc: any = await gget(G0 + "/me/accounts?fields=id,name,instagram_business_account{id,username,followers_count,media_count},connected_instagram_account{id,username}&limit=10&access_token=" + tk);
    const igs: any = await gget(G0 + "/me/instagram_accounts?fields=id,username&access_token=" + tk);
    const out: any = { user: me.err ? me.err : { id: me.id, name: me.name },
      permissions: perms.err ? perms.err : (perms.data || []).map((p: any) => p.permission + ":" + p.status),
      pages: acc.err ? acc.err : (acc.data || []).map((p: any) => ({ page: p.name, instagram_business_account: p.instagram_business_account || null, connected_instagram_account: p.connected_instagram_account || null })),
      instagram_accounts_edge: igs.err ? igs.err : (igs.data || []) };
    const ig = (acc.data || []).map((p: any) => p.instagram_business_account).find(Boolean);
    if (ig) { const m: any = await gget(G0 + "/" + ig.id + "/media?limit=1&fields=id,timestamp,insights.metric(reach)&access_token=" + tk);
      out.instagram_media_test = m.err ? "ERR: " + m.err : ((m.data || [])[0] ? { id: m.data[0].id, timestamp: m.data[0].timestamp, reach: m.data[0].insights?.data?.[0]?.values?.[0]?.value } : "no posts"); }
    return json(out);
  }
  const pg: any = await gget(G0 + "/me/accounts?fields=id,name,access_token&limit=5&access_token=" + encodeURIComponent(T));
  if (pg.err) return json({ error: pg.err });
  const P = (pg.data || [])[0]; const pt = encodeURIComponent(P.access_token);
  // two posts a few weeks old (numbers have settled) and two reels
  const posts: any = await gget(G0 + "/" + P.id + "/published_posts?limit=12&fields=id,created_time,message&access_token=" + pt);
  const reels: any = await gget(G0 + "/" + P.id + "/video_reels?limit=6&fields=id,created_time,description&access_token=" + pt);
  const pick = (a: any[]) => [a[5], a[8]].filter(Boolean);
  const out: any = { page: P.name, posts: {}, reels: {} };
  const run = async (objs: any[], names: string[], edge: string, into: any) => {
    for (const o of objs) {
      const res: any = {};
      await Promise.all(versions.flatMap((v) => periods.flatMap((per) => names.map(async (m) => {
        const b = await gget("https://graph.facebook.com/" + v + "/" + o.id + "/" + edge + "?metric=" + m
          + (per ? "&period=" + per : "") + "&access_token=" + pt);
        const x = val(b);
        if (!(typeof x === "string" && x.startsWith("ERR"))) res[m + " @" + v + (per ? " " + per : "")] = x;
      }))));
      into[String(o.created_time).slice(0, 10) + " " + String(o.message || o.description || "").slice(0, 40)] = res;
    }
  };
  await run(pick(posts.data || []), POST_CANDIDATES, "insights", out.posts);
  await run(pick(reels.data || []), REEL_CANDIDATES, "video_insights", out.reels);
  return json(out);
});
