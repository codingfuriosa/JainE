// Fallback for any acc.automation_jobs job whose `kind` has no purpose-built handler
// in lib/job-handlers.js: Claude reads the page (as a numbered list of interactive
// elements, not a screenshot -- see lib/dom-snapshot.js) and decides one action at a
// time, in a loop bounded by MAX_STEPS. This trades reliability for flexibility on
// purpose -- anything worth running often or touching sensitive data should get a
// real handler instead (see lib/sheet-automation.js for why: it's what proved out
// the field mapping against real data).
//
// Safety rails, all real constraints rather than best-effort prompting alone:
//   - MAX_STEPS hard-caps how much it can do before being forced to stop and fail.
//   - `navigate` is only allowed to hosts already in this extension's own
//     host_permissions (manifest.json) -- there is no way for a job's instructions
//     to make this extension act on a site nobody explicitly allowed it to touch.
//   - The system prompt instructs Claude to refuse purchases/deletions/irreversible
//     actions and fail with a note instead -- this part IS only prompting, not a hard
//     technical guarantee, and is disclosed as such rather than oversold.

import { MOD, sleep, attach, detach, pressKey, typeText, click, screenshotAndSave, findOrOpenTab } from './cdp-input.js';
import { snapshotInteractiveElements } from './dom-snapshot.js';

const MAX_STEPS = 20;

const ACTION_TOOL = {
  name: 'browser_action',
  description: 'The single next action to take on the page.',
  input_schema: {
    type: 'object',
    properties: {
      action: { type: 'string', enum: ['click', 'type', 'key', 'scroll', 'navigate', 'done', 'fail'] },
      element_index: { type: 'integer', description: 'Required for click/type: the index from the element list.' },
      text: { type: 'string', description: 'Required for type: the text to type into the element.' },
      key: { type: 'string', description: 'Required for key: e.g. Enter, Tab, Escape.' },
      direction: { type: 'string', enum: ['up', 'down'], description: 'Required for scroll.' },
      url: { type: 'string', description: 'Required for navigate.' },
      note: { type: 'string', description: 'Required for done/fail: what happened.' },
    },
    required: ['action'],
  },
};

function allowedHosts() {
  const patterns = chrome.runtime.getManifest().host_permissions ?? [];
  return patterns
    .map((p) => p.match(/^https?:\/\/([^/]+)\//)?.[1])
    .filter(Boolean)
    .filter((h) => !h.includes('supabase.co') && h !== 'api.anthropic.com');
}

async function decideNextAction(config, instructions, snapshot, history) {
  const prompt = `You are operating a web browser to accomplish a task. You act ONE step at a time -- ` +
    `look at the current page, call the browser_action tool with exactly one action, and you'll be shown ` +
    `the result before deciding the next one.\n\n` +
    `TASK: ${instructions}\n\n` +
    `RULES:\n` +
    `- Never submit a payment, place an order, or delete/discard anything you can't undo. If the task seems ` +
    `to require one of those, call browser_action with action="fail" and explain why in "note".\n` +
    `- If the task looks complete, call action="done" with a short "note" describing what you did.\n` +
    `- You may only navigate to a URL on one of these hosts: ${allowedHosts().join(', ') || '(none configured)'}.\n\n` +
    `Steps so far: ${history.length === 0 ? '(none yet)' : history.map((h, i) => `${i + 1}. ${h}`).join('\n')}\n\n` +
    `Current page: ${snapshot.title} (${snapshot.url})\n` +
    `Visible interactive elements:\n${snapshot.elements.map((e) =>
      `[${e.index}] <${e.tag}${e.role ? ' role=' + e.role : ''}> "${e.text}"`
    ).join('\n')}`;

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': config.anthropicApiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-5',
      max_tokens: 500,
      tools: [ACTION_TOOL],
      tool_choice: { type: 'tool', name: 'browser_action' },
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  if (!res.ok) throw new Error(`agentic-runner: Claude call failed (${res.status})`);
  const data = await res.json();
  const toolUse = data?.content?.find((b) => b.type === 'tool_use');
  if (!toolUse) throw new Error('agentic-runner: Claude did not return a browser_action');
  return toolUse.input;
}

async function executeAction(tabId, action, snapshot) {
  switch (action.action) {
    case 'click': {
      const el = snapshot.elements[action.element_index];
      if (!el) throw new Error(`agentic-runner: no element at index ${action.element_index}`);
      await click(tabId, el.x, el.y);
      return `clicked [${action.element_index}] "${el.text}"`;
    }
    case 'type': {
      const el = snapshot.elements[action.element_index];
      if (!el) throw new Error(`agentic-runner: no element at index ${action.element_index}`);
      await click(tabId, el.x, el.y);
      await sleep(150);
      await typeText(tabId, action.text ?? '');
      return `typed "${action.text}" into [${action.element_index}] "${el.text}"`;
    }
    case 'key':
      await pressKey(tabId, keyDefFor(action.key));
      return `pressed ${action.key}`;
    case 'scroll':
      await pressKey(tabId, action.direction === 'up'
        ? { key: 'PageUp', code: 'PageUp', keyCode: 33 }
        : { key: 'PageDown', code: 'PageDown', keyCode: 34 });
      return `scrolled ${action.direction}`;
    case 'navigate': {
      const host = new URL(action.url).host;
      if (!allowedHosts().includes(host)) {
        throw new Error(`agentic-runner: refusing to navigate to disallowed host "${host}" -- add it to manifest.json host_permissions first`);
      }
      await chrome.tabs.update(tabId, { url: action.url });
      await sleep(1500);
      return `navigated to ${action.url}`;
    }
    default:
      throw new Error(`agentic-runner: unknown action "${action.action}"`);
  }
}

function keyDefFor(key) {
  const table = {
    Enter: { key: 'Enter', code: 'Enter', keyCode: 13 },
    Tab: { key: 'Tab', code: 'Tab', keyCode: 9 },
    Escape: { key: 'Escape', code: 'Escape', keyCode: 27 },
  };
  return table[key] ?? { key, code: key, keyCode: 0 };
}

/** Runs an automation_jobs job with no dedicated handler: instructions + a starting
 *  URL in payload.url, executed by Claude deciding one bounded action at a time. */
export async function runAgenticJob({ instructions, payload, jobId, config }) {
  if (!payload?.url) throw new Error('agentic-runner: payload.url is required (the page to start on)');

  const host = new URL(payload.url).host;
  if (!allowedHosts().includes(host)) {
    throw new Error(`agentic-runner: "${host}" is not in this extension's host_permissions -- add it to manifest.json first`);
  }

  const tabId = await findOrOpenTab(`*://${host}/*`, payload.url);
  await attach(tabId);
  await chrome.tabs.update(tabId, { active: true });

  const history = [];
  try {
    for (let step = 0; step < MAX_STEPS; step++) {
      await sleep(400);
      const snapshot = await snapshotInteractiveElements(tabId);
      const action = await decideNextAction(config, instructions, snapshot, history);

      if (action.action === 'done') return { ok: true, note: action.note ?? 'done' };
      if (action.action === 'fail') return { ok: false, note: action.note ?? 'agent declined to continue' };

      const description = await executeAction(tabId, action, snapshot);
      history.push(description);
      console.log('agentic-runner: step', { jobId, step, description });
    }
    throw new Error(`agentic-runner: reached the ${MAX_STEPS}-step limit without finishing`);
  } catch (err) {
    await screenshotAndSave(tabId, jobId);
    throw err;
  } finally {
    await detach(tabId);
  }
}
