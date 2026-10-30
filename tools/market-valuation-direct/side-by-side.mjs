// READ-ONLY side-by-side: fetch each case's market value from the old WB form (mv-fetch.mjs) and compare with the
// value already stored in acc.booking_audits.market_valuation. Writes nothing anywhere except the
// local results file. Inputs come from cases.json (a SELECT of the same fields market_valuation_pending()
// returns), derived exactly as tools/jaine-automation-extension/lib/market-valuation-automation.js does.
import fs from 'fs';
import { marketValue } from './mv-fetch.mjs';

const ORDINAL_WORDS = {
  GROUND: 0, GR: 0, G: 0, BASEMENT: 0, FIRST: 1, SECOND: 2, THIRD: 3, FOURTH: 4, FIFTH: 5, SIXTH: 6, SEVENTH: 7,
  EIGHTH: 8, NINTH: 9, TENTH: 10, ELEVENTH: 11, TWELFTH: 12, THIRTEENTH: 13, FOURTEENTH: 14, FIFTEENTH: 15,
};
export function floorToNumber(v) {
  if (v == null) return null;
  const s = String(v).trim().toUpperCase().replace(/\bFLOOR\b|\bFLR\b/g, '').replace(/[^A-Z0-9]/g, '');
  if (!s) return null;
  if (/^\d+$/.test(s)) return parseInt(s, 10);
  const m = s.match(/^(\d+)(ST|ND|RD|TH)$/);
  if (m) return parseInt(m[1], 10);
  return Object.prototype.hasOwnProperty.call(ORDINAL_WORDS, s) ? ORDINAL_WORDS[s] : null;
}
// cost_sheet's flat can read like "Block A2 - 6B" - only the part after the last dash is the flat.
function deriveFlat(costSheetFlat, bookingFormFlat) {
  let flat = bookingFormFlat || costSheetFlat;
  if (!flat) return null;
  flat = String(flat).trim();
  if (flat.includes('-')) flat = flat.split('-').pop().trim();
  return flat || null;
}
export function inputsFor(row) {
  return {
    project: row.project,
    carpetArea: row.carpet_ua ?? null,
    buildupArea: row.builtup_ua ?? row.cs_builtup ?? null,
    superBuildupArea: row.sba ?? null,
    flatNo: deriveFlat(row.cs_flat, row.bf_flat),
    floor: floorToNumber(row.floor) ?? floorToNumber(row.cs_floor) ?? floorToNumber(row.bf_floor),
  };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const cases = JSON.parse(fs.readFileSync(new URL('./cases.json', import.meta.url)));
const only = process.argv[2] ? new Set(process.argv[2].split(',').map(Number)) : null;
const gapMs = Number(process.env.GAP_MS || 10000);
const out = [];
for (const row of cases) {
  if (only && !only.has(row.case_id)) continue;
  const inp = inputsFor(row);
  let rec = { case_id: row.case_id, project: row.project, inputs: inp, stored: Number(row.market_valuation) };
  try {
    const r = await marketValue(inp);
    rec = { ...rec, fetched: r.value, resultLine: r.resultLine, match: r.value === rec.stored, diff: r.value - rec.stored };
  } catch (e) { rec.error = String(e.message || e); }
  out.push(rec);
  console.log(JSON.stringify(rec));
  await sleep(gapMs);
}
fs.writeFileSync(new URL('./side-by-side-results.json', import.meta.url), JSON.stringify(out, null, 2));
const ok = out.filter((r) => r.match).length, diff = out.filter((r) => r.fetched != null && !r.match).length, err = out.filter((r) => r.error).length;
console.log(`\n${out.length} cases: ${ok} exact match, ${diff} different, ${err} errors`);
