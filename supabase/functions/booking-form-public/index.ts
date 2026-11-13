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
// 13 Nov 2026: ONE form for every project (PROJECTS below; the project comes from the link). Sales attaches a cost sheet PDF (compulsory) when making the link; after the terms the
// customer sees it as pictures and agrees. There is no signature. Submitting a link that has a cost sheet needs a 6-digit code emailed to the customer (otp_send), and then the
// customer gets a confirmation email (with the cost sheet) from Pallabita Ghosh's mailbox, copied to agm.sales@ and the project's Sales team - TEST MODE (everything to the
// Administrator's inbox only) until acc.job_secrets digital_form_mail_mode = 'live'.
// Checks on submit: known project; 1-6 applicants; names, mobile, email, PAN / Aadhaar formats; the first applicant has
// signed; no two applicants share a PAN or Aadhaar; Indian nationals have attached PAN and Aadhaar; files are images or
// PDFs, at most 10 MB each and 45 MB together; a hidden field bots fill, and at most 5 submissions an hour per address.
// Files go to the private S3 bucket under portal/digital-booking/<id>/ - the same s3: paths staff open everywhere else
// in JainE. The page gets back only a reference number.
import { AwsClient } from "https://esm.sh/aws4fetch@1.0.20";
import { SMTPClient } from "https://deno.land/x/denomailer@1.6.0/mod.ts";

const SB = Deno.env.get("SUPABASE_URL")!, SRV = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "content-type, x-client-info, apikey, authorization", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const j = (o: unknown, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { ...cors, "Content-Type": "application/json", "Cache-Control": "no-store" } });
const H = { apikey: SRV, Authorization: "Bearer " + SRV, "Content-Type": "application/json" };

