// Campaign alerts - the daily watchdog for Our Brand's Facebook and Google ads.
//
// REWRITTEN 6 Nov 2026. It used to call Meta and Google live for a hard-coded list of six Meta accounts
// (so Dream World City, the biggest, Sarovar, Ananta and Diamond were never watched), counted only
// "lead" actions (so WhatsApp-chat lead campaigns looked like "spending with no leads"), judged
// yesterday against the day before (Meta and Google keep crediting results for days, so yesterday is
// always low: about one false "cost per result spike" email a day) and called Google's daily budget
// "overshot" at 130% when Google allows 200% on any day.
//
// Now it reads what Our Brand already shows - camp.ads_daily, filled every 15 minutes - for every account
// marked include in camp.ads_accounts, so these alerts and the page can never disagree and no live call
// to Meta or Google is made (the Meta request limit is shared with the sync).
//
//   spend spike     yesterday vs the day before, whole account (spend is final quickly)         critical
//   over budget     a Google campaign spent more than 2.05 x its daily budget yesterday          high
//   dead spend      a campaign spent Rs 3,000+ and got 0 Results/conversions, judged on the day
//                   BEFORE yesterday (results are credited late)                                 critical
//   cost per result a lead campaign set's cost per result on that day is 60%+ above its
//                   previous 7 days and over Rs 500                                              high
//   CTR fall        Google only: click rate down 25%+ against the previous 7 days                medium
// Each alert is a bell notification plus one email; camp.alert_log keeps one per key per day.
// ?dry=1 = detect only (nothing written, nothing sent). Meta ad-frequency "fatigue" was dropped: it
// needed a live Meta call per account and had never fired.
import { SMTPClient } from "https://deno.land/x/denomailer@1.6.0/mod.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, GET, OPTIONS' };
const j = (o: any, s = 200) => new Response(JSON.stringify(o, null, 2), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } });
const esc = (s: any) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const inr = (n: any) => '₹' + Math.round(Number(n) || 0).toLocaleString('en-IN');
const num = (v: any) => { const n = Number(v); return isFinite(n) ? n : 0; };

const SPEND_SPIKE_RATIO = 1.5, SPEND_SPIKE_MIN = 2000;   // >=50% up AND at least +Rs 2000
const CPR_SPIKE_RATIO = 1.6, CPR_SPIKE_MIN = 500;       // cost per result >=60% up AND >= Rs 500
const DEAD_SPEND_MIN = 3000;                            // spent this much with ZERO results
const CTR_DROP = 0.25;                                  // Google click rate down 25%+
const BUDGET_OVERSHOOT = 2.05;                          // Google may spend up to 2x the daily budget on any day
// Meta objectives whose Results are leads or chats - the only ones a "cost per lead" alert makes sense for.
const LEAD_OBJECTIVES = new Set(['OUTCOME_LEADS', 'LEAD_GENERATION', 'OUTCOME_SALES', 'CONVERSIONS', 'MESSAGES']);

