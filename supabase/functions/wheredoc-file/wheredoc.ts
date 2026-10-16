// The Wheredoc side of bill filing, kept apart from Supabase so it can be run on its own against a
// copy of Wheredoc (tools/wheredoc-bridge-test). Speaks to the two calls Wheredoc's JainE bridge
// offers (app/controllers/api/jaine_controller.rb in the Wheredoc repo):
//   GET  /api/jaine/options?email=   bill types, sites, box files, departments
//   POST /api/jaine/bills            originate + attach + file, multipart
// Wheredoc answers JSON {ok:true,...} or {ok:false,error}; anything else (an HTML error page, a
// timeout) is reported as such, never taken for success.

export type WdConfig = { url: string; token: string };
export type WdFile = { name: string; type: string; bytes: Uint8Array };
export type WdBill = {
  jaine_id: number; email: string; doctype: string; site_id: number; party_name: string;
  bill_no: string; bill_date: string; bill_amount: string; credit_period?: string | number;
  gst_invoice?: boolean | null; bill_remarks?: string | null; approval_from_email?: string | null;
  folder_serial?: number | null;
  new_folder?: { department: string; desc1: string; desc2?: string; desc3?: string; fileno?: string; period?: string; location?: string } | null;
};

// Wheredoc keeps each file to 10 MB (Paperclip validation on bills and attachments).
export const WD_MAX_FILE = 10 * 1024 * 1024;

async function call(cfg: WdConfig, path: string, init: RequestInit, timeoutMs: number) {
  if (!cfg.url || !cfg.token) throw new Error("Wheredoc is not connected yet (WHEREDOC_URL / WHEREDOC_API_TOKEN not set).");
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), timeoutMs);
  let r: Response;
  try {
    r = await fetch(cfg.url.replace(/\/+$/, "") + path, {
      ...init, signal: ctl.signal,
      headers: { ...(init.headers || {}), Authorization: "Bearer " + cfg.token, Accept: "application/json" },
    });
  } catch (e) {
    throw new Error((e as Error).name === "AbortError" ? "Wheredoc did not answer in time." : "Could not reach Wheredoc: " + (e as Error).message);
  } finally { clearTimeout(t); }
  const text = await r.text();
  let body: any = null; try { body = JSON.parse(text); } catch { /* not JSON */ }
  if (!body || typeof body !== "object") {
    throw new Error(`Wheredoc answered HTTP ${r.status} without the bridge's reply - is the new Wheredoc deployed? (${text.slice(0, 120).replace(/\s+/g, " ")})`);
  }
  if (!r.ok || body.ok === false) throw new Error(body.error || `Wheredoc answered HTTP ${r.status}`);
  return body;
}

export function wdOptions(cfg: WdConfig, email: string) {
  return call(cfg, "/api/jaine/options?email=" + encodeURIComponent(email), { method: "GET" }, 20000);
}

export function wdFileBill(cfg: WdConfig, bill: WdBill, scan: WdFile, more: WdFile[]) {
  const fd = new FormData();
  const put = (k: string, v: unknown) => { if (v !== undefined && v !== null && String(v) !== "") fd.append(k, String(v)); };
  put("jaine_id", bill.jaine_id); put("email", bill.email); put("doctype", bill.doctype); put("site_id", bill.site_id);
  put("party_name", bill.party_name); put("bill_no", bill.bill_no); put("bill_date", bill.bill_date);
  put("bill_amount", bill.bill_amount); put("credit_period", bill.credit_period);
  if (bill.gst_invoice === true || bill.gst_invoice === false) put("gst_invoice", bill.gst_invoice ? "true" : "false");
  put("bill_remarks", bill.bill_remarks); put("approval_from_email", bill.approval_from_email);
  if (bill.folder_serial) put("folder_serial", bill.folder_serial);
  else if (bill.new_folder) for (const [k, v] of Object.entries(bill.new_folder)) put(`new_folder[${k}]`, v);
  fd.append("scan", new Blob([scan.bytes], { type: scan.type || "application/octet-stream" }), scan.name);
  for (const f of more) fd.append("attachments[]", new Blob([f.bytes], { type: f.type || "application/octet-stream" }), f.name);
  // Uploads to Wheredoc's S3 happen inside the call, so give it time.
  return call(cfg, "/api/jaine/bills", { method: "POST", body: fd }, 120000);
}
