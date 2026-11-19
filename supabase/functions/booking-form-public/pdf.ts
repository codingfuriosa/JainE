// THE SUBMITTED FORM AS A PDF (19 Nov 2026, Ayush: "along with Cost Sheet a Document showing what they have submitted - basically this page
// properly formatted in a PDF ... the Terms & Conditions, Declaration, Special Conditions in pages; one will not continue on the same page
// another ends"). Built here on the server from the answers that were saved (never from the customer's page), and attached to the thank-you
// email next to the cost sheet. A4, the Jain Group and project logos at the top, the answers in labelled sections, then the Terms, the
// Declaration and the Special Conditions each starting on a page of its own.
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage, type PDFImage } from "https://esm.sh/pdf-lib@1.17.1";
import { TERMS, DECL, SPECIAL } from "./terms.ts";

const A4: [number, number] = [595.28, 841.89];
const M = 48, W = A4[0] - 2 * M;
const RED = rgb(0.702, 0.09, 0.114), INK = rgb(0.067, 0.094, 0.153), GREY = rgb(0.42, 0.45, 0.5), LINE = rgb(0.9, 0.91, 0.92);

// The built-in fonts only know Western characters: the rupee sign, curly quotes and emoji are put into plain text first.
function plain(v: unknown): string {
  const M2: Record<string, string> = { "₹": "Rs. ", "‘": "'", "’": "'", "“": '"', "”": '"', "–": "-", "—": "-", "…": "...", "•": "-", "·": "-", "×": "x", " ": " " };
  return String(v ?? "").replace(/[₹‘’“”–—…•·× ]/g, (c) => M2[c] ?? "").replace(/<br\s*\/?>/gi, "\n")
    .replace(/[^\x0a\x20-\x7e\xa0-\xff]/g, "").replace(/[ \t]+/g, " ").trim();
}
const money = (v: unknown) => { const n = Number(String(v ?? "").replace(/[^\d.]/g, "")); return n ? "Rs. " + n.toLocaleString("en-IN") : ""; };
const dmy = (s: unknown) => { const t = String(s || ""); if (!/^\d{4}-\d{2}-\d{2}/.test(t)) return t; const d = new Date(t.slice(0, 10) + "T00:00:00Z"); return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" }); };
const addr = (x: any) => [x?.line, x?.city, x?.pin].filter(Boolean).join(", ");

class Doc {
  pdf!: PDFDocument; f!: PDFFont; b!: PDFFont; page!: PDFPage; y = 0; logos: PDFImage[] = []; title = "";
  static async make(title: string, logos: Uint8Array[]) {
    const d = new Doc(); d.pdf = await PDFDocument.create(); d.title = title;
    d.f = await d.pdf.embedFont(StandardFonts.Helvetica); d.b = await d.pdf.embedFont(StandardFonts.HelveticaBold);
    for (const l of logos) { try { d.logos.push(await d.pdf.embedPng(l)); } catch (_) { /* a logo that is not a PNG is left out */ } }
    d.newPage(true); return d;
  }
  newPage(first = false) {
    this.page = this.pdf.addPage(A4); this.y = A4[1] - M;
    if (first) {
      let x = M; const h = 38;
      this.logos.forEach((im, i) => { const w = im.width * h / im.height; const lx = i === 0 ? M : A4[0] - M - w; this.page.drawImage(im, { x: lx, y: this.y - h, width: w, height: h }); x = lx; });
      if (this.logos.length) this.y -= h + 10;
      this.page.drawRectangle({ x: M, y: this.y - 2, width: W, height: 2, color: RED }); this.y -= 22;
    } else { this.page.drawText(plain(this.title), { x: M, y: this.y, size: 8.5, font: this.f, color: GREY }); this.y -= 22; }
  }
  need(h: number) { if (this.y - h < M + 24) this.newPage(); }
  lines(text: string, font: PDFFont, size: number, width: number): string[] {
    const out: string[] = [];
    for (const para of plain(text).split("\n")) {
      const words = para.split(" "); let cur = "";
      for (const w of words) { const t = cur ? cur + " " + w : w; if (font.widthOfTextAtSize(t, size) <= width) cur = t; else { if (cur) out.push(cur); cur = w; while (font.widthOfTextAtSize(cur, size) > width) { let k = cur.length; while (k > 1 && font.widthOfTextAtSize(cur.slice(0, k), size) > width) k--; out.push(cur.slice(0, k)); cur = cur.slice(k); } } }
      out.push(cur);
    }
    return out;
  }
  text(t: string, o: { size?: number; bold?: boolean; color?: any; gap?: number; indent?: number } = {}) {
    const size = o.size || 10, font = o.bold ? this.b : this.f, x = M + (o.indent || 0);
    for (const l of this.lines(t, font, size, W - (o.indent || 0))) { this.need(size + 4); this.page.drawText(l, { x, y: this.y - size, size, font, color: o.color || INK }); this.y -= size + 4; }
    this.y -= o.gap ?? 4;
  }
  heading(t: string) { this.need(46); this.y -= 6; this.page.drawText(plain(t).toUpperCase(), { x: M, y: this.y - 10, size: 10, font: this.b, color: RED }); this.y -= 16; this.page.drawRectangle({ x: M, y: this.y, width: W, height: 0.8, color: LINE }); this.y -= 8; }
  // label / value rows: the label in grey on the left, the value wrapped on the right
  rows(pairs: [string, unknown][]) {
    const lw = 150, vw = W - lw - 10, size = 9.5;
    for (const [k, v0] of pairs) {
      const v = plain(v0); if (!v) continue;
      const vl = this.lines(v, this.b, size, vw), h = vl.length * (size + 3) + 5;
      this.need(h);
      this.page.drawText(plain(k), { x: M, y: this.y - size, size, font: this.f, color: GREY });
      vl.forEach((l, i) => this.page.drawText(l, { x: M + lw + 10, y: this.y - size - i * (size + 3), size, font: this.b, color: INK }));
      this.y -= h;
    }
  }
  numbered(items: string[], company: string) {
    items.forEach((t, i) => {
      const body = plain(String(t).split("Dream Gateway Hotels Ltd.").join(company));
      const ls = this.lines(body, this.f, 9.5, W - 22);
      this.need(Math.min(ls.length, 4) * 13.5 + 4);
      this.page.drawText(String(i + 1) + ".", { x: M, y: this.y - 9.5, size: 9.5, font: this.b, color: INK });
      for (const l of ls) { this.need(13.5); this.page.drawText(l, { x: M + 22, y: this.y - 9.5, size: 9.5, font: this.f, color: INK }); this.y -= 13.5; }
      this.y -= 6;
    });
  }
  footer() {
    const pages = this.pdf.getPages();
    pages.forEach((p, i) => p.drawText(`Page ${i + 1} of ${pages.length}`, { x: A4[0] - M - 60, y: 26, size: 8, font: this.f, color: GREY }));
  }
}

// The documents the customer attached (19 Nov 2026: "the Thank You PDF will have the images uploaded as well"): a picture on a page of its own, scaled to fit,
// with what it is above it; an attached PDF has its own pages put in, labelled at the top; anything else (e.g. an iPhone HEIC photo) is named as kept with the form.
async function addDocs(doc: Doc, docs: { label: string; type: string; bytes: Uint8Array }[]) {
  if (!docs.length) return;
  const isJpg = (b: Uint8Array) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
  const isPng = (b: Uint8Array) => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47;
  const isPdf = (b: Uint8Array) => b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46;
  for (const x of docs) {
    try {
      if (isPdf(x.bytes)) {
        const src = await PDFDocument.load(x.bytes, { ignoreEncryption: true });
        const pages = await doc.pdf.copyPages(src, src.getPageIndices());
        for (const p of pages) {
          doc.pdf.addPage(p);
          const { height } = p.getSize();
          p.drawRectangle({ x: 0, y: height - 22, width: p.getSize().width, height: 22, color: rgb(1, 1, 1), opacity: 0.85 });
          p.drawText(plain("Documents submitted - " + x.label), { x: 12, y: height - 15, size: 9, font: doc.b, color: RED });
        }
        continue;
      }
      doc.newPage();
      doc.text("Documents submitted", { size: 9, color: GREY, gap: 0 });
      doc.text(x.label, { size: 13, bold: true, gap: 8 });
      if (!isJpg(x.bytes) && !isPng(x.bytes)) { doc.text("This file (" + (x.type || "unknown type") + ") cannot be shown here; it is kept with the booking form.", { size: 10, color: GREY }); continue; }
      const im = isJpg(x.bytes) ? await doc.pdf.embedJpg(x.bytes) : await doc.pdf.embedPng(x.bytes);
      const maxW = W, maxH = doc.y - M - 30, k = Math.min(maxW / im.width, maxH / im.height, 1.6);
      const w = im.width * k, h = im.height * k;
      doc.page.drawImage(im, { x: M + (maxW - w) / 2, y: doc.y - h, width: w, height: h });
      doc.page.drawRectangle({ x: M + (maxW - w) / 2, y: doc.y - h, width: w, height: h, borderColor: LINE, borderWidth: 0.8 });
      doc.y -= h + 10;
    } catch (_) {
      doc.newPage(); doc.text(x.label, { size: 13, bold: true, gap: 8 });
      doc.text("This document could not be put into this PDF; it is kept with the booking form.", { size: 10, color: GREY });
    }
  }
}

export async function bookingPdf(o: { projectName: string; company: string; ref: string; submittedAt: string; d: any; files: any[]; logos: Uint8Array[]; docs?: { label: string; type: string; bytes: Uint8Array }[]; separate?: string[] }) {
  const d = o.d || {}, title = `${o.projectName} - Booking application ${o.ref}`;
  const doc = await Doc.make(title, o.logos);
  doc.text(`${o.projectName} - Booking Application Form`, { size: 17, bold: true, gap: 2 });
  doc.text(`Reference ${o.ref}  |  Submitted on ${new Date(o.submittedAt).toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kolkata" })} IST`, { size: 9.5, color: GREY, gap: 2 });
  doc.text(`To ${o.company}`, { size: 9.5, color: GREY, gap: 10 });

  const files: any[] = Array.isArray(o.files) ? o.files : [];
  const NM: Record<string, string> = { pan: "PAN card", aadhaar: "Aadhaar card", passport: "Passport", photo: "Photograph", payment: "Payment proof" };
  (Array.isArray(d.applicants) ? d.applicants : []).forEach((a: any, i: number) => {
    doc.heading(i ? `Joint applicant ${i + 1}` : "First / sole applicant");
    const docs = files.filter((f) => Number(f.applicant) - 1 === i && f.kind !== "payment" && f.kind !== "signature").map((f) => NM[f.kind] || f.kind);
    doc.rows([["Name", [a.title, a.full_name].filter(Boolean).join(" ")], [a.relation || "S/o", a.relation_name], ["Date of birth", i ? "" : dmy(a.dob)],
      ["Nationality", a.nationality], ["Occupation", a.occupation], ["Aadhaar number", a.aadhaar ? String(a.aadhaar).replace(/(\d{4})(?=\d)/g, "$1 ") : ""], ["PAN", String(a.pan || "").toUpperCase()],
      ["Passport number", a.passport], ["Spouse", i ? "" : a.spouse], ["Marriage anniversary", i ? "" : dmy(a.anniversary)], ["Documents given", [...new Set(docs)].join(", ")]]);
  });
  const c = d.contact || {};
  doc.heading("Contact & address");
  doc.rows([["Mobile", [c.cc, c.mobile].filter(Boolean).join(" ")], ["Email", c.email], ["Primary contact person", c.contact_person],
    ["Residential address", addr(d.res)], ["Office address", d.off?.on ? addr(d.off) : ""],
    ["Letters to", d.mailing === "Other" ? "Other: " + (d.mailing_other || "") : d.mailing], ["Permanent address", d.permanent === "Other" ? "Other: " + (d.permanent_other || "") : d.permanent]]);
  const p = d.profession || {};
  doc.heading("Occupation & source");
  doc.rows([["Profession", p.kind], ["Company", p.company], ["Designation", p.designation], ["Gross income", p.income], ["Community", p.community],
    ["Newspaper", p.newspaper], ["Magazine", p.magazine], ["TV channel", p.tv], ["Radio", p.radio],
    ["Heard about us from", d.heard === "Other" ? d.heard_other : d.heard], ["Why this project", (Array.isArray(d.why) ? d.why : []).filter(Boolean).map((w: string, i: number) => `${i + 1}. ${w}`).join("   ")]]);
  const fl = d.flat || {}, pr = d.price || {};
  const parks = Array.isArray(fl.parkings) && fl.parkings.length ? fl.parkings : (fl.parking ? [fl.parking] : []);
  doc.heading("Unit, size & price");
  doc.rows([["Block", fl.block], ["Floor", fl.floor], ["Flat number", String(fl.flat_no || "").toUpperCase()], ["Bedrooms", fl.bhk],
    ["Car park", parks.join(", ")], ["Super built-up area", pr.sba ? pr.sba + " sq.ft." : ""], ["Total sale price", money(pr.total)], ["Booking price", money(pr.booking)],
    ["Home loan required", (pr.loan || "") + (pr.loan === "Yes" && pr.bank ? " - " + pr.bank : "")]]);
  const pay = d.pay || {};
  doc.heading("Booking amount");
  doc.rows([["Booking amount", money(pay.amount)], ["Paid by", pay.mode], ["Reference", pay.ref], ["Bank / branch", [pay.bank, pay.branch].filter(Boolean).join(", ")], ["Date", dmy(pay.date)],
    ["Payment proof", files.some((f) => f.kind === "payment") ? "Attached" : ""], ["Purpose of booking", d.purpose], ["Booked through", d.sales]]);
  doc.heading("Agreement");
  doc.text(d.terms_accepted ? "I/We have read and agree to the Terms of application, the Declaration, the Special Conditions and the cost sheet, and confirm that everything in this form is true. Accepted on submission, after verifying the email address with a one-time code." : "Terms not accepted.", { size: 9.5 });

  await addDocs(doc, o.docs || []);
  // documents that are not drawn here (attached PDFs, large or HEIC photos): named, with where they are
  if (o.separate && o.separate.length) {
    doc.newPage();
    doc.text("Documents submitted", { size: 9, color: GREY, gap: 0 });
    doc.text("Also submitted", { size: 13, bold: true, gap: 8 });
    o.separate.forEach((s, i) => doc.text(`${i + 1}. ${s}`, { size: 10.5, gap: 2 }));
  }
  // each of the three on a page of its own
  for (const [t, arr] of [["Terms of application", TERMS], ["Declaration", DECL], ["Special Conditions", SPECIAL]] as [string, string[]][]) {
    doc.newPage();
    doc.text(t, { size: 14, bold: true, gap: 8 });
    doc.numbered(arr, o.company);
  }
  doc.footer();
  return await doc.pdf.save();
}
