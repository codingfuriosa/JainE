import 'dotenv/config';

const REQUIRED = [
  'SUPABASE_URL',
  'SUPABASE_ANON_KEY',
  'SHEET_BOT_SECRET',
  'ANTHROPIC_API_KEY',
  'SHEET_URL',
  'CHROME_DEBUG_PORT',
];

const missing = REQUIRED.filter((key) => !process.env[key]);
if (missing.length > 0) {
  throw new Error(
    `sheet-bot: missing required env var(s): ${missing.join(', ')}. Copy .env.example to .env and fill them in.`
  );
}

export const config = Object.freeze({
  supabaseUrl: process.env.SUPABASE_URL,
  supabaseAnonKey: process.env.SUPABASE_ANON_KEY,
  sheetBotSecret: process.env.SHEET_BOT_SECRET,
  anthropicApiKey: process.env.ANTHROPIC_API_KEY,
  sheetUrl: process.env.SHEET_URL,
  chromeDebugPort: Number(process.env.CHROME_DEBUG_PORT),
  pollIntervalMs: Number(process.env.POLL_INTERVAL_MS ?? 180000),
  logDir: process.env.LOG_DIR ?? './logs',
});
