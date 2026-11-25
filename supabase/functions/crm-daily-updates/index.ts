// DAILY CRM UPDATES FROM THE CRM'S API (19 Nov 2026, Ayush: "check this is how the CRM Updates is made in CRM & Sales -
// make it through this"). Until now a scheduled cloud task logged in to RealtyBucket with a headless browser, read the
// "source wise leads" report page for 8 projects x 2 date ranges, wrote acc.crm_daily_updates (the CRM & Sales -> Daily
// Updates tab) and emailed an xlsx. RealtyBucket's source_wise_absolute_api gives the same table as JSON for all projects
// in one call - checked against the rows the browser task wrote for 18 Nov: every property, every source, equal.
// So: no browser, no password, two calls per day (month to date, and the day itself).
//
// The rules are the browser task's, unchanged:
//   - Qualified / Visits = the top-level sources Online, Other Project Campaign, Hoarding, Newspaper, Kiosk ("Online +"
//     counts as Online; names with "(" are skipped); Agent read separately; everything else (Walk In, Reference ...) is out.
//   - Month = 1st of the report date's month -> report date (the 1st itself: that one day); Yesterday = report date.
//   - 8 properties + a Total row, upserted on (report_date, property_key); the xlsx (Total by =SUM) and the email
//     (fixed recipients, in crm-daily-report-mailer) exactly as before.
//   - Catch-up: every date after the last one written, up to yesterday (31 at most).
//
// MODE (acc.job_secrets 'crm_daily_updates_mode'): 'shadow' (the default) writes and sends nothing - it reads the API
// for the last date the browser task wrote and records in acc.crm_daily_updates_runs whether every figure matches.
// 'live' does the whole job. Switch to live only once the old browser task is switched off, or the team gets two emails.
// Who may call: the cron (x-ads-secret = acc.job_secrets 'ads_daily').
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.47.10";
import { zipSync, strToU8 } from "https://esm.sh/fflate@0.8.2";

const SB = Deno.env.get("SUPABASE_URL")!, SRV = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON = Deno.env.get("SUPABASE_ANON_KEY") || "";
const db = createClient(SB, SRV), ACC = db.schema("acc");
const API = "https://www.realtybucket.com/report/source_wise_absolute_api";
const j = (o: unknown, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { "Content-Type": "application/json" } });

const PROPS = [
  { key: "world_city", label: "World City", pid: 3, sort: 4 },
  { key: "gurukul", label: "Gurukul", pid: 70, sort: 5 },
  { key: "one", label: "One", pid: 2, sort: 6 },
  { key: "eco_city", label: "Eco City", pid: 5, sort: 7 },
  { key: "valley", label: "Valley", pid: 6, sort: 8 },
  { key: "exotica", label: "Exotica", pid: 4, sort: 9 },
  { key: "ecocity_bungalow", label: "Ecocity Bungalows", pid: 68, sort: 10 },
  { key: "new_project", label: "New Project", pid: 171, sort: 11 },
];
const COUNTED = ["Online", "Hoarding", "Other Project Campaign", "Newspaper", "Kiosk"];

const istToday = () => new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);
const addD = (d: string, n: number) => new Date(Date.parse(d + "T00:00:00Z") + n * 86400_000).toISOString().slice(0, 10);

async function secret(name: string) { const { data } = await ACC.from("job_secrets").select("value").eq("name", name).maybeSingle(); return (data && data.value) || ""; }
async function readApi(from: string, to: string) {
  let last = "";
  for (let i = 0; i < 3; i++) {
    try {
      const r = await fetch(`${API}?from=${from}&to=${to}`); const t = await r.json().catch(() => null);
      if (r.ok && t && Array.isArray(t.projects)) return t;
      last = "HTTP " + r.status;
    } catch (e) { last = String((e as Error).message || e); }
    await new Promise((res) => setTimeout(res, 5000));
  }
  throw new Error(`CRM API ${from}..${to}: ${last}`);
}
const nm = (s: string) => String(s || "").replace(/\s*\+\s*$/, "").trim();

