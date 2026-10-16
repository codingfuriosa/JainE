// Pure parsers for public-intel - no network, no database, so they can be tested on saved pages
// (tools/public-data/test-parse.ts). Anything a parser cannot find comes back null, never guessed.

// ---------------------------------------------------------------- Google Ads Transparency Center
export const GADS_FORMAT: Record<number, string> = { 1: 'text', 2: 'image', 3: 'video' };

export function gadsCreatives(json: any) {
  const out: any[] = [];
  for (const c of (json && json['1']) || []) {
    const adv = String(c['1'] || ''), cr = String(c['2'] || '');
    if (!adv || !cr) continue;
    const body = c['3'] || {};
    const html = body?.['3']?.['2'] || '';
    const img = (String(html).match(/src="([^"]+)"/) || [])[1] || null;
    const secs = (o: any) => (o && o['1'] ? new Date(Number(o['1']) * 1000).toISOString() : null);
    out.push({
      creative_id: cr,
      advertiser_id: adv,
      advertiser_name: c['12'] ?? null,
      domain: c['14'] ?? null,
      format_code: c['4'] ?? null,
      format: GADS_FORMAT[c['4']] ?? null,
      first_shown: secs(c['6']),
      last_shown: secs(c['7']),
      days_shown: c['13'] ?? null,
      image_url: img,
      preview_url: body?.['1']?.['4'] ?? null,
      source_url: `https://adstransparency.google.com/advertiser/${adv}/creative/${cr}?region=IN`,
      raw: c,
    });
  }
  return { creatives: out, next: (json && json['2']) || null };
}

/* One creative's preview script (its preview_url) -> what the ad says. The script is the one
   Google's own page loads to draw the ad; it cannot be embedded elsewhere (it draws into a frame on
   Google's site), but the ad's content is written inside it in one of two ways:
     - Display and video ads: a `google_template_data: {'adData': [{ 'headline': '...', ... }]}`
       object - headline, body/description, call to action, image, logo, YouTube video id.
     - Text ads: an `ad=<base64>` parameter holding the ad as a protobuf. Two layouts are known,
       read off real samples (16 Oct 2026):
         search ad  15.8 headline, 15.9 display URL, 15.10 description, 15.31.3[].1 sitelinks
         local ad   2.1 headline, 2.2 description, 2.3 display domain, 2.4 business name,
                    2.5.1-6 place name and address, 2.6 call to action
   Only fields found at those exact places are returned. Anything else comes back null, and a
   script in neither form is reported as `error` (with the readable strings kept for a look later)
   rather than read by guesswork. */
