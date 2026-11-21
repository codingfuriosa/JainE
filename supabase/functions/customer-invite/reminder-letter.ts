// THE REMINDER LETTER, BUILT ON THE SERVER (20 Nov 2026) - for scheduled reminders, which go out with no browser
// open. The same letter, line for line, as the Reminders page draws (src/core/24c-post-sales-reminders.js,
// prmLetterData + prmLetterPdf): company block from Post Sales > Setup, the customer from Farvision's contacts, the
// outstanding table rebuilt from the demands and the receipts allocated to them, and - where that does not come to
// Farvision's Bill Outstanding - one line with Farvision's own figure. Total = Farvision's Net Outstanding.

import { PDFDocument, StandardFonts, rgb } from "https://esm.sh/pdf-lib@1.17.1";

const head = (h: unknown) => String(h || "").replace(/\s+at\s+(ADJUSTABLE|DEPOSIT|ACTUAL)\s+at\s*/ig, " ").replace(/[_ ]+\d+\s*$/, "").replace(/\s+/g, " ").trim();
const money = (n: unknown) => (Math.round((Number(n) || 0) * 100) / 100).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const dmy = (d: unknown) => { if (!d) return ""; const p = String(d).slice(0, 10).split("-"); return p[2] + "/" + p[1] + "/" + p[0]; };
const todayIst = () => new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10);
function words(n0: number): string {
  let n = Math.round(Number(n0) || 0); if (!n) return "Zero";
  const a = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
  const b = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];
  const two = (x: number) => x < 20 ? a[x] : (b[Math.floor(x / 10)] + (x % 10 ? " " + a[x % 10] : ""));
  const three = (x: number) => (x >= 100 ? a[Math.floor(x / 100)] + " Hundred" + (x % 100 ? " " : "") : "") + (x % 100 ? two(x % 100) : "");
  const cr = Math.floor(n / 1e7); n %= 1e7; const lk = Math.floor(n / 1e5); n %= 1e5; const th = Math.floor(n / 1e3); n %= 1e3;
  return [cr ? (cr > 99 ? words(cr) : two(cr)) + " Crore" : "", lk ? two(lk) + " Lakh" : "", th ? two(th) + " Thousand" : "", n ? three(n) : ""].filter(Boolean).join(" ");
}

