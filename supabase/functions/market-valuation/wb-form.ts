// West Bengal "Market Value of Apartment" by direct requests to the old ASP.NET form
// (https://wbregistration.gov.in/MV/mv_aprt.aspx) - no browser. Port of
// tools/market-valuation-direct/mv-fetch.mjs, which matched 19 of 19 comparable stored values.
//
// Site quirks this relies on (each verified against the live site):
// - The server sends only its own certificate, not the GlobalSign intermediate, so a strict client
//   reports "UnknownIssuer". The intermediate is bundled below (valid to 21 May 2027). If the site
//   moves to a different intermediate, the connection fails loudly - nothing is guessed.
// - The session lives in the address ("/(S(...))/MV/mv_aprt.aspx"); every request must reuse it.
// - The CAPTCHA image (../CImage.aspx) must be requested once per session. The typed text is never
//   checked, but without the image request the final submit 302s to MV/index.aspx -> an error page
//   that reads "Website Moved".
// - Covered/Buildup area must be an integer; Project Name must be set last (earlier postbacks refill
//   it); the "none" option is "Not Available" or " Not Specified" depending on the plot.
// - No. of floors in building must be >= the flat's floor ("must be greater or equal").

const GLOBALSIGN_GCC_R6_ALPHASSL_CA_2025 = `-----BEGIN CERTIFICATE-----
MIIFjTCCA3WgAwIBAgIRAIN9TriekS/nLK07x2kt3CAwDQYJKoZIhvcNAQELBQAw
TDEgMB4GA1UECxMXR2xvYmFsU2lnbiBSb290IENBIC0gUjYxEzARBgNVBAoTCkds
b2JhbFNpZ24xEzARBgNVBAMTCkdsb2JhbFNpZ24wHhcNMjUwNTIxMDIzNjUyWhcN
MjcwNTIxMDAwMDAwWjBVMQswCQYDVQQGEwJCRTEZMBcGA1UEChMQR2xvYmFsU2ln
biBudi1zYTErMCkGA1UEAxMiR2xvYmFsU2lnbiBHQ0MgUjYgQWxwaGFTU0wgQ0Eg
MjAyNTCCASIwDQYJKoZIhvcNAQEBBQADggEPADCCAQoCggEBAJ/oiu0Bviq52UUE
ADbFWmgu3rC7KDSMoorLN1Wd03McG3Z1aP71DlPCE33838r72Dfuj5M9LXfiQLJp
Au6MwNExmKOzothw4x0zGf5oBYyrCMGm3fBpLPafwYQ3MchBOWMTbf83rKUPLH48
KCJ0MnU8GUl8oA/J81wIvbbKPuNrFf6hvJDccjzc4NyxLz3A89zjV2g5whCg5O0u
9YX4Zxk9JHuc/LvllOJO4waAYLjbWBJkz3rV3ts1SmSYnJqmyRTIjXwQgRvhEYqt
DbRskt0W7M6cPwCze3GTBN2UHNpHkMs3YmVxku68I0aOQn5+uz//fDROP3z1Z/7I
APteRtECAwEAAaOCAV8wggFbMA4GA1UdDwEB/wQEAwIBhjAdBgNVHSUEFjAUBggr
BgEFBQcDAQYIKwYBBQUHAwIwEgYDVR0TAQH/BAgwBgEB/wIBADAdBgNVHQ4EFgQU
xbSTj28r3B5Iv7cQMIXO0bK7SC0wHwYDVR0jBBgwFoAUrmwFo5MT4qLn4tcc1sfw
f8hnU6AwewYIKwYBBQUHAQEEbzBtMC4GCCsGAQUFBzABhiJodHRwOi8vb2NzcDIu
Z2xvYmFsc2lnbi5jb20vcm9vdHI2MDsGCCsGAQUFBzAChi9odHRwOi8vc2VjdXJl
Lmdsb2JhbHNpZ24uY29tL2NhY2VydC9yb290LXI2LmNydDA2BgNVHR8ELzAtMCug
KaAnhiVodHRwOi8vY3JsLmdsb2JhbHNpZ24uY29tL3Jvb3QtcjYuY3JsMCEGA1Ud
IAQaMBgwCAYGZ4EMAQIBMAwGCisGAQQBoDIKAQMwDQYJKoZIhvcNAQELBQADggIB
AB/uvBuZf4CiuSahwiXn4geF52roAH+6jxsEPTXTfb7bbeMDXsYgRRsOTNA70ruZ
Tnz5DfFMuBhNoFhIFb0qR1izdy6VkdKOqFPNF2dOFI1EcnY9l2ory9mrzHqVbrL4
vzUd17FLUVyjTVU7PAv4nxyhnO1GTeT83YlrdRF31NyR6bvZVTEERHmpbWSgeveJ
LRtaMzlGWiLZ8IwkH7o6GH3jp/KPtDW4Npu8w64HrRZdN2pqQhi7+YKwfHM7H+2U
dM1BGN0sjOWMVbMSB9MtCsleS2Mb7TRZEbOHxECJLLIluQypZr7Pol3+hAqrhyKI
k+6y+Da0NeDuWxW59Ku4NvClqW1UFX1SpfNGhzVfp/CH+vPM1tySomx2jE0EnYZu
GwVucXPBsp5nUWqUV9+143glVuS7GTg9hFPjNBInn17HbCoIIQIOzj5Vd9bK3A9U
GxXNpwenDHEalCsD/4eQYDHPhFE7sNe0D/OXu+FAM02VZkARx37Jp4bDdujvgL9P
vZPR3wThvDN1CTU8Bc3xea3yKFAraKcPZLkhReQUAm2VpR+HSJRPlUpYizlF9WkL
h3KcAVCBJWvnOkVwxyU5QJMcnwW95JlOtx+9100GL99jHE5rs3gXp7F4bg8H01QT
9jVOhBBmQ7nQoXuwI0tqal2QUqZz3eeu62CU7xBwtfYR
-----END CERTIFICATE-----`;