// one property's figures for one range, the browser task's way
function figures(api: any, pid: number) {
  const p = (api.projects || []).find((x: any) => Number(x.business_unit_id) === pid);
  // l = leads (added to the CRM report 23 Nov 2026), counted by the same source rules as Qualified
  const out: any = { l: 0, q: 0, v: 0, aq: 0, av: 0, src: {} as Record<string, { q: number; v: number }>, pageQ: 0, pageV: 0, excluded: [] as any[] };
  for (const s of (p && p.sources) || []) {
    const name = nm(s.source), q = Number(s.total?.qualified) || 0, v = Number(s.total?.site_visited) || 0, l = Number(s.total?.leads) || 0;
    out.pageQ += q; out.pageV += v;
    if (name.includes("(")) { out.excluded.push({ source: name, q, v }); continue; }
    if (/^agent/i.test(name)) { out.aq += q; out.av += v; out.src.Agent = { q: (out.src.Agent?.q || 0) + q, v: (out.src.Agent?.v || 0) + v }; out.excluded.push({ source: name, q, v }); continue; }
    if (COUNTED.includes(name)) { out.l += l; out.q += q; out.v += v; out.src[name] = { q: (out.src[name]?.q || 0) + q, v: (out.src[name]?.v || 0) + v }; continue; }
    out.excluded.push({ source: name, q, v });
  }
  return out;
}

async function rowsFor(date: string) {
  const first = date.slice(0, 8) + "01", mFrom = date.slice(8) === "01" ? date : first;
  const [M, Y] = await Promise.all([readApi(mFrom, date), readApi(date, date)]);
  const rows: any[] = []; const tot = { ml: 0, yl: 0, mq: 0, yq: 0, mv: 0, yv: 0, amv: 0, ayv: 0 };
  for (const P of PROPS) {
    const m = figures(M, P.pid), y = figures(Y, P.pid);
    const bd: any = {};
    for (const s of COUNTED.concat(["Agent"])) bd[s] = { month: { q: m.src[s]?.q ?? (s === "Agent" ? 0 : null), v: m.src[s]?.v ?? (s === "Agent" ? 0 : null) },
      yesterday: { q: y.src[s]?.q ?? (s === "Agent" ? 0 : null), v: y.src[s]?.v ?? (s === "Agent" ? 0 : null) } };
    const r = { report_date: date, property_key: P.key, property_label: P.label, realtybucket_project_id: P.pid, sort_order: P.sort, is_total: false,
      month_leads: m.l, yesterday_leads: y.l, month_qualified: m.q, yesterday_qualified: y.q, month_visits: m.v, yesterday_visits: y.v, agent_month_visits: m.av, agent_yesterday_visits: y.av,
      source_breakdown: bd,
      verification: { source: "source_wise_absolute_api", month: { from: mFrom, to: date, pageTotalQ: m.pageQ, pageTotalV: m.pageV, excluded: m.excluded },
        yesterday: { from: date, to: date, pageTotalQ: y.pageQ, pageTotalV: y.pageV, excluded: y.excluded } },
      run_at: new Date().toISOString() };
    rows.push(r);
    tot.ml += m.l; tot.yl += y.l; tot.mq += m.q; tot.yq += y.q; tot.mv += m.v; tot.yv += y.v; tot.amv += m.av; tot.ayv += y.av;
  }
  rows.push({ report_date: date, property_key: "total", property_label: "Total", realtybucket_project_id: null, sort_order: 12, is_total: true,
    month_leads: tot.ml, yesterday_leads: tot.yl, month_qualified: tot.mq, yesterday_qualified: tot.yq, month_visits: tot.mv, yesterday_visits: tot.yv, agent_month_visits: tot.amv, agent_yesterday_visits: tot.ayv,
    source_breakdown: null, verification: null, run_at: new Date().toISOString() });
  return { rows, mFrom };
}

/* THE XLSX, written by hand (no spreadsheet library runs reliably here): one sheet "CRM Updates", Arial, a bold title,
   an italic date line, a dark header row with white text, 8 property rows and a Total row of =SUM formulas (their values
   stored too, so every mail app's preview shows them). */
