// Prototype: West Bengal "Market Value of Apartment" by direct form requests (no browser).
// Portable to Deno: uses only fetch, URL, URLSearchParams.
import { legacyFetch } from "./legacy-fetch.mjs";
const fetch = legacyFetch;
const BASE = 'https://wbregistration.gov.in';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0 Safari/537.36';

export const PROJECTS = {
  'Dream World City': { district: 'South 24-Parganas', thana: 'Bishnupur', mouza: 'Amgachhia', road: null, roadZone: null,
    plotType: 'LR', plotNo: '00266', ageOfFlat: '1', isPropertyOnRoad: 'No', widthOfApproachRoad: '20' },
  'Dream Gurukul': { district: 'North 24-Parganas', thana: 'Barasat', mouza: 'Doharia', road: 'Jessore Rd [BARASAT (A.D.S.R.)]',
    roadZone: '1 -- Airport to Madhyagram Crossing On Road', plotType: 'LR', plotNo: '01165',
    ageOfFlat: '0', isPropertyOnRoad: 'Yes', widthOfApproachRoad: null },
};

const decode = (s) => String(s).replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ');
const attr = (tag, name) => { const m = tag.match(new RegExp('\\s' + name + '\\s*=\\s*"([^"]*)"', 'i')); return m ? decode(m[1]) : null; };
const hasAttr = (tag, name) => new RegExp('\\s' + name + '(\\s*=|\\s|>|/)', 'i').test(tag);

// What a browser would submit from this page: every enabled, named control's current value.
export function readForm(html) {
  const fields = new Map(), selects = {};
  for (const m of html.matchAll(/<input\b[^>]*>/gi)) {
    const t = m[0], name = attr(t, 'name'); if (!name || hasAttr(t, 'disabled')) continue;
    const type = (attr(t, 'type') || 'text').toLowerCase();
    if (['submit', 'image', 'button', 'reset', 'file'].includes(type)) continue;
    if ((type === 'checkbox' || type === 'radio') && !hasAttr(t, 'checked')) continue;
    fields.set(name, attr(t, 'value') ?? (type === 'checkbox' ? 'on' : ''));
  }
  for (const m of html.matchAll(/<select\b([^>]*)>([\s\S]*?)<\/select>/gi)) {
    const t = '<select' + m[1] + '>', name = attr(t, 'name'); if (!name) continue;
    const opts = [...m[2].matchAll(/<option\b([^>]*)>([\s\S]*?)<\/option>/gi)]
      .map((o) => ({ value: attr('<o' + o[1] + '>', 'value') ?? decode(o[2]).trim(), label: decode(o[2]).replace(/\s+/g, ' ').trim(),
                     selected: hasAttr('<o' + o[1] + '>', 'selected') }));
    selects[name] = { disabled: hasAttr(t, 'disabled'), opts };
    if (hasAttr(t, 'disabled')) continue;
    const sel = opts.find((o) => o.selected) || opts[0];
    if (sel) fields.set(name, sel.value);
  }
  for (const m of html.matchAll(/<textarea\b([^>]*)>([\s\S]*?)<\/textarea>/gi)) {
    const t = '<t' + m[1] + '>', name = attr(t, 'name'); if (name && !hasAttr(t, 'disabled')) fields.set(name, decode(m[2]));
  }
  return { fields, selects };
}

const P = (n) => 'ctl00$CPH$' + n;

