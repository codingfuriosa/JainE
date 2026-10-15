// BOOKING DOCUMENTS BY EMAIL - the Welcome Letter, the Allotment Letter and the Agreement Draft,
// sent from Pallabita Ghosh's mailbox (customercare1@thejaingroup.com, Manager - Post Sales).
//
//   { action: "booking_doc_mail", case_id, kind, modified, letter_html?, pdf_base64?, filename? }
//       STAFF ONLY - the Email button in the document editor. The caller's own token is checked and
//       acc.booking_doc_can_act() must say yes (the Administrator and Post Sales).
//       welcome    goes as TEXT in the body of the email - never as an attachment. When the letter
//                  has been edited (modified), the edited wording is what is sent, and the subject
//                  says MODIFIED.
//       allotment  goes as the PDF built from the editor's current page, attached.
//       agreement  the same.
//   { action: "booking_welcome_auto", case_id }
//       THE JOB ONLY (x-audit-secret, the same secret the booking reader uses) - fired by the
//       database the first time a booking's reading finishes. Sends the Welcome Letter once, never
//       again automatically, and never for a booking read before this existed (auto_skip).
//
// A REJECTED document is never emailed, by hand or automatically. It can still be opened, edited
// and downloaded; acc.booking_doc_set_rejected() is the switch.
//
// TEST MODE. While acc.job_secrets 'booking_mail_mode' is anything but 'live', every one of these
// emails goes to 'booking_mail_test_to' instead of the customer, with [TEST] in the subject and a
// line at the top saying who it would have gone to. Nothing here ever turns that off by itself.
//
// It lives in customer-invite because that function already holds this mailbox
// (CUSTOMER_MAIL_USER / CUSTOMER_MAIL_APP_PASSWORD) and the project has no room for another one.

import { SMTPClient } from "https://deno.land/x/denomailer@1.6.0/mod.ts";

type J = (o: unknown, status?: number) => Response;

const KINDS = ["welcome", "welcome2", "allotment", "agreement"];
const TEXT_KINDS = ["welcome", "welcome2"];   // go as the body of the email, never as a file
const EMAIL_RE = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;
const DOC_NAME: Record<string, string> = {
  welcome: "Welcome Letter", welcome2: "2nd Welcome Letter",
  allotment: "Allotment Letter", agreement: "Agreement Draft",
};

/* THE ALLOTMENT PAYMENT DUE, project by project. Rs 1,00,000 for every project until Post Sales
   sends the list - add a project's own figure under its name (as the reader spells it, e.g.
   "Dream Gurukul") and it wins over '*'. Keep in step with WF_ALLOTMENT_DUE in accountability.js. */
const ALLOTMENT_DUE: Record<string, number> = { "*": 100000 };

/* The due date is the booking date plus 30 days. A booking with no booking date read off it has
   no due date, and a demand notice without one is not sent - null here, and the caller refuses. */
