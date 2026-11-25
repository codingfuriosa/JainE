// WHATSAPP TEMPLATES - DELIVERIES (17 Nov 2026). Reads Meta's WhatsApp Business Management API with the saved key
// META_WHATSAPP_TOKEN into camp.wa_* (tables: supabase/migrations/20261117205500_wa_deliveries.sql).
//
// WHO CALLS IT: the cron 'wa-deliveries-daily' (06:15 IST) with x-sync-secret = acc.job_secrets 'wa_deliveries'.
//   body.mode 'daily' (default): templates + the last 10 days of analytics.
//   body.mode 'backfill': analytics from 1 Jan of this year (Meta only has them from the day insights were on).
//
// WHICH WHATSAPP ACCOUNTS: every WhatsApp Business Account the key can see - owned or shared with the businesses the
// key reaches (its own, the Pages' business, the ad accounts' business), plus any id saved in the secret
// WA_WABA_IDS (comma separated). On 17 Nov 2026 the key saw NONE: the drip number's account has to be assigned to
// the JAIN-E Sync system user in Business Settings first.
//
// READ ONLY. It never sends a message and never changes a setting at Meta. Template analytics must be switched on
// for an account (Meta: is_enabled_for_insights) - if Meta says they are off, the run records that and the page
// says so; switching them on is a separate, deliberate step.
import { createClient } from "jsr:@supabase/supabase-js@2";

const G = "https://graph.facebook.com/v25.0";
const j = (o: unknown, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { "Content-Type": "application/json" } });
async function gget(url: string) {
  const r = await fetch(url); const b: any = await r.json().catch(() => ({}));
  if (b?.error) return { err: String(b.error.message || "graph error"), code: b.error.code };
  return b;
}
async function gall(url: string, max = 20) {
  const out: any[] = []; let next: string | null = url;
  for (let i = 0; i < max && next; i++) { const b: any = await gget(next); if (b.err) return { err: b.err, data: out }; (b.data || []).forEach((x: any) => out.push(x)); next = b.paging?.next || null; }
  return { data: out };
}
const day = (t: number) => new Date(t * 1000).toISOString().slice(0, 10);   // Meta's day = a UTC day (its start, 00:00 UTC)

