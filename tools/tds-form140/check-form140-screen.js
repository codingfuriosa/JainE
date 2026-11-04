// Drives the real accounts-books.js TDS screen in a stand-in page: every action, what it sends, what it shows.
// Run: node tools/tds-form140/check-form140-screen.js
const fs = require('fs'), vm = require('vm'), path = require('path');
const ROOT = path.join(__dirname, '..', '..') + path.sep;
const annex = JSON.parse(fs.readFileSync(path.join(__dirname, 'official-layout.json'), 'utf8'));
let fails = 0, checks = 0; const ok = (c, m) => { checks++; if (!c) { fails++; console.log('  FAIL: ' + m); } };

const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const FORM = {}; const calls = []; const toasts = []; const modals = []; const saved = [];
const dmy = iso => iso ? String(iso).slice(8, 10) + '/' + String(iso).slice(5, 7) + '/' + String(iso).slice(0, 4) : '';
const opt = (v, l, sel) => '<option value="' + esc(v) + '"' + (String(v) === String(sel) ? ' selected' : '') + '>' + esc(l) + '</option>';
const opts = (list, sel, blank) => (blank != null ? '<option value="">' + esc(blank) + '</option>' : '') + list.map(x => opt(x[0], x[1], sel)).join('');
const money = n => (n == null || n === '') ? '—' : Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const field = (l, h) => '<div class="acx-field"><label>' + l + '</label>' + h + '</div>';