const xmlEsc = (s: string) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
function buildXlsx(date: string, mFrom: string, rows: any[]) {
  const col = "ABCDEFGHI";
  const str = (ref: string, s: string, st: number) => `<c r="${ref}" s="${st}" t="inlineStr"><is><t xml:space="preserve">${xmlEsc(s)}</t></is></c>`;
  const n = (ref: string, v: number, st = 0) => `<c r="${ref}" s="${st}"><v>${v}</v></c>`;
  const head = ["Property", "Leads (Month)", "Leads (Yesterday)", "Qualified (Month)", "Qualified (Yesterday)", "Site Visits (Month)", "Site Visits (Yesterday)", "Agent Visits (Month)", "Agent Visits (Yesterday)"];
  const keys = ["month_leads", "yesterday_leads", "month_qualified", "yesterday_qualified", "month_visits", "yesterday_visits", "agent_month_visits", "agent_yesterday_visits"];
  const props = rows.filter((r) => !r.is_total);
  let sd = `<row r="1">${str("A1", "Daily CRM Updates", 1)}</row>`;
  sd += `<row r="2">${str("A2", `Report date: ${date}   |   Month-to-date range: ${mFrom} to ${date}`, 2)}</row>`;
  sd += `<row r="4">${head.map((h, i) => str(col[i] + "4", h, 3)).join("")}</row>`;
  props.forEach((r, i) => { const rn = 5 + i; sd += `<row r="${rn}">${str("A" + rn, r.property_label, 0)}${keys.map((k, c) => n(col[c + 1] + rn, Number(r[k]) || 0)).join("")}</row>`; });
  const tr = 5 + props.length, last = tr - 1;
  sd += `<row r="${tr}">${str("A" + tr, "Total", 4)}${keys.map((k, c) => `<c r="${col[c + 1]}${tr}" s="4"><f>SUM(${col[c + 1]}5:${col[c + 1]}${last})</f><v>${props.reduce((a, r) => a + (Number(r[k]) || 0), 0)}</v></c>`).join("")}</row>`;
  const sheet = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><cols><col min="1" max="1" width="22" customWidth="1"/><col min="2" max="9" width="20" customWidth="1"/></cols><sheetData>${sd}</sheetData></worksheet>`;
  const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">`
    + `<fonts count="5"><font><sz val="10"/><name val="Arial"/></font><font><b/><sz val="14"/><name val="Arial"/></font><font><i/><sz val="10"/><name val="Arial"/></font><font><b/><sz val="10"/><color rgb="FFFFFFFF"/><name val="Arial"/></font><font><b/><sz val="10"/><name val="Arial"/></font></fonts>`
    + `<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF1F2937"/><bgColor indexed="64"/></patternFill></fill></fills>`
    + `<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>`
    + `<cellXfs count="5"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/><xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/><xf numFmtId="0" fontId="3" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/><xf numFmtId="0" fontId="4" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs>`
    + `<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;
  const files: Record<string, Uint8Array> = {
    "[Content_Types].xml": strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`),
    "_rels/.rels": strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`),
    "xl/workbook.xml": strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="CRM Updates" sheetId="1" r:id="rId1"/></sheets><calcPr fullCalcOnLoad="1"/></workbook>`),
    "xl/_rels/workbook.xml.rels": strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`),
    "xl/styles.xml": strToU8(styles),
    "xl/worksheets/sheet1.xml": strToU8(sheet),
  };
  return zipSync(files, { level: 6 });
}
function b64(u: Uint8Array) { let s = ""; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000)); return btoa(s); }

// the email, through the existing mailer (fixed recipients there); 3 tries, 10 s apart
async function sendEmail(date: string, xlsx: Uint8Array) {
  const body = JSON.stringify({ report_date: date, subject: `CRM Updates – ${date}`, text: `This is the CRM Updates Report for ${date}.\n\nPlease check the attached file.`,
    attachment: { filename: `CRM_Updates_${date}.xlsx`, content_type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", content_base64: b64(xlsx) } });
  const ms = Deno.env.get("CRM_MAILER_SECRET") || "";
  let last: any = null;
  for (let i = 0; i < 3; i++) {
    try {
      const r = await fetch(`${SB}/functions/v1/crm-daily-report-mailer`, { method: "POST", body,
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${ANON}`, apikey: ANON, ...(ms ? { "x-mailer-secret": ms } : {}) } });
      const t = await r.json().catch(() => ({}));
      last = { status: r.status, ...t };
      if (r.ok && t.ok && Array.isArray(t.failed) && t.failed.length === 0) return { ok: true, attempts: i + 1, ...t };
    } catch (e) { last = { error: String((e as Error).message || e) }; }
    await new Promise((res) => setTimeout(res, 10_000));
  }
  return { ok: false, attempts: 3, last };
}

