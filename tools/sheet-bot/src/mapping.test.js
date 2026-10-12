import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildRow, getAadhaarCandidates, SHEET_COLUMNS } from './mapping.js';

// Synthetic fixture shaped like acc.booking_audits.result -- values are made up, not
// real customer data, but the key paths match what was confirmed against the live
// project (see the plan file for how each path was found).
const sampleResult = {
  fields: {
    customer_name: { value: 'Test Customer', found: true },
    project_name: { value: 'Test Towers', found: true },
    block: { value: 'A', found: true },
    floor: { value: '4', found: true },
    flat: { value: '402', found: true },
    bhk: { value: '3BHK', found: true },
    base_rate: { value: '₹5,500', found: true },
    plc: { value: '50,000', found: true },
    flc: { value: '', found: false },
    discount: { value: '1,00,000', found: true },
    customer_pan: { value: 'ABCDE1234F', found: true },
    occupation: { value: 'Engineer', found: true },
    booking_date: { value: '2026-09-01', found: true },
  },
  unit: { cost_sheet: { builtup_sqft: 1200, sba_sqft: 1450 } },
  parking: {
    rows: [
      { label: '1-Covered Car Parking', amount: 150000 },
      { label: '1-Open Car Parking', amount: 50000 },
    ],
  },
  kyc: {
    documents: [
      { doc_type: 'AADHAAR', number: '111122223333', name_on_card: 'Test Customer', relation: 'self' },
      { doc_type: 'AADHAAR', number: '444455556666', name_on_card: 'Co Applicant', relation: 'spouse' },
    ],
    mobile_numbers: ['9999999999'],
    emails: ['test@example.com'],
  },
  crm_lead: { mobile: null, email: null },
  letter: { price: { total_net: 6600000, total_gross: 6800000 } },
};

test('buildRow maps all 21 columns plus the hidden case id, in order', () => {
  const row = buildRow(sampleResult, 42, '111122223333');
  assert.equal(row.length, SHEET_COLUMNS.length + 1);
  assert.equal(row[0], 'Test Customer'); // Name
  assert.equal(row[5], 1200); // Total Built Up
  assert.equal(row[6], 1450); // Super Built Up
  assert.equal(row[11], '1-Covered Car Parking, 1-Open Car Parking'); // Parking Type, joined
  assert.equal(row[12], 200000); // Parking Amt, summed
  assert.equal(row[15], '111122223333'); // Aadhar No. (as resolved by the caller)
  assert.equal(row[17], '9999999999'); // Mobile falls back to kyc when crm_lead is null
  assert.equal(row[18], 'test@example.com'); // Email falls back to kyc when crm_lead is null
  assert.equal(row[20], 6600000); // Unit Price = total_net, not total_gross
  assert.equal(row[21], '42'); // hidden Case ID
});

test('buildRow prefers crm_lead mobile/email over kyc arrays when present', () => {
  const result = { ...sampleResult, crm_lead: { mobile: '8888888888', email: 'crm@example.com' } };
  const row = buildRow(result, 1, null);
  assert.equal(row[17], '8888888888');
  assert.equal(row[18], 'crm@example.com');
});

test('buildRow sanitizes OCR currency formatting on numeric fields', () => {
  const row = buildRow(sampleResult, 1, null);
  assert.equal(row[8], 5500); // Base Rate: "₹5,500" -> 5500
  assert.equal(row[9], 50000); // PLC: "50,000" -> 50000
  assert.equal(row[13], 100000); // Discount: "1,00,000" -> 100000
});

test('buildRow leaves not-found fields blank rather than throwing', () => {
  const row = buildRow(sampleResult, 1, null);
  assert.equal(row[10], ''); // FLC was found:false
});

test('getAadhaarCandidates filters to AADHAAR documents only', () => {
  const withOther = {
    kyc: { documents: [...sampleResult.kyc.documents, { doc_type: 'PAN', number: 'X' }] },
  };
  const candidates = getAadhaarCandidates(withOther);
  assert.equal(candidates.length, 2);
  assert.ok(candidates.every((c) => c.doc_type === 'AADHAAR'));
});

test('getAadhaarCandidates returns an empty array when there is no kyc data', () => {
  assert.deepEqual(getAadhaarCandidates({}), []);
});
