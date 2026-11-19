/* CHECKLIST SHARE (18 Nov 2026, Ayush: "the Checklist alerts should be in a public link and exportable as a nice PDF").
   The same model as campaign-share: a public page (checklist-report.html) that holds no JainE code and no database key and
   only calls this function.
   - Public (while the link is ON and its key matches): the latest saved checklist runs (daily, and the latest weekly) and
     their alerts - section, point, level, project, the campaign / ad set / ad name, what was found, the limit, red or not.
     Nothing else: no ids, no accounts, no people.
   - Staff (super admin, or SHARE_PEOPLE - Manash, digital marketing): status / set (on, off) / renew (a new key - the old link
     stops working for good).
   The switch and key live in the private storage bucket 'campaign-share' as checklist.json - its own key, separate from the
   campaign report's. */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.47.10";

const SB = Deno.env.get('SUPABASE_URL')!, SRV = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, ANON = Deno.env.get('SUPABASE_ANON_KEY') || '';
const db = createClient(SB, SRV, { db: { schema: 'camp' } });
const st = createClient(SB, SRV);
const BUCKET = 'campaign-share', FILE = 'checklist.json';
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
const j = (o: unknown, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });

async function getSettings(): Promise<any> {
  const r = await fetch(`${SB}/storage/v1/object/authenticated/${BUCKET}/${FILE}?t=${Date.now()}`, { headers: { Authorization: 'Bearer ' + SRV, apikey: SRV, 'Cache-Control': 'no-cache' } });
  if (!r.ok) return { on: false, token: '' };
  try { return await r.json(); } catch (_) { return { on: false, token: '' }; }
}
async function putSettings(s: any) {
  const { data } = await st.storage.getBucket(BUCKET);
  if (!data) await st.storage.createBucket(BUCKET, { public: false });
  const { error } = await st.storage.from(BUCKET).upload(FILE, new Blob([JSON.stringify(s)], { type: 'application/json' }), { upsert: true, contentType: 'application/json', cacheControl: '0' });
  if (error) throw new Error('settings: ' + error.message);
}
function newToken() { const a = new Uint8Array(24); crypto.getRandomValues(a); return Array.from(a, (b) => b.toString(36).padStart(2, '0')).join('').slice(0, 32); }
const SHARE_PEOPLE = ['digitalmarketing@thejaingroup.com'];
async function staff(req: Request): Promise<string | null> {
  const auth = req.headers.get('Authorization') || '';
  if (!/^Bearer\s+\S+/.test(auth) || !ANON) return null;
  const who = await fetch(`${SB}/auth/v1/user`, { headers: { apikey: ANON, Authorization: auth } });
  if (!who.ok) return null;
  const email = String((await who.json()).email || '');
  if (SHARE_PEOPLE.includes(email.trim().toLowerCase())) return email;
  const r = await fetch(`${SB}/rest/v1/rpc/is_superadmin`, { method: 'POST', body: '{}', headers: { apikey: ANON, Authorization: auth, 'Content-Type': 'application/json', 'Content-Profile': 'app' } });
  return r.ok && (await r.json()) === true ? (email || 'admin') : null;
}
function same(a: string, b: string) { if (!a || !b || a.length !== b.length) return false; let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i); return d === 0; }

async function latest() {
  const { data: rr, error } = await db.from('fb_check_runs').select('id,kind,ran_at,period_from,period_to').order('ran_at', { ascending: false }).limit(20);
  if (error) return { runs: [], flags: [] };
  const runs: any[] = []; for (const k of ['daily', 'weekly']) { const x = (rr || []).find((y: any) => y.kind === k); if (x) runs.push(x); }
  if (!runs.length) return { runs: [], flags: [] };
  const flags: any[] = [];
  for (let p = 0; p < 20000; p += 1000) {
    const { data, error: e2 } = await db.from('fb_check_flags').select('*').in('run_id', runs.map((x) => x.id)).order('id').range(p, p + 999);
    if (e2) break; flags.push(...(data || [])); if (!data || data.length < 1000) break;
  }
  // only these fields go out
  const keep = ['kind', 'section', 'point', 'level', 'project', 'name', 'campaign_name', 'adset_name', 'value', 'lim', 'sev'];
  return { runs: runs.map((r) => ({ kind: r.kind, ran_at: r.ran_at, period_from: r.period_from, period_to: r.period_to })), flags: flags.map((f) => { const o: any = {}; for (const k of keep) o[k] = f[k] ?? null; return o; }) };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return j({ error: 'method' }, 405);
  let body: any = {}; try { body = await req.json(); } catch (_) { /* empty */ }
  try {
    if (body.action === 'status' || body.action === 'set' || body.action === 'renew') {
      const who = await staff(req); if (!who) return j({ error: 'not allowed' }, 401);
      const s = await getSettings();
      if (body.action === 'set') { s.on = !!body.on; if (!s.token) s.token = newToken(); s.by = who; s.at = new Date().toISOString(); await putSettings(s); }
      if (body.action === 'renew') { s.token = newToken(); s.by = who; s.at = new Date().toISOString(); await putSettings(s); }
      return j({ ok: true, on: !!s.on, token: s.token || null });
    }
    const s = await getSettings();
    if (!s.on || !same(String(body.k || ''), String(s.token || ''))) return j({ off: true });
    return j({ ok: true, ...(await latest()) });
  } catch (_) {
    return j({ error: 'Something went wrong' }, 500);
  }
});