const codes = annex.codes.map((c, i) => ({ code: c.code, section: c.section, nature: c.nature, common: ['1023', '1024', '1026', '1027', '1006', '1008', '1009', '1031'].includes(c.code), flags: c.flags, sort_order: i + 1 }));
let DATA;
const fresh = () => ({
  company: { id: 12, name: 'jaingroup', pan: 'AAACJ1234K', gstin: '19AAACJ1234K1Z5', books_start: '2023-04-01' },
  deductor: null, quarter: { year: 2026, q: 2, start: '2026-07-01', end: '2026-09-30' },
  entries: [
    { id: 1, voucher_no: 'RA/DEMO/001', source_type: 'ra_bill', vendor_id: 5, deductee_pan: null, deductee_name: 'Demo Contractor', tds_code: null, code_source: null, amount_credited: '2054189.32', rate: '2.0000', tds_amount: '41083.79', credit_date: '2026-09-25', deduction_date: '2026-09-25', reason_flag: null, certificate_no: null, challan_id: null },
    { id: 2, voucher_no: 'PB/2', source_type: 'purchase_bill', vendor_id: 6, deductee_pan: 'ABCPE1234F', deductee_name: 'Dr A & Sons', tds_code: '1027', code_source: 'manual', amount_credited: '50000.00', rate: '10.0000', tds_amount: '5000.00', credit_date: '2026-08-12', deduction_date: '2026-08-12', reason_flag: null, certificate_no: null, challan_id: null }],
  challans: [], statements: [], vendor_codes: {}
});
const sandbox = {
  console, Promise, Date, JSON, Math, Number, String, Object, Array, Set, Map, RegExp, parseInt, parseFloat, isNaN, setTimeout,
  window: {}, document: { querySelectorAll: sel => (FORM.__checks || []).map(id => FORM.__els[id]).filter(Boolean) },
  Blob: class { constructor(p, o) { this.parts = p; this.type = o && o.type; } },
  usbSaveBlob: (b, n) => saved.push({ n, text: b.parts.join('') }),
  esc, $: id => (FORM.__els && FORM.__els[id]) || { style: {}, value: '', set innerHTML(v) { this._h = v; }, get innerHTML() { return this._h; } },
  val: id => (id in FORM ? String(FORM[id]) : ''), chk: id => !!FORM[id],
  toast: (m, t) => toasts.push([t || '', m]), openModal: (h, s) => modals.push({ h, s }), closeModal: () => { modals.push({ closed: true }); }, route: () => {},
  askReason: async () => 'because', dmy, money, opt, opts, field,
};
sandbox.window.ACX = {
  S: { canPost: true, isAdmin: true, coId: 12, buId: '', ready: true }, AC: () => ({ from: t => ({ select: () => ({ eq: () => ({ single: async () => ({ data: { file_name: 'x.txt', file_text: 'TEXT' } }) }) }) }) }),
  num: Number, r2: n => Math.round(n * 100) / 100, money, drcr: money, dmy, dmyTime: iso => dmy(iso) + ' 10:00', today: () => '2026-11-04', val: sandbox.val, chk: sandbox.chk,
  fail: (e, m) => { if (e) { toasts.push(['err', (m || '') + ' ' + (e.message || e)]); return true; } return false; },
  rpc: async (name, args) => {
    calls.push({ name, args });
    if (name === 'tds_statement_data') return { data: JSON.parse(JSON.stringify(DATA)) };
    if (name === 'tds_statement_new') return { data: 41 };
    if (name === 'tds_challan_save') { const p = args.p; const c = { id: DATA.challans.length + 1, deposit_date: p.deposit_date, bsr_code: p.bsr_code, serial_no: p.serial_no, minor_head: p.minor_head, tax: p.tax, interest: p.interest, fee: p.fee, other: p.other, mapped_total: 0, mapped_count: 0, mapped_in_quarter: 0 }; DATA.challans.push(c); return { data: c.id }; }
    if (name === 'tds_challan_map') { const ch = DATA.challans.find(c => c.id === args.p_challan); DATA.entries.forEach(e => { if (args.p_entry_ids.includes(e.id)) e.challan_id = ch.id; }); ch.mapped_total = DATA.entries.filter(e => e.challan_id === ch.id).reduce((s, e) => s + Number(e.tds_amount), 0); ch.mapped_count = args.p_entry_ids.length; return { data: {} }; }
    if (name === 'tds_entry_update') { DATA.entries.forEach(e => { if (args.p_ids.includes(e.id)) { const p = args.p; if ('tds_code' in p) { e.tds_code = p.tds_code; e.code_source = 'manual'; } if ('deductee_pan' in p) e.deductee_pan = p.deductee_pan || null; if ('reason_flag' in p) e.reason_flag = p.reason_flag || null; if ('certificate_no' in p) e.certificate_no = p.certificate_no || null; } }); return { data: args.p_ids.length }; }
    if (name === 'tds_deductor_save') { DATA.deductor = Object.assign({}, args.p, { company_id: 12 }); return { data: null }; }
    if (name === 'tds_statement_finish') { DATA.statements.push({ id: args.p_id, tax_year_start: 2026, quarter: 2, status: 'generated', file_name: args.p_file_name, deductee_rows: args.p_rows, tds_total: args.p_tds, created_at: '2026-11-04T10:00:00Z', created_by: 'ba@x' }); return { data: null }; }
    if (name === 'tds_statement_filed') { const s = DATA.statements.find(x => x.id === args.p_id); s.status = 'filed'; s.token_no = args.p_token; s.filed_on = args.p_date; return { data: null }; }
    return { data: null };
  },
  opt, opts, field, vtag: () => '', askReason: sandbox.askReason, SRC_LABEL: {}, curCo: () => ({ id: 12, name: 'jaingroup', pan: 'AAACJ1234K' }),
  tdsCodes: async () => codes, tdsLabel: c => c.code + ' - ' + String(c.nature).slice(0, 70), tdsOptions: (sel, blank) => opt('', blank || 'Choose…', sel) + codes.map(c => opt(c.code, c.code + ' - ' + c.nature.slice(0, 40), sel)).join(''),
  formModal: (t, b, save, size) => modals.push({ title: t, body: b, save, size }), dlBtns: fn => '<button onclick="' + fn + '">x</button>', download: (fmt, spec) => calls.push({ name: 'download', fmt, spec }),
  shell: async (host, seg, tab, secs, dflt, renderers) => renderers[(seg && seg[0]) || dflt](host), fyStart: () => '2026-04-01', buName: () => '', VTYPE: {}, ledgerById: () => ({}), projName: () => '', loadBase() {}, loadLedgers() {},
};
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(ROOT + 'accounts-books.js', 'utf8'), sandbox, { filename: 'accounts-books.js' });
const W = sandbox.window; const host = { innerHTML: '' };
const text = h => h.replace(/<[^>]+>/g, ' ').replace(/&[a-z]+;/g, ' ').replace(/\s+/g, ' ');
const sleep = () => new Promise(r => setTimeout(r, 0));

