/* The letters HR sends that are not about a test.

     candidate_rejected          -> to the candidate
     referral_decided            -> to the referrer,   FROM ai@thejaingroup.com
     job_description_created     -> to HR,             FROM ai@, PDF attached

   PLAIN, NOT BRANDED. A rejection laid out like marketing reads as careless at the one moment a
   person remembers how they were treated.

   THE 30-MINUTE CHASE FOR UNAPPROVED DESCRIPTIONS IS GONE, by request. Its schedule was removed
   and the branch that served it deleted with it, rather than left behind unreachable: it was the
   one kind here that ran with NO signed-in user - a timer has none - so anyone holding the public
   key could have called it and mailed all four HR inboxes about every pending description. Dead
   code that still answers the door is not dead. Nothing replaces it; a description waiting for
   approval is visible in Accountability, which is where it is dealt with. */
import { SMTPClient } from "https://deno.land/x/denomailer@1.6.0/mod.ts";

// 13 Nov 2026: denomailer 1.6.0 packs html/text as quoted-printable itself and gets it wrong (lower-case =3d, broken wrapping), so some mail apps show raw code.
// Hand it base64 parts instead; every mail app reads them.
function b64Part(mimeType: string, s: string) {
  const bytes = new TextEncoder().encode(s);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  const b64 = btoa(bin).replace(/.{76}(?=.)/g, "$&\r\n");
  return { mimeType: `${mimeType}; charset="utf-8"`, content: b64, transferEncoding: "base64" };
}
function htmlToText(html: string) {
  return html.replace(/<(br|\/p|\/div|\/tr|\/li|\/h[1-6])\s*\/?>/gi, "\n").replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/\n{3,}/g, "\n\n").trim();
}
function mailBody(text: string | undefined, html?: string) {
  const t = text && text.trim() ? text : html ? htmlToText(html) : "";
  return { mimeContent: html ? [b64Part("text/plain", t), b64Part("text/html", html)] : [b64Part("text/plain", t)] };
}
// 14 Nov 2026: denomailer 1.6.0 writes a non-ASCII subject as =?utf-8?Q?...?= WITHOUT escaping spaces or "?" and folds it with "=" line breaks. That is an invalid header, so some
// mail apps then show the WHOLE message as raw source (headers, boundaries, base64). A subject that is plain ASCII is passed through untouched, so make every subject ASCII first.
function asciiSubject(s: string) {
  const M: Record<string, string> = { "—": "-", "–": "-", "‒": "-", "−": "-", "‘": "'", "’": "'", "“": '"', "”": '"', "…": "...", "₹": "Rs.", " ": " ", "•": "-", "·": "-", "×": "x" };
  return String(s ?? "").normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^\x00-\x7f]/g, (c) => M[c] ?? "").replace(/[\r\n]+/g, " ").replace(/\s{2,}/g, " ").trim().replace(/^=\?/, "= ?");
}

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};
const j = (o: any, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } });
const esc = (s: any) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const AI_SENDER = 'ai@thejaingroup.com';
const HR_INBOXES = ['mgr.hr@thejaingroup.com', 'hr@thejaingroup.com', 'career@thejaingroup.com',
                    'ayushruia1@gmail.com'];
const HR_REPLY_TO = 'career@thejaingroup.com';

const b64utf8 = (s: string) => btoa(unescape(encodeURIComponent(s)));
const b64bytes = (u: Uint8Array) => {
  let bin = '';
  for (let i = 0; i < u.length; i += 0x8000) bin += String.fromCharCode(...u.subarray(i, i + 0x8000));
  return btoa(bin).replace(/(.{76})/g, '$1\r\n');
};

/* A mail header is ASCII; anything else travels RFC 2047, or an em dash arrives as three
   Latin-1 characters instead of one. */
function mimeWord(sInput: string) {
  const s = String(sInput || '').replace(/[\r\n]/g, ' ');
  if (!/[^\x20-\x7E]/.test(s)) return s;
  return '=?UTF-8?B?' + b64utf8(s) + '?=';
}

/* A letter is never signed by a login name. "Administrator" is an account, not a person. */
const ROLE_WORDS = /^(admin|administrator|system|system admin|systems|jain-?e|hr|human resources|support|test|user|account)$/i;
function personName(n: string) {
  const s = String(n || '').trim();
  if (!s || ROLE_WORDS.test(s)) return '';
  if (!/\s/.test(s) && s.length < 3) return '';
  return s;
}

