import { evaluate } from './cdp-input.js';

// Gives the agentic runner a numbered list of visible, interactive elements (text +
// click coordinates) instead of a raw screenshot -- Claude picks an element by index
// rather than guessing pixel coordinates from a description, which is both cheaper
// (no vision tokens) and more reliable for standard web UI. Doesn't help against
// canvas-rendered UI like Google Sheets' grid -- that's why the Sheet automation is
// its own purpose-built handler (lib/sheet-automation.js) instead of going through
// the agentic runner.
export async function snapshotInteractiveElements(tabId, max = 60) {
  const expression = `(() => {
    const selector = 'a[href], button, input, textarea, select, [role="button"], [role="link"], [role="checkbox"], [role="tab"], [contenteditable="true"]';
    const els = Array.from(document.querySelectorAll(selector));
    const out = [];
    for (const el of els) {
      const rect = el.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) continue;
      if (rect.bottom < 0 || rect.top > window.innerHeight) continue;
      const style = window.getComputedStyle(el);
      if (style.visibility === 'hidden' || style.display === 'none') continue;
      const label = (el.getAttribute('aria-label') || el.innerText || el.value || el.placeholder || '').trim().slice(0, 120);
      out.push({
        index: out.length,
        tag: el.tagName.toLowerCase(),
        role: el.getAttribute('role') || null,
        type: el.getAttribute('type') || null,
        text: label,
        x: Math.round(rect.left + rect.width / 2),
        y: Math.round(rect.top + rect.height / 2),
      });
      if (out.length >= ${max}) break;
    }
    return { url: location.href, title: document.title, elements: out };
  })()`;
  return evaluate(tabId, expression);
}
