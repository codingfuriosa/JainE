/* FACEBOOK CHECKLIST - THE ALERTS LAYOUT (18 Nov 2026, Ayush: "not project-wise - this was the section, this was the point, and
   under it what the problem is; straightforward, nothing out of sight"). One drawing shared by the Checklist tab in Campaign
   Analytics, the public link (checklist-report.html) and the PDF, so the three always show the same thing.

   Layout: a summary line (alerts, red, points, projects, when it was checked) -> a contents list of every section and point
   with its count (each one jumps to its place) -> then each section, each point that has alerts in it with its limit, and
   under it EVERY problem as a row: project, level, the full name (never cut short) with the campaign / ad set it sits in,
   what was found, and the limit when it differs from the point's. Red alerts first in each point, then by project.
   Nothing is collapsed, hidden behind a click, or limited to the first N.

   window.ckRender(D, opt) -> HTML.  D = { flags:[...], runs:[{kind,ran_at,period_from,period_to}], live:bool }
   opt.print = true -> the contents links are left out (plain text in the PDF). */
(function () {
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var LV = { project: 'Project', campaign: 'Campaign', adset: 'Ad set', ad: 'Ad' }, LVO = { project: 0, campaign: 1, adset: 2, ad: 3 };
  var dt = function (s) { if (!s) return ''; var d = new Date(String(s).length <= 10 ? s + 'T00:00:00' : s); return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }); };
  var tm = function (s) { if (!s || String(s).length <= 10) return ''; return new Date(s).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }); };
  var secName = function (s) { var m = String(s).match(/^(\d+)\)\s*(.*)$/); return m ? { n: m[1], t: m[2] } : { n: '', t: s }; };
  var slug = function (s) { return 'ck-' + String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-'); };

  window.CK_CSS = ''
    + '.ck{color:#0f172a;font-size:13px}.ck *{box-sizing:border-box}'
    + '.ck-top{display:flex;flex-wrap:wrap;gap:8px 18px;align-items:baseline;margin:0 0 12px}'
    + '.ck-big{font-size:20px;font-weight:800}.ck-red{color:#dc2626}.ck-mute{color:#64748b}'
    + '.ck-when{color:#64748b;font-size:12.5px;width:100%}'
    /* Overview box (19 Nov 2026, Ayush: "improper css inside it"): one row per section - its name on the left, then each
       point as a pill with its count right beside the name, instead of counts floating at the far edge of a loose grid. */
    /* ...and tighter still (19 Nov, "so much negative space"): the sections flow one after another on the same lines,
       each as its name followed by its point pills, so a short checklist fits in one or two lines. */
    + '.ck-toc{border:1px solid #e5e7eb;border-radius:12px;background:#fff;padding:9px 12px;margin:0 0 16px;display:flex;flex-wrap:wrap;align-items:center;gap:8px 18px}'
    + '.ck-toc h4{margin:0;font-size:10.5px;letter-spacing:.06em;text-transform:uppercase;color:#94a3b8;font-weight:700;line-height:26px}'
    + '.ck-toc .row{display:inline-flex;flex-wrap:wrap;align-items:center;gap:6px}'
    + '.ck-toc .s{font-weight:700;font-size:12.5px;color:#334155;line-height:26px;margin-right:2px}'
    + '.ck-toc .pts{display:contents}'
    + '.ck-toc a{display:inline-flex;align-items:center;gap:7px;height:26px;padding:0 10px;border:1px solid #e5e7eb;border-radius:999px;background:#f8fafc;color:#0f172a!important;text-decoration:none!important;font-size:12.5px;font-weight:500;white-space:nowrap;line-height:1}'
    + '.ck-toc a:hover{background:#eef2f7;border-color:#cbd5e1}.ck-toc a b{font-variant-numeric:tabular-nums;font-weight:700;color:#0f172a}.ck-toc a b .ck-red{font-weight:700}'
    + '@media(max-width:700px){.ck-toc{gap:6px 12px}}'
    + '.ck-sec{margin:0 0 22px}.ck-sec>h2{font-size:16px;margin:0 0 10px;display:flex;gap:10px;align-items:center}'
    + '.ck-sec>h2 .n{display:inline-flex;width:26px;height:26px;border-radius:7px;background:#0f172a;color:#fff;font-size:13px;align-items:center;justify-content:center}'
    + '.ck-pt{border:1px solid #e5e7eb;border-radius:12px;background:#fff;margin:0 0 12px;overflow:hidden}'
    + '.ck-ph{padding:10px 14px;border-bottom:1px solid #e5e7eb;background:#f8fafc;display:flex;flex-wrap:wrap;gap:4px 14px;align-items:baseline}'
    + '.ck-ph b{font-size:14px}.ck-ph .c{font-weight:700}.ck-ph .lim{color:#64748b;font-size:12.5px}'
    + '.ck table{width:100%;border-collapse:collapse}.ck th{font-size:10.5px;letter-spacing:.05em;text-transform:uppercase;color:#64748b;text-align:left;padding:7px 10px;border-bottom:1px solid #e5e7eb;background:#fff;white-space:nowrap}'
    + '.ck td{padding:8px 10px;border-bottom:1px solid #f1f5f9;vertical-align:top;line-height:1.4}.ck tr:last-child td{border-bottom:0}'
    + '.ck td.i{color:#94a3b8;width:34px;font-variant-numeric:tabular-nums}.ck td.p{white-space:nowrap;color:#334155;font-weight:600}.ck td.l{white-space:nowrap;color:#64748b}'
    + '.ck td.nm{word-break:break-word}.ck td.nm .path{color:#64748b;font-size:11.5px;margin-top:2px}'
    + '.ck td.v{font-weight:700;color:#b45309;white-space:nowrap}.ck tr.red td.v{color:#dc2626}.ck td.lm{color:#64748b;font-size:12px}'
    + '.ck tr.red td:first-child{box-shadow:inset 3px 0 0 #dc2626}.ck tr.amb td:first-child{box-shadow:inset 3px 0 0 #f59e0b}'
    + '.ck-tag{display:inline-block;font-size:10.5px;font-weight:700;padding:1px 7px;border-radius:999px;background:#fee2e2;color:#b91c1c;margin-left:6px;vertical-align:1px}'
    + '.ck-empty{border:1px dashed #cbd5e1;border-radius:12px;padding:28px;text-align:center;color:#64748b;background:#fff}'
    + '.ck .lvm{display:none}@media(max-width:700px){.ck td.l,.ck th.l{display:none}.ck td.p{white-space:normal}.ck .lvm{display:block;color:#64748b;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.04em}}'
    + '@media print{.ck-noprint{display:none!important}.ck-pt{break-inside:auto;border-color:#cbd5e1}.ck tr{break-inside:avoid}.ck thead{display:table-header-group}.ck-sec>h2,.ck-ph{break-after:avoid}body{background:#fff!important}}';

  window.ckRender = function (D, opt) {
    opt = opt || {};
    var F = (D && D.flags) || [];
    var runs = (D && D.runs) || [];
    var when = D && D.live ? 'Worked out just now - not saved, no emails'
      : runs.length ? runs.map(function (r) { return (r.kind === 'weekly' ? 'Weekly points: ' + dt(r.period_from) + ' – ' + dt(r.period_to) : 'Daily points') + ' · checked ' + dt(r.ran_at) + (tm(r.ran_at) ? ' ' + tm(r.ran_at) : ''); }).join('   |   ')
      : '';
    if (!F.length) return '<div class="ck">' + (when ? '<div class="ck-when">' + esc(when) + '</div>' : '') + '<div class="ck-empty">' + (runs.length || (D && D.live) ? 'No alerts - every point is within its limit.' : ((D && D.emptyNote) || 'No check has been saved yet. The daily points are checked every day at 00:00 IST, the weekly points every Monday at 01:00 IST.')) + '</div></div>';
    // section -> point -> rows
    var secs = {}, order = [];
    F.forEach(function (f) { var s = secs[f.section]; if (!s) { s = secs[f.section] = { name: f.section, pts: {}, porder: [] }; order.push(f.section); }
      var p = s.pts[f.point]; if (!p) { p = s.pts[f.point] = []; s.porder.push(f.point); } p.push(f); });
    order.sort(function (a, b) { return String(a).localeCompare(String(b), 'en', { numeric: true }); });
    var reds = F.filter(function (f) { return f.sev === 'red'; }).length, nPts = 0, projs = {};
    F.forEach(function (f) { projs[f.project] = 1; });
    order.forEach(function (k) { nPts += secs[k].porder.length; });
    var h = '<div class="ck">';
    h += '<div class="ck-top"><span class="ck-big">' + F.length.toLocaleString('en-IN') + ' alerts</span>'
      + (reds ? '<span class="ck-big ck-red">' + reds + ' red</span>' : '')
      + '<span class="ck-mute">' + nPts + ' point' + (nPts === 1 ? '' : 's') + ' in ' + order.length + ' section' + (order.length === 1 ? '' : 's') + ' · ' + Object.keys(projs).length + ' project' + (Object.keys(projs).length === 1 ? '' : 's') + '</span>'
      + (when ? '<span class="ck-when">' + esc(when) + '</span>' : '') + '</div>';
    // contents
    h += '<div class="ck-toc"><h4>Contents</h4>';
    order.forEach(function (k) { var s = secs[k], sn = secName(k);
      h += '<div class="row"><div class="s">' + esc((sn.n ? sn.n + ' · ' : '') + sn.t) + '</div><div class="pts">';
      s.porder.forEach(function (pt) { var rows = s.pts[pt], r = rows.filter(function (f) { return f.sev === 'red'; }).length, lab = esc(pt), cnt = '<b>' + rows.length + (r ? ' <span class="ck-red">(' + r + ' red)</span>' : '') + '</b>';
        h += opt.print ? '<a>' + lab + cnt + '</a>' : '<a href="#' + slug(k + ' ' + pt) + '" onclick="var e=document.getElementById(\'' + slug(k + ' ' + pt) + '\');if(e){e.scrollIntoView({behavior:\'smooth\',block:\'start\'});return false;}">' + lab + cnt + '</a>'; });
      h += '</div></div>'; });
    h += '</div>';
    // sections
    order.forEach(function (k) { var s = secs[k], sn = secName(k);
      h += '<div class="ck-sec"><h2>' + (sn.n ? '<span class="n">' + esc(sn.n) + '</span>' : '') + esc(sn.t) + '</h2>';
      s.porder.forEach(function (pt) {
        var rows = s.pts[pt].slice().sort(function (a, b) { return (a.sev === 'red' ? 0 : 1) - (b.sev === 'red' ? 0 : 1) || String(a.project).localeCompare(String(b.project)) || (LVO[a.level] - LVO[b.level]) || String(a.name).localeCompare(String(b.name)); });
        var lims = {}; rows.forEach(function (f) { lims[f.lim] = 1; }); var oneLim = Object.keys(lims).length === 1;
        var r = rows.filter(function (f) { return f.sev === 'red'; }).length;
        h += '<div class="ck-pt" id="' + slug(k + ' ' + pt) + '"><div class="ck-ph"><b>' + esc(pt) + '</b><span class="c">' + rows.length + ' alert' + (rows.length === 1 ? '' : 's') + (r ? ' <span class="ck-red">· ' + r + ' red</span>' : '') + '</span>'
          + (oneLim ? '<span class="lim">Limit: ' + esc(rows[0].lim) + '</span>' : '<span class="lim">Limits differ - see each row</span>') + '</div>'
          + '<table><thead><tr><th>#</th><th>Project</th><th class="l">Level</th><th>Name</th><th>Found</th>' + (oneLim ? '' : '<th>Limit</th>') + '</tr></thead><tbody>';
        rows.forEach(function (f, i) {
          var path = [];
          if (f.level === 'adset' || f.level === 'ad') { if (f.campaign_name) path.push('Campaign: ' + f.campaign_name); }
          if (f.level === 'ad' && f.adset_name) path.push('Ad set: ' + f.adset_name);
          var nm = f.level === 'project' ? 'Whole project' : (f.name || '');
          h += '<tr class="' + (f.sev === 'red' ? 'red' : 'amb') + '"><td class="i">' + (i + 1) + '</td><td class="p">' + esc(f.project) + '</td><td class="l">' + esc(LV[f.level] || f.level) + '</td>'
            + '<td class="nm"><span class="lvm">' + esc(LV[f.level] || f.level) + '</span>' + esc(nm) + (f.sev === 'red' ? '<span class="ck-tag">RED</span>' : '') + (path.length ? '<div class="path">' + esc(path.join('  ›  ')) + '</div>' : '') + '</td>'
            + '<td class="v">' + esc(f.value) + '</td>' + (oneLim ? '' : '<td class="lm">' + esc(f.lim) + '</td>') + '</tr>';
        });
        h += '</tbody></table></div>';
      });
      h += '</div>';
    });
    return h + '</div>';
  };

  // a print-ready page of the alerts (the PDF): the same layout, no app around it
  window.ckPrintDoc = function (D, title) {
    return '<!doctype html><html><head><meta charset="utf-8"><title>' + esc(title || 'Facebook Checklist') + '</title>'
      + '<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">'
      + '<style>@page{size:A4;margin:14mm 12mm}body{margin:0;font-family:Inter,system-ui,Segoe UI,Arial,sans-serif;background:#fff;-webkit-print-color-adjust:exact;print-color-adjust:exact}'
      + '.hd{display:flex;justify-content:space-between;align-items:center;border-bottom:2px solid #e0121c;padding:0 0 10px;margin:0 0 14px}.hd b{font-size:18px}.hd span{color:#64748b;font-size:12px}' + window.CK_CSS + '</style></head><body>'
      + '<div class="hd"><b>Facebook Checklist · The Jain Group</b><span>' + esc(new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })) + '</span></div>'
      + window.ckRender(D, { print: true }) + '</body></html>';
  };
})();
