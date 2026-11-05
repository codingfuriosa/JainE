// LEGAL MIS - HEARING DATES LEFT BEHIND (2 Nov 2026, asked by Ayush).
//
//   { action: "legal_hearing_overdue" }   THE JOB ONLY (x-audit-secret), once a day.
//
// An open case whose newest hearing date (public.mis_hearings, or the case's own case_next_date when it has
// none) is 7 or more days behind today has had no next date put in. Every day until it is, everyone in the
// Legal department is emailed the list - one email each, longest overdue first. "Legal department" is what
// the rest of JAIN-E means by it (acc.people: user profile, else admin user, department includes Legal), and
// anyone who is also in Administration - the Administrator - is left out.
// Switched by acc.job_secrets 'legal_overdue_mail' = 'on'; anything else sends nothing. From JAIN-E's own
// system mailbox (GMAIL_USER), like the other internal reminders.

import { SMTPClient } from "https://deno.land/x/denomailer@1.6.0/mod.ts";
import { mailBody } from "./booking-mail.ts";

type J = (o: unknown, status?: number) => Response;
const esc = (s: unknown) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
const DAYS = 7;
const dmy = (iso: string) => { const p = String(iso).slice(0, 10).split("-"); return p[2] + "/" + p[1] + "/" + p[0]; };

export async function legalHearingOverdue(req: Request, db: any, j: J): Promise<Response> {
  const acc = db.schema("acc");
  const { data: s } = await acc.from("job_secrets").select("value").eq("name", "booking_audit").maybeSingle();
  if (!s?.value || (req.headers.get("x-audit-secret") || "") !== s.value) return j({ error: "Not allowed" }, 403);
  const { data: sw } = await acc.from("job_secrets").select("value").eq("name", "legal_overdue_mail").maybeSingle();
  if (String(sw?.value || "off") !== "on") return j({ ok: true, sent: 0, note: "switched off" });

  const today = new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10);   // IST
  const [{ data: cases, error: ce }, { data: hs, error: he }, { data: people }] = await Promise.all([
    db.from("mis_cases").select("id,cause_title,case_no,court,case_type,case_next_date_iso,completed_at").is("completed_at", null),
    db.from("mis_hearings").select("case_id,hearing_date"),
    acc.rpc("people")]);
  if (ce || he) return j({ error: "Could not read the MIS: " + (ce || he).message }, 500);

  const newest: Record<string, string> = {};
  (hs || []).forEach((h: any) => { const d = String(h.hearing_date || "").slice(0, 10); if (d && (!newest[h.case_id] || d > newest[h.case_id])) newest[h.case_id] = d; });
  const late = (cases || []).map((c: any) => {
    const h = newest[c.id] || (c.case_next_date_iso ? String(c.case_next_date_iso).slice(0, 10) : "");
    const days = h ? Math.round((Date.parse(today) - Date.parse(h)) / 864e5) : -1;
    return { c, h, days };
  }).filter((x: any) => x.h && x.days >= DAYS).sort((a: any, b: any) => b.days - a.days);
  if (!late.length) return j({ ok: true, sent: 0, overdue: 0 });

  const to = (people || []).filter((p: any) => {
    const d: string[] = Array.isArray(p.department) ? p.department : [];
    return p.email && d.includes("Legal") && !d.includes("Administration") && String(p.full_name || "").trim().toLowerCase() !== "administrator";
  });
  if (!to.length) return j({ ok: true, sent: 0, overdue: late.length, note: "nobody in the Legal department" });

  const GU = Deno.env.get("GMAIL_USER"), GP = Deno.env.get("GMAIL_APP_PASSWORD");
  if (!GU || !GP) return j({ error: "Gmail secrets (GMAIL_USER / GMAIL_APP_PASSWORD) are not set." }, 500);
  const subject = `${late.length} case${late.length === 1 ? "" : "s"} with a hearing date passed ${DAYS}+ days ago - put in the next date`;
  const lines = late.map((x: any) => `- ${String(x.c.cause_title || "").replace(/\s+/g, " ").trim()} (${x.c.case_no || "no case no."}) - last hearing ${dmy(x.h)}, ${x.days} days ago`);
  const rows = late.map((x: any) => `<tr><td style="padding:6px 10px;border-bottom:1px solid #e5e7eb">${esc(String(x.c.cause_title || "").replace(/\s+/g, " "))}<div style="color:#6b7280;font-size:12px">${esc([x.c.case_no, x.c.court].filter(Boolean).join(" · "))}</div></td>`
    + `<td style="padding:6px 10px;border-bottom:1px solid #e5e7eb;white-space:nowrap;color:#b91c1c;font-weight:700">${dmy(x.h)}</td>`
    + `<td style="padding:6px 10px;border-bottom:1px solid #e5e7eb;white-space:nowrap">${x.days} days</td></tr>`).join("");
  const out: any[] = [];
  const client = new SMTPClient({ connection: { hostname: "smtp.gmail.com", port: 465, tls: true, auth: { username: GU, password: GP } } });
  try {
    for (const p of to) {
      const name = String(p.full_name || "").trim() || p.email;
      const text = `Dear ${name},\n\nThese open cases in Legal MIS still show a hearing date that passed ${DAYS} or more days ago. Please open each one in JAIN-E (Legal > MIS > the case > Hearings) and put in its next hearing date.\n\n${lines.join("\n")}\n\nThis reminder goes out every day until each case has its next hearing date.\n\nJAIN-E`;
      const html = `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#111827;line-height:1.6"><p>Dear ${esc(name)},</p>`
        + `<p>These open cases in <b>Legal MIS</b> still show a hearing date that passed <b>${DAYS} or more days ago</b>. Please open each one in JAIN-E (Legal &gt; MIS &gt; the case &gt; Hearings) and put in its next hearing date.</p>`
        + `<table style="border-collapse:collapse;font-size:13px"><tr style="background:#f3f4f6"><th style="text-align:left;padding:6px 10px">Case</th><th style="text-align:left;padding:6px 10px">Last hearing</th><th style="text-align:left;padding:6px 10px">Overdue</th></tr>${rows}</table>`
        + `<p style="color:#6b7280;font-size:12px">This reminder goes out every day until each case has its next hearing date.</p><p>JAIN-E</p></div>`;
      try { await client.send({ from: `JAIN-E Legal <${GU}>`, to: p.email, subject, ...mailBody(text, html) }); out.push({ to: p.email, ok: true }); }
      catch (e) { out.push({ to: p.email, ok: false, error: String((e as Error)?.message || e).slice(0, 200) }); }
    }
  } finally { try { await client.close(); } catch { /* ignore */ } }
  return j({ ok: true, overdue: late.length, sent: out.filter((x) => x.ok).length, results: out });
}
