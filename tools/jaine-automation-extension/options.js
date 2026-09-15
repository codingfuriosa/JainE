import { setConfig, ALL_FIELDS as FIELDS } from './lib/config.js';

async function load() {
  const stored = await chrome.storage.local.get(FIELDS);
  for (const key of FIELDS) {
    document.getElementById(key).value = stored[key] ?? '';
  }
}

document.getElementById('save').addEventListener('click', async () => {
  const values = {};
  for (const key of FIELDS) values[key] = document.getElementById(key).value.trim();
  await setConfig(values);
  const status = document.getElementById('status');
  status.textContent = 'Saved.';
  setTimeout(() => { status.textContent = ''; }, 2000);
});

load();
