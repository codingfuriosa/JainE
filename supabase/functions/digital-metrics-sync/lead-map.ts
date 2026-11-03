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
// The CRM calls Dream Ananta "New Project" (business unit 171) - the user, 2 Nov 2026. Any other
// project (Dream Eco City and the rest) is ignored.
const PROJECTS: [RegExp, string][] = [[/ananta|new\s*project/i, 'Dream Ananta'], [/gurukul/i, 'Dream Gurukul'], [/world\s*city|\bdwc\b/i, 'Dream World City']];

async function get(path: string) {
  const r = await fetch(`${SB}/rest/v1/${path}`, { headers: { ...H, 'Accept-Profile': 'camp' } });
  if (!r.ok) throw new Error(`db read ${path.split('?')[0]}: ${r.status} ${(await r.text()).slice(0, 200)}`);
  return await r.json();
}
/* PostgREST answers with at most 1,000 rows, and it does so silently - the 1,001st is simply not
   there. lm_pins passed that mark on 30 Oct 2026 (1,071 rows) and geocodeMissing() stopped being
   able to see 15 PIN codes living only in the rows past it. They were never placed, and never
   stamped with an error either, because the row that would carry the error is only written for a
   PIN the lookup actually reached. The Lead Map screen asks for a geocode whenever a PIN has
   neither a position nor an error - so it asked on every single draw, and redrew itself without
   end. Anything that has to see every row now reads it a page at a time. */
