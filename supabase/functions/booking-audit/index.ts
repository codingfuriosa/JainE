/* Reads every file attached to a Booking Form instance and fills the Booking Form Check List.

   Modes: {work:true} the cron takes the next booking off acc.booking_audits and stores the result;
   {case_id, store} reads one now; {case_id, probe} reports the attachment sizes only.

   WHO DOES WHAT.
     Gemini READS - it sees scans and photographs of cards and reports what is printed, plus an
       explicit "not found". Told never to calculate and never to compare (see prompts.ts).
     ChatGPT JUDGES - whether two names mean the same person, whether two documents describe the
       same flat, whether a page was meant to be signed, whether a parking row is the kind that was
       ticked. It never sees the files, only what Gemini read.
     CODE DECIDES anything with a right answer: every sum, the base rate against the approved list,
       whether two names are the same string, and the formats - ten digits beginning 6-9, an email
       that is an email, five letters four digits a letter, and the PAN on the form against the PAN
       on the card. Asked "is this a valid mobile number", a model says yes to nine digits often
       enough to matter. Code also overrides both models on the cost sheet: four times during this
       build a model stated with confidence that a correct sheet was wrong.

   NOTHING IS REPORTED AS "UNKNOWN". A check that could not be settled is not a pass, and on a sheet
   of OKs anything other than NOT OK is read as one. So a doubt costs a NOT OK and the reason says
   what was missing.

   Every guard in here was put there by a wrong answer that looked plausible - a correct cost
   sheet declared wrong four separate ways, a good file failed on a relative's ID card, a reading
   that came back completely empty and stored as done. Each one is explained beside the code that
   prevents it; do not simplify those away.

   ADDING A FIELD TO THE PROMPT IS NOT FREE. Three were added at once - the allottees' particulars,
   the areas and the payment schedule - and the reader stopped filling the shape in and handed it
   back empty, twice, on a file it had read correctly an hour before. Add them ONE AT A TIME and
   read a real booking after each. The three form fields added since are plain top-level entries of
   the ordinary shape, not more keys nested inside allottees, which is what broke it.

   Files go to Gemini through its Files API, not inline base64: inlining a 10MB scan cost about four
   copies of it in memory and the worker was killed before reading anything.

   Nothing is approved here. The output is a filled check list for a person to read. */