const SAME = ["month_qualified", "yesterday_qualified", "month_visits", "yesterday_visits", "agent_month_visits", "agent_yesterday_visits"];
async function run(body: any) {
  const mode = String(body.mode || await secret("crm_daily_updates_mode") || "shadow") === "live" ? "live" : "shadow";
  const yesterday = addD(istToday(), -1);
  const { data: lastRow } = await ACC.from("crm_daily_updates").select("report_date").eq("is_total", true).order("report_date", { ascending: false }).limit(1);
  const lastDate = lastRow && lastRow[0] ? String(lastRow[0].report_date) : null;
  let dates: string[];
  if (body.report_date) dates = [String(body.report_date)];
  else if (mode === "shadow") dates = lastDate ? [lastDate] : [];
  else { dates = []; for (let d = lastDate ? addD(lastDate, 1) : yesterday; d <= yesterday; d = addD(d, 1)) dates.push(d); if (!dates.length) dates = [yesterday]; dates = dates.slice(-31); }
  const report: any[] = [];
  for (const date of dates) {
    const rec: any = { report_date: date, mode, ok: false };
    try {
      const { rows, mFrom } = await rowsFor(date);
      if (mode === "shadow") {
        const { data: have } = await ACC.from("crm_daily_updates").select("property_key," + SAME.join(",")).eq("report_date", date);
        const diffs: any[] = [];
        for (const r of rows) { const h = (have || []).find((x: any) => x.property_key === r.property_key);
          for (const k of SAME) if (!h || Number(h[k]) !== Number(r[k])) diffs.push({ property: r.property_key, field: k, browser: h ? h[k] : null, api: r[k] }); }
        rec.ok = true; rec.matched = diffs.length === 0; rec.detail = { diffs, totals: rows.find((r) => r.is_total) };
      } else {
        let up = await ACC.from("crm_daily_updates").upsert(rows, { onConflict: "report_date,property_key" });
        // until the leads columns exist (added 23 Nov 2026 20:30 IST) the rows are saved without them
        if (up.error && /leads/.test(up.error.message)) up = await ACC.from("crm_daily_updates").upsert(rows.map(({ month_leads, yesterday_leads, ...r }: any) => r), { onConflict: "report_date,property_key" });
        if (up.error) throw new Error("crm_daily_updates: " + up.error.message);
        const email = await sendEmail(date, buildXlsx(date, mFrom, rows));
        rec.email = email; rec.ok = !!email.ok; rec.detail = { totals: rows.find((r) => r.is_total) };
        if (!email.ok) rec.error = "email failed after 3 attempts: " + JSON.stringify(email.last).slice(0, 400);
      }
    } catch (e) { rec.error = String((e as Error).message || e).slice(0, 500); }
    await ACC.from("crm_daily_updates_runs").insert(rec);
    report.push(rec);
  }
  return { ok: report.every((r) => r.ok), mode, dates, report };
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return j({ error: "POST only" }, 405);
  const sec = req.headers.get("x-ads-secret") || "";
  if (!sec || sec !== await secret("ads_daily")) return j({ error: "not allowed" }, 401);
  let body: any = {}; try { body = await req.json(); } catch { /* empty */ }
  // a sample xlsx for checking, nothing written or sent: {"preview": "YYYY-MM-DD"} -> base64 file
  if (body.preview) { const { rows, mFrom } = await rowsFor(String(body.preview)); return j({ ok: true, rows, xlsx_base64: b64(buildXlsx(String(body.preview), mFrom, rows)) }); }
  try { return j(await run(body)); } catch (e) { return j({ ok: false, error: String((e as Error).message || e) }, 200); }
});
