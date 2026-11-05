// READING A LEGAL DOCUMENT SO THAT IT DOES NOT FAIL (5 Nov 2026).
//
// 151 Legal documents had been given up on after three tries. Ayush: "There should be no scope of failure
// unless the credits run out." Running them by hand showed why each one failed:
//
//  1. RECITATION. Gemini refuses to hand back text it thinks it has seen before - bank letters, licences,
//     printed forms. The reply is empty with finishReason RECITATION. A 70KB ICICI letter and a 0.4MB
//     lift licence both died this way. Asking again for the SAME pages with every line numbered gets
//     past it (the numbered copy is no longer a recital of anything); the numbers are stripped after.
//  2. THINKING. "flash-latest" thinks by default and could spend minutes and its whole output budget
//     there, returning nothing. Thinking is off: copying text off a page needs no reasoning.
//  3. SIZE. A file over 45MB was refused outright, and anything big was held in memory several times.
//     Files now go to Gemini in 8MB pieces straight from S3 - nothing is held whole - and are read 10
//     pages at a time, several ranges at once. A range that hits the output limit is halved.
//  4. A FILE GEMINI CALLS INVALID inline is sent again as an uploaded file, and if it still is, a PDF
//     is rebuilt with pdf-lib (that repairs most damaged scans) and sent again.
//  5. BUSY / RATE LIMITS (429, 5xx) are waited out and retried. Only an exhausted quota stops the job,
//     and then the document is NOT marked as failed - it is simply picked up again later.
//  6. WORD FILES (.doc/.docx) were never read at all: Gemini does not take them. .docx is a zip of XML
//     and is read directly; an old binary .doc has its text runs pulled out.
import { encodeBase64 } from "https://deno.land/std@0.224.0/encoding/base64.ts";
import { PDFDocument } from "https://esm.sh/pdf-lib@1.17.1";
import { unzipSync, strFromU8 } from "https://esm.sh/fflate@0.8.2";

const MODEL = 'gemini-flash-latest';
const API = 'https://generativelanguage.googleapis.com';
const CHUNK = 8 * 1024 * 1024;           // resumable upload piece (a multiple of 256KB)
const INLINE_MAX = 2 * 1024 * 1024;
const RANGE = 10;                        // pages per read
const PARALLEL = 5;                      // ranges read at once
const REPAIR_MAX = 40 * 1024 * 1024;     // pdf-lib rebuild only below this - it holds the file in memory

export class CreditsError extends Error {}
const log = (id: number, m: string) => console.log('[legal-ocr] doc ' + id + ': ' + m);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const BASE = `You are a precise OCR / text-extraction engine for a real-estate company's LEGAL document archive (Jain Group, Kolkata). The file is often an UNCLEAR or low-quality SCAN and may contain English, Hindi (Devanagari) and/or Bengali, sometimes handwriting and stamps.
RULES:
- Keep the ORIGINAL script: English in English, Hindi in Devanagari, Bengali in Bengali.
- Preserve names, plot/khatian/dag numbers, dates, amounts and registration numbers EXACTLY as written.
- Include text from stamps, seals, headers, footers and tables if legible.
- Do NOT summarise, translate, explain or add commentary.
- If a part is illegible, skip it silently (do not write placeholders).`;
const P_ALL = BASE + `\nExtract ALL readable text from the whole document, in natural reading order. Output ONLY the text.`;
const P_RANGE = (a: number, b: number) => BASE + `\nExtract the readable text of PAGES ${a} TO ${b} ONLY (page 1 is the first page of the file), in reading order. Output ONLY the text. If the file has fewer than ${a} pages, output exactly: <<NO PAGES>>`;
const P_NUMBERED = (a: number, b: number) => BASE + `\nTranscribe PAGES ${a} TO ${b} ONLY (page 1 is the first page of the file) LINE BY LINE. Start EVERY line with its line number and a bar, like "12| text of the line". Output nothing else. If the file has fewer than ${a} pages, output exactly: <<NO PAGES>>`;
const P_NOTES = (a: number) => `This is page ${a} of a scanned legal document of a real-estate company in Kolkata. Write down, in your own words, everything this page says: every name, address, plot/khatian/dag number, date, amount, registration or case number and what the page is (letter, deed, order, licence...). Keep names and numbers exactly as written. Output only that.`;
const P_PAGES = `How many pages does this PDF have? Reply with the number only.`;

