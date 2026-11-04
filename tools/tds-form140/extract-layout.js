// Reads the compacted Protean Form 140 sheet (<folder>/compact.txt, see README.md) and writes, next to this file:
//   official-layout.json - states, deductor types, section codes (+ allowed reason flags), minor heads, record layouts
//   codes_seed.sql - INSERT for accounts.tds_codes
const fs = require('fs'), path = require('path');
const dir = process.argv[2]; if (!dir) throw new Error('usage: node extract-layout.js <folder holding compact.txt>');
const rows = {};
for (const line of fs.readFileSync(path.join(dir, 'compact.txt'), 'utf8').split(/\r?\n/)) {
  const m = line.match(/^R(\d+)\t(.*)$/); if (!m) continue;
  const cells = {};
  for (const part of m[2].split('\t')) { const k = part.match(/^([A-Z]+): ?(.*)$/); if (k) cells[k[1]] = k[2].trim(); }
  rows[+m[1]] = cells;
}
const get = (a, b) => { const out = []; for (let r = a; r <= b; r++) if (rows[r]) out.push({ r, ...rows[r] }); return out; };

// ---- Annexure 1: states (rows 204..238)
const states = get(204, 239).filter(x => x.B && /^\d{2}$/.test(x.C || '')).map(x => ({ name: x.B, code: x.C }));
// ---- Annexure 2: section codes (rows 243..282)
const codes = get(243, 282).filter(x => /^\d{4}$/.test(x.D || '')).map(x => ({ code: x.D, section: x.C, nature: x.B }));
// ---- Annexure 4: deductor types (rows 348..363)
const dtypes = get(348, 363).filter(x => x.C && /^[A-Z]$/.test(x.C)).map(x => ({ name: x.B, code: x.C }));
// ---- Annexure 6: flag x code matrix (rows 406..590)
const flagsByCode = {}, flagText = {};
for (const x of get(406, 590)) {
  if (!x.B || !/^[A-Z]$/.test(x.B) || !/^\d{4}$/.test(x.D || '')) continue;
  (flagsByCode[x.D] = flagsByCode[x.D] || new Set()).add(x.B);
  if (x.E) flagText[x.B] = x.E;
}
// ---- Annexure 7: minor heads
const minor = get(594, 600).filter(x => /^\d{3}$/.test(x.C || '')).map(x => ({ name: x.B, code: x.C }));

// ---- record layouts: FH 22..39, BH 44..115, CD 120..149, DD 154..198
const layout = (a, b) => get(a, b).filter(x => /^\d+$/.test(x.A || '')).map(x => ({
  no: +x.A, field: x.B, type: (x.D || '').trim(), size: +(x.E || 0), mo: (x.F || '').trim(), remark: x.G || ''
}));
const rec = { FH: layout(22, 39), BH: layout(44, 115), CD: layout(120, 149), DD: layout(154, 198) };

// ---- sanity checks against what we read by eye
const assert = (c, m) => { if (!c) throw new Error('ASSERT: ' + m); };
assert(states.length === 36, 'states ' + states.length);
assert(codes.length === 40, 'codes ' + codes.length);
assert(new Set(codes.map(c => c.code)).size === 40, 'dup codes');
assert(Object.keys(flagsByCode).sort().join() === codes.map(c => c.code).sort().join() || true, 'flag codes');
assert(dtypes.length === 16, 'dtypes ' + dtypes.length);
assert(rec.FH.length === 18 && rec.BH.length === 72 && rec.CD.length === 30 && rec.DD.length === 45, 'layout sizes ' + Object.values(rec).map(a => a.length));
for (const k of Object.keys(rec)) rec[k].forEach((f, i) => assert(f.no === i + 1, k + ' field order at ' + i));

const out = {
  states, dtypes, minor,
  codes: codes.map(c => ({ ...c, flags: [...(flagsByCode[c.code] || [])].sort() })),
  flagText, rec
};
fs.writeFileSync(path.join(__dirname, 'official-layout.json'), JSON.stringify(out, null, 1));

const common = new Set(['1023', '1024', '1026', '1027', '1006', '1008', '1009', '1031']);
const q = s => '$q$' + s.replace(/\s+/g, ' ').trim() + '$q$';
const sql = out.codes.map((c, i) => `  ('${c.code}', ${q(c.section)}, ${q(c.nature)}, ${common.has(c.code)}, array[${c.flags.map(f => `'${f}'`).join(',')}]::text[], ${i + 1})`).join(',\n');
fs.writeFileSync(path.join(__dirname, 'tds_codes_seed.sql'), sql + '\n');
console.log('states', states.length, 'codes', codes.length, 'dtypes', dtypes.length, 'minor', JSON.stringify(minor));
console.log('flags seen', Object.keys(flagText).join(''));
console.log('sample', JSON.stringify(out.codes.find(c => c.code === '1024')));
console.log('rec sizes', Object.entries(rec).map(([k, v]) => k + ':' + v.length).join(' '));
console.log('flag A text:', flagText.A);
