// Google redirects the browser here after consent — plain navigation, no auth header, so verify_jwt
// is off (same reason as google-oauth-start). Exchanges the code for tokens, confirms the Google
// account that actually authorized matches the JAIN-E user who started the flow (the 'state' value),
// saves the tokens, then bounces the browser back into JAIN-E with a status flag in the query string
// (kept OUT of the hash so the app's own hash router is untouched).
//
// A state beginning 'dm.' is the Digital Metrics marketing connection (see google-oauth-start). Its
// signature is checked first; it is saved to camp.dm_google_auth under the Google account that
// consented (a company account - no "same email as the JAIN-E login" rule), and the browser goes
// back to Our Brand > Setup (campaigns.html#/setup - Digital Metrics no longer has a page of its
// own; its tabs moved into Our Brand and Competitor Data on 16 Oct 2026) instead of Meetings.
const PORTAL = Deno.env.get('PORTAL_URL') || 'https://jaingroupe.netlify.app';
const REDIRECT_URI = 'https://rkxsgtauigjrpcjkmccu.supabase.co/functions/v1/google-oauth-callback';

function finish(ok: boolean, msg?: string) {
  const url = PORTAL.replace(/\/$/, '') + '/tasks.html?google=' + (ok ? 'ok' : 'err') + (msg ? ('&msg=' + encodeURIComponent(msg)) : '') + '#/tasks/meetings';
  return Response.redirect(url, 302);
}

const b64u = (b: Uint8Array) => btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64u = (s: string) => new TextDecoder().decode(Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0)));
async function sign(payload: string, key: string) {
  const k = await crypto.subtle.importKey('raw', new TextEncoder().encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return b64u(new Uint8Array(await crypto.subtle.sign('HMAC', k, new TextEncoder().encode(payload))));
}

async function marketing(rawState: string, code: string | null, err: string | null) {
  const SECRET = Deno.env.get('GOOGLE_CLIENT_SECRET') || '', CLIENT_ID = Deno.env.get('GOOGLE_CLIENT_ID') || '';
  const [, payload, sig] = rawState.split('.');
  let st: any = null;
  if (payload && sig && SECRET && sig === await sign(payload, SECRET)) { try { st = JSON.parse(unb64u(payload)); } catch (_) { /* bad */ } }
  const back = (ok: boolean, msg?: string) => {
    const base = (st && st.r) || PORTAL.replace(/\/$/, '');
    return Response.redirect(base + '/campaigns.html?google=' + (ok ? 'ok' : 'err') + (msg ? '&msg=' + encodeURIComponent(msg) : '') + '#/setup', 302);
  };
  if (!st || st.m !== 'dm') return back(false, 'this sign-in link was not issued by JAIN-E - start again from Our Brand > Setup');
  if (Date.now() - Number(st.t) > 30 * 60 * 1000) return back(false, 'the sign-in link expired - start again');
  if (err) return back(false, err);
  if (!code) return back(false, 'missing code');
  try {
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ code, client_id: CLIENT_ID, client_secret: SECRET, redirect_uri: REDIRECT_URI, grant_type: 'authorization_code' }).toString(),
    });
    const tok = await tokenRes.json();
    if (!tokenRes.ok || !tok.access_token) return back(false, tok.error_description || tok.error || 'token exchange failed');
    const ui = await (await fetch('https://www.googleapis.com/oauth2/v3/userinfo', { headers: { Authorization: 'Bearer ' + tok.access_token } })).json();
    const gEmail = String(ui.email || '').trim().toLowerCase();
    if (!gEmail) return back(false, 'could not read the Google account email');
    const SB = Deno.env.get('SUPABASE_URL'), SRV = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    const now = new Date().toISOString();
    const row: any = { google_email: gEmail, access_token: tok.access_token, scope: tok.scope || '',
      expiry: new Date(Date.now() + Number(tok.expires_in || 3600) * 1000).toISOString(),
      connected_by: st.e, connected_at: now, updated_at: now };
    if (tok.refresh_token) row.refresh_token = tok.refresh_token;
    const up = await fetch(SB + '/rest/v1/dm_google_auth?on_conflict=google_email', {
      method: 'POST',
      headers: { apikey: SRV!, Authorization: 'Bearer ' + SRV, 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates', 'Content-Profile': 'camp' },
      body: JSON.stringify(row),
    });
    if (!up.ok) return back(false, 'db save failed: ' + (await up.text()).slice(0, 200));
    return back(true);
  } catch (e) {
    return back(false, String(e));
  }
}

Deno.serve(async (req) => {
  const u = new URL(req.url);
  const code = u.searchParams.get('code');
  const rawState = (u.searchParams.get('state') || '').trim();
  const err = u.searchParams.get('error');
  if (rawState.startsWith('dm.')) return marketing(rawState, code, err);
  const state = rawState.toLowerCase();
  if (err) return finish(false, err);
  if (!code || !state) return finish(false, 'missing code or state');

  const CLIENT_ID = Deno.env.get('GOOGLE_CLIENT_ID');
  const CLIENT_SECRET = Deno.env.get('GOOGLE_CLIENT_SECRET');
  if (!CLIENT_ID || !CLIENT_SECRET) return finish(false, 'Google client credentials not set');

  try {
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code, client_id: CLIENT_ID, client_secret: CLIENT_SECRET,
        redirect_uri: REDIRECT_URI, grant_type: 'authorization_code'
      }).toString()
    });
    const tok = await tokenRes.json();
    if (!tokenRes.ok || !tok.access_token) return finish(false, tok.error_description || tok.error || 'token exchange failed');

    const uiRes = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', { headers: { Authorization: 'Bearer ' + tok.access_token } });
    const ui = await uiRes.json();
    const actualEmail = String(ui.email || '').trim().toLowerCase();
    if (!actualEmail) return finish(false, 'could not read Google account email');
    if (actualEmail !== state) return finish(false, 'signed in with a different Google account (' + actualEmail + ') than expected (' + state + ')');

    const SB = Deno.env.get('SUPABASE_URL'), SRV = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    const expiry = new Date(Date.now() + (Number(tok.expires_in || 3600) * 1000)).toISOString();
    const row: any = { email: actualEmail, access_token: tok.access_token, expiry, scope: tok.scope || '', updated_at: new Date().toISOString() };
    if (tok.refresh_token) row.refresh_token = tok.refresh_token; // only present when Google actually re-issues it (prompt=consent forces this every time)

    const upsertRes = await fetch(SB + '/rest/v1/google_tokens?on_conflict=email', {
      method: 'POST',
      headers: { apikey: SRV!, Authorization: 'Bearer ' + SRV, 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates', 'Content-Profile': 'acc' },
      body: JSON.stringify(row)
    });
    if (!upsertRes.ok) { const t = await upsertRes.text(); return finish(false, 'db save failed: ' + t.slice(0, 200)); }

    return finish(true);
  } catch (e) {
    return finish(false, String(e));
  }
});
