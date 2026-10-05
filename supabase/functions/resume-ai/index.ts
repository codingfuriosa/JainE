import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { AwsClient } from "https://esm.sh/aws4fetch@1.0.20";

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const j = (o: unknown, status = 200) =>
  new Response(JSON.stringify(o), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

const MODEL = 'claude-haiku-4-5-20251001';

/* THE MODELS THIS PROJECT CAN ACTUALLY REACH, NEWEST FIRST.

   The list used to end at gemini-1.5-flash-latest, which Google has retired - it answers 404 and
   nothing else. That alone was survivable, because this is a fallback chain. What was not
   survivable is that it was the LAST entry, and the error reporting kept only the LAST failure
   (see geminiParseDocument). So when every model failed, the row was marked with the retired
   model's 404 and HR was told the CV could not be read, with no sign of what the models that
   matter had said. The first two failures were thrown away.

   gemini-flash-latest leads because it is the model the nightly transcription job runs on in this
   same project, with this same GEMINI_API_KEY, every night - so it is known reachable rather than
   assumed. The aliases are deliberate: a pinned version silently stopped existing once already
   and cost 65 calls before anybody noticed. */
const GEMINI_MODELS = ['gemini-flash-latest', 'gemini-flash-lite-latest', 'gemini-2.0-flash'];
const OWN_ROOT_PREFIXES = ['portal/', 'legal/'];

function parseJson(text: string): any {
  if (!text) return null;
  let t = text.trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) t = fence[1].trim();
  try { return JSON.parse(t); } catch (_) { /* fall through */ }
  const s = t.indexOf('{'); const a = t.indexOf('[');
  let start = -1;
  if (s === -1) start = a; else if (a === -1) start = s; else start = Math.min(s, a);
  if (start === -1) return null;
  const open = t[start]; const close = open === '{' ? '}' : ']';
  const end = t.lastIndexOf(close);
  if (end > start) { try { return JSON.parse(t.slice(start, end + 1)); } catch (_) { return null; } }
  return null;
}

async function callClaude(apiKey: string, system: string, user: string, maxTokens: number) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({ model: MODEL, max_tokens: maxTokens, system, messages: [{ role: 'user', content: user }] }),
  });
  const raw = await res.text();
  if (!res.ok) {
    let msg = 'Anthropic API error ' + res.status;
    try { const e = JSON.parse(raw); if (e?.error?.message) msg = 'Anthropic ' + res.status + ': ' + e.error.message; } catch (_) { /* ignore */ }
    throw new Error(msg);
  }
  let data: any; try { data = JSON.parse(raw); } catch { throw new Error('Anthropic returned non-JSON response'); }
  return data?.content?.[0]?.text || '';
}

const ANALYZE_SYSTEM = `You are an expert recruiter. Read ONE candidate's resume text and return a structured profile.
Return ONLY a JSON object (no markdown) with EXACTLY these keys:
{
  "candidate_name": string, "email": string, "phone": string, "location": string,
  "role_title": string, "company": string, "experience_years": number,
  "experience_summary": string, "education": string, "skills": string[],
  "skill_analysis": string, "strengths": string[], "certifications": string[],
  "credentials": string, "summary": string, "recommended_departments": string[],
  "department_fit": string
}
Be concise. Use "" for missing text and [] for missing lists. Never invent facts. Valid JSON only.`;

const SEARCH_SYSTEM = `You are an expert recruiter searching a resume bank. You get a natural-language hiring query and a JSON array of candidate profiles (each has an id). Rank candidates by fit.
Return ONLY a JSON array (no markdown). Each element: { "id": number, "score": number, "reason": string } where score is 0-100 and reason is <=25 words citing concrete evidence. Include ONLY candidates with score >= 40, sorted by score descending. If none match, return [].`;