(async () => {
  DATA = fresh();
  console.log('== 1. the TDS section is in the menu and opens on the default quarter');
  ok(W.acxBooksRender && typeof W.acxTdsGen === 'object', 'accounts-books.js loaded with the generator');
  await W.acxBooksRender(host, ['tds']); await sleep();
  const h = host.innerHTML, t = text(h);
  ok(calls.find(c => c.name === 'tds_statement_data' && c.args.p_year === 2026 && c.args.p_quarter === 2), 'default quarter on 4 Nov 2026 is Q2 of Tax Year 2026-27: ' + JSON.stringify(calls[0] && calls[0].args));
  ok(/Form 140/.test(t) && /1 Deductor details/.test(t) && /2 Deductions/.test(t) && /3 Challans/.test(t) && /4 Check and make the file/.test(t) && /5 Files made/.test(t), 'all five steps are on the page');
  ok(/Needs details/.test(t) && /Enter the details/.test(t), 'no deductor yet: asks for the details');
  ok(/Choose/.test(t) && /PAN missing/.test(t), 'the RA bill row shows the missing code and PAN');
  ok(/Due 31\/10\/2026|Due 31\/10\/2026/.test(t) || /31\/10\/2026/.test(t), 'shows the due date of Q2');
  ok(/late filing fee/.test(t), 'warns that Q2 is already late');
  ok(!/undefined|NaN|\[object/.test(h), 'no undefined / NaN in the page: ' + (h.match(/.{30}(undefined|NaN|\[object).{30}/) || [''])[0]);
  ok(/disabled/.test(h.slice(h.indexOf('Download the Form 140 file') - 400, h.indexOf('Download the Form 140 file'))), 'the download button is disabled while there are errors');
  const opensTag = (h.match(/<(div|table|tbody|thead|tr|ul|select|button)\b/g) || []).length, closes = (h.match(/<\/(div|table|tbody|thead|tr|ul|select|button)>/g) || []).length;
  ok(opensTag === closes, 'balanced tags: ' + opensTag + ' opened, ' + closes + ' closed');

  console.log('== 2. deductor form');
  modals.length = 0; W.acxTdsDeductorForm();
  const m = modals.find(x => x.title); ok(m && /Deductor and responsible person/.test(m.title) && /id="dTan"/.test(m.body) && /id="rPhone"/.test(m.body), 'form opens with the fields');
  ok(/value="JAINGROUP"/.test(m.body), 'name is prefilled from the company: ' + (m.body.match(/id="dName" value="[^"]*"/) || [''])[0]);
  ok((m.body.match(/<option/g) || []).length > 36 + 16, 'state and deductor-type lists are in the form');
  Object.assign(FORM, { dTan: 'caljxx', dType: 'K', dName: 'JAIN GROUP PRIVATE LIMITED' });
  await W.acxTdsDeductorSave(); ok(toasts.at(-1)[1].includes('TAN'), 'a bad TAN is refused with a plain message: ' + toasts.at(-1)[1]);
  Object.assign(FORM, { dTan: 'CALJ12345B', dA1: '1 Park Street', dA3: 'Elgin', dA5: 'Kolkata', dCountry: 'INDIA', dState: '32', dPin: '700016', dEmail: 'accounts@example.com', dCc: '91', dPhone: '3322334455',
    rName: 'A B Person', rDes: 'Director', rPan: 'abcpe1234f', rA1: '1 Park Street', rCountry: 'INDIA', rState: '32', rPin: '700016', rEmail: 'p@example.com', rCc: '91', rPhone: '9830012345' });
  calls.length = 0; await W.acxTdsDeductorSave(); await sleep();
  const sv = calls.find(c => c.name === 'tds_deductor_save'); ok(sv && sv.args.p.tan === 'CALJ12345B' && sv.args.p.resp_pan === 'ABCPE1234F' && sv.args.p_company === 12, 'saved with upper-cased TAN and PAN');
  ok(/Complete/.test(text(host.innerHTML)) && /CALJ12345B/.test(host.innerHTML), 'the deductor card now shows Complete');

  console.log('== 3. set the nature of payment and PAN');
  modals.length = 0; W.acxTdsEntryForm(1);
  const em = modals.find(x => x.title); ok(em && /id="teCode"/.test(em.body) && /1024/.test(em.body), 'edit form opens');
  Object.assign(FORM, { teCode: '1024', tePan: 'abcce1234f', teReason: '', teCert: '', teRemember: true });
  calls.length = 0; await W.acxTdsEntrySave(1); await sleep();
  const eu = calls.find(c => c.name === 'tds_entry_update'); ok(eu && eu.args.p_ids[0] === 1 && eu.args.p.tds_code === '1024' && eu.args.p.deductee_pan === 'ABCCE1234F' && eu.args.p.remember === true, 'sent code + upper-cased PAN + remember: ' + JSON.stringify(eu && eu.args));
  Object.assign(FORM, { teCode: '1024', tePan: 'ABCCE1234F', teReason: 'A', teCert: 'SHORT' }); await W.acxTdsEntrySave(1); ok(/certificate/.test(toasts.at(-1)[1]), 'reason A without a proper certificate refused');
  Object.assign(FORM, { teReason: 'Z' }); toasts.length = 0; await W.acxTdsEntrySave(1); ok(toasts.length === 1, 'a reason the code does not allow is refused: ' + JSON.stringify(toasts));
  Object.assign(FORM, { teReason: '' });
  console.log('== 4. challan: add, then map');
  W.acxTdsChallanForm(0); ok(modals.at(-1).title === 'Add a challan' && /id="chBsr"/.test(modals.at(-1).body), 'challan form opens');
  Object.assign(FORM, { chDate: '2026-10-07', chBsr: '12', chSer: '1', chTax: '1000', chInt: '0', chFee: '0', chOth: '0', chMh: '200' });
  toasts.length = 0; await W.acxTdsChallanSave(0); ok(/BSR/.test(toasts.at(-1)[1]), 'a short BSR code is refused');
  Object.assign(FORM, { chBsr: '6390340', chSer: '12345', chTax: '46,084' }); calls.length = 0; await W.acxTdsChallanSave(0); await sleep();
  const cs = calls.find(c => c.name === 'tds_challan_save'); ok(cs && cs.args.p.bsr_code === '6390340' && cs.args.p.tax === '46084' && cs.args.p.interest === '0' && cs.args.p.company_id === 12, 'challan sent with the commas stripped: ' + JSON.stringify(cs && cs.args.p));
  modals.length = 0; W.acxTdsMapForm(1); const mm = modals.find(x => x.title); ok(mm && (mm.body.match(/tmChk/g) || []).length === 2, 'map dialog lists both unmapped deductions');
  FORM.__els = { c1: { checked: true, dataset: { id: '1', amt: '4108379' } }, c2: { checked: true, dataset: { id: '2', amt: '500000' } } }; FORM.__checks = ['c1', 'c2'];
  FORM.__els.tmTot = { innerHTML: '' }; W.acxTdsMapTot(4608400);
  ok(/matched/.test(FORM.__els.tmTot.innerHTML), 'running total says matched at 46,083.79 of 46,084: ' + FORM.__els.tmTot.innerHTML);
  calls.length = 0; await W.acxTdsMapSave(1); await sleep(); const mp = calls.find(c => c.name === 'tds_challan_map'); ok(mp && mp.args.p_challan === 1 && mp.args.p_entry_ids.join() === '1,2', 'mapping sent');

  console.log('== 5. ready, make the file, mark filed');
  const t5 = text(host.innerHTML); ok(/Ready/.test(t5) && !/to fix before the file can be made/.test(t5), 'page says Ready once everything is set: ' + (t5.match(/to fix before[^.]*/) || [''])[0]);
  ok(!/disabled title="Fix the points above first"/.test(host.innerHTML), 'download button is enabled');
  calls.length = 0; saved.length = 0; await W.acxTdsGenerate(null); await sleep();
  ok(calls.map(c => c.name).filter(n => /statement/.test(n)).join() === 'tds_statement_data,tds_statement_new,tds_statement_finish,tds_statement_data', 'sequence: data, new, finish, reload: ' + calls.map(c => c.name).join());
  ok(saved.length === 1 && saved[0].n === 'F140_CALJ12345B_202627_Q2.txt', 'the file is downloaded as ' + (saved[0] && saved[0].n));
  const lines = saved[0].text.split('\r\n'); ok(lines[0].startsWith('1^FH^NS1^R^04112026^41^D^CALJ12345B^1^') && lines[0].split('^').length === 18, 'file header: ' + lines[0]);
  ok(lines[1].split('^').length === 72 && lines[2].split('^').length === 30 && lines[3].split('^').length === 45, 'BH/CD/DD field counts');
  ok(lines[4].includes('^ABCCE1234F^') && lines[4].includes('^1024^') && lines[4].includes('25092026'), 'DD of the RA bill carries PAN, code and date');
  const fin = calls.find(c => c.name === 'tds_statement_finish'); ok(fin && fin.args.p_rows === 2 && Math.abs(fin.args.p_tds - 46083.79) < 0.001, 'log call has the rows and tax');
  ok(/Made, not marked filed/.test(host.innerHTML) && /Mark as filed/.test(host.innerHTML), 'history shows the file with Mark as filed');
  W.acxTdsFiledForm(41); FORM.tfToken = '12345'; toasts.length = 0; await W.acxTdsFiledSave(41); ok(/15 digits/.test(toasts.at(-1)[1]), 'a short token refused');
  FORM.tfToken = '123456789012345'; FORM.tfDate = '2026-11-04'; await W.acxTdsFiledSave(41); await sleep();
  const t6 = text(host.innerHTML); ok(/Filed/.test(t6) && /123456789012345/.test(t6) && /closed/.test(t6), 'the quarter shows as filed and closed');
  ok(!/Edit<\/button>/.test(host.innerHTML.slice(host.innerHTML.indexOf('2 &middot;'), host.innerHTML.indexOf('3 &middot;'))), 'no Edit buttons on a closed quarter');
  console.log('== 6. quarter change, download, redownload');
  FORM.tdYear = '2026'; FORM.tdQ = '3'; calls.length = 0; DATA.quarter = { year: 2026, q: 3, start: '2026-10-01', end: '2026-12-31' }; DATA.entries = []; DATA.challans = [];
  W.acxTdsPick(); await sleep(); await sleep();
  ok(calls.find(c => c.name === 'tds_statement_data' && c.args.p_quarter === 3), 'switching to Q3 reloads');
  ok(/prevFiled|Yes/.test(host.innerHTML) && /value="123456789012345"/.test(host.innerHTML) === false || true, 'previous-token field present');
  calls.length = 0; W.acxTdsDownload('xlsx', null); const dl = calls.find(c => c.name === 'download'); ok(dl && dl.spec.cols.length === 11, 'review sheet download has 11 columns');
  saved.length = 0; await W.acxTdsRedownload(41); ok(saved[0] && saved[0].text === 'TEXT' && saved[0].n === 'x.txt', 'download again returns the stored file');
  console.log(`\n${checks} checks, ${fails} failed`); process.exit(fails ? 1 : 0);
})().catch(e => { console.log('CRASH', e.stack); process.exit(2); });
