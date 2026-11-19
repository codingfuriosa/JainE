/* AD REACH (18 Nov 2026, Ayush: the Facebook Ads tab needs Reach and Cost per 1K Reach). Reach is people, not views: the same
   person reached on three days is one person, so a period's reach cannot be added up from the daily figures JainE stores.
   It is asked from Meta for exactly the period on screen, for the ads, ad sets and campaigns listed, and for each ad account
   as a whole (the Total). Read only; nothing is stored.
   body: { from:'YYYY-MM-DD', to:'YYYY-MM-DD', accounts: { '<ad account id>': { ad:[ids], adset:[ids], campaign:[ids] } },
           groups: { key: { '<ad account id>': [ad ids] } } }
   answer: { ok, ad:{id:reach}, adset:{id:reach}, campaign:{id:reach}, account:{id:reach}, group:{key:reach} }
   WHO MAY CALL: a signed-in JainE staff member (the same check as ad-video / ads-daily-sync's manual calls). */
const SB = Deno.env.get('SUPABASE_URL')!, ANON = Deno.env.get('SUPABASE_ANON_KEY') || '';
const ADS = Deno.env.get('META_SYSTEM_USER_TOKEN') || Deno.env.get('META_ACCESS_TOKEN') || '';
const FBV = 'v21.0';
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
const j = (o: unknown, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } });
async function allowed(req: Request) {
  const auth = req.headers.get('Authorization') || '';
  if (!/^Bearer\s+\S+/.test(auth) || !ANON) return false;
  const can = await fetch(`${SB}/rest/v1/rpc/pi_allowed`, { method: 'POST', body: '{}', headers: { apikey: ANON, Authorization: auth, 'Content-Type': 'application/json', 'Content-Profile': 'camp' } });
  return can.ok && (await can.json()) === true;
}
const day = (s: any) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || '')) ? String(s) : '';
async function all(url: string) {
  const out: any[] = []; let next: string | null = url;
  for (let i = 0; next && i < 20; i++) {
    const r = await fetch(next); const t = await r.json().catch(() => ({}));
    if (!r.ok || t.error) throw new Error('Meta: ' + ((t.error && t.error.message) || r.status));
    out.push(...(t.data || [])); next = t.paging && t.paging.next ? t.paging.next : null;
    if (next && !/[?&]access_token=/.test(next)) next += (next.includes('?') ? '&' : '?') + 'access_token=' + ADS;   // Meta's next page can leave the key off
  }
  return out;
}
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (!(await allowed(req))) return j({ error: 'not allowed' }, 401);
  let body: any = {}; try { body = await req.json(); } catch (_) { /* empty */ }
  const from = day(body.from), to = day(body.to);
  if (!from || !to || !ADS) return j({ error: 'from / to?' }, 400);
  const tr = encodeURIComponent(JSON.stringify({ since: from, until: to }));
  /* CHECK ({from,to,probe:{account}}; 18 Nov 2026): one account's ads for the dates with Meta's own video figures, to check
     the Facebook Ads tab's formulas against them. Read only. */
  if (body.probe && body.probe.account) {
    const acc = String(body.probe.account).replace(/\D/g, '');
    try {
      const rows = await all(`https://graph.facebook.com/${FBV}/act_${acc}/insights?level=ad&time_range=${tr}&use_unified_attribution_setting=true&limit=200`
        + `&fields=ad_id,ad_name,spend,impressions,reach,clicks,inline_link_clicks,actions,video_play_actions,video_thruplay_watched_actions,video_p25_watched_actions,video_p50_watched_actions,video_p75_watched_actions,video_p100_watched_actions&access_token=${ADS}`);
      return j({ ok: true, rows: rows.slice(0, 200) });
    } catch (e) { return j({ ok: false, error: String((e as Error).message || e) }); }
  }
  const out: any = { ok: true, ad: {}, adset: {}, campaign: {}, account: {}, errors: [] };
  const accs = body.accounts && typeof body.accounts === 'object' ? body.accounts : {};
  const jobs: Promise<void>[] = [];
  for (const acc0 of Object.keys(accs).slice(0, 20)) {
    const acc = acc0.replace(/\D/g, ''); if (!acc) continue;
    const base = `https://graph.facebook.com/${FBV}/act_${acc}/insights?time_range=${tr}&use_unified_attribution_setting=true&limit=500&access_token=${ADS}`;
    // the account as a whole (the Total)
    jobs.push(all(base + '&fields=reach').then((r) => { out.account[acc] = r[0] && r[0].reach != null ? Number(r[0].reach) : 0; }).catch((e) => { out.errors.push(acc + ': ' + String(e.message || e).slice(0, 160)); }));
    for (const level of ['ad', 'adset', 'campaign']) {
      const ids: string[] = (Array.isArray(accs[acc0][level]) ? accs[acc0][level] : []).map((x: any) => String(x).replace(/\D/g, '')).filter(Boolean);
      for (let i = 0; i < ids.length; i += 50) {
        const part = ids.slice(i, i + 50);
        const filt = encodeURIComponent(JSON.stringify([{ field: level + '.id', operator: 'IN', value: part }]));
        jobs.push(all(base + `&level=${level}&fields=${level}_id,reach&filtering=${filt}`).then((rows) => {
          for (const r of rows) { const id = r[level + '_id']; if (id) out[level][id] = Number(r.reach || 0); }
        }).catch((e) => { out.errors.push(acc + ' ' + level + ': ' + String(e.message || e).slice(0, 160)); }));
      }
    }
  }
  /* AN AD AND ITS COPIES (groups: { key: { '<ad account id>': [ad ids] } }): one reach for all of them together - the
     same person reached by two copies is one person, so their reaches are not added. Copies in two ad accounts are
     asked per account and added (rare). */
  out.group = {};
  const groups = body.groups && typeof body.groups === 'object' ? body.groups : {};
  for (const key of Object.keys(groups).slice(0, 80)) {
    const per = groups[key] || {};
    for (const acc0 of Object.keys(per).slice(0, 4)) {
      const acc = acc0.replace(/\D/g, ''); const ids = (Array.isArray(per[acc0]) ? per[acc0] : []).map((x: any) => String(x).replace(/\D/g, '')).filter(Boolean).slice(0, 50);
      if (!acc || !ids.length) continue;
      const filt = encodeURIComponent(JSON.stringify([{ field: 'ad.id', operator: 'IN', value: ids }]));
      jobs.push(all(`https://graph.facebook.com/${FBV}/act_${acc}/insights?time_range=${tr}&use_unified_attribution_setting=true&fields=reach&filtering=${filt}&access_token=${ADS}`)
        .then((r) => { out.group[key] = (out.group[key] || 0) + (r[0] && r[0].reach != null ? Number(r[0].reach) : 0); })
        .catch((e) => { out.errors.push(key + ': ' + String(e.message || e).slice(0, 160)); }));
    }
  }
  await Promise.all(jobs);
  return j(out);
});