const INTERVIEW_SYSTEM = `You are an expert hiring manager and interview coach. Given a hiring situation described by an HR user, produce a tailored, practical interview guide.
Return ONLY a JSON object (no markdown) with this shape:
{ "title": string, "overview": string, "sections": [ { "name": string, "questions": [ { "q": string, "look_for": string } ] } ], "red_flags": string[], "tips": string[] }
Produce 4-6 sections with 2-3 questions each. Tailor to the seniority and role implied. Be specific, not generic. Valid JSON only.`;

const PARSE_SYSTEM = `You are reading ONE candidate's CV/resume document.
Return ONLY a JSON object (no markdown, no commentary) with EXACTLY these keys:
{
  "candidate_name": string,   // the candidate's full name as written
  "email": string,            // their email address, exactly as printed
  "phone": string,            // their phone number, digits and separators as printed
  "location": string,
  "role_title": string,       // current or most recent job title
  "company": string,          // current or most recent employer
  "experience_years": number, // total years of work experience; 0 if a fresher or unclear
  "education": string,
  "skills": string[],         // 6-14 skills actually evidenced in the document
  "certifications": string[],
  "summary": string,          // 2-3 sentences: who this person is professionally
  "content_text": string      // the readable text of the document, plain, up to ~6000 characters
}
RULES:
- NEVER invent or infer contact details. If an email or phone is not printed in the document, return "".
- Do not guess a name from the file name. If the document does not state a name, return "".
- experience_years must be a number, never a range or a string.
- Use "" for missing text and [] for missing lists.
- Valid JSON only.`;

async function geminiParseDocument(apiKey: string, bytes: Uint8Array, mimeType: string) {
  let b = '';
  for (let i = 0; i < bytes.length; i += 0x8000) b += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  const b64 = btoa(b);

  /* EVERY MODEL'S FAILURE IS KEPT, NOT JUST THE LAST ONE.

     This used to hold a single `lastErr` that each attempt overwrote, so the message that reached
     HR - and the message stored on the row - was whatever the OLDEST, least important fallback
     said. A whole afternoon went into a 404 from a retired model while the real reason the first
     two refused was never recorded anywhere. A chain of fallbacks that only reports its last link
     is a chain that cannot be debugged. */
  const failures: string[] = [];
  for (const model of GEMINI_MODELS) {
    try {
      const res = await fetch(
        'https://generativelanguage.googleapis.com/v1beta/models/' + model + ':generateContent?key=' + apiKey,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: PARSE_SYSTEM }] },
            contents: [{ role: 'user', parts: [
              { inline_data: { mime_type: mimeType, data: b64 } },
              { text: 'Read this CV and return the JSON described.' }
            ] }],
            generationConfig: { temperature: 0.1, maxOutputTokens: 4096, responseMimeType: 'application/json' }
          })
        }
      );
      const raw = await res.text();
      if (!res.ok) { failures.push(model + ': HTTP ' + res.status + ' ' + raw.slice(0, 160)); continue; }
      const data = JSON.parse(raw);
      const text = data?.candidates?.[0]?.content?.parts?.map((p: any) => p?.text || '').join('') || '';
      const parsed = parseJson(text);
      if (!parsed) { failures.push(model + ': returned an unreadable response'); continue; }
      return { profile: parsed, model };
    } catch (e) {
      failures.push(model + ': ' + String((e as Error)?.message || e).slice(0, 160));
    }
  }
  throw new Error(failures.length ? failures.join(' | ') : 'Gemini could not read the document');
}

const MIME: Record<string, string> = {
  pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
  webp: 'image/webp', txt: 'text/plain',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
};

/* Signs its own S3 GET rather than asking s3-sign, which authenticates by looking the caller's
   token up with /auth/v1/user - fine for a person in a browser, fatal for anything else. */
