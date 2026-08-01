import "jsr:@supabase/functions-js/edge-runtime.d.ts";

// ── send-test-email ─────────────────────────────────────────────────────────
// Sends a recruitment assessment link to candidates via the Google Workspace
// Gmail API, using a service account with DOMAIN-WIDE DELEGATION (no 3rd party).
//
// Required Supabase secrets (set in Dashboard → Edge Functions → Secrets):
//   GMAIL_SA_KEY          = the full service-account JSON key (paste the whole file)
//   GMAIL_ALLOWED_DOMAIN  = (optional) domain allowed as sender, default thejaingroup.com
//   GMAIL_SENDER          = (optional) fallback From address if a caller has no email
//
// Each email is sent AS the logged-in staff member's own Workspace address
// (payload.sender_email), impersonated via domain-wide delegation — so one key
// covers all staff, no per-person secret. The service account needs this OAuth
// scope authorised in the Admin console: https://www.googleapis.com/auth/gmail.send
// ─────────────────────────────────────────────────────────────────────────────

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body: any, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
}

// base64url of raw bytes
function b64url(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
// base64url of a UTF-8 string
function b64urlStr(s: string): string {
  return b64url(new TextEncoder().encode(s));
}

// PEM (PKCS#8) → ArrayBuffer
function pemToDer(pem: string): ArrayBuffer {
  const b64 = pem.replace(/-----BEGIN [^-]+-----/, '').replace(/-----END [^-]+-----/, '').replace(/\s+/g, '');
  const bin = atob(b64);
  const buf = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
  return buf.buffer;
}

// Get a Gmail access token by signing a JWT with the service-account key and
// exchanging it, impersonating `subject` (domain-wide delegation).
async function getAccessToken(sa: any, subject: string): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const claim = {
    iss: sa.client_email,
    sub: subject,
    scope: 'https://www.googleapis.com/auth/gmail.send',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  };
  const unsigned = `${b64urlStr(JSON.stringify(header))}.${b64urlStr(JSON.stringify(claim))}`;
  const key = await crypto.subtle.importKey(
    'pkcs8',
    pemToDer(sa.private_key),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(unsigned)));
  const jwt = `${unsigned}.${b64url(sig)}`;

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt,
    }),
  });
  const out = await res.json().catch(() => ({}));
  if (!res.ok || !out.access_token) {
    throw new Error('Google token error: ' + (out.error_description || out.error || res.status));
  }
  return out.access_token as string;
}

// RFC 2822 subject encoding for non-ASCII safety
function encodeSubject(s: string): string {
  // eslint-disable-next-line no-control-regex
  return /^[\x00-\x7F]*$/.test(s) ? s : `=?UTF-8?B?${btoa(String.fromCharCode(...new TextEncoder().encode(s)))}?=`;
}

function buildMime(fromName: string, fromEmail: string, to: string, replyTo: string, subject: string, body: string): string {
  const lines = [
    `From: ${fromName ? `${fromName} <${fromEmail}>` : fromEmail}`,
    `To: ${to}`,
    replyTo ? `Reply-To: ${replyTo}` : '',
    `Subject: ${encodeSubject(subject)}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset="UTF-8"',
    'Content-Transfer-Encoding: 8bit',
    '',
    body,
  ].filter(Boolean);
  return lines.join('\r\n');
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  let payload: any;
  try { payload = await req.json(); } catch { return json({ error: 'Bad request body' }, 400); }

  const { test_name, link, subject, body, recipients, sender_name, sender_email } = payload || {};
  const list: string[] = Array.isArray(recipients) ? recipients.map((r) => String(r || '').trim()).filter(Boolean) : [];
  if (!list.length) return json({ error: 'No recipients provided' }, 400);

  const saRaw = Deno.env.get('GMAIL_SA_KEY');
  if (!saRaw) {
    return json({ error: 'Email backend not configured (missing GMAIL_SA_KEY secret)' }, 500);
  }
  let sa: any;
  try { sa = JSON.parse(saRaw); } catch { return json({ error: 'GMAIL_SA_KEY is not valid JSON' }, 500); }

  // Send AS the logged-in staff member's own address (impersonation). Restricted
  // to the Workspace domain so the service account can't be used to spoof others.
  const allowedDomain = (Deno.env.get('GMAIL_ALLOWED_DOMAIN') || 'thejaingroup.com').toLowerCase();
  const fromEmail = (String(sender_email || '').trim().toLowerCase()) || (Deno.env.get('GMAIL_SENDER') || '').toLowerCase();
  if (!fromEmail) return json({ error: 'No sender address supplied' }, 400);
  if (!fromEmail.endsWith('@' + allowedDomain)) {
    return json({ error: `Sender ${fromEmail} is not a @${allowedDomain} account` }, 403);
  }

  let token: string;
  try {
    token = await getAccessToken(sa, fromEmail);
  } catch (e) {
    return json({ error: (e as Error).message }, 502);
  }

  const finalSubject = (subject && String(subject).trim()) || `Check This ${test_name || ''} provided by JainGroup`;
  const finalBody = ((body && String(body)) || 'Dear Candidate,\nFill This Test at the latest.\nTest Attachment')
    + (link ? `\r\n\r\n${link}` : '');
  const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  const sent: string[] = [];
  const failed: { email: string; error: string }[] = [];

  for (const to of list) {
    if (!re.test(to)) { failed.push({ email: to, error: 'invalid email' }); continue; }
    try {
      const mime = buildMime(sender_name || 'JainGroup', fromEmail, to, '', finalSubject, finalBody);
      const res = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ raw: b64urlStr(mime) }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        failed.push({ email: to, error: (err.error && err.error.message) || ('HTTP ' + res.status) });
      } else {
        sent.push(to);
      }
    } catch (e) {
      failed.push({ email: to, error: (e as Error).message });
    }
  }

  return json({ ok: failed.length === 0, sent_count: sent.length, failed_count: failed.length, sent, failed });
});
