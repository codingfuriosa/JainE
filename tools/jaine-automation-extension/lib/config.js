// Settings live in chrome.storage.local (per-browser, not synced -- these are secrets)
// rather than env vars, since there's no process environment inside an extension.
// Set them from the extension's options page.

// Needed for every job kind (the connection to Supabase/Claude itself).
const CORE = ['supabaseUrl', 'supabaseAnonKey', 'anthropicApiKey'];
// Needed only by the specific job kind that uses it -- checked separately by each
// kind's own drain loop in background.js, so a not-yet-configured kind (e.g. the
// universal automation queue, before its secret is filled in) doesn't block a
// kind that IS configured (e.g. the Sheet pipeline).
export const ALL_FIELDS = [...CORE, 'sheetBotSecret', 'sheetUrl', 'automationBotSecret'];

export async function getConfig() {
  const stored = await chrome.storage.local.get(ALL_FIELDS);
  const missing = CORE.filter((key) => !stored[key]);
  if (missing.length > 0) {
    throw new Error(`JainE Automation: missing setting(s): ${missing.join(', ')} -- open the extension's options page.`);
  }
  return stored;
}

export async function setConfig(values) {
  await chrome.storage.local.set(values);
}