async function s3GetBytes(key: string) {
  const bucket = Deno.env.get('S3_BUCKET');
  const region = Deno.env.get('S3_REGION');
  const ak = Deno.env.get('AWS_ACCESS_KEY_ID');
  const sk = Deno.env.get('AWS_SECRET_ACCESS_KEY');
  if (!bucket || !region || !ak || !sk) throw new Error('S3 is not configured on this project');

  let safeKey = String(key || '').replace(/^s3:/, '').replace(/^\/+/, '');
  if (!OWN_ROOT_PREFIXES.some((p) => safeKey.startsWith(p))) safeKey = 'portal/' + safeKey;
  const encKey = safeKey.split('/').map(encodeURIComponent).join('/');

  const aws = new AwsClient({ accessKeyId: ak, secretAccessKey: sk, region, service: 's3' });
  const u = new URL(`https://${bucket}.s3.${region}.amazonaws.com/${encKey}`);
  u.searchParams.set('X-Amz-Expires', '300');
  const signed = await aws.sign(u.toString(), { method: 'GET', aws: { signQuery: true } });

  const fr = await fetch(signed.url);
  if (!fr.ok) throw new Error('could not download the file (HTTP ' + fr.status + ')');
  const bytes = new Uint8Array(await fr.arrayBuffer());
  if (!bytes.length) throw new Error('the file is empty');
  return bytes;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return j({ error: 'method not allowed' }, 405);

  const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
  const gKey = Deno.env.get('GEMINI_API_KEY') || Deno.env.get('GOOGLE_API_KEY');
  const SB = Deno.env.get('SUPABASE_URL');
  const SRV = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

  let body: any;
  try { body = await req.json(); } catch { return j({ error: 'bad request body' }, 400); }
  const action = body?.action;

  if (action === 'ping') return j({ ok: true, hasKey: !!apiKey, hasGemini: !!gKey, model: MODEL, geminiModels: GEMINI_MODELS });

  if (action === 'parse_resume') {
    if (!gKey) return j({ error: 'Reading CVs is not configured: the GEMINI_API_KEY secret is missing on this Supabase project.' }, 500);
    if (!SB || !SRV) return j({ error: 'server not configured' }, 500);

    const id = parseInt(String(body?.resume_id || ''));
    if (!id) return j({ error: 'resume_id is required' }, 400);

    const H = { apikey: SRV, Authorization: 'Bearer ' + SRV, 'Content-Type': 'application/json',
                'Accept-Profile': 'hr', 'Content-Profile': 'hr' } as any;

    /* EVERY WRITE IS CHECKED. This function used to fire a PATCH and carry on, and that hid the
       real bug for a whole round: skills and certifications are text[] columns, a comma-joined
       string was being sent, PostgREST rejected the request with a 400, and the WHOLE patch was
       discarded - every field, not just those two. The reply still said ok, the row still said
       "analyzing", and nothing anywhere said why. An unchecked write is not a write. */
    const mark = async (patch: any) => {
      const r = await fetch(SB + '/rest/v1/resumes?id=eq.' + id,
        { method: 'PATCH', headers: H, body: JSON.stringify(patch) });
      if (!r.ok) throw new Error('could not save what was read: ' + (await r.text()).slice(0, 200));
    };

    const rr = await fetch(SB + '/rest/v1/resumes?id=eq.' + id + '&select=id,file_name,file_type,storage_path', { headers: H });
    const rows = await rr.json();
    const row = Array.isArray(rows) ? rows[0] : null;
    if (!row) return j({ error: 'That resume record no longer exists' }, 404);
    if (!row.storage_path) return j({ error: 'That resume has no file attached' }, 400);

    try { await mark({ ai_status: 'analyzing', ai_error: null }); } catch (_) { /* reported below */ }

    try {
      const bytes = await s3GetBytes(String(row.storage_path));
      const ext = String(row.file_type || String(row.file_name || '').split('.').pop() || '').toLowerCase();
      const mime = MIME[ext] || 'application/pdf';

      const { profile, model } = await geminiParseDocument(gKey, bytes, mime);

      const clean = (v: any) => String(v == null ? '' : v).trim();
      // text[] columns take an ARRAY. Joining them into a string is what silently killed the patch.
      const arr = (v: any) => Array.isArray(v) ? v.map(clean).filter(Boolean) : [];
      const yrs = Number(profile?.experience_years);

      const patch: any = {
        candidate_name: clean(profile?.candidate_name) || null,
        email: clean(profile?.email).toLowerCase() || null,
        phone: clean(profile?.phone) || null,
        location: clean(profile?.location) || null,
        role_title: clean(profile?.role_title) || null,
        company: clean(profile?.company) || null,
        experience_years: (isFinite(yrs) && yrs >= 0) ? yrs : null,
        education: clean(profile?.education) || null,
        skills: arr(profile?.skills),
        certifications: arr(profile?.certifications),
        summary: clean(profile?.summary) || null,
        content_text: clean(profile?.content_text).slice(0, 20000) || null,
        ai_status: 'ready',
        ai_error: null
      };
      await mark(patch);

      /* The CV becomes a candidate, or adds to one that already exists. Done here so it happens
         once, server-side, whatever the browser does next - a CV that is read and then left out of
         the Tracker is a CV nobody acts on. */
      let linked: any = null;
      try {
        const lr = await fetch(SB + '/rest/v1/rpc/resume_to_tracker', {
          method: 'POST', headers: H, body: JSON.stringify({ p_resume_id: id })
        });
        linked = lr.ok ? await lr.json() : { ok: false, reason: (await lr.text()).slice(0, 200) };
      } catch (e) { linked = { ok: false, reason: String((e as Error)?.message || e) }; }

      return j({ ok: true, resume_id: id, model, profile: patch, linked });
    } catch (e) {
      const msg = String((e as Error)?.message || e).slice(0, 300);
      try { await mark({ ai_status: 'failed', ai_error: msg }); } catch (_) { /* nothing left to try */ }
      return j({ error: 'Could not read that CV: ' + msg, resume_id: id }, 502);
    }
  }

  if (!apiKey) return j({ error: 'AI is not configured: the ANTHROPIC_API_KEY secret is missing on this Supabase project.' }, 500);

  try {
    if (action === 'analyze') {
      const text = String(body?.text || '').slice(0, 22000);
      if (text.replace(/\s/g, '').length < 20)
        return j({ error: 'Could not read enough text from this file to analyze.' }, 422);
      const out = await callClaude(apiKey, ANALYZE_SYSTEM, 'RESUME TEXT:\n\n' + text, 1200);
      const parsed = parseJson(out);
      if (!parsed) return j({ error: 'AI returned an unreadable response.' }, 502);
      return j({ profile: parsed });
    }

    if (action === 'search') {
      const query = String(body?.query || '').slice(0, 2000);
      const candidates = Array.isArray(body?.candidates) ? body.candidates.slice(0, 300) : [];
      if (!query) return j({ error: 'Empty query.' }, 400);
      if (!candidates.length) return j({ results: [] });
      const out = await callClaude(apiKey, SEARCH_SYSTEM, 'HIRING QUERY:\n' + query + '\n\nCANDIDATES (JSON):\n' + JSON.stringify(candidates), 1500);
      const parsed = parseJson(out);
      return j({ results: Array.isArray(parsed) ? parsed : [] });
    }

    if (action === 'interview') {
      const brief = String(body?.brief || '').slice(0, 4000);
      if (brief.replace(/\s/g, '').length < 5) return j({ error: 'Please describe the interview situation.' }, 400);
      const out = await callClaude(apiKey, INTERVIEW_SYSTEM, 'HIRING SITUATION:\n' + brief, 2200);
      const parsed = parseJson(out);
      if (!parsed) return j({ error: 'AI returned an unreadable response.' }, 502);
      return j({ guide: parsed });
    }

    return j({ error: 'unknown action' }, 400);
  } catch (e) {
    return j({ error: String((e as Error)?.message || e) }, 500);
  }
});