// ---- Projects (13 Nov 2026: ONE form for every project). code = the reference-number prefix; blocks / floors / bhk fill the Unit page; company + address
// are the addressee on the form and in the cheques line; logo is a file in assets/brand (a missing file simply shows the project's name in its place).
// team = the Sales Manager / executives of the project who are copied on every booking (together with SALES_HEAD, always). Edit here, then redeploy.
// NOT YET CONFIRMED BY THE USER (13 Nov 2026): floors and bedroom lists of every project except Ananta, the company / address of the others, and the team lists.
type Proj = { code: string; name: string; company: string; address: string; terms: string; blocks: string[]; floors: number; bhk: string[]; bhkDefault: string; logo: string; team: string[] };
const GATEWAY = { company: "Dream Gateway Hotels Ltd.", address: "44/2A Hazra Road, Kolkata – 700 019" };
const BHK_ALL = ["1 BHK", "2 BHK", "3 BHK", "4 BHK"];
const SALES_HEAD = "agm.sales@thejaingroup.com", SALES_MANAGER = "sm.sales2@thejaingroup.com";
const mkProj = (code: string, name: string, blocks: string[], extra: Partial<Proj> = {}): Proj => ({ code, name, ...GATEWAY, terms: "generic-2026-11-13", blocks, floors: 20, bhk: BHK_ALL, bhkDefault: "3 BHK", logo: "", team: [SALES_MANAGER], ...extra });
const PROJECTS: Record<string, Proj> = {
  ananta: mkProj("ANA", "Dream Ananta", ["Block D", "Block E"], { terms: "ananta-2026-11-02", floors: 8, bhk: ["2 BHK", "3 BHK", "4 BHK"], logo: "assets/brand/dream-ananta-logo.png" }),
  dreamgurukul: mkProj("DG", "Dream Gurukul", ["Block A1", "Block A2", "Block B", "Block C1", "Block C2"], { logo: "assets/brand/dream-gurukul-logo.png", team: [SALES_MANAGER, "sales.dreamgurukul2@thejaingroup.com", "sales.dreamgurukul4@thejaingroup.com", "sales.dreamgurukul5@thejaingroup.com"] }),
  dreamworldcity: mkProj("DWC", "Dream World City", ["Block A", "Block B", "Block C", "Block D"], { logo: "assets/brand/dream-world-city-logo.png", team: [SALES_MANAGER, "sales.dwc2@thejaingroup.com", "sales.dwc3@thejaingroup.com", "sales.dwc5@thejaingroup.com"] }),
  dreamvalley: mkProj("DV", "Dream Valley", ["Western [I]", "Starwood [II]", "Grand [III]", "Ritz [IV]"], { logo: "assets/brand/dream-valley-logo.png" }),
  dreamone: mkProj("DO", "Dream One", ["Block-1", "Block-2", "Block-3", "Block-4"], { logo: "assets/brand/dream-one-logo.png", team: [SALES_MANAGER, "sales.dreamone1@thejaingroup.com"] }),
  dreamecocity: mkProj("DEC", "Dream Eco City", ["Block-I", "Block-II", "Block-IX", "Durgapur Bungalow"], { logo: "assets/brand/dream-eco-city-logo.png", team: [SALES_MANAGER, "sales.dreamecocity2@thejaingroup.com"] }),
  dreamexotica: mkProj("DEX", "Dream Exotica", ["Block-I", "Block-II", "Block-III", "Block-IV", "Block-V", "Block-VI", "Block-VII"], { team: [SALES_MANAGER, "sales.exotica1@thejaingroup.com"] }),
};
// What the page may know about a project (never the team's email addresses).
const projectInfo = (key: string) => { const p = PROJECTS[key]; return p ? { key, name: p.name, code: p.code, company: p.company, address: p.address, blocks: p.blocks, floors: p.floors, bhk: p.bhk, bhkDefault: p.bhkDefault, logo: p.logo } : null; };
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
// 13 Nov 2026, on the Administrator's word: what Sales fills in is only pre-filled - the customer CAN change it. Nothing is put back any more
// (links made earlier carry a `locked` list; it is ignored). To lock answers again, restore the loop below:
//   for (const p of (Array.isArray(pf?.locked) ? pf.locked : [])) { const v = getPath(pf.values || {}, p); setPath(d, p, v == null ? "" : v); }
function applyLocked(d: any, _pf: any) {
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
  return { data: d, submitted_at: r.submitted_at, project: projectInfo(link.project), cost: costMeta(link),
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

// ---- Cost sheet (13 Nov 2026): Sales attaches a PDF when making the link (compulsory); the customer sees it after the terms as pictures.
// It is kept in the private S3 bucket; the page never gets its path - it asks for the bytes with the link's token (cost_pdf).
const costMeta = (link: any) => { const c = link?.prefill?.cost_sheet; return c && c.path ? { name: String(c.name || "Cost sheet.pdf"), size: Number(c.size) || 0 } : null; };
// The prefill as the customer's page may see it: the cost sheet is shown by name and size only.
const publicPrefill = (link: any) => { const p = JSON.parse(JSON.stringify(link?.prefill || {})); if (p.cost_sheet) p.cost_sheet = { name: p.cost_sheet.name, size: p.cost_sheet.size }; return p; };
async function handleCostUpload(form: FormData, req: Request) {
  const who = await staffUser(req);
  if (!who) return j({ error: "Not allowed." }, 403);
  const file = form.get("file");
  if (!(file instanceof File)) return j({ error: "Please choose the cost sheet PDF." }, 400);
  if (file.size > MAX_FILE) return j({ error: "The cost sheet is over 10 MB. Please attach a smaller PDF." }, 400);
  const bytes = new Uint8Array(await file.arrayBuffer());
  const head = new TextDecoder().decode(bytes.subarray(0, 5));
  if (head !== "%PDF-") return j({ error: "The cost sheet must be a PDF file." }, 400);
  const c = awsClient();
  if (!c) return j({ error: "The file store is not connected." }, 500);
  const key = `portal/digital-booking/cost-sheets/${crypto.randomUUID()}.pdf`;
  const put = await c.aws.fetch(s3url(c, key), { method: "PUT", body: bytes, headers: { "Content-Type": "application/pdf" } });
  if (!put.ok) return j({ error: "The cost sheet did not upload. Please try again." }, 502);
  return j({ ok: true, cost: { path: "s3:" + key, name: safeName(file.name || "Cost sheet.pdf").slice(-100), size: file.size } });
}
async function costBytes(link: any): Promise<Uint8Array | null> {
  const p = link?.prefill?.cost_sheet?.path; if (!p) return null;
  const c = awsClient(); if (!c) return null;
  const r = await c.aws.fetch(s3url(c, String(p).replace(/^s3:/, "")), { method: "GET" });
  return r.ok ? new Uint8Array(await r.arrayBuffer()) : null;
}

// ---- Email (13 Nov 2026): the OTP and the confirmation go from Pallabita Ghosh's mailbox (customercare1@, the same one as the booking letters).
// Until the Administrator says "live" (acc.job_secrets digital_form_mail_mode = 'live') everything goes ONLY to the test inbox, with a banner saying who it would have gone to.
const MAIL_RE = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;
const SITE = (Deno.env.get("PORTAL_URL") || "https://jaingroupe.netlify.app").replace(/\/$/, "");
const hE = (s: unknown) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
function b64Part(mimeType: string, s: string) {
  const bytes = new TextEncoder().encode(s); let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return { mimeType: `${mimeType}; charset="utf-8"`, content: btoa(bin).replace(/.{76}(?=.)/g, "$&\r\n"), transferEncoding: "base64" };
}
const maskEmail = (e: string) => { const [u, d] = e.split("@"); return (u.length <= 2 ? u[0] + "*" : u.slice(0, 2) + "*".repeat(Math.min(6, Math.max(2, u.length - 2)))) + "@" + d; };
async function mailConf() {
  let rows: any[] = [];
  try { rows = (await db("job_secrets?select=name,value&name=in.(digital_form_mail_mode,digital_form_mail_test_to)")) || []; } catch (_) { /* default: test */ }
  const v: Record<string, string> = {}; for (const r of rows) v[r.name] = String(r.value || "");
  const test = (v.digital_form_mail_test_to || "").trim();
  return { live: v.digital_form_mail_mode === "live", testTo: MAIL_RE.test(test) ? test : "ayushruia1@gmail.com" };
}
// Sends one email. to / cc are the REAL recipients; in test mode they are replaced by the test inbox and named in a banner.
async function sendMail(o: { to: string[]; cc?: string[]; subject: string; html: string; text: string; attachments?: any[]; kind: string }) {
  const CU = Deno.env.get("CUSTOMER_MAIL_USER"), CP = Deno.env.get("CUSTOMER_MAIL_APP_PASSWORD");
  if (!CU || !CP) throw new Error("Pallabita Ghosh's mailbox is not connected");
  const conf = await mailConf();
  let { subject, html, text } = o, to = o.to, cc = (o.cc || []).filter((x) => !to.includes(x));
  if (!conf.live) {
    const would = `To: ${o.to.join(", ")}${cc.length ? " | CC: " + cc.join(", ") : ""}`;
    subject = "[TEST] " + subject;
    html = `<div style="font-family:Arial,sans-serif;font-size:13px;background:#fef3c7;border:1px solid #f59e0b;padding:10px 14px;margin:0 0 18px;border-radius:6px"><b>TEST MODE</b> - in live mode this ${hE(o.kind)} would have gone to: ${hE(would)}</div>` + html;
    text = `[TEST MODE - in live mode this ${o.kind} would have gone to: ${would}]\n\n` + text;
    to = [conf.testTo]; cc = [];
  }
  const client = new SMTPClient({ connection: { hostname: "smtp.gmail.com", port: 465, tls: true, auth: { username: CU, password: CP } } });
  try {
    // The mailbox that logs in to send is always customercare1@ (Gmail will not let it send "as" another account); in test mode the name shown and the reply-to are the Administrator's.
    await client.send({ from: `${conf.live ? "Pallabita Ghosh" : "Ayush Ruia"} - The Jain Group <${CU}>`, ...(conf.live ? {} : { replyTo: conf.testTo }), to, ...(cc.length ? { cc } : {}), subject,
      mimeContent: [b64Part("text/plain", text), b64Part("text/html", html)], ...(o.attachments && o.attachments.length ? { attachments: o.attachments } : {}) });
  } finally { try { await client.close(); } catch (_) { /* ignore */ } }
  return { live: conf.live };
}
const logoUrl = (rel: string) => `${SITE}/${rel.split("/").filter(Boolean).join("/")}`;
const shell = (inner: string, proj?: Proj) => {
  const right = proj ? (proj.logo ? `<img src="${hE(logoUrl(proj.logo))}" alt="${hE(proj.name)}" height="46" style="display:block;height:46px;width:auto;border:0">` : `<span style="font-size:15px;font-weight:700;letter-spacing:.06em;color:#111827;text-transform:uppercase">${hE(proj.name)}</span>`) : "";
  return `<div style="background:#f3f4f6;padding:24px 0;font-family:Arial,Helvetica,sans-serif"><div style="max-width:600px;margin:0 auto;background:#fff;border-radius:10px;overflow:hidden;border:1px solid #e5e7eb">`
    + `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-bottom:3px solid #b3171d"><tr><td style="padding:16px 28px"><img src="${hE(logoUrl("assets/brand/jaingroup-logo.png"))}" alt="The Jain Group" height="46" style="display:block;height:46px;width:auto;border:0"></td><td align="right" style="padding:16px 28px">${right}</td></tr></table>`
    + `<div style="padding:26px 28px 8px;font-size:15px;line-height:1.7;color:#111827">${inner}</div>`
    + `<div style="padding:14px 28px 22px;font-size:12px;color:#6b7280;border-top:1px solid #f0f1f3">The Jain Group &middot; 44/2A Hazra Road, Kolkata &ndash; 700 019</div></div></div>`;
};
async function sendOtpMail(proj: Proj, email: string, code: string) {
  const html = shell(`<p style="margin:0 0 14px">Your verification code for the <b>${hE(proj.name)}</b> booking form is</p>`
    + `<p style="margin:0 0 16px;font-size:34px;letter-spacing:.32em;font-weight:700;color:#b3171d">${hE(code)}</p>`
    + `<p style="margin:0 0 14px;color:#4b5563">It is valid for 10 minutes. Please do not share it with anyone. If you did not ask for this, you can ignore this email.</p>`, proj);
  const text = `Your verification code for the ${proj.name} booking form is ${code}\n\nIt is valid for 10 minutes. Please do not share it with anyone. If you did not ask for this, you can ignore this email.`;
  return await sendMail({ to: [email], subject: `${code} is your verification code`, html, text, kind: "verification code" });
}
const rupee = (v: unknown) => { const n = Number(String(v ?? "").replace(/[^\d.]/g, "")); return n ? "₹" + n.toLocaleString("en-IN") : ""; };
async function sendConfirmation(proj: Proj, link: any, d: any, ref: string) {
  const first = d.applicants?.[0] || {}, email = clean(d.contact?.email, 200).toLowerCase();
  const names = (d.applicants || []).map((a: any) => [a.title, clean(a.full_name)].filter(Boolean).join(" ")).filter(Boolean);
  const unit = [d.flat?.block, d.flat?.floor ? "Floor " + d.flat.floor : "", d.flat?.flat_no ? "Flat " + String(d.flat.flat_no).toUpperCase() : ""].filter(Boolean).join(", ");
  const viewUrl = `${SITE}/booking-form.html?t=${link.token}`;
  const rowsHtml = [["Reference number", ref], ["Project", proj.name], ["Unit", unit], ["Applicant" + (names.length > 1 ? "s" : ""), names.join(", ")], ["Booking amount", rupee(d.pay?.amount)]]
    .filter((r) => r[1]).map((r) => `<tr><td style="padding:8px 0;color:#6b7280;width:38%;border-bottom:1px solid #f0f1f3">${hE(r[0])}</td><td style="padding:8px 0;font-weight:600;border-bottom:1px solid #f0f1f3">${hE(r[1])}</td></tr>`).join("");
  const conf = await mailConf();
  const who = [first.title, clean(first.full_name)].filter(Boolean).join(" ") || "Sir / Madam";
  // Until the Administrator says live, the sign-off is the Administrator's; live it is Pallabita Ghosh's.
  const sign = conf.live
    ? { html: `<p style="margin:0"><b>Pallabita Ghosh</b></p><p style="margin:0;color:#4b5563">Manager &ndash; Post Sales &middot; Customer Relations Team</p><p style="margin:0 0 14px;color:#4b5563">Reach me @ 8420541541</p>`, text: "Pallabita Ghosh\nManager - Post Sales | Customer Relations Team\nReach me @ 8420541541" }
    : { html: `<p style="margin:0"><b>Ayush Ruia</b></p><p style="margin:0 0 14px;color:#4b5563">The Jain Group &middot; ayushruia1@gmail.com</p>`, text: "Ayush Ruia\nThe Jain Group | ayushruia1@gmail.com" };
  const html = shell(`<p style="margin:0 0 14px">Dear <b>${hE(who)}</b>,</p>`
    + `<p style="margin:0 0 14px">Thank you for choosing <b>${hE(proj.name)}</b>. We are truly grateful that you have made ${hE(proj.name)} your new home. Your trust means a great deal to us, and everyone at The Jain Group looks forward to welcoming you to the ${hE(proj.name)} family.</p>`
    + `<p style="margin:0 0 14px">We have received your booking application${unit ? ` for <b>${hE(unit)}</b>` : ""} and verified your email address. You can see exactly what you submitted at any time here: <a href="${hE(viewUrl)}" style="color:#b3171d;font-weight:700">View your submitted form</a></p>`
    + `<p style="margin:0 0 14px">Thank you once again for your confidence in us.</p><p style="margin:0 0 4px">Warm regards,</p>` + sign.html, proj);
  const text = `Dear ${who},\n\nThank you for choosing ${proj.name}. We are truly grateful that you have made ${proj.name} your new home. Your trust means a great deal to us, and everyone at The Jain Group looks forward to welcoming you to the ${proj.name} family.\n\n`
    + `We have received your booking application${unit ? " for " + unit : ""} and verified your email address. You can see exactly what you submitted at any time here:\n${viewUrl}\n\nThank you once again for your confidence in us.\n\nWarm regards,\n${sign.text}`;
  const attachments: any[] = [];
  const pdf = await costBytes(link);
  if (pdf) { let bin = ""; for (let i = 0; i < pdf.length; i += 0x8000) bin += String.fromCharCode(...pdf.subarray(i, i + 0x8000)); attachments.push({ filename: String(link.prefill?.cost_sheet?.name || "Cost Sheet.pdf"), content: btoa(bin), encoding: "base64", contentType: "application/pdf" }); }
  const cc = [...new Set([SALES_HEAD, ...proj.team].map((x) => x.toLowerCase()))];
  return await sendMail({ to: [email], cc, subject: `Thank you for choosing ${proj.name}`, html, text, attachments, kind: "confirmation" });
}

// ---- OTP (13 Nov 2026): before a generated link is submitted, the customer proves the email address with a 6-digit code. The code is kept only as a hash (acc.digital_booking_links.otp).
const sha256hex = async (s: string) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)))).map((x) => x.toString(16).padStart(2, "0")).join("");
const otpHash = (code: string, link: any, email: string) => sha256hex(`${code}:${link.id}:${email}:${SRV.slice(0, 24)}`);
const OTP_TTL = 10 * 60_000, OTP_GAP = 30_000, OTP_PER_HOUR = 5, OTP_TRIES = 5;
const needsOtp = (link: any) => !!(link && link.prefill && link.prefill.cost_sheet && link.prefill.cost_sheet.path);
async function otpSend(link: any) {
  const d = link.draft && typeof link.draft === "object" ? link.draft : {};
  const email = clean(d.contact?.email, 200).toLowerCase();
  if (!MAIL_RE.test(email)) return j({ error: "Please check your email address on the Contact page.", code: "bad_email" }, 422);
  // an address whose domain cannot receive email (a typo such as gmial.con) is turned back at once
  const domain = email.split("@")[1];
  try { const mx = await (Deno as any).resolveDns(domain, "MX"); if (!mx || !mx.length) throw new Error("nomx"); }
  catch (e) { const m = String((e as Error)?.name || "") + String((e as Error)?.message || ""); if (/NotFound|NoData|nomx|NXDOMAIN|no records/i.test(m)) return j({ error: `We could not find a mailbox for ${email} - the part after @ (${domain}) cannot receive email. Please check the address.`, code: "bad_domain" }, 422); }
  const now = Date.now(), prev = link.otp && typeof link.otp === "object" ? link.otp : {};
  const sent: number[] = (Array.isArray(prev.sent) ? prev.sent : []).filter((t: number) => now - t < 3600_000);
  if (sent.length && now - sent[sent.length - 1] < OTP_GAP) return j({ error: "Please wait a few seconds before asking for another code.", code: "too_soon", wait: Math.ceil((OTP_GAP - (now - sent[sent.length - 1])) / 1000) }, 429);
  if (sent.length >= OTP_PER_HOUR) return j({ error: "Too many codes were asked for in the last hour. Please try again later or call us.", code: "too_many" }, 429);
  const code = String(crypto.getRandomValues(new Uint32Array(1))[0] % 1_000_000).padStart(6, "0");
  const otp = { hash: await otpHash(code, link, email), email, exp: now + OTP_TTL, sent: [...sent, now], tries: 0 };
  await db(`digital_booking_links?id=eq.${link.id}&status=eq.open`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ otp }) });
  try { await sendOtpMail(PROJECTS[link.project], email, code); }
  catch (e) {
    console.error("otp mail", e);
    await db(`digital_booking_links?id=eq.${link.id}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ otp: { ...otp, hash: "", sent } }) }).catch(() => {});
    return j({ error: `We could not send the code to ${email}. Please check that the address is right (Contact page) and try again.`, code: "mail_failed" }, 502);
  }
  return j({ ok: true, to: email, email, resend_after: OTP_GAP / 1000, expires_in: OTP_TTL / 1000 });
}
// null = the code is right; otherwise the response to give back.
async function otpCheck(link: any, email: string, code: string): Promise<Response | null> {
  const o = link.otp && typeof link.otp === "object" ? link.otp : null;
  if (!code) return j({ error: "Please enter the 6-digit code we emailed you.", code: "otp_required" }, 400);
  if (!o || !o.hash) return j({ error: "Please ask for a new code.", code: "otp_required" }, 400);
  if (Date.now() > Number(o.exp || 0)) return j({ error: "That code has expired. Please ask for a new one.", code: "otp_expired" }, 400);
  if (Number(o.tries || 0) >= OTP_TRIES) return j({ error: "Too many wrong codes. Please ask for a new code.", code: "otp_locked" }, 400);
  if (o.email !== email) return j({ error: "The email address was changed after the code was sent. Please ask for a new code.", code: "otp_email_changed" }, 400);
  if ((await otpHash(String(code).replace(/\s/g, ""), link, email)) !== o.hash) {
    const tries = Number(o.tries || 0) + 1;
    await db(`digital_booking_links?id=eq.${link.id}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ otp: { ...o, tries } }) }).catch(() => {});
    return j({ error: `That code is not correct.${tries < OTP_TRIES ? ` ${OTP_TRIES - tries} tries left.` : " Please ask for a new code."}`, code: "otp_wrong", left: Math.max(0, OTP_TRIES - tries) }, 400);
  }
  return null;
}

