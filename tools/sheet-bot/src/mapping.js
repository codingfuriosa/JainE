// Pure, deterministic mapping from acc.booking_audits.result (the OCR/AI pipeline's
// output for one Booking Form) onto the 21 Sheet columns, plus one hidden 22nd column
// (Case ID) used by sheet-cdp.js to find/delete a booking's previous row on reprocess.
//
// Every acc.booking_audits.result shape was confirmed against live data before writing
// this -- see the plan file for the exact key paths and why each choice was made.

export const SHEET_COLUMNS = [
  'Name', 'Project', 'Block', 'Floor', 'Flat',
  'Total Built Up', 'Super Built Up', 'BHK', 'Base Rate', 'PLC', 'FLC',
  'Parking Type', 'Parking Amt', 'Discount', 'PAN NO.', 'Aadhar No.',
  'Occupation', 'Mobile No.', 'Email Id', 'Booking Date', 'Unit Price',
];

function field(result, name) {
  const v = result?.fields?.[name]?.value;
  return v ?? '';
}

/** Strips OCR formatting (currency symbols, commas) so Sheets never reads a value
 *  as text or misfires on a leading symbol. Returns '' if nothing numeric is found. */
function toNumberOrEmpty(value) {
  if (value === null || value === undefined || value === '') return '';
  const cleaned = String(value).replace(/[^0-9.-]/g, '');
  if (cleaned === '' || cleaned === '-') return '';
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : '';
}

/** Aadhaar candidates for the disambiguation step (job-processor.js decides which one
 *  to use -- directly if there's exactly one, via Claude if there are several). */
export function getAadhaarCandidates(result) {
  return (result?.kyc?.documents ?? []).filter((d) => d?.doc_type === 'AADHAAR');
}

/** Builds the 22-value row (21 visible columns + hidden Case ID) in exact column order.
 *  aadhaarNumber is resolved by the caller (see getAadhaarCandidates + claude-decision.js)
 *  and passed in here rather than re-derived, so this function stays a pure mapping step. */
export function buildRow(result, caseId, aadhaarNumber) {
  const parkingRows = result?.parking?.rows ?? [];

  return [
    field(result, 'customer_name'),
    field(result, 'project_name'),
    field(result, 'block'),
    field(result, 'floor'),
    field(result, 'flat'),
    toNumberOrEmpty(result?.unit?.cost_sheet?.builtup_sqft),
    toNumberOrEmpty(result?.unit?.cost_sheet?.sba_sqft),
    field(result, 'bhk'),
    toNumberOrEmpty(field(result, 'base_rate')),
    toNumberOrEmpty(field(result, 'plc')),
    toNumberOrEmpty(field(result, 'flc')),
    parkingRows.map((r) => r?.label).filter(Boolean).join(', '),
    parkingRows.reduce((sum, r) => sum + (Number(r?.amount) || 0), 0),
    toNumberOrEmpty(field(result, 'discount')),
    field(result, 'customer_pan'),
    aadhaarNumber ?? '',
    field(result, 'occupation'),
    result?.crm_lead?.mobile ?? result?.kyc?.mobile_numbers?.[0] ?? '',
    result?.crm_lead?.email ?? result?.kyc?.emails?.[0] ?? '',
    field(result, 'booking_date'),
    toNumberOrEmpty(result?.letter?.price?.total_net),
    String(caseId),
  ];
}
