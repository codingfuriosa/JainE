/* LEAD MAP - Site Visit and Booked customers by PIN code (30 Oct 2026). See the migration
   20261030160000_lead_map.sql for the tables.

   THE CRM FEED NEEDS ONLY SECRETS. Set in Supabase -> Edge Functions -> Secrets:
     CRM_PINCODE_API_URL          the CRM report address. It may contain {from} and {to}; they are
                                  replaced with dates (YYYY-MM-DD) so only new days are asked for.
     or, if the CRM has two separate reports:
     CRM_SITEVISIT_API_URL / CRM_BOOKING_API_URL   - rows from these are Site Visits / Bookings outright
     CRM_PINCODE_API_KEY          optional - sent in the header named by CRM_PINCODE_API_KEY_HEADER
                                  (default "Authorization"), exactly as given
   The report's columns are recognised by name (pincode / pin / zip; project; site visit / booking;
   date; an id), so it does not have to be in any particular shape. A row whose project is not Dream
   Ananta, Dream Gurukul or Dream World City, or that has no valid PIN code, is skipped and counted -
   never guessed. The run log says which columns were used, and how many rows were skipped and why.

   WHERE A PIN CODE GOES ON THE MAP. India Post (api.postalpincode.in) gives its area names, district
   and state. The map position comes from Google's Geocoding API when a key is set
   (GOOGLE_GEOCODING_API_KEY, else the Places / YouTube key if Geocoding is enabled on it), otherwise
   from OpenStreetMap - first by the PIN code itself, then by its India Post area name. Each PIN is
   looked up once and kept. The pin marks the middle of the PIN area, never a home address. */

const SB = Deno.env.get('SUPABASE_URL')!;
const SRV = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const H = { apikey: SRV, Authorization: 'Bearer ' + SRV, 'Content-Type': 'application/json' };
const START = '2026-01-01';   // the map is kept from the start of the year
const PROJECTS: [RegExp, string][] = [[/ananta/i, 'Dream Ananta'], [/gurukul/i, 'Dream Gurukul'], [/world\s*city|\bdwc\b/i, 'Dream World City']];

async function get(path: string) {
  const r = await fetch(`${SB}/rest/v1/${path}`, { headers: { ...H, 'Accept-Profile': 'camp' } });
  if (!r.ok) throw new Error(`db read ${path.split('?')[0]}: ${r.status} ${(await r.text()).slice(0, 200)}`);
  return await r.json();
}
async function upsert(table: string, rows: any[], onConflict: string, ignore = false) {
  for (let i = 0; i < rows.length; i += 500) {
    const r = await fetch(`${SB}/rest/v1/${table}?on_conflict=${onConflict}`, { method: 'POST',
      headers: { ...H, 'Content-Profile': 'camp', Prefer: `resolution=${ignore ? 'ignore' : 'merge'}-duplicates,return=minimal` },
      body: JSON.stringify(rows.slice(i, i + 500)) });
    if (!r.ok) throw new Error(`db write ${table}: ${r.status} ${(await r.text()).slice(0, 300)}`);
  }
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const istToday = () => new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);
const addDays = (d: string, n: number) => new Date(Date.parse(d + 'T00:00:00Z') + n * 86400_000).toISOString().slice(0, 10);

// ---------------------------------------------------------------- the browser map key
// A Maps JavaScript key is public by design (it sits in the page); Google protects it by the website
// it is restricted to. It is kept as a secret only so it can be changed without touching code.
export function mapKey() {
  return Deno.env.get('GOOGLE_MAPS_BROWSER_KEY') || null;
}

