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
