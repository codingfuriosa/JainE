// Same RPC pattern as tools/erp-bot's watcher: a shared secret authenticates against
// acc.job_secrets via a SECURITY DEFINER function, not a user JWT.

async function callRpc(config, name, args) {
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
    throw new Error(`RPC ${name} failed (${res.status}): ${body}`);
  }

  // acc.sheet_job_finish returns void -> PostgREST sends an empty body (204/200 with
  // nothing in it). Only parse JSON when there's actually a body to parse -- this was
  // the bug in the standalone Node prototype: it always called res.json() and threw
  // "Unexpected end of JSON input" on every finish call, even successful ones.
  const text = await res.text();
  if (!text) return null;
  return JSON.parse(text);
}

/** Claims one pending job. Returns null if nothing is pending, otherwise
 *  { job_id, case_id, case_no, audit_result }. */
export async function claimSheetJob(config) {
  const rows = await callRpc(config, 'sheet_job_claim', { p_secret: config.sheetBotSecret });
  return rows?.[0] ?? null;
}

export async function finishSheetJob(config, jobId, ok, note) {
  await callRpc(config, 'sheet_job_finish', {
    p_secret: config.sheetBotSecret,
    p_job_id: jobId,
    p_ok: ok,
    p_note: note,
  });
}

/** Claims one pending job from the universal queue. Returns null if nothing is
 *  pending, otherwise { job_id, kind, instructions, payload }. */
export async function claimAutomationJob(config) {
  const rows = await callRpc(config, 'automation_job_claim', { p_secret: config.automationBotSecret });
  return rows?.[0] ?? null;
}

export async function finishAutomationJob(config, jobId, ok, note) {
  await callRpc(config, 'automation_job_finish', {
    p_secret: config.automationBotSecret,
    p_job_id: jobId,
    p_ok: ok,
    p_note: note,
  });
}
