// Drives the Sheets tab via chrome.debugger (see lib/cdp-input.js for the shared
// low-level primitives). No separate Chrome profile, no --remote-debugging-port,
// already signed in.
//
// Google Sheets' grid is canvas-rendered, not a DOM table -- there's no cell element
// to click/select by CSS selector. Everything here is either simulated keyboard input
// or a read of the few genuinely-DOM parts of the Sheets UI: the Name Box
// (id="t-name-box") and dialog/tab-strip elements.
//
// This version fixes three bugs found testing the original Node prototype against the
// real sheet on 2026-09-14:
//   1. The dialog-blocking check matched Google's own Find bar ("0 of 0") as if it
//      were a blocking dialog. Now explicitly excluded.
//   2. The Ctrl+F reprocess-check matched ANY cell containing the case id text, which
//      could delete an unrelated row. Now verifies the match is actually in column V
//      (the hidden Case ID column) before deleting anything.
//   3. sheet_job_finish's empty response body was mishandled -- fixed in
//      lib/supabase-rpc.js, not here, but worth noting since it caused every
//      successful append to be logged and retried as a failure.

import { MOD, sleep, attach, detach, pressKey, typeText, click, evaluate, screenshotAndSave, findOrOpenTab } from './cdp-input.js';

async function readNameBox(tabId) {
  return (await evaluate(tabId,
    `document.querySelector('#t-name-box')?.value ?? document.querySelector('[id*="name-box"]')?.value ?? null`
  )) ?? null;
}

async function findBlockingDialog(tabId) {
  return (await evaluate(tabId, `(() => {
      const dialogs = document.querySelectorAll('[role="dialog"]:not([aria-hidden="true"]), .docs-dlg-container:not([style*="display: none"])');
      for (const el of dialogs) {
        const cls = el.className || '';
        const text = (el.innerText || '').trim();
        if (/find|replace/i.test(cls) || /^\\d+\\s+of\\s+\\d+/i.test(text)) continue;
        return text.slice(0, 300);
      }
      return null;
    })()`)) ?? null;
}

/**
 * Finds the row previously written for caseId (if any), verifying the match is
 * actually in the hidden Case ID column (V) before treating it as one -- a plain
 * whole-sheet text search could otherwise match an unrelated cell that happens to
 * contain the same digits and delete the wrong row.
 */
async function findAndDeletePreviousRow(tabId, caseId, jobId) {
  await pressKey(tabId, { key: 'f', code: 'KeyF', keyCode: 70, modifiers: MOD.ctrl });
  await sleep(300);
  await typeText(tabId, String(caseId));
  await pressKey(tabId, { key: 'Enter', code: 'Enter', keyCode: 13 });
  await sleep(300);

  const matchCell = await readNameBox(tabId);
  await pressKey(tabId, { key: 'Escape', code: 'Escape', keyCode: 27 });
  await sleep(150);

  const column = matchCell?.match(/^([A-Z]+)\d+$/i)?.[1]?.toUpperCase();
  if (!matchCell || column !== 'V') {
    if (matchCell) {
      console.warn('sheet-automation: a cell matched the case id but is not in the Case ID column, ignoring', { jobId, caseId, matchCell });
    }
    return false;
  }

  console.log('sheet-automation: found previous row for case, deleting it before append', { jobId, caseId, cell: matchCell });
  await pressKey(tabId, { key: ' ', code: 'Space', keyCode: 32, modifiers: MOD.shift }); // select whole row
  await pressKey(tabId, { key: '-', code: 'Minus', keyCode: 189, modifiers: MOD.ctrl | MOD.alt }); // delete row
  await sleep(300);
  return true;
}

/** Appends one booking row (see lib/mapping.js for the 22-value shape) to the Sheet,
 *  deleting any row previously written for the same caseId first. */
export async function appendBookingRow({ sheetUrl, caseId, row, jobId }) {
  const docId = sheetUrl.match(/\/d\/([^/]+)/)?.[1];
  const tabId = await findOrOpenTab(`https://docs.google.com/spreadsheets/d/${docId}*`, sheetUrl);
  await attach(tabId);

  try {
    await chrome.tabs.update(tabId, { active: true });
    await sleep(500); // let the grid finish painting

    const dialogText = await findBlockingDialog(tabId);
    if (dialogText) {
      throw new Error(`sheet-automation: a dialog is blocking the grid: "${dialogText}"`);
    }

    await click(tabId, 400, 300); // focus the grid (a generic point well inside the visible area)

    await findAndDeletePreviousRow(tabId, caseId, jobId);

    // Find the next empty row via column A.
    await pressKey(tabId, { key: 'Home', code: 'Home', keyCode: 36, modifiers: MOD.ctrl }); // -> A1
    await pressKey(tabId, { key: 'ArrowDown', code: 'ArrowDown', keyCode: 40, modifiers: MOD.ctrl }); // -> last non-empty row in A
    await pressKey(tabId, { key: 'ArrowDown', code: 'ArrowDown', keyCode: 40 }); // -> first empty row
    await sleep(200);

    const startCell = await readNameBox(tabId);
    console.log('sheet-automation: appending row', { jobId, caseId, startCell });

    for (let i = 0; i < row.length; i++) {
      await typeText(tabId, row[i]);
      await pressKey(tabId, i < row.length - 1
        ? { key: 'Tab', code: 'Tab', keyCode: 9 }
        : { key: 'Enter', code: 'Enter', keyCode: 13 });
    }
    await sleep(300);

    const endCell = await readNameBox(tabId);
    if (!endCell || endCell === startCell) {
      throw new Error(`sheet-automation: cursor did not advance after typing (still at ${endCell ?? 'unknown'}) -- write likely failed`);
    }

    console.log('sheet-automation: row appended', { jobId, caseId, startCell, endCell });
  } catch (err) {
    await screenshotAndSave(tabId, jobId);
    throw err;
  } finally {
    await detach(tabId);
  }
}
