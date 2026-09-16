import { config } from './config.js';

async function callRpc(name, args) {
  const res = await fetch(`${config.supabaseUrl}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Profile': 'acc',
      apikey: config.supabaseAnonKey,
      Authorization: `Bearer ${config.supabaseAnonKey}`,
    },
    body: JSON.stringify(args),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`sheet-bot: RPC ${name} failed (${res.status}): ${body}`);
  }
  return res.json();
}

/** Claims one pending job. Returns null if nothing is pending, otherwise
 *  { job_id, case_id, case_no, audit_result }. */
export async function claimJob() {
  const rows = await callRpc('sheet_job_claim', { p_secret: config.sheetBotSecret });
  return rows?.[0] ?? null;
}

export async function finishJob(jobId, ok, note) {
  await callRpc('sheet_job_finish', {
    p_secret: config.sheetBotSecret,
    p_job_id: jobId,
    p_ok: ok,
    p_note: note,
  });
}