export async function marketValue(input, log = () => {}) {
  const cfg = PROJECTS[input.project];
  if (!cfg) throw new Error(`unknown project "${input.project}"`);
  for (const k of ['carpetArea', 'buildupArea', 'floor', 'flatNo']) if (input[k] == null || input[k] === '') throw new Error(`missing ${k}`);

  // 1. The form. The site keeps its session in the address ("(S(...))"), so the address the first
  //    request lands on is the one every later request must use.
  let r = await fetch(BASE + '/MV/mv_aprt.aspx', { headers: { 'User-Agent': UA }, redirect: 'follow' });
  if (!r.ok) throw new Error(`form: HTTP ${r.status}`);
  const url = r.url;
  let html = await r.text();
  let form = readForm(html);
  // A browser also loads the CAPTCHA image (../CImage.aspx), which sets a session value the submit
  // handler reads. The typed text is not checked, but without the image request the final submit
  // 302s to MV/index.aspx -> error page ("Website Moved").
  if (!process.env.MV_NO_CIMAGE) {
    const ci = await fetch(new URL('../CImage.aspx', url).toString(), { headers: { 'User-Agent': UA, Referer: url } });
    if (!ci.ok) throw new Error(`captcha image: HTTP ${ci.status}`);
  }
  const want = new Map();   // values we have decided, re-applied on every request

  const optionValue = (name, label, re) => {
    const s = form.selects[P(name)];
    if (!s) throw new Error(`no field ${name}`);
    const o = s.opts.find((x) => re ? re.test(x.label) : x.label === label);
    if (!o) throw new Error(`${name}: no option "${label || re}" (have: ${s.opts.slice(0, 8).map((x) => x.label).join(' | ')})`);
    return o.value;
  };
  async function post(target, extra = {}) {
    const body = new URLSearchParams();
    for (const [k, v] of form.fields) body.set(k, v);
    for (const [k, v] of want) body.set(k, v);
    for (const [k, v] of Object.entries(extra)) body.set(k, v);
    body.set('__EVENTTARGET', target || ''); body.set('__EVENTARGUMENT', '');
    if (process.env.MV_BODY_DUMP && !target) (await import('fs')).writeFileSync(process.env.MV_BODY_DUMP, body.toString());
    const res = await fetch(url, { method: 'POST', headers: { 'User-Agent': UA, 'Content-Type': 'application/x-www-form-urlencoded', Referer: url },
      body: body.toString(), redirect: 'follow' });
    if (!res.ok) throw new Error(`${target || 'submit'}: HTTP ${res.status}`);
    html = await res.text(); form = readForm(html);
    log(target || 'submit', html.length);
    return html;
  }
  async function choose(name, label, re) { want.set(P(name), optionValue(name, label, re)); await post(P(name)); }
  const set = (name, v) => want.set(P(name), String(v));

  await choose('DDL_District', cfg.district);
  await choose('DDL_Thana', cfg.thana);
  await choose('DDL_Mouza', cfg.mouza);
  if (cfg.road) await choose('DDL_Road', cfg.road);
  if (cfg.roadZone) want.set(P('DDL_Zone'), optionValue('DDL_Zone', cfg.roadZone));
  want.set(P('DDL_plot_code_type'), optionValue('DDL_plot_code_type', cfg.plotType));
  set('txt_plot_no', String(cfg.plotNo).padStart(5, '0'));
  await choose('DDL_use_of_flat', 'Residential');
  want.set(P('DDL_floor_type'), optionValue('DDL_floor_type', 'Marble'));
  set('txtCarpetArea', input.carpetArea); await post(P('txtCarpetArea'));
  set('txt_covered_area', String(Math.round(Number(input.buildupArea)))); await post(P('txt_covered_area'));
  if (input.superBuildupArea != null) { set('txt_build_area', input.superBuildupArea); await post(P('txt_build_area')); }
  set('txt_floor_location', input.floor); set('txt_flat_no', input.flatNo); set('txt_flat_age', cfg.ageOfFlat);
  await choose('DDL_Litigeted', 'No');
  await choose('DDL_property_on_road', cfg.isPropertyOnRoad);
  if (cfg.widthOfApproachRoad) set('txt_width_of_road', cfg.widthOfApproachRoad);
  await choose('DDL_encumbered_by_tenant', 'No');
  if (form.selects[P('DDL_Tenant_Purchaser')] && !form.selects[P('DDL_Tenant_Purchaser')].disabled)
    want.set(P('DDL_Tenant_Purchaser'), optionValue('DDL_Tenant_Purchaser', 'No'));
  set('txtNoOfFloor', '8'); await post(P('txtNoOfFloor'));
  for (const cb of ['CB_Swimming_Pool', 'CB_Club_Facility', 'CB_Gymnasium']) set(cb, 'on');
  // Project Name last - earlier postbacks can refill it.
  await choose('DDL_project_name', null, /^not (available|specified)$/i);
  await post('', { [P('btn_Display')]: 'Display Market Value' });
  if (process.env.MV_DUMP) (await import('fs')).writeFileSync(process.env.MV_DUMP, html);

  const text = decode(html.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ');
  const m = text.match(/Market Value of Apartment\s*:-?\s*Rs\.?\s*([\d,]+)/i);
  if (!m) {
    const err = text.match(/[^.]{0,120}(should be|must be|please|invalid)[^.]{0,120}/i);
    throw new Error('no value on result page' + (err ? ': ' + err[0].trim() : ''));
  }
  return { value: parseInt(m[1].replace(/,/g, ''), 10), resultLine: m[0] };
}

// CLI: node mv-fetch.mjs '<json input>'
if (process.argv[2] && /mv-fetch\.mjs$/.test(process.argv[1] || '')) {
  const input = JSON.parse(process.argv[2]);
  marketValue(input, (t, n) => console.error('  step', t, n))
    .then((r) => console.log(JSON.stringify(r)))
    .catch((e) => { console.log(JSON.stringify({ error: String(e.message || e) })); process.exitCode = 1; });
}
