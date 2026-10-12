import { config } from './config.js';
import { logger } from './logger.js';
import { startRealtimeListener } from './realtime-listener.js';
import { drainPendingJobs } from './job-processor.js';

logger.info('sheet-bot: starting', { sheetUrl: config.sheetUrl, pollIntervalMs: config.pollIntervalMs });

startRealtimeListener(() => {
  drainPendingJobs().catch((err) => logger.error('sheet-bot: drain (from ping) crashed', { error: String(err) }));
});

setInterval(() => {
  drainPendingJobs().catch((err) => logger.error('sheet-bot: drain (from poll) crashed', { error: String(err) }));
}, config.pollIntervalMs);

// Also try once at startup, in case a job was left pending from before this process
// last ran (e.g. after a PC reboot).
drainPendingJobs().catch((err) => logger.error('sheet-bot: initial drain crashed', { error: String(err) }));

process.on('unhandledRejection', (err) => logger.error('sheet-bot: unhandled rejection', { error: String(err) }));
