// ══════════════════════════════════════════════════════════════
//  Nexus-RE · Test Response → Supabase Auto-Sync (v2, header-driven)
//  Install this in EACH response Google Sheet (Tests 2-8).
//  The ONLY thing you change per sheet is TEST_ID below.
//
//  Why v2: sheets 2,3,4,6,7 have an extra "Email Address" and
//  "Department" column that the old script didn't expect (it would
//  have misread Email as the Score). This version finds columns by
//  their HEADER NAME instead of a fixed position, and auto-detects
//  the score total from the "X / Y" text instead of a hardcoded
//  number — so it works unmodified across every sheet's layout.
// ══════════════════════════════════════════════════════════════

const CONFIG = {
  TEST_ID: 2,   // <-- CHANGE ONLY THIS, per the mapping table below
  SUPABASE_URL: 'https://rkxsgtauigjrpcjkmccu.supabase.co',
  SUPABASE_KEY: 'sb_publishable_16E3r7KtxA7RMVdtm08gkA_DSEAo94n',
};

// ── TEST_ID mapping (set CONFIG.TEST_ID to match the sheet you're in) ──
//   2 = Aptitude Test for Accounts
//   3 = Aptitude Test legal            (Test for Legal)
//   4 = Aptitude Test for Post Sales Admin
//   5 = Aptitude Test for Recruiter & HR
//   6 = Aptitude Test for Sales
//   7 = Aptitude Test for Tele Sales
//   8 = Test for Legal (Responses)     (Legal new)
//   (Test 1 / Common Attitude already has the old script running — leave it alone)
//   (Test 9 / Operations Head has no name or score field, so it doesn't fit
//    this sync yet — skip it for now.)

function findCol(headers, names) {
  // pass 1: exact match (trimmed, case-insensitive)
  for (let i = 0; i < headers.length; i++) {
    const h = String(headers[i] || '').trim().toLowerCase();
    if (names.some(n => h === n.toLowerCase())) return i;
  }
  // pass 2: header STARTS WITH one of the names — catches variants like
  // "Form Timer ⏱️" (emoji suffix) that wouldn't match exactly
  for (let i = 0; i < headers.length; i++) {
    const h = String(headers[i] || '').trim().toLowerCase();
    if (names.some(n => h.indexOf(n.toLowerCase()) === 0)) return i;
  }
  return -1;
}

function parseRow(headers, row) {
  const idxRespondent = findCol(headers, ['Respondent', 'Name']);
  const idxTimer       = findCol(headers, ['Form Timer']);
  const idxTimestamp   = findCol(headers, ['Timestamp']);
  const idxScore       = findCol(headers, ['Score']);
  const idxEmail       = findCol(headers, ['Email Address', 'Email']);
  const idxDept        = findCol(headers, ['Department']);
  const reserved = new Set([idxRespondent, idxTimer, idxTimestamp, idxScore, idxEmail, idxDept]);

  const respondent  = idxRespondent >= 0 ? (row[idxRespondent] || '') : '';
  const timeTaken   = idxTimer >= 0 ? (row[idxTimer] || null) : null;
  const submittedAt = (idxTimestamp >= 0 && row[idxTimestamp]) ? new Date(row[idxTimestamp]).toISOString() : null;

  let scoreGot = null, scoreTotal = null;
  if (idxScore >= 0 && row[idxScore] !== undefined && row[idxScore] !== '') {
    const parts = String(row[idxScore]).split('/');
    scoreGot = parseInt(parts[0].trim());
    if (parts[1]) scoreTotal = parseInt(parts[1].trim());
    if (isNaN(scoreGot)) scoreGot = null;
    if (isNaN(scoreTotal)) scoreTotal = null;
  }

  const answers = {};
  for (let i = 0; i < headers.length; i++) {
    if (reserved.has(i)) continue;
    if (headers[i] && row[i] !== undefined && row[i] !== '') answers[headers[i]] = row[i];
  }

  return {
    test_id: CONFIG.TEST_ID,
    respondent: respondent,
    score_got: scoreGot,
    score_total: scoreTotal,
    time_taken: timeTaken,
    submitted_at: submittedAt,
    answers: Object.keys(answers).length ? answers : null,
  };
}

function postToSupabase(payload) {
  const options = {
    method: 'POST',
    contentType: 'application/json',
    headers: {
      'apikey': CONFIG.SUPABASE_KEY,
      'Authorization': 'Bearer ' + CONFIG.SUPABASE_KEY,
      'Accept-Profile': 'recruit',
      'Content-Profile': 'recruit',
      'Prefer': 'return=minimal',
    },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true,
  };
  return UrlFetchApp.fetch(CONFIG.SUPABASE_URL + '/rest/v1/test_responses', options);
}

/**
 * Trigger: Form Submit
 * Set this up once per sheet:
 *   Extensions → Apps Script → Triggers (clock icon) → + Add Trigger
 *   Function: onFormSubmit | Event source: From spreadsheet | Event type: On form submit
 */
function onFormSubmit(e) {
  try {
    const sheet = e.range.getSheet();
    const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    const payload = parseRow(headers, e.values);
    if (!payload.respondent || payload.score_got === null || payload.score_got === undefined) {
      Logger.log('Skipped incomplete submission (missing name or score)');
      return;
    }
    const result = postToSupabase(payload);
    Logger.log('Supabase insert status: ' + result.getResponseCode() + ' | ' + result.getContentText());
  } catch (err) {
    Logger.log('Error in onFormSubmit: ' + err.message);
  }
}

/**
 * OPTIONAL: run this once to bulk-import all EXISTING rows already in the sheet.
 * Extensions → Apps Script → select "importAllExistingResponses" in the function
 * dropdown at the top → click Run (▶).
 */
function importAllExistingResponses() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
  const data = sheet.getDataRange().getValues();
  if (data.length < 2) { Logger.log('No data rows found.'); return; }
  const headers = data[0];
  let successCount = 0, failCount = 0, skippedCount = 0;
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    const payload = parseRow(headers, row);
    // Require BOTH a respondent name AND a score — skips test/junk rows
    // (blank submissions, IT test accounts, gmail.com throwaway entries, etc.)
    if (!payload.respondent || payload.score_got === null || payload.score_got === undefined) { skippedCount++; continue; }
    const result = postToSupabase(payload);
    if (result.getResponseCode() === 201) successCount++;
    else { failCount++; Logger.log('Row ' + (i + 1) + ' failed: ' + result.getContentText()); }
    Utilities.sleep(100); // avoid rate limiting
  }
  Logger.log('Done. Imported: ' + successCount + ' | Failed: ' + failCount + ' | Skipped (incomplete): ' + skippedCount);
  SpreadsheetApp.getUi().alert('Import complete!\n\nInserted: ' + successCount + '\nFailed: ' + failCount + '\nSkipped (missing name/score): ' + skippedCount);
}
