import CDP from 'chrome-remote-interface';
import { logger } from './logger.js';

// Google Sheets' grid is canvas-rendered, not a DOM table -- there is no cell element
// to click/select by CSS selector. Everything here is either a simulated keyboard
// action, or a read of the few genuinely-DOM parts of the Sheets UI: the Name Box
// (id="t-name-box", shows/accepts a cell address like "A47") and the sheet tab strip.
// These two selectors are the most likely thing to break if Google changes the UI --
// see README.md for how to re-check them by hand if this starts failing.

const MOD = { ctrl: 2, alt: 1, shift: 8 };

async function pressKey(Input, { key, keyCode, modifiers = 0 }) {
  const common = { key, windowsVirtualKeyCode: keyCode, nativeVirtualKeyCode: keyCode, modifiers };
  await Input.dispatchKeyEvent({ type: 'keyDown', ...common });
  await Input.dispatchKeyEvent({ type: 'keyUp', ...common });
}

// Chrome treats a keyDown carrying `text` as producing that character -- this is the
// simplest reliable way to simulate real typing over CDP without a browser-automation
// library. If this proves unreliable against the real Sheets UI (see README's staged
// rollout against a TEST COPY first), the alternative is Input.insertText(text), which
// inserts the whole string in one call but bypasses Chrome's normal per-keystroke path.
async function typeText(Input, text) {
  for (const ch of String(text)) {
    await Input.dispatchKeyEvent({ type: 'keyDown', text: ch });
    await Input.dispatchKeyEvent({ type: 'keyUp', text: ch });
  }
}

async function findOrOpenSheetTab(port, sheetUrl) {
  const docId = sheetUrl.match(/\/d\/([^/]+)/)?.[1];
  const targets = await CDP.List({ port });
  const existing = targets.find((t) => t.type === 'page' && docId && t.url.includes(docId));
  if (existing) return existing;
  return CDP.New({ port, url: sheetUrl });
}

async function readNameBox(Runtime) {
  const { result } = await Runtime.evaluate({
    expression: `document.querySelector('#t-name-box')?.value ?? document.querySelector('[id*="name-box"]')?.value ?? null`,
  });
  return result?.value ?? null;
}

async function findBlockingDialog(Runtime) {
  const { result } = await Runtime.evaluate({
    expression: `(() => {
      const el = document.querySelector('[role="dialog"]:not([aria-hidden="true"]), .docs-dlg-container:not([style*="display: none"])');
      return el ? (el.innerText || '').slice(0, 300) : null;
    })()`,
  });
  return result?.value ?? null;
}

async function screenshot(Page) {
  const { data } = await Page.captureScreenshot({ format: 'png' });
  return data;
}

/**
 * Appends one booking row to the Sheet, deleting any row previously written for the
 * same caseId first (found via Ctrl+F over the hidden Case ID column).
 *
 * row: array of 22 values in exact column order (see mapping.js), last one = caseId.
 * Throws on anything unexpected -- job-processor.js is responsible for catching this
 * and reporting failure via sheet_job_finish, plus saving the screenshot below.
 */
export async function appendBookingRow({ chromeDebugPort, sheetUrl, caseId, row, jobId }) {
  const target = await findOrOpenSheetTab(chromeDebugPort, sheetUrl);
  const client = await CDP({ port: chromeDebugPort, target: target.id });
  const { Page, DOM, Input, Runtime } = client;

  try {
    await Promise.all([Page.enable(), DOM.enable(), Runtime.enable()]);
    await new Promise((r) => setTimeout(r, 500)); // let the grid finish painting

    const dialogText = await findBlockingDialog(Runtime);
    if (dialogText) {
      throw new Error(`sheet-cdp: a dialog is blocking the grid: "${dialogText}"`);
    }

    // Focus the grid (a generic point well inside the visible sheet area).
    await Input.dispatchMouseEvent({ type: 'mousePressed', x: 400, y: 300, button: 'left', clickCount: 1 });
    await Input.dispatchMouseEvent({ type: 'mouseReleased', x: 400, y: 300, button: 'left', clickCount: 1 });

    // Reprocess check: find and delete this case's previous row, if any.
    await pressKey(Input, { key: 'f', keyCode: 70, modifiers: MOD.ctrl });
    await new Promise((r) => setTimeout(r, 300));
    await typeText(Input, String(caseId));
    await pressKey(Input, { key: 'Enter', keyCode: 13 });
    await new Promise((r) => setTimeout(r, 300));

    const nameBoxAfterFind = await readNameBox(Runtime);
    const foundPreviousRow = Boolean(nameBoxAfterFind && /^[A-Z]+\d+$/.test(nameBoxAfterFind));
    await pressKey(Input, { key: 'Escape', keyCode: 27 }); // close Find

    if (foundPreviousRow) {
      logger.info('sheet-cdp: found previous row for case, deleting it before append', { jobId, caseId, cell: nameBoxAfterFind });
      await pressKey(Input, { key: ' ', keyCode: 32, modifiers: MOD.shift }); // select whole row
      await pressKey(Input, { key: '-', keyCode: 189, modifiers: MOD.ctrl | MOD.alt }); // delete row
      await new Promise((r) => setTimeout(r, 300));
    }

    // Find the next empty row via column A.
    await pressKey(Input, { key: 'Home', keyCode: 36, modifiers: MOD.ctrl }); // -> A1
    await pressKey(Input, { key: 'ArrowDown', keyCode: 40, modifiers: MOD.ctrl }); // -> last non-empty row in A
    await pressKey(Input, { key: 'ArrowDown', keyCode: 40 }); // -> first empty row
    await new Promise((r) => setTimeout(r, 200));

    const startCell = await readNameBox(Runtime);
    logger.info('sheet-cdp: appending row', { jobId, caseId, startCell });

    for (let i = 0; i < row.length; i++) {
      await typeText(Input, row[i]);
      await pressKey(Input, i < row.length - 1 ? { key: 'Tab', keyCode: 9 } : { key: 'Enter', keyCode: 13 });
    }
    await new Promise((r) => setTimeout(r, 300));

    const endCell = await readNameBox(Runtime);
    if (!endCell || endCell === startCell) {
      throw new Error(`sheet-cdp: cursor did not advance after typing (still at ${endCell ?? 'unknown'}) -- write likely failed`);
    }

    logger.info('sheet-cdp: row appended', { jobId, caseId, startCell, endCell });
  } catch (err) {
    try {
      const png = await screenshot(Page);
      logger.saveScreenshot(jobId, png);
    } catch (screenshotErr) {
      logger.warn('sheet-cdp: also failed to capture a failure screenshot', { error: String(screenshotErr) });
    }
    throw err;
  } finally {
    await client.close();
  }
}