// ---------------------------------------------------------------- reading the CRM report
const norm = (k: string) => k.toLowerCase().replace(/[^a-z0-9]/g, '');
function findRows(x: any, depth = 0): any[] | null {
  if (Array.isArray(x)) return x.length && typeof x[0] === 'object' ? x : (x.length ? null : []);
  if (x && typeof x === 'object' && depth < 3) {
    for (const k of Object.keys(x)) { const r = findRows(x[k], depth + 1); if (r) return r; }
  }
  return null;
}
function pick(rec: any, tests: ((k: string) => boolean)[]) {
  const keys = Object.keys(rec);
  for (const t of tests) { const k = keys.find((k) => t(norm(k)) && rec[k] !== null && rec[k] !== ''); if (k) return k; }
  return null;
}
const PIN_RE = /\b([1-9][0-9]{5})\b/;
function toDate(v: any): string | null {
  const s = String(v ?? '').trim();
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = /^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})/.exec(s);             // DD-MM-YYYY, the Indian way
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  m = /^(\d{1,2})[\s\-]([A-Za-z]{3})[A-Za-z]*[\s\-,]+(\d{4})/.exec(s);  // 5 Oct 2026 / 05-Oct-2026
  if (m) { const i = 'janfebmaraprmayjunjulaugsepoctnovdec'.indexOf(m[2].toLowerCase()); if (i >= 0) return `${m[3]}-${String(i / 3 + 1).padStart(2, '0')}-${m[1].padStart(2, '0')}`; }
  return null;
}
async function fetchReport(url: string, from: string, to: string) {
  const u = url.replace(/\{from\}/g, from).replace(/\{to\}/g, to);
  const key = Deno.env.get('CRM_PINCODE_API_KEY');
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (key) headers[Deno.env.get('CRM_PINCODE_API_KEY_HEADER') || 'Authorization'] = key;
  const r = await fetch(u, { headers });
  const t = await r.text();
  if (!r.ok) throw new Error(`CRM answered ${r.status}: ${t.slice(0, 200)}`);
  let body: any; try { body = JSON.parse(t); } catch (_) { throw new Error('CRM did not answer with JSON: ' + t.slice(0, 120)); }
  const rows = findRows(body);
  if (!rows) throw new Error('could not find a list of records in the CRM answer');
  return rows;
}

export async function syncFromCrm() {
  const feeds: [string, string | null][] = [];
  const any = Deno.env.get('CRM_PINCODE_API_URL'), sv = Deno.env.get('CRM_SITEVISIT_API_URL'), bk = Deno.env.get('CRM_BOOKING_API_URL');
  if (any) feeds.push([any, null]);
  if (sv) feeds.push([sv, 'site_visit']);
  if (bk) feeds.push([bk, 'booked']);
  // typed-in PIN codes still get placed on the map while the CRM feed is not set up
  if (!feeds.length) return { rows: 0, message: 'CRM API not set yet - add CRM_PINCODE_API_URL (or CRM_SITEVISIT_API_URL / CRM_BOOKING_API_URL) as a Supabase secret; ' + await geocodeMissing() };

  // from three days before the newest CRM row (the CRM may add a visit a day late), or from 1 Jan
  const last = await get('lm_pins?source=eq.crm&select=event_date&order=event_date.desc&limit=1');
  const from = last.length ? addDays(last[0].event_date, -3) : START, to = istToday();
  const skipped: Record<string, number> = {}; const used: Record<string, string> = {};
  const skip = (why: string) => { skipped[why] = (skipped[why] || 0) + 1; };
  const out: any[] = [];
  for (const [url, forced] of feeds) {
    const recs = await fetchReport(url, from, to);
    for (const rec of recs) {
      if (!rec || typeof rec !== 'object') continue;
      const kPin = pick(rec, [(k) => k.includes('pincode'), (k) => k === 'pin' || k.endsWith('pin'), (k) => k.includes('zip') || k.includes('postal')])
        || pick(rec, [(k) => k.includes('address')]);
      const kProj = pick(rec, [(k) => k.includes('project')]);
      const kKind = forced ? null : pick(rec, [(k) => k.includes('stage'), (k) => k.includes('status'), (k) => k.includes('activity'), (k) => k.includes('type')]);
      const kDate = pick(rec, [(k) => k.includes('sitevisitdate') || k.includes('visitdate'), (k) => k.includes('bookingdate'),
        (k) => k.endsWith('date') || k.includes('dateof'), (k) => k.includes('created')]);
      const kId = pick(rec, [(k) => k === 'id', (k) => k.endsWith('id') && !k.includes('project')]);
      const pinM = kPin ? PIN_RE.exec(String(rec[kPin])) : null;
      if (!pinM) { skip('no PIN code'); continue; }
      const projTxt = String(kProj ? rec[kProj] : '');
      const proj = (PROJECTS.find(([re]) => re.test(projTxt)) || [])[1];
      if (!proj) { skip('another project'); continue; }
      let kind = forced;
      if (!kind) {
        const s = String(kKind ? rec[kKind] : '');
        kind = /book/i.test(s) ? 'booked' : /visit|\bsv\b/i.test(s) ? 'site_visit' : null;
      }
      if (!kind) { skip('neither site visit nor booking'); continue; }
      const date = toDate(kDate ? rec[kDate] : '');
      if (!date) { skip('no readable date'); continue; }
      if (date < START) { skip('before 1 Jan 2026'); continue; }
      let ref = kId ? String(rec[kId]) : '';
      if (!ref) {   // no id: the record itself, hashed, so the same row read twice is still one row
        const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(rec)));
        ref = Array.from(new Uint8Array(d)).map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 24);
      }
      used.pincode = kPin!; if (kProj) used.project = kProj; if (kKind) used.kind = kKind; if (kDate) used.date = kDate; if (kId) used.id = kId;
      out.push({ project: proj, kind, pincode: pinM[1], event_date: date, source: 'crm', crm_ref: `${kind}:${ref}` });
    }
  }
  await upsert('lm_pins', out, 'crm_ref');
  const geo = await geocodeMissing();
  return { rows: out.length, message: `read ${from} to ${to}; columns used ${JSON.stringify(used)}; skipped ${JSON.stringify(skipped)}; ${geo}` };
}