import { AwsClient } from "https://esm.sh/aws4fetch@1.0.20";
import { PROMPT, CHECK_SYSTEM, canonicalProject, PROJECT_PLACE,
         PROJECT_BASE_RATE, rateKeyFor } from "./prompts.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-audit-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const j = (o: unknown, s = 200) =>
  new Response(JSON.stringify(o, null, 2), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

const SB  = Deno.env.get("SUPABASE_URL")!;
const SRV = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const H   = { apikey: SRV, Authorization: "Bearer " + SRV, "Content-Type": "application/json" };
const HA  = { ...H, "Accept-Profile": "acc" };
const HC  = { ...H, "Content-Profile": "acc" };
const GKEY = Deno.env.get("GEMINI_API_KEY") || Deno.env.get("GEMINI_KEY") || "";
const DEFAULT_MODEL = Deno.env.get("BOOKING_AUDIT_MODEL") || "gemini-pro-latest";
// CHATGPT_API_KEY is the name this project's secret carries; the conventional name is a fallback.
const OKEY = Deno.env.get("CHATGPT_API_KEY") || Deno.env.get("OPENAI_API_KEY") || "";
const OURL = Deno.env.get("OPENAI_BASE_URL") || "https://api.openai.com/v1";
const OMODEL = Deno.env.get("BOOKING_CHECK_MODEL") || Deno.env.get("CHATGPT_QA_MODEL") || "gpt-4.1";
// Realty Bucket, the CRM this business already runs leads through. No key, no login - the same
// unauthenticated GET the lost-call feed already uses (see crm-snapshot-qa / transcription-sync).
const CRM_LOOKUP_URL = Deno.env.get("REALTY_BUCKET_LOOKUP") || "https://www.realtybucket.com/report/lead_booking_detailedresponse";

const valuePaths = (v: unknown) =>
  String(v ?? "").split(/[|,;]/).map((x) => x.trim()).filter((x) => x.startsWith("s3:"));
const fileName = (p: string) => p.split("/").pop()!.replace(/^\d+_[a-z0-9]+_/i, "");
function mimeOf(name: string) {
  const e = (name.split(".").pop() || "").toLowerCase();
  if (e === "pdf") return "application/pdf";
  if (e === "png") return "image/png";
  if (e === "webp") return "image/webp";
  if (e === "gif") return "image/gif";
  if (e === "jpg" || e === "jpeg") return "image/jpeg";
  return "";
}
const normLabel = (s: unknown) => String(s ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
const num = (x: unknown) => (typeof x === "number" && isFinite(x) ? x : null);
const money = (n: number) => n.toLocaleString("en-IN", { maximumFractionDigits: 2 });
// Commercial rounding, half UP. Math.round does this for positives; do not "fix" it to banker's.
const r0 = (n: number) => Math.round(n);
const isCharge = (it: any) => String(it?.kind || "CHARGE").toUpperCase() === "CHARGE";
// A PAN never leaves here in full: only whether it matched, and its last four.
const mask = (s: unknown) => {
  const t = String(s ?? "").replace(/\s+/g, "");
  return t.length > 4 ? ("•".repeat(Math.max(0, t.length - 4)) + t.slice(-4)) : (t || null);
};

/* ---- the checks with a right answer -------------------------------------------------------- */

const PAN_RE   = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
const EMAIL_RE = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;
const normPan  = (s: unknown) => String(s ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");

/* An Indian mobile is ten digits beginning 6, 7, 8 or 9. People write it with +91, with a leading
   0, with spaces and dashes; all of that is stripped before judging, and none of it is a fault. */
function tidyMobile(raw: unknown) {
  let d = String(raw ?? "").replace(/\D/g, "");
  if (d.length === 12 && d.startsWith("91")) d = d.slice(2);
  else if (d.length === 11 && d.startsWith("0")) d = d.slice(1);
  else if (d.length === 13 && d.startsWith("091")) d = d.slice(3);
  return d;
}
function checkMobiles(list: unknown[]) {
  const seen = list.map((m) => ({ printed: String(m ?? ""), digits: tidyMobile(m) }))
                   .filter((m) => m.printed.trim());
  if (!seen.length) return { verdict: "Not Ok", reason: "No mobile number appears anywhere in the file.", numbers: [] };
  const good = seen.filter((m) => /^[6-9]\d{9}$/.test(m.digits));
  const bad  = seen.filter((m) => !/^[6-9]\d{9}$/.test(m.digits));
  const numbers = seen.map((m) => ({ printed: m.printed, valid: /^[6-9]\d{9}$/.test(m.digits) }));
  if (!good.length) {
    return { verdict: "Not Ok", numbers,
      reason: `Not a valid mobile number: ${bad.map((m) => m.printed).join(", ")}`
        + ` (needs ten digits starting 6-9).` };
  }
  if (bad.length) {
    return { verdict: "Ok", numbers,
      reason: `${good[0].digits} is valid; also in the file and not a mobile number: `
        + bad.map((m) => m.printed).join(", ") + "." };
  }
  return { verdict: "Ok", numbers, reason: `${good[0].digits} - ten digits, valid.` };
}
function checkEmails(list: unknown[]) {
  const seen = list.map((e) => String(e ?? "").trim()).filter(Boolean);
  if (!seen.length) return { verdict: "Not Ok", reason: "No email address appears anywhere in the file.", addresses: [] };
  const addresses = seen.map((e) => ({ printed: e, valid: EMAIL_RE.test(e) }));
  const good = addresses.filter((e) => e.valid), bad = addresses.filter((e) => !e.valid);
  if (!good.length) {
    return { verdict: "Not Ok", addresses,
      reason: `Not a usable email address: ${bad.map((e) => e.printed).join(", ")}.` };
  }
  if (bad.length) {
    return { verdict: "Ok", addresses,
      reason: `${good[0].printed} is valid; malformed as well: ${bad.map((e) => e.printed).join(", ")}.` };
  }
  return { verdict: "Ok", addresses, reason: `${good[0].printed} - well formed.` };
}

/* THE CHECK LIST'S "Booked in CRM" LINE, filled from Realty Bucket instead of left saying
   "awaiting the CRM API" forever.

   Realty Bucket's own lookup takes whichever of name/email/mobile you give it and matches
   loosely - a bare name returns every lead that happens to share it (asking for "Saptarshi" once
   turned up somebody else's 2017 enquiry alongside the actual customer), and email is usually
   blank on their side even when a mobile number is on file. So MOBILE IS TRIED FIRST, and only
   the properly-formatted ones this file already validated for the Mobile Number check - not the
   raw scan of whatever the form printed, which occasionally includes a landline or a second
   person's number that finds nothing or (worse) finds somebody else's lead. Email is tried next,
   then a bare name only as a last resort, since name is the one most likely to return the wrong
   person.

   GIVING MORE THAN ONE FIELD AT ONCE IS NOT SAFER, IT IS STRICTER - the API ANDs them together
   against whatever it actually has on file, and a lead stored as just "Saptarshi" with no surname
   matches nothing once mobile is paired with the full name from the booking form. So these are
   tried ONE FIELD AT A TIME, never combined.

   MORE THAN ONE ROW CAN COME BACK for a single field - a returning lead, a common first name - and
   nothing here guesses among them. Where this booking's own date is known, the row whose
   booked_on sits closest to it is taken; otherwise, or if that still leaves more than one row
   equally close, it is reported as ambiguous rather than picked at random. */
// A SLOW OR HUNG VENDOR MUST NEVER COST THE WHOLE READING. Gemini and ChatGPT already spend most
// of this function's time budget; a CRM call with no timeout of its own that stalls even once
// risks the platform's own request limit and losing everything - the cost sheet, the KYC, the
// Aadhaar - not just this one line. Each try therefore gets a short clock of its own and is
// abandoned, not waited out, if Realty Bucket does not answer in time.
async function crmLeadLookup(mobiles: string[], email: string, name: string, bookingDateIso: string | null) {
  const tries: Array<{ label: string; qs: string }> = [];
  for (const m of mobiles) tries.push({ label: `mobile ${m}`, qs: `mobile=${encodeURIComponent(m)}` });
  if (email) tries.push({ label: `email ${email}`, qs: `email=${encodeURIComponent(email)}` });
  if (name) tries.push({ label: `name ${name}`, qs: `name=${encodeURIComponent(name)}` });
  if (!tries.length) return null;

  const target = bookingDateIso ? new Date(bookingDateIso).getTime() : NaN;
  for (const t of tries) {
    let rows: any[] = [];
    try {
      const ctrl = new AbortController();
      const to = setTimeout(() => ctrl.abort(), 6000);
      let r: Response;
      try {
        r = await fetch(`${CRM_LOOKUP_URL}?${t.qs}`, { headers: { Accept: "application/json" }, signal: ctrl.signal });
      } finally { clearTimeout(to); }
      if (!r.ok) continue;
      const body = await r.json().catch(() => null);
      if (!Array.isArray(body) || !body.length) continue;
      rows = body;
    } catch (_e) { continue; }

    if (rows.length === 1) return { ...rows[0], matched_by: t.label, ambiguous: false, candidates: 1 };
    if (isFinite(target)) {
      const dated = rows.map((row: any) => ({ row, d: Math.abs(new Date(row?.booked_on).getTime() - target) }))
        .filter((x: any) => isFinite(x.d))
        .sort((a: any, b: any) => a.d - b.d);
      if (dated.length) {
        const tie = dated.length > 1 && dated[1].d === dated[0].d;
        return { ...dated[0].row, matched_by: t.label, ambiguous: tie, candidates: rows.length };
      }
    }
    // Several rows and no booking date to break the tie with - a guess here is exactly the kind
    // of plausible wrong answer this file goes out of its way elsewhere not to give.
    return { ambiguous: true, matched_by: t.label, candidates: rows.length };
  }
  return null;
}

/* The PAN printed on the booking form must be a real PAN, and where the file also carries a PAN
   card it must be the same number. A file with no PAN card at all is not a failure of THIS line -
   Aadhaar alone satisfies KYC - but it is said plainly rather than passed over. */
function checkPan(formPan: unknown, ids: any[]) {
  const form = normPan(formPan);
  const cards = ids.filter((d) => String(d?.doc_type || "").toUpperCase() === "PAN")
                   .map((d) => ({ name: d?.name_on_card ?? null, num: normPan(d?.id_number) }))
                   .filter((c) => c.num);
  if (!form || form === "NIL") {
    return { verdict: "Not Ok", reason: "The booking form does not state a PAN.", form_pan: null, cards: cards.length };
  }
  if (!PAN_RE.test(form)) {
    return { verdict: "Not Ok", form_pan: mask(form), cards: cards.length,
      reason: `${form} is not a valid PAN - it must be five letters, four digits and a letter.` };
  }
  if (!cards.length) {
    return { verdict: "Ok", form_pan: mask(form), cards: 0,
      reason: `${form} is a valid PAN; no PAN card in the file to check it against.` };
  }
  const hit = cards.find((c) => c.num === form);
  if (hit) {
    return { verdict: "Ok", form_pan: mask(form), cards: cards.length,
      reason: `${form} on the booking form matches the PAN card`
        + (hit.name ? ` of ${hit.name}` : "") + `, character for character.` };
  }
  return { verdict: "Not Ok", form_pan: mask(form), cards: cards.length,
    reason: `${form} on the booking form is on none of the ${cards.length} PAN card(s) in the file`
      + ` (${cards.map((c) => mask(c.num)).join(", ")}).` };
}

/* A NAME THAT IS NEARLY RIGHT IS WRONG.

   Arup Bhawal's own Aadhaar reads "Arup Bhowal" - one letter out. It would have been easy to call
   that the same person and move on, and for a while it did: the reader matched loosely and quietly
   printed the number. That is the wrong way round. The name on the card and the name on the
   booking form both end up on a deed, and a deed that says Bhowal where the register says Bhawal
   is a defect somebody has to sort out - later, and at more cost, if nobody says so now.

   So MATCHING IS STRICT: the same letters, ignoring only case, spacing and punctuation. The near
   miss is not waved through, it is REPORTED - a card whose name is within a letter or two of the
   applicant's is plainly meant to be theirs, and its being spelt differently is exactly the
   finding worth making. Further away than that and it is simply somebody else's card, which a
   booking file carries all the time and which is nobody's fault.

   Both rules use the same measurement and draw opposite conclusions from it:
     the same letters      -> the applicant's card
     a letter or two out   -> the applicant's card, MISSPELT: say so, and fail KYC
     further out           -> another person's card, of no concern here */
const normName = (s: unknown) => String(s ?? "").toUpperCase().replace(/[^A-Z]/g, "");
function editDistance(x: string, y: string) {
  const row = new Array(y.length + 1);
  for (let i = 0; i <= y.length; i++) row[i] = i;
  for (let i = 1; i <= x.length; i++) {
    let diag = row[0]; row[0] = i;
    for (let k = 1; k <= y.length; k++) {
      const above = row[k];
      row[k] = Math.min(row[k] + 1, row[k - 1] + 1, diag + (x[i - 1] === y[k - 1] ? 0 : 1));
      diag = above;
    }
  }
  return row[y.length];
}
/* The same person, spelt the same way. A card printed with the name run together or with a title
   in front of it still contains the same letters; a CHANGED letter never does. */
function sameName(a1: unknown, b1: unknown) {
  const x = normName(a1), y = normName(b1);
  return !!x && !!y && (x === y || x.includes(y) || y.includes(x));
}
/* NEARLY the applicant: the same name, spelt differently. This is the applicant's own card with a
   letter wrong on it, not somebody else's - KAKANSAHA is nine letters away from ARUPBHAWAL, and
   ANILBHAWAL, the father, is three. Two is close enough to be the same person and far enough from
   anybody else in a booking file. */
function nearName(a1: unknown, b1: unknown) {
  const x = normName(a1), y = normName(b1);
  if (x.length < 6 || y.length < 6) return false;
  if (sameName(x, y)) return false;
  return editDistance(x, y) <= 2;
}
/* Every card in the file whose name is nearly, but not exactly, the applicant's. Each one is a
   finding: which document, how it is spelt there, and what the booking form says. */
function nameFaultsOn(formName: unknown, ids: any[]) {
  const form = normName(formName);
  if (form.length < 6) return [];
  const out: string[] = [];
  for (const d of ids) {
    if (!nearName(d?.name_on_card, formName)) continue;
    out.push("The " + String(d?.doc_type || "ID").toUpperCase() + " card"
      + (d?.found_in ? " (" + d.found_in + ")" : "")
      + " is in the name \"" + String(d?.name_on_card || "").trim()
      + "\", but the booking form says \"" + String(formName || "").trim()
      + "\". Those are not the same spelling, and the deed will carry one of them, so it has to "
      + "be put right before the papers are drawn.");
  }
  return out;
}

/* ---- cost sheet arithmetic ------------------------------------------------------------------ */

const KEYS = ["customer_name","customer_dob","customer_pan","booking_date","booking_agent",
              "project_name","block","flat","floor","bhk","area_sqft","base_rate","plc","flc",
              "covered_parking","discount","discount_approved_by","payment_plan","source",
              "lead_id_on_form",
              // the agreement's own three: which of S/O, D/O, W/O, C/O is ticked, whose name is
              // against it, and Salaried or Business
              "relation_type","relation_name","occupation"];

function istToday() {
  const d = new Date(Date.now() + 5.5 * 3600 * 1000);
  return `${String(d.getUTCDate()).padStart(2,"0")}/${String(d.getUTCMonth()+1).padStart(2,"0")}/${d.getUTCFullYear()}`;
}

async function rpc(fn: string, args: Record<string, unknown>) {
  const r = await fetch(`${SB}/rest/v1/rpc/${fn}`, { method: "POST", headers: HC, body: JSON.stringify(args) });
  const t = await r.text();
  if (!r.ok) throw new Error(`${fn} ${r.status} ${t.slice(0,200)}`);
  try { return JSON.parse(t); } catch (_) { return t; }
}

async function geminiUpload(bytes: Uint8Array, mime: string, name: string) {
  const start = await fetch("https://generativelanguage.googleapis.com/upload/v1beta/files", {
    method: "POST",
    headers: { "x-goog-api-key": GKEY, "X-Goog-Upload-Protocol": "resumable",
      "X-Goog-Upload-Command": "start",
      "X-Goog-Upload-Header-Content-Length": String(bytes.byteLength),
      "X-Goog-Upload-Header-Content-Type": mime, "Content-Type": "application/json" },
    body: JSON.stringify({ file: { display_name: name } }) });
  if (!start.ok) throw new Error(`upload start ${start.status}: ${(await start.text()).slice(0,200)}`);
  const url = start.headers.get("x-goog-upload-url");
  if (!url) throw new Error("no upload url returned");
  const put = await fetch(url, { method: "POST",
    headers: { "Content-Length": String(bytes.byteLength), "X-Goog-Upload-Offset": "0",
               "X-Goog-Upload-Command": "upload, finalize" }, body: bytes });
  if (!put.ok) throw new Error(`upload ${put.status}: ${(await put.text()).slice(0,200)}`);
  const info = await put.json().catch(() => ({}));
  const uri = info?.file?.uri, fname = info?.file?.name;
  if (!uri) throw new Error("no file uri returned");
  let state = info?.file?.state || "PROCESSING";
  for (let i = 0; i < 20 && state === "PROCESSING"; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    const st = await fetch(`https://generativelanguage.googleapis.com/v1beta/${fname}`,
      { headers: { "x-goog-api-key": GKEY } });
    state = (await st.json().catch(() => ({})))?.state || state;
  }
  if (state !== "ACTIVE") throw new Error(`file never became readable (state ${state})`);
  return { uri, mime };
}

/* One sheet against itself: each subtotal against the charges it covers, then the grand total
   against every charge on the sheet. claimedByOther holds the grand totals printed for the OTHER
   basis - a two-column sheet prints one grand total, it lands on both entries when read as two,
   and the column it does not belong to then appears short by exactly the GST. Not a discrepancy.

   A SUBTOTAL DOES NOT ALWAYS COVER "EVERYTHING SINCE THE LAST ONE", which is all this used to
   allow, and Arup Bhawal's perfectly correct sheet was failed three times over for it. That sheet
   runs Unit Charges Details, then Parking Details closing with its own TOTAL of 5,00,000, then
   TOTAL FLAT VALUE of 62,95,000 covering both. Read the old way, the parking's TOTAL was compared
   against unit-plus-parking and came out 57,95,000 short; TOTAL FLAT VALUE was compared against
   nothing at all, because the row above it was a subtotal; and the grand total, taken as the sum
   of the subtotals, counted the parking twice and came out 5,25,000 over.

   So a subtotal is now allowed to be any of the shapes a cost sheet actually uses, and the check
   says WHICH one it turned out to be, so a person reading the sheet can see what was compared:

     the charges since the previous subtotal   an ordinary section total
     every charge above it                     a section total that has a smaller one nested in it
     the car parking charges                   a Parking Details total
     the subtotals above it                    a total of totals, where nothing was itemised

   The grand total is checked against every CHARGE row on the sheet rather than against the
   subtotals. On a correct sheet those come to the same figure whatever the layout, and charges
   cannot be double-counted the way nested subtotals can. */
function checkSheet(sheet: any, claimedByOther?: Set<number>) {
  const items: any[] = Array.isArray(sheet?.line_items) ? sheet.line_items : [];
  const out: any[] = [];
  let sinceSub = 0, above = 0, parkAbove = 0, subsAbove = 0, charges = 0;
  let subCount = 0;
  // A sheet read as totals only has nothing for a subtotal to be added up against. That is not a
  // discrepancy, so those checks are left undecided rather than failed.
  const itemised = items.some((it: any) => isCharge(it) && num(it?.amount) !== null);
  for (const it of items) {
    const amt = num(it?.amount) ?? 0;
    const k = String(it?.kind || "CHARGE").toUpperCase();
    if (k === "CHARGE") {
      sinceSub += amt; above += amt; charges += amt;
      if (/PARKING|GARAGE/.test(normLabel(it?.label))) parkAbove += amt;
      continue;
    }
    if (k === "SUBTOTAL") {
      const ways = [
        { how: "the charges since the previous subtotal", sum: sinceSub },
        { how: "every charge above it", sum: above },
        { how: "the car parking charges", sum: parkAbove },
        { how: "the subtotals above it", sum: subsAbove },
      ];
      const hit = ways.find((w) => Math.abs(w.sum - amt) <= 1);
      const base = hit ? hit.sum : sinceSub;
      const nothingToCheck = !hit && (!itemised || (above === 0 && subsAbove === 0));
      out.push({ kind: "sheet", check: `Charges above "${it?.label}" add up to it`,
        pass: hit ? true : (nothingToCheck ? null : false),
        expected: money(base), printed: money(amt),
        difference: nothingToCheck ? undefined : money(r0((base - amt) * 100) / 100),
        detail: hit ? `against ${hit.how}`
          : (nothingToCheck ? "the sheet itemises no charges above this row, so there is nothing "
             + "to add up against it" : undefined) });
      subsAbove += amt; subCount++; sinceSub = 0;
    }
  }
  const grand = num(sheet?.printed_total);
  if (grand !== null) {
    // Every charge on the sheet. Only a sheet that itemises nothing falls back to its subtotals.
    const base = charges > 0 ? charges : subsAbove;
    const diff = r0((base - grand) * 100) / 100;
    if (Math.abs(diff) > 1 && claimedByOther && claimedByOther.has(grand)) {
      out.push({ kind: "sheet", check: "The grand total is right", pass: null,
        expected: money(base), printed: money(grand),
        detail: `This column prints no grand total of its own - ${money(grand)} is the other `
          + `column's, and was checked there. Its own charges add up to ${money(base)}.` });
    } else {
      out.push({ kind: "sheet", check: "The grand total is right", pass: Math.abs(diff) <= 1,
        expected: money(base), printed: money(grand), difference: money(diff),
        detail: (charges > 0 ? "all charges" : "subtotals") + ` = ${money(base)}`
          + (subCount ? ` (${subCount} subtotal row(s) checked separately)` : "") });
    }
  }
  return out;
}

/* Net against gross, line by line, with the GST rate inferred rather than assumed. Only attempted
   when both sheets have the SAME charge rows and every one matches by label - they often do not,
   and matching across that mismatch once inferred 8.61% and failed a correct sheet. Informational;
   the verdict does not rest on it. */
function checkNetVsGross(net: any, gross: any) {
  const netCharges   = (net?.line_items   || []).filter(isCharge);
  const grossCharges = (gross?.line_items || []).filter(isCharge);
  const gi: Record<string, any> = {};
  for (const it of grossCharges) gi[normLabel(it?.label)] = it;

  const lines: any[] = [];
  for (const it of netCharges) {
    const g = gi[normLabel(it?.label)];
    const n = num(it?.amount), gv = g ? num(g?.amount) : null;
    if (n === null || gv === null || n === 0) continue;
    lines.push({ label: it?.label, section: String(it?.section || "").toUpperCase() || "OTHER",
                 net: n, gross: gv, implied_pct: Math.round((gv / n - 1) * 10000) / 100 });
  }

  if (!(netCharges.length && netCharges.length === grossCharges.length && lines.length === netCharges.length)) {
    return { rates: {}, lines: [], checks: [{ kind: "cross", pass: null,
      check: "Net against gross, line by line",
      detail: `Not comparable: the net sheet itemises ${netCharges.length} charge(s) and the gross `
        + `sheet ${grossCharges.length}, with ${lines.length} matching by name. Each sheet's own `
        + `subtotals and grand total were still checked.` }] };
  }

  const bySection: Record<string, number[]> = {};
  for (const l of lines) (bySection[l.section] = bySection[l.section] || []).push(l.implied_pct);
  const rateOf: Record<string, number> = {};
  for (const s of Object.keys(bySection)) {
    const tally: Record<string, number> = {};
    for (const p of bySection[s]) tally[String(p)] = (tally[String(p)] || 0) + 1;
    rateOf[s] = Number(Object.keys(tally).sort((a, b) => tally[b] - tally[a])[0]);
  }
  for (const l of lines) {
    const expect = r0(l.net * (1 + rateOf[l.section] / 100));
    l.expected_gross = expect;
    l.ok = Math.abs(expect - l.gross) <= 1;
  }
  const bad = lines.filter((l) => !l.ok);
  const out: any[] = [{ kind: "cross",
    check: "Every line's gross equals its net plus the GST its section uses",
    pass: bad.length === 0,
    detail: Object.keys(rateOf).map((s) => `${s}: ${rateOf[s]}%`).join(", ") +
            (bad.length ? ` - ${bad.length} line(s) do not follow it` : ""),
    offending: bad.map((l) => ({ label: l.label, net: money(l.net), gross_printed: money(l.gross),
                                 gross_expected: money(l.expected_gross as number), implied_pct: l.implied_pct })) }];
  const gs = num(gross?.printed_total);
  if (gs !== null) {
    const sumG = lines.reduce((a, l) => a + (l.expected_gross as number), 0);
    const diff = sumG - gs;
    out.push({ kind: "cross", check: "Net plus GST, line by line, equals the gross grand total",
      pass: Math.abs(diff) <= 2, expected: money(sumG), printed: money(gs), difference: money(diff) });
  }
  return { rates: rateOf, checks: out, lines };
}

function unitPriceOf(sheet: any) {
  for (const it of (sheet?.line_items || []))
    if (isCharge(it) && String(it?.section || "").toUpperCase() === "FLAT")
      return { amount: num(it?.amount), label: it?.label };
  for (const it of (sheet?.line_items || []))
    if (isCharge(it) && /UNITPRICE|UNITCOST|BASIC/.test(normLabel(it?.label)))
      return { amount: num(it?.amount), label: it?.label };
  return { amount: null, label: null };
}

/* What the allotment letter quotes: the apartment on its own, the car parking on its own, and the
   sheet's own total of the two. Deliberately NOT the sheet's grand total - that carries the
   deposits, the club and the electricity too, and the letter is about the price of the apartment.

   THIS USED TO TAKE THE FIRST SUBTOTAL IN THE FLAT SECTION AS THE APARTMENT'S PRICE, and on a
   sheet laid out as "Unit Charges Details" then "Parking Details" that subtotal is the PARKING
   group's own TOTAL. Arup Bhawal's letter therefore quoted the apartment at 5,00,000 - the price
   of his car park - and then added the car park to it again. The figures were all read correctly;
   it was this that picked the wrong one.

   So the apartment is now ADDED UP from the charge rows, with the parking rows left out, and the
   two can no longer be confused however the sheet is laid out. A sheet that prints its own total
   of unit plus parking ("TOTAL FLAT VALUE") has that kept as well, and the letter prefers it -
   what the customer signed beats anything totted up here. */
function flatAndParking(sheet: any) {
  const items: any[] = Array.isArray(sheet?.line_items) ? sheet.line_items : [];
  const isPark = (it: any) => /PARKING|GARAGE/.test(normLabel(it?.label));
  let flat: number | null = null, parking: number | null = null, total: number | null = null;
  let flatSum = 0, flatAny = false, subFlat: number | null = null;
  for (const it of items) {
    const k = String(it?.kind || "CHARGE").toUpperCase();
    const sec = String(it?.section || "").toUpperCase();
    const amt = num(it?.amount);
    if (amt === null) continue;
    if (isCharge(it) && isPark(it)) { parking = (parking ?? 0) + amt; continue; }
    if (isCharge(it) && sec === "FLAT") { flatSum += amt; flatAny = true; continue; }
    // The sheet's own "TOTAL FLAT VALUE" - the unit and its parking together.
    if (k !== "CHARGE" && /FLATVALUE|TOTALFLAT/.test(normLabel(it?.label)) && total === null) total = amt;
    // Any other FLAT subtotal, kept only as a fallback for a sheet that itemises nothing.
    else if (k === "SUBTOTAL" && sec === "FLAT" && subFlat === null && !isPark(it)) subFlat = amt;
  }
  if (flatAny) flat = flatSum;
  else if (subFlat !== null) flat = subFlat - (parking ?? 0);   // a lump sum that includes parking
  return { flat, parking, total };
}

/* DREAM WORLD CITY'S OWN CARPET AND BUILT-UP AREA ARE LOOKED UP, NOT READ - its booking documents
   essentially never print either, unlike Dream Gurukul or Dream Ananta where the cost sheet
   usually does. So for this one project both figures come from acc.dwc_carpet_areas instead:
   block/floor/flat against Carpet Area (without balcony) and Built-Up Area (with balcony), loaded
   once from the sanctioned-plan area sheets rather than re-read off a document every time. Never
   overrides a value a document DID state - the caller only reaches for a figure here when Gemini's
   own reading of it came back null.

   The booking's own Block field is noisy - one real case read "1-2", because Paris-1's Block-1 and
   Block-2 are mirror images of each other and the form itself is ambiguous about which - so every
   digit the field mentions is tried as a candidate block, not just the first. That is safe rather
   than approximate: block_no is the GLOBAL numbering (1-6) used on the project's own car-parking
   calculation pages, Paris-1's two blocks and Paris-2's two blocks are confirmed identical layouts
   floor for floor, so any block number sharing the same floor and flat code settles the same
   figure. The flat field commonly carries the floor as a prefix ("8H" for floor 8, flat H) which is
   stripped before matching; a few flats are lettered differently between the sanctioned plan and
   the brochure (J vs I, C1 vs C2), so both spellings are tried. */
async function dwcAreaLookup(blockRaw: unknown, floorRaw: unknown, flatRaw: unknown):
    Promise<{ carpet_sqft: number | null; builtup_sqft: number | null }> {
  const miss = { carpet_sqft: null, builtup_sqft: null };
  const floor = parseInt(String(floorRaw ?? "").match(/\d+/)?.[0] || "", 10);
  if (!isFinite(floor)) return miss;
  const flatCode = String(flatRaw ?? "").trim().toUpperCase().replace(/^\d+/, "");
  if (!flatCode) return miss;
  const blocks = Array.from(new Set((String(blockRaw ?? "").match(/\d+/g) || []).map(Number)))
    .filter((n) => n >= 1 && n <= 6);
  if (!blocks.length) return miss;
  try {
    const r = await fetch(`${SB}/rest/v1/dwc_carpet_areas?select=carpet_sqft,builtup_sqft`
      + `&block_no=in.(${blocks.join(",")})&floor=eq.${floor}`
      + `&or=(flat_sanction.eq.${encodeURIComponent(flatCode)},flat_brochure.eq.${encodeURIComponent(flatCode)})`
      + `&limit=1`, { headers: HA });
    const rows = await r.json().catch(() => []);
    const row = Array.isArray(rows) ? rows[0] : null;
    const carpet = Number(row?.carpet_sqft), builtup = Number(row?.builtup_sqft);
    return { carpet_sqft: isFinite(carpet) ? carpet : null, builtup_sqft: isFinite(builtup) ? builtup : null };
  } catch (_e) { return miss; }
}

/* A SECOND, NARROWER LOOK AT ONE LINE, when the first pass found nothing there.

   Saroj Palai's booking form really did have a tick above "Open" - confirmed by hand, zoomed in -
   and Gemini missed it three times running, through three increasingly explicit versions of the
   same instruction bolted onto the one big prompt that also asks for thirty other fields across
   ten pages. Rewording that one instruction again was not going to fix it a fourth time.

   What actually made the mark easy to see was narrowing what was being looked for, not describing
   it more carefully - the same file, asked about nothing but this one line, with everything else
   this model would otherwise be extracting at the same time left out entirely. So when the first
   pass reports no mark AND the cost sheet charges for parking anyway (exactly the situation that
   makes the check list say NOT OK), the same uploaded file is sent back for exactly one question,
   nothing else - genuinely different from asking harder in the same breath as everything else,
   which is all three earlier attempts amounted to. Reuses the file already uploaded in this run,
   so it costs one extra short Gemini call, not a re-upload. */
async function geminiRecheckParking(fileParts: any[], model: string): Promise<any> {
  const prompt = `Look ONLY at the "Right to use Car Park" line on the booking form - the one that
prints "Covered / Open" (or similar wording) for the customer to mark. Ignore every other field on
every other page; this is the only thing you are being asked about.

Examine that one line very closely. Is there a tick, checkmark, circle, underline, arrow or any
other handwritten mark ON, ABOVE, BELOW or BESIDE the word "Covered"? Is there one ON, ABOVE, BELOW
or BESIDE the word "Open"? A small tick placed just above one of the two words - easy to miss at a
glance among everything else on the page - still counts as marking that word. Describe what is
actually there before deciding.

A CONFIRMED CASE THIS MISSED TWICE: the mark was an ARROW drawn WELL BELOW the "Covered / Open"
line - closer to the text below it than to the line itself - curving UP to point into "Open". It
is easy to mistake for belonging to the row underneath, or to miss entirely if you are only
scanning the line's immediate vicinity. Look BELOW the line generously, not just in the narrow
strip right under it, for exactly this kind of upward-pointing arrow - and if you can see any OTHER
checkbox on this same booking form (Occupation, Profession, Mailing Address, Permanent Address, or
similar) marked with a small arrow pointing into its option rather than a mark directly on it, that
applicant marks everything this way, so expect and look hard for the same shape here.

Return ONLY JSON:
{"value": "COVERED" or "OPEN" or null, "how_marked": "how it is marked, e.g. \\"a small tick above the word\\"",
 "found_in": "which page", "what_you_see": "plainly describe what is on, above, below and beside each of the two words"}
Give null only if you have looked closely at both words and there is truly nothing near either one.`;
  const fileOnly = fileParts.filter((p) => p.file_data);
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
    { method: "POST", headers: { "Content-Type": "application/json", "x-goog-api-key": GKEY },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }, ...fileOnly] }],
        generationConfig: { temperature: 0, responseMimeType: "application/json", maxOutputTokens: 1000 } }) });
  const gj = await r.json().catch(() => ({}));
  const raw = String(gj?.candidates?.[0]?.content?.parts?.[0]?.text || "").trim();
  if (!raw) return null;
  try { return JSON.parse(raw); }
  catch (_) {
    const m = raw.match(/\{[\s\S]*\}/);
    return m ? JSON.parse(m[0]) : null;
  }
}

