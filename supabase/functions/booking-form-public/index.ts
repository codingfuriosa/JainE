// booking-form-public - receives the Digital Booking Form (booking-form.html) from customers.
//
// PUBLIC on purpose (verify_jwt off): customers have no JainE login. So everything is checked here, never trusted
// from the page. Two ways in:
//
//  1. THE OPEN LINK (booking-form.html?p=ananta): one multipart POST with the whole form at the end (as before).
//
//  2. A GENERATED LINK (booking-form.html?t=<token>, made by Sales / the Administrator with "Generate Form"; 7 Nov 2026):
//     the same page for everybody - never a new page per form. The token is 64 random hex characters (two random UUIDs),
//     so it cannot be guessed; the page is public for whoever holds it. The row in acc.digital_booking_links holds
//       - prefill: what Sales filled in (name, title, nationality, date of birth, mobile, email, contact person, block,
//         floor, flat, flat number, car park, bedrooms, built-up area, total sale price) and `locked`, the list of those
//         answers - the customer sees them but can never change them: they are put back here on every save and on submit
//       - the customer's draft: every answer so far, the step they are on, the signature, the PAN / Aadhaar files
//         (uploaded as soon as they are attached). Closing the tab and opening the link again lands on the same step.
//     JSON actions:  load | save | remove_file      multipart actions:  upload | (no action) = submit
//     When submitted, the full answers go to acc.digital_booking_forms exactly like the open link does and the link is
//     closed. Nothing here starts a Booking Form Flow case.
//
// Checks on submit: known project; 1-6 applicants; names, mobile, email, PAN / Aadhaar formats; the first applicant has
// signed; no two applicants share a PAN or Aadhaar; Indian nationals have attached PAN and Aadhaar; files are images or
// PDFs, at most 10 MB each and 45 MB together; a hidden field bots fill, and at most 5 submissions an hour per address.
// Files go to the private S3 bucket under portal/digital-booking/<id>/ - the same s3: paths staff open everywhere else
// in JainE. The page gets back only a reference number.
import { AwsClient } from "https://esm.sh/aws4fetch@1.0.20";

const SB = Deno.env.get("SUPABASE_URL")!, SRV = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "content-type, x-client-info, apikey, authorization", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const j = (o: unknown, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { ...cors, "Content-Type": "application/json", "Cache-Control": "no-store" } });
const H = { apikey: SRV, Authorization: "Bearer " + SRV, "Content-Type": "application/json" };

// Projects that have a digital form. code = the reference-number prefix.
const PROJECTS: Record<string, { code: string; name: string; terms: string }> = {
  ananta: { code: "ANA", name: "Dream Ananta", terms: "ananta-2026-11-02" },
};
const MAX_APPLICANTS = 6, MAX_FILE = 10 * 1024 * 1024, MAX_TOTAL = 45 * 1024 * 1024, MAX_DRAFT_FILES = 24, MAX_DRAFT_JSON = 150_000, MAX_SIG = 400_000;
const OK_TYPES = /^(image\/(jpeg|png|webp|heic|heif)|application\/pdf)$/;
const PAN = /^[A-Z]{5}[0-9]{4}[A-Z]$/, AADHAAR = /^[0-9]{12}$/, EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const TOKEN = /^[a-f0-9]{64}$/;
const NOT_VALID = "This booking link is not valid. Please use the exact link our team sent you.";

const clean = (v: unknown, max = 300) => (typeof v === "string" ? v.replace(/[\u0000-\u001f]/g, " ").trim().slice(0, max) : "");
const safeName = (s: string) => s.replace(/[^A-Za-z0-9._-]+/g, "_").slice(-80) || "file";

