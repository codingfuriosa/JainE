// Checks the Form 140 file that accounts-books.js generates against the official Protean layout (official-layout.json, read from the sheet).
// Run: node tools/tds-form140/check-form140.js   (add --show to print the sample file)
const fs = require('fs'), path = require('path');
const dir = __dirname;
const { rec, codes: codeRows } = JSON.parse(fs.readFileSync(path.join(dir, 'official-layout.json'), 'utf8'));
const book = fs.readFileSync(path.join(dir, '..', '..', 'accounts-books.js'), 'utf8');
const gA = book.indexOf('const TDSG=(function(){'), gB = book.indexOf('window.acxTdsGen=TDSG;');
if (gA < 0 || gB < 0) throw new Error('the generator block is not in accounts-books.js');
const src = book.slice(gA, gB + 'window.acxTdsGen=TDSG;'.length);
const TDSG = new Function('window', src + '; return TDSG;')({});
const codes = {}; codeRows.forEach(c => { codes[c.code] = { flags: c.flags }; });

let fails = 0, checks = 0;
const ok = (c, m) => { checks++; if (!c) { fails++; console.log('  FAIL: ' + m); } };

const deductor = { tan: 'CALJ12345B', deductor_type: 'K', name: 'JAIN GROUP PRIVATE LIMITED', addr1: '1 Park Street', addr2: '', addr3: 'Elgin', addr4: '', addr5: 'Kolkata', country: 'INDIA',
  state_code: '32', pin: '700016', email: 'accounts@example.com', phone_cc: '91', phone: '3322334455', resp_name: 'A B Person', resp_designation: 'Director', resp_pan: 'ABCPE1234F',
  resp_addr1: '1 Park Street', resp_state_code: '32', resp_pin: '700016', resp_email: 'p@example.com', resp_country: 'INDIA', resp_phone_cc: '91', resp_phone: '9830012345' };
const company = { id: 12, name: 'jaingroup', pan: 'AAACJ1234K', gstin: '19AAACJ1234K1Z5' };
const quarter = { year: 2026, q: 3, start: '2026-10-01', end: '2026-12-31' };
const ent = (id, o) => Object.assign({ id, voucher_no: 'PB/' + id, source_type: 'purchase_bill', vendor_id: 50, deductee_pan: 'ABCCE1234F', deductee_name: 'Test Vendor ' + id, tds_code: '1024', amount_credited: '100000.00',
  rate: '2.0000', tds_amount: '2000.00', credit_date: '2026-10-10', deduction_date: '2026-10-10', reason_flag: null, certificate_no: null, challan_id: 1 }, o);
const ch = (id, o) => Object.assign({ id, deposit_date: '2026-11-03', bsr_code: '6390340', serial_no: '12345', minor_head: '200', tax: '7000', interest: '0', fee: '0', other: '0' }, o);
const base = () => ({ company, deductor: Object.assign({}, deductor), quarter,
  entries: [ent(1), ent(2, { tds_code: '1027', deductee_pan: 'ABCPE1234F', deductee_name: 'Dr A B & Sons (Prof.) é', amount_credited: '50000.00', rate: '10.0000', tds_amount: '5000.00', deduction_date: '2026-10-12', credit_date: '2026-10-12' }),
    ent(3, { tds_code: '1023', deductee_pan: 'ABCPE1234F', amount_credited: '80000.00', rate: '0.5000', tds_amount: '400.00', deduction_date: '2026-11-20', credit_date: '2026-11-20', reason_flag: 'A', certificate_no: 'abcde12345', challan_id: 2 })],
  challans: [ch(1), ch(2, { deposit_date: '2026-12-05', serial_no: '77', tax: '400', interest: '20', other: '0' })] });
const opts = { fileSeq: 41, today: '2026-12-31', codes, rpuName: 'JainE Accounts', prevFiled: 'N', prevToken: '' };

