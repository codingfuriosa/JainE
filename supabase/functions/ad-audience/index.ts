/* AD AUDIENCE (18 Nov 2026, Ayush: an Audience tab - "only Who It Is"). For the Facebook ad sets asked, who each one is shown
   to, read from Meta now: the kind of audience (Advantage+ / Lookalike / Custom list / Interest / Broad), the locations, the
   age range, the gender, and Meta's estimate of how many people the ad set can reach (monthly active people, a range).
   Read only; nothing is stored.
   body: { adsets: ['<ad set id>', ...] }   (up to 150)
   answer: { ok, adsets: { id: { name, type, audiences[], interests[], locations[], excluded[], age, gender, size:{lo,hi}|null } } }
   WHO MAY CALL: a signed-in JainE staff member (the same check as ad-reach / ad-video). */
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
async function g(path: string) {
  const r = await fetch(`https://graph.facebook.com/${FBV}/${path}${path.includes('?') ? '&' : '?'}access_token=${ADS}`);
  const t = await r.json().catch(() => ({}));
  if (!r.ok || t.error) throw new Error('Meta: ' + ((t.error && t.error.message) || r.status));
  return t;
}
const km = (x: any) => (x && x.radius ? ` (+${x.radius} ${x.distance_unit === 'mile' ? 'mi' : 'km'})` : '');
function places(geo: any) {
  const out: string[] = []; if (!geo) return out;
  for (const c of geo.custom_locations || []) out.push((c.name || c.address_string || (c.latitude != null ? `${(+c.latitude).toFixed(3)}, ${(+c.longitude).toFixed(3)}` : 'Pin')) + km(c));
  for (const c of geo.cities || []) out.push((c.name || c.key) + km(c));
  for (const c of geo.zips || []) out.push(String(c.name || c.key));
  for (const c of geo.regions || []) out.push(String(c.name || c.key));
  for (const c of geo.places || []) out.push((c.name || c.key) + km(c));
  for (const c of geo.countries || []) out.push(c === 'IN' ? 'India' : String(c));
  return out;
}
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (!(await allowed(req))) return j({ error: 'not allowed' }, 401);
  let body: any = {}; try { body = await req.json(); } catch (_) { /* empty */ }
  const ids: string[] = [...new Set((Array.isArray(body.adsets) ? body.adsets : []).map((x: any) => String(x).replace(/\D/g, '')).filter(Boolean))].slice(0, 150) as string[];
  if (!ids.length || !ADS) return j({ error: 'adsets?' }, 400);
  const out: any = { ok: true, adsets: {}, errors: [] };
  // the ad sets' targeting, 50 at a time
  const sets: Record<string, any> = {};
  await Promise.all(Array.from({ length: Math.ceil(ids.length / 50) }, (_, i) => ids.slice(i * 50, i * 50 + 50)).map(async (part) => {
    try { const t = await g(`?ids=${part.join(',')}&fields=name,targeting`); for (const k of Object.keys(t)) sets[k] = t[k]; }
    catch (e) { out.errors.push('targeting: ' + String((e as Error).message).slice(0, 160)); }
  }));
  // the custom audiences they use: which are lookalikes
  const caIds = new Set<string>();
  for (const s of Object.values(sets)) for (const c of [...((s.targeting || {}).custom_audiences || []), ...((s.targeting || {}).excluded_custom_audiences || [])]) if (c && c.id) caIds.add(String(c.id));
  const ca: Record<string, any> = {};
  const caList = [...caIds];
  for (let i = 0; i < caList.length; i += 50) {
    try { const t = await g(`?ids=${caList.slice(i, i + 50).join(',')}&fields=name,subtype`); for (const k of Object.keys(t)) ca[k] = t[k]; }
    catch (e) { out.errors.push('audiences: ' + String((e as Error).message).slice(0, 160)); }
  }
  // Meta's estimate of the people each ad set can reach
  const size: Record<string, any> = {};
  await Promise.all(Object.keys(sets).map(async (id) => {
    try { const t = await g(`${id}/delivery_estimate?fields=estimate_mau_lower_bound,estimate_mau_upper_bound,estimate_ready`);
      const d = (t.data || [])[0]; if (d && d.estimate_mau_lower_bound != null) size[id] = { lo: Number(d.estimate_mau_lower_bound), hi: Number(d.estimate_mau_upper_bound) }; }
    catch (_) { /* no estimate for this one (finished ad sets often have none) */ }
  }));
  for (const id of Object.keys(sets)) {
    const s = sets[id], t = s.targeting || {};
    const adv = !!(t.targeting_automation && Number(t.targeting_automation.advantage_audience) === 1);
    const cas = (t.custom_audiences || []).map((c: any) => ({ name: c.name || (ca[c.id] && ca[c.id].name) || c.id, look: !!(ca[c.id] && /LOOKALIKE/i.test(String(ca[c.id].subtype || ''))) }));
    const interests: string[] = [];
    for (const f of t.flexible_spec || []) for (const k of Object.keys(f)) for (const x of (Array.isArray(f[k]) ? f[k] : [])) if (x && x.name) interests.push(x.name);
    const type: string[] = [];
    if (adv) type.push('Advantage+');
    if (cas.some((c: any) => c.look)) type.push('Lookalike');
    if (cas.some((c: any) => !c.look)) type.push('Custom list');
    if (interests.length) type.push('Interest');
    if (!cas.length && !interests.length) type.push('Broad');
    const gen = Array.isArray(t.genders) && t.genders.length === 1 ? (Number(t.genders[0]) === 1 ? 'Men' : 'Women') : 'All';
    const amax = t.age_max != null ? (Number(t.age_max) >= 65 ? '65+' : String(t.age_max)) : '65+';
    out.adsets[id] = { name: s.name || id, type: type.join(' · '), audiences: cas.map((c: any) => c.name), interests,
      locations: places(t.geo_locations), excluded: places(t.excluded_geo_locations).concat((t.excluded_custom_audiences || []).map((c: any) => c.name || (ca[c.id] && ca[c.id].name) || c.id)),
      age: `${t.age_min != null ? t.age_min : 18}–${amax}`, gender: gen, advantage: adv, size: size[id] || null };
  }
  return j(out);
});