async function db(path: string, init: RequestInit = {}, schema = "acc") {
  const r = await fetch(`${SB}/rest/v1/${path}`, { ...init, headers: { ...H, "Accept-Profile": schema, "Content-Profile": schema, ...(init.headers || {}) } });
  const t = await r.text();
  if (!r.ok) throw new Error(`db ${path.split("?")[0]} ${r.status} ${t.slice(0, 200)}`);
  return t ? JSON.parse(t) : null;
}

// ---- generated links
function getPath(o: any, path: string) { return path.split(".").reduce((x: any, k) => (x == null ? x : x[k]), o); }
function setPath(o: any, path: string, v: unknown) {
  const ks = path.split("."); let c = o;
  for (let i = 0; i < ks.length - 1; i++) {
    const k = ks[i];
    if (c[k] == null || typeof c[k] !== "object") c[k] = /^\d+$/.test(ks[i + 1]) ? [] : {};
    c = c[k];
  }
  c[ks[ks.length - 1]] = v;
}
// Sales' answers are put back over whatever the page sent: a customer cannot change them, whatever they do.
function applyLocked(d: any, pf: any) {
  for (const p of (Array.isArray(pf?.locked) ? pf.locked : [])) {
    const v = getPath(pf.values || {}, p);
    setPath(d, p, v == null ? "" : v);
  }
  return d;
}
async function getLink(token: string) {
  if (!TOKEN.test(token || "")) return null;
  const rows = await db(`digital_booking_links?select=*&token=eq.${token}&limit=1`);
  return rows && rows[0] ? rows[0] : null;
}
const awsClient = () => {
  const bucket = Deno.env.get("S3_BUCKET"), region = Deno.env.get("S3_REGION");
  const ak = Deno.env.get("AWS_ACCESS_KEY_ID"), sk = Deno.env.get("AWS_SECRET_ACCESS_KEY");
  if (!bucket || !region || !ak || !sk) return null;
  return { bucket, region, aws: new AwsClient({ accessKeyId: ak, secretAccessKey: sk, region, service: "s3" }) };
};
const s3url = (c: { bucket: string; region: string }, key: string) => `https://${c.bucket}.s3.${c.region}.amazonaws.com/${key.split("/").map(encodeURIComponent).join("/")}`;
const extOf = (name: string) => (name.split(".").pop() || "").toLowerCase().replace(/[^a-z0-9]/g, "") || "bin";
const draftFileView = (f: any) => ({ id: f.id, applicant: f.applicant, kind: f.kind, name: f.name, ext: extOf(f.name || "") });

// Customer's list of files (id, applicant, kind) wins; a file nobody lists any more is dropped - but not in its first
// 20 seconds, so a save that crosses an upload on the way cannot throw the new file away.
async function reconcileFiles(link: any, listed: any) {
  const keep = new Map<string, any>();
  if (Array.isArray(listed)) for (const x of listed) if (x && typeof x.id === "string") keep.set(x.id, x);
  const cur: any[] = Array.isArray(link.draft_files) ? link.draft_files : [];
  const out: any[] = [], drop: any[] = [];
  for (const f of cur) {
    const x = keep.get(f.id);
    if (x) {
      const a = Number(x.applicant), kind = x.kind === "aadhaar" ? "aadhaar" : x.kind === "pan" ? "pan" : f.kind;
      out.push({ ...f, applicant: Number.isInteger(a) && a >= 0 && a < MAX_APPLICANTS ? a : f.applicant, kind });
    } else if (Date.now() - (f.at || 0) < 20_000) out.push(f);
    else drop.push(f);
  }
  if (drop.length) {
    const c = awsClient();
    if (c) for (const f of drop) { try { await c.aws.fetch(s3url(c, String(f.path).replace(/^s3:/, "")), { method: "DELETE" }); } catch (_) { /* best effort */ } }
  }
  return out;
}

