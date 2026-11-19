/* BRAND AD TEXT (18 Nov 2026, Ayush: "in Jain Group Fb Ads the bottom left of the card has text our cards don't show - get it
   through the API, don't waste proxy credits"). The Ad Library cards of our own pages (camp.competitor_ads, watchlist category
   'brand') carry the link's title and description - "Ready Flats, Just 5 Min from Joka Metro" / "Dream World City, Joka" - but
   the scraper gets either nothing (image / video ads) or the template a dynamic ad shows the Library ("{{product.name}}").
   The real words are in our own ads' creatives, which our Marketing API key reads for free. This matches each Library card to
   our ad by its text and fills in the title and description where the card has none or only the template. The scraper never
   overwrites these fields on ads it has seen before, so a fill stays.
   WHO MAY CALL: the cron (x-ads-secret = acc.job_secrets 'ads_daily') or a signed-in staff member. {dry:true} reports only. */
import { createClient } from "jsr:@supabase/supabase-js@2";

const SB = Deno.env.get('SUPABASE_URL')!, SRV = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, ANON = Deno.env.get('SUPABASE_ANON_KEY') || '';
const ADS = Deno.env.get('META_SYSTEM_USER_TOKEN') || Deno.env.get('META_ACCESS_TOKEN') || '';
const FBV = 'v21.0';
const db = createClient(SB, SRV, { db: { schema: 'camp' } });
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-ads-secret', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
const j = (o: unknown, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } });

async function allowed(req: Request) {
  const sec = req.headers.get('x-ads-secret');
  if (sec) { const { data } = await createClient(SB, SRV, { db: { schema: 'acc' } }).from('job_secrets').select('value').eq('name', 'ads_daily').maybeSingle(); return !!(data && data.value === sec); }
  const auth = req.headers.get('Authorization') || '';
  if (!/^Bearer\s+\S+/.test(auth) || !ANON) return false;
  const can = await fetch(`${SB}/rest/v1/rpc/pi_allowed`, { method: 'POST', body: '{}', headers: { apikey: ANON, Authorization: auth, 'Content-Type': 'application/json', 'Content-Profile': 'camp' } });
  return can.ok && (await can.json()) === true;
}
async function fb(url: string) {
  const out: any[] = []; let next: string | null = url + '&access_token=' + ADS;
  for (let i = 0; next && i < 40; i++) {
    const r = await fetch(next); const t = await r.json().catch(() => ({}));
    if (!r.ok || t.error) throw new Error('Meta: ' + ((t.error && t.error.message) || r.status));
    out.push(...(t.data || [])); next = t.paging && t.paging.next ? t.paging.next : null;
    if (next && !/[?&]access_token=/.test(next)) next += '&access_token=' + ADS;
  }
  return out;
}
const blank = (s: any) => { s = String(s || '').trim(); return !s || /\{\{[^}]*\}\}/.test(s); };
const key = (s: any) => String(s || '').toLowerCase().replace(/\{\{[^}]*\}\}/g, '').replace(/[^a-z0-9]+/g, '').slice(0, 90);
const txt = (l: any) => (Array.isArray(l) ? l.map((x: any) => x && x.text).filter(Boolean) : []);

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (!(await allowed(req))) return j({ error: 'not allowed' }, 401);
  let body: any = {}; try { body = await req.json(); } catch (_) { /* empty */ }
  const dry = !!body.dry;
  // a look at one ad account's catalogue ads: their product sets and a few products (read only)
  if (body.peek) {
    const acc = String(body.peek).replace(/\D/g, '');
    const filt0 = encodeURIComponent(JSON.stringify([{ field: 'effective_status', operator: 'IN', value: ['ACTIVE'] }]));
    const q = String(body.q || '').toLowerCase();
    const st = q ? ['ACTIVE', 'PAUSED', 'CAMPAIGN_PAUSED', 'ADSET_PAUSED'] : ['ACTIVE'];
    const filt1 = encodeURIComponent(JSON.stringify([{ field: 'effective_status', operator: 'IN', value: st }]));
    const ads = await fb(`https://graph.facebook.com/${FBV}/act_${acc}/ads?limit=100&filtering=${q ? filt1 : filt0}&fields=id,name,created_time,effective_status,creative{product_set_id,body,title,effective_object_story_id,object_story_spec{template_data{message,name,description,link},link_data{message,name,description,caption},video_data{message,title,link_description}},asset_feed_spec{bodies,titles,descriptions,link_urls}}`);
    if (q) return j({ ok: true, total: ads.length, hits: ads.filter((a: any) => JSON.stringify(a).toLowerCase().includes(q)).slice(0, 5) });
    const sets = [...new Set(ads.map((a: any) => a.creative && a.creative.product_set_id).filter(Boolean))];
    const prods: any = {};
    for (const s of sets.slice(0, 5)) { try { prods[s] = await fb(`https://graph.facebook.com/${FBV}/${s}/products?limit=10&fields=retailer_id,name,description,brand`); } catch (e) { prods[s] = String((e as Error).message); } }
    return j({ ok: true, ads: ads.filter((a: any) => a.creative && (a.creative.product_set_id || a.creative.object_story_spec?.template_data)).slice(0, 10), product_sets: prods });
  }
  // our Library cards still missing the link text
  const { data: wl } = await db.from('competitor_watchlist').select('id').eq('category', 'brand');
  const ids = (wl || []).map((w: any) => w.id);
  if (!ids.length) return j({ ok: true, note: 'no brand pages' });
  const { data: cards, error } = await db.from('competitor_ads').select('id,page_id,page_name,ad_creative_bodies,headline,description,ad_delivery_start_time').in('watchlist_id', ids).limit(2000);
  if (error) return j({ error: error.message }, 500);
  const need = (cards || []).filter((c: any) => blank(c.headline) || blank(c.description));
  if (!need.length) return j({ ok: true, cards: (cards || []).length, missing: 0, filled: 0 });
  // our ads' words, from every included Facebook ad account (running and paused ads)
  const { data: accs } = await db.from('ads_accounts').select('account_id').eq('platform', 'meta').eq('include', true);
  const idx = new Map<string, { title: string; desc: string }>(); const notes: string[] = [];
  // dynamic ads per Facebook page, with when they were made: a Library card of a dynamic ad carries only template text
  // ({{product.brand}}), so it is matched to our dynamic ad on the same page made nearest its start date
  const dyn: Record<string, { t: number; title: string; desc: string }[]> = {};
  const filt = encodeURIComponent(JSON.stringify([{ field: 'effective_status', operator: 'IN', value: ['ACTIVE', 'PAUSED', 'CAMPAIGN_PAUSED', 'ADSET_PAUSED'] }]));
  await Promise.all((accs || []).map(async (a: any) => {
    try {
      const ads = await fb(`https://graph.facebook.com/${FBV}/act_${a.account_id}/ads?limit=200&filtering=${filt}&fields=created_time,creative{body,title,effective_object_story_id,object_story_spec{page_id,link_data{message,name,description,caption},video_data{message,title,link_description}},asset_feed_spec{bodies,titles,descriptions}}`);
      for (const ad of ads) {
        const cr = ad.creative || {}, os = cr.object_story_spec || {}, ld = os.link_data || {}, vd = os.video_data || {}, af = cr.asset_feed_spec || {};
        const title = cr.title || ld.name || vd.title || txt(af.titles)[0] || '';
        const desc = ld.description || vd.link_description || txt(af.descriptions)[0] || ld.caption || '';
        if (!title && !desc) continue;
        const page = String(os.page_id || String(cr.effective_object_story_id || '').split('_')[0] || '');
        if (page && txt(af.titles).length) (dyn[page] = dyn[page] || []).push({ t: Date.parse(ad.created_time || '') || 0, title, desc });
        for (const b of [cr.body, ld.message, vd.message, ...txt(af.bodies)]) { const k = key(b); if (k.length >= 20 && !idx.has(k)) idx.set(k, { title, desc }); }
      }
    } catch (e) { notes.push(a.account_id + ': ' + String((e as Error).message).slice(0, 140)); }
  }));
  const keys = [...idx.keys()];
  let filled = 0; const missed: string[] = [];
  for (const c of need) {
    const k = key((c.ad_creative_bodies || [])[0]);
    // the same words, or one text starting with the other (the Library sometimes shows a shortened body)
    let hit = k.length >= 20 ? (idx.get(k) || idx.get(keys.find((x) => x.startsWith(k.slice(0, 60)) || k.startsWith(x.slice(0, 60))) || '')) : undefined;
    // a dynamic ad's card (template text only): our dynamic ad on the same page made nearest the card's start date
    if (!hit && blank((c.ad_creative_bodies || [])[0]) && c.page_id && dyn[c.page_id]) {
      const t0 = Date.parse(c.ad_delivery_start_time || '') || 0;
      hit = dyn[c.page_id].slice().sort((x, y) => Math.abs(x.t - t0) - Math.abs(y.t - t0))[0];
    }
    if (!hit) { missed.push(c.id); continue; }
    const upd: any = {};
    if (blank(c.headline) && hit.title) { upd.headline = hit.title; upd.ad_creative_link_titles = [hit.title]; }
    if (blank(c.description) && hit.desc) upd.description = hit.desc;
    if (!Object.keys(upd).length) { missed.push(c.id); continue; }
    if (!dry) { const { error: e2 } = await db.from('competitor_ads').update(upd).eq('id', c.id); if (e2) { notes.push(c.id + ': ' + e2.message); continue; } }
    filled++;
  }
  return j({ ok: true, dry, cards: (cards || []).length, missing: need.length, filled, not_matched: missed.length, our_ad_texts: idx.size, notes });
});
