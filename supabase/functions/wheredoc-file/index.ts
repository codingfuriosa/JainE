// wheredoc-file - the File button on Invoice Processing's last step ("Bill Filing").
//
//   {action:'options', fcs_id}   the choices for the filing form (bill types, projects, box files),
//                                read live from Wheredoc as the person asking
//   {action:'file', fcs_id, form}
//       1. checks the step: Invoice Processing, its last step, not done yet, and the caller may act on
//          it (acc.wf_may_act_as - the same rule as Done)
//       2. originates the bill in Wheredoc with the JainE Id as its DocId, uploads the instance's
//          files (the first is the bill itself, the rest go on as attachments) and files it in the
//          chosen box file - see wheredoc.ts
//       3. records it in acc.wheredoc_filings, then completes the step with acc.wf_done AS THE
//          CALLER, exactly as their own Done would
//   A retry after a failure part way never files twice: Wheredoc answers "already" for a bill it
//   has (keyed on the JainE Id), and a recorded filing skips straight to completing the step.
//
// Secrets: WHEREDOC_URL (e.g. https://tracemydoc.herokuapp.com) and WHEREDOC_API_TOKEN (the same
// value as JAINE_API_TOKEN on Wheredoc's Heroku). Until both are set, the form says Wheredoc is not
// connected and nothing is filed. Files are read from JainE's S3 (S3_BUCKET, S3_REGION, AWS keys).
import { AwsClient } from "https://esm.sh/aws4fetch@1.0.20";
import { wdOptions, wdFileBill, WD_MAX_FILE, type WdFile } from "./wheredoc.ts";

const SB = Deno.env.get("SUPABASE_URL")!, SRV = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
const WD = { url: Deno.env.get("WHEREDOC_URL") || "", token: Deno.env.get("WHEREDOC_API_TOKEN") || "" };
const INVOICE_FLOW = 26;
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const j = (o: unknown, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { ...cors, "Content-Type": "application/json" } });
const svc = { apikey: SRV, Authorization: "Bearer " + SRV, "Content-Type": "application/json", "Accept-Profile": "acc", "Content-Profile": "acc" };