async function chatgptCheck(evidence: unknown) {
  if (!OKEY) throw new Error("CHATGPT_API_KEY is not set");
  const reasoning = /^(o\d|gpt-5)/i.test(OMODEL);
  const r = await fetch(`${OURL}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${OKEY}` },
    body: JSON.stringify({
      model: OMODEL,
      messages: [{ role: "system", content: CHECK_SYSTEM },
                 { role: "user", content: JSON.stringify(evidence) }],
      response_format: { type: "json_object" },
      ...(reasoning ? { max_completion_tokens: 8000 } : { temperature: 0, max_tokens: 8000 }),
    }),
  });
  const out = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`ChatGPT failed (${r.status}): ${String(out?.error?.message || "").slice(0,200)}`);
  const text = String(out?.choices?.[0]?.message?.content || "").trim();
  if (!text) throw new Error("ChatGPT returned nothing");
  try { return JSON.parse(text); }
  catch (_) {
    const m = text.match(/\{[\s\S]*\}/);
    if (m) { try { return JSON.parse(m[0]); } catch (_e) { /* fall through */ } }
    throw new Error("ChatGPT's reply was not JSON");
  }
}

async function audit(caseId: number, model: string, probe = false): Promise<any> {
  const cr = await fetch(`${SB}/rest/v1/flow_cases?id=eq.${caseId}&select=id,case_no,flow_id,trigger_details,created_by`,
    { headers: HA });
  const kase = (await cr.json().catch(() => []))?.[0];
  if (!kase) return { error: "instance not found" };

  const det: any[] = Array.isArray(kase.trigger_details) ? kase.trigger_details : [];
  let paths: string[] = [];
  for (const d of det) paths = paths.concat(valuePaths(d?.value));
  if (!paths.length) return { error: "this booking has no attachments to read" };

  const bucket = Deno.env.get("S3_BUCKET"), region = Deno.env.get("S3_REGION");
  const ak = Deno.env.get("AWS_ACCESS_KEY_ID"), sk = Deno.env.get("AWS_SECRET_ACCESS_KEY");
  if (!bucket || !region || !ak || !sk) return { error: "S3 secrets are not configured" };
  const aws = new AwsClient({ accessKeyId: ak, secretAccessKey: sk, region, service: "s3" });
  const s3url = (p: string) =>
    `https://${bucket}.s3.${region}.amazonaws.com/${p.replace(/^s3:/,"").split("/").map(encodeURIComponent).join("/")}`;

  if (probe) {
    const out: any[] = [];
    for (const p of paths) {
      const r = await aws.fetch(s3url(p), { method: "HEAD" });
      out.push({ file: fileName(p), mime: mimeOf(fileName(p)), http: r.status,
                 bytes: Number(r.headers.get("content-length") || 0) });
    }
    return { ok: true, case_id: caseId, attachments: out };
  }
  if (!GKEY) return { error: "GEMINI_API_KEY is not set" };

  const parts: any[] = [{ text: PROMPT }];
  const fetched: any[] = [];
  for (const p of paths) {
    const name = fileName(p), mime = mimeOf(name);
    if (!mime) { fetched.push({ file: name, skipped: "not a document Gemini can read" }); continue; }
    const r = await aws.fetch(s3url(p));
    if (!r.ok) { fetched.push({ file: name, skipped: `S3 returned ${r.status}` }); continue; }
    const bytes = new Uint8Array(await r.arrayBuffer());
    try {
      const up = await geminiUpload(bytes, mime, name);
      parts.push({ text: `--- file: ${name} ---` });
      parts.push({ file_data: { mime_type: up.mime, file_uri: up.uri } });
      fetched.push({ file: name, bytes: bytes.byteLength, mime, uploaded: true });
    } catch (e) {
      fetched.push({ file: name, bytes: bytes.byteLength, skipped: `upload failed: ${String((e as any)?.message || e)}` });
    }
  }
  if (parts.length === 1) return { error: "none of the attachments could be read", fetched };

  const t0 = Date.now();
  let raw = "";
  try {
    const gr = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
      { method: "POST", headers: { "Content-Type": "application/json", "x-goog-api-key": GKEY },
        body: JSON.stringify({ contents: [{ parts }],
          generationConfig: { temperature: 0, responseMimeType: "application/json", maxOutputTokens: 40000 } }) });
    const gj = await gr.json().catch(() => ({}));
    if (!gr.ok) return { error: `Gemini failed (${gr.status}): ${JSON.stringify(gj).slice(0,300)}`, fetched };
    raw = String(gj?.candidates?.[0]?.content?.parts?.[0]?.text || "").trim();
    if (!raw) return { error: `Gemini returned nothing (${gj?.candidates?.[0]?.finishReason || "no reason"})`, fetched };
  } catch (e) { return { error: `Gemini call threw: ${String(e)}`, fetched }; }
  const geminiMs = Date.now() - t0;

  let ex: any;
  try { ex = JSON.parse(raw); }
  catch (_) {
    const m = raw.match(/\{[\s\S]*\}/);
    try { ex = JSON.parse(m ? m[0] : ""); }
    catch (_e) { return { error: "Gemini's reply was not JSON", fetched }; }
  }

  /* See geminiRecheckParking above for why this exists. Only worth asking again when the first
     pass found nothing AND the cost sheet charges for parking anyway - a booking with no parking
     at all has nothing to look for a second time. Never makes things worse: kept only when it
     actually finds one of the two words marked, otherwise the first pass's null stands. */
  if (!ex?.parking_choice?.value
      && Array.isArray(ex?.parking_rows_in_cost_sheets) && ex.parking_rows_in_cost_sheets.length) {
    try {
      const recheck = await geminiRecheckParking(parts, model);
      if (recheck?.value === "COVERED" || recheck?.value === "OPEN") {
        ex.parking_choice = recheck;
        ex.notes = String(ex?.notes || "").trim();
        if (recheck.what_you_see) ex.notes += (ex.notes ? " " : "")
          + `[Car Park recheck] ${recheck.what_you_see}`;
      }
    } catch (_e) { /* keep the first pass's null */ }
  }

  const field = (k: string) => {
    const f = ex?.[k] || {};
    const v = f.value;
    const missing = v === null || v === undefined || String(v).trim() === "";
    return { value: missing ? "NIL" : v, as_printed: f.as_printed ?? null, found: !missing };
  };
  const fields: Record<string, any> = {};
  for (const k of KEYS) fields[k] = field(k);

  /* The project goes on the sheet and in the tracker under the name the business uses for it, not
     however the page happened to print it. What the document said is kept in as_printed. */
  const proj = canonicalProject(fields.project_name.value);
  if (proj) fields.project_name = { value: proj,
    as_printed: fields.project_name.as_printed || String(fields.project_name.value), found: true };

  /* The area is often printed only in the cost sheet's header. Taking it from the unit block keeps
     the Area blank filled and lets area x rate actually be checked. Same for the unit itself: the
     workflow form asks for nothing now, so these are what JAIN-E shows. */
  if (!fields.area_sqft.found) {
    const alt = ex?.unit_in_cost_sheet?.sba_sqft ?? ex?.unit_in_booking_form?.sba_sqft;
    const n = Number(String(alt ?? "").replace(/[^0-9.]/g, ""));
    if (alt !== null && alt !== undefined && isFinite(n) && n > 0)
      fields.area_sqft = { value: n, as_printed: String(alt), found: true };
  }
  /* THE BOOKING FORM IS THE AUTHORITY for the unit. What it says the flat is, is what the flat is -
     the cost sheet is the document being checked against it, not a second opinion to average with.
     So the booking form's own block/flat/floor/BHK win outright, and the cost sheet is only a
     fallback for a field the booking form leaves blank. */
  for (const k of ["block", "flat", "floor", "bhk"]) {
    const onForm = ex?.unit_in_booking_form?.[k];
    const alt = (onForm !== null && onForm !== undefined && String(onForm).trim() !== "")
      ? onForm : (fields[k].found ? fields[k].value : ex?.unit_in_cost_sheet?.[k]);
    if (alt !== null && alt !== undefined && String(alt).trim() !== "" && String(alt) !== "NIL")
      fields[k] = { value: alt, as_printed: String(alt), found: true };
  }
  /* A booking form always carries a date somewhere. When no field is labelled for it, the date
     written beside the applicant's signature IS the booking date - the reader is told to look
     there, and this is the same fallback applied to what it reported page by page. */
  const sigPages: any[] = Array.isArray(ex?.signature_pages) ? ex.signature_pages : [];
  let dateFrom = ex?.booking_date_found_in ?? null;
  if (!fields.booking_date.found) {
    const dated = sigPages.find((p) => p?.signed === true && String(p?.date_beside_signature || "").trim());
    if (dated) {
      fields.booking_date = { value: String(dated.date_beside_signature).trim(),
                              as_printed: String(dated.date_beside_signature).trim(), found: true };
      dateFrom = `date beside the signature on ${dated.document || "the form"} page ${dated.page}`;
    }
  }

  const sheets: any[] = Array.isArray(ex?.cost_sheets) ? ex.cost_sheets : [];

  /* AN EMPTY READING IS A FAILED READING, NOT A FINISHED ONE.

     Asked to fill in a shape, a model will occasionally hand the shape back - every field null,
     every list empty - and nothing downstream could tell that from a booking whose documents
     genuinely said nothing. It stored as "done", and the check list would have printed with every
     line blank and no sign that anything had gone wrong. That is the worst way for this to fail:
     silently, on a document a person is about to act on.

     A real booking file always yields at least one of these three. None of them means the read
     did not happen, whatever the model returned, so it is recorded as failed with a reason and
     the queue tries again rather than keeping the blank. */
  const gotName = fields.customer_name.found;
  const gotSheet = sheets.some((sh: any) => Array.isArray(sh?.line_items) && sh.line_items.length);
  const gotPages = sigPages.length > 0;
  if (!gotName && !gotSheet && !gotPages) {
    return { error: "the reader returned nothing at all - no customer name, no cost sheet and no "
      + "pages. The file was read but the answer was empty, so it has not been stored.", fetched };
  }

  const totalsByBasis: Record<string, Set<number>> = {};
  for (const s of sheets) {
    const t = num(s?.printed_total), b = String(s?.basis || "").toUpperCase();
    if (t !== null && b) (totalsByBasis[b] = totalsByBasis[b] || new Set<number>()).add(t);
  }
  const otherTotals = (basis: string) => {
    const set = new Set<number>();
    for (const b of Object.keys(totalsByBasis)) if (b !== basis) for (const t of totalsByBasis[b]) set.add(t);
    return set;
  };
  const perSheet = sheets.map((s) => ({
    which: s?.which ?? null, basis: String(s?.basis || "").toUpperCase() || null,
    signed: s?.signed_by_applicant === true, printed_total: s?.printed_total ?? null,
    line_items: Array.isArray(s?.line_items) ? s.line_items : [],
    checks: checkSheet(s, otherTotals(String(s?.basis || "").toUpperCase())) }));
  const netSheet   = sheets.find((s) => String(s?.basis || "").toUpperCase() === "NET");
  const grossSheet = sheets.find((s) => String(s?.basis || "").toUpperCase() === "GROSS");
  const gst = (netSheet && grossSheet) ? checkNetVsGross(netSheet, grossSheet) : null;

  const allChecks: any[] = [
    ...perSheet.flatMap((s) => s.checks.map((c: any) => ({ ...c, sheet: s.which || s.basis }))),
    ...(gst ? gst.checks : []),
  ];
  const a = num(fields.area_sqft.value), rate = num(fields.base_rate.value);
  const up = unitPriceOf(netSheet || sheets[0]);
  if (a !== null && rate !== null && up.amount !== null) {
    const calc = a * rate, diff = r0((calc - up.amount) * 100) / 100;
    /* A difference that divides evenly by the area is a different RATE, not a broken sum - a unit
       price row bundling an add-on pack does exactly this. Information, not a failure. */
    const perSqft = a ? Math.abs(diff) / a : 0;
    const cleanRate = a > 0 && Math.abs(perSqft - Math.round(perSqft)) < 0.005 && Math.abs(diff) > 1;
    if (cleanRate) {
      allChecks.push({ kind: "rate", check: `The "${up.label}" line is not area x base rate`, pass: null,
        detail: `${money(a)} sq.ft. x ${money(rate)}/sq.ft. = ${money(calc)}, the sheet says `
          + `${money(up.amount)} - a difference of exactly ${money(Math.round(perSqft))}/sq.ft., `
          + `so that row carries something beyond the base rate.` });
    } else {
      allChecks.push({ kind: "rate", check: `Area x base rate equals the "${up.label}" line`,
        pass: Math.abs(diff) <= 1, expected: money(calc), printed: money(up.amount),
        difference: money(diff), detail: `${money(a)} sq.ft. x ${money(rate)}/sq.ft. = ${money(calc)}` });
    }
  } else {
    allChecks.push({ kind: "rate", check: "Area x base rate equals the unit price line", pass: null,
      detail: "Needs the area, the rate and a unit-price row; at least one was not found." });
  }

  /* THE BASE RATE AGAINST THE APPROVED RATE for that project. This is the one check here that
     compares the paperwork against something OUTSIDE it - a rate the business sets - rather than
     against itself, so it is deliberately separate from the sums: a sheet can add up perfectly
     and still be drawn at a rate nobody approved, which is exactly what this is for.

     Reported, never corrected. A discount or a revision of the list is a legitimate reason for a
     difference, and the approved figure may itself be out of date, so the line says both numbers
     and leaves the judgement to the person reading it. A sheet that states no rate at all leaves
     the check undecided rather than failed.

     WHAT THE CHECK LIST SHOWS, on the Base Rate and Discount lines:
       document rate = approved rate   Base Rate is that rate, Discount is Nil - nothing to explain.
       document rate <  approved rate  Base Rate is the APPROVED (cross-check) rate, not the
                                        document's own lower figure, and Discount carries the
                                        shortfall - the per-sq.ft. difference times the area - as
                                        the money actually given away: 5,399 - 5,349 = 50 X 1,235 sq.
                                        ft. = 61,750/-.
       document rate >  approved rate  Base Rate is the document's own (higher) figure - there is
                                        no approved figure above it to cross-check against - and
                                        Discount is Nil.
     display_rate and discount are read directly by the check list printer rather than parsed back
     out of a sentence, so the two can never disagree about which figure is which. */
  const rateKey = rateKeyFor(proj, JSON.stringify(ex?.project_name ?? "") + " "
    + String(fields.bhk.value ?? "") + " " + JSON.stringify(ex?.documents_seen ?? []));
  const approvedRate = rateKey ? PROJECT_BASE_RATE[rateKey] : undefined;
  let baseRateCheck: any;
  if (rate === null || approvedRate === undefined) {
    baseRateCheck = { kind: "baserate", pass: null,
      check: "The base rate is the approved rate for the project",
      display_rate: rate !== null ? money(rate) : null, discount: null,
      detail: rate === null
        ? "The cost sheet states no base rate, so there is nothing to compare."
        : `No approved rate is on file for ${rateKey || "this project"}.` };
  } else {
    // A rate below the approved one is a discount, not a fault - and a rate at or above it needs
    // no explaining either. This check is informational only now: it never fails the cost sheet,
    // it just says what it found.
    const lower = rate < approvedRate;
    const shortfallNum = r0((approvedRate - rate) * 100) / 100;
    const shortfall = money(shortfallNum);
    const discountAmt = (lower && a !== null) ? r0(shortfallNum * a * 100) / 100 : null;
    baseRateCheck = { kind: "baserate", pass: true,
      check: "The base rate is the approved rate for the project",
      expected: money(approvedRate), printed: money(rate),
      difference: lower ? shortfall : money(rate),
      // the cross-check (approved) rate when the document's own is lower, otherwise the document's
      // own (higher) rate - see the block comment above
      display_rate: lower ? money(approvedRate) : money(rate),
      discount: (lower && discountAmt !== null)
        ? { amount: money(discountAmt),
            detail: `${money(approvedRate)} - ${money(rate)} = ${shortfall} X ${money(a as number)} = ${money(discountAmt)}/-` }
        : null,
      detail: lower
        ? `${money(approvedRate)} - ${money(rate)} = ${shortfall}/-`
        : `${money(rate)}/sq.ft.` };
  }
  allChecks.push(baseRateCheck);

  /* The arithmetic rests on the checks that came out the same on every run of the same file - each
     sheet's own subtotals, its grand total, and area x rate. Net-against-gross is shown but not
     counted: it depends on the two sheets itemising the same way, which they do not always do.
     The base rate is counted separately too - it is not arithmetic, it is a comparison against a
     list, and it gets its own line on the cost sheet verdict. */
  const deciding = allChecks.filter((c) => c.kind !== "cross" && c.kind !== "baserate"
    && c.pass !== null);
  const sumsOk = sheets.length > 0 && deciding.length > 0 && deciding.every((c) => c.pass);

  const ids: any[] = Array.isArray(ex?.identity_documents) ? ex.identity_documents : [];
  const mobiles = Array.isArray(ex?.mobile_numbers) ? ex.mobile_numbers : [];
  const emails  = Array.isArray(ex?.emails) ? ex.emails : [];
  const parkRows = Array.isArray(ex?.parking_rows_in_cost_sheets) ? ex.parking_rows_in_cost_sheets : [];

  const mobCheck = checkMobiles(mobiles);
  const emlCheck = checkEmails(emails);
  const panCheck = checkPan(fields.customer_pan.value, ids);
  // Whether two spellings are the same string is not a judgement call, so the checker does not get
  // to decide it. A near miss overrules whatever ChatGPT concluded about KYC.
  const nameFaults = nameFaultsOn(fields.customer_name.value, ids);

  /* Realty Bucket's own record of this lead - see crmLeadLookup above for why mobile goes first
     and a bare name last, and why several rows come back ambiguous rather than guessed at.
     Independent of ChatGPT's own check below; needs only what Gemini already read. Only the
     mobile numbers this file already validated are tried, not whatever else the form printed. */
  const crmMobiles = Array.from(new Set(
    mobiles.map((m: any) => tidyMobile(m)).filter((d: string) => /^[6-9]\d{9}$/.test(d))
  ));
  const crmEmail = String(emails[0] || "").trim();
  const crmName = fields.customer_name.found ? String(fields.customer_name.value) : "";
  let crmBookingDateIso: string | null = null;
  {
    const m = fields.booking_date.found ? String(fields.booking_date.value).match(/^(\d{2})\/(\d{2})\/(\d{4})$/) : null;
    if (m) crmBookingDateIso = `${m[3]}-${m[2]}-${m[1]}`;
  }
  // Belt and braces on top of each try's own 6s clock: whatever crmLeadLookup ends up doing,
  // the whole check list is not going to wait past 10s to find out whether this line has an answer.
  let crmLead: any = null;
  try {
    crmLead = await Promise.race([
      crmLeadLookup(crmMobiles, crmEmail, crmName, crmBookingDateIso),
      new Promise((resolve) => setTimeout(() => resolve(null), 10000)),
    ]);
  } catch (_e) { crmLead = null; }

  const evidence = {
    booking_form: {
      applicant_name: ex?.customer_name?.value ?? null,
      applicant_dob: ex?.customer_dob?.value ?? null,
      applicant_pan: ex?.customer_pan?.value ?? null,
      co_applicants_named_on_the_form: Array.isArray(ex?.co_applicants) ? ex.co_applicants : [],
      booking_date: fields.booking_date.found ? fields.booking_date.value : null,
      booking_date_found_in: dateFrom,
      booking_agent: ex?.booking_agent?.value ?? null,
    },
    // Asked for twice on purpose, so the two can be compared rather than assumed to agree.
    unit_in_booking_form: ex?.unit_in_booking_form ?? null,
    unit_in_cost_sheet:   ex?.unit_in_cost_sheet ?? null,
    parking_marked_on_booking_form: ex?.parking_choice ?? null,
    parking_rows_in_cost_sheets: parkRows,
    signature_pages: sigPages,
    cost_sheets_signed: perSheet.map((s) => ({ which: s.which, basis: s.basis, signed: s.signed })),
    identity_documents: ids,
    mobile_numbers: mobiles,
    emails,
    documents_seen: ex?.documents_seen ?? [],
    unreadable: ex?.unreadable ?? [],
    reader_notes: ex?.notes ?? "",
  };
  let gpt: any = null, gptErr = "";
  const t1 = Date.now();
  try { gpt = await chatgptCheck(evidence); } catch (e) { gptErr = String((e as any)?.message || e); }
  const gptMs = Date.now() - t1;

  const gptItem = (name: string) => {
    const it = (Array.isArray(gpt?.items) ? gpt.items : []).find((x: any) => normLabel(x?.item) === normLabel(name));
    if (!it) return null;
    const v = String(it.verdict || "").toUpperCase();
    return { verdict: v === "OK" ? "Ok" : (v === "NOT OK" ? "Not Ok" : "Unknown"),
             reason: (v === "OK" || v === "NOT OK") ? String(it.reason || "")
                   : ("could not be settled from the documents - " + String(it.reason || "")) };
  };
  // Anything code decided stands; ChatGPT is not consulted on it and cannot overrule it.
  const CODE: Record<string, any> = { "Mobile Number": mobCheck, "Email ID": emlCheck, "Pan Card No.": panCheck };
  /* NOTHING LEAVES HERE AS "Unknown". A check that could not be settled is not a pass, and printed
     beside a column of OKs anything other than NOT OK gets read as one. So a doubt costs a NOT OK
     and the reason says why - which is also what happens when the checker could not be reached at
     all. The distinction is kept in the reason, not in the verdict. */
  const item = (name: string) => {
    if (name === "KYC of Customer" && nameFaults.length) return "Not Ok";
    if (CODE[name]) return CODE[name].verdict === "Ok" ? "Ok" : "Not Ok";
    const g = gptItem(name);
    if (g) return g.verdict === "Ok" ? "Ok" : "Not Ok";
    return "Not Ok";
  };
  const why = (name: string) => {
    if (name === "KYC of Customer" && nameFaults.length) return nameFaults.join(" ");
    if (CODE[name]) return CODE[name].reason;
    return (gptItem(name)?.reason) || (gptErr ? ("the checker could not be reached: " + gptErr) : "");
  };

  const kycPeople = (Array.isArray(gpt?.kyc_people) ? gpt.kyc_people : []).map((p: any) => ({
    person: String(p?.person || "Unnamed"), relation: p?.relation ?? null,
    is_applicant: p?.is_applicant === true,
    aadhaar: p?.aadhaar === true, pan: p?.pan === true,
    name_matches: p?.name_matches ?? null, dob_matches: p?.dob_matches ?? null,
    pan_matches: p?.pan_matches ?? null, ok: p?.ok === true, reason: String(p?.reason || "") }));

  const itemChecks = ["KYC of Customer","Mobile Number","Email ID","Pan Card No.",
                      "Unit details","Signatures","Car Parking"]
    .map((n) => ({ item: n, verdict: item(n), reason: why(n),
                   checked_by: (CODE[n] || (n === "KYC of Customer" && nameFaults.length))
                     ? "JAIN-E" : (gptErr ? null : OMODEL) }));

  /* THE COST SHEET LINE COVERS THE COST SHEET. Its sums must add up, the parking it charges must be
     the parking the customer ticked, the flat it is drawn for must be the flat on the booking
     form, and the rate must be the approved one. All four are faults IN THE COST SHEET, so they
     belong on its line rather than each getting a row of its own on a form that has no room for
     them. Whichever failed is named. */
  const costParts = [
    { what: "the sums", ok: sumsOk,
      why: sheets.length ? "a subtotal, the grand total or area x rate does not come out"
                         : "no cost sheet was found in the file" },
    { what: "the car parking", ok: item("Car Parking") === "Ok", why: why("Car Parking") },
    { what: "the unit", ok: item("Unit details") === "Ok", why: why("Unit details") },
    { what: "the base rate", ok: baseRateCheck.pass !== false, why: baseRateCheck.detail },
  ];
  const costBad = costParts.filter((p) => !p.ok);
  const costVerdict = costBad.length ? "Not Ok" : "Ok";
  const costReason = costBad.length
    ? costBad.map((p) => `${p.what}: ${p.why}`).join(" ")
    : "Every subtotal, both grand totals and area x rate come out; the parking and the unit agree "
      + "with the booking form.";
  itemChecks.unshift({ item: "Cost Sheet", verdict: costVerdict, reason: costReason,
                       checked_by: "JAIN-E" });

  // Left blank for now, per request - showing the booking agent's name here read as wrong.
  const sourceValue = "";

  /* DOCUMENT QUALITY - a figure Gemini read but flagged as uncertain because of the scan itself
     (blur, low resolution, a fold, glare), not a figure it simply got wrong. A bad scan produces
     a confident-looking WRONG number just as easily as an obviously blank one, so this cannot be
     caught by any arithmetic or format check downstream - it has to be caught at the reading step,
     which is the only place that ever saw the original image. Reported the same way every other
     doubt on this sheet is: NOT OK, never a silent pass, so a person re-checks the original instead
     of trusting a number the reader itself was not sure of. */
  const uncertainFigures: any[] = Array.isArray(ex?.uncertain_figures) ? ex.uncertain_figures : [];
  const qualityVerdict = uncertainFigures.length ? "Not Ok" : "Ok";
  const qualityReason = uncertainFigures.length
    ? uncertainFigures.map((u: any) =>
        `${u?.field ?? "a figure"} (read as ${u?.value ?? "?"}, ${u?.found_in ?? "unknown page"}): ${u?.why ?? "the scan made it unclear"}`)
      .join(" ")
    : "Every figure the reader transcribed was clearly legible.";

  const concerns = Array.isArray(gpt?.concerns) ? gpt.concerns.slice() : [];
  if (!fields.booking_date.found)
    concerns.unshift("No booking date anywhere in the file - not in a dated field and not beside any signature.");
  for (const f of nameFaults) concerns.unshift(f);
  for (const u of uncertainFigures) concerns.unshift(
    `Document quality: ${u?.field ?? "a figure"} was hard to read (${u?.why ?? "scan quality"}) - `
    + `verify ${u?.value ?? "the transcribed value"} against the original before relying on it.`);

  /* THE PARKING VALUE on the check list says which kind as well as how much, because the form's own
     label is now just "PARKING" - it no longer presumes covered.

     THIS IS DISPLAY ONLY - it does not touch the Car Parking verdict below, which still compares
     what the booking form itself shows against what the cost sheet charges and can still say NOT
     OK. But when the booking form's own tick cannot be read, the cost sheet itself is not silent -
     it names a kind and an amount, and a person reading the check list is better served seeing
     what is actually being charged than a blank "NIL" that reads as nothing having been charged at
     all. Only used when exactly one cost sheet row charges for parking and its wording says which
     kind - two rows, or a row that just says "car parking" with no kind, is genuinely ambiguous and
     stays blank rather than guessed at. */
  let parkKind = String(ex?.parking_choice?.value || "").toUpperCase();
  let parkAmt = num(fields.covered_parking.value);
  if (parkAmt === null) {
    if (parkKind === "COVERED" || parkKind === "OPEN") {
      /* Indrasish Deb's booking form ticked Covered plainly, but left the form's OWN money field
         for it blank - the Rs.5,00,000 lives only on the cost sheet's "1-Covered Car Parking"
         row. The kind was already settled, so the old condition below (which only fires when the
         kind is STILL unclear) never ran, and the checklist printed a bare "COVERED" with no
         figure - which the client then shows as "COVERED Parking : NIL", reading as though
         nothing had been charged. Once the kind is known, take the amount from whichever cost
         sheet row charges for that SAME kind - never a mismatched one - so a clear tick with a
         blank form field still shows what was actually charged. */
      const match = parkRows.find((r: any) => r?.says === parkKind);
      if (match) parkAmt = num(match.amount);
    } else if (parkRows.length === 1 && (parkRows[0]?.says === "COVERED" || parkRows[0]?.says === "OPEN")) {
      // The booking form's own tick is unclear, but exactly one cost sheet row names a kind -
      // take both the kind and the amount from it.
      parkKind = parkRows[0].says;
      parkAmt = num(parkRows[0].amount);
    }
  }
  const parkingValue = parkAmt !== null
    ? ((parkKind === "COVERED" || parkKind === "OPEN") ? `${parkKind} ${money(parkAmt)}` : money(parkAmt))
    : (parkKind === "COVERED" || parkKind === "OPEN" ? parkKind : "NIL");

  /* THE APPLICANT'S AADHAAR, IN FULL, because the agreement states it and a deed cannot carry a
     masked number. Everywhere else in this file an id number is compared and then thrown away,
     and that still holds for everyone else's cards: only the card that belongs to the APPLICANT
     is kept, matched on the name, and only the Aadhaar. A relative's or a co-applicant's card is
     masked as before.

     A MISSPELT CARD STILL GIVES UP ITS NUMBER, but it does not pass. Arup Bhawal's own Aadhaar
     reads "Arup Bhowal", and holding the number back left the draft with a blank for somebody to
     copy in by hand - which is how a number gets mistyped, and it fixed nothing, because the
     spelling still had to be sorted out either way. So the number is taken and the fault is
     reported: KYC reads NOT OK, the check list names both spellings, and whoever settles the deed
     sees the difference. Reporting and withholding are not the same lever, and only one of them
     has to be pulled.

     A DIFFERENT PERSON'S CARD IS STILL NEVER TAKEN. Only the applicant's own name counts, exactly
     or within a letter or two of it - a co-applicant's or a relative's is nowhere near that close
     and stays masked, as Kakan Saha's and Aditi Pashari's both do.

     This is a deliberate change of posture, asked for so the agreement can be produced without
     someone copying the number across by hand. It means a booking record now holds one Aadhaar
     number; that is worth knowing rather than discovering.

     THE NUMBER STILL HAS TO BE TWELVE CLEAN DIGITS, OR A CARD THAT IS DELIBERATELY MASKED, to be
     taken. Aadhaar has no other shape than twelve digits - a stray character is the scan, not the
     number, and that failure still goes to the same concern it always did. But a great many cards
     (any e-Aadhaar download, the mAadhaar app) are printed by UIDAI itself showing only the last
     four digits, with the first eight replaced by X's - "XXXX XXXX 1234" - and that is not a bad
     scan, it is the number the card actually carries. Refusing it the same way as a genuinely
     unreadable one left a masked card's holder worse off than someone whose Aadhaar just failed to
     transcribe, so a masked card is recognised and its printed form - X's and all - is taken as the
     applicant's Aadhaar number exactly as it would be taken for the agreement by hand. */
  const maskedAadhaar = (raw: unknown): string | null => {
    const m = String(raw ?? "").toUpperCase().replace(/\s+/g, "").match(/^[X*]{8}(\d{4})$/);
    return m ? `XXXX XXXX ${m[1]}` : null;
  };
  const applicantAadhaarCards = ids
    .filter((d: any) => String(d?.doc_type || "").toUpperCase() === "AADHAAR")
    .filter((d: any) => sameName(d?.name_on_card, fields.customer_name.value)
                     || nearName(d?.name_on_card, fields.customer_name.value));
  const applicantAadhaar = applicantAadhaarCards
    .map((d: any) => {
      // stripped to digits only, not just whitespace - printed Aadhaar numbers are grouped with
      // spaces, sometimes with a hyphen instead, and either has to come off before the length counts
      const digits = String(d?.id_number ?? "").replace(/[^0-9]/g, "");
      if (/^\d{12}$/.test(digits)) return digits;
      return maskedAadhaar(d?.id_number);
    })
    .filter((v: string | null): v is string => !!v)[0] || null;
  if (!applicantAadhaar && applicantAadhaarCards.length)
    concerns.push("An Aadhaar card in the applicant's name was found" +
      (applicantAadhaarCards[0]?.found_in ? " (" + applicantAadhaarCards[0].found_in + ")" : "") +
      ", but the number on it did not read as twelve clean digits - check the scan and enter it on the agreement by hand.");

  // The apartment's own price, net and gross, for the allotment letter.
  const netFP = flatAndParking(netSheet || sheets[0] || null);
  const grossFP = flatAndParking(grossSheet || null);

  // Dream World City's booking documents essentially never state a Carpet Area or a Built-Up
  // Area - see dwcAreaLookup above - so each is only reached for when Gemini's own reading of it
  // came back null; a document that DOES state one (the exception, not the rule) still wins.
  let dwcArea = { carpet_sqft: null as number | null, builtup_sqft: null as number | null };
  if (proj === "Dream World City" && (ex?.carpet_area?.value == null || ex?.unit_in_cost_sheet?.builtup_sqft == null))
    dwcArea = await dwcAreaLookup(fields.block.value, fields.floor.value, fields.flat.value);

  /* What the check list's "Booked in CRM" line actually says. Ambiguous is reported as exactly
     that, never as one of the candidates picked at random - see crmLeadLookup. */
  const crmLine = !crmLead
    ? (fields.lead_id_on_form.found ? String(fields.lead_id_on_form.value) : "-- not found in CRM --")
    : crmLead.ambiguous ? `-- ${crmLead.candidates} leads match (by ${crmLead.matched_by}); check manually --`
    : String(crmLead.lead_id ?? "--") + (crmLead.source ? ` (${crmLead.source})` : "");

  return {
    ok: true,
    instance: { case_id: kase.id, case_no: kase.case_no, raised_by: kase.created_by },
    read: { model, gemini_ms: geminiMs, checker: gptErr ? null : OMODEL, checker_ms: gptMs,
            checker_error: gptErr || null, files: fetched,
            documents_seen: ex?.documents_seen ?? [], unreadable: ex?.unreadable ?? [] },
    header: { date: istToday(), post_sales_incharge: "MS. PALLABITA GHOSH" },
    fields,
    parking_value: parkingValue,
    booking_date_found_in: dateFrom,
    co_applicants: Array.isArray(ex?.co_applicants) ? ex.co_applicants : [],
    // every card whose name is nearly, but not exactly, the applicant's - see nameFaultsOn
    name_faults: nameFaults,
    /* Everything the two customer letters need that the check list has no use for. Kept in one
       place so they read from the same stored reading as the check list and the three can never
       disagree about who bought what. */
    letter: {
      allottees: (Array.isArray(ex?.allottees) ? ex.allottees : [])
        .map((p: any) => ({ salutation: p?.salutation ?? null, name: p?.name ?? null }))
        .filter((p: any) => String(p.name ?? "").trim()),
      /* The place comes from the business's own list first. A booking form writes it loosely or
         leaves it out entirely - Anindita's did - and this goes on a letter to a customer. */
      locality: (proj && PROJECT_PLACE[proj]) || ex?.project_locality?.value || null,
      locality_on_the_form: ex?.project_locality?.value ?? null,
      address: (Array.isArray(ex?.customer_address?.lines) ? ex.customer_address.lines : [])
        .map((l: any) => String(l ?? "").trim()).filter(Boolean),
      pin: ex?.customer_address?.pin ?? null,
      addressed_to: ex?.addressed_to?.company ?? null,
      token: { value: num(ex?.token_amount?.value), in_words: ex?.token_amount?.in_words ?? null,
               as_printed: ex?.token_amount?.as_printed ?? null },
      // net and gross for the apartment and its parking, which is what the allotment letter quotes
      price: { flat_net: netFP.flat, flat_gross: grossFP.flat,
               parking_net: netFP.parking, parking_gross: grossFP.parking,
               // the sheet's own total of the two, when it prints one
               total_net: netFP.total, total_gross: grossFP.total },
    },
    /* The agreement quotes the cost sheet's Built-Up area, which nothing else here uses. Carried
       as its own field rather than left inside `unit` so the document does not have to know how
       the unit comparison is shaped. Carpet area is read from wherever in the file it actually
       turned up - see carpet_area in the prompt - not scoped to the cost sheet the way builtup_sqft
       is, since most files print it somewhere else instead; for Dream World City, whose documents
       essentially never state either figure, dwcArea (see above) fills whichever gap is open from
       the sanctioned-plan lookup instead. Purely informational either way: never checked against
       anything, just carried through to the agreement when it is there. */
    unit_areas: { builtup_sqft: num(ex?.unit_in_cost_sheet?.builtup_sqft) ?? dwcArea.builtup_sqft,
                  carpet_sqft: num(ex?.carpet_area?.value) ?? dwcArea.carpet_sqft },
    // The cost sheet's own Unit Price row - area x base rate, on its own, before PLC/FLC/parking.
    // Kept as a plain number, not a money string, because the Market Valuation Sheet check reads
    // this back at print time - long after this reading was stored - to judge a figure Cowork
    // writes into the booking_audits row separately (see wfBookingReading in accountability.js).
    unit_price: up.amount,
    // the applicant's own Aadhaar, for the agreement; null when no card of theirs is in the file,
    // or when one was found but its number would not read as twelve clean digits (see concerns)
    applicant_aadhaar: applicantAadhaar,
    // Realty Bucket's own record of this lead, or null when none of mobile/email/name found one -
    // see crmLeadLookup. The check list's own line is in checklist["Booked in CRM - Lead ID"].
    crm_lead: crmLead,
    /* The cost sheet's payment schedule, for the agreement's Part II. Kept as printed - the
       percentages and the gross amounts are the sheet's own, not worked out here. */
    payment_schedule: (Array.isArray(ex?.payment_schedule) ? ex.payment_schedule : [])
      .map((r: any) => ({ milestone: r?.milestone ?? null, percent: num(r?.percent),
                          less_booking: r?.less_booking === true, amount: num(r?.amount) }))
      .filter((r: any) => String(r.milestone ?? "").trim()),
    unit: { booking_form: ex?.unit_in_booking_form ?? null, cost_sheet: ex?.unit_in_cost_sheet ?? null,
            comparison: Array.isArray(gpt?.unit_check) ? gpt.unit_check : [] },
    signatures: { pages: sigPages, summary: gpt?.signature_summary ?? null,
                  verdict: item("Signatures"), reason: why("Signatures") },
    parking: { marked: ex?.parking_choice ?? null, rows: parkRows, check: gpt?.parking_check ?? null,
               verdict: item("Car Parking"), reason: why("Car Parking") },
    validation: { mobile: mobCheck, email: emlCheck, pan: panCheck },
    cost_sheet_verdict: { verdict: costVerdict, reason: costReason, parts: costParts },
    cost_sheets: perSheet,
    gst: gst ? { rates_found: gst.rates, lines: gst.lines } : null,
    arithmetic: allChecks,
    item_checks: itemChecks,
    concerns,
    uncertain_figures: uncertainFigures,
    document_quality: { verdict: qualityVerdict, reason: qualityReason },
    kyc: {
      people: kycPeople, mobile_numbers: mobiles, emails,
      documents: ids.map((d: any) => ({ doc_type: d?.doc_type ?? null, name_on_card: d?.name_on_card ?? null,
        dob_on_card: d?.dob_on_card ?? null, number: mask(d?.id_number),
        relation: d?.relation_to_customer ?? null, found_in: d?.found_in ?? null })),
    },
    checklist: {
      // Car parking and the unit are not lines of their own; they are part of this one.
      "Cost Sheet": costVerdict,
      "Market valuation Sheet": "-- skipped --",
      "KYC of Customer": item("KYC of Customer"),
      "Mobile Number": item("Mobile Number"),
      "Email ID": item("Email ID"),
      "Pan Card No.": item("Pan Card No."),
      "Source": sourceValue,
      "Booked in CRM - Lead ID": crmLine,
      "Booking Date": fields.booking_date.found ? String(fields.booking_date.value) : "--",
      "Payment Plan": fields.payment_plan.found ? String(fields.payment_plan.value) : "AS PER COST SHEET",
      // Left blank for now, per request - same reasoning as Source above.
      "Discount Approved": "",
      "Signatures": item("Signatures"),
      "Document Quality": qualityVerdict,
    },
    notes: ex?.notes ?? "",
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return j({ error: "method not allowed" }, 405);

  let body: any = {};
  try { body = await req.json(); } catch (_) { /* validated below */ }

  const secret = req.headers.get("x-audit-secret") || "";
  let ok = false, viaSecret = false;
  if (secret) {
    const r = await fetch(`${SB}/rest/v1/job_secrets?name=eq.booking_audit&select=value`, { headers: HA });
    const rows = await r.json().catch(() => []);
    ok = viaSecret = Array.isArray(rows) && rows[0]?.value === secret;
  }
  if (!ok) {
    const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    if (token) {
      const who = await fetch(`${SB}/auth/v1/user`,
        { headers: { Authorization: `Bearer ${token}`, apikey: Deno.env.get("SUPABASE_ANON_KEY")! } });
      ok = who.ok;
    }
  }
  if (!ok) return j({ error: "unauthorized" }, 401);

  const model = String(body?.model || DEFAULT_MODEL);

  if (body?.work) {
    if (!viaSecret) return j({ error: "the queue is only worked by the job" }, 403);
    let id: number | null = null;
    try { id = await rpc("booking_audit_claim", {}); }
    catch (e) { return j({ error: "could not claim a booking", detail: String(e) }, 500); }
    if (!id) return j({ ok: true, idle: true, message: "nothing waiting to be read" });
    let res: any;
    try { res = await audit(Number(id), model); }
    catch (e) { res = { error: `the reader threw: ${String((e as any)?.message || e)}` }; }
    try {
      await rpc("booking_audit_finish", { p_case_id: Number(id),
        p_result: res?.ok ? res : null, p_model: model, p_error: res?.ok ? null : String(res?.error || "failed") });
    } catch (e) { return j({ ok: false, case_id: id, stored: false, detail: String(e) }, 500); }
    return j({ ok: true, case_id: id, stored: true, status: res?.ok ? "done" : "failed",
               error: res?.ok ? null : res?.error ?? null });
  }

  const caseId = Number(body?.case_id || 0);
  if (!caseId) return j({ error: "case_id is required" }, 400);

  let res: any;
  try { res = await audit(caseId, model, body?.probe === true); }
  catch (e) { res = { error: `the reader threw: ${String((e as any)?.message || e)}` }; }

  if (body?.store) {
    try {
      await rpc("booking_audit_finish", { p_case_id: caseId,
        p_result: res?.ok ? res : null, p_model: model, p_error: res?.ok ? null : String(res?.error || "failed") });
    } catch (_e) { /* the reading still goes back to the caller */ }
  }
  return res?.ok ? j(res) : j(res, 502);
});