type Part = any;
type Ask = { text: string; finish: string; usage: any };

/* One generateContent call. Busy and rate-limit replies are waited out; an exhausted quota is a
   CreditsError, which the caller must not count against the document. */
async function ask(prompt: string, part: Part, KEY: string, id: number, temperature = 0, maxOut = 60000): Promise<Ask> {
  const body = { contents: [{ parts: [{ text: prompt }, part] }],
    generationConfig: { temperature, maxOutputTokens: maxOut, thinkingConfig: { thinkingBudget: 0 } } };
  const waits = [5000, 15000, 30000, 60000];
  for (let i = 0; ; i++) {
    let r: Response;
    try {
      r = await fetch(API + '/v1beta/models/' + MODEL + ':generateContent?key=' + KEY,
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    } catch (e) {
      if (i < waits.length) { await sleep(waits[i]); continue; }
      throw e;
    }
    const t = await r.text();
    let jr: any = {}; try { jr = JSON.parse(t); } catch { /* not JSON */ }
    if (r.status === 429 || r.status >= 500) {
      const msg = JSON.stringify(jr).slice(0, 300) || t.slice(0, 300);
      if (i < waits.length) { log(id, 'gemini ' + r.status + ', waiting ' + waits[i] / 1000 + 's'); await sleep(waits[i]); continue; }
      if (r.status === 429) throw new CreditsError('gemini quota: ' + msg);
      throw new Error('gemini ' + r.status + ' ' + msg);
    }
    if (!r.ok) { const e: any = new Error('gemini ' + r.status + ' ' + (JSON.stringify(jr) || t).slice(0, 200)); e.status = r.status; throw e; }
    const c = (jr.candidates || [])[0] || {};
    const text = String(((c.content || {}).parts || []).map((p: any) => p.text || '').join('') || '');
    const finish = String(c.finishReason || (jr.promptFeedback && jr.promptFeedback.blockReason) || '');
    return { text, finish, usage: jr.usageMetadata || {} };
  }
}

/* The text of pages a..b, by whatever it takes. */
async function readRange(part: Part, a: number, b: number, KEY: string, id: number): Promise<string> {
  let r = await ask(P_RANGE(a, b), part, KEY, id);
  if (r.text.includes('<<NO PAGES>>')) return '';
  if (r.finish === 'STOP' && r.text.trim()) return r.text;
  if (r.finish === 'MAX_TOKENS' && b > a) {
    const m = Math.floor((a + b) / 2);
    return (await readRange(part, a, m, KEY, id)) + '\n' + (await readRange(part, m + 1, b, KEY, id));
  }
  // RECITATION, another block, or nothing: number every line.
  r = await ask(P_NUMBERED(a, b), part, KEY, id, 1);
  if (r.text.includes('<<NO PAGES>>')) return '';
  if ((r.finish === 'STOP' || r.finish === 'MAX_TOKENS') && r.text.trim())
    return r.text.split('\n').map((l) => l.replace(/^\s*\d+\s*\|\s?/, '')).join('\n');
  if (b > a) {
    const m = Math.floor((a + b) / 2);
    return (await readRange(part, a, m, KEY, id)) + '\n' + (await readRange(part, m + 1, b, KEY, id));
  }
  // One page that still will not be copied: have it written down instead, so it can be searched.
  log(id, 'page ' + a + ' blocked (' + r.finish + ') - taking notes instead');
  r = await ask(P_NOTES(a), part, KEY, id, 1, 8000);
  return r.text;
}

/* Gemini bills every PDF page as 258 tokens, so the size of the prompt says how many pages there are
   even when the model's own answer is unusable. */
async function pageCount(part: Part, KEY: string, id: number): Promise<number> {
  const r = await ask(P_PAGES, part, KEY, id, 0, 2000);
  const said = r.finish === 'STOP' ? parseInt((r.text.match(/\d+/) || [''])[0], 10) : NaN;   // a cut-off answer is no answer
  const media = ((r.usage.promptTokensDetails || []) as any[]).filter((d) => d.modality !== 'TEXT')
    .reduce((a, d) => a + (Number(d.tokenCount) || 0), 0);
  const est = media ? Math.max(1, Math.round(media / 258)) : 0;
  log(id, 'pages: model said "' + (r.text || '').trim().slice(0, 30) + '" (' + r.finish + '), tokens say ' + est);
  if (said > 0 && said < 5000 && (!est || Math.abs(said - est) <= Math.max(2, est * 0.2))) return said;
  // Unknown: read on until a block answers that there are no such pages (see readPart).
  return est || UNKNOWN_PAGES;
}
const UNKNOWN_PAGES = 1000;

/* A big scan can take longer than one run of the function is allowed (about 6 minutes). Each 10-page
   block is saved the moment it is read (ctx.save), with the uploaded file's address, and the next run
   carries on from there. Running out of time is never counted as a failure. */
export class TimeUp extends Error {}
export type Ctx = { deadline: number; progress: any; save: () => Promise<void> };

/* Read a whole document part (inline or uploaded). */
async function readPart(part: Part, isPdf: boolean, size: number, KEY: string, id: number, ctx: Ctx): Promise<string> {
  if (!isPdf) {
    const r = await ask(P_ALL, part, KEY, id);
    if (r.finish === 'STOP' && r.text.trim()) return r.text;
    const n = await ask(P_NUMBERED(1, 1), part, KEY, id, 1);
    if (n.text.trim()) return n.text.split('\n').map((l) => l.replace(/^\s*\d+\s*\|\s?/, '')).join('\n');
    return (await ask(P_NOTES(1), part, KEY, id, 1, 8000)).text;
  }
  const pg = ctx.progress;
  const pages = pg.pages || (pg.pages = await pageCount(part, KEY, id));
  log(id, (size / 1048576).toFixed(1) + 'MB, ' + pages + ' pages' + (pg.ranges ? ', ' + Object.keys(pg.ranges).length + ' blocks already read' : ''));
  if (pages <= 6) {
    const r = await ask(P_ALL, part, KEY, id);
    if (r.finish === 'STOP' && r.text.trim().length >= 20) return r.text;
  }
  const ranges: [number, number][] = [];
  for (let a = 1; a <= pages; a += RANGE) ranges.push([a, Math.min(pages, a + RANGE - 1)]);
  pg.ranges = pg.ranges || {};
  let next = 0, stop = false, late = false;
  const worker = async () => {
    while (!stop && next < ranges.length) {
      const k = next++;
      const [a, b] = ranges[k], key = a + '-' + b;
      if (pg.ranges[key] != null) continue;
      if (Date.now() > ctx.deadline) { late = true; return; }
      const t = await readRange(part, a, b, KEY, id);
      pg.ranges[key] = t;
      await ctx.save();
      if (!t.trim() && a > 1 && pages === UNKNOWN_PAGES) stop = true;   // ran past the end of an uncounted file
    }
  };
  await Promise.all(Array.from({ length: Math.min(PARALLEL, ranges.length) }, worker));
  if (late) throw new TimeUp(Object.keys(pg.ranges).length + ' of ' + ranges.length + ' blocks read - continuing next run');
  return ranges.map(([a, b]) => pg.ranges[a + '-' + b] || '').join('\n');
}

/* Stream a URL into Gemini's file store in 8MB pieces - never more than one piece in memory. */
async function uploadStream(url: string, mime: string, KEY: string): Promise<any> {
  const res = await fetch(url);
  if (!res.ok || !res.body) throw new Error('fetch failed (' + res.status + ')');
  const total = Number(res.headers.get('content-length') || 0);
  if (!total) throw new Error('file size unknown');
  return await uploadFrom(res.body, total, mime, KEY);
}
async function uploadFrom(body: ReadableStream<Uint8Array>, total: number, mime: string, KEY: string): Promise<any> {
  const start = await fetch(API + '/upload/v1beta/files?key=' + KEY, {
    method: 'POST',
    headers: { 'X-Goog-Upload-Protocol': 'resumable', 'X-Goog-Upload-Command': 'start',
      'X-Goog-Upload-Header-Content-Length': String(total), 'X-Goog-Upload-Header-Content-Type': mime,
      'Content-Type': 'application/json' },
    body: JSON.stringify({ file: { display_name: 'document' } }) });
  const upUrl = start.headers.get('X-Goog-Upload-URL');
  if (!upUrl) throw new Error('gemini upload start failed ' + start.status + ' ' + (await start.text()).slice(0, 120));
  const reader = body.getReader();
  let buf = new Uint8Array(CHUNK), fill = 0, offset = 0, last: any = null;
  const send = async (piece: Uint8Array, final: boolean) => {
    const r = await fetch(upUrl, { method: 'POST',
      headers: { 'X-Goog-Upload-Command': final ? 'upload, finalize' : 'upload', 'X-Goog-Upload-Offset': String(offset) },
      body: piece as unknown as BodyInit });
    const t = await r.text();
    if (!r.ok) throw new Error('gemini upload ' + r.status + ' ' + t.slice(0, 120));
    offset += piece.length;
    if (final) last = JSON.parse(t);
  };
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    let v = value as Uint8Array;
    while (v.length) {
      const take = Math.min(CHUNK - fill, v.length);
      buf.set(v.subarray(0, take), fill); fill += take; v = v.subarray(take);
      if (fill === CHUNK && offset + fill < total) { await send(buf, false); buf = new Uint8Array(CHUNK); fill = 0; }
    }
  }
  await send(buf.subarray(0, fill), true);
  let file = last && last.file;
  for (let i = 0; i < 90 && file && file.state === 'PROCESSING'; i++) {
    await sleep(2000);
    file = await (await fetch(API + '/v1beta/' + file.name + '?key=' + KEY)).json();
  }
  if (!file || file.state !== 'ACTIVE') throw new Error('gemini file not active: ' + (file && file.state));
  return file;
}