async function handleJson(req: Request) {
  let b: any;
  try { b = await req.json(); } catch (_) { return j({ error: "The request did not arrive complete." }, 400); }
  if (b.action === "projects") return j({ ok: true, projects: Object.keys(PROJECTS).map(projectInfo) });
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
    return j({ ok: true, staff: true, status: "completed", ref_no: link.ref_no || "", project: projectInfo(link.project), cost: costMeta(link), form: { data, files, submitted_at: f.submitted_at, status: f.status, note: f.note || "", seen_by: f.seen_by || "", seen_at: f.seen_at || null } });
  }

  if (b.action === "cost_pdf") {
    if (link.status === "cancelled") return j({ error: NOT_VALID }, 404);
    const bytes = await costBytes(link);
    if (!bytes) return j({ error: "There is no cost sheet on this link." }, 404);
    return new Response(bytes, { status: 200, headers: { ...cors, "Content-Type": "application/pdf", "Cache-Control": "no-store" } });
  }
  if (b.action === "otp_send") {
    if (link.status !== "open") return j({ error: link.status === "completed" ? "This form has already been submitted." : NOT_VALID }, 409);
    if (!needsOtp(link)) return j({ error: "This link does not use a code." }, 400);
    return await otpSend(link);
  }
  if (b.action === "load") {
    if (link.status === "cancelled") return j({ ok: true, status: "cancelled" });
    if (link.status === "completed") return j({ ok: true, status: "completed", ref_no: link.ref_no || "", submitted: await submittedView(link).catch(() => null) });
    if (!link.opened_at) await db(`digital_booking_links?id=eq.${link.id}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ opened_at: new Date().toISOString() }) });
    return j({
      ok: true, status: "open", project: link.project, projectInfo: projectInfo(link.project), prefill: publicPrefill(link), cost: costMeta(link), otp_required: needsOtp(link),
      draft: link.draft || null, step: link.draft_step || 0,
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
    if (k.startsWith("sig_")) continue;   // a signature is no longer kept
    const kind = m[2];
    if (v.size > MAX_FILE) return j({ error: `A file for applicant ${ai + 1} is larger than 10 MB. Please attach a smaller photo or PDF.` }, 400);
    if (kind !== "signature" && !OK_TYPES.test(v.type || "")) return j({ error: `Please attach PAN / Aadhaar as a photo (JPG, PNG) or PDF.` }, 400);
    if (kind === "signature" && v.type !== "image/png") continue;
    total += v.size; files.push({ applicant: ai, kind, file: v });
  }
  if (total > MAX_TOTAL) return j({ error: "The attached files are too large together (over 45 MB). Please attach smaller photos." }, 400);
  const has = (ai: number, kind: string) => files.some((f) => f.applicant === ai && f.kind === kind) || kept.some((f) => f.applicant === ai && f.kind === kind);
  apps.forEach((a: any, i: number) => {
    const who = i ? `Applicant ${i + 1}` : "First applicant";
    // 13 Nov 2026: no signature is asked for or kept any more.
    const indian = !clean(a.nationality) || /^india$/i.test(clean(a.nationality));
    if (indian && !has(i, "pan")) problems.push(`${who}: please attach the PAN card`);
    if (indian && !has(i, "aadhaar")) problems.push(`${who}: please attach the Aadhaar card`);
  });
  if (problems.length) return j({ error: "Please check: " + problems.join("; ") + ".", problems }, 400);
  // A link made with a cost sheet is submitted only with the 6-digit code emailed to the customer (13 Nov 2026).
  if (link && needsOtp(link)) { const bad = await otpCheck(link, clean(c.email, 200).toLowerCase(), clean(form.get("otp"), 12)); if (bad) return bad; }

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
    let mail: any = null;
    if (link && needsOtp(link)) {
      try { const r = await sendConfirmation(proj, link, d, ref); mail = { sent: true, live: r.live, at: new Date().toISOString() }; }
      catch (e) { console.error("confirmation mail", e); mail = { sent: false, error: String((e as Error)?.message || e).slice(0, 200), at: new Date().toISOString() }; }
      try { await db("digital_booking_forms?id=eq." + id, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ confirm_mail: mail }) }); } catch (_) { /* column may not exist yet */ }
    }
    return j({ ok: true, ref_no: ref, email: mail && mail.sent ? clean(c.email, 200).toLowerCase() : "" });
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
    if (clean(form.get("action"), 20) === "staff_cost_upload") return await handleCostUpload(form, req);
    if (clean(form.get("action"), 20) === "upload") return await handleUpload(form);
    return await handleSubmit(form, ip, req);
  } catch (e) {
    console.error(e);
    return j({ error: "Something went wrong on our side. Please try again in a minute." }, 500);
  }
});
