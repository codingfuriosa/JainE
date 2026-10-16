// Kicks off the per-user Google OAuth flow. Called via plain browser navigation (location.href =
// .../google-oauth-start?email=...), so this can't rely on any Authorization header — verify_jwt is
// off, and the JAIN-E email identifying who's connecting travels as a query param + OAuth 'state'.
//
// MARKETING MODE (?mode=marketing, 16 Oct 2026) - Digital Metrics. A different thing from the
// per-person connection above, in three ways:
//   - it asks ONLY for read-only marketing permissions (YouTube, YouTube Analytics, Search Console,
//     Analytics, Business Profile) and never for Calendar / Gmail / Drive, and does not fold in
//     what the account granted before (include_granted_scopes off);
//   - the Google account is a company account that owns the channel, sites and listings, which is
//     usually NOT the address the person logs into JAIN-E with - so there is no "same email" check;
//   - because of that, the request must prove who is asking. It is fetched (not navigated to) with
//     the person's JAIN-E session in the Authorization header; we check that session and that they
//     hold the Digital Metrics module, then hand back the Google address to go to with a SIGNED
//     state. The callback refuses any marketing state whose signature does not check out, so
//     nobody can attach a Google account to JAIN-E by crafting a link.
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};
const json = (o: unknown, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } });
const REDIRECT_URI = 'https://rkxsgtauigjrpcjkmccu.supabase.co/functions/v1/google-oauth-callback';
const PORTAL = (Deno.env.get('PORTAL_URL') || 'https://jaingroupe.netlify.app').replace(/\/$/, '');
// Where the browser may be sent back to after a marketing connect. Anything else goes to PORTAL.
const RETURN_OK = [PORTAL, 'http://localhost:8080'];

const MARKETING_SCOPES = [
  'openid', 'email',
  'https://www.googleapis.com/auth/youtube.readonly',          // our channel id, uploads list
  'https://www.googleapis.com/auth/yt-analytics.readonly',     // views, watch time, subscribers gained...
  'https://www.googleapis.com/auth/webmasters.readonly',       // Search Console
  'https://www.googleapis.com/auth/analytics.readonly',        // GA4 Data API + listing properties
  'https://www.googleapis.com/auth/business.manage',           // Business Profile: performance, keywords, reviews
];

const b64u = (b: Uint8Array) => btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
async function sign(payload: string, key: string) {
  const k = await crypto.subtle.importKey('raw', new TextEncoder().encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return b64u(new Uint8Array(await crypto.subtle.sign('HMAC', k, new TextEncoder().encode(payload))));
}

async function marketing(req: Request, u: URL) {
  const CLIENT_ID = Deno.env.get('GOOGLE_CLIENT_ID'), CLIENT_SECRET = Deno.env.get('GOOGLE_CLIENT_SECRET');
  if (!CLIENT_ID || !CLIENT_SECRET) return json({ error: 'GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET are not set' }, 500);
  const SB = Deno.env.get('SUPABASE_URL')!, ANON = Deno.env.get('SUPABASE_ANON_KEY')!;
  const auth = req.headers.get('Authorization') || '';
  if (!/^Bearer\s+\S+/.test(auth)) return json({ error: 'Sign in to JAIN-E first' }, 401);
  const who = await fetch(SB + '/auth/v1/user', { headers: { apikey: ANON, Authorization: auth } });
  if (!who.ok) return json({ error: 'Your JAIN-E session has expired - sign in again' }, 401);
  const email = String((await who.json()).email || '').toLowerCase();
  const can = await fetch(SB + '/rest/v1/rpc/dm_allowed', {
    method: 'POST', body: '{}',
    headers: { apikey: ANON, Authorization: auth, 'Content-Type': 'application/json', 'Content-Profile': 'camp' } });
  if (!can.ok || (await can.json()) !== true) return json({ error: 'You do not have access to the Our Brand / Competitor Data Google tabs (camp.dm_allowed)' }, 403);

  const ret = RETURN_OK.includes(u.searchParams.get('return') || '') ? u.searchParams.get('return')! : PORTAL;
  const payload = b64u(new TextEncoder().encode(JSON.stringify({ m: 'dm', e: email, r: ret, t: Date.now() })));
  const state = 'dm.' + payload + '.' + await sign(payload, CLIENT_SECRET);
  const params = new URLSearchParams({
    client_id: CLIENT_ID, redirect_uri: REDIRECT_URI, response_type: 'code',
    access_type: 'offline', prompt: 'select_account consent', include_granted_scopes: 'false',
    scope: MARKETING_SCOPES.join(' '), state,
  });
  const hint = (u.searchParams.get('hint') || '').trim();
  if (hint) params.set('login_hint', hint);
  return json({ url: 'https://accounts.google.com/o/oauth2/v2/auth?' + params.toString() });
}

Deno.serve((req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  const u = new URL(req.url);
  if (u.searchParams.get('mode') === 'marketing') return marketing(req, u);
  const email = (u.searchParams.get('email')||'').trim().toLowerCase();
  if (!email) return new Response('Missing email', { status: 400 });
  const CLIENT_ID = Deno.env.get('GOOGLE_CLIENT_ID');
  if (!CLIENT_ID) return new Response('GOOGLE_CLIENT_ID is not set', { status: 500 });
  const scope = [
    // openid + email are REQUIRED so the callback can read which Google account authorized
    // (via /oauth2/v3/userinfo) and confirm it matches the JAIN-E user. Without these the
    // userinfo email comes back blank and the connect fails with 'could not read Google account email'.
    'openid',
    'email',
    'https://www.googleapis.com/auth/calendar.events',
    'https://www.googleapis.com/auth/meetings.space.created',
    'https://www.googleapis.com/auth/meetings.space.readonly',
    // Lets the app send mail AS the signed-in person, from their own address and into their own
    // Sent folder - used by Recruitment > Tests > Share. gmail.send is send-only: it cannot read,
    // search or delete anything in the mailbox, which is the narrowest scope that will do this.
    // include_granted_scopes below means adding this extends an existing grant rather than
    // replacing it, so a Calendar connection is not lost - but Google still requires each person
    // to consent once more before the new permission takes effect.
    'https://www.googleapis.com/auth/gmail.send',
    // Needed by meet-recording-sync to download a completed Google Meet auto-recording's actual
    // bytes from the organizer's Drive (Meet always exports finished recordings there, addressable
    // only by Drive file id — there's no Meet-API-only way to fetch the file content). This is a
    // Google "sensitive" scope (broad read access to that person's whole Drive, not just
    // JAIN-E-created files — drive.file wouldn't cover a file Meet itself created), so it may
    // surface Google's "unverified app" warning or need the Cloud project's OAuth consent screen
    // reviewed, depending on how that project is currently configured.
    'https://www.googleapis.com/auth/drive.readonly'
  ].join(' ');
  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    response_type: 'code',
    access_type: 'offline',
    // Force the Google account chooser every time so the user can pick the account matching their
    // JAIN-E login, instead of Google silently reusing whatever account the browser is signed into.
    prompt: 'select_account consent',
    include_granted_scopes: 'true',
    scope,
    state: email,
    login_hint: email
  });
  return Response.redirect('https://accounts.google.com/o/oauth2/v2/auth?' + params.toString(), 302);
});