const istDate = (offsetDays: number) => { const d = new Date(Date.now() + 5.5 * 3600 * 1000); d.setUTCDate(d.getUTCDate() + offsetDays); return d.toISOString().slice(0, 10); };
const addD = (d: string, n: number) => new Date(Date.parse(d + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10);

type Row = { platform: string; account_id: string; campaign_id: string; day: string; spend: number; impressions: number; clicks: number; results: number };

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  const SB = Deno.env.get('SUPABASE_URL')!, SRV = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const sb = createClient(SB, SRV);
  const camp = sb.schema('camp');
  const dry = new URL(req.url).searchParams.get('dry') === '1';
  const Y = istDate(-1), Y1 = istDate(-2), J = istDate(-2), BASE_FROM = addD(J, -7), BASE_TO = addD(J, -1);
  const alerts: any[] = [];
  const dbg: any = { yesterday: Y, day_before: Y1, judged_day_for_results: J, baseline: BASE_FROM + ' to ' + BASE_TO };

  const { data: accs, error: ae } = await camp.from('ads_accounts').select('platform,account_id,name,project').eq('include', true);
  if (ae) return j({ ...dbg, error: 'accounts: ' + ae.message }, 500);
  const from = addD(J, -8);
  const rows: Row[] = [];
  for (let p = 0; ; p += 1000) {
    const { data, error } = await camp.from('ads_daily').select('platform,account_id,campaign_id,day,spend,impressions,clicks,results').gte('day', from).lte('day', Y).range(p, p + 999);
    if (error) return j({ ...dbg, error: 'ads_daily: ' + error.message }, 500);
    for (const r of data || []) rows.push({ platform: r.platform, account_id: String(r.account_id), campaign_id: String(r.campaign_id), day: r.day, spend: num(r.spend), impressions: num(r.impressions), clicks: num(r.clicks), results: num(r.results) });
    if (!data || data.length < 1000) break;
  }
  const ents: Record<string, any> = {};
  for (let p = 0; ; p += 1000) {
    const { data } = await camp.from('ads_entities').select('platform,id,name,objective,daily_budget').eq('kind', 'campaign').range(p, p + 999);
    for (const e of data || []) ents[e.platform + '|' + e.id] = e;
    if (!data || data.length < 1000) break;
  }
  dbg.rows = rows.length;

  for (const a of accs || []) {
    const mine = rows.filter((r) => r.platform === a.platform && r.account_id === a.account_id);
    if (!mine.length) continue;
    const label = (a.platform === 'meta' ? 'Meta · ' : 'Google · ') + (a.project || a.name);
    const key = (k: string, extra = '') => k + ':' + a.account_id + ':' + extra;
    const sum = (rs: Row[]) => rs.reduce((t, r) => ({ spend: t.spend + r.spend, impr: t.impr + r.impressions, clk: t.clk + r.clicks, res: t.res + r.results }), { spend: 0, impr: 0, clk: 0, res: 0 });
    const on = (d: string) => mine.filter((r) => r.day === d);
    const yS = sum(on(Y)), y1S = sum(on(Y1));

    // spend spike - whole account, yesterday vs the day before
    if (y1S.spend > 0 && yS.spend >= y1S.spend * SPEND_SPIKE_RATIO && (yS.spend - y1S.spend) >= SPEND_SPIKE_MIN)
      alerts.push({ key: key(a.platform === 'meta' ? 'meta_spend_spike' : 'gads_spend_spike', Y), sev: 'critical', title: 'Spend spike — ' + label,
        body: 'Spend jumped to ' + inr(yS.spend) + ' on ' + Y + ' from ' + inr(y1S.spend) + ' the day before (' + Math.round((yS.spend / y1S.spend - 1) * 100) + '% up).' });

    // dead spend - per campaign, on the settled day
    const byCamp: Record<string, Row[]> = {};
    for (const r of mine) (byCamp[r.campaign_id] = byCamp[r.campaign_id] || []).push(r);
    for (const cid of Object.keys(byCamp)) {
      const e = ents[a.platform + '|' + cid] || {};
      const nm = String(e.name || ('Campaign ' + cid));
      const jr = sum(byCamp[cid].filter((r) => r.day === J));
      if (jr.spend >= DEAD_SPEND_MIN && jr.res === 0)
        alerts.push({ key: key(a.platform === 'meta' ? 'meta_dead_spend' : 'gads_dead_spend', cid + ':' + J), sev: 'critical',
          title: 'Spending with no ' + (a.platform === 'meta' ? 'results' : 'conversions') + ' — ' + label,
          body: '“' + nm + '” spent ' + inr(jr.spend) + ' on ' + J + ' and got 0 ' + (a.platform === 'meta' ? 'results (as Ads Manager counts them)' : 'conversions') + '. Check targeting, the form or tracking.' });
      // over daily budget - Google only (Meta budgets are often set per ad set and may vary)
      if (a.platform === 'google') {
        const b = num(e.daily_budget), sp = sum(byCamp[cid].filter((r) => r.day === Y)).spend;
        if (b > 0 && sp > b * BUDGET_OVERSHOOT)
          alerts.push({ key: key('gads_budget', cid + ':' + Y), sev: 'high', title: 'Over daily budget — ' + label,
            body: '“' + nm + '” spent ' + inr(sp) + ' on ' + Y + ' against a ' + inr(b) + '/day budget (Google may spend up to twice a day\'s budget; this is more).' });
      }
    }

    // cost per result - lead campaigns only (Meta) / all campaigns (Google), settled day vs previous 7 days
    const leadRows = (d1: string, d2: string) => mine.filter((r) => r.day >= d1 && r.day <= d2 && (a.platform === 'google' || LEAD_OBJECTIVES.has(String((ents['meta|' + r.campaign_id] || {}).objective || ''))));
    const jL = sum(leadRows(J, J)), bL = sum(leadRows(BASE_FROM, BASE_TO));
    const cpr = jL.res ? jL.spend / jL.res : null, bcpr = bL.res ? bL.spend / bL.res : null;
    if (cpr != null && bcpr != null && cpr >= bcpr * CPR_SPIKE_RATIO && cpr >= CPR_SPIKE_MIN)
      alerts.push({ key: key(a.platform === 'meta' ? 'meta_cpl_spike' : 'gads_cpa_spike', J), sev: 'high', title: (a.platform === 'meta' ? 'Cost per lead spike — ' : 'Cost per conversion spike — ') + label,
        body: 'On ' + J + ' it cost ' + inr(cpr) + ' per ' + (a.platform === 'meta' ? 'lead' : 'conversion') + ' against ' + inr(bcpr) + ' over the 7 days before (' + Math.round((cpr / bcpr - 1) * 100) + '% up).' });

    // Google click-rate fall
    if (a.platform === 'google') {
      const jS = sum(on(J)), bS = sum(mine.filter((r) => r.day >= BASE_FROM && r.day <= BASE_TO));
      const jc = jS.impr ? jS.clk / jS.impr * 100 : 0, bc = bS.impr ? bS.clk / bS.impr * 100 : 0;
      if (bc > 0 && jS.impr > 2000 && jS.spend >= 1000 && jc <= bc * (1 - CTR_DROP))
        alerts.push({ key: key('gads_fatigue', J), sev: 'medium', title: 'Creative/keyword fatigue — ' + label,
          body: 'Click rate fell to ' + jc.toFixed(2) + '% on ' + J + ' from ' + bc.toFixed(2) + '% over the 7 days before, while spend was ' + inr(jS.spend) + '.' });
    }
  }

  // ---------------- de-dupe, notify, email ----------------
  dbg.detected = alerts.length;
  if (dry) return j({ ...dbg, alerts });   // detect only: don't consume the de-dupe keys
  const fresh: any[] = [];
  for (const a of alerts) {
    const { error } = await camp.from('alert_log').insert({ alert_key: a.key, kind: 'campaign_alert', severity: a.sev, title: a.title, body: a.body });
    if (!error) fresh.push(a);   // unique violation => already alerted
  }
  dbg.new = fresh.length;
  if (!fresh.length) return j({ ...dbg, sent: 0 });

  let to: string[] = (Deno.env.get('CAMPAIGN_ALERT_EMAILS') || '').split(/[,;\s]+/).filter((x) => x.includes('@'));
  if (!to.length) to = ['digitalmarketing@thejaingroup.com'];

  const notifs: any[] = [];
  to.forEach((email) => fresh.forEach((a) => notifs.push({ recipient: email, kind: 'campaign_alert', title: a.title, body: a.body, urgent: a.sev === 'critical', read: false })));
  try { await sb.schema('acc').from('notifications').insert(notifs); } catch (e) { dbg.notif_err = String(e).slice(0, 140); }

  const GU = Deno.env.get('GMAIL_USER'), GP = Deno.env.get('GMAIL_APP_PASSWORD');
  const PORTAL = (Deno.env.get('PORTAL_URL') || 'https://jaingroupe.netlify.app').replace(/\/$/, '');
  if (GU && GP) {
    const LOGO = PORTAL + '/assets/jaine-logo-full-white.png';
    const sevColor: Record<string, string> = { critical: '#dc2626', high: '#d97706', medium: '#0891b2' };
    const items = fresh.map((a) => "<tr><td style='padding:12px 14px;border-left:4px solid " + (sevColor[a.sev] || '#64748b') + ";background:#f8fafc;border-radius:8px'><div style='font-weight:700;color:#0f172a;font-size:14px'>" + esc(a.title) + "</div><div style='color:#475569;font-size:13px;line-height:1.55;margin-top:4px'>" + esc(a.body) + "</div></td></tr><tr><td style='height:10px'></td></tr>").join('');
    const html = "<div style='margin:0;padding:24px;background:#f1f5f9;font-family:Segoe UI,Arial,sans-serif'><div style='max-width:560px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;border:1px solid #e2e8f0'>" +
      "<div style='background:linear-gradient(180deg,#0a0a0c,#171719);padding:16px 24px;border-bottom:2px solid #e0121c'><table role='presentation' cellpadding='0' cellspacing='0' border='0'><tr><td style='vertical-align:middle;padding-right:13px'><img src='" + LOGO + "' alt='JAIN-E' height='24' style='display:block;height:24px;width:auto;border:0'></td><td style='vertical-align:middle'><span style='color:#c7c7ca;font-size:12px;font-weight:600;letter-spacing:1.6px;text-transform:uppercase'>Campaign Alerts</span></td></tr></table></div>" +
      "<div style='padding:24px'><p style='margin:0 0 6px;color:#0f172a;font-size:15px;font-weight:600'>" + fresh.length + " issue" + (fresh.length === 1 ? '' : 's') + " need attention</p><p style='margin:0 0 18px;color:#64748b;font-size:13px'>Spend is compared for " + Y + " against " + Y1 + "; results are judged on " + J + ", once they have settled.</p><table style='width:100%;border-collapse:collapse'>" + items + "</table>" +
      "<div style='margin:14px 0 0'><a href='" + PORTAL + "/campaigns.html' style='display:inline-block;background:#e0121c;color:#fff;text-decoration:none;padding:10px 20px;border-radius:8px;font-size:14px;font-weight:600'>Open Our Brand</a></div></div>" +
      "<div style='padding:14px 24px;background:#f8fafc;border-top:1px solid #e2e8f0'><p style='margin:0;color:#94a3b8;font-size:12px'>Automated alert from JAIN-E Our Brand. Please do not reply.</p></div></div></div>";
    const text = fresh.map((a) => '- ' + a.title + ': ' + a.body).join('\n');
    let client: any = null;
    try {
      client = new SMTPClient({ connection: { hostname: 'smtp.gmail.com', port: 465, tls: true, auth: { username: GU, password: GP } } });
      await client.send({ from: GU, to, subject: '⚠ Campaign alert: ' + fresh.length + ' issue' + (fresh.length === 1 ? '' : 's') + ' (' + Y + ')', content: text, html });
      await camp.from('alert_log').update({ emailed: true }).in('alert_key', fresh.map((a) => a.key));
      dbg.emailed = to;
    } catch (e) { dbg.email_err = String(e).slice(0, 160); } finally { try { if (client) await client.close(); } catch (_) { /* ignore */ } }
  } else { dbg.email = 'GMAIL secrets missing'; }
  return j({ ...dbg, sent: fresh.length, alerts: fresh });
});
