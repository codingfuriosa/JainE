// Proxy sign-in + fetch for Competitor Ads. Slug is historical: the project is at its
// edge-function limit, so a spent one-shot probe's slot was reused with consent.
// Sign-in happened once on a laptop because Proxy refuses non-allow-listed redirects; refreshing
// carries no redirect, so this renews unattended for ever.
//
// THIS IS THE FUNCTION THE NIGHTLY CRON ACTUALLY CALLS (competitor-ads-proxy-daily). The
// competitor-ads-sync function next to it is the self-hosted-scraper path, reached from the
// Refresh button on the screen. Two routes into the same two tables; do not fix one and assume
// the other changed.

import { AwsClient } from "https://esm.sh/aws4fetch@1.0.20";

const ISSUER = "https://mcp.useproxy.dev";
const SB = Deno.env.get("SUPABASE_URL")!;
const SRV = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const H = { apikey: SRV, Authorization: "Bearer " + SRV, "Content-Type": "application/json",
  "Accept-Profile": "camp", "Content-Profile": "camp" };

const json = (o: unknown, s = 200) => new Response(JSON.stringify(o, null, 2),
  { status: s, headers: { "Content-Type": "application/json" } });

async function row() {
  const r = await fetch(SB + "/rest/v1/proxy_oauth?id=eq.1&select=*", { headers: H });
  const rows = await r.json().catch(() => []);
  return Array.isArray(rows) ? rows[0] ?? null : null;
}
async function save(p: Record<string, unknown>) {
  await fetch(SB + "/rest/v1/proxy_oauth?on_conflict=id", { method: "POST",
    headers: { ...H, Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify({ id: 1, ...p, updated_at: new Date().toISOString() }) });
}
const b64 = (b: Uint8Array) => btoa(String.fromCharCode(...b))
  .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const rnd = (n = 32) => b64(crypto.getRandomValues(new Uint8Array(n)));

async function accessToken() {
  const r = await row();
  if (!r?.refresh_token) throw new Error("Proxy is not connected - run proxy-signin.js once.");
  if (r.access_token && r.expires_at && new Date(r.expires_at).getTime() > Date.now() + 60000) {
    return r.access_token as string;
  }
  const form = new URLSearchParams({ grant_type: "refresh_token", refresh_token: r.refresh_token,
    client_id: r.client_id, client_secret: r.client_secret, resource: ISSUER + "/mcp" });
  const t = await fetch(ISSUER + "/token", { method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: form.toString() });
  const tok = await t.json().catch(() => ({}));
  if (!t.ok || !tok?.access_token) throw new Error("Proxy would not renew: " + String(tok?.error || t.status));
  await save({ access_token: tok.access_token, refresh_token: tok.refresh_token || r.refresh_token,
    expires_at: new Date(Date.now() + (Number(tok.expires_in) || 3600) * 1000).toISOString() });
  return tok.access_token as string;
}

async function mcp(token: string, method: string, params: unknown, sid?: string, notify = false) {
  const headers: Record<string, string> = { "Content-Type": "application/json",
    Accept: "application/json, text/event-stream", Authorization: "Bearer " + token };
  if (sid) headers["mcp-session-id"] = sid;
  const msg: any = notify ? { jsonrpc: "2.0", method, params }
                          : { jsonrpc: "2.0", id: Date.now(), method, params };
  const r = await fetch(ISSUER + "/mcp", { method: "POST", headers, body: JSON.stringify(msg) });
  const session = r.headers.get("mcp-session-id") || sid;
  const text = await r.text();
  let payload: any = null;
  try { payload = JSON.parse(text); } catch (_e) {
    for (const line of text.split("\n")) {
      const s = line.trim();
      if (!s.startsWith("data:")) continue;
      try { const o = JSON.parse(s.slice(5).trim()); if (o?.result || o?.error) payload = o; }
      catch (_x) { /* not this line */ }
    }
  }
  return { ok: r.ok, status: r.status, payload, text, session };
}

/* PROXY ANSWERS IN SEVERAL PARTS AND THE FIRST IS NOT THE ADS - it holds only a conversation_id.
   A parser taking the first readable part therefore finds nothing and reports a cheerful zero,
   which is what happened on the first run across all 24 competitors. Every text part is read and
   the one carrying ads wins. Image links live elsewhere again, in result._meta.media_urls. */
function unwrap(result: any) {
  const out: any = { data: null, media: (result?._meta?.media_urls) || null };
  let fallback: any = null;
  for (const p of (Array.isArray(result?.content) ? result.content : [])) {
    if (p?.type !== "text" || typeof p.text !== "string") continue;
    let o: any = null;
    try { o = JSON.parse(p.text); } catch (_e) { continue; }
    if (o && typeof o === "object") {
      if (o.ads || o.brands) { out.data = o; break; }
      if (!fallback) fallback = o;
    }
  }
  if (!out.data) out.data = result?.structuredContent ?? fallback;
  if (!out.media && out.data?.media_urls) out.media = out.data.media_urls;
  return out;
}

/* THE PICTURE IS COPIED, NOT LINKED. Proxy returns a Facebook CDN url carrying its own expiry
   (the oe= parameter), so a stored link works today and is a dead image next week. The page also
   signs S3 keys rather than loading third-party urls. So each creative is fetched once into the
   same bucket and the same shape the Apify path uses - media_items[{s3_path, media_type}] - and
   the Competitor Ads page renders it with no change at all. */
function s3() {
  const bucket = Deno.env.get("S3_BUCKET"), region = Deno.env.get("S3_REGION");
  const ak = Deno.env.get("AWS_ACCESS_KEY_ID"), sk = Deno.env.get("AWS_SECRET_ACCESS_KEY");
  if (!bucket || !region || !ak || !sk) return null;
  return { bucket, region, aws: new AwsClient({ accessKeyId: ak, secretAccessKey: sk, region, service: "s3" }) };
}
/* THE KEY MUST START WITH portal/ AND FOR MONTHS IT DID NOT.
   s3-sign, which is what the page calls to turn a stored key into something a browser can load,
   only treats portal/ and legal/ as real roots and quietly prefixes anything else with portal/
   before signing. This wrote "competitors/3/<id>_0.jpg", so the signer went looking for
   "portal/competitors/3/<id>_0.jpg", which was never written, and the tile read "Media
   unavailable" for ever. Sixty-nine ads were sitting like that - every single ad this nightly
   job had ever saved - while the ads from the other path, which did prefix correctly, were fine.
   Writing the prefix here repairs them on the next run as a side effect, because this job
   re-copies the creative each night and overwrites the stored key with it. */
async function copyMedia(url: string, wlId: number, adId: string) {
  const c = s3();
  if (!c) return null;
  try {
    const r = await fetch(url);
    if (!r.ok) return null;
    const bytes = new Uint8Array(await r.arrayBuffer());
    if (!bytes.byteLength) return null;
    const key = "portal/competitors/" + wlId + "/" + adId + "_0.jpg";
    const dest = "https://" + c.bucket + ".s3." + c.region + ".amazonaws.com/"
      + key.split("/").map(encodeURIComponent).join("/");
    const put = await c.aws.fetch(dest, { method: "PUT", body: bytes,
      headers: { "Content-Type": "image/jpeg" } });
    return put.ok ? "s3:" + key : null;
  } catch (_e) { return null; }
}

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const action = url.searchParams.get("action") || "";
  try {
    if (action === "status") {
      const r = await row();
      return json({ registered: !!r?.client_id, connected: !!r?.refresh_token,
        connected_at: r?.connected_at ?? null, token_fresh_until: r?.expires_at ?? null });
    }
    if (action === "prepare") {
      const nonce = rnd(24); await save({ state: "adopt:" + nonce });
      return json({ nonce, expires_in_minutes: 10 });
    }
    if (action === "adopt") {
      if (req.method !== "POST") return json({ error: "POST only" }, 405);
      const b = await req.json().catch(() => ({}));
      const r = await row(); const want = String(r?.state || "");
      if (!want.startsWith("adopt:")) return json({ error: "call ?action=prepare first" }, 400);
      if (Date.now() - new Date(r?.updated_at || 0).getTime() > 600000) {
        await save({ state: null }); return json({ error: "took over ten minutes" }, 400);
      }
      if (String(b?.nonce || "") !== want.slice(6)) return json({ error: "wrong nonce" }, 403);
      const form = new URLSearchParams({ grant_type: "refresh_token",
        refresh_token: String(b.refresh_token), client_id: String(b.client_id),
        client_secret: String(b.client_secret), resource: ISSUER + "/mcp" });
      const t = await fetch(ISSUER + "/token", { method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: form.toString() });
      const tok = await t.json().catch(() => ({}));
      if (!t.ok || !tok?.access_token) return json({ error: "refresh did not work" }, 502);
      await save({ client_id: String(b.client_id), client_secret: String(b.client_secret),
        refresh_token: String(tok.refresh_token || b.refresh_token), access_token: tok.access_token,
        expires_at: new Date(Date.now() + (Number(tok.expires_in) || 3600) * 1000).toISOString(),
        connected_at: new Date().toISOString(), state: null, code_verifier: null });
      return json({ ok: true, connected: true });
    }

    if (action === "sync") {
      if (req.method !== "POST") return json({ error: "POST only" }, 405);
      const body = await req.json().catch(() => ({}));
      const write = body?.write === true;
      const withMedia = body?.media !== false;
      const country = String(body?.country || "IN").toUpperCase().slice(0, 2);
      const perPage = Math.min(Number(body?.limit) || 25, 100);
      /* IT RUNS IN SLICES BECAUSE ONE INVOCATION CANNOT DO THE LOT. Copying every creative for 24
         competitors in a single call exceeded Supabase's resource ceiling and came back 546 with
         nothing written. skip/take walk the watchlist a few at a time; next_skip in the reply says
         where to carry on, and is null when there is no more. */
      const skip = Math.max(0, Number(body?.skip) || 0);
      const take = Math.max(1, Math.min(Number(body?.take) || 4, 24));
      /* ...AND NOTHING WAS CARRYING ON. The cron posted {"write":true} and nothing else, so every
         run started at skip 0, did the first four competitors and stopped - twice a night, the
         same four. Eighteen competitors had not been touched since 22 September and nobody could
         tell, because an untouched competitor keeps its old ads and they read as current.
         So the slice now hands over to the next one itself. waitUntil lets the handover outlive
         this response, hops is a hard stop against a loop that will not end, and auto:false still
         gives you a single slice when you want to test one by hand. */
      const auto = body?.auto !== false;
      const hops = Math.max(0, Number(body?.hops) || 0);

      const wlRes = await fetch(SB + "/rest/v1/competitor_watchlist"
        + "?select=id,name,page_id&active=is.true&page_id=not.is.null&order=id", { headers: H });
      const all: any[] = await wlRes.json().catch(() => []);
      const wl = all.slice(skip, skip + take);
      const ids = wl.map((w) => String(w.page_id || "").trim()).filter(Boolean);
      if (!ids.length) return json({ ok: true, done: true, next_skip: null,
        message: "nothing left in the watchlist from skip " + skip });
      const byPage = new Map<string, any>(); wl.forEach((w) => byPage.set(String(w.page_id).trim(), w));

      const token = await accessToken();
      const init = await mcp(token, "initialize", { protocolVersion: "2024-11-05",
        capabilities: {}, clientInfo: { name: "jaine", version: "1" } });
      await mcp(token, "notifications/initialized", {}, init.session, true);

      const rep: any = { of_watchlist: all.length, slice: { skip, take, names: wl.map((w) => w.name) },
        found: 0, written: 0, media_copied: 0, media_failed: 0, dry_run: !write,
        per_page: {} as Record<string, number>, errors: [] as string[] };

      const call = await mcp(token, "tools/call", { name: "get_meta_ads", arguments: {
        platform_ids: ids, country, limit: perPage,
        context: "Collect competitor property ads for the Jain Group competitor board." } },
        init.session);
      if (call.payload?.error) rep.errors.push(String(call.payload.error.message || "error"));
      else {
        const u = unwrap(call.payload?.result);
        if (!u.data) rep.errors.push("unreadable reply: " + call.text.slice(0, 140));
        else {
          const ads = u.data.ads || {};
          const media = u.media || {};
          for (const pageId of Object.keys(ads)) {
            const list = Array.isArray(ads[pageId]) ? ads[pageId] : [];
            const w = byPage.get(String(pageId));
            rep.per_page[(w?.name || pageId)] = list.length;
            rep.found += list.length;
            if (!w || !write) continue;
            for (const a of list) {
              const id = String(a?.ad_id || "").trim(); if (!id) continue;
              const src = media[id] || null;
              let items: any = null, first: string | null = null;
              if (src && withMedia) {
                const path = await copyMedia(String(src), w.id, id);
                if (path) { first = path; items = [{ s3_path: path, media_type: "image" }]; rep.media_copied++; }
                else rep.media_failed++;
              }
              const out: any = { id, watchlist_id: w.id, page_id: String(pageId),
                page_name: a?.page_name || a?.advertiser_name || w.name,
                ad_creative_bodies: a?.body ? [String(a.body)] : null,
                ad_creative_link_titles: a?.headline ? [String(a.headline)] : null,
                headline: a?.headline || null, description: a?.link_description || null, country,
                ad_snapshot_url: "https://www.facebook.com/ads/library/?id=" + id,
                ad_delivery_start_time: a?.start_date || null,
                ad_delivery_stop_time: a?.is_active ? null : (a?.end_date || null),
                publisher_platforms: a?.advertiser_platform ? [String(a.advertiser_platform)] : null,
                cta_text: a?.cta_text || null, redirect_url: a?.link_url || null,
                display_format: a?.media_type || null,
                last_seen_at: new Date().toISOString() };
              /* Only overwrite the picture when a new one was actually copied - a failed download
                 must not wipe a good image stored on an earlier run. */
              if (items) { out.media_items = items; out.media_s3_path = first; out.media_type = "image"; }
              const ins = await fetch(SB + "/rest/v1/competitor_ads?on_conflict=id", { method: "POST",
                headers: { ...H, Prefer: "resolution=merge-duplicates,return=minimal" },
                body: JSON.stringify(out) });
              if (ins.ok) rep.written++;
              else if (rep.errors.length < 5) rep.errors.push("save " + id + ": " + (await ins.text()).slice(0, 140));
            }
          }
        }
      }
      const next = skip + take;
      rep.next_skip = next < all.length ? next : null;
      rep.done = rep.next_skip === null;
      rep.hops = hops;

      if (auto && write && rep.next_skip !== null && hops < 12) {
        const carryOn = fetch(url.origin + "/functions/v1/competitor-sync-test-probe?action=sync", {
          method: "POST",
          headers: { "Content-Type": "application/json", apikey: SRV, Authorization: "Bearer " + SRV },
          body: JSON.stringify({ ...body, skip: rep.next_skip, hops: hops + 1 }),
        }).catch(() => {});
        try { (globalThis as any).EdgeRuntime?.waitUntil?.(carryOn); } catch (_e) { /* best effort */ }
        rep.handed_on_to_skip = rep.next_skip;
      }
      return json({ ok: true, ...rep });
    }

    return json({ actions: ["status", "prepare", "adopt (POST)", "sync (POST, skip/take)"] });
  } catch (e) {
    return json({ error: String((e as any)?.message || e) }, 500);
  }
});
