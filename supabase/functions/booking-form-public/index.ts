// booking-form-public - receives the Digital Booking Form (booking-form.html) from customers.
//
// PUBLIC on purpose (verify_jwt off): one open link per project, filled by customers who have no
// JainE login. So everything is checked here, never trusted from the page:
//   - known project only; 1-6 applicants; names, mobile, email, PAN / Aadhaar formats
//   - every applicant has signed (a PNG drawn on the page) and Indian nationals have attached PAN and
//     Aadhaar; files are images or PDFs, at most 10 MB each and 45 MB together
//   - a hidden field bots fill, and at most 5 submissions an hour from one address
// Files go to the private S3 bucket under portal/digital-booking/<id>/ - the same s3: paths staff
// open everywhere else in JainE - and the answers to acc.digital_booking_forms. The page gets back
// only a reference number.
import { AwsClient } from "https://esm.sh/aws4fetch@1.0.20";

const SB = Deno.env.get("SUPABASE_URL")!, SRV = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "content-type, x-client-info, apikey, authorization", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const j = (o: unknown, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { ...cors, "Content-Type": "application/json" } });
const H = { apikey: SRV, Authorization: "Bearer " + SRV, "Content-Type": "application/json" };

// Projects that have a digital form. code = the reference-number prefix.
const PROJECTS: Record<string, { code: string; name: string; terms: string }> = {
  ananta: { code: "ANA", name: "Dream Ananta", terms: "ananta-2026-11-02" },
};
const MAX_APPLICANTS = 6, MAX_FILE = 10 * 1024 * 1024, MAX_TOTAL = 45 * 1024 * 1024;
const OK_TYPES = /^(image\/(jpeg|png|webp|heic|heif)|application\/pdf)$/;
const PAN = /^[A-Z]{5}[0-9]{4}[A-Z]$/, AADHAAR = /^[0-9]{12}$/, EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

const clean = (v: unknown, max = 300) => (typeof v === "string" ? v.replace(/[\u0000-\u001f]/g, " ").trim().slice(0, max) : "");
const safeName = (s: string) => s.replace(/[^A-Za-z0-9._-]+/g, "_").slice(-80) || "file";

async function db(path: string, init: RequestInit = {}, schema = "acc") {
  const r = await fetch(`${SB}/rest/v1/${path}`, { ...init, headers: { ...H, "Accept-Profile": schema, "Content-Profile": schema, ...(init.headers || {}) } });
  const t = await r.text();
  if (!r.ok) throw new Error(`db ${path.split("?")[0]} ${r.status} ${t.slice(0, 200)}`);
  return t ? JSON.parse(t) : null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return j({ error: "method not allowed" }, 405);
  const ip = (req.headers.get("x-forwarded-for") || "").split(",")[0].trim() || "unknown";

  let form: FormData;
  try { form = await req.formData(); } catch (_) { return j({ error: "The form did not arrive complete. Please try again." }, 400); }
  let d: any;
  try { d = JSON.parse(String(form.get("data") || "")); } catch (_) { return j({ error: "The form did not arrive complete. Please try again." }, 400); }
  if (clean(d.website)) return j({ ok: true, ref_no: "RECEIVED" });            // honeypot: bots only
  const proj = PROJECTS[clean(d.project, 30)];
  if (!proj) return j({ error: "This booking link is not valid." }, 400);

  // ---- answers
  const apps = Array.isArray(d.applicants) ? d.applicants.slice(0, MAX_APPLICANTS) : [];
  if (!apps.length) return j({ error: "Please add at least one applicant." }, 400);
  const problems: string[] = [];
  apps.forEach((a: any, i: number) => {
    const who = i ? `Applicant ${i + 1}` : "First applicant";
    if (!clean(a.full_name)) problems.push(`${who}: name is missing`);
    if (a.pan && !PAN.test(clean(a.pan, 10).toUpperCase())) problems.push(`${who}: PAN should look like ABCDE1234F`);
    if (a.aadhaar && !AADHAAR.test(clean(a.aadhaar, 14).replace(/\s/g, ""))) problems.push(`${who}: Aadhaar number should be 12 digits`);
  });
  const c = d.contact || {};
  if (!/^[0-9+\-\s]{8,18}$/.test(clean(c.mobile, 20))) problems.push("Mobile number is missing or incomplete");
  if (!EMAIL.test(clean(c.email, 200))) problems.push("Email address is missing or incomplete");
  if (!d.terms_accepted) problems.push("Please read and accept the terms");

  // ---- files: f_<applicant>_<pan|aadhaar>_<n>, sig_<applicant>
  const files: { applicant: number; kind: string; file: File }[] = [];
  let total = 0;
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
  if (total > MAX_TOTAL) return j({ error: "The attached files are too large together (over 45 MB). Please attach smaller photos." }, 400);
  apps.forEach((a: any, i: number) => {
    const who = i ? `Applicant ${i + 1}` : "First applicant";
    if (!files.some((f) => f.applicant === i && f.kind === "signature")) problems.push(`${who} has not signed`);
    const indian = !clean(a.nationality) || /^india$/i.test(clean(a.nationality));
    if (indian && !files.some((f) => f.applicant === i && f.kind === "pan")) problems.push(`${who}: please attach the PAN card`);
    if (indian && !files.some((f) => f.applicant === i && f.kind === "aadhaar")) problems.push(`${who}: please attach the Aadhaar card`);
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
    const bucket = Deno.env.get("S3_BUCKET"), region = Deno.env.get("S3_REGION");
    const ak = Deno.env.get("AWS_ACCESS_KEY_ID"), sk = Deno.env.get("AWS_SECRET_ACCESS_KEY");
    if (!bucket || !region || !ak || !sk) return j({ error: "We could not save your files just now. Please try again in a few minutes." }, 500);
    const aws = new AwsClient({ accessKeyId: ak, secretAccessKey: sk, region, service: "s3" });
    const saved: any[] = [];
    let n = 0;
    for (const f of files) {
      const ext = f.kind === "signature" ? "png" : ((f.file.name.split(".").pop() || "").toLowerCase().replace(/[^a-z0-9]/g, "") || "bin");
      const key = `portal/digital-booking/${id}/applicant${f.applicant + 1}_${f.kind}_${++n}.${ext}`;
      const url = `https://${bucket}.s3.${region}.amazonaws.com/${key.split("/").map(encodeURIComponent).join("/")}`;
      const put = await aws.fetch(url, { method: "PUT", body: new Uint8Array(await f.file.arrayBuffer()), headers: { "Content-Type": f.file.type || "application/octet-stream" } });
      if (!put.ok) return j({ error: "One of your files did not upload. Please try again." }, 502);
      saved.push({ applicant: f.applicant + 1, kind: f.kind, path: "s3:" + key, name: f.kind === "signature" ? "signature.png" : safeName(f.file.name) });
    }

    // ---- the row. Everything the customer typed is kept as given (trimmed), nothing is derived.
    delete d.website;
    await db("digital_booking_forms", { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify({
      id, ref_no: ref, project: clean(d.project, 30), applicants: apps.length,
      first_name: clean(apps[0].full_name, 200), mobile: clean(c.mobile, 20), email: clean(c.email, 200).toLowerCase(),
      data: d, files: saved, terms_version: proj.terms, ip, user_agent: clean(req.headers.get("user-agent") || "", 300),
    }) });
    return j({ ok: true, ref_no: ref });
  } catch (e) {
    console.error(e);
    return j({ error: "We could not save your form just now. Nothing was lost on your phone - please press Submit again in a minute." }, 500);
  }
});