// A submitted form opened again through its link is shown read-only. The link is the only credential, so identity numbers are masked
// (PAN and Aadhaar show their last four characters only, passport and bank details just say they were given) and no file is returned.
const maskTail = (v: unknown, keep = 4, ch = "X") => { const t = String(v ?? "").replace(/\s/g, ""); return t ? ch.repeat(Math.max(0, t.length - keep)) + t.slice(-keep) : ""; };
async function submittedView(link: any) {
  if (!link.form_id) return null;
  const rows = await db(`digital_booking_forms?select=data,files,submitted_at&id=eq.${link.form_id}&limit=1`);
  const r = rows && rows[0]; if (!r || !r.data) return null;
  const d = JSON.parse(JSON.stringify(r.data));
  delete d.website; delete d.submitted_on_device;
  (Array.isArray(d.applicants) ? d.applicants : []).forEach((a: any) => {
    a.pan = maskTail(a.pan); a.aadhaar = maskTail(a.aadhaar);
    a.passport = a.passport ? "Provided" : ""; a.bank_details = a.bank_details ? "Provided" : "";
  });
  const files: any[] = Array.isArray(r.files) ? r.files : [];
  return { data: d, submitted_at: r.submitted_at, signed: files.some((f) => f.kind === "signature"),
           docs: files.filter((f) => f.kind !== "signature").map((f) => ({ applicant: Number(f.applicant) - 1, kind: f.kind })) };
}

// STAFF VIEW of a submitted form (the same page the customer gets, with everything they gave): only for a signed-in JainE user who may generate
// forms (the Administrator and the Sales department). The page sends the user's own session token; it is checked here with Supabase Auth.
async function staffUser(req: Request): Promise<string | null> {
  const m = /^Bearer\s+(.+)$/i.exec(req.headers.get("authorization") || "");
  if (!m) return null;
  const r = await fetch(SB + "/auth/v1/user", { headers: { apikey: SRV, Authorization: "Bearer " + m[1] } });
  if (!r.ok) return null;
  const u: any = await r.json().catch(() => null);
  const email = String(u?.email || "").toLowerCase();
  if (!u?.id || !email) return null;
  if (email === "ayushruia1@gmail.com") return email;
  // (Sales lookup, kept for when it is given back: const rows = await db("user_profile?select=department&email=eq." + encodeURIComponent(email) + "&limit=1"); const dep = rows && rows[0] && rows[0].department;)
  // 13 Nov 2026, on the Administrator's word: Sales is switched off for now (only the Administrator). To give Sales back, restore:
  //   return Array.isArray(dep) && dep.includes("Sales") ? email : null;
  return null;
}
async function signedGet(c: { bucket: string; region: string; aws: any }, key: string) {
  const u = new URL(s3url(c, key)); u.searchParams.set("X-Amz-Expires", "600");
  const signed = await c.aws.sign(u.toString(), { method: "GET", aws: { signQuery: true } });
  return signed.url as string;
}