function dueDate(res: any): string | null {
  const b = res?.fields?.booking_date;
  const m = String(b?.value ?? "").trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m || b?.found === false) return null;
  const d = new Date(Date.UTC(Number(m[3]), Number(m[2]) - 1, Number(m[1]) + 30));
  if (isNaN(d.getTime())) return null;
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getUTCDate())}.${p(d.getUTCMonth() + 1)}.${d.getUTCFullYear()}`;
}

/* THE 2nd WELCOME LETTER - the Allotment Payment Letter - in the wording Post Sales gave. */
export function welcome2Email(res: any) {
  const f = res?.fields || {};
  const val = (k: string) => { const t = String(f?.[k]?.value ?? "").trim(); return (!t || t === "NIL") ? "" : t; };
  const project = val("project_name") || "________________";
  const unit = `Block ${val("block") || "____"}/${val("flat") || "____"}`;
  const amt = ALLOTMENT_DUE[project] ?? ALLOTMENT_DUE["*"];
  const amount = amt.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const due = dueDate(res);
  const P = (h: string) => `<p style="margin:0 0 14px">${h}</p>`;
  const html = `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.6;color:#111827">`
    + P(`Dear Sir,`)
    + P(`We hope this email finds you well.`)
    + P(`We are pleased to inform you that the construction and development work at <b>${esc(project)}</b> is progressing steadily as per our planned schedule.`)
    + P(`Following the successful booking of your unit <b>${esc(unit)}</b>, this email serves as an official demand notice for the <b>Allotment Payment</b>, which constitutes 10% of the total consideration value of your property.`)
    + P(`Here are the payment details for your quick reference:`)
    + `<ul style="margin:0 0 14px;padding-left:22px">`
    + `<li><b><u>Total Allotment Amount Due: ${esc(amount)}</u></b></li>`
    + `<li><b><u>Due Date: ${esc(due || "____")}</u></b></li></ul>`
    + P(`Timely payments ensure that the development of your dream home continues without any delays.`)
    + P(`If you have already made this payment, please disregard this notice and share the receipt details with us.`)
    + P(`If you have any questions or require clarification regarding your payment schedule, please feel free to reach out to us.`)
    + P(`Thank you for your continued cooperation and partnership.`)
    + P(`Warm regards,`)
    + `<p style="margin:0"><b>Pallabita Ghosh (Manager - Post Sales)</b></p>`
    + `<p style="margin:0"><b>Reach me @8420541541</b></p>`
    + `<p style="margin:0">Customer Relations Team</p></div>`;
  const text = `Dear Sir,\n\nWe hope this email finds you well.\n\n`
    + `We are pleased to inform you that the construction and development work at ${project} is progressing steadily as per our planned schedule.\n\n`
    + `Following the successful booking of your unit ${unit}, this email serves as an official demand notice for the Allotment Payment, which constitutes 10% of the total consideration value of your property.\n\n`
    + `Here are the payment details for your quick reference:\n\n`
    + `* Total Allotment Amount Due: ${amount}\n* Due Date: ${due || "____"}\n\n`
    + `Timely payments ensure that the development of your dream home continues without any delays.\n`
    + `If you have already made this payment, please disregard this notice and share the receipt details with us.\n`
    + `If you have any questions or require clarification regarding your payment schedule, please feel free to reach out to us.\n`
    + `Thank you for your continued cooperation and partnership.\n\nWarm regards,\n`
    + `Pallabita Ghosh (Manager - Post Sales)\nReach me @8420541541\nCustomer Relations Team`;
  return { html, text, due };
}

