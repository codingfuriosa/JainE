// Low-level chrome.debugger primitives shared by every automation in this extension --
// the same DevTools Protocol calls a standalone CDP client (chrome-remote-interface)
// would issue, just against a tab in this browser instead of a separate Chrome process.
// Input dispatched this way is trusted input as far as the page is concerned, unlike a
// synthetic DOM event a content script would dispatch (which most real web apps,
// including Google Sheets, ignore).

export const MOD = { ctrl: 2, alt: 1, shift: 8 };

export function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

export function sendCommand(tabId, method, params = {}) {
  return new Promise((resolve, reject) => {
    chrome.debugger.sendCommand({ tabId }, method, params, (result) => {
      if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
      else resolve(result);
    });
  });
}

export async function attach(tabId) {
  await new Promise((resolve, reject) => {
    chrome.debugger.attach({ tabId }, '1.3', () => {
      if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
      else resolve();
    });
  });
}

export function detach(tabId) {
  return new Promise((resolve) => chrome.debugger.detach({ tabId }, resolve));
}

export async function pressKey(tabId, { key, code, keyCode, modifiers = 0 }) {
  const common = { key, code, windowsVirtualKeyCode: keyCode, nativeVirtualKeyCode: keyCode, modifiers };
  await sendCommand(tabId, 'Input.dispatchKeyEvent', { type: 'keyDown', ...common });
  await sendCommand(tabId, 'Input.dispatchKeyEvent', { type: 'keyUp', ...common });
}

// A keyDown carrying `text` produces that character as real input.
export async function typeText(tabId, text) {
  for (const ch of String(text)) {
    await sendCommand(tabId, 'Input.dispatchKeyEvent', { type: 'keyDown', text: ch });
    await sendCommand(tabId, 'Input.dispatchKeyEvent', { type: 'keyUp', text: ch });
  }
}

export async function click(tabId, x, y) {
  await sendCommand(tabId, 'Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
  await sendCommand(tabId, 'Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
}

export async function evaluate(tabId, expression) {
  const { result, exceptionDetails } = await sendCommand(tabId, 'Runtime.evaluate', { expression, returnByValue: true });
  if (exceptionDetails) throw new Error(`page evaluation failed: ${exceptionDetails.text}`);
  return result?.value;
}

export async function screenshotAndSave(tabId, jobId) {
  try {
    const { data } = await sendCommand(tabId, 'Page.captureScreenshot', { format: 'png' });
    await chrome.downloads.download({
      url: `data:image/png;base64,${data}`,
      filename: `jaine-automation-logs/job-${jobId}-${Date.now()}.png`,
      saveAs: false,
    });
  } catch (err) {
    console.warn('cdp-input: failed to capture/save a failure screenshot', err);
  }
}

/** Finds an already-open tab matching urlPattern, or opens a new (inactive) one and
 *  waits for it to finish loading. */
export async function findOrOpenTab(urlPattern, openUrl) {
  const tabs = await chrome.tabs.query({ url: urlPattern });
  if (tabs.length > 0) return tabs[0].id;

  const created = await chrome.tabs.create({ url: openUrl, active: false });
  await new Promise((resolve) => {
    function onUpdated(tabId, info) {
      if (tabId === created.id && info.status === 'complete') {
        chrome.tabs.onUpdated.removeListener(onUpdated);
        resolve();
      }
    }
    chrome.tabs.onUpdated.addListener(onUpdated);
  });
  return created.id;
}
