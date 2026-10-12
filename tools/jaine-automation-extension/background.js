import { getConfig } from './lib/config.js';
import { claimSheetJob, finishSheetJob, claimAutomationJob, finishAutomationJob } from './lib/supabase-rpc.js';
import { SHEET_JOB_HANDLER, runAutomationJob } from './lib/job-handlers.js';

const ALARM_NAME = 'jaine-automation-poll';
const POLL_MINUTES = 1; // chrome.alarms' own minimum period

chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create(ALARM_NAME, { periodInMinutes: POLL_MINUTES });
});
chrome.runtime.onStartup.addListener(() => {
  chrome.alarms.create(ALARM_NAME, { periodInMinutes: POLL_MINUTES });
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM_NAME) drainEverything().catch((err) => console.error('jaine-automation: poll drain crashed', err));
});

// Lets the popup trigger an immediate run (and reports back a short result summary).
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === 'run-now') {
    drainEverything()
      .then((summary) => sendResponse({ ok: true, summary }))
      .catch((err) => sendResponse({ ok: false, error: String(err?.message ?? err) }));
    return true; // keep the message channel open for the async response
  }
});

async function drainEverything() {
  const config = await getConfig(); // throws if the core Supabase/Claude settings are missing
  const summary = [];

  if (config.sheetBotSecret && config.sheetUrl) {
    const n = await drainQueue(config, {
      claim: claimSheetJob,
      finish: finishSheetJob,
      run: SHEET_JOB_HANDLER,
      label: 'sheet_jobs',
    });
    summary.push(`sheet_jobs: ${n} processed`);
  } else {
    summary.push('sheet_jobs: not configured, skipped');
  }

  if (config.automationBotSecret) {
    const n = await drainQueue(config, {
      claim: claimAutomationJob,
      finish: finishAutomationJob,
      run: runAutomationJob,
      label: 'automation_jobs',
    });
    summary.push(`automation_jobs: ${n} processed`);
  } else {
    summary.push('automation_jobs: not configured, skipped');
  }

  return summary.join('; ');
}

async function drainQueue(config, { claim, finish, run, label }) {
  let count = 0;
  let more = true;
  while (more) {
    more = await processOneJob(config, { claim, finish, run, label });
    if (more) count++;
  }
  return count;
}

async function processOneJob(config, { claim, finish, run, label }) {
  const job = await claim(config);
  if (!job) return false; // nothing pending for this queue

  const jobId = job.job_id;
  console.log(`jaine-automation: claimed ${label} job`, { jobId, job });

  try {
    const { ok, note } = await run(config, job);
    await finish(config, jobId, ok, note);
    console.log(`jaine-automation: ${label} job finished`, { jobId, ok });
  } catch (err) {
    const note = String(err?.message ?? err);
    console.error(`jaine-automation: ${label} job failed`, { jobId, error: note });
    await finish(config, jobId, false, note).catch((finishErr) => {
      console.error('jaine-automation: also failed to report failure back to Supabase', finishErr);
    });
  }

  return true; // there might be more pending in this queue
}