Deno.serve(async (req) => {
  if (req.method !== "POST") return j({ error: "method not allowed" }, 405);
  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const camp = db.schema("camp");
  const { data: sec } = await db.schema("acc").from("job_secrets").select("value").eq("name", "wa_deliveries").maybeSingle();
  if (!sec?.value || req.headers.get("x-sync-secret") !== sec.value) return j({ error: "unauthorized" }, 401);
  const body: any = await req.json().catch(() => ({}));
  const backfill = body.mode === "backfill";
  const rep: any = { mode: backfill ? "backfill" : "daily", accounts: 0, templates: 0, days: 0, errors: [] as string[], notes: [] as string[] };
  const setState = (o: any) => camp.from("wa_sync_state").upsert({ id: 1, ...o });

  // META_WA_TOKEN = the key of RJ's ADMIN system user ("Ayush Ruia") made through the app "JainE Wa2", with only
  // whatsapp_business_management + business_management (17 Nov 2026). Employee system users (JAIN-E Sync) did NOT see the
  // WhatsApp accounts even when assigned to them.
  const T = Deno.env.get("META_WA_TOKEN") || Deno.env.get("META_WHATSAPP_TOKEN");
  if (!T) { await setState({ last_error: "META_WA_TOKEN is not saved", last_error_at: new Date().toISOString() }); return j({ error: "no key" }, 500); }
  const tk = "access_token=" + encodeURIComponent(T);

  // body.probe (25 Nov 2026, Ayush: "how many Replies were given can be extracted?? Try again"): READ-ONLY look at what
  // Meta gives about replies for one account - template_analytics with each candidate metric, the account's webhook
  // subscriptions and its phone numbers. Writes nothing.
  // body.subscribe (25 Nov 2026, Ayush set up the "JainE Wa2" webhook -> wa-replies and said "Done"): connect this key's app
  // to every WhatsApp account in camp.wa_accounts (POST /{waba}/subscribed_apps), so Meta sends their customers' messages
  // to wa-replies. The ONLY write this function makes at Meta; it changes nothing else and sends no message.
  if (body.subscribe) {
    const { data: accs } = await camp.from("wa_accounts").select("id,name");
    const out: any[] = [];
    for (const a of accs || []) {
      const r = await fetch(G + "/" + a.id + "/subscribed_apps?" + tk, { method: "POST" }); const b: any = await r.json().catch(() => ({}));
      const chk: any = await gget(G + "/" + a.id + "/subscribed_apps?" + tk);
      out.push({ name: a.name, ok: !!b.success, error: b.error ? String(b.error.message || "") : null, apps: (chk.data || []).map((x: any) => x.whatsapp_business_api_data?.name || x.whatsapp_business_api_data?.id) });
    }
    return j({ subscribed: out });
  }
  if (body.probe) {
    const wid = String(body.probe.waba || ""); const out: any = { waba: wid };
    const tl: any = await gall(G + "/" + wid + "/message_templates?fields=id,name&limit=50&" + tk, 2);
    const ids = (tl.data || []).slice(0, 10).map((t: any) => t.id); out.templates = (tl.data || []).length;
    const e = Math.floor(Date.now() / 86400000) * 86400, s = e - 7 * 86400;
    for (const m of (body.probe.metrics || ["SENT,DELIVERED,READ,CLICKED,REPLIED", "REPLIED", "REPLY", "REPLIES"])) {
      const r: any = await gget(G + "/" + wid + "/template_analytics?start=" + s + "&end=" + e + "&granularity=DAILY&metric_types=" + m + "&template_ids=" + encodeURIComponent(JSON.stringify(ids)) + "&" + tk);
      out["metric " + m] = r.err ? { err: r.err } : { sample: JSON.stringify(r).slice(0, 1500) };
    }
    out.subscribed_apps = await gget(G + "/" + wid + "/subscribed_apps?" + tk);
    out.phones = await gget(G + "/" + wid + "/phone_numbers?fields=id,display_phone_number,verified_name&" + tk);
    for (const f of ["conversation_analytics.start(" + s + ").end(" + e + ").granularity(DAILY).dimensions([\"CONVERSATION_DIRECTION\",\"CONVERSATION_TYPE\"])",
                     "pricing_analytics.start(" + s + ").end(" + e + ").granularity(DAILY).dimensions([\"PRICING_CATEGORY\",\"PRICING_TYPE\"])"]) {
      const r: any = await gget(G + "/" + wid + "?fields=" + encodeURIComponent(f) + "&" + tk);
      out[f.split(".")[0]] = r.err ? { err: r.err } : JSON.stringify(r).slice(0, 2500);
    }
    return j(out);
  }

  let hasReplied: boolean | null = null, hasCost: boolean | null = null;
  // ---- every business the key reaches ----
  const biz = new Map<string, string>();
  const mb: any = await gall(G + "/me/businesses?fields=id,name&" + tk, 3); (mb.data || []).forEach((b: any) => biz.set(b.id, b.name));
  const pg: any = await gall(G + "/me/accounts?fields=business{id,name}&" + tk, 3); (pg.data || []).forEach((p: any) => p.business && biz.set(p.business.id, p.business.name));
  // The Jain Group / RJ owns the WhatsApp accounts (17 Nov 2026); the WhatsApp key (Admin system user, app JainE Wa2)
  // has no Pages or ads, so it cannot find the portfolio by itself.
  if (!biz.has("2741857182713458")) biz.set("2741857182713458", "The Jain Group / RJ");
  const ad: any = await gall(G + "/me/adaccounts?fields=business{id,name}&limit=100&" + tk, 3); (ad.data || []).forEach((a: any) => a.business && biz.set(a.business.id, a.business.name));

  // ---- every WhatsApp Business Account ----
  const wabas = new Map<string, any>(); const edgeErr: string[] = [];
  for (const [bid, bname] of biz) for (const edge of ["owned_whatsapp_business_accounts", "client_whatsapp_business_accounts"]) {
    const r: any = await gall(G + "/" + bid + "/" + edge + "?fields=id,name,timezone_id&" + tk, 3);
    if (r.err) edgeErr.push(bname + " " + edge + ": " + r.err);
    (r.data || []).forEach((w: any) => wabas.set(w.id, { ...w, business_id: bid, business_name: bname }));
  }
  // accounts assigned straight to the key's system user (works with whatsapp_business_management alone - the RJ key
  // of 17 Nov has no business_management, so it cannot list portfolios)
  const meK: any = await gget(G + "/me?fields=id,name&" + tk);
  if (meK.id) for (const q of ["", "&business=2741857182713458", "&business=533656203503535"]) {
    const r: any = await gall(G + "/" + meK.id + "/assigned_whatsapp_business_accounts?fields=id,name,timezone_id" + q + "&" + tk, 3);
    if (r.err) edgeErr.push("assigned" + q + ": " + r.err);
    (r.data || []).forEach((w: any) => { if (!wabas.has(w.id)) wabas.set(w.id, w); });
  }
  // the key's own scopes: a key made BEFORE an account was assigned does not reach it (granular target ids)
  const dbg: any = await gget(G + "/debug_token?input_token=" + encodeURIComponent(T) + "&" + tk);
  const scopes = (dbg?.data?.granular_scopes || []).map((g: any) => ({ scope: g.scope, targets: g.target_ids || "all" }));
  for (const g of dbg?.data?.granular_scopes || []) if (/whatsapp/.test(g.scope)) for (const id of g.target_ids || []) {
    if (wabas.has(id)) continue; const w: any = await gget(G + "/" + id + "?fields=id,name,timezone_id&" + tk);
    if (!w.err) wabas.set(id, w);
  }
  for (const id of String(Deno.env.get("WA_WABA_IDS") || "").split(",").map((s) => s.trim()).filter(Boolean)) {
    if (wabas.has(id)) continue; const w: any = await gget(G + "/" + id + "?fields=id,name,timezone_id&" + tk);
    if (w.err) rep.errors.push("account " + id + ": " + w.err); else wabas.set(id, w);
  }
  // body.list: only SAY which accounts exist and how busy each one is (writes nothing) - used to pick between
  // accounts with the same name (17 Nov 2026, Ayush: "use the one which has more data").
  if (body.list) {
    const y0 = Math.floor(Date.UTC(new Date().getUTCFullYear(), 0, 1) / 1000), y1 = Math.floor(Date.now() / 1000);
    const out: any[] = [];
    for (const [wid, w] of wabas) {
      const ph: any = await gall(G + "/" + wid + "/phone_numbers?fields=display_phone_number,verified_name,quality_rating,status&" + tk, 2);
      const tp: any = await gall(G + "/" + wid + "/message_templates?fields=name,status&limit=200&" + tk, 10);
      const an: any = await gget(G + "/" + wid + "?fields=is_enabled_for_insights,analytics.start(" + y0 + ").end(" + y1 + ").granularity(MONTH)&" + tk);
      const pts = an?.analytics?.data_points || [];
      out.push({ id: wid, name: w.name, business: w.business_name, phones: (ph.data || []).map((p: any) => p.display_phone_number + " " + (p.verified_name || "") + " " + (p.status || "")),
        templates: (tp.data || []).length, approved: (tp.data || []).filter((t: any) => t.status === "APPROVED").length,
        sample: (tp.data || []).slice(0, 6).map((t: any) => t.name), insights: an.err ? an.err : !!an.is_enabled_for_insights,
        sent_this_year: pts.reduce((n: number, p: any) => n + (p.sent || 0), 0), delivered_this_year: pts.reduce((n: number, p: any) => n + (p.delivered || 0), 0) });
    }
    const meU: any = await gget(G + "/me?fields=id,name&" + tk);
    return j({ ok: true, key_user: meU.err ? meU.err : meU.id + " " + meU.name, businesses: [...biz.values()], accounts: out, edge_errors: edgeErr, scopes, key_made: dbg?.data?.issued_at || null });
  }
  if (!wabas.size) {
    const msg = "The key sees no WhatsApp Business Account - assign the drip number's account to the JAIN-E Sync system user";
    await setState({ last_sync_at: new Date().toISOString(), last_result: { ...rep, businesses: biz.size }, last_error: msg, last_error_at: new Date().toISOString() });
    return j({ ok: false, error: msg, businesses: biz.size });
  }

  // SAME NAME, ONE ACCOUNT (17 Nov 2026, Ayush: "some accounts are duplicate named - use the one which has more data").
  // Several RJ accounts share a name (Dream World City x3, Dream Valley, Dream One, Dream Eco City, Dream Diamond, Jain
  // Group x2); only the one that sent the most messages this year is read. Meta's test account is skipped.
  // body.waba = one account id only (the first full read runs one account per call to stay inside the time limit).
  if (body.waba) { for (const wid of [...wabas.keys()]) if (wid !== String(body.waba)) wabas.delete(wid); }   // one named account: no same-name check needed
  else {
    const y0 = Math.floor(Date.UTC(new Date().getUTCFullYear(), 0, 1) / 1000), y1 = Math.floor(Date.now() / 1000);
    const best = new Map<string, { id: string; sent: number }>();
    for (const [wid, w] of wabas) {
      const nm = String(w.name || wid).trim().toLowerCase();
      if (/^test whatsapp business account$/.test(nm)) { wabas.delete(wid); continue; }
      const an: any = await gget(G + "/" + wid + "?fields=analytics.start(" + y0 + ").end(" + y1 + ").granularity(MONTH)&" + tk);
      const sent = (an?.analytics?.data_points || []).reduce((n: number, p: any) => n + (p.sent || 0), 0);
      const b = best.get(nm);
      if (!b || sent > b.sent) { if (b) wabas.delete(b.id); best.set(nm, { id: wid, sent }); } else wabas.delete(wid);
    }
    if (body.waba) for (const wid of [...wabas.keys()]) if (wid !== String(body.waba)) wabas.delete(wid);
    rep.kept = [...wabas.values()].map((w: any) => w.name);
  }

  const now = Math.floor(Date.now() / 1000);
  const jan1 = Math.floor(Date.UTC(new Date().getUTCFullYear(), 0, 1) / 1000) - 19800;
  // Meta keeps template analytics for about the last 90 days only (17 Nov 2026: a start 85+ days back is refused with
  // "Start time must be within the query period of the last 90 days") - the first full read goes 80 days back; history
  // older than that builds up from the nightly reads.
  const from0 = backfill ? Math.max(jan1, now - 80 * 86400) : now - 10 * 86400;
  // Meta's days are UTC days: every range starts at a UTC midnight, so no day is ever split between two reads
  let from = Math.floor(from0 / 86400) * 86400 + 86400;
  // body.start (YYYY-MM-DD) + body.days: only that stretch (the first full read is cut into 2-week pieces per account, as a
  // whole account in one call ran past the 150-second limit)
  let until = Math.floor(Date.now() / 1000);
  if (body.start) { from = Math.max(from, Math.floor(Date.parse(String(body.start) + "T00:00:00Z") / 1000)); until = Math.min(until, from + (Number(body.days) || 14) * 86400); }
  for (const [wid, w] of wabas) {
    rep.accounts++;
    const ph: any = await gall(G + "/" + wid + "/phone_numbers?fields=id,display_phone_number,verified_name,quality_rating,status&" + tk, 2);
    const ins: any = await gget(G + "/" + wid + "?fields=is_enabled_for_insights&" + tk);
    // ---- templates ----
    const tp: any = await gall(G + "/" + wid + "/message_templates?fields=id,name,language,status,category,quality_score,rejected_reason,components&limit=100&" + tk, 20);
    if (tp.err) rep.errors.push((w.name || wid) + " templates: " + tp.err);
    const trows = (tp.data || []).map((t: any) => ({ id: String(t.id), waba_id: wid, name: t.name, language: t.language, status: t.status,
      category: t.category, quality: t.quality_score?.score || null, rejected_reason: t.rejected_reason && t.rejected_reason !== "NONE" ? t.rejected_reason : null,
      components: t.components || null, synced_at: new Date().toISOString() }));
    for (let i = 0; i < trows.length; i += 200) { const { error } = await camp.from("wa_templates").upsert(trows.slice(i, i + 200), { onConflict: "id" }); if (error) rep.errors.push("save templates: " + error.message); }
    rep.templates += trows.length;
    await camp.from("wa_accounts").upsert({ id: wid, name: w.name || null, business_id: w.business_id || null, business_name: w.business_name || null,
      timezone_id: w.timezone_id || null, phones: ph.data || [], insights_enabled: ins.err ? null : !!ins.is_enabled_for_insights, synced_at: new Date().toISOString() }, { onConflict: "id" });

    // ---- per template per day: sent / delivered / read / clicked ----
    // 17 Nov 2026: Meta answers in PAGES - over a 30-day range the first page held only the oldest (mostly empty) days, so a
    // read of one page gave 8 sends where the same week read in full gave 818. Now 7-day ranges, 10 templates a request,
    // and every page followed.
    const ids = trows.map((t: any) => t.id);
    // replied (25 Nov 2026): Meta's count of customers who answered the template with a message; stored once the column exists
    if (hasReplied === null) { const t = await camp.from('wa_template_daily').select('replied').limit(1); hasReplied = !t.error; if (t.error) rep.notes.push('replied column not there yet - not stored'); }
    let refused = "";
    for (let s = from; s < until && !refused; s += 7 * 86400) {
      const e = Math.min(s + 7 * 86400, until);
      for (let i = 0; i < ids.length && !refused; i += 10) {
        let url: string | null = G + "/" + wid + "/template_analytics?start=" + s + "&end=" + e + "&granularity=DAILY&metric_types=SENT,DELIVERED,READ,CLICKED,REPLIED"
          + "&template_ids=" + encodeURIComponent(JSON.stringify(ids.slice(i, i + 10))) + "&" + tk;
        for (let pg = 0; url && pg < 50; pg++) {
          const r: any = await gget(url);
          if (r.err) { refused = r.err; break; }
          const rows: any[] = [];
          for (const blk of r.data || []) for (const p of blk.data_points || []) {
            const clicks = (p.clicked || []) as any[];
            if (!p.sent && !p.delivered && !p.read && !p.replied && !clicks.length) continue;
            rows.push({ template_id: String(p.template_id), day: day(p.start), sent: p.sent || 0, delivered: p.delivered || 0, read: p.read || 0,
              clicked: clicks.reduce((n, c) => n + (c.count || 0), 0), clicks: clicks.length ? clicks : null, synced_at: new Date().toISOString(), ...(hasReplied ? { replied: p.replied || 0 } : {}) });
          }
          if (rows.length) { const { error } = await camp.from("wa_template_daily").upsert(rows, { onConflict: "template_id,day" }); if (error) rep.errors.push("save daily: " + error.message); }
          rep.days += rows.length;
          // Meta's next-page link does not carry a usable key ("Authentication Error", 17 Nov 2026): our key is put back on it
          const nx = r.paging?.next ? String(r.paging.next).replace(/([?&])access_token=[^&]*&?/, "$1").replace(/[?&]$/, "") : null;
          url = nx ? nx + (nx.includes("?") ? "&" : "?") + tk : null;
        }
      }
    }
    if (refused) rep.notes.push((w.name || wid) + ": template analytics not available - " + refused);

    // COST (25 Nov 2026, Ayush: "I want 2" - WhatsApp cost per number per day): Meta's pricing_analytics for the same stretch,
    // per day (the account's own day, IST), category and pricing type - messages charged and what they cost. Stored once
    // camp.wa_cost_daily exists (created 25 Nov 20:03 IST).
    if (hasCost === null) { const t = await camp.from('wa_cost_daily').select('day').limit(1); hasCost = !t.error; if (t.error) rep.notes.push('wa_cost_daily not there yet - cost not stored'); }
    if (hasCost) {
      const f = "pricing_analytics.start(" + from + ").end(" + until + ").granularity(DAILY).dimensions([\"PRICING_CATEGORY\",\"PRICING_TYPE\"])";
      const pa: any = await gget(G + "/" + wid + "?fields=" + encodeURIComponent(f) + "&" + tk);
      if (pa.err) rep.notes.push((w.name || wid) + ": cost not available - " + pa.err);
      else {
        const acc: Record<string, any> = {};
        for (const blk of pa?.pricing_analytics?.data || []) for (const p of blk.data_points || []) {
          const dayIst = new Date((Number(p.start) + 19800) * 1000).toISOString().slice(0, 10);
          const k = dayIst + "|" + (p.pricing_category || "") + "|" + (p.pricing_type || "");
          const o = acc[k] || (acc[k] = { waba_id: wid, day: dayIst, category: p.pricing_category || "", pricing_type: p.pricing_type || "", volume: 0, cost: 0, synced_at: new Date().toISOString() });
          o.volume += Number(p.volume || 0); o.cost += Number(p.cost || 0);
        }
        const rows = Object.values(acc);
        if (rows.length) { const { error } = await camp.from('wa_cost_daily').upsert(rows, { onConflict: 'waba_id,day,category,pricing_type' }); if (error) rep.errors.push('save cost: ' + error.message); }
        rep.costDays = (rep.costDays || 0) + rows.length;
      }
    }
  }
  await setState({ last_sync_at: new Date().toISOString(), last_result: rep,
    last_error: rep.errors.length ? rep.errors.slice(0, 3).join(" | ") : null, last_error_at: rep.errors.length ? new Date().toISOString() : null });
  return j({ ok: true, ...rep });
});
