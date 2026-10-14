// AUTOMATIC FARVISION IMPORT - the reader (9 Oct 2026)
//
// Run by .github/workflows/farvision-import.yml through the day. It only READS: for each of today's
// Farvision files not read yet it downloads the .xlsx, works out which report it is and turns it into
// rows - with the very same functions the admin page uses, taken from nexus-core.js between the
// FARVISION-PARSERS markers - and hands the rows to the database in chunks. Nothing customer facing
// changes here: cust.fv_import_tick() applies the whole day in one transaction once every file is in.
//
//   FARVISION_IMPORT_KEY=... node tools/farvision-import/index.mjs
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const XLSX = require('xlsx');
const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(here, '..', '..');

const FN_URL = 'https://rkxsgtauigjrpcjkmccu.supabase.co/functions/v1/farvision-import';
const APIKEY = 'sb_publishable_16E3r7KtxA7RMVdtm08gkA_DSEAo94n';   // public key, already in nexus-core.js
const KEY = process.env.FARVISION_IMPORT_KEY;
const CHUNK = 2000;

if (!KEY) { console.error('FARVISION_IMPORT_KEY is not set (GitHub: Settings > Secrets and variables > Actions).'); process.exit(1); }

// ---- the parsers, exactly as the admin page has them ----
const src = fs.readFileSync(path.join(ROOT, 'nexus-core.js'), 'utf8');
const a = src.indexOf('==FARVISION-PARSERS-START=='), b = src.indexOf('==FARVISION-PARSERS-END==');
if (a < 0 || b < 0) { console.error('FARVISION-PARSERS markers not found in nexus-core.js'); process.exit(1); }
const code = src.slice(src.lastIndexOf('/*', a), src.indexOf('*/', b) + 2);
const ctx = { XLSX, window: { XLSX }, console };
vm.createContext(ctx);
vm.runInContext(code + '\n;globalThis.__fv = { detect: cpaDetectReportType, parse: cpaParseByType };', ctx);
const { detect, parse } = ctx.__fv;

async function call(body) {
  const res = await fetch(FN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: APIKEY },
    body: JSON.stringify({ ...body, key: KEY }),
  });
  const text = await res.text();
  let j; try { j = JSON.parse(text); } catch { j = { error: text.slice(0, 300) }; }
  if (!res.ok || j.error) throw new Error(`${body.action}: HTTP ${res.status} ${j.error || ''}`);
  return j;
}

const list = await call({ action: 'auto_files' });
console.log(`Run ${list.run_id} (${list.mode}) - ${list.files.length} file(s) today, ${list.files.filter(f => !f.staged).length} to read`);
if (list.mode === 'off') { console.log('Automatic import is switched off.'); process.exit(0); }

let failures = 0;
for (const f of list.files.filter(x => !x.staged)) {
  const base = { action: 'auto_stage', run_id: list.run_id, queue_id: f.queue_id, file_name: f.file_name, created_at: f.created_at };
  let buf;
  try {
    if (!f.url) throw new Error('no download link');
    const res = await fetch(f.url);
    if (!res.ok) throw new Error('download HTTP ' + res.status);
    buf = new Uint8Array(await res.arrayBuffer());
  } catch (e) {
    // Not staged: the next run tries again.
    console.error(`  ${f.file_name}: could not download - ${e.message}`);
    failures++;
    continue;
  }

  let type = null, rows;
  try {
    const wb = XLSX.read(buf, { type: 'array' });     // serials, not Dates - the same as the admin page
    type = detect(wb);
    if (!type) throw new Error('Could not detect report type');
    rows = JSON.parse(JSON.stringify(parse(type, wb)));
  } catch (e) {
    // A file that cannot be read is recorded as such; the database decides what that means for the day.
    console.error(`  ${f.file_name}: could not read - ${e.message}`);
    try { await call({ ...base, report_type: type, row_count: 0, chunk: 0, chunks: 1, rows: [], parse_error: String(e.message).slice(0, 300) }); }
    catch (e2) { console.error('    ' + e2.message); failures++; }
    continue;
  }

  const chunks = Math.max(1, Math.ceil(rows.length / CHUNK));
  try {
    for (let c = 0; c < chunks; c++) {
      await call({ ...base, report_type: type, row_count: rows.length, chunk: c, chunks, rows: rows.slice(c * CHUNK, (c + 1) * CHUNK) });
    }
    console.log(`  ${f.file_name}: ${type}, ${rows.length} row(s)`);
  } catch (e) {
    console.error(`  ${f.file_name}: could not stage - ${e.message}`);
    failures++;
  }
}
if (failures) { console.error(`${failures} file(s) not done - they will be tried again on the next run.`); process.exit(1); }
console.log('Done.');