// ---------------------------------------------------------------- PIN code -> place on the map
async function indiaPost(pin: string) {
  try {
    const r = await fetch(`https://api.postalpincode.in/pincode/${pin}`);
    const x = await r.json();
    const po = x && x[0] && x[0].Status === 'Success' ? x[0].PostOffice || [] : [];
    if (!po.length) return null;
    return { place: [...new Set(po.map((p: any) => p.Name))].slice(0, 4).join(', '), district: po[0].District, state: po[0].State, area: po[0].Name };
  } catch (_) { return null; }
}
async function google(pin: string, cc = 'IN') {
  const key = Deno.env.get('GOOGLE_GEOCODING_API_KEY') || Deno.env.get('GOOGLE_PLACES_API_KEY') || Deno.env.get('YOUTUBE_API_KEY');
  if (!key) return null;
  try {
    const x = await (await fetch(`https://maps.googleapis.com/maps/api/geocode/json?components=postal_code:${encodeURIComponent(pin)}|country:${cc}&key=${key}`)).json();
    if (x.status !== 'OK' || !x.results?.length) return null;
    const l = x.results[0].geometry.location;
    return { lat: l.lat, lng: l.lng, src: 'google' };
  } catch (_) { return null; }
}
let lastOsm = 0;
async function osm(q: string, cc = 'IN') {
  // OpenStreetMap's public service allows one request a second and asks to be told who is calling
  const wait = 1100 - (Date.now() - lastOsm); if (wait > 0) await sleep(wait);
  lastOsm = Date.now();
  try {
    const r = await fetch('https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&countrycodes=' + cc.toLowerCase() + '&' + q,
      { headers: { 'User-Agent': 'JAIN-E lead map (thejaingroup.com)', 'Accept-Language': 'en' } });
    const x = await r.json();
    return x && x[0] ? { lat: Number(x[0].lat), lng: Number(x[0].lon) } : null;
  } catch (_) { return null; }
}
/* Photon (photon.komoot.io) - a second free OpenStreetMap search. OpenStreetMap's own service turns
   away requests from Supabase's servers (tested 30 Oct 2026: the same query worked from the office
   and failed from the function), Photon answers them. For a PIN code it must return that exact
   postcode in India, or nothing is used. */