async function getAll(path: string, page = 1000) {
  const out: any[] = [];
  for (let off = 0; off < 200_000; off += page) {
    const rows = await get(`${path}${path.includes('?') ? '&' : '?'}limit=${page}&offset=${off}`);
    for (const r of rows) out.push(r);
    if (rows.length < page) break;
  }
  return out;
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

// ---------------------------------------------------------------- share links (2 Nov 2026)
/* A Lead Map link anyone can open - no login - showing ONE month (or all months), ONE project (or all)
   and Site Visit / Booked / both, as a bare map. Asked for so the map can be sent outside JAIN-E.
     - The link carries its choice and an HMAC-SHA256 signature made with the job secret, so it
       cannot be edited to show something else, and other links cannot be guessed.
     - It never expires (as asked) and always shows the current counts for that choice.
     - It gives out only PIN codes, their area names, map positions and counts. Never who uploaded,
       when, or anything about a customer; test pins and PIN codes that could not be placed are
       left out. */
const b64u = (b: Uint8Array) => btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64u = (s: string) => new TextDecoder().decode(Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0)));
async function shareSecret() {
  const r = await fetch(`${SB}/rest/v1/job_secrets?name=eq.digital_metrics&select=value`, { headers: { ...H, 'Accept-Profile': 'acc' } });
  const x = await r.json();
  if (!x[0]?.value) throw new Error('share secret missing');
  return x[0].value as string;
}
async function hmac(payload: string) {
  const k = await crypto.subtle.importKey('raw', new TextEncoder().encode('lead-map-share:' + await shareSecret()),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return b64u(new Uint8Array(await crypto.subtle.sign('HMAC', k, new TextEncoder().encode(payload))));
}
const SHARE_PROJECTS = ['all', 'Dream Ananta', 'Dream Gurukul', 'Dream World City'];
const SHARE_KINDS = ['all', 'site_visit', 'booked'];
export async function shareToken(month: string, project: string, kind: string) {
  if (!(month === 'all' || /^20\d\d-(0[1-9]|1[0-2])$/.test(month))) throw new Error('bad month');
  if (!SHARE_PROJECTS.includes(project) || !SHARE_KINDS.includes(kind)) throw new Error('bad choice');
  const payload = b64u(new TextEncoder().encode(JSON.stringify({ m: month, p: project, k: kind })));
  return payload + '.' + await hmac(payload);
}
export async function publicMap(token: string) {
  const [payload, sig] = String(token || '').split('.');
  if (!payload || !sig || sig !== await hmac(payload)) return { error: 'This link is not valid.' };
  let c: any; try { c = JSON.parse(unb64u(payload)); } catch (_) { return { error: 'This link is not valid.' }; }
  // the months: one, or every month from January 2026 to this one
  const now = istToday().slice(0, 7), months: string[] = [];
  if (c.m === 'all') { for (let y = 2026, m = 1; `${y}-${String(m).padStart(2, '0')}` <= now; m++) { if (m > 12) { m = 0; y++; continue; } months.push(`${y}-${String(m).padStart(2, '0')}`); } }
  else months.push(c.m);
  const byPin: Record<string, any> = {};
  for (const m of months) {
    const r = await fetch(`${SB}/rest/v1/rpc/lm_month`, { method: 'POST', headers: { ...H, 'Content-Profile': 'camp' }, body: JSON.stringify({ p_month: m + '-01' }) });
    if (!r.ok) throw new Error('could not read the map');
    for (const x of await r.json()) {
      if (x.kind === 'test' || !x.project) continue;                 // test pins never go out
      if (c.p !== 'all' && x.project !== c.p) continue;
      if (c.k !== 'all' && x.kind !== c.k) continue;
      if (x.lat == null) continue;                                    // not found = never plotted
      const p = byPin[x.pincode] = byPin[x.pincode] || { pincode: x.pincode, lat: x.lat, lng: x.lng, place: x.place, district: x.district, state: x.state, sv: 0, bk: 0 };
      if (x.kind === 'site_visit') p.sv += Number(x.n); else p.bk += Number(x.n);
    }
  }
  return { month: c.m, project: c.p, kind: c.k, pins: Object.values(byPin), as_of: new Date().toISOString() };
}

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

/* THE REALTY BUCKET FEED (2 Nov 2026). The user's CRM answers
     {from, to, total, items: [{lead_id, pincode, business_unit_id, business_unit_name, activity: ["booked","site_visited"]}]}
   for the dates in the address (DD-MM-YYYY). Each lead carries NO date of its own, so the feed is asked
   for ONE DAY - yesterday - and every lead gets that day. Asked once a day only: repeated calls slow
   the CRM server down (the user's instruction), so a day already read is never asked for again, and a
   failed call is not retried until the next day's run. Lead Map starts from November 2026; earlier
   months are added by hand. */
const CRM_FROM = '2026-11-01';
const dmyDash = (iso: string) => `${iso.slice(8, 10)}-${iso.slice(5, 7)}-${iso.slice(0, 4)}`;
const ACT_KIND: Record<string, string> = { site_visited: 'site_visit', sitevisited: 'site_visit', site_visit: 'site_visit', booked: 'booked', booking: 'booked' };
// Turns one feed's items into Lead Map rows. Shared by the daily run and by a one-off load of a saved reply.
export function crmRows(items: any[], day: string) {
  const out: any[] = []; const skipped: Record<string, number> = {};
  const skip = (why: string) => { skipped[why] = (skipped[why] || 0) + 1; };
  for (const it of items || []) {
    const proj = (PROJECTS.find(([re]) => re.test(String(it?.business_unit_name || ''))) || [])[1];
    if (!proj) { skip('another project'); continue; }
    const pin = PIN_RE.exec(String(it?.pincode ?? ''));
    if (!pin) { skip('no PIN code'); continue; }
    const kinds = [...new Set((Array.isArray(it.activity) ? it.activity : [it.activity])
      .map((a: any) => ACT_KIND[String(a || '').toLowerCase().replace(/\s+/g, '_')]).filter(Boolean))];
    if (!kinds.length) { skip('neither site visit nor booking'); continue; }
    // one Site Visit and one Booking per lead at most: a lead read again can never be counted twice
    for (const kind of kinds) out.push({ project: proj, kind, pincode: pin[1], event_date: day, source: 'crm', crm_ref: `${kind}:${it.lead_id}` });
  }
  return { out, skipped };
}

export async function syncFromCrm(force = false) {
  const url = Deno.env.get('CRM_PINCODE_API_URL');
  // typed-in PIN codes still get placed on the map while the CRM feed is not set up
  if (!url) return { rows: 0, message: 'CRM API not set yet - add CRM_PINCODE_API_URL as a Supabase secret; ' + (await geocodeMissing()).message };
  const day = addDays(istToday(), -1);
  if (day < CRM_FROM) return { rows: 0, message: 'Lead Map reads the CRM from 1 Nov 2026; ' + (await geocodeMissing()).message };
  // already read that day? then do not touch the CRM again
  const done = await get(`dm_sync_log?part=eq.lead_map&ok=is.true&message=like.*crm-day%20${day}*&select=id&limit=1`);
  if (done.length && !force) return { rows: 0, message: `crm-day ${day} was already read - the CRM was not called again; ` + (await geocodeMissing()).message };
  const u = url.replace(/\{from\}/g, dmyDash(day)).replace(/\{to\}/g, dmyDash(day));
  const r = await fetch(u, { headers: { Accept: 'application/json' } });
  const t = await r.text();
  if (!r.ok) throw new Error(`CRM answered ${r.status} for ${day}: ${t.slice(0, 200)} - not retried until tomorrow`);
  let body: any; try { body = JSON.parse(t); } catch (_) { throw new Error('CRM did not answer with JSON: ' + t.slice(0, 120)); }
  const { out, skipped } = crmRows(body.items || findRows(body) || [], day);
  await upsert('lm_pins', out, 'crm_ref', true);   // ignore a lead already stored
  const geo = (await geocodeMissing()).message;
  return { rows: out.length, message: `crm-day ${day}: ${(body.items || []).length} lead(s) from the CRM, ${out.length} added to the map; skipped ${JSON.stringify(skipped)}; ${geo}` };
}

// The older, column-guessing reader for other feeds - kept for reference, no longer called.
export async function syncFromCrmGeneric() {
  const feeds: [string, string | null][] = [];
  const any = Deno.env.get('CRM_SITEVISIT_API_URL_GENERIC');
  if (any) feeds.push([any, null]);
  if (!feeds.length) return { rows: 0, message: 'not set' };
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
  const geo = (await geocodeMissing()).message;
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
  const pins: string[] = [...new Set((await getAll('lm_pins?select=pincode')).map((r: any) => r.pincode as string))];
  const known = new Map((await getAll('lm_pincodes?select=pincode,lat,looked_up_at')).map((r: any) => [r.pincode, r]));
  /* A PIN never looked up comes first, always; a retry of one that failed gets whatever budget is
     left. 39 PIN codes India Post does not know were taking the whole allowance of 20 every run,
     so a PIN that had never been tried was never reached - and the screen waiting on it never got
     its answer. Putting the unseen ones first is what guarantees each run makes progress. */
  const unseen = pins.filter((p) => !known.get(p));
  const retry = pins.filter((p) => { const k: any = known.get(p); return k && k.lat == null && Date.parse(k.looked_up_at || 0) < Date.now() - 86400_000; });
  const todo = unseen.concat(retry).slice(0, limit);
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
  /* placed is what the Lead Map screen watches. It redraws only when a PIN actually reached the
     map, so a run that achieves nothing ends the wait instead of starting another draw. */
  return { placed: ok, tried: todo.length, left: Math.max(0, unseen.length + retry.length - todo.length),
    message: `placed ${ok} of ${todo.length} PIN code(s) on the map` };
}
