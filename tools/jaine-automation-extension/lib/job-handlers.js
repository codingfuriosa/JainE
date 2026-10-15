// acc.automation_jobs: the universal queue. (The Booking Form -> Google Sheet queue,
// acc.sheet_jobs, was a test and was removed on 15 Oct 2026.) Any JainE event, or a person, can
//   enqueue a job describing what to do. A specific `kind` gets its own handler here
//   when one has been written for it; anything else falls back to the agentic runner
//   (lib/agentic-runner.js), bounded by a step cap and a host allowlist.
//
// To add a real handler for a new automation_jobs `kind` later: write a function
// with the same (config, job) -> {ok, note} shape as the handlers below,
// and add it to AUTOMATION_HANDLERS. Nothing else needs to change.

import { runAgenticJob } from './agentic-runner.js';
import { runMarketValuationJob } from './market-valuation-automation.js';


// Purpose-built handlers for specific acc.automation_jobs `kind`s.
//
// market_valuation: Dream Gurukul / Dream World City bookings, looked up the exact West Bengal
// government Market Value of Apartment figure and written back once a booking is marked done.
// See lib/market-valuation-automation.js -- deliberately ignores which case_id the triggering job
// named and re-derives the whole backlog fresh every run, so a job lost to a closed browser or a
// prior failure gets swept up automatically rather than needing a person to notice and re-run it.
export const AUTOMATION_HANDLERS = {
  market_valuation: (config, _job) => runMarketValuationJob(config),
};

export async function runAutomationJob(config, job) {
  const handler = AUTOMATION_HANDLERS[job.kind];
  if (handler) return handler(config, job);

  if (!job.instructions) {
    return { ok: false, note: `no handler for kind "${job.kind}" and no instructions to fall back on` };
  }
  return runAgenticJob({ instructions: job.instructions, payload: job.payload, jobId: job.job_id, config });
}