export async function letterData(db: any, bookingNo: string) {
  const C = db.schema("cust");
  const { data: u } = await C.from("units").select("id,project_id,tower,unit_code,application_no").eq("booking_no", bookingNo).is("deleted_at", null).order("id", { ascending: false }).limit(1).maybeSingle();
  if (!u) throw new Error("This booking is not in the Customer Portal data");
  const [ct, pj, su, inv, rc, os, ob, pans] = await Promise.all([
    C.from("farvision_contacts").select("contact_name,contact_phone,contact_email,contact_address").eq("unit_id", u.id).eq("is_current", true).is("deleted_at", null).order("id", { ascending: false }).limit(1).maybeSingle(),
    C.from("projects").select("name").eq("id", u.project_id).maybeSingle(),
    db.schema("postsales").from("project_setup").select("company_name,company_address,company_pan,company_gstin").eq("project_id", u.project_id).maybeSingle(),
    C.from("invoices").select("document_no,document_date,due_date,status,invoice_items(schedule,revenue_head,net_amount,sort_order)").eq("unit_id", u.id).eq("is_current", true).is("deleted_at", null),
    C.from("money_receipts").select("is_reversed,receipt_items(against_demand_no,schedule,revenue_head,amount)").eq("unit_id", u.id).eq("is_current", true).is("deleted_at", null),
    C.from("outstanding_snapshot").select("net_outstanding,bill_outstanding,on_account,late_fee_accrued,as_on_date").eq("unit_id", u.id).eq("is_current", true).is("deleted_at", null).maybeSingle(),
    C.from("import_batches").select("raw_rows").eq("import_type", "outstanding").eq("status", "completed").order("imported_at", { ascending: false }).limit(1).maybeSingle(),
    db.schema("acc").from("booking_audits").select("pan:result->fields->customer_pan->>value,flat:result->fields->flat->>value,name:result->fields->customer_name->>value")]);
  const key = (doc: unknown, sch: unknown, h: unknown) => (doc || "") + "|" + String(sch || "").replace(/\s+/g, " ").trim().toUpperCase() + "|" + head(h).toUpperCase();
  const got: Record<string, number> = {};
  ((rc.data) || []).filter((r: any) => !r.is_reversed).forEach((r: any) => (r.receipt_items || []).forEach((i: any) => {
    const k = key(i.against_demand_no, i.schedule, i.revenue_head); got[k] = (got[k] || 0) + Number(i.amount || 0); }));
  const today = new Date(todayIst() + "T00:00:00Z");
  const lines: any[] = [], seen: Record<string, any> = {};
  ((inv.data) || []).filter((i: any) => i.status !== "Cancel").sort((a: any, b: any) => String(a.document_date).localeCompare(String(b.document_date))).forEach((i: any) => {
    const items = (i.invoice_items || []).sort((a: any, b: any) => (a.sort_order || 0) - (b.sort_order || 0));
    const sched = [...new Set(items.map((x: any) => String(x.schedule || "").trim()))];
    items.forEach((it: any) => {
      const h = head(it.revenue_head), k = key(i.document_no, it.schedule, it.revenue_head);
      if (seen[k]) { seen[k].bill += Number(it.net_amount || 0); return; }
      const due = i.due_date || i.document_date;
      seen[k] = { particulars: String(it.schedule || "").trim() + "." + h, bill_no: i.document_no, bill_date: i.document_date, due_date: due,
        days: due ? Math.max(0, Math.round((today.getTime() - new Date(due + "T00:00:00Z").getTime()) / 864e5)) : "", bill: Number(it.net_amount || 0), k,
        ord: sched.indexOf(String(it.schedule || "").trim()) };
      lines.push(seen[k]);
    });
  });
  lines.forEach((l) => { l.rec = Math.min(l.bill, got[l.k] || 0); l.bal = Math.round((l.bill - l.rec) * 100) / 100; });
  const byAge = (a: any, b: any) => String(a.bill_date).localeCompare(String(b.bill_date)) || String(a.bill_no).localeCompare(String(b.bill_no)) || (a.ord - b.ord) || a.particulars.localeCompare(b.particulars);
  let loose = Object.keys(got).filter((k) => k.split("|")[0] === "").reduce((a, k) => a + got[k], 0);
  lines.slice().sort(byAge).forEach((l) => { if (loose <= 0 || l.bal <= 0) return; const t = Math.min(loose, l.bal); l.rec += t; l.bal = Math.round((l.bal - t) * 100) / 100; loose -= t; });
  let due = lines.filter((l) => l.bal > 0.5).sort(byAge);
  const snap: any = os.data || null, billOs = snap && snap.bill_outstanding != null ? Number(snap.bill_outstanding) : null;
  const summary = billOs != null && Math.abs(due.reduce((a, l) => a + l.bal, 0) - billOs) > 1;
  if (summary) due = billOs! > 0.5 ? [{ particulars: "Total outstanding as per our records as on " + dmy(snap.as_on_date), bill_no: "", bill_date: "", due_date: "", days: "", bill: billOs, rec: 0, bal: billOs }] : [];
  const c: any = ct.data || {}, nm = String(c.contact_name || "").trim();
  const first = nm.replace(/^(mr|mrs|ms|dr|miss)\.?\s+/i, "").split(/\s+/)[0].toUpperCase();
  const pan = ((pans.data) || []).filter((x: any) => x.pan && /^[A-Z]{5}[0-9]{4}[A-Z]$/i.test(String(x.pan).trim()))
    .find((p: any) => String(p.flat || "").trim().toUpperCase() === String(u.unit_code || "").toUpperCase() && String(p.name || "").toUpperCase().indexOf(first) !== -1);
  const fvRow = ((ob.data?.raw_rows) || []).find((r: any) => r && r.bookingNo === bookingNo) || {};
  const flr = String(u.unit_code || "").match(/^(\d+)/), cat = String(u.unit_code || "").replace(/^\d+[-\d]*/, "");
  const onacc = snap ? Math.max(0, Number(snap.on_account || 0)) : 0;
  return { booking_no: bookingNo, unit: u, project: (pj.data || {}).name || "", setup: su.data || {}, contact: c, name: nm,
    pan: pan ? String(pan.pan).toUpperCase() : String(fvRow.pan || "").trim().toUpperCase(), floor: flr ? flr[1] : "", category: cat, lines: due, summary,
    onacc, total: due.reduce((a, l) => a + l.bal, 0) - onacc, net: snap ? Number(snap.net_outstanding || 0) : null,
    late: snap ? Number(snap.late_fee_accrued || 0) : 0, ref: "JRM/" + u.id + "/" + todayIst().replace(/-/g, "") };
}

