// Two separate queues, two separate reasons:
//
// - acc.sheet_jobs: one proven, deterministic pipeline (Booking Form -> Google
//   Sheet). Always runs the same handler; never falls back to the agentic runner,
//   because this one touches real financial/KYC data and deserves purpose-built,
//   reviewable, testable code -- not live LLM judgment calls.
//
// - acc.automation_jobs: the universal queue. Any JainE event, or a person, can
//   enqueue a job describing what to do. A specific `kind` gets its own handler here
//   when one has been written for it; anything else falls back to the agentic runner
//   (lib/agentic-runner.js), bounded by a step cap and a host allowlist.
//
// To add a real handler for a new automation_jobs `kind` later: write a function
// with the same (config, job) -> {ok, note} shape as runSheetAppendBooking below,
// and add it to AUTOMATION_HANDLERS. Nothing else needs to change.

import { buildRow, getAadhaarCandidates, SHEET_COLUMNS } from './mapping.js';
import { pickPrimaryApplicantAadhaar } from './claude-decision.js';
import { appendBookingRow } from './sheet-automation.js';
import { runAgenticJob } from './agentic-runner.js';

async function runSheetAppendBooking(config, job) {
  const { job_id: jobId, case_id: caseId, audit_result: result } = job;

  const candidates = getAadhaarCandidates(result);
  const aadhaarNumber = await pickPrimaryApplicantAadhaar(
    config,
    candidates,
    result?.fields?.customer_name?.value,
    result?.fields?.customer_pan?.value
  );

  const row = buildRow(result, caseId, aadhaarNumber);
  console.log('sheet_append_booking: mapped row', { jobId, caseId, columns: SHEET_COLUMNS.length });

  await appendBookingRow({ sheetUrl: config.sheetUrl, caseId, row, jobId });
  return { ok: true, note: 'row appended' };
}

export const SHEET_JOB_HANDLER = runSheetAppendBooking;

// Purpose-built handlers for specific acc.automation_jobs `kind`s. Empty today --
// every universal job currently runs through the agentic fallback below.
export const AUTOMATION_HANDLERS = {};

export async function runAutomationJob(config, job) {
  const handler = AUTOMATION_HANDLERS[job.kind];
  if (handler) return handler(config, job);

  if (!job.instructions) {
    return { ok: false, note: `no handler for kind "${job.kind}" and no instructions to fall back on` };
  }
  return runAgenticJob({ instructions: job.instructions, payload: job.payload, jobId: job.job_id, config });
}
