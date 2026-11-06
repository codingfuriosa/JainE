// Market Valuation for booking audits - fetched server-side straight from the West Bengal form
// (wb-form.ts), no office PC, browser or tunnel. Replaces the Playwright-tunnel version (v18) and the
// JainE Automation extension's market_valuation jobs.
//
// POST, header x-webhook-secret = acc.job_secrets 'market_valuation' (server-to-server only).
//   { "case_id": 890 }                 value one pending case
//   { "sweep": true, "max": 3 }        value up to `max` pending cases, oldest first, spaced out
//   add "dry_run": true to either      fetch and return the value, write nothing
// Only cases acc.market_valuation_pending() returns are touched (status done, no value yet, a
// configured project). A figure missing after checking every source = skipped, never estimated.
// Deploy pinned to Mumbai: callers send header x-region: ap-south-1 (the government site is Indian).
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.47.10';
import { marketValue, PROJECTS } from './wb-form.ts';

const j = (o: unknown, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { 'Content-Type': 'application/json' } });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// The Booking Form prints the floor as a word ("FIRST", "4th", "Ground Floor"); the site wants a number.
const ORDINAL_WORDS: Record<string, number> = {
  GROUND: 0, GR: 0, G: 0, BASEMENT: 0, FIRST: 1, SECOND: 2, THIRD: 3, FOURTH: 4, FIFTH: 5, SIXTH: 6, SEVENTH: 7,
  EIGHTH: 8, NINTH: 9, TENTH: 10, ELEVENTH: 11, TWELFTH: 12, THIRTEENTH: 13, FOURTEENTH: 14, FIFTEENTH: 15,
  SIXTEENTH: 16, SEVENTEENTH: 17, EIGHTEENTH: 18, NINETEENTH: 19, TWENTIETH: 20,
};
function floorToNumber(v: unknown): number | null {
  if (v == null) return null;
  const s = String(v).trim().toUpperCase().replace(/\bFLOOR\b|\bFLR\b/g, '').replace(/[^A-Z0-9]/g, '');
  if (!s) return null;
  if (/^\d+$/.test(s)) return parseInt(s, 10);
  const m = s.match(/^(\d+)(ST|ND|RD|TH)$/);
  if (m) return parseInt(m[1], 10);
  return Object.prototype.hasOwnProperty.call(ORDINAL_WORDS, s) ? ORDINAL_WORDS[s] : null;
}
// cost_sheet's flat can read like "Block A2 - 6B" - only the part after the last dash is the flat.
function deriveFlat(costSheetFlat: unknown, bookingFormFlat: unknown): string | null {
  let flat = (bookingFormFlat || costSheetFlat) as string | null;
  if (!flat) return null;
  flat = String(flat).trim();
  if (flat.includes('-')) flat = flat.split('-').pop()!.trim();
  return flat || null;
}

// deno-lint-ignore no-explicit-any
function inputsFor(row: any) {
  return {
    project: row.project as string,
    carpetArea: row.carpet_ua ?? null,
    buildupArea: row.builtup_ua ?? row.cost_sheet?.builtup_sqft ?? null,
    superBuildupArea: row.sba ?? row.cost_sheet?.sba_sqft ?? null,
    floor: floorToNumber(row.floor) ?? floorToNumber(row.cost_sheet?.floor) ?? floorToNumber(row.booking_form?.floor),
    flatNo: deriveFlat(row.cost_sheet?.flat, row.booking_form?.flat),
  };
}

function precheck(inp: ReturnType<typeof inputsFor>): string | null {
  const cfg = PROJECTS[inp.project];
  if (!cfg) return 'project not configured';
  if (inp.carpetArea == null || inp.buildupArea == null || inp.floor == null || !inp.flatNo) {
    return 'missing figures after checking every known source - not estimating';
  }
  if (inp.floor > cfg.floorsInBuilding) return `floor ${inp.floor} is above the ${cfg.floorsInBuilding} floors configured - real tower floor count needed`;
  return null;
}

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return j({ error: 'method not allowed' }, 405);
  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  // Same shared secret the database side reads (acc.job_secrets 'market_valuation').
  const secret = req.headers.get('x-webhook-secret') || '';
  const { data: s } = await db.schema('acc').from('job_secrets').select('value').eq('name', 'market_valuation').maybeSingle();
  if (!secret || !s?.value || secret !== s.value) return j({ error: 'unauthorized' }, 401);

  // deno-lint-ignore no-explicit-any
  let body: any = {}; try { body = await req.json(); } catch (_e) { /* empty body */ }
  const dryRun = body.dry_run === true;
  const { data: pending, error: rpcErr } = await db.schema('acc').rpc('market_valuation_pending');
  if (rpcErr) return j({ error: 'pending RPC failed: ' + rpcErr.message }, 500);

  // deno-lint-ignore no-explicit-any
  let rows: any[];
  if (body.case_id != null) {
    rows = (pending || []).filter((r: { case_id: number }) => Number(r.case_id) === Number(body.case_id));
    if (!rows.length) return j({ ok: true, skipped: 'not pending (already valued, not done yet, or not a configured project)' });
  } else if (body.sweep === true) {
    // Cases that can never succeed as things stand (missing figure, floor above the configured
    // count) are reported, not retried, so they cannot starve newer cases.
    const fetchable = (pending || []).filter((r: unknown) => !precheck(inputsFor(r)));
    rows = fetchable.slice(0, Math.min(Math.max(Number(body.max) || 3, 1), 5));
  } else return j({ error: 'send case_id or sweep' }, 400);

  const results = [];
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const inp = inputsFor(row);
    const rec: Record<string, unknown> = { case_id: Number(row.case_id), project: row.project, inputs: inp };
    const why = precheck(inp);
    if (why) rec.skipped = why;
    else {
      if (i > 0) await sleep(8000);   // the site rate-limits rapid repeated submissions
      try {
        // deno-lint-ignore no-explicit-any
        const r = await marketValue(inp as any);
        rec.value = r.value; rec.resultLine = r.resultLine;
        if (!dryRun) {
          // Same guard as the pending RPC: never overwrite a value someone else wrote meanwhile.
          const { data: upd, error } = await db.schema('acc').from('booking_audits')
            .update({ market_valuation: String(r.value) }).eq('case_id', rec.case_id).is('market_valuation', null).select('case_id');
          if (error) rec.error = 'db write failed: ' + error.message;
          else rec.written = (upd || []).length === 1;
        }
      } catch (e) {
        rec.error = String((e as Error)?.message || e).slice(0, 300);
      }
    }
    results.push(rec);
  }
  const failed = results.some((r) => r.error);
  return j({ ok: !failed, dry_run: dryRun, results }, failed ? 500 : 200);
});
