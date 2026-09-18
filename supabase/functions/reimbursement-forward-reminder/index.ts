/* Friday morning: what is sitting with Accounts, waiting to be forwarded.
 *
 * Deliberately NOT the same job as receive-reminder-mailer. That one chases steps that have landed
 * and not been OPENED, every 12 hours, at whoever they landed on. This one is the opposite end of
 * the same step: already received, worked or not, and still not moved on. Nagging daily about a
 * claim somebody is actively working would be noise, so it is weekly and it goes to one person.
 *
 * The recipient is passed in by the cron job rather than compiled in, so moving it to a different
 * person is a one-line change to the schedule and not a redeploy.
 *
 * ?dry=1 renders the mail and returns it WITHOUT sending, so the thing can be checked without
 * putting a test message in a real person's inbox.
 */
import { SMTPClient } from "https://deno.land/x/denomailer@1.6.0/mod.ts";

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
};
const j = (o: any, s = 200) =>
  new Response(JSON.stringify(o), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } });
const esc = (s: any) =>
  String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const IST = 'en-IN';
const dayStr = (iso: string) =>
  iso ? new Date(iso).toLocaleDateString(IST, { day: '2-digit', month: 'short', timeZone: 'Asia/Kolkata' }) : '—';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });

  const GU = Deno.env.get('GMAIL_USER'), GP = Deno.env.get('GMAIL_APP_PASSWORD');
  const SB = Deno.env.get('SUPABASE_URL'), SRV = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const PORTAL = (Deno.env.get('PORTAL_URL') || 'https://jaingroupe.netlify.app').replace(/\/$/, '');
  const u = new URL(req.url);
  const dry = u.searchParams.get('dry') === '1';

  let body: any = {};
  try { body = await req.json(); } catch (_) { /* cron may post an empty body */ }
  const to = String(body?.to || u.searchParams.get('to') || '').trim();
  if (!to) return j({ error: 'No recipient. Pass {"to":"someone@thejaingroup.com"}.' }, 400);

  if (!dry && (!GU || !GP)) return j({ error: 'Gmail secrets (GMAIL_USER / GMAIL_APP_PASSWORD) are not set.' }, 500);

  const H = { apikey: SRV!, Authorization: 'Bearer ' + SRV, 'Content-Type': 'application/json' };
  const br = await fetch(SB + '/rest/v1/rpc/reimbursement_forward_batch', {
    method: 'POST', headers: H, body: JSON.stringify({ p_email: to }),
  });
  const items = await br.json();
  if (!Array.isArray(items)) return j({ error: 'query failed', detail: items }, 500);

  /* Nothing waiting is not a failure and is not worth an email. An inbox that gets a "nothing to
     do" note every Friday teaches the reader to skip the one Friday it matters. */
  if (!items.length) return j({ ok: true, sent: 0, to, message: 'Nothing received-and-unforwarded — no mail sent.' });

  const n = items.length;
  const overdue = items.filter((x: any) => x.overdue).length;
  const oldest = items.reduce((a: number, x: any) => Math.max(a, Number(x.days_held) || 0), 0);

  const subject = n === 1
    ? 'Reimbursement #' + items[0].case_no + ' is waiting to be forwarded'
    : n + ' reimbursements are waiting to be forwarded';

  const LOGO = PORTAL + '/assets/jaine-logo-full-white.png';
  const HEADER = "<div style='background:#0a0a0c;background:linear-gradient(180deg,#0a0a0c,#171719);padding:16px 24px;border-bottom:2px solid #e0121c'><table role='presentation' cellpadding='0' cellspacing='0' border='0'><tr><td style='vertical-align:middle;padding-right:13px'><img src='" + LOGO + "' alt='JAIN-E' height='24' style='display:block;height:24px;width:auto;border:0'></td><td style='vertical-align:middle'><span style='color:#c7c7ca;font-size:12px;font-weight:600;letter-spacing:1.6px;text-transform:uppercase'>Reimbursement</span></td></tr></table></div>";
  const FOOT = "<div style='padding:14px 24px;background:#f8fafc;border-top:1px solid #e2e8f0'><p style='margin:0;color:#94a3b8;font-size:12px;line-height:1.5'>Automated weekly summary from the JAIN-E Accountability &middot; Workflow module, sent every Friday morning. Please do not reply to this email.</p></div>";
  const shell = (inner: string) =>
    "<div style='margin:0;padding:24px;background:#f1f5f9;font-family:Segoe UI,Arial,sans-serif'><div style='max-width:640px;margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #e2e8f0'>"
    + HEADER + "<div style='padding:24px'>" + inner + "</div>" + FOOT + "</div></div>";

  const linkFor = (x: any) => x.task_id ? (PORTAL + '/tasks.html#/task/' + x.task_id) : (PORTAL + '/tasks.html#/tasks/work');

  const text = 'Good morning,\n\n'
    + n + ' reimbursement' + (n === 1 ? '' : 's') + ' ' + (n === 1 ? 'has' : 'have') + ' been received by you and not yet forwarded'
    + (overdue ? (' (' + overdue + ' past due)') : '') + ':\n\n'
    + items.map((x: any) =>
        '- #' + x.case_no + ' | raised by ' + (x.raised_by || '—')
        + ' | received ' + dayStr(x.received_at)
        + ' | held ' + x.days_held + 'd' + (x.overdue ? ' | OVERDUE' : '')
        + '\n  ' + linkFor(x)).join('\n')
    + '\n\nOpen each one and forward it to complete the step.\n\nJAIN-E Workflow (automated message, please do not reply).';

  const rows = items.map((x: any) =>
      "<tr>"
    + "<td style='padding:9px 10px;border-top:1px solid #eef2f6;color:#0f172a;font-size:13px;white-space:nowrap'><b>#" + esc(x.case_no) + "</b></td>"
    + "<td style='padding:9px 10px;border-top:1px solid #eef2f6;color:#334155;font-size:13px'>" + esc(x.raised_by || '—') + "</td>"
    + "<td style='padding:9px 10px;border-top:1px solid #eef2f6;color:#64748b;font-size:13px;white-space:nowrap'>" + esc(dayStr(x.received_at)) + "</td>"
    + "<td style='padding:9px 10px;border-top:1px solid #eef2f6;font-size:13px;white-space:nowrap;font-weight:600;color:" + (x.overdue ? '#e0121c' : '#64748b') + "'>" + esc(x.days_held) + "d" + (x.overdue ? ' &middot; overdue' : '') + "</td>"
    + "<td style='padding:9px 10px;border-top:1px solid #eef2f6;text-align:right;white-space:nowrap'><a href='" + linkFor(x) + "' style='color:#e0121c;text-decoration:none;font-weight:600;font-size:13px'>Open &rarr;</a></td>"
    + "</tr>").join('');

  const th = (label: string, align = 'left') =>
    "<th style='padding:7px 10px;background:#f8fafc;border-bottom:1px solid #e2e8f0;color:#64748b;font-size:10.5px;text-transform:uppercase;letter-spacing:.5px;text-align:" + align + "'>" + label + "</th>";

  const html = shell(
      "<p style='margin:0 0 12px;color:#0f172a;font-size:15px'>Good morning,</p>"
    + "<p style='margin:0 0 18px;color:#334155;font-size:14px;line-height:1.6'><b>" + n + "</b> reimbursement" + (n === 1 ? '' : 's') + " " + (n === 1 ? 'has' : 'have') + " been received by you and "
    + "<b style='color:#e0121c'>not yet forwarded</b>"
    + (overdue ? (", of which <b style='color:#e0121c'>" + overdue + "</b> " + (overdue === 1 ? 'is' : 'are') + " past due") : "")
    + (oldest > 0 ? (". The oldest has been held <b>" + oldest + " day" + (oldest === 1 ? '' : 's') + "</b>") : "")
    + ".</p>"
    + "<table style='width:100%;border-collapse:collapse;margin:0 0 18px;border:1px solid #e2e8f0;border-radius:8px'><thead><tr>"
    + th('Claim') + th('Raised by') + th('Received') + th('Held') + th('', 'right')
    + "</tr></thead><tbody>" + rows + "</tbody></table>"
    + "<div style='margin:0;padding:12px 14px;background:#fffbeb;border:1px solid #fde68a;border-radius:8px;color:#92400e;font-size:13px;line-height:1.55'>Open each claim and <b>forward</b> it to complete your step. This summary is sent once a week, on Friday morning.</div>"
  );

  if (dry) return j({ ok: true, dryRun: true, to, count: n, overdue, oldestDaysHeld: oldest, subject, text, html });

  let client: any = null;
  try {
    client = new SMTPClient({ connection: { hostname: 'smtp.gmail.com', port: 465, tls: true, auth: { username: GU!, password: GP! } } });
  } catch (e) { return j({ error: 'SMTP connect failed', detail: String(e) }, 500); }

  try {
    await client.send({ from: GU!, to, subject, content: text, html });
  } catch (e) {
    try { await client.close(); } catch (_) { /* ignore */ }
    return j({ error: 'send failed', to, detail: String(e) }, 500);
  }
  try { await client.close(); } catch (_) { /* ignore */ }

  return j({ ok: true, sent: 1, to, count: n, overdue, oldestDaysHeld: oldest });
});