console.log('== 1. build a statement and check it against the official layout');
const r = TDSG.build(base(), opts);
ok(r.ok, 'build failed: ' + JSON.stringify(r.errors));
const text = r.text;
ok(/^[\x20-\x7E\r\n]*$/.test(text), 'file has non-ASCII characters');
ok(text.endsWith('\r\n') && !/[^\r]\n/.test(text), 'every line must end with CRLF, including the last');
const lines = text.split('\r\n'); ok(lines.pop() === '', 'trailing newline');
const types = ['FH', 'BH', 'CD', 'DD'];
lines.forEach((line, li) => {
  const f = line.split('^'); const type = f[1]; ok(types.includes(type), 'line ' + (li + 1) + ' unknown record ' + type);
  const spec = rec[type]; if (!spec) return;
  ok(f.length === spec.length, `${type} line ${li + 1}: ${f.length} fields, official layout has ${spec.length}`);
  ok(f[0] === String(li + 1), `${type} line ${li + 1}: line number is ${f[0]}`);
  spec.forEach((s, i) => {
    const v = f[i] == null ? '' : f[i];
    const na = s.size === 0 || /^NA$/i.test(s.type);
    if (na) ok(v === '', `${type}.${s.no} "${s.field}" must be empty, is "${v}"`);
    if (s.mo === 'M') ok(v !== '', `${type}.${s.no} "${s.field}" is mandatory but empty`);
    if (s.size > 0) ok(v.length <= s.size, `${type}.${s.no} "${s.field}" is ${v.length} chars, max ${s.size}`);
    if (v !== '' && s.type === 'DATE') ok(/^\d{8}$/.test(v), `${type}.${s.no} date format "${v}"`);
    if (v !== '' && s.type === 'INTEGER') ok(/^\d+(\.00)?$/.test(v), `${type}.${s.no} "${s.field}" integer value "${v}"`);
    if (v !== '' && s.type === 'DECIMAL') ok(/^\d+\.\d{2,4}$/.test(v), `${type}.${s.no} "${s.field}" decimal value "${v}"`);
  });
});
const rows = lines.map(l => l.split('^'));
const FH = rows.filter(f => f[1] === 'FH'), BH = rows.filter(f => f[1] === 'BH'), CD = rows.filter(f => f[1] === 'CD'), DD = rows.filter(f => f[1] === 'DD');
ok(FH.length === 1 && BH.length === 1, 'one FH and one BH');
ok(rows[0][1] === 'FH' && rows[1][1] === 'BH', 'FH then BH');
ok(CD.length === 2 && DD.length === 3, 'record counts ' + CD.length + '/' + DD.length);
console.log('== 2. values and cross-totals');
ok(FH[0][2] === 'NS1' && FH[0][3] === 'R' && FH[0][6] === 'D' && FH[0][7] === 'CALJ12345B' && FH[0][8] === '1', 'FH constants');
ok(FH[0][5] === '41', 'file sequence no is the statement id');
ok(BH[0][4] === '140' && BH[0][15] === '202728' && BH[0][16] === '202627' && BH[0][17] === 'Q3', 'BH form / assessment year / tax year / quarter: ' + [BH[0][4], BH[0][15], BH[0][16], BH[0][17]]);
ok(BH[0][2] === '1' && BH[0][3] === String(CD.length), 'BH batch no / challan count');
ok(BH[0][46] === '7420.00', 'BH batch total deposit = 7000 + (400+20) = ' + BH[0][46]);
ok(BH[0][68] === '19AAACJ1234K1Z5', 'GSTN on BH');
ok(BH[0][51] === 'N' && BH[0][8] === '', 'previous statement flag N and no token');
ok(CD[0][3] === '1' && CD[1][3] === '2', 'challan record numbers run from 1');
const sumField = (recs, i) => recs.reduce((s, f) => s + Math.round(parseFloat(f[i]) * 100), 0);
CD.forEach((c, k) => {
  const dds = DD.filter(f => f[4] === c[3]);
  ok(String(dds.length) === c[4], 'CD ' + c[3] + ' deductee count');
  ok(sumField(dds, 24) === Math.round(parseFloat(c[20]) * 100), 'CD ' + c[3] + ' sum of DD deposited = field 21');
  ok(sumField(dds, 23) === Math.round(parseFloat(c[21]) * 100), 'CD ' + c[3] + ' sum of DD deducted = field 22');
  const total = [7, 8, 9, 10].reduce((s, i) => s + Math.round(parseFloat(c[i]) * 100), 0);
  ok(total === Math.round(parseFloat(c[11]) * 100), 'CD ' + c[3] + ' total deposit = tax+interest+fee+other');
  ok(Math.round(parseFloat(c[11]) * 100) >= sumField(dds, 24) + Math.round(parseFloat(c[23]) * 100) + Math.round(parseFloat(c[24]) * 100) + Math.round(parseFloat(c[9]) * 100), 'CD ' + c[3] + ' official rule: total >= deposited + interest alloc + other alloc + fee');
  ok(c[23] === c[8] && c[24] === c[10], 'CD ' + c[3] + ' interest / other allocation repeat fields 9 / 11');
  ok(c[12] === 'C' && c[22] === '200', 'CD mode C, minor head 200');
});
ok(CD[0][7] === '7000.00', 'challan tax is whole rupees with .00');
ok(DD.map(f => f[3]).join() === '1,2,3', 'deductee record numbers run 1..n across the batch');
ok(DD.every(f => CD.some(c => c[3] === f[4])), 'every DD points at a CD');
ok(DD[0][7] === 'ABCCE1234F' && DD[0][14] === '1024' && DD[0][17] === 'Y', 'DD pan / code / deposited');
ok(DD[0][18] === '10102026' && DD[0][26] === '10102026', 'DD dates are ddmmyyyy');
ok(DD[0][27] === '2.0000' && DD[1][27] === '10.0000', 'rate has 4 decimals');
ok(DD[1][8] === 'Dr A B & Sons (Prof.) e', 'name transliterated to ASCII: ' + DD[1][8]);
ok(DD[2][31] === 'A' && DD[2][32] === 'ABCDE12345', 'reason A carries the (upper-cased) certificate number');
ok(DD[0][31] === '' && DD[0][32] === '', 'no reason on a normal row');
ok(r.name === 'F140_CALJ12345B_202627_Q3.txt', 'file name ' + r.name);
console.log('== 3. caret counts (fields - 1)');
[['FH', 17], ['BH', 71], ['CD', 29], ['DD', 44]].forEach(([t, n]) => { const l = lines.find(x => x.split('^')[1] === t); ok((l.match(/\^/g) || []).length === n, t + ' has ' + (l.match(/\^/g) || []).length + ' carets, expected ' + n); });