async function accessTokenFor(email: string, SB: string, SRV: string, CLIENT_ID?: string, CLIENT_SECRET?: string) {
  if (!CLIENT_ID || !CLIENT_SECRET) return '';
  try {
    const r = await fetch(SB + '/rest/v1/google_tokens?email=eq.' + encodeURIComponent(email)
      + '&select=refresh_token,scope', { headers: { apikey: SRV, Authorization: 'Bearer ' + SRV, 'Accept-Profile': 'acc' } });
    const rows = await r.json();
    const tok = Array.isArray(rows) ? rows[0] : null;
    if (!tok || !tok.refresh_token || String(tok.scope || '').indexOf('gmail.send') === -1) return '';
    const rt = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: CLIENT_ID, client_secret: CLIENT_SECRET,
        refresh_token: tok.refresh_token, grant_type: 'refresh_token'
      })
    });
    const rj = await rt.json();
    return String(rj.access_token || '');
  } catch (_) { return ''; }
}

async function gmailSend(access: string, fromName: string, fromEmail: string, to: string, replyTo: string,
                         subject: string, text: string, html: string, attach?: { filename: string; bytes: Uint8Array }) {
  const ALT = 'alt_' + crypto.randomUUID().replace(/-/g, '');
  const MIX = 'mix_' + crypto.randomUUID().replace(/-/g, '');
  const alt = [
    '--' + ALT,
    'Content-Type: text/plain; charset=UTF-8', 'Content-Transfer-Encoding: base64', '', b64utf8(text),
    '--' + ALT,
    'Content-Type: text/html; charset=UTF-8', 'Content-Transfer-Encoding: base64', '', b64utf8(html),
    '--' + ALT + '--'
  ].join('\r\n');

  const head = [
    'From: ' + mimeWord(fromName) + ' <' + fromEmail + '>',
    'To: ' + to,
    'Reply-To: ' + replyTo,
    'Subject: ' + mimeWord(subject),
    'MIME-Version: 1.0'
  ];

  const raw = attach
    ? head.concat([
        'Content-Type: multipart/mixed; boundary="' + MIX + '"', '',
        '--' + MIX,
        'Content-Type: multipart/alternative; boundary="' + ALT + '"', '',
        alt,
        '--' + MIX,
        'Content-Type: application/pdf; name="' + mimeWord(attach.filename) + '"',
        'Content-Disposition: attachment; filename="' + mimeWord(attach.filename) + '"',
        'Content-Transfer-Encoding: base64', '',
        b64bytes(attach.bytes),
        '--' + MIX + '--', ''
      ]).join('\r\n')
    : head.concat(['Content-Type: multipart/alternative; boundary="' + ALT + '"', '', alt, '']).join('\r\n');

  const b64 = b64utf8(raw).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const gr = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + access, 'Content-Type': 'application/json' },
    body: JSON.stringify({ raw: b64 })
  });
  if (!gr.ok) throw new Error('Gmail HTTP ' + gr.status + ' ' + (await gr.text()).slice(0, 200));
}

function letter(paras: string[], signOff: string) {
  const html = "<div style=\"font-family:Georgia,'Times New Roman',serif;font-size:15px;line-height:1.7;color:#1a1a1a;max-width:560px\">"
    + paras.map(p => "<p style=\"margin:0 0 16px\">" + esc(p).replace(/\n/g, '<br>') + "</p>").join('')
    + "<p style=\"margin:26px 0 0\">" + esc(signOff).replace(/\n/g, '<br>') + "</p></div>";
  return { html, text: paras.join('\n\n') + '\n\n' + signOff };
}