const BASE = 'https://wbregistration.gov.in';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0 Safari/537.36';

type Project = {
  district: string; thana: string; mouza: string; road: string | null; roadZone: string | null;
  plotType: string; plotNo: string; ageOfFlat: string; isPropertyOnRoad: 'Yes' | 'No';
  widthOfApproachRoad: string | null; floorsInBuilding: number;
};

// Fixed per-project answers - same as tools/jaine-automation-extension/lib/market-valuation-automation.js.
// floorsInBuilding = the extension's fixed "8". Flats above it are refused (see marketValue) until the
// real tower floor counts are confirmed - never guessed.
export const PROJECTS: Record<string, Project> = {
  'Dream World City': {
    district: 'South 24-Parganas', thana: 'Bishnupur', mouza: 'Amgachhia', road: null, roadZone: null,
    plotType: 'LR', plotNo: '00266', ageOfFlat: '1', isPropertyOnRoad: 'No', widthOfApproachRoad: '20', floorsInBuilding: 8,
  },
  'Dream Gurukul': {
    district: 'North 24-Parganas', thana: 'Barasat', mouza: 'Doharia', road: 'Jessore Rd [BARASAT (A.D.S.R.)]',
    // The site spells it "Madhyagram" - the usual spelling silently fails to match.
    roadZone: '1 -- Airport to Madhyagram Crossing On Road', plotType: 'LR', plotNo: '01165',
    ageOfFlat: '0', isPropertyOnRoad: 'Yes', widthOfApproachRoad: null, floorsInBuilding: 8,
  },
};

export type MvInput = { project: string; carpetArea: number | string; buildupArea: number | string;
  superBuildupArea?: number | string | null; floor: number; flatNo: string };

const decode = (s: string) => String(s).replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ');
const attr = (tag: string, name: string) => { const m = tag.match(new RegExp('\\s' + name + '\\s*=\\s*"([^"]*)"', 'i')); return m ? decode(m[1]) : null; };
const hasAttr = (tag: string, name: string) => new RegExp('\\s' + name + '(\\s*=|\\s|>|/)', 'i').test(tag);