console.log('== 4. the checks catch what the file format rejects');
const bad = (mut, expect) => { const d = base(); mut(d); const v = TDSG.validate(d, opts); ok(v.errors.some(e => expect.test(e.msg)), 'expected an error like ' + expect + ' - got: ' + v.errors.map(e => e.msg).join(' | ')); return v; };
bad(d => { d.deductor.tan = ''; }, /TAN/);
bad(d => { d.deductor.tan = 'ABC12'; }, /TAN must be/);
bad(d => { d.deductor.resp_phone = '1234567890'; }, /Indian mobile/);
bad(d => { d.deductor.resp_designation = 'Chief Executive Director General'; }, /20 characters/);
bad(d => { d.deductor.email = 'no-at-sign'; }, /e-mail/);
bad(d => { d.deductor.state_code = '08'; }, /state/);
bad(d => { d.company = Object.assign({}, company, { pan: '' }); }, /no PAN/);
bad(d => { d.entries[0].tds_code = null; }, /nature of payment/);
bad(d => { d.entries[0].deductee_pan = null; }, /PAN of the deductee is missing/);
bad(d => { d.entries[0].deductee_pan = 'ABC'; }, /PAN is not valid/);
bad(d => { d.entries[0].challan_id = null; }, /not mapped to a challan/);
bad(d => { d.entries[0].deduction_date = '2026-09-30'; }, /outside the quarter/);
bad(d => { d.entries[0].tds_amount = '200000.00'; }, /more than the amount/);
bad(d => { d.entries[2].certificate_no = ''; }, /certificate number/);
bad(d => { d.entries[0].reason_flag = 'T'; d.entries[0].tds_code = '1027'; }, /not allowed with code/);
bad(d => { d.challans[0].tax = '6000'; }, /less than/);
bad(d => { d.challans[0].bsr_code = '12'; }, /BSR/);
bad(d => { d.entries = []; }, /nothing to file/);
{ const d = base(); const v = TDSG.validate(d, Object.assign({}, opts, { prevFiled: 'Y', prevToken: '123' })); ok(v.errors.some(e => /token number/.test(e.msg)), 'previous token required when an earlier statement was filed'); }
{ const d = base(); const rr = TDSG.build(d, Object.assign({}, opts, { prevFiled: 'Y', prevToken: '123456789012345' })); ok(rr.ok && rr.lines[1][8] === '123456789012345' && rr.lines[1][51] === 'Y', 'previous token goes in BH field 9 with flag Y'); }
{ const d = base(); d.entries[0].deductee_pan = 'PANNOTAVBL'; const v = TDSG.validate(d, opts); ok(v.errors.length === 0 && v.warnings.some(w => /higher rate/.test(w.msg)), 'default PAN: no error, warns about 20%'); }
{ const d = base(); d.challans[0].deposit_date = '2026-11-20'; const v = TDSG.validate(d, opts); ok(v.warnings.some(w => /after the due date/.test(w.msg)), 'late deposit warns'); }
{ const v = TDSG.validate(base(), Object.assign({}, opts, { today: '2027-03-01' })); ok(v.warnings.some(w => /late filing fee/.test(w.msg)), 'late filing warns'); }
{ const d = base(); const v = TDSG.validate(d, opts); ok(v.errors.length === 0, 'the sample itself is clean: ' + JSON.stringify(v.errors)); }
console.log('== 5. helpers');
ok(TDSG.depositDue('2026-10-10') === '2026-11-07' && TDSG.depositDue('2026-12-20') === '2027-01-07' && TDSG.depositDue('2027-03-15') === '2027-04-30', 'deposit due dates');
ok(TDSG.dueDate(2026, 1) === '2026-07-31' && TDSG.dueDate(2026, 2) === '2026-10-31' && TDSG.dueDate(2026, 3) === '2027-01-31' && TDSG.dueDate(2026, 4) === '2027-05-31', 'statement due dates');
ok(TDSG.clean('a^b\tc\nd') === 'a b c d', 'clean removes ^ and control characters');
console.log(`\n${checks} checks, ${fails} failed`);
if (process.argv.includes('--show')) console.log('\n' + lines.map(l => l.replace(/\^/g, '^')).join('\n'));
process.exit(fails ? 1 : 0);