async function photon(q: string, pin?: string, cc = 'IN') {
  try {
    const x = await (await fetch('https://photon.komoot.io/api/?limit=8&q=' + encodeURIComponent(q),
      { headers: { 'User-Agent': 'JAIN-E lead map (thejaingroup.com)' } })).json();
    const f = (x.features || []).find((f: any) => f.properties?.countrycode === cc &&
      (!pin || String(f.properties.postcode || (f.properties.osm_value === 'postcode' ? f.properties.name : '')) === pin));
    if (!f) return null;
    const p = f.properties;
    return { lat: f.geometry.coordinates[1], lng: f.geometry.coordinates[0],
      place: [p.district, p.city, p.locality].filter(Boolean)[0] || p.name || null, district: p.county || p.city || null, state: p.state || null };
  } catch (_) { return null; }
}
/* A postal code from outside India, stored as 'US-11004'. India Post knows nothing about it, so the
   area name comes from the same OpenStreetMap answer that gives the position. */
async function foreign(cc: string, code: string) {
  const g = await google(code, cc);
  const ph = await photon(code + ' ' + cc, code, cc);
  if (g) return { ...g, place: ph?.place || null, district: ph?.district || null, state: ph?.state || null };
  if (ph) return { ...ph, src: 'openstreetmap' };
  const o = await osm('postalcode=' + encodeURIComponent(code), cc);
  return o ? { ...o, src: 'openstreetmap', place: null, district: null, state: null } : null;
}
export async function geocodeMissing(limit = 60) {
  const pins: string[] = [...new Set((await get('lm_pins?select=pincode')).map((r: any) => r.pincode as string))];
  const known = new Map((await get('lm_pincodes?select=pincode,lat,looked_up_at')).map((r: any) => [r.pincode, r]));
  // never looked up, or looked up without success more than a day ago
  const todo = pins.filter((p) => { const k: any = known.get(p); return !k || (k.lat == null && Date.parse(k.looked_up_at || 0) < Date.now() - 86400_000); }).slice(0, limit);
  let ok = 0;
  for (const pin of todo) {
    const fm = /^([A-Z]{2})-(.+)$/.exec(pin);
    if (fm) {
      const c: any = await foreign(fm[1], fm[2]);
      await upsert('lm_pincodes', [{ pincode: pin, lat: c ? c.lat : null, lng: c ? c.lng : null, place: c?.place || null, district: c?.district || null,
        state: c?.state || null, coord_source: c ? c.src : null, looked_up_at: new Date().toISOString(),
        lookup_error: c ? null : 'no map position found for this postal code yet' }], 'pincode');
      if (c) ok++;
      continue;
    }
    const ip = await indiaPost(pin);
    let c: any = await google(pin);
    if (!c) { const o = await photon(pin + ' India', pin); if (o) c = { ...o, src: 'openstreetmap' }; }
    if (!c) { const o = await osm('postalcode=' + pin); if (o) c = { ...o, src: 'openstreetmap' }; }
    if (!c && ip) { const q = `${ip.area}, ${ip.district}, ${ip.state}`;
      const o = (await osm('q=' + encodeURIComponent(q))) || (await photon(q + ', India')); if (o) c = { ...o, src: 'openstreetmap-area' }; }
    await upsert('lm_pincodes', [{ pincode: pin, lat: c ? c.lat : null, lng: c ? c.lng : null, place: ip?.place || null, district: ip?.district || null,
      state: ip?.state || null, coord_source: c ? c.src : null, looked_up_at: new Date().toISOString(),
      lookup_error: c ? null : (ip ? 'no map position found for this PIN yet' : 'India Post does not know this PIN code') }], 'pincode');
    if (c) ok++;
  }
  return `placed ${ok} of ${todo.length} new PIN code(s) on the map`;
}
