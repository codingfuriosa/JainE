import { config } from './config.js';
import { logger } from './logger.js';
import { claimJob, finishJob } from './supabase-rpc.js';
import { buildRow, getAadhaarCandidates, SHEET_COLUMNS } from './mapping.js';
import { pickPrimaryApplicantAadhaar } from './claude-decision.js';
import { appendBookingRow } from './sheet-cdp.js';

let processing = false;

async function processOneJob() {
  const job = await claimJob();
  if (!job) return false; // nothing pending

  const { job_id: jobId, case_id: caseId, audit_result: result } = job;
  logger.info('job-processor: claimed job', { jobId, caseId });

  try {
    const candidates = getAadhaarCandidates(result);
    const aadhaarNumber = await pickPrimaryApplicantAadhaar(
      candidates,
      result?.fields?.customer_name?.value,
      result?.fields?.customer_pan?.value
    );

    const row = buildRow(result, caseId, aadhaarNumber);
    logger.info('job-processor: mapped row', { jobId, caseId, columns: SHEET_COLUMNS.length });

    await appendBookingRow({
      chromeDebugPort: config.chromeDebugPort,
      sheetUrl: config.sheetUrl,
      caseId,
      row,
      jobId,
    });

    await finishJob(jobId, true, 'row appended');
    logger.info('job-processor: job done', { jobId, caseId });
  } catch (err) {
    logger.error('job-processor: job failed', { jobId, caseId, error: String(err?.message ?? err) });
    await finishJob(jobId, false, String(err?.message ?? err)).catch((finishErr) => {
      // If even sheet_job_finish fails, the job stays 'running' until the 3-attempt
      // claim logic's own bookkeeping catches up on a later restart -- logging this
      // loudly is more useful than retrying here, since this is a test/prototype pass.
      logger.error('job-processor: also failed to report failure back to Supabase', {
        jobId, error: String(finishErr),
      });
    });
  }

  return true; // there might be more pending, caller should try again immediately
}

/** Drains all currently-pending jobs, one at a time. Safe to call repeatedly (from a
 *  Realtime ping or the poll timer) -- a concurrent call while one is already running
 *  is a no-op, since chrome-remote-interface only drives one browser at a time here. */
export async function drainPendingJobs() {
  if (processing) return;
  processing = true;
  try {
    let more = true;
    while (more) {
      more = await processOneJob();
    }
  } finally {
    processing = false;
  }
}