async function uploadBytes(bytes: Uint8Array, mime: string, KEY: string): Promise<any> {
  return await uploadFrom(new Blob([bytes as unknown as BlobPart]).stream(), bytes.length, mime, KEY);
}

/* WORD FILES. .docx: the text of word/document.xml, one paragraph a line. .doc (binary): the runs of
   readable text, tried as UTF-16 and as 8-bit, whichever gives more. */
function readWord(bytes: Uint8Array, name: string, type: string): string {
  const isDocx = /\.docx$/i.test(name) || /openxmlformats/i.test(type) || (bytes[0] === 0x50 && bytes[1] === 0x4b);
  if (isDocx) {
    const z = unzipSync(bytes, { filter: (f) => /^word\/(document|header\d*|footer\d*|footnotes)\.xml$/.test(f.name) });
    return Object.keys(z).sort().map((k) => strFromU8(z[k])
      .replace(/<w:tab\/>/g, ' ').replace(/<\/w:p>/g, '\n').replace(/<[^>]+>/g, '')
      .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'"))
      .join('\n');
  }
  // Printable English, Devanagari and Bengali only - the binary around the text decodes to Latin-1
  // letters like "ÿþ" that would otherwise pass for words.
  const runs = (s: string) => (s.match(/[\x20-\x7Eऀ-৿‘-”₹]{6,}/g) || [])
    .filter((x) => /[A-Za-zऀ-৿]{3}/.test(x) && (x.match(/[A-Za-zऀ-৿ ]/g) || []).length > x.length * 0.6).join('\n');
  const u16 = runs(new TextDecoder('utf-16le').decode(bytes));
  const u8 = runs(new TextDecoder('latin1').decode(bytes));
  return u16.length > u8.length ? u16 : u8;
}

/* What the file really is, from its first bytes - some were saved under the wrong extension. */
function sniff(b: Uint8Array): string | null {
  if (b[0] === 0xff && b[1] === 0xd8) return 'image/jpeg';
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png';
  if (b[0] === 0x50 && b[1] === 0x4b) return 'word';
  if (b[0] === 0xd0 && b[1] === 0xcf && b[2] === 0x11 && b[3] === 0xe0) return 'word';
  for (let i = 0; i < Math.min(b.length - 4, 1024); i++) if (b[i] === 0x25 && b[i + 1] === 0x50 && b[i + 2] === 0x44 && b[i + 3] === 0x46) return 'application/pdf';
  return null;
}

export const WORD_TYPES = ['doc', 'docx', 'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document'];
const MIMES: Record<string, string> = { pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
  webp: 'image/webp', heic: 'image/heic', heif: 'image/heif' };
function mimeOf(type: string, name: string): string | null {
  const t = String(type || '').toLowerCase().trim();
  if (t.includes('/')) return t === 'image/jpg' ? 'image/jpeg' : (Object.values(MIMES).includes(t) ? t : null);
  return MIMES[t] || MIMES[String(name || '').split('.').pop()!.toLowerCase()] || null;
}

/* The whole text of one document. `url` is a signed GET for the file. Throws CreditsError when the
   quota is gone, Error when the file truly cannot be read. */
export async function readDocument(url: string, type: string, name: string, size: number, KEY: string, id: number, ctx: Ctx): Promise<string> {
  if (WORD_TYPES.includes(String(type || '').toLowerCase()) || /\.docx?$/i.test(name)) {
    const r = await fetch(url); if (!r.ok) throw new Error('fetch failed (' + r.status + ')');
    return readWord(new Uint8Array(await r.arrayBuffer()), name, type);
  }
  const mime = mimeOf(type, name);
  if (!mime) throw new Error('unsupported file type: ' + type);
  const isPdf = mime === 'application/pdf';

  // Small: inline. If Gemini calls it invalid, fall through to the uploaded-file route.
  if (size && size <= INLINE_MAX) {
    const r = await fetch(url); if (!r.ok) throw new Error('fetch failed (' + r.status + ')');
    const bytes = new Uint8Array(await r.arrayBuffer());
    const real = sniff(bytes) || mime;
    if (real !== mime) log(id, 'saved as ' + mime + ' but the file is ' + real);
    if (real === 'word') return readWord(bytes, name + '.docx', type);
    try { return await readPart({ inline_data: { mime_type: real, data: encodeBase64(bytes) } }, real === 'application/pdf', bytes.length, KEY, id, ctx); }
    catch (e: any) {
      if (e instanceof CreditsError || e.status !== 400) throw e;
      log(id, 'inline refused (' + String(e.message).slice(0, 80) + ') - trying as an uploaded file');
    }
  }
  try {
    const pg = ctx.progress;
    if (!pg.fileUri || !(pg.fileExp > Date.now() + 3600e3)) {
      const f = await uploadStream(url, mime, KEY);
      pg.fileUri = f.uri; pg.fileMime = f.mimeType || mime; pg.fileExp = Date.now() + 46 * 3600e3;   // Gemini keeps it 48h
      await ctx.save();
    }
    return await readPart({ file_data: { mime_type: pg.fileMime, file_uri: pg.fileUri } }, isPdf, size, KEY, id, ctx);
  } catch (e: any) {
    if (e instanceof TimeUp) throw e;
    if (e?.status === 400 || /not active|FAILED/i.test(String(e?.message))) { ctx.progress.fileUri = null; ctx.progress.pages = null; ctx.progress.ranges = null; }
    if (e instanceof CreditsError || !isPdf || (size && size > REPAIR_MAX)) throw e;
    if (e.status !== 400 && !/not active|FAILED/i.test(String(e.message))) throw e;
    log(id, 'refused as uploaded (' + String(e.message).slice(0, 80) + ') - rebuilding the PDF');
  }
  const r = await fetch(url); if (!r.ok) throw new Error('fetch failed (' + r.status + ')');
  const raw = new Uint8Array(await r.arrayBuffer());
  // Anything before %PDF (a mail header, a BOM) is dropped, then pdf-lib writes the file out cleanly.
  let at = 0;
  for (let i = 0; i < Math.min(raw.length - 4, 4096); i++) if (raw[i] === 0x25 && raw[i + 1] === 0x50 && raw[i + 2] === 0x44 && raw[i + 3] === 0x46) { at = i; break; }
  const src = await PDFDocument.load(raw.subarray(at), { ignoreEncryption: true, throwOnInvalidObject: false, updateMetadata: false } as any);
  let fixed: Uint8Array;
  try { fixed = new Uint8Array(await src.save({ useObjectStreams: false })); }
  catch (_e) {
    const out = await PDFDocument.create();
    (await out.copyPages(src, src.getPageIndices())).forEach((p) => out.addPage(p));
    fixed = new Uint8Array(await out.save());
  }
  const f = await uploadBytes(fixed, mime, KEY);
  ctx.progress.fileUri = f.uri; ctx.progress.fileMime = f.mimeType || mime; ctx.progress.fileExp = Date.now() + 46 * 3600e3;
  await ctx.save();
  return await readPart({ file_data: { mime_type: f.mimeType || mime, file_uri: f.uri } }, true, fixed.length, KEY, id, ctx);
}