const esc = (s: unknown) => String(s ?? "").replace(/[&<>"]/g,
  (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));

/* ---- the same wording rules as wfWelcomeDoc in accountability.js -------------------------------
   The letter a customer reads in their inbox must say what the letter Post Sales opens says, so
   the helpers are the same ones, carried across line for line. */
function nameCase(s: unknown) {
  return String(s ?? "").trim().toLowerCase()
    .replace(/(^|[\s.'\-])([a-z])/g, (_m, a, b) => a + b.toUpperCase());
}
function salutation(raw: unknown) {
  const t = String(raw ?? "").trim();
  if (!t || t.indexOf("/") !== -1 || t.length > 6) return "";
  return t;
}
function allotteeNames(res: any): string[] {
  const LT = res?.letter || {}, f = res?.fields || {};
  const out: string[] = [];
  for (const p of (Array.isArray(LT.allottees) ? LT.allottees : [])) {
    const nm = nameCase(p?.name);
    if (!nm) continue;
    if (out.some((x) => x.toUpperCase().indexOf(nm.toUpperCase()) !== -1)) continue;
    out.push([salutation(p?.salutation), nm].filter(Boolean).join(" "));
  }
  if (!out.length) {
    const one = String(f?.customer_name?.value ?? "").trim();
    if (one && one !== "NIL") out.push(nameCase(one));
  }
  return out;
}
function ordinal(n: unknown) {
  const v = Math.floor(Math.abs(Number(n)));
  if (!isFinite(v) || !v) return null;
  const t = v % 100;
  if (t >= 11 && t <= 13) return v + "th";
  return v + (({ 1: "st", 2: "nd", 3: "rd" } as Record<number, string>)[v % 10] || "th");
}
const ONES = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven",
  "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
const TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];
const u100 = (n: number) => n < 20 ? ONES[n] : TENS[Math.floor(n / 10)] + (n % 10 ? " " + ONES[n % 10] : "");
const u1000 = (n: number) => n < 100 ? u100(n)
  : ONES[Math.floor(n / 100)] + " Hundred" + (n % 100 ? " " + u100(n % 100) : "");
function rupeesInWords(amount: number) {
  let n = Math.floor(Math.abs(Number(amount) || 0));
  const paise = Math.round((Math.abs(Number(amount) || 0) - n) * 100);
  if (!n && !paise) return "Zero";
  const parts: string[] = [];
  const crore = Math.floor(n / 10000000); n -= crore * 10000000;
  const lakh = Math.floor(n / 100000); n -= lakh * 100000;
  const thou = Math.floor(n / 1000); n -= thou * 1000;
  if (crore) parts.push(u1000(crore) + " Crore");
  if (lakh) parts.push(u1000(lakh) + " Lakh");
  if (thou) parts.push(u1000(thou) + " Thousand");
  if (n) parts.push(u1000(n));
  let out = parts.join(" ");
  if (paise) out += (out ? " and " : "") + u100(paise) + " Paise";
  return out;
}

/* The values the letter is made of, from the stored reading. A value the documents did not state
   is a blank line to fill, exactly as on the printed letter - never a guess. */
export function welcomeValues(res: any) {
  const f = res?.fields || {}, LT = res?.letter || {};
  const val = (k: string) => {
    const t = String(f?.[k]?.value ?? "").trim();
    return (!t || t === "NIL") ? "" : t;
  };
  const who = allotteeNames(res);
  const project = val("project_name") || "________________";
  const locality = String(LT.locality || "").trim();
  const flat = val("flat") || "____", block = val("block") || "____";
  const fRaw = val("floor");
  const fNum = (fRaw.match(/\d+/) || [])[0];
  const floor = fNum ? (ordinal(fNum) + " floor") : (fRaw ? nameCase(fRaw) + " floor" : "____ floor");
  const tokenNum = (typeof LT?.token?.value === "number" && isFinite(LT.token.value)) ? LT.token.value : null;
  const tokenFig = tokenNum !== null
    ? tokenNum.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "________";
  const tokenWords = String(LT?.token?.in_words || "").trim()
    || (tokenNum !== null ? rupeesInWords(tokenNum) : "________________");
  return { who, project, locality, flat, block, floor, tokenFig, tokenWords };
}

/* THE WELCOME LETTER AS AN EMAIL. Text, not an attachment, in the wording Post Sales gave:
   bold for the applicants' names (not "Dear"), the project's name, and the flat's particulars. */
export function welcomeEmail(res: any) {
  const v = welcomeValues(res);
  const names = v.who.join(" and ") || "Sir / Madam";
  const place = v.project + (v.locality ? ", " + v.locality : "");
  const flatLine = `Flat No. ${v.flat}, ${v.floor}, Block-${v.block} of ${place}`;
  const P = (h: string) => `<p style="margin:0 0 14px">${h}</p>`;
  const html = `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.6;color:#111827">`
    + P(`Dear <b>${esc(names)}</b>,`)
    + P(`Greetings from The Jain Group!`)
    + P(`Whilst expressing our deep appreciation towards your investment in ‘<b>${esc(v.project)}</b>’, `
      + `we further feel privileged for having placed your trust on us in selecting your Dream Home.`)
    + P(`By way of this letter, please be informed that we have received the application for <b>${esc(flatLine)}</b>.`)
    + P(`We have received a token amount of ${esc(v.tokenFig)} (${esc(v.tokenWords)} only) against the above mentioned booking.`)
    + P(`Please feel free to get in touch with the undersigned with any queries / feedback or for assistance. `
      + `It is always our pleasure to be of service to you today and in the future.`)
    + P(`Once again we warmly welcome you to the growing Jain Group family.`)
    + P(`Thanking you,`)
    + `<p style="margin:0"><b>Pallabita Ghosh</b></p>`
    + `<p style="margin:0">Manager – Post Sales</p>`
    + `<p style="margin:0">Reach me @ 8420541541</p>`
    + `</div>`;
  const text = `Dear ${names},\n\nGreetings from The Jain Group!\n\n`
    + `Whilst expressing our deep appreciation towards your investment in ‘${v.project}’, we further feel `
    + `privileged for having placed your trust on us in selecting your Dream Home.\n\n`
    + `By way of this letter, please be informed that we have received the application for ${flatLine}.\n\n`
    + `We have received a token amount of ${v.tokenFig} (${v.tokenWords} only) against the above mentioned booking.\n\n`
    + `Please feel free to get in touch with the undersigned with any queries / feedback or for assistance. `
    + `It is always our pleasure to be of service to you today and in the future.\n\n`
    + `Once again we warmly welcome you to the growing Jain Group family.\n\nThanking you,\n\n`
    + `Pallabita Ghosh\nManager – Post Sales\nReach me @ 8420541541`;
  return { html, text, customer: v.who[0] || nameCase(res?.fields?.customer_name?.value) || "Customer" };
}

/* AN EDITED WELCOME LETTER, as the email body. The editor's page is HTML a person typed into, so
   only the plain formatting survives - paragraphs, line breaks, bold, italic, underline. The
   letterhead logo is dropped (the email is text, as asked), and so is anything else. */
export function letterHtmlToEmail(raw: string) {
  let h = String(raw || "").slice(0, 200000);
  h = h.replace(/<div[^>]*class="[^"]*wfd-logo[^"]*"[^>]*>[\s\S]*?<\/div>/gi, "");
  h = h.replace(/<(script|style|iframe|object|embed|svg)[\s\S]*?<\/\1>/gi, "");
  h = h.replace(/<img[^>]*>/gi, "");
  // every tag reduced to a bare allowed one, or removed with its text kept
  h = h.replace(/<\/?([a-z0-9]+)[^>]*>/gi, (m, tag) => {
    const t = String(tag).toLowerCase();
    const close = m.startsWith("</");
    const map: Record<string, string> = { b: "b", strong: "b", i: "i", em: "i", u: "u", br: "br", p: "p", div: "p" };
    const to = map[t];
    if (t === "li") return close ? "</p>" : '<p style="margin:0 0 6px">• ';
    if (!to) return "";
    if (to === "br") return close ? "" : "<br>";
    if (to === "p") return close ? "</p>" : '<p style="margin:0 0 14px">';
    return close ? `</${to}>` : `<${to}>`;
  });
  h = h.replace(/<p style="margin:0 0 14px">\s*<\/p>/g, "");
  const html = `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.6;color:#111827">${h}</div>`;
  const text = h.replace(/<br>/g, "\n").replace(/<\/p>/g, "\n\n").replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/\n{3,}/g, "\n\n").trim();
  return { html, text };
}

/* Who the booking file says the customer is reachable at: every well-formed address in it. */
function customerEmails(res: any): string[] {
  const out: string[] = [];
  const push = (e: unknown) => {
    const t = String(e ?? "").trim().toLowerCase();
    if (EMAIL_RE.test(t) && !out.includes(t)) out.push(t);
  };
  for (const a of (res?.validation?.email?.addresses || [])) if (a?.valid) push(a?.printed);
  for (const e of (res?.kyc?.emails || [])) push(e);
  return out;
}

export async function handleBookingMail(req: Request, body: any, db: any, j: J, SB: string, SRV: string,
                                        createClient: any): Promise<Response> {
  const action = String(body.action || "");
  const acc = db.schema("acc");
  if (action === "booking_welcome2_reminders") return await welcome2Reminders(req, acc, j);
  const caseId = Number(body.case_id || 0);
  if (!caseId) return j({ error: "case_id is required" }, 400);

  // ---- who is asking
  let sender = "system";
  if (action === "booking_welcome_auto") {
    const secret = req.headers.get("x-audit-secret") || "";
    const { data: s } = await acc.from("job_secrets").select("value").eq("name", "booking_audit").maybeSingle();
    if (!secret || !s?.value || s.value !== secret) return j({ error: "unauthorized" }, 401);
  } else {
    const bearer = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    const ANON = Deno.env.get("SUPABASE_ANON_KEY") || SRV;
    const asUser = createClient(SB, ANON, { global: { headers: { Authorization: "Bearer " + bearer } } });
    const { data: who } = await asUser.auth.getUser();
    if (!who?.user) return j({ error: "Please sign in again." }, 401);
    const { data: can } = await asUser.schema("acc").rpc("booking_doc_can_act");
    if (!can) return j({ error: "Only the Administrator and Post Sales can email booking documents." }, 403);
    sender = who.user.email || "staff";
  }

  const kind = action === "booking_welcome_auto" ? "welcome" : String(body.kind || "");
  if (!KINDS.includes(kind)) return j({ error: "Unknown document." }, 400);

  // ---- the mailbox
  const CU = Deno.env.get("CUSTOMER_MAIL_USER"), CP = Deno.env.get("CUSTOMER_MAIL_APP_PASSWORD");
  if (!CU || !CP) return j({ error: "Pallabita Ghosh's mailbox (customercare1@thejaingroup.com) is not connected." }, 500);

  // ---- the document's state
  const { data: st } = await acc.from("booking_doc_status").select("*")
    .eq("case_id", caseId).eq("kind", kind).maybeSingle();
  if (st?.rejected) return j({ error: `This ${DOC_NAME[kind]} has been rejected, so it cannot be emailed.` }, 409);
  if (action === "booking_welcome_auto" && (st?.auto_skip || st?.auto_emailed_at)) {
    return j({ ok: true, skipped: st?.auto_skip ? "read before automatic letters existed" : "already sent" });
  }

  const { data: audit } = await acc.from("booking_audits").select("status,result").eq("case_id", caseId).maybeSingle();
  if (!audit || audit.status !== "done" || !audit.result) return j({ error: "The booking has not been read yet." }, 409);
  const res = audit.result;

  // ---- test or live
  const { data: secrets } = await acc.from("job_secrets").select("name,value")
    .in("name", ["booking_mail_mode", "booking_mail_test_to"]);
  const conf: Record<string, string> = {};
  for (const r of (secrets || [])) conf[r.name] = String(r.value || "");
  const live = conf.booking_mail_mode === "live";
  const testTo = (conf.booking_mail_test_to || "").trim();
  const intended = customerEmails(res);
  if (live && !intended.length) return j({ error: "No email address was found in the booking file." }, 422);
  if (!live && !EMAIL_RE.test(testTo)) return j({ error: "Test mode is on but no test inbox is set." }, 500);
  const to = live ? intended : [testTo];

  // ---- the message
  const modified = action !== "booking_welcome_auto" && body.modified === true;
  const w = welcomeEmail(res);
  const w2 = welcome2Email(res);
  if (kind === "welcome2" && !w2.due) {
    return j({ error: "No booking date was read from this booking, so the due date cannot be set and the 2nd Welcome Letter cannot be emailed." }, 422);
  }
  let subject = (kind === "welcome2" ? "Allotment Payment Letter" : `${DOC_NAME[kind]} - ${w.customer}`)
    + (modified ? " (MODIFIED)" : "");
  let html = "", text = "";
  const attachments: any[] = [];
  if (TEXT_KINDS.includes(kind)) {
    if (modified && String(body.letter_html || "").trim()) {
      const m = letterHtmlToEmail(String(body.letter_html));
      html = m.html; text = m.text;
    } else if (kind === "welcome2") { html = w2.html; text = w2.text; }
    else { html = w.html; text = w.text; }
  } else {
    const b64 = String(body.pdf_base64 || "").replace(/^data:[^,]*,/, "").replace(/\s+/g, "");
    if (!b64) return j({ error: "The document's PDF was not attached." }, 400);
    if (b64.length > 14_000_000) return j({ error: "The PDF is too large to email." }, 413);
    const fname = String(body.filename || `${DOC_NAME[kind]} - ${w.customer}.pdf`).replace(/[\\/:*?"<>|]+/g, " ").slice(0, 120);
    attachments.push({ filename: fname.endsWith(".pdf") ? fname : fname + ".pdf", content: b64,
                       encoding: "base64", contentType: "application/pdf" });
    const v = welcomeValues(res);
    html = `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.6;color:#111827">`
      + `<p style="margin:0 0 14px">Dear <b>${esc(v.who.join(" and ") || "Sir / Madam")}</b>,</p>`
      + `<p style="margin:0 0 14px">Please find attached the ${esc(DOC_NAME[kind])}${modified ? " (modified version)" : ""} `
      + `for <b>Flat No. ${esc(v.flat)}, ${esc(v.floor)}, Block-${esc(v.block)} of ${esc(v.project)}</b>.</p>`
      + `<p style="margin:0 0 14px">Please feel free to get in touch with the undersigned with any queries.</p>`
      + `<p style="margin:0 0 14px">Thanking you,</p>`
      + `<p style="margin:0"><b>Pallabita Ghosh</b></p><p style="margin:0">Manager – Post Sales</p>`
      + `<p style="margin:0">Reach me @ 8420541541</p></div>`;
    text = html.replace(/<\/p>/g, "\n\n").replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").trim();
  }
  if (!live) {
    subject = "[TEST] " + subject;
    const would = intended.length ? intended.join(", ") : "(no email address found in the booking file)";
    html = `<div style="font-family:Arial,sans-serif;font-size:13px;background:#fef3c7;border:1px solid #f59e0b;`
      + `padding:10px 14px;margin:0 0 18px;border-radius:6px"><b>TEST MODE</b> - in live mode this would have gone to: `
      + `${esc(would)}${action === "booking_welcome_auto" ? " (sent automatically when the booking was read)" : ` (sent by ${esc(sender)})`}</div>` + html;
    text = `[TEST MODE - in live mode this would have gone to: ${would}]\n\n` + text;
  }

  // An automatic letter is claimed before it is sent, so two pokes for the same booking cannot
  // both send it. A failed send gives the claim back.
  if (action === "booking_welcome_auto") {
    await acc.from("booking_doc_status").upsert({ case_id: caseId, kind: "welcome" }, { onConflict: "case_id,kind", ignoreDuplicates: true });
    const { data: claimed } = await acc.from("booking_doc_status").update({ auto_emailed_at: new Date().toISOString() })
      .eq("case_id", caseId).eq("kind", "welcome").is("auto_emailed_at", null).eq("auto_skip", false).eq("rejected", false)
      .select("case_id");
    if (!claimed || !claimed.length) return j({ ok: true, skipped: "already sent, skipped or rejected" });
  }

  const client = new SMTPClient({ connection: { hostname: "smtp.gmail.com", port: 465, tls: true,
    auth: { username: CU, password: CP } } });
  try {
    await client.send({ from: `Pallabita Ghosh - The Jain Group <${CU}>`, to, subject, content: text, html,
      ...(attachments.length ? { attachments } : {}) });
  } catch (e) {
    if (action === "booking_welcome_auto") {
      await acc.from("booking_doc_status").update({ auto_emailed_at: null }).eq("case_id", caseId).eq("kind", "welcome");
    }
    return j({ error: "Could not send: " + String((e as Error).message || e).slice(0, 300) }, 502);
  } finally { try { await client.close(); } catch { /* ignore */ } }

  const now = new Date().toISOString();
  const prev = Number(st?.email_count || 0);
  await acc.from("booking_doc_status").upsert({
    case_id: caseId, kind,
    last_emailed_at: now, last_emailed_by: sender, last_email_to: to,
    last_email_test: !live, last_email_modified: modified, email_count: prev + 1,
    ...(action === "booking_welcome_auto" ? { auto_emailed_at: now } : {}),
  }, { onConflict: "case_id,kind" });

  return j({ ok: true, test: !live, sent_to: to, intended_to: intended, subject });
}

/* THE 2nd WELCOME LETTER REMINDER - the job only (x-audit-secret), every evening.
   For each booking whose reminder day has come (the day after upload, Monday when that is a
   Sunday) and whose 2nd Welcome Letter has still not been emailed, Pallabita Ghosh gets one email
   saying so. Once per booking: reminder_sent_at is stamped whether or not more follow. In test
   mode it goes to the test inbox. */
async function welcome2Reminders(req: Request, acc: any, j: J): Promise<Response> {
  const secret = req.headers.get("x-audit-secret") || "";
  const { data: s } = await acc.from("job_secrets").select("value").eq("name", "booking_audit").maybeSingle();
  if (!secret || !s?.value || s.value !== secret) return j({ error: "unauthorized" }, 401);
  const CU = Deno.env.get("CUSTOMER_MAIL_USER"), CP = Deno.env.get("CUSTOMER_MAIL_APP_PASSWORD");
  if (!CU || !CP) return j({ error: "Pallabita Ghosh's mailbox is not connected." }, 500);

  const { data: due, error } = await acc.rpc("booking_welcome2_due");
  if (error) return j({ error: error.message }, 500);
  if (!due || !due.length) return j({ ok: true, reminded: 0 });

  const { data: secrets } = await acc.from("job_secrets").select("name,value")
    .in("name", ["booking_mail_mode", "booking_mail_test_to"]);
  const conf: Record<string, string> = {};
  for (const r of (secrets || [])) conf[r.name] = String(r.value || "");
  const live = conf.booking_mail_mode === "live";
  const to = live ? CU : (conf.booking_mail_test_to || "").trim();
  if (!EMAIL_RE.test(to)) return j({ error: "no reminder inbox" }, 500);

  const ids = due.map((d: any) => Number(d.case_id));
  const { data: cases } = await acc.from("flow_cases").select("id,case_no").in("id", ids);
  const { data: audits } = await acc.from("booking_audits").select("case_id,result").in("case_id", ids);
  const no: Record<number, any> = {}; for (const c of (cases || [])) no[c.id] = c.case_no;
  const rs: Record<number, any> = {}; for (const a of (audits || [])) rs[a.case_id] = a.result;

  const client = new SMTPClient({ connection: { hostname: "smtp.gmail.com", port: 465, tls: true,
    auth: { username: CU, password: CP } } });
  const sent: number[] = [];
  try {
    for (const d of due) {
      const id = Number(d.case_id), res = rs[id] || {};
      const v = welcomeValues(res);
      const who = v.who.join(" and ") || "the customer";
      const subj = `${live ? "" : "[TEST] "}Reminder: 2nd Welcome Letter not sent - ${who} (Booking Form No. ${no[id] ?? id})`;
      const html = `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.6;color:#111827">`
        + `<p style="margin:0 0 14px">The <b>2nd Welcome Letter</b> (Allotment Payment Letter) has not been emailed yet for:</p>`
        + `<p style="margin:0 0 14px"><b>${esc(who)}</b> - Flat No. ${esc(v.flat)}, ${esc(v.floor)}, Block-${esc(v.block)}, ${esc(v.project)}<br>`
        + `Booking Form No. ${esc(no[id] ?? id)}, uploaded ${esc(d.uploaded)}.</p>`
        + `<p style="margin:0">Please open the booking in JAIN-E and email the 2nd Welcome Letter.</p></div>`;
      const text = html.replace(/<br>/g, "\n").replace(/<\/p>/g, "\n\n").replace(/<[^>]+>/g, "").trim();
      try {
        await client.send({ from: `JAIN-E Post Sales <${CU}>`, to, subject: subj, content: text, html });
        sent.push(id);
        await acc.from("booking_doc_status").upsert({ case_id: id, kind: "welcome2", reminder_sent_at: new Date().toISOString() },
          { onConflict: "case_id,kind" });
      } catch (_e) { /* left for tomorrow evening's run */ }
    }
  } finally { try { await client.close(); } catch { /* ignore */ } }
  return j({ ok: true, reminded: sent.length, cases: sent, test: !live });
}