async function handleJson(req: Request) {
  let b: any;
  try { b = await req.json(); } catch (_) { return j({ error: "The request did not arrive complete." }, 400); }
  const link = await getLink(String(b.token || ""));
  if (!link) return j({ error: NOT_VALID }, 404);
  const proj = PROJECTS[link.project];
  if (!proj) return j({ error: NOT_VALID }, 404);

  if (b.action === "staff_load" || b.action === "staff_set") {
    const who = await staffUser(req);
    if (!who) return j({ error: "Not allowed." }, 403);
    if (link.status !== "completed" || !link.form_id) return j({ error: "This form has not been submitted yet." }, 409);
    const rows = await db("digital_booking_forms?select=id,data,files,submitted_at,status,note,seen_by,seen_at&id=eq." + link.form_id + "&limit=1");
    const f = rows && rows[0]; if (!f) return j({ error: "Form not found." }, 404);
    if (b.action === "staff_set") {
      const patch: any = {};
      if (typeof b.status === "string" && ["new", "seen", "used", "rejected"].includes(b.status)) patch.status = b.status;
      if (typeof b.note === "string") patch.note = b.note.slice(0, 2000);
      if (Object.keys(patch).length) await db("digital_booking_forms?id=eq." + f.id, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify(patch) });
      return j({ ok: true });
    }
    if (f.status === "new") {
      const at = new Date().toISOString();
      await db("digital_booking_forms?id=eq." + f.id + "&status=eq.new", { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ status: "seen", seen_by: who, seen_at: at }) });
      f.status = "seen"; f.seen_by = who; f.seen_at = at;
    }
    const c = awsClient();
    const files: any[] = [];
    for (const x of (Array.isArray(f.files) ? f.files : [])) {
      let url = "";
      try { if (c && typeof x.path === "string") url = await signedGet(c, x.path.replace(/^s3:/, "")); } catch (_) { /* leave empty */ }
      files.push({ applicant: Number(x.applicant) - 1, kind: x.kind, name: x.name, url });
    }
    const data = JSON.parse(JSON.stringify(f.data || {})); delete data.website;
    return j({ ok: true, staff: true, status: "completed", ref_no: link.ref_no || "", form: { data, files, submitted_at: f.submitted_at, status: f.status, note: f.note || "", seen_by: f.seen_by || "", seen_at: f.seen_at || null } });
  }

  if (b.action === "load") {
    if (link.status === "cancelled") return j({ ok: true, status: "cancelled" });
    if (link.status === "completed") return j({ ok: true, status: "completed", ref_no: link.ref_no || "", submitted: await submittedView(link).catch(() => null) });
    if (!link.opened_at) await db(`digital_booking_links?id=eq.${link.id}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ opened_at: new Date().toISOString() }) });
    return j({
      ok: true, status: "open", project: link.project, prefill: link.prefill || {},
      draft: link.draft || null, step: link.draft_step || 0, sig: link.draft_sig || null,
      files: (Array.isArray(link.draft_files) ? link.draft_files : []).map(draftFileView),
    });
  }
  if (link.status !== "open") return j({ error: link.status === "completed" ? "This form has already been submitted." : NOT_VALID }, 409);

  if (b.action === "save") {
    const d = b.data;
    if (!d || typeof d !== "object" || Array.isArray(d)) return j({ error: "Nothing to save." }, 400);
    delete d.website;
    if (Array.isArray(d.applicants)) d.applicants = d.applicants.slice(0, MAX_APPLICANTS);
    applyLocked(d, link.prefill);
    d.project = link.project;
    if (JSON.stringify(d).length > MAX_DRAFT_JSON) return j({ error: "Too much text to save." }, 413);
    const step = Math.max(0, Math.min(7, parseInt(String(b.step ?? d.step ?? 0), 10) || 0));
    const patch: any = { draft: d, draft_step: step, draft_saved_at: new Date().toISOString() };
    if (Object.prototype.hasOwnProperty.call(b, "sig")) {
      if (b.sig === null) patch.draft_sig = null;
      else if (typeof b.sig === "string" && b.sig.startsWith("data:image/png;base64,") && b.sig.length < MAX_SIG) patch.draft_sig = b.sig;
    }
    if (Array.isArray(b.files)) patch.draft_files = await reconcileFiles(link, b.files);
    await db(`digital_booking_links?id=eq.${link.id}&status=eq.open`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify(patch) });
    return j({ ok: true, saved_at: patch.draft_saved_at });
  }
  if (b.action === "remove_file") {
    const cur: any[] = Array.isArray(link.draft_files) ? link.draft_files : [];
    const gone = cur.filter((f: any) => f.id === String(b.id)), files = cur.filter((f: any) => f.id !== String(b.id));
    const c = awsClient();
    if (c) for (const f of gone) { try { await c.aws.fetch(s3url(c, String(f.path).replace(/^s3:/, "")), { method: "DELETE" }); } catch (_) { /* best effort */ } }
    await db(`digital_booking_links?id=eq.${link.id}&status=eq.open`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ draft_files: files }) });
    return j({ ok: true });
  }
  return j({ error: "Unknown request." }, 400);
}

// A KYC photo attached on a generated link: kept at once, so it is still there when the customer comes back.
async function handleUpload(form: FormData) {
  const link = await getLink(clean(form.get("token"), 80));
  if (!link || link.status !== "open") return j({ error: NOT_VALID }, 404);
  const file = form.get("file");
  const ai = Number(clean(form.get("applicant"), 2)), kind = clean(form.get("kind"), 10);
  if (!(file instanceof File) || !Number.isInteger(ai) || ai < 0 || ai >= MAX_APPLICANTS || (kind !== "pan" && kind !== "aadhaar")) return j({ error: "That file could not be read." }, 400);
  if (file.size > MAX_FILE) return j({ error: "That file is over 10 MB. Please attach a smaller photo or PDF." }, 400);
  if (!OK_TYPES.test(file.type || "")) return j({ error: "Please attach a photo (JPG, PNG) or a PDF." }, 400);
  const cur: any[] = Array.isArray(link.draft_files) ? link.draft_files : [];
  if (cur.length >= MAX_DRAFT_FILES) return j({ error: "Too many files attached." }, 400);
  if (cur.reduce((s, f) => s + (f.size || 0), 0) + file.size > MAX_TOTAL) return j({ error: "The attached files are too large together. Please attach smaller photos." }, 400);
  const c = awsClient();
  if (!c) return j({ error: "We could not save your file just now. Please try again in a few minutes." }, 500);
  const id = crypto.randomUUID();
  const key = `portal/digital-booking/${link.id}/applicant${ai + 1}_${kind}_${id.slice(0, 8)}.${extOf(file.name)}`;
  const put = await c.aws.fetch(s3url(c, key), { method: "PUT", body: new Uint8Array(await file.arrayBuffer()), headers: { "Content-Type": file.type || "application/octet-stream" } });
  if (!put.ok) return j({ error: "That file did not upload. Please try again." }, 502);
  const rec = { id, applicant: ai, kind, name: safeName(file.name), path: "s3:" + key, size: file.size, at: Date.now() };
  // Read again just before writing, so two quick uploads do not overwrite each other.
  const fresh = await getLink(String(link.token));
  const list = [...(Array.isArray(fresh?.draft_files) ? fresh.draft_files : cur), rec];
  await db(`digital_booking_links?id=eq.${link.id}&status=eq.open`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ draft_files: list }) });
  return j({ ok: true, file: draftFileView(rec) });
}

async function handleSubmit(form: FormData, ip: string, req: Request) {
  let d: any;
  try { d = JSON.parse(String(form.get("data") || "")); } catch (_) { return j({ error: "The form did not arrive complete. Please try again." }, 400); }
  if (clean(d.website)) return j({ ok: true, ref_no: "RECEIVED" });            // honeypot: bots only

  // A generated link: its project, Sales' locked answers and the files already kept all come from the link, not the page.
  const tok = clean(form.get("token"), 80);
  let link: any = null;
  if (tok) {
    link = await getLink(tok);
    if (!link) return j({ error: NOT_VALID }, 404);
    if (link.status === "completed") return j({ ok: true, ref_no: link.ref_no || "RECEIVED", already: true });
    if (link.status !== "open") return j({ error: NOT_VALID }, 409);
    d.project = link.project;
    applyLocked(d, link.prefill);
  }
  const proj = PROJECTS[clean(d.project, 30)];
  if (!proj) return j({ error: "This booking link is not valid." }, 400);

  // ---- answers
  const apps = Array.isArray(d.applicants) ? d.applicants.slice(0, MAX_APPLICANTS) : [];
  if (!apps.length) return j({ error: "Please add at least one applicant." }, 400);
  const problems: string[] = [];
  const seenPan: Record<string, number> = {}, seenAad: Record<string, number> = {};
  apps.forEach((a: any, i: number) => {
    const who = i ? `Applicant ${i + 1}` : "First applicant";
    if (!clean(a.full_name)) problems.push(`${who}: name is missing`);
    const pan = clean(a.pan, 10).toUpperCase(), aad = clean(a.aadhaar, 14).replace(/\s/g, "");
    if (pan && !PAN.test(pan)) problems.push(`${who}: PAN should look like ABCDE1234F`);
    if (aad && !AADHAAR.test(aad)) problems.push(`${who}: Aadhaar number should be 12 digits`);
    // Each applicant is a different person: the same PAN or Aadhaar twice is a mistake.
    if (pan && seenPan[pan] != null) problems.push(`${who}: same PAN as applicant ${seenPan[pan] + 1}`); else if (pan) seenPan[pan] = i;
    if (aad && seenAad[aad] != null) problems.push(`${who}: same Aadhaar as applicant ${seenAad[aad] + 1}`); else if (aad) seenAad[aad] = i;
  });
  const c = d.contact || {};
  if (!/^[0-9+\-\s]{8,18}$/.test(clean(c.mobile, 20))) problems.push("Mobile number is missing or incomplete");
  if (!EMAIL.test(clean(c.email, 200))) problems.push("Email address is missing or incomplete");
  if (!d.terms_accepted) problems.push("Please read and accept the terms");

  // ---- files: kept earlier (generated link) or sent now as f_<applicant>_<pan|aadhaar>_<n>, sig_<applicant>
  const listed = form.get("files") ? safeJson(form.get("files"), null) : link?.draft_files;
  const kept: any[] = link ? await reconcileFiles(link, listed) : [];
  const files: { applicant: number; kind: string; file: File }[] = [];
  let total = kept.reduce((s, f) => s + (f.size || 0), 0);
  for (const [k, v] of form.entries()) {
    if (!(v instanceof File)) continue;
    const m = /^f_(\d)_(pan|aadhaar)_\d$/.exec(k) || /^sig_(\d)$/.exec(k);
    if (!m) continue;
    const ai = Number(m[1]); if (ai >= apps.length) continue;
    const kind = k.startsWith("sig_") ? "signature" : m[2];
    if (v.size > MAX_FILE) return j({ error: `A file for applicant ${ai + 1} is larger than 10 MB. Please attach a smaller photo or PDF.` }, 400);
    if (kind !== "signature" && !OK_TYPES.test(v.type || "")) return j({ error: `Please attach PAN / Aadhaar as a photo (JPG, PNG) or PDF.` }, 400);
    if (kind === "signature" && v.type !== "image/png") continue;
    total += v.size; files.push({ applicant: ai, kind, file: v });
  }
  // The signature drawn earlier on a generated link was kept as a data URL.
  if (link && !files.some((f) => f.kind === "signature") && typeof link.draft_sig === "string" && link.draft_sig.startsWith("data:image/png;base64,")) {
    const bin = Uint8Array.from(atob(link.draft_sig.split(",")[1]), (ch) => ch.charCodeAt(0));
    files.push({ applicant: 0, kind: "signature", file: new File([bin], "signature.png", { type: "image/png" }) });
  }
  if (total > MAX_TOTAL) return j({ error: "The attached files are too large together (over 45 MB). Please attach smaller photos." }, 400);
  const has = (ai: number, kind: string) => files.some((f) => f.applicant === ai && f.kind === kind) || kept.some((f) => f.applicant === ai && f.kind === kind);
  apps.forEach((a: any, i: number) => {
    const who = i ? `Applicant ${i + 1}` : "First applicant";
    // Only the first applicant signs (the user's decision, 2 Nov 2026).
    if (i === 0 && !files.some((f) => f.applicant === 0 && f.kind === "signature")) problems.push(`${who} has not signed`);
    const indian = !clean(a.nationality) || /^india$/i.test(clean(a.nationality));
    if (indian && !has(i, "pan")) problems.push(`${who}: please attach the PAN card`);
    if (indian && !has(i, "aadhaar")) problems.push(`${who}: please attach the Aadhaar card`);
  });
  if (problems.length) return j({ error: "Please check: " + problems.join("; ") + ".", problems }, 400);

  try {
    // ---- at most 5 an hour from one address
    const since = new Date(Date.now() - 3600_000).toISOString();
    const recent = await db(`digital_booking_forms?select=id&ip=eq.${encodeURIComponent(ip)}&submitted_at=gte.${since}`);
    if ((recent || []).length >= 5) return j({ error: "Too many forms from this connection in the last hour. Please try again later or call us." }, 429);

    const id = crypto.randomUUID();
    const ref = await db("rpc/digital_booking_next_ref", { method: "POST", body: JSON.stringify({ p_project: clean(d.project, 30), p_code: proj.code }) });

    // ---- files to S3
    const s3 = awsClient();
    if (!s3) return j({ error: "We could not save your files just now. Please try again in a few minutes." }, 500);
    const saved: any[] = kept.map((f) => ({ applicant: f.applicant + 1, kind: f.kind, path: f.path, name: f.name }));
    let n = saved.length;
    for (const f of files) {
      const ext = f.kind === "signature" ? "png" : extOf(f.file.name);
      const key = `portal/digital-booking/${id}/applicant${f.applicant + 1}_${f.kind}_${++n}.${ext}`;
      const put = await s3.aws.fetch(s3url(s3, key), { method: "PUT", body: new Uint8Array(await f.file.arrayBuffer()), headers: { "Content-Type": f.file.type || "application/octet-stream" } });
      if (!put.ok) return j({ error: "One of your files did not upload. Please try again." }, 502);
      saved.push({ applicant: f.applicant + 1, kind: f.kind, path: "s3:" + key, name: f.kind === "signature" ? "signature.png" : safeName(f.file.name) });
    }

    // ---- the row. Everything the customer typed is kept as given (trimmed), nothing is derived.
    delete d.website;
    await db("digital_booking_forms", { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify({
      id, ref_no: ref, project: clean(d.project, 30), applicants: apps.length,
      first_name: clean(apps[0].full_name, 200), mobile: clean(c.mobile, 20), email: clean(c.email, 200).toLowerCase(),
      data: d, files: saved, terms_version: proj.terms, ip, user_agent: clean(req.headers.get("user-agent") || "", 300),
      link_id: link ? link.id : null,
    }) });
    if (link) {
      // The link is used up; the answers now live in the form row, so the draft copies are cleared.
      await db(`digital_booking_links?id=eq.${link.id}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({
        status: "completed", completed_at: new Date().toISOString(), form_id: id, ref_no: ref, draft: null, draft_sig: null, draft_files: [],
      }) });
    }
    return j({ ok: true, ref_no: ref });
  } catch (e) {
    console.error(e);
    return j({ error: "We could not save your form just now. Nothing was lost on your phone - please press Submit again in a minute." }, 500);
  }
}
function safeJson(v: unknown, fallback: unknown) { try { return JSON.parse(String(v)); } catch (_) { return fallback; } }

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return j({ error: "method not allowed" }, 405);
  const ip = (req.headers.get("x-forwarded-for") || "").split(",")[0].trim() || "unknown";
  try {
    if ((req.headers.get("content-type") || "").includes("application/json")) return await handleJson(req);
    let form: FormData;
    try { form = await req.formData(); } catch (_) { return j({ error: "The form did not arrive complete. Please try again." }, 400); }
    if (clean(form.get("action"), 20) === "upload") return await handleUpload(form);
    return await handleSubmit(form, ip, req);
  } catch (e) {
    console.error(e);
    return j({ error: "Something went wrong on our side. Please try again in a minute." }, 500);
  }
});