async function rest(path: string, init: RequestInit = {}) {
  const r = await fetch(`${SB}/rest/v1/${path}`, { ...init, headers: { ...svc, ...(init.headers || {}) } });
  const t = await r.text(); let b: any = null; try { b = t ? JSON.parse(t) : null; } catch { b = t; }
  if (!r.ok) throw new Error((b && (b.message || b.error)) || `HTTP ${r.status}`);
  return b;
}
const label = (s: unknown) => String(s ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
const field = (td: any[], name: string) => (td.find((d) => label(d?.label) === label(name)) || {}).value ?? "";
const s3Paths = (v: unknown) => String(v ?? "").split(/[|,;]/).map((x) => x.trim()).filter((x) => x.startsWith("s3:"));
const fileName = (p: string) => p.split("/").pop()!.replace(/^\d+_[a-z0-9]+_/i, "");
function mimeOf(name: string) {
  const e = (name.split(".").pop() || "").toLowerCase();
  return ({ pdf: "application/pdf", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", gif: "image/gif",
    xls: "application/vnd.ms-excel", xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    doc: "application/msword", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" } as Record<string, string>)[e] || "application/octet-stream";
}

// The step, its instance, and whether the caller may act on it - the checks Done makes.
async function loadStep(fcsId: number, email: string, bearer: string) {
  const s = (await rest(`flow_case_steps?id=eq.${fcsId}&select=id,case_id,seq,status,person,received_at`))?.[0];
  if (!s) throw new Error("Step not found.");
  const c = (await rest(`flow_cases?id=eq.${s.case_id}&select=id,flow_id,jaine_id,status,trigger_details`))?.[0];
  if (!c || c.flow_id !== INVOICE_FLOW) throw new Error("Filing in Wheredoc is only for Invoice Processing.");
  const later = await rest(`flow_case_steps?case_id=eq.${s.case_id}&seq=gt.${s.seq}&select=id&limit=1`);
  if (later?.length) throw new Error("Only the last step (Bill Filing) files the bill.");
  if (s.status === "done" || c.status === "Done") throw new Error("This bill's filing step is already done.");
  // run as the caller: the check is granted to signed-in users, not to the service key
  const mr = await fetch(`${SB}/rest/v1/rpc/wf_may_act_as`, { method: "POST",
    headers: { apikey: ANON, Authorization: bearer, "Content-Type": "application/json", "Content-Profile": "acc" },
    body: JSON.stringify({ p_person: s.person, p_email: email, p_flow: c.flow_id }) });
  const may = mr.ok ? await mr.json() : null;
  if (may !== true) throw new Error("This step is not yours to file.");
  if (!c.jaine_id) throw new Error("This instance has no JainE Id.");
  return { s, c };
}

async function readFiles(td: any[]): Promise<WdFile[]> {
  const paths: string[] = []; for (const d of td) for (const p of s3Paths(d?.value)) if (!paths.includes(p)) paths.push(p);
  if (!paths.length) throw new Error("This instance has no bill file to file.");
  const bucket = Deno.env.get("S3_BUCKET"), region = Deno.env.get("S3_REGION");
  const aws = new AwsClient({ accessKeyId: Deno.env.get("AWS_ACCESS_KEY_ID")!, secretAccessKey: Deno.env.get("AWS_SECRET_ACCESS_KEY")!, region: region!, service: "s3" });
  const out: WdFile[] = [];
  for (const p of paths) {
    const url = `https://${bucket}.s3.${region}.amazonaws.com/${p.replace(/^s3:/, "").split("/").map(encodeURIComponent).join("/")}`;
    const r = await aws.fetch(url);
    if (!r.ok) throw new Error(`Could not read ${fileName(p)} from storage (HTTP ${r.status}).`);
    const bytes = new Uint8Array(await r.arrayBuffer());
    if (bytes.length > WD_MAX_FILE) throw new Error(`${fileName(p)} is ${(bytes.length / 1048576).toFixed(1)} MB; Wheredoc takes files up to 10 MB.`);
    const name = fileName(p); out.push({ name, type: mimeOf(name), bytes });
  }
  return out;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return j({ error: "method not allowed" }, 405);
  // who is asking - their own sign-in
  const bearer = req.headers.get("Authorization") || "";
  const who = await fetch(`${SB}/auth/v1/user`, { headers: { apikey: ANON, Authorization: bearer } });
  if (!who.ok) return j({ error: "Please sign in again." }, 401);
  const email = String((await who.json()).email || "").toLowerCase();
  let body: any = {}; try { body = await req.json(); } catch { /* empty */ }
  const fcsId = Number(body.fcs_id || 0);
  if (!fcsId) return j({ error: "fcs_id is required" }, 400);

  try {
    const { s, c } = await loadStep(fcsId, email, bearer);
    const td: any[] = Array.isArray(c.trigger_details) ? c.trigger_details : [];

    if (body.action === "options") {
      const opts = await wdOptions(WD, email);
      const filed = (await rest(`wheredoc_filings?case_id=eq.${c.id}&select=docid,folder_serial,filed_at`))?.[0] || null;
      return j({ ok: true, ...opts, filed, jaine_id: c.jaine_id,
        bill: { bill_no: field(td, "Bill No."), bill_date: field(td, "Bill Date"), vendor: field(td, "Vendor"), amount: field(td, "Amount"),
                files: td.flatMap((d) => s3Paths(d?.value)).map(fileName) } });
    }

    if (body.action !== "file") return j({ error: "unknown action" }, 400);
    const f = body.form || {};
    let rec = (await rest(`wheredoc_filings?case_id=eq.${c.id}&select=*`))?.[0];
    if (!rec) {
      const files = await readFiles(td);
      const bill = {
        jaine_id: Number(c.jaine_id), email,
        doctype: String(f.doctype || ""), site_id: Number(f.site_id || 0),
        party_name: String(f.party_name ?? field(td, "Vendor")).trim(),
        bill_no: String(f.bill_no ?? field(td, "Bill No.")).trim(),
        bill_date: String(f.bill_date ?? field(td, "Bill Date")).trim(),
        bill_amount: String(f.bill_amount ?? field(td, "Amount")).replace(/,/g, "").trim(),
        credit_period: f.credit_period ?? 15,
        gst_invoice: f.gst_invoice === true ? true : f.gst_invoice === false ? false : null,
        bill_remarks: f.bill_remarks || null,
        folder_serial: f.folder_serial ? Number(f.folder_serial) : null,
        new_folder: f.folder_serial ? null : (f.new_folder || null),
      };
      const res = await wdFileBill(WD, bill, files[0], files.slice(1));
      const row = { case_id: c.id, jaine_id: c.jaine_id, docid: res.docid, wheredoc_origin_id: res.origin_id, folder_serial: res.folder_serial,
        doctype: bill.doctype, site_name: f.site_name || null, party_name: bill.party_name, files: files.length, filed_by: email, response: res };
      await rest("wheredoc_filings?on_conflict=case_id", { method: "POST", headers: { Prefer: "resolution=merge-duplicates" }, body: JSON.stringify(row) });
      rec = row;
    }
    // complete the step as the caller - the same call their Done makes
    const done = await fetch(`${SB}/rest/v1/rpc/wf_done`, { method: "POST",
      headers: { apikey: ANON, Authorization: bearer, "Content-Type": "application/json", "Content-Profile": "acc" },
      body: JSON.stringify({ p_fcs_id: s.id }) });
    if (!done.ok) {
      const t = await done.text();
      return j({ ok: false, filed: true, docid: rec.docid, error: "Filed in Wheredoc, but the step could not be completed: " + t.slice(0, 200) }, 200);
    }
    return j({ ok: true, docid: rec.docid, folder_serial: rec.folder_serial });
  } catch (e) {
    return j({ ok: false, error: String((e as Error).message || e) }, 200);
  }
});