async function deliver(opts: {
  to: string[]; subject: string; text: string; html: string; sendAs: string; fromName: string;
  replyTo: string; attach?: { filename: string; bytes: Uint8Array };
  SB: string; SRV: string; GU?: string; GP?: string; CLIENT_ID?: string; CLIENT_SECRET?: string;
}) {
  const sent: string[] = []; const failed: any[] = [];
  const access = await accessTokenFor(opts.sendAs, opts.SB, opts.SRV, opts.CLIENT_ID, opts.CLIENT_SECRET);
  if (access) {
    for (const addr of opts.to) {
      try { await gmailSend(access, opts.fromName, opts.sendAs, addr, opts.replyTo, opts.subject, opts.text, opts.html, opts.attach); sent.push(addr); }
      catch (e) { failed.push({ to: addr, error: String(e) }); }
    }
    if (sent.length) return { sent, failed, via: 'gmail', sent_as: opts.sendAs };
  }
  if (!opts.GU || !opts.GP) throw new Error(opts.sendAs + ' has not connected Google and the shared mail account is not configured');
  let client: any = null;
  try {
    client = new SMTPClient({ connection: { hostname: 'smtp.gmail.com', port: 465, tls: true, auth: { username: opts.GU, password: opts.GP } } });
    for (const addr of opts.to) {
      try {
        await client.send({
          from: 'The Jain Group <' + opts.GU + '>', to: addr, replyTo: opts.replyTo,
          subject: asciiSubject(opts.subject), ...mailBody(opts.text, opts.html),
          ...(opts.attach ? { attachments: [{ filename: opts.attach.filename, content: opts.attach.bytes, encoding: 'binary', contentType: 'application/pdf' }] } : {})
        });
        sent.push(addr);
      } catch (e) { failed.push({ to: addr, error: String(e) }); }
    }
  } finally { try { if (client) await client.close(); } catch (_) { /* nothing to do */ } }
  return { sent, failed, via: 'shared', sent_as: opts.GU, not_connected: opts.sendAs };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return j({ error: 'method not allowed' }, 405);

  const SB = Deno.env.get('SUPABASE_URL');
  const SRV = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const ANON = Deno.env.get('SUPABASE_ANON_KEY');
  const GU = Deno.env.get('GMAIL_USER');
  const GP = Deno.env.get('GMAIL_APP_PASSWORD');
  const CLIENT_ID = Deno.env.get('GOOGLE_CLIENT_ID');
  const CLIENT_SECRET = Deno.env.get('GOOGLE_CLIENT_SECRET');
  if (!SB || !SRV) return j({ error: 'server not configured' }, 500);

  let body: any = {};
  try { body = await req.json(); } catch (_) { /* validated below */ }
  const kind = String(body?.kind || '').trim();

  const H = { apikey: SRV, Authorization: 'Bearer ' + SRV, 'Content-Type': 'application/json' } as any;

  /* OVERDUE INTERVIEWS (23 Nov 2026). The one letter here with no person behind it: the hourly
     cron (hr.pi_kick_overdue) proves itself with x-hr-secret = acc.job_secrets 'hr_notify'. Any
     interview whose time passed over an hour ago with no result recorded is chased - its holders
     are told to record Selected / Hold / Rejected or reschedule - once, then again every 24 hours
     until somebody does. */
  if (kind === 'interviews_overdue') {
    const sec = req.headers.get('x-hr-secret') || '';
    let okSecret = false;
    try {
      const r = await fetch(SB + '/rest/v1/job_secrets?name=eq.hr_notify&select=value', { headers: { ...H, 'Accept-Profile': 'acc' } });
      const rows = await r.json();
      okSecret = !!sec && Array.isArray(rows) && rows[0] && rows[0].value === sec;
    } catch (_) { okSecret = false; }
    if (!okSecret) return j({ error: 'not allowed' }, 401);

    const hourAgo = new Date(Date.now() - 3600e3).toISOString();
    const dayAgo = new Date(Date.now() - 23 * 3600e3).toISOString();
    const q = SB + '/rest/v1/interviews?decision=is.null&scheduled_at=lt.' + encodeURIComponent(hourAgo)
      + '&or=' + encodeURIComponent('(overdue_mailed_at.is.null,overdue_mailed_at.lt.' + dayAgo + ')')
      + '&select=id,scheduled_at,holders,candidate_id,candidates(name,position)';
    const due = await (await fetch(q, { headers: { ...H, 'Accept-Profile': 'hr' } })).json();
    if (!Array.isArray(due)) return j({ error: 'could not read interviews', detail: due }, 500);
    const PORTAL = (Deno.env.get('PORTAL_URL') || 'https://jaingroupe.netlify.app').replace(/\/$/, '');
    const out: any[] = [];
    for (const iv of due) {
      const c = iv.candidates || {};
      const who = String(c.name || 'a candidate').trim();
      const pos = String(c.position || '').trim();
      const when = new Date(iv.scheduled_at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: '2-digit', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true });
      const L = letter([
        'Hello,',
        'The interview with ' + who + (pos ? ' for ' + pos : '') + ' was due on ' + when + ', and no result has been recorded yet.',
        'Please open the interview task in JAIN-E (Accountability) and record the result - Selected, Hold or Rejected - or reschedule it if it did not take place.',
        PORTAL + '/accountability.html'
      ], 'Regards,\nJAIN-E\nThe Jain Group');
      const to = (Array.isArray(iv.holders) ? iv.holders : []).filter((e: string) => re.test(String(e || '')));
      if (!to.length) { out.push({ id: iv.id, skipped: 'no holders' }); continue; }
      try {
        const r = await deliver({ to, subject: 'Interview result needed: ' + who + (pos ? ' (' + pos + ')' : ''), text: L.text, html: L.html,
          sendAs: AI_SENDER, fromName: 'The Jain Group', replyTo: HR_REPLY_TO, SB, SRV, GU, GP, CLIENT_ID, CLIENT_SECRET });
        if (r.sent.length) {
          await fetch(SB + '/rest/v1/interviews?id=eq.' + iv.id, { method: 'PATCH', headers: { ...H, 'Content-Profile': 'hr' },
            body: JSON.stringify({ overdue_mailed_at: new Date().toISOString() }) });
        }
        out.push({ id: iv.id, sent: r.sent.length, failed: r.failed.length });
      } catch (e) { out.push({ id: iv.id, error: String((e as Error)?.message || e) }); }
    }
    return j({ ok: true, kind, checked: due.length, results: out });
  }

  // Every letter here is a person acting, and is checked as one. There is no unauthenticated path.
  const auth = req.headers.get('Authorization') || '';
  if (!auth.toLowerCase().startsWith('bearer ')) return j({ error: 'Not signed in' }, 401);

  let caller = '';
  try {
    const r = await fetch(SB + '/auth/v1/user', { headers: { Authorization: auth, apikey: ANON || SRV } });
    const who = await r.json();
    caller = String((who && who.email) || '').trim().toLowerCase();
  } catch (_) { /* checked below */ }
  if (!caller) return j({ error: 'Could not confirm who you are signed in as' }, 401);

  let mayAct = false;
  try {
    const r = await fetch(SB + '/rest/v1/rpc/can_email_candidates', {
      method: 'POST',
      headers: { Authorization: auth, apikey: ANON || SRV, 'Content-Type': 'application/json', 'Content-Profile': 'recruit' },
      body: '{}'
    });
    mayAct = (await r.json()) === true;
  } catch (_) { mayAct = false; }

  /* AN INTERVIEWER MAY SEND THE ONE LETTER THEIR OWN VERDICT CREATES.

     can_email_candidates is the four people who own the test bank. An interviewer is almost never
     one of them - Gokul Saha holds interviews and has nothing to do with tests - so rejecting
     somebody at interview produced a decision with no letter, which is the silence this whole
     feature exists to avoid.

     Rather than widen that permission, a narrower question is asked: did you hold THIS interview,
     did it end in a rejection, and is the address you are writing to the candidate it was about.
     All three must hold. It grants nothing else - not another candidate, not another kind of
     letter - and the check is the database's, made with the caller's own token. */
  const interviewId = parseInt(String(body?.interview_id || ''), 10);
  let viaInterview = false;
  if (!mayAct && kind === 'candidate_rejected' && interviewId) {
    try {
      const r = await fetch(SB + '/rest/v1/rpc/may_send_interview_rejection', {
        method: 'POST',
        headers: { Authorization: auth, apikey: ANON || SRV, 'Content-Type': 'application/json', 'Content-Profile': 'hr' },
        body: JSON.stringify({ p_interview_id: interviewId, p_email: String(body?.email || '') })
      });
      viaInterview = (await r.json()) === true;
    } catch (_) { viaInterview = false; }
  }
  if (!mayAct && !viaInterview) return j({ error: 'You do not have permission to send this' }, 403);

  let to: string[] = [];
  let subject = '', html = '', text = '';
  let sendAs = AI_SENDER;
  let attach: { filename: string; bytes: Uint8Array } | undefined;

  let rawName = caller.split('@')[0];
  try {
    const r = await fetch(SB + '/rest/v1/user_profile?email=eq.' + encodeURIComponent(caller) + '&select=full_name',
      { headers: { ...H, 'Accept-Profile': 'acc' } });
    const rows = await r.json();
    if (Array.isArray(rows) && rows[0] && rows[0].full_name) rawName = String(rows[0].full_name);
  } catch (_) { /* the address prefix will do */ }
  const callerName = personName(rawName);

  if (kind === 'candidate_rejected') {
    const name = String(body?.name || '').trim();
    const email = String(body?.email || '').trim().toLowerCase();
    const position = String(body?.position || '').trim();
    if (!re.test(email)) return j({ error: 'A valid candidate email is required' }, 400);
    to = [email];
    /* An HR rejection comes from the person who made it, so a reply reaches somebody who knows the
       case. An interview rejection comes from the company: the interviewer is often a line manager
       who should not be fielding a candidate's reply, and may have no connected mailbox at all. */
    sendAs = viaInterview ? AI_SENDER : caller;
    subject = position ? ('Your application — ' + position) : 'Your application to The Jain Group';
    const signOff = (!viaInterview && callerName)
      ? ('Yours sincerely,\n' + callerName + '\nHuman Resources\nThe Jain Group')
      : 'Yours sincerely,\nHuman Resources\nThe Jain Group';
    const L = letter([
      'Dear ' + (name || 'Applicant') + ',',
      'Thank you for your interest in The Jain Group, and for the time you gave to your application'
        + (position ? ' for the position of ' + position : '') + '.',
      'We received a strong response to this role. After careful consideration, we will not be taking your application forward on this occasion.',
      'This reflects the particular requirements of the position rather than any shortcoming in your experience, and we appreciated the opportunity to consider it.',
      'We will keep your details on record and would be glad to hear from you again should a suitable vacancy arise. We wish you every success.'
    ], signOff);
    html = L.html; text = L.text;

  } else if (kind === 'referral_decided') {
    const referrer = String(body?.referrer_email || '').trim().toLowerCase();
    const referrerName = personName(String(body?.referrer_name || ''));
    const who = String(body?.candidate_name || 'the person you referred').trim();
    const approved = body?.approved === true;
    if (!re.test(referrer)) return j({ error: 'A valid referrer email is required' }, 400);
    to = [referrer];
    sendAs = AI_SENDER;
    subject = 'Your referral — ' + who;
    const sig = 'Regards,\nHuman Resources\nThe Jain Group';
    const L = approved
      ? letter([
          'Dear ' + (referrerName || 'Colleague') + ',',
          'Thank you for referring ' + who + '.',
          'The referral has been accepted. HR will take it from here and will be in touch with them directly.',
          'We appreciate you thinking of the company.'
        ], sig)
      : letter([
          'Dear ' + (referrerName || 'Colleague') + ',',
          'Thank you for referring ' + who + '.',
          'On this occasion we will not be taking the referral forward. This is usually a question of fit against the roles open at the moment rather than anything lacking in the person.',
          'Please do keep referring people — it is genuinely useful.'
        ], sig);
    html = L.html; text = L.text;

  } else if (kind === 'job_description_created') {
    const title = String(body?.title || 'Untitled').trim();
    const by = String(body?.created_by || '').trim();
    const path = String(body?.storage_path || '').trim();
    const textBody = String(body?.content_text || '');
    to = HR_INBOXES;
    sendAs = AI_SENDER;

    if (path) {
      try {
        const r = await fetch(SB + '/storage/v1/object/' + path.replace(/^\/+/, ''), { headers: H });
        if (r.ok) {
          attach = {
            filename: (title.replace(/[^A-Za-z0-9 ()-]/g, '').trim() || 'job-description') + '.pdf',
            bytes: new Uint8Array(await r.arrayBuffer())
          };
        }
      } catch (_) { /* the letter adapts rather than promising a file that is not there */ }
    }
    subject = 'New job description: ' + title;
    const paras = [
      'A new job description has been added to JAIN-E.',
      'Position: ' + title + (by ? ('\nAdded by: ' + by) : ''),
      attach ? 'The document is attached.'
             : (textBody.trim() ? 'The text is below.'
                                : 'Open it in JAIN-E under Recruitment › Job Descriptions.')
    ];
    if (!attach && textBody.trim()) paras.push(textBody.trim());
    const L = letter(paras, 'Regards,\nJAIN-E\nThe Jain Group');
    html = L.html; text = L.text;

  } else {
    return j({ error: 'Unknown notice type' }, 400);
  }

  const replyTo = (kind === 'candidate_rejected' && !viaInterview) ? caller : HR_REPLY_TO;
  const fromName = (sendAs === caller && callerName) ? callerName : 'The Jain Group';

  try {
    const r = await deliver({ to, subject, text, html, sendAs, fromName, replyTo, attach,
                              SB, SRV, GU, GP, CLIENT_ID, CLIENT_SECRET });
    if (!r.sent.length) return j({ error: 'Nothing could be sent: ' + ((r.failed[0] && r.failed[0].error) || 'unknown') }, 502);
    return j({ ok: true, sent: r.sent.length, failed: r.failed, kind, sent_as: r.sent_as,
               via: r.via, via_interview: viaInterview,
               ...(r.not_connected ? { not_connected: r.not_connected, reply_to: replyTo } : {}) });
  } catch (e) {
    return j({ error: String((e as Error)?.message || e) }, 500);
  }
});