export async function letterPdf(d: any): Promise<Uint8Array> {
  const doc = await PDFDocument.create(); doc.setTitle("Reminder Letter " + d.booking_no);
  const reg = await doc.embedFont(StandardFonts.Helvetica), bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const W = 612, H = 864, M = 36, INK = rgb(0, 0, 0), GREY = rgb(.93, .93, .93);
  const clean = (t: unknown) => String(t == null ? "" : t).replace(/₹/g, "Rs.").replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, "-").replace(/[^ -ÿ]/g, "").trim();
  const wrap = (t: unknown, w: number, f: any, s: number) => { const out: string[] = []; let ln = ""; clean(t).split(/\s+/).filter(Boolean).forEach((wd) => { const x = ln ? ln + " " + wd : wd; if (f.widthOfTextAtSize(x, s) > w && ln) { out.push(ln); ln = wd; } else ln = x; }); if (ln) out.push(ln); return out.length ? out : [""]; };
  let pg = doc.addPage([W, H]), y = H - M;
  const txt = (t: unknown, x: number, yy: number, o: any = {}) => { const f = o.bold ? bold : reg, s = o.size || 8, c = clean(t); const tw = f.widthOfTextAtSize(c, s);
    pg.drawText(c, { x: o.align === "center" ? (W - tw) / 2 : o.align === "right" ? x - tw : x, y: yy, size: s, font: f, color: INK }); };
  const st = d.setup || {}, today = dmy(todayIst());
  txt(String(st.company_name || "THE JAIN GROUP").toUpperCase(), 0, y - 12, { bold: true, size: 12, align: "center" }); y -= 24;
  wrap(String(st.company_address || "").replace(/\n/g, ", "), W - 2 * M, reg, 8).forEach((l) => { txt(l, 0, y - 8, { align: "center" }); y -= 11; });
  y -= 6; if (st.company_gstin) { txt("GSTIN", M, y - 8); txt(": " + st.company_gstin, M + 80, y - 8); y -= 14; }
  if (st.company_pan) { txt("PAN", M, y - 8); txt(": " + st.company_pan, M + 80, y - 8); y -= 14; }
  y -= 6; txt("Reminder Letter", 0, y - 10, { bold: true, size: 10, align: "center" }); txt("Date :  " + today, W - M, y - 20, { align: "right" }); y -= 36;
  const c = d.contact || {}, half = 310;
  const addr = String(c.contact_address || "").split(/\s*,\s*/).reduce((a: string[], p: string) => { const t = p.replace(/\s+/g, " ").trim(); if (t && (!a.length || a[a.length - 1].toUpperCase() !== t.toUpperCase())) a.push(t); return a; }, [])
    .join(", ").replace(/\s*\b(\d{6})\s*$/, " PIN:$1");
  const left: any[] = [[d.name, "", true]].concat(wrap(addr, half - M - 20, reg, 8).map((l) => [l, ""]))
    .concat([["", ""], ["Contact No", ": " + (c.contact_phone || "")], ["Email", ": " + String(c.contact_email || "").toUpperCase()], ["GSTIN", ": UnRegistered"], ["PAN", ": " + (d.pan || "-")]]);
  const right = [["Reminder No", ": " + d.ref], ["Reminder Date", ": " + today], ["Project", ": " + d.project], ["Floor", ": " + d.floor],
    ["Category", ": " + d.category], ["Unit No", ": " + (d.unit.unit_code || "")], ["Tower", ": " + (d.unit.tower || "")], ["Booking No.", ": " + d.booking_no], ["Application No.", ": " + (d.unit.application_no || "")]];
  const top = y;
  left.forEach((r, i) => { const yy = top - 8 - i * 12.5; if (r[1] === "" || r[2]) txt(r[0], M, yy, { bold: !!r[2] }); else { txt(r[0], M, yy); txt(r[1], M + 64, yy); } });
  right.forEach((r, i) => { const yy = top - 8 - i * 12.5; txt(r[0], half + 37, yy); txt(r[1], half + 110, yy); });
  y = top - 12.5 * Math.max(left.length, right.length) - 14;
  txt("Dear Sir/Madam,", M, y - 8); y -= 20;
  wrap("According to which you had to deposit your due payment against the total value of your Unit. But after repeated Demand / reminder, you have not made payments. Now the company is providing you an opportunity to pay your dues, mentioned as under:", W - 2 * M, reg, 8)
    .forEach((l) => { txt(l, M, y - 8); y -= 11; });
  y -= 10; txt("Outstanding details :", M + 4, y - 10, { bold: true, size: 9.5 }); y -= 22;
  const cw = [126, 82, 48, 48, 32, 68, 68, 68], ttl = ["Particulars", "Bill No.", "Bill Date", "Due Date", "Due Days", "Bill Amt.", "Rec Amt.", "Bal Amt."], rgt = [0, 0, 0, 0, 1, 1, 1, 1];
  const row = (cells: unknown[], o: any = {}): void => { const f = o.bold ? bold : reg, s = 7.6, pad = 3, lh = s + 2.6;
    const laid = cells.map((t, i) => (rgt[i] && !o.head) ? [clean(t)] : wrap(t, cw[i] - 2 * pad, f, s)); const h = Math.max(...laid.map((x) => x.length)) * lh + 2 * pad;
    if (y - h < M + 30) { pg = doc.addPage([W, H]); y = H - M; if (!o.head) row(ttl, { bold: true, fill: GREY, head: true }); }
    let x = M; laid.forEach((ls, i) => { if (o.fill) pg.drawRectangle({ x, y: y - h, width: cw[i], height: h, color: o.fill });
      pg.drawRectangle({ x, y: y - h, width: cw[i], height: h, borderColor: INK, borderWidth: .5 });
      ls.forEach((ln, jj) => { let ss = s, tw = f.widthOfTextAtSize(ln, s); const room = cw[i] - 2 * pad; if (tw > room) { ss = s * room / tw; tw = room; }
        pg.drawText(ln, { x: rgt[i] ? x + cw[i] - pad - tw : x + pad, y: y - pad - s - jj * lh + 1.5, size: ss, font: f, color: INK }); });
      x += cw[i]; }); y -= h; };
  row(ttl, { bold: true, fill: GREY, head: true });
  d.lines.forEach((l: any) => row([l.particulars, l.bill_no, dmy(l.bill_date), dmy(l.due_date), String(l.days), money(l.bill), money(l.rec), money(l.bal)]));
  const sb = d.lines.reduce((a: number, l: any) => a + l.bill, 0), sr = d.lines.reduce((a: number, l: any) => a + l.rec, 0);
  row(["Sub Total :", "", "", "", "", money(sb), money(sr), money(d.lines.reduce((a: number, l: any) => a + l.bal, 0))], { bold: true, fill: GREY });
  if (d.onacc > 0.5) row(["Less : Amount received on account (not yet adjusted)", "", "", "", "", "", "", "-" + money(d.onacc)], { bold: true });
  y -= 12; wrap("Total Payable : Rupees " + words(d.total) + " Only", W - 2 * M - 80, bold, 8.5).forEach((l, i, a) => { txt(l, M + 4, y - 9, { bold: true, size: 8.5 }); if (i === a.length - 1) txt(money(d.total), W - M, y - 9, { bold: true, size: 8.5, align: "right" }); y -= 12; });
  y -= 14; if (y < M + 90) { pg = doc.addPage([W, H]); y = H - M; }
  txt("Late Payment Fees Summary as on " + today, M, y - 10, { bold: true, size: 9 }); y -= 20;
  const lw = [120, 105, 105, 105, 105], lt = ["", "Late Payment Fee Accrued", "Late Payment Fee Waived", "Late Payment Fee Paid", "Late Payment Fee Outstanding"];
  const lrow = (cells: string[], b: boolean) => { const f = b ? bold : reg, s = 7.4, ls2 = cells.map((t, i) => wrap(t, lw[i] - 8, f, s)), h = Math.max(...ls2.map((l) => l.length)) * (s + 2.4) + 7;
    let x = M; ls2.forEach((ls, i) => { pg.drawRectangle({ x, y: y - h, width: lw[i], height: h, borderColor: INK, borderWidth: .5, color: b ? GREY : undefined });
      ls.forEach((ln, jj) => { const tw = f.widthOfTextAtSize(ln, s); pg.drawText(ln, { x: i ? x + lw[i] - 4 - tw : x + 4, y: y - 4 - s - jj * (s + 2.4) + 1.5, size: s, font: f, color: INK }); }); x += lw[i]; }); y -= h; };
  lrow(lt, true); lrow(["Sub Total :-", money(d.late), "-", "-", money(d.late)], false);
  y -= 22; txt("Please ignore this letter if the payment has already been made.", M, y - 8); y -= 24;
  txt("For " + String(st.company_name || "The Jain Group"), M, y - 8, { bold: true }); y -= 40; txt("Authorised Signatory", M, y - 8, { bold: true });
  const pages = doc.getPages(); pages.forEach((p, i) => { const t = "Page " + (i + 1) + " of " + pages.length; p.drawText(t, { x: (W - reg.widthOfTextAtSize(t, 6.5)) / 2, y: 22, size: 6.5, font: reg, color: INK });
    p.drawText("This is a system generated letter. No signature required.", { x: M, y: 22, size: 6.5, font: reg, color: rgb(.4, .4, .4) }); });
  return await doc.save();
}
export function b64(bytes: Uint8Array) { let s = ""; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000)); return btoa(s); }