type Opt = { value: string; label: string; selected: boolean };
// What a browser would submit from this page: every enabled, named control's current value.
function readForm(html: string) {
  const fields = new Map<string, string>(), selects: Record<string, { disabled: boolean; opts: Opt[] }> = {};
  for (const m of html.matchAll(/<input\b[^>]*>/gi)) {
    const t = m[0], name = attr(t, 'name'); if (!name || hasAttr(t, 'disabled')) continue;
    const type = (attr(t, 'type') || 'text').toLowerCase();
    if (['submit', 'image', 'button', 'reset', 'file'].includes(type)) continue;
    if ((type === 'checkbox' || type === 'radio') && !hasAttr(t, 'checked')) continue;
    fields.set(name, attr(t, 'value') ?? (type === 'checkbox' ? 'on' : ''));
  }
  for (const m of html.matchAll(/<select\b([^>]*)>([\s\S]*?)<\/select>/gi)) {
    const t = '<select' + m[1] + '>', name = attr(t, 'name'); if (!name) continue;
    const opts = [...m[2].matchAll(/<option\b([^>]*)>([\s\S]*?)<\/option>/gi)].map((o) => ({
      value: attr('<o' + o[1] + '>', 'value') ?? decode(o[2]).trim(), label: decode(o[2]).replace(/\s+/g, ' ').trim(),
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

// fetch with this site's needs: the bundled intermediate, a cookie jar, and redirects followed by hand
// (so the cookie jar sees every hop and the final address - which carries the session - is known).
function session() {
  const client = Deno.createHttpClient({ caCerts: [GLOBALSIGN_GCC_R6_ALPHASSL_CA_2025] });
  const jar = new Map<string, string>();
  async function go(url: string, init: { method?: string; body?: string; headers?: Record<string, string> } = {}, hops = 0): Promise<{ url: string; status: number; text: string }> {
    const headers: Record<string, string> = { 'User-Agent': UA, ...(init.headers || {}) };
    if (jar.size) headers.Cookie = [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
    const res = await fetch(url, { method: init.method || 'GET', body: init.body, headers, redirect: 'manual', client } as RequestInit);
    for (const c of res.headers.getSetCookie?.() || []) { const kv = c.split(';')[0]; const i = kv.indexOf('='); if (i > 0) jar.set(kv.slice(0, i).trim(), kv.slice(i + 1).trim()); }
    const loc = res.headers.get('location');
    if ([301, 302, 303, 307].includes(res.status) && loc) {
      await res.body?.cancel();
      if (hops >= 6) throw new Error('too many redirects');
      const next = new URL(loc, url).toString();
      return go(next, res.status === 307 ? init : { headers: init.headers }, hops + 1);
    }
    return { url, status: res.status, text: await res.text() };
  }
  return { go, close: () => client.close() };
}

const P = (n: string) => 'ctl00$CPH$' + n;

/** Fills and submits the form for one flat. Returns the site's value; throws on anything unexpected. */
export async function marketValue(input: MvInput, log: (step: string, n: number) => void = () => {}) {
  const cfg = PROJECTS[input.project];
  if (!cfg) throw new Error(`unknown project "${input.project}"`);
  for (const k of ['carpetArea', 'buildupArea', 'floor', 'flatNo'] as const) {
    if (input[k] == null || input[k] === '') throw new Error(`missing ${k}`);
  }
  if (!Number.isInteger(input.floor) || input.floor < 0) throw new Error(`floor must be a whole number, got ${input.floor}`);
  if (input.floor > cfg.floorsInBuilding) {
    throw new Error(`floor ${input.floor} is above the ${cfg.floorsInBuilding} floors configured for ${input.project} - the building's real floor count is needed`);
  }

  const s = session();
  try {
    let r = await s.go(BASE + '/MV/mv_aprt.aspx');
    if (r.status !== 200) throw new Error(`form: HTTP ${r.status}`);
    const url = r.url;
    if (!/\/\(S\([a-z0-9]+\)\)\/MV\/mv_aprt\.aspx$/i.test(url)) throw new Error(`form: unexpected address ${url}`);
    let html = r.text;
    let form = readForm(html);
    const ci = await s.go(new URL('../CImage.aspx', url).toString(), { headers: { Referer: url } });
    if (ci.status !== 200) throw new Error(`captcha image: HTTP ${ci.status}`);
    const want = new Map<string, string>();   // values decided so far, re-applied on every request

    const optionValue = (name: string, label: string | null, re?: RegExp) => {
      const sel = form.selects[P(name)];
      if (!sel) throw new Error(`no field ${name}`);
      const o = sel.opts.find((x) => re ? re.test(x.label) : x.label === label);
      if (!o) throw new Error(`${name}: no option "${label || re}" (have: ${sel.opts.slice(0, 8).map((x) => x.label).join(' | ')})`);
      return o.value;
    };
    const post = async (target: string, extra: Record<string, string> = {}) => {
      const body = new URLSearchParams();
      for (const [k, v] of form.fields) body.set(k, v);
      for (const [k, v] of want) body.set(k, v);
      for (const [k, v] of Object.entries(extra)) body.set(k, v);
      body.set('__EVENTTARGET', target); body.set('__EVENTARGUMENT', '');
      r = await s.go(url, { method: 'POST', body: body.toString(),
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', Referer: url, Origin: BASE } });
      if (r.status !== 200) throw new Error(`${target || 'submit'}: HTTP ${r.status}`);
      if (r.url !== url) throw new Error(`${target || 'submit'}: site redirected to ${r.url.replace(BASE, '')} (session rejected)`);
      html = r.text; form = readForm(html);
      log(target || 'submit', html.length);
    };
    const choose = async (name: string, label: string | null, re?: RegExp) => { want.set(P(name), optionValue(name, label, re)); await post(P(name)); };
    const set = (name: string, v: unknown) => want.set(P(name), String(v));

    await choose('DDL_District', cfg.district);
    await choose('DDL_Thana', cfg.thana);
    await choose('DDL_Mouza', cfg.mouza);
    if (cfg.road) await choose('DDL_Road', cfg.road);
    if (cfg.roadZone) want.set(P('DDL_Zone'), optionValue('DDL_Zone', cfg.roadZone));
    want.set(P('DDL_plot_code_type'), optionValue('DDL_plot_code_type', cfg.plotType));
    set('txt_plot_no', cfg.plotNo.padStart(5, '0'));
    await choose('DDL_use_of_flat', 'Residential');
    want.set(P('DDL_floor_type'), optionValue('DDL_floor_type', 'Marble'));
    set('txtCarpetArea', input.carpetArea); await post(P('txtCarpetArea'));
    set('txt_covered_area', Math.round(Number(input.buildupArea))); await post(P('txt_covered_area'));
    if (input.superBuildupArea != null && input.superBuildupArea !== '') { set('txt_build_area', input.superBuildupArea); await post(P('txt_build_area')); }
    set('txt_floor_location', input.floor); set('txt_flat_no', input.flatNo); set('txt_flat_age', cfg.ageOfFlat);
    await choose('DDL_Litigeted', 'No');
    await choose('DDL_property_on_road', cfg.isPropertyOnRoad);
    if (cfg.widthOfApproachRoad) set('txt_width_of_road', cfg.widthOfApproachRoad);
    await choose('DDL_encumbered_by_tenant', 'No');
    const tp = form.selects[P('DDL_Tenant_Purchaser')];
    if (tp && !tp.disabled) want.set(P('DDL_Tenant_Purchaser'), optionValue('DDL_Tenant_Purchaser', 'No'));
    set('txtNoOfFloor', cfg.floorsInBuilding); await post(P('txtNoOfFloor'));
    for (const cb of ['CB_Swimming_Pool', 'CB_Club_Facility', 'CB_Gymnasium']) set(cb, 'on');
    await choose('DDL_project_name', null, /^not (available|specified)$/i);
    await post('', { [P('btn_Display')]: 'Display Market Value' });

    const text = decode(html.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ');
    const m = text.match(/Market Value of Apartment\s*:-?\s*Rs\.?\s*([\d,]+)/i);
    if (!m) {
      const err = text.match(/[^.]{0,120}(should be|must be|please|invalid)[^.]{0,120}/i);
      throw new Error('no value on result page' + (err ? ': ' + err[0].trim() : ''));
    }
    const value = parseInt(m[1].replace(/,/g, ''), 10);
    if (!Number.isFinite(value) || value <= 0) throw new Error(`unusable value "${m[1]}"`);
    return { value, resultLine: m[0] };
  } finally {
    s.close();
  }
}
