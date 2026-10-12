// Runs exactly one claim -> map -> append -> finish cycle, then exits.
// Point SHEET_URL (in .env) at a TEST COPY of the real Sheet before running this --
// see README.md's staged rollout.
import '../src/config.js';
import { logger } from '../src/logger.js';
import { drainPendingJobs } from '../src/job-processor.js';

logger.info('smoke-test-once: draining whatever is pending, once');
await drainPendingJobs();
logger.info('smoke-test-once: done -- check the Sheet and the log file above');
process.exit(0);
