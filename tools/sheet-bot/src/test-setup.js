// Imported first (for its side effect) by any test file whose module graph touches
// config.js, so config's fail-fast validation has something to validate against
// without needing a real .env file in CI/local test runs.
for (const [key, value] of Object.entries({
  SUPABASE_URL: 'http://localhost:0',
  SUPABASE_ANON_KEY: 'test-anon-key',
  SHEET_BOT_SECRET: 'test-secret',
  ANTHROPIC_API_KEY: 'test-api-key',
  SHEET_URL: 'http://localhost:0/test-sheet',
  CHROME_DEBUG_PORT: '9222',
})) {
  process.env[key] ??= value;
}