const unescJs = (s: string) => {
  let p: string;
  do {
    p = s;
    s = s.replace(/\\x([0-9a-f]{2})/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
      .replace(/\\u([0-9a-f]{4})/gi, (_, h) => String.fromCharCode(parseInt(h, 16)));
  } while (s !== p);
  return s;
};
const ent = (s: string | null) => s == null ? null : s.replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').trim() || null;

type PNode = { f: number; s?: string; m?: PNode[] };
const utf8 = new TextDecoder('utf-8', { fatal: true });
function pbWalk(buf: Uint8Array, depth = 0): PNode[] {
  const out: PNode[] = []; let i = 0;
  const varint = () => { let r = 0, mul = 1; for (;;) { const b = buf[i++]; if (b === undefined) throw new Error('eof'); r += (b & 127) * mul; mul *= 128; if (!(b & 128)) return r; if (mul > 2 ** 63) throw new Error('varint'); } };
  while (i < buf.length) {
    const key = varint(); const f = Math.floor(key / 8), wt = key % 8;
    if (f === 0) throw new Error('field 0');
    if (wt === 0) { varint(); out.push({ f }); }
    else if (wt === 1) { i += 8; out.push({ f }); }
    else if (wt === 5) { i += 4; out.push({ f }); }
    else if (wt === 2) {
      const len = varint(); if (i + len > buf.length) throw new Error('length');
      const sub = buf.subarray(i, i + len); i += len;
      const n: PNode = { f };
      try { const s = utf8.decode(sub); if (!/[\x00-\x08\x0e-\x1f]/.test(s)) n.s = s; } catch (_) { /* not text */ }
      if (depth < 8 && len) { try { n.m = pbWalk(sub, depth + 1); } catch (_) { /* not a message */ } }
      out.push(n);
    } else throw new Error('wire type ' + wt);
  }
  return out;
}
// Every node at a dotted path ("15.31.3"), following nested messages.
function pbAll(nodes: PNode[] | undefined, path: number[]): PNode[] {
  if (!nodes) return [];
  const here = nodes.filter((n) => n.f === path[0]);
  return path.length === 1 ? here : here.flatMap((n) => pbAll(n.m, path.slice(1)));
}
const pbStr = (nodes: PNode[], path: number[]) => { const n = pbAll(nodes, path)[0]; return n && n.s != null ? ent(n.s) : null; };
function pbStrings(nodes: PNode[] | undefined, out: string[] = []) {
  for (const n of nodes || []) { if (n.m && n.m.length) pbStrings(n.m, out); else if (n.s && /[a-z]{3}/i.test(n.s) && n.s.length < 400) out.push(n.s); }
  return out;
}
const b64url = (s: string) => {
  const t = s.replace(/-/g, '+').replace(/_/g, '/'); const bin = atob(t + '==='.slice((t.length + 3) % 4));
  const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u;
};

export function gadsDetail(script: string) {
  const t = unescJs(script);
  const d: any = { ad_layout: null, ad_headline: null, ad_long_headline: null, ad_description: null, ad_display_url: null, ad_business: null, ad_cta: null, ad_image_url: null, ad_logo_url: null, video_id: null, video_duration: null, ad_extra: null, error: null };
  const extra: any = {};
  // 1) display / video template
  const ti = t.indexOf("google_template_data: {'adData': [{");
  if (ti >= 0) {
    const end = t.indexOf('}]}', ti);
    const seg = t.slice(ti, end > 0 ? end : ti + 20000);
    const kv: Record<string, string> = {};
    for (const m of seg.matchAll(/'([A-Za-z_]+)':\s*'((?:[^'\\]|\\.)*)'/g)) if (!(m[1] in kv)) kv[m[1]] = m[2].replace(/\\(.)/g, '$1');
    const g = (...ks: string[]) => { for (const k of ks) if (kv[k] && kv[k].trim()) return ent(kv[k]); return null; };
    d.ad_headline = g('headline');
    d.ad_long_headline = g('longHeadline');
    d.ad_description = g('body', 'description');
    d.ad_cta = g('callToAction', 'callToActionText');
    d.ad_business = g('advertiser', 'channelName');
    d.ad_image_url = g('image', 'marketingImage', 'landscapeImage', 'rectangleImage', 'squareImage');
    d.ad_logo_url = g('logo');
    const vid = g('video_videoId');
    if (vid && /^[A-Za-z0-9_-]{11}$/.test(vid)) d.video_id = vid;
    d.video_duration = g('videoDuration');
    d.ad_layout = d.video_id ? 'video' : 'display';
  }
  // 2) text ad protobuf
  const ads = new Set<string>();
  for (const m of t.matchAll(/(?:[?&]|%(?:25)*26)ad(?:=|%(?:25)*3D)([A-Za-z0-9_-]{20,})/g)) ads.add(m[1]);
  if (ads.size && !d.ad_layout) {
    extra.variations = ads.size;
    let nodes: PNode[] | null = null;
    try { nodes = pbWalk(b64url([...ads][0])); } catch (e) { d.error = 'text ad data could not be decoded: ' + (e as Error).message; }
    if (nodes) {
      if (pbAll(nodes, [15]).length && pbStr(nodes, [15, 8])) {
        d.ad_layout = 'search';
        d.ad_headline = pbStr(nodes, [15, 8]);
        d.ad_display_url = pbStr(nodes, [15, 9]);
        d.ad_description = pbStr(nodes, [15, 10]);
        const sl = pbAll(nodes, [15, 31, 3]).map((n) => n.m ? pbStr(n.m, [1]) : null).filter(Boolean);
        if (sl.length) extra.sitelinks = sl;
      } else if (pbAll(nodes, [2]).length && pbStr(nodes, [2, 1])) {
        d.ad_layout = 'local';
        d.ad_headline = pbStr(nodes, [2, 1]);
        d.ad_description = pbStr(nodes, [2, 2]);
        d.ad_display_url = pbStr(nodes, [2, 3]);
        d.ad_business = pbStr(nodes, [2, 4]);
        d.ad_cta = pbStr(nodes, [2, 6]);
        const place = pbStr(nodes, [2, 5, 1]);
        const addr = [3, 4, 5, 6].map((k) => pbStr(nodes!, [2, 5, k])).filter(Boolean);
        if (place) extra.place = place;
        if (addr.length) extra.address = addr.join(', ');
      } else {
        d.error = 'text ad in a layout not seen before - not read';
        extra.strings = pbStrings(nodes).slice(0, 30);
      }
    }
  }
  // 3) YouTube id written as a thumbnail address, when no template said it
  if (!d.video_id) {
    const ids = new Set([...t.matchAll(/ytimg\.com\/vi\/([A-Za-z0-9_-]{11})\//g)].map((m) => m[1]));
    if (ids.size === 1) { d.video_id = [...ids][0]; if (!d.ad_layout) d.ad_layout = 'video'; }
    else if (ids.size > 1) extra.video_ids = [...ids];
  }
  // 4) an image ad with nothing else: its picture only when the script holds exactly one
  if (!d.ad_layout) {
    const imgs = new Set([...t.matchAll(/https:\/\/tpc\.googlesyndication\.com\/(?:archive\/)?simgad\/(\d+)/g)].map((m) => m[0]));
    if (imgs.size === 1) { d.ad_image_url = [...imgs][0]; d.ad_layout = 'display'; }
    else if (imgs.size > 1) extra.images = [...imgs];
  }
  if (!d.ad_layout && !d.error) d.error = 'no ad content found in the preview script';
  if (d.ad_layout) d.error = null;
  if (Object.keys(extra).length) d.ad_extra = extra;
  return d;
}

// ---------------------------------------------------------------- WBRERA
const dmy = (s: string | null | undefined) => {
  const m = String(s || '').trim().match(/^(\d{2})-(\d{2})-(\d{4})$/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
};
const clean = (s: string) => s.replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ').replace(/&#0?39;/g, "'").replace(/\s+/g, ' ').trim();

// The district_project.php list: one <tr> per project, columns named by the table's own header.
export function reraList(html: string, listStatus: string) {
  const table = html.match(/<table[^>]*id="projectDataTable"[\s\S]*?<\/table>/i);
  if (!table) return { rows: [], header: [] as string[], error: 'project table not found on page' };
  const header = [...table[0].matchAll(/<th[^>]*>([\s\S]*?)<\/th>/gi)].map((m) => clean(m[1].replace(/<[^>]+>/g, '')).toLowerCase());
  const col = (re: RegExp) => header.findIndex((h) => re.test(h));
  const ix = { pid: col(/project id/), name: col(/project name/), comp: col(/completion/), regno: col(/registration no/), regdt: col(/registration date/), rej: col(/reject|revoke/) };
  if (ix.name < 0 || ix.pid < 0) return { rows: [], header, error: 'unexpected columns: ' + header.join(', ') };
  const rows: any[] = [];
  for (const tr of table[0].split(/<tr[\s>]/i).slice(1)) {
    const tds = [...tr.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((m) => m[1]);
    if (tds.length < header.length - 1) continue;
    // Approved rows link to the project page (procode); rejected/revoked rows carry no link.
    const procode = (tds[ix.name].match(/procode=(\d+)/) || [])[1] || null;
    if (!procode && listStatus === 'approved') continue;
    const txt = (i: number) => (i >= 0 && tds[i] != null ? clean(tds[i].replace(/<[^>]+>/g, '')) : null);
    rows.push({
      procode,
      project_id: txt(ix.pid),
      name: txt(ix.name),
      completion_date: dmy(txt(ix.comp)),
      reg_no: txt(ix.regno),
      reg_date: dmy(txt(ix.regdt)),
      rejected_date: dmy(txt(ix.rej)),
      list_status: listStatus,
    });
  }
  return { rows, header, error: rows.length ? null : 'no project rows parsed' };
}

// project_details.php: the page is turned into "cell | cell | cell" text and read by its labels.
export function reraDetail(html: string) {
  const t = html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' | ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/(\s*\|\s*)+/g, ' | ');
  if (!/Project Information/i.test(t)) return { error: 'no "Project Information" section on page' } as any;
  const cell = (label: string, from = 0) => {
    const i = t.indexOf(label, from); if (i < 0) return null;
    const rest = t.slice(i + label.length).replace(/^\s*\|?\s*:?\s*\|?\s*/, '');
    const v = rest.split('|')[0].trim();
    return v && v !== ':' ? v : null;
  };
  const num = (s: string | null) => { const m = String(s || '').replace(/,/g, '').match(/[\d.]+/); return m ? Number(m[0]) : null; };
  const info = t.indexOf('Project Information');
  const pd = t.indexOf('Promoter Details');
  const after = (re: RegExp, from: number) => { if (from < 0) return null; const m = t.slice(from).match(re); return m ? m[1].trim() : null; };
  let litig: string | null = null;
  const li = t.indexOf('| Sl No. | Litigations |');
  if (li >= 0) {
    const end = t.indexOf('Projects in West Bengal', li);
    litig = t.slice(li + '| Sl No. | Litigations |'.length, end > 0 ? end : li + 600).replace(/\s*\|\s*/g, ' ').trim() || null;
  }
  const d: any = {
    project_id: cell('Project ID', info),
    name: cell('Project Name', info),
    address: cell('Project Address', info),
    district: cell('District', info),
    block: cell('Block/Municipality', info),
    police_station: cell('Police Station', info),
    pincode: cell('Pincode', info),
    project_status: after(/PROJECT STATUS -\s*\|\s*([^|]+)/, 0),
    completion_date: dmy(after(/PROJECT COMPLETION DATE:\s*([^|]+)/, 0)),
    extension_date: after(/EXTENSION COMPLETION DATE:\s*([^|]+)/, 0),
    project_type: cell('Project Type', info),
    land_area_sqm: num(cell('Land Area', info)),
    built_area_sqm: num(cell('Total Built Up Area:', info) || cell('Super Built Area', info)),
    carpet_area_sqm: num(cell('Carpet Area', info)),
    apartments: num(cell('No. of Apartments:', info)),
    open_parking: cell('Open Car Parking', info),
    covered_parking: cell('Covered Car Parking', info),
    website: cell('Website', info),
    promoter_name: pd >= 0 ? after(/^\s*\|\s*Personal Information\s*\|\s*([^|]+)/, pd + 'Promoter Details'.length) : null,
    promoter_type: after(/Company Type\s*:\s*([^|]+)/, pd),
    promoter_address: after(/Address\s*:\s*([^|]+)/, pd),
    promoter_cin: after(/Registration No\.\s*:\s*([^|]+)/, pd),
    promoter_website: after(/Website:\s*\|\s*([^|]+)/, pd),
    litigations: litig,
  };
  if (d.apartments != null) d.apartments = Math.round(d.apartments);
  return d;
}

// ---------------------------------------------------------------- Google Trends
// multiline widget reply -> one point per term per week.
export function trendsPoints(text: string, terms: string[]) {
  const j = JSON.parse(text.slice(text.indexOf('{')));
  const out: any[] = [];
  for (const p of j?.default?.timelineData || []) {
    const week = new Date(Number(p.time) * 1000).toISOString().slice(0, 10);
    terms.forEach((term, i) => {
      const has = !!(p.hasData && p.hasData[i]);
      out.push({ term, week_start: week, value: has ? Number(p.value[i]) : null, has_data: has });
    });
  }
  return out;
}
