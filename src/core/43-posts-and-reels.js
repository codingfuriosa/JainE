/* ==========================================================================================
   POSTS & REELS (module id 'organic') - organic Facebook, and Instagram once it is linked
   ==========================================================================================
   Rebuilt 6 Nov 2026, as asked ("I want everything automatic"). The first version lived in
   31-transcription.js and was removed on 16 Oct; this file is the whole module now.

   ORGANIC ONLY - paid ads are Campaign Analytics.

   WHERE THE NUMBERS COME FROM. The edge function social-organic-live reads Meta with the saved
   server key every morning at 06:00 IST (cron 'social-organic-daily') and when someone presses
   Refresh now. It writes camp.social_posts (each post / reel / carousel), camp.social_page_daily
   (the Page's own totals per day) and camp.social_sync_state (when it last ran). This page only
   reads those tables - it never calls Meta itself, so opening it costs nothing.

   BE HONEST ABOUT REACH. Meta gives reach for the PAGE (Viewers, per day) but not per Facebook
   post or reel - it accepts the request and returns 0 for every post (probed 6 Nov 2026). So the
   Page's reach is on Overview, Facebook rows are measured by Views and interactions, and a reach
   column appears only where Meta really reports it (Instagram). "NA" with a tooltip marks a
   number Meta does not report for that kind of content; a muted 0 is a real zero. */
let ORG_PERIOD='last_28d', ORG_SINCE='', ORG_UNTIL='', ORG_NET='all', ORG_KIND='all',
    ORG_PAGE='all', ORG_SORT='date', ORG_DIR=-1, ORG_Q='', ORG_PG=0, ORG_OPEN=false,
    ORG_ROWS=null, ORG_PAGES=null, ORG_DAILY=null, ORG_STATE=undefined, ORG_LAST_TI=-1;
const ORG_PER=25;
// 7 Nov 2026, as asked: no separate Reels tab - reels are Facebook (or Instagram) content and sit in
// those tabs, with the Reels chip to narrow to them.
const ORG_TABS=['Overview','Facebook','Instagram','Top performers'];
const ORG_PRESETS=[
  ['yesterday','Yesterday'],['last_7d','Last 7 days'],['last_28d','Last 28 days'],['last_90d','Last 90 days'],
  ['this_week','This week'],['this_month','This month'],['this_year','This year'],
  ['last_week','Last week'],['last_month','Last month'],['lifetime','Lifetime'],['custom','Custom']
];
function orgDay(d){return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');}
function orgAdd(d,n){const x=new Date(d.getTime());x.setDate(x.getDate()+n);return x;}
// Monday-start weeks, to match how Business Suite reports.
function orgMonday(d){const x=new Date(d.getTime());const off=(x.getDay()+6)%7;x.setDate(x.getDate()-off);return x;}
function orgRange(){
  const today=new Date(); today.setHours(12,0,0,0);
  const P=ORG_PERIOD;
  if(P==='lifetime')   return {since:'',until:''};
  if(P==='custom')     return {since:ORG_SINCE,until:ORG_UNTIL};
  if(P==='yesterday'){ const d=orgAdd(today,-1); return {since:orgDay(d),until:orgDay(d)}; }
  if(P==='last_7d')    return {since:orgDay(orgAdd(today,-7)),  until:orgDay(orgAdd(today,-1))};
  if(P==='last_28d')   return {since:orgDay(orgAdd(today,-28)), until:orgDay(orgAdd(today,-1))};
  if(P==='last_90d')   return {since:orgDay(orgAdd(today,-90)), until:orgDay(orgAdd(today,-1))};
  if(P==='this_week')  return {since:orgDay(orgMonday(today)), until:orgDay(today)};
  if(P==='this_month') return {since:orgDay(new Date(today.getFullYear(),today.getMonth(),1)), until:orgDay(today)};
  if(P==='this_year')  return {since:orgDay(new Date(today.getFullYear(),0,1)), until:orgDay(today)};
  if(P==='last_week'){ const m=orgMonday(today); return {since:orgDay(orgAdd(m,-7)), until:orgDay(orgAdd(m,-1))}; }
  if(P==='last_month'){ const f=new Date(today.getFullYear(),today.getMonth()-1,1), l=new Date(today.getFullYear(),today.getMonth(),0);
                        return {since:orgDay(f),until:orgDay(l)}; }
  return {since:'',until:''};
}
function orgRangeLabel(){
  if(ORG_PERIOD==='lifetime') return 'All time';
  const r=orgRange(); if(!r.since||!r.until) return 'Pick two dates';
  const f=function(s){const d=new Date(s+'T00:00:00');return d.toLocaleDateString('en-IN',{day:'numeric',month:'short',year:'numeric'});};
  return r.since===r.until ? f(r.since) : (f(r.since)+' – '+f(r.until));
}
function orgPresetLabel(){ return ((ORG_PRESETS.find(function(p){return p[0]===ORG_PERIOD;})||[])[1])||'Custom'; }
function orgInRange(d){ const R=orgRange(); d=String(d||'').slice(0,10); if(!d) return true;
  return !(R.since&&d<R.since) && !(R.until&&d>R.until); }

const ORG_CSS='<style id="orgCss">'
+'.org-bar{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:14px}'
/* date, search and page filter share the whole row - no empty strip on the right */
+'.org-top{display:grid;grid-template-columns:auto minmax(0,1fr) minmax(200px,300px);gap:10px;align-items:center;margin-bottom:14px}'
+'.org-top .org-search{max-width:none;width:100%;min-width:0}'
+'.org-top .org-sel{width:100%;height:42px}'
+'.org-top .org-search{height:42px}'
+'@media(max-width:760px){.org-top{grid-template-columns:minmax(0,1fr)}}'
+'.org-dp{position:relative}'
+'.org-dp-btn{display:flex;align-items:center;gap:10px;height:42px;padding:0 14px;border:1px solid var(--line);border-radius:10px;background:var(--bg-card);cursor:pointer;transition:.15s;min-width:0}'
+'.org-dp-btn:hover{border-color:var(--brand)}'
+'.org-dp.open .org-dp-btn{border-color:var(--brand);box-shadow:0 0 0 3px var(--brand-a10,#eef2ff)}'
+'.org-dp-btn i.cal{color:var(--brand);font-size:14px}'
+'.org-dp-lab{display:flex;flex-direction:column;align-items:flex-start;line-height:1.25;min-width:0}'
+'.org-dp-lab b{font-size:13px;font-weight:700;color:var(--ink);white-space:nowrap}'
+'.org-dp-lab span{font-size:11px;color:var(--slate);white-space:nowrap}'
+'.org-dp-btn i.cv{margin-left:6px;color:var(--slate);font-size:11px;transition:transform .15s}'
+'.org-dp.open .org-dp-btn i.cv{transform:rotate(180deg)}'
+'.org-dp-pan{position:absolute;top:calc(100% + 6px);left:0;z-index:80;background:var(--bg-card);border:1px solid var(--line);border-radius:12px;box-shadow:0 14px 38px rgba(15,23,42,.18);padding:9px;display:none;width:352px;max-width:92vw;box-sizing:border-box}'
+'.org-dp.open .org-dp-pan{display:block}'
+'.org-dp-list{display:grid;grid-template-columns:1fr 1fr;gap:3px}'
+'.org-dp-opt{padding:8px 11px;border-radius:8px;font-size:12.5px;font-weight:600;color:var(--ink);cursor:pointer;white-space:nowrap;border:1px solid transparent}'
+'.org-dp-opt:hover{background:var(--bg,#f8fafc)}'
+'.org-dp-opt.on{background:var(--brand-a10,#eef2ff);color:var(--brand);border-color:var(--brand)}'
+'.org-dp-cus{border-top:1px solid var(--line);margin-top:8px;padding-top:10px;display:flex;gap:8px;align-items:flex-end;flex-wrap:wrap}'
+'.org-dp-cus label{display:flex;flex-direction:column;gap:4px;font-size:10.5px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;color:var(--slate);flex:1 1 130px;min-width:0}'
+'.org-dp-cus input{height:36px;border:1px solid var(--line);border-radius:8px;padding:0 10px;font-size:13px;font-family:inherit;color:var(--ink);background:var(--bg-card);width:100%;box-sizing:border-box}'
+'.org-dp-cus button{height:36px;padding:0 16px;border-radius:8px;border:0;background:var(--brand);color:#fff;font-size:13px;font-weight:700;cursor:pointer}'
+'.org-fbtn{height:34px;padding:0 13px;border:1px solid var(--line);border-radius:20px;background:var(--bg-card);font-size:12.5px;font-weight:600;color:var(--slate);cursor:pointer;transition:.14s;display:inline-flex;align-items:center;gap:6px}'
+'.org-fbtn:hover{border-color:var(--brand);color:var(--brand)}'
+'.org-fbtn.on{background:var(--brand);border-color:var(--brand);color:#fff}'
+'.org-fbtn .n{font-size:11px;opacity:.75;font-weight:700}'
+'.org-search{height:38px;border:1px solid var(--line);border-radius:9px;padding:0 12px;font-size:13px;font-family:inherit;min-width:190px;flex:1 1 190px;max-width:300px;background:var(--bg-card);color:var(--ink);box-sizing:border-box}'
+'.org-sel{height:38px;border:1px solid var(--line);border-radius:9px;padding:0 11px;font-size:13px;font-family:inherit;background:var(--bg-card);color:var(--ink);cursor:pointer}'
+'.org-st{display:flex;align-items:center;gap:12px;flex-wrap:wrap;background:var(--bg-card);border:1px solid var(--line);border-radius:12px;padding:11px 15px;margin-bottom:14px;font-size:12.5px;color:var(--slate)}'
+'.org-st b{color:var(--ink)}'
+'.org-st .grow{flex:1 1 300px;min-width:0;line-height:1.6}'
+'.org-st .err{color:#b45309}'
+'.org-kpis{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;margin-bottom:16px}'
+'.org-kpi{background:var(--bg-card);border:1px solid var(--line);border-radius:12px;padding:13px 15px}'
+'.org-kpi .k{font-size:10.5px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:var(--slate);display:flex;align-items:center;gap:6px}'
+'.org-kpi .v{font-size:22px;font-weight:800;color:var(--ink);margin-top:5px;letter-spacing:-.02em}'
+'.org-kpi .s{font-size:11.5px;color:var(--slate);margin-top:2px}'
+'.org-h2{font-size:13px;font-weight:700;color:var(--ink);margin:4px 0 8px;display:flex;align-items:center;gap:7px}'
+'.org-h2 i{color:var(--slate)}'
+'.org-card{background:var(--bg-card);border:1px solid var(--line);border-radius:12px;padding:14px 16px;margin-bottom:14px}'
+'.org-chart{width:100%;height:150px;display:block}'
+'.org-chart rect{fill:var(--brand);opacity:.8}'
+'.org-chart rect:hover{opacity:1}'
+'.org-chart text{font-size:10px;fill:var(--slate)}'
+'.org-grid2{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:14px;margin-bottom:6px}'
+'.org-tblwrap{border:1px solid var(--line);border-radius:12px;overflow-x:auto;background:var(--bg-card)}'
+'.org-tbl{width:100%;border-collapse:collapse;font-size:13px;min-width:860px}'
+'.org-tbl th{text-align:left;padding:11px 13px;background:var(--bg,#f8fafc);color:var(--slate);font-weight:700;font-size:10.5px;letter-spacing:.05em;text-transform:uppercase;white-space:nowrap;border-bottom:1px solid var(--line)}'
+'.org-tbl th.sort{cursor:pointer;user-select:none}'
+'.org-tbl th.sort:hover,.org-tbl th.on{color:var(--brand)}'
+'.org-tbl th .ar{font-size:9px;margin-left:4px}'
+'.org-tbl th.n,.org-tbl td.n{text-align:right}'
+'.org-tbl td{padding:11px 13px;border-bottom:1px solid var(--line);color:var(--ink);vertical-align:middle}'
+'.org-tbl tbody tr{cursor:pointer;transition:background .12s}'
+'.org-tbl tbody tr:hover{background:var(--bg,#f8fafc)}'
+'.org-tbl tbody tr:last-child td{border-bottom:0}'
+'.org-tbl.plain tbody tr{cursor:default}'
+'.org-post{display:flex;align-items:center;gap:11px;min-width:0;max-width:390px}'
+'.org-thumb{width:44px;height:44px;border-radius:8px;object-fit:cover;flex:none;background:var(--bg,#f1f5f9);border:1px solid var(--line)}'
+'.org-thumb-ph{width:44px;height:44px;border-radius:8px;flex:none;background:var(--bg,#f1f5f9);border:1px solid var(--line);display:grid;place-items:center;color:#cbd5e1;font-size:15px}'
+'.org-ptxt{min-width:0}'
+'.org-ptxt b{font-size:13px;font-weight:600;color:var(--ink);line-height:1.35;overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical}'
+'.org-tag{display:inline-flex;align-items:center;gap:5px;font-size:10.5px;font-weight:700;padding:3px 9px;border-radius:20px;white-space:nowrap}'
+'.org-tag.reel{background:#fae8ff;color:#a21caf}.org-tag.video{background:#e0e7ff;color:#3730a3}.org-tag.carousel{background:#fef3c7;color:#92400e}.org-tag.post{background:#f1f5f9;color:#475569}'
+'.org-ct{white-space:nowrap;font-size:12.5px;font-weight:600}'
+'.org-dtl-lab{display:grid;grid-template-columns:minmax(0,1fr) 190px auto;gap:8px;align-items:end;margin-bottom:12px}'
+'.org-dtl-lab label{display:flex;flex-direction:column;gap:4px;font-size:10.5px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;color:var(--slate)}'
+'.org-dtl-lab input,.org-dtl-lab select{height:36px;border:1px solid var(--line);border-radius:8px;padding:0 10px;font-size:13px;font-family:inherit;color:var(--ink);background:var(--bg-card);text-transform:none;letter-spacing:0;font-weight:500}'
+'@media(max-width:560px){.org-dtl-lab{grid-template-columns:minmax(0,1fr)}}'
+'.org-rank{font-weight:800;color:var(--slate);width:28px}'
+'.org-er{font-weight:700}'
+'.org-na{color:#94a3b8;cursor:help;font-size:11.5px;font-weight:600}'
+'.org-zero{color:#94a3b8}'
+'.org-date{white-space:nowrap;font-size:12.5px;color:var(--slate)}'
+'.org-netic{margin-left:auto;flex:none;font-size:13px;opacity:.55}'
+'.org-netic.fa-facebook{color:#1877f2}.org-netic.fa-instagram{color:#e1306c}'
+'.org-pager{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-top:12px;flex-wrap:wrap}'
+'.org-pager .info{font-size:12.5px;color:var(--slate)}'
+'.org-pager button{height:34px;padding:0 14px;border:1px solid var(--line);border-radius:8px;background:var(--bg-card);font-size:13px;font-weight:600;color:var(--ink);cursor:pointer}'
+'.org-pager button:disabled{opacity:.45;cursor:not-allowed}'
+'.org-note{display:flex;align-items:flex-start;gap:9px;background:var(--bg,#f8fafc);border:1px solid var(--line);border-radius:10px;padding:10px 13px;font-size:12px;color:var(--slate);line-height:1.55;margin:0 0 14px}'
+'.org-note i{color:#94a3b8;margin-top:2px;flex:none}'
+'.org-empty{border:1px dashed var(--line);border-radius:12px;padding:34px 20px;text-align:center;color:var(--slate);font-size:13.5px;line-height:1.6}'
+'.org-empty>i{font-size:26px;color:#cbd5e1;display:block;margin-bottom:10px}'
/* the post box: picture left, everything else right */
+'.org-pop{display:grid;grid-template-columns:240px minmax(0,1fr);gap:22px;align-items:start}'
+'.org-pop-pic{display:flex;flex-direction:column;gap:10px;position:sticky;top:0}'
+'.org-pop-pic img{width:100%;max-height:380px;object-fit:contain;background:var(--bg,#f1f5f9);border:1px solid var(--line);border-radius:12px;display:block}'
+'.org-pop-pic .org-thumb-ph{width:100%;height:180px}'
+'.org-pop-pic .btn{justify-content:center}'
+'.org-pop-main{min-width:0;display:flex;flex-direction:column;gap:14px}'
+'.org-pop-meta{display:flex;align-items:center;gap:8px;flex-wrap:wrap;font-size:12.5px;color:var(--slate)}'
+'.org-pop-ct{font-size:10.5px;font-weight:700;padding:3px 9px;border-radius:20px;background:var(--brand-a10,#eef2ff);color:var(--brand)}'
+'.org-pop-tiles{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px}'
+'.org-pt{border:1px solid var(--line);border-radius:10px;padding:9px 11px;min-width:0}'
+'.org-pt .k{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;color:var(--slate);line-height:1.3;min-height:26px}'
+'.org-pt .v{font-size:17px;font-weight:800;color:var(--ink);margin-top:3px}'
+'.org-pt.na .v{color:#94a3b8;font-size:14px;cursor:help}'
+'.org-pop-chips{display:flex;flex-wrap:wrap;gap:6px}'
+'.org-pc{font-size:12px;color:var(--slate);background:var(--bg,#f8fafc);border:1px solid var(--line);border-radius:20px;padding:3px 10px}'
+'.org-pc b{color:var(--ink)}'
+'.org-pop-cap{font-size:13.5px;line-height:1.6;color:var(--ink);white-space:pre-wrap;overflow-wrap:anywhere;display:-webkit-box;-webkit-line-clamp:4;-webkit-box-orient:vertical;overflow:hidden}'
+'.org-pop-cap.open{display:block;-webkit-line-clamp:unset}'
+'.org-pop-more{align-self:flex-start;border:0;background:none;color:var(--brand);font-size:12.5px;font-weight:700;cursor:pointer;padding:0;margin-top:-8px}'
+'.org-pop-edit{display:grid;grid-template-columns:minmax(0,1fr) 200px auto;gap:8px;align-items:end;border-top:1px solid var(--line);padding-top:14px}'
+'.org-pop-edit label{display:flex;flex-direction:column;gap:4px;font-size:10.5px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;color:var(--slate)}'
+'.org-pop-edit input,.org-pop-edit select{height:38px;border:1px solid var(--line);border-radius:8px;padding:0 10px;font-size:13px;font-family:inherit;color:var(--ink);background:var(--bg-card);text-transform:none;letter-spacing:0;font-weight:500}'
+'.org-pop-edit .btn{height:38px}'
+'@media(max-width:760px){.org-pop{grid-template-columns:minmax(0,1fr)}.org-pop-pic{position:static}.org-pop-pic img{max-height:300px}.org-pop-tiles{grid-template-columns:repeat(2,minmax(0,1fr))}.org-pop-edit{grid-template-columns:minmax(0,1fr)}}'
+'.org-dtl-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px 20px;margin-top:4px}'
+'.org-dtl-f .k{font-size:10.5px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;color:var(--slate)}'
+'.org-dtl-f .v{font-size:14px;font-weight:700;color:var(--ink);margin-top:2px;overflow-wrap:anywhere}'
/* the whole picture, letterboxed - never cropped, never wider than the dialog */
+'.org-dtl-img{width:100%;background:var(--bg,#f1f5f9);border:1px solid var(--line);border-radius:10px;margin-bottom:12px;overflow:hidden;display:flex;align-items:center;justify-content:center}'
+'.org-dtl-img img{max-width:100%;max-height:340px;object-fit:contain;display:block}'
+'.org-dtl-msg{font-size:13.5px;line-height:1.6;color:var(--ink);white-space:pre-wrap;overflow-wrap:anywhere;max-height:170px;overflow-y:auto}'
+'.org-dtl *{max-width:100%;box-sizing:border-box}'
+'@media(max-width:1100px){.org-kpis{grid-template-columns:repeat(2,minmax(0,1fr))}.org-grid2{grid-template-columns:minmax(0,1fr)}}'
+'@media(max-width:760px){.org-dp-list{grid-template-columns:1fr}.org-kpi .v{font-size:19px}.org-post{max-width:220px}}'
+'@media(max-width:480px){.org-kpis{grid-template-columns:1fr}}'
+'</style>';

function orgN(v){const n=Number(v)||0; if(n>=1e7)return (n/1e7).toFixed(2).replace(/\.00$/,'')+' Cr'; if(n>=1e5)return (n/1e5).toFixed(2).replace(/\.00$/,'')+' L'; if(n>=1000)return (n/1000).toFixed(1).replace(/\.0$/,'')+'k'; return String(n);}
function orgDT(s){ if(!s)return '—'; try{return new Date(s).toLocaleString('en-IN',{day:'numeric',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'});}catch(e){return String(s);} }
function orgAgo(s){ if(!s)return 'never'; const m=Math.round((Date.now()-new Date(s).getTime())/60000);
  if(m<1)return 'just now'; if(m<60)return m+' min ago'; const h=Math.round(m/60); if(h<36)return h+' h ago'; return Math.round(h/24)+' days ago'; }
// Interactions exactly as Meta counts them (7 Nov, as asked - nothing added or taken away by JainE):
// Instagram sends its own total_interactions; for Facebook, Meta's Interactions is reactions + comments +
// shares (no single API figure exists - probed 7 Nov), stored that way by social-organic-live.
function orgEng(r){ return Number(r.interactions)||0; }
// An engagement RATE needs reach, and only Instagram reports reach per post.
function orgHasReach(r){ return (Number(r.reach)||0)>0; }
function orgER(r){ const reach=Number(r.reach)||0; return reach? (orgEng(r)/reach*100) : null; }
function orgKindLabel(k){ return k==='reel'?'Reel':(k==='carousel'?'Carousel Post':(k==='video'?'Video':'Static Post')); }
// Post Name: the name someone gave it (or the one written from the caption), else the caption's
// first line, cut short - the way the team names posts ("Avishek Das - Work Anniversary").
function orgPostName(r){ if(r.post_name) return String(r.post_name);
  const t=String(r.message||'').split(/\n/).map(function(x){return x.trim();}).filter(Boolean)[0]||'(no caption)';
  return t.length>70?t.slice(0,67).replace(/\s+\S*$/,'')+'…':t; }
// Engagement Rate as the team defines it: the Reactions column ÷ Views × 100. Since 7 Nov that column
// carries Meta's Interactions (reactions + comments + shares, + saves on Instagram), as asked.
function orgRate(r){ const v=orgViews(r); return v? orgEng(r)/v*100 : null; }
function orgViews(r){ return Number(r.views)||Number(r.plays)||Number(r.video_views)||0; }
// Meta reports watch time in milliseconds.
function orgSecs(ms){ const s=(Number(ms)||0)/1000; return s>=60?(Math.floor(s/60)+'m '+Math.round(s%60)+'s'):(s<10?s.toFixed(1)+'s':Math.round(s)+'s'); }
function orgWatch(ms){ const s=(Number(ms)||0)/1000;
  if(s>=3600){ const h=Math.floor(s/3600); return orgN(h)+'h '+Math.round((s%3600)/60)+'m'; }
  if(s>=60) return Math.floor(s/60)+'m '+Math.round(s%60)+'s';
  return Math.round(s)+'s'; }
// Some thumbnails 404 or are blocked; swap in a placeholder rather than a broken image.
window.orgThumbFail=function(img){
  const ph=document.createElement('div'); ph.className=img.className.replace('org-thumb','org-thumb-ph');
  ph.innerHTML='<i class="fa-regular fa-image"></i>';
  if(img.parentNode) img.parentNode.replaceChild(ph,img);
};

/* ---------------- filters (names kept: USAGE_MAP in 37-usage-module-actions.js logs them) ---------------- */
window.orgToggleDp=function(e){ if(e)e.stopPropagation(); ORG_OPEN=!ORG_OPEN; renderPage(); };
window.orgSetPeriod=function(p){
  ORG_PERIOD=p; ORG_PG=0;
  if(p==='custom'){ if(!ORG_SINCE||!ORG_UNTIL){ const t=new Date(); ORG_UNTIL=orgDay(t); ORG_SINCE=orgDay(orgAdd(t,-27)); } renderPage(); return; }
  ORG_OPEN=false; renderPage();
};
// Logged directly, not through USAGE_MAP: it has real validation that can stop it without applying.
window.orgApplyCustom=function(){
  const a=document.getElementById('orgFrom'), b=document.getElementById('orgTo');
  if(!a||!b||!a.value||!b.value){ toast('Pick both dates','warn'); try{usageQueue('organic.all_content.filter_by_date_range','error');}catch(_e){} return; }
  if(a.value>b.value){ toast('The From date must come before the To date','warn'); try{usageQueue('organic.all_content.filter_by_date_range','error');}catch(_e){} return; }
  ORG_SINCE=a.value; ORG_UNTIL=b.value; ORG_PERIOD='custom'; ORG_OPEN=false; ORG_PG=0; renderPage();
  try{usageQueue('organic.all_content.filter_by_date_range','update');}catch(_e){}
};
// ORG_NET follows the tab (Facebook / Instagram); kept as a variable because usbOrgMeta() reads it.
window.orgSetNet=function(n){ORG_NET=n;ORG_PG=0;renderPage();};
window.orgSetKind=function(k){ORG_KIND=k;ORG_PG=0;renderPage();};
window.orgSetPageId=function(v){ORG_PAGE=v;ORG_PG=0;renderPage();};
// Column-header sort: click once for highest first, again for lowest first.
window.orgSetSort=function(k){ if(ORG_SORT===k) ORG_DIR=-ORG_DIR; else { ORG_SORT=k; ORG_DIR=-1; } ORG_PG=0; renderPage(); };
window.orgSearch=function(v){ORG_Q=v;ORG_PG=0;
  clearTimeout(window._orgQT); window._orgQT=setTimeout(function(){renderPage(); const el=document.getElementById('orgQ'); if(el){el.focus(); el.setSelectionRange(el.value.length,el.value.length);} },320);
  try{usageQueueDebounced('organic.all_content.search_caption_or_page', v);}catch(_e){}
};
window.orgGo=function(d){ORG_PG=Math.max(0,ORG_PG+d);renderPage();};

/* ---------------- loading & refreshing ---------------- */
async function orgLoad(){
  const C=sb.schema('camp');
  const since=orgDay(orgAdd(new Date(),-800));
  const got=await Promise.all([
    C.from('social_sync_state').select('*').eq('id',1).maybeSingle().then(function(r){return r.error?null:(r.data||{});},function(){return null;}),
    C.from('social_pages').select('*').order('name').then(function(r){return r.data||[];},function(){return [];}),
    C.from('social_posts').select('*').order('created_time',{ascending:false}).limit(5000).then(function(r){return r.data||[];},function(){return [];}),
    C.from('social_page_daily').select('*').gte('day',since).order('day').limit(5000).then(function(r){return r.data||[];},function(){return [];})
  ]);
  ORG_STATE=got[0]; ORG_PAGES=got[1]; ORG_ROWS=got[2]; ORG_DAILY=got[3];
}
/* ---------------- detail dialog ---------------- */
// The team's own content types (7 Nov 2026). Same list as social-organic-live and the
// camp.social_post_set_label check - change all three together.
const ORG_CONTENT_TYPES=['Employee Post','Birthday Post','Wish Post','Contest Post','Quiz Post','CP Testimonial',
  'Client Testimonial','Channel Partner Post','CP Post','Event Post','CARE Post','Creative Post','Project Post',
  'HR Activity','EGC','Web Blog','PR Post','Trending Post','Moment Marketing'];
// A correction is saved as 'manual', so the overnight naming never changes it back.
window.orgSaveLabel=async function(id){
  const name=(($('orgLblName')||{}).value||'').trim(), type=(($('orgLblType')||{}).value||'')||null;
  const {error}=await sb.schema('camp').rpc('social_post_set_label',{p_id:id,p_name:name,p_type:type});
  if(error){ toast('Could not save: '+error.message,'err'); return; }
  const r=(ORG_ROWS||[]).find(function(x){return String(x.id)===String(id);});
  if(r){ r.post_name=name||null; r.content_type=type; r.label_source='manual'; }
  toast('Saved','ok'); closeModal(); renderPage();
};
/* THE POST BOX (redesigned 7 Nov 2026, as asked - "looks bad"). Two columns: the picture on the left
   at a fixed width, so a tall reel no longer pushes everything below the fold; on the right the name,
   type and date, the same eight numbers as the table (same NA rules, so the box and the row always
   agree), the smaller counts, the caption (four lines, "Show more" for the rest - no box scrolling
   inside the box) and, last, the Post Name / Content Type correction. Phones stack it. */
window.orgOpen=function(id){
  const r=(ORG_ROWS||[]).find(function(x){return String(x.id)===String(id);}); if(!r)return;
  const rx=r.reactions||{};
  const tile=function(k){ const c=ORG_COLS[k], na=!c.has(r), v=c.get(r);
    return '<div class="org-pt'+(na?' na':'')+'"><div class="k">'+esc(c.k)+'</div><div class="v"'+(na?' title="'+esc(c.why||'')+'"':'')+'>'
      +(na?'NA':(v?c.fmt(v):'0'))+'</div></div>'; };
  const small=function(k,v){ return '<span class="org-pc"><b>'+v+'</b> '+esc(k)+'</span>'; };
  const net=r.network==='instagram'?'Instagram':'Facebook';
  const rxs=[['👍',rx.like],['❤️',rx.love],['🤗',rx.care],['😂',rx.haha],['😮',rx.wow],['😢',rx.sad],['😠',rx.angry]]
    .filter(function(p){return Number(p[1])>0;}).map(function(p){return '<span class="org-pc">'+p[0]+' <b>'+orgN(p[1])+'</b></span>';}).join('');
  const msg=String(r.message||'').trim();
  openModal('<div class="modal-head"><h3><i class="fa-brands fa-'+(r.network==='instagram'?'instagram':'facebook')+'"></i> '+esc(orgPostName(r))+'</h3><span class="x" onclick="closeModal()">&times;</span></div>'
    +'<div class="modal-body org-pop">'
      +'<div class="org-pop-pic">'
        +(r.thumbnail?'<img src="'+esc(r.thumbnail)+'" referrerpolicy="no-referrer" onerror="orgThumbFail(this)">':'<div class="org-thumb-ph"><i class="fa-regular fa-image"></i></div>')
        +(r.permalink?'<a class="btn" target="_blank" rel="noopener" href="'+esc(r.permalink)+'"><i class="fa-solid fa-arrow-up-right-from-square"></i> View on '+net+'</a>':'')
      +'</div>'
      +'<div class="org-pop-main">'
        +'<div class="org-pop-meta"><span class="org-tag '+esc(r.kind||'post')+'">'+esc(orgKindLabel(r.kind))+'</span>'
          +(r.content_type?'<span class="org-pop-ct">'+esc(r.content_type)+'</span>':'')
          +'<span>'+esc(r.page_name||'')+' · '+orgDT(r.created_time)+'</span></div>'
        +'<div class="org-pop-tiles">'+orgColsFor().map(tile).join('')+'</div>'
        +'<div class="org-pop-chips">'+small('Comments',orgN(r.comments))+small('Shares',orgN(r.shares))
          +(r.network==='facebook'&&r.kind!=='reel'?small('Clicks',orgN(r.clicks)):'')
          +(r.network==='instagram'?small('Saves',orgN(r.saves)):'')
          +(Number(r.replays)?small('Replays',orgN(r.replays)):'')+rxs+'</div>'
        +(msg?'<div class="org-pop-cap" id="orgCap">'+esc(msg)+'</div>'
            +(msg.length>260||msg.split('\n').length>4?'<button class="org-pop-more" onclick="var c=document.getElementById(\'orgCap\');c.classList.toggle(\'open\');this.textContent=c.classList.contains(\'open\')?\'Show less\':\'Show more\'">Show more</button>':'')
          :'<div class="org-pop-cap" style="color:var(--slate)">(no caption)</div>')
        // Post Name and Content Type: written from the caption by the AI, corrected here by anyone
        +'<div class="org-pop-edit"><label>Post Name<input id="orgLblName" value="'+esc(orgPostName(r))+'"></label>'
          +'<label>Content Type<select id="orgLblType"><option value="">—</option>'
          +ORG_CONTENT_TYPES.map(function(t){return '<option'+(r.content_type===t?' selected':'')+'>'+esc(t)+'</option>';}).join('')+'</select></label>'
          +'<button class="btn primary" onclick="orgSaveLabel(\''+esc(String(r.id))+'\')">Save</button></div>'
      +'</div>'
    +'</div>','lg');
};

function orgDatePicker(){
  const opts=ORG_PRESETS.map(function(p){
    return '<div class="org-dp-opt'+(ORG_PERIOD===p[0]?' on':'')+'" onclick="event.stopPropagation();orgSetPeriod(\''+p[0]+'\')">'+esc(p[1])+'</div>';
  }).join('');
  const cus=ORG_PERIOD==='custom'
    ? '<div class="org-dp-cus" onclick="event.stopPropagation()">'
      +'<label>From<input type="date" id="orgFrom" value="'+esc(ORG_SINCE||'')+'"></label>'
      +'<label>To<input type="date" id="orgTo" value="'+esc(ORG_UNTIL||'')+'"></label>'
      +'<button onclick="orgApplyCustom()">Apply</button></div>'
    : '';
  return '<div class="org-dp'+(ORG_OPEN?' open':'')+'" id="orgDp">'
    +'<div class="org-dp-btn" onclick="orgToggleDp(event)">'
      +'<i class="fa-regular fa-calendar cal"></i>'
      +'<span class="org-dp-lab"><b>'+esc(orgPresetLabel())+'</b><span>'+esc(orgRangeLabel())+'</span></span>'
      +'<i class="fa-solid fa-chevron-down cv"></i></div>'
    +'<div class="org-dp-pan"><div class="org-dp-list">'+opts+'</div>'+cus+'</div></div>';
}

function orgStatusBar(){
  const S=ORG_STATE||{};
  // 7 Nov 2026, as asked: no Refresh button - one refresh every night (cron 'social-organic-daily').
  const who={cron:'the nightly refresh',backfill:'the first full pull'}[S.last_trigger]||'';
  return '<div class="org-st"><i class="fa-brands fa-meta" style="font-size:18px;color:#1877f2"></i><div class="grow">'
    +'Updates itself <b>every night</b> from Meta. Last updated <b>'+esc(orgAgo(S.last_sync_at))+'</b>'+(who?' by '+esc(who):'')+'.'
    +(S.last_error?'<br><span class="err"><i class="fa-solid fa-triangle-exclamation"></i> '+esc(String(S.last_error).slice(0,220))+'</span>':'')
    +'</div></div>';
}

/* ---------------- columns ---------------- */
// One definition per number. `has` says whether Meta reports it for that row at all, so a real 0
// (muted) is told apart from "not reported" - shown as NA, with the reason as a tooltip (7 Nov, as asked).
function orgFbVideo(r){ return r.network==='facebook' && (r.kind==='reel'||r.kind==='video'||Number(r.video_views)>0||Number(r.video_length_s)>0); }
/* The columns asked for (6-7 Nov 2026), in that order:
   Views · Viewers · Reactions · Engagement Rate · Net Follows · Duration (sec) · Watch Time · Average Seconds Viewed.
   VIEWERS: Meta's per-post Viewers (post_total_media_view_unique, the post's reach), pulled automatically
   every night since 7 Nov 2026 - Instagram reach for Instagram. Posts older than ~2 years have none (NA).
   FOLLOWS: Meta reports follows gained per post only for videos and reels; there is no follow or unfollow
   figure for photo posts, and no unfollows per post at all, so it is "Follows", not net. */
function orgVideo(r){ return r.kind==='reel'||r.kind==='video'||Number(r.video_length_s)>0; }
const ORG_COLS={
  views:{k:'Views', get:orgViews, fmt:orgN, has:function(){return true;}},
  viewers:{k:'Viewers', get:function(r){return Number(r.reach)||0;}, fmt:orgN,
    has:function(r){return Number(r.reach)>0;}, why:'Meta has no Viewers figure for this post (it keeps them about two years)'},
  likes:{k:'Interactions', get:orgEng, fmt:orgN, has:function(){return true;}},   // Meta's Interactions (7 Nov, as asked)
  rate:{k:'Engagement Rate', get:function(r){return orgRate(r)||0;}, fmt:function(v){return v.toFixed(2)+'%';}, strong:true,
    has:function(r){return orgViews(r)>0;}, why:'no views recorded yet'},
  netf:{k:'Follows', get:function(r){return Number(r.follows)||0;}, fmt:orgN,
    has:orgVideo, why:'Meta reports follows per post only for videos and reels'},
  dur:{k:'Duration (sec)', get:function(r){return Number(r.video_length_s)||0;}, fmt:function(v){return String(Math.round(v));}, has:orgVideo, why:'videos and reels only'},
  totw:{k:'Watch Time', get:function(r){return Number(r.video_total_time_ms)||0;}, fmt:orgWatch, has:orgVideo, why:'videos and reels only'},
  avgw:{k:'Average Seconds Viewed', get:function(r){return (Number(r.video_avg_watch_ms)||0)/1000;}, fmt:function(v){return v.toFixed(1);}, has:orgVideo, why:'videos and reels only'}
};
function orgColsFor(){ return ['views','viewers','likes','rate','netf','dur','totw','avgw']; }
function orgSortRows(rows){
  const c=ORG_COLS[ORG_SORT], d=ORG_DIR;
  return rows.slice().sort(function(a,b){
    if(!c) return d*String(a.created_time||'').localeCompare(String(b.created_time||''));
    return d*(c.get(a)-c.get(b)) || String(b.created_time||'').localeCompare(String(a.created_time||''));
  });
}
function orgTable(list,cols,opts){
  opts=opts||{};
  const th=function(key,label,num){
    // ranked lists are ordered by interactions until a heading is clicked, so Date is not marked
    const on=ORG_SORT===key && !(opts.rank && key==='date' && ORG_DIR<0);
    return '<th class="sort'+(num?' n':'')+(on?' on':'')+'" onclick="orgSetSort(\''+key+'\')">'+esc(label)
      +(on?'<i class="fa-solid fa-arrow-'+(ORG_DIR<0?'down':'up')+' ar"></i>':'')+'</th>';
  };
  return '<div class="org-tblwrap"><table class="org-tbl"><thead><tr>'
    +(opts.rank?'<th>#</th>':'')+th('date','Post Date',false)+'<th>Post Name</th><th>Post Type</th><th>Content Type</th>'
    +cols.map(function(k){return th(k,ORG_COLS[k].k,true);}).join('')
    +'</tr></thead><tbody>'
    +list.map(function(r,i){
      const thumb=r.thumbnail?'<img class="org-thumb" src="'+esc(r.thumbnail)+'" loading="lazy" referrerpolicy="no-referrer" onerror="orgThumbFail(this)">'
                             :'<div class="org-thumb-ph"><i class="fa-regular fa-image"></i></div>';
      return '<tr onclick="orgOpen(\''+esc(String(r.id))+'\')">'
        +(opts.rank?'<td class="org-rank">'+(i+1)+'</td>':'')
        +'<td class="org-date">'+orgDT(r.created_time)+'</td>'
        +'<td><div class="org-post">'+thumb+'<div class="org-ptxt"><b title="'+esc(String(r.message||'').slice(0,400))+'">'+esc(orgPostName(r))+'</b></div>'
          +'<i class="fa-brands '+(r.network==='instagram'?'fa-instagram':'fa-facebook')+' org-netic" title="'+esc(r.page_name||'')+'"></i></div></td>'
        +'<td><span class="org-tag '+esc(r.kind||'post')+'">'+esc(orgKindLabel(r.kind))+'</span></td>'
        +'<td class="org-ct">'+(r.content_type?esc(r.content_type):'<span class="org-na" title="named and typed from the caption at the next nightly refresh">Pending</span>')+'</td>'
        +cols.map(function(k){ const c=ORG_COLS[k], v=c.get(r), na=!c.has(r);
          const tip=c.why||('Meta does not report this for a '+orgKindLabel(r.kind));
          return '<td class="n'+(c.strong?' org-er':'')+'">'
            +(na?'<span class="org-na" title="'+esc(tip)+'">NA</span>'
                :(v?c.fmt(v):'<span class="org-zero">0</span>'))+'</td>'; }).join('')
      +'</tr>';
    }).join('')+'</tbody></table></div>';
}

/* ---------------- the page ---------------- */
VIEWS.organic=async function(v,seg){
  setCrumb(['Growth & Strategy','Posts & Reels']);
  const ti=mTab(seg,ORG_TABS.length);
  if(ti!==ORG_LAST_TI){ ORG_LAST_TI=ti; ORG_PG=0; ORG_KIND='all'; }
  ORG_NET=ti===1?'facebook':(ti===2?'instagram':'all');
  if(!window._orgDocWired){ window._orgDocWired=true;
    document.addEventListener('click',function(e){ if(ORG_OPEN && !(e.target&&e.target.closest&&e.target.closest('.org-dp'))){ ORG_OPEN=false; renderPage(); } });
  }
  const head=ORG_CSS+mHead('fa-photo-film','#7c3aed','Posts & Reels');
  if(!ORG_ROWS){ v.innerHTML=head+'<div class="loader"><div class="spin"></div></div>'; await orgLoad(); if(PAGE!=='organic') return; }

  const base=(ORG_ROWS||[]).filter(function(r){
    if(!orgInRange(r.created_time)) return false;
    if(ORG_PAGE!=='all' && String(r.page_id)!==String(ORG_PAGE)) return false;
    if(ORG_Q){ const q=ORG_Q.toLowerCase(); if(!String(r.message||'').toLowerCase().includes(q) && !String(r.page_name||'').toLowerCase().includes(q)) return false; }
    return true;
  });
  const scoped=base.filter(function(r){
    if(ti===1) return r.network==='facebook';
    if(ti===2) return r.network==='instagram';
    return true;
  });
  const kc={}; scoped.forEach(function(r){kc[r.kind]=(kc[r.kind]||0)+1;});
  const rows=(ti===1||ti===2)&&ORG_KIND!=='all'?scoped.filter(function(r){return r.kind===ORG_KIND;}):scoped;

  const pageSel='<select class="org-sel" onchange="orgSetPageId(this.value)"><option value="all"'+(ORG_PAGE==='all'?' selected':'')+'>All pages & accounts</option>'
    +(ORG_PAGES||[]).map(function(p){return '<option value="'+esc(p.id)+'"'+(String(ORG_PAGE)===String(p.id)?' selected':'')+'>'+(p.network==='instagram'?'Instagram ':'Facebook ')+esc(p.name||p.id)+'</option>';}).join('')+'</select>';
  let chips='';
  if(ti===1||ti===2){
    chips='<div class="org-bar">'+['all','post','video','reel','carousel'].map(function(k){
      const n=k==='all'?scoped.length:(kc[k]||0);
      if(k!=='all'&&!n&&ORG_KIND!==k) return '';
      const lbl={all:'All types',post:'Static Posts',video:'Videos',reel:'Reels',carousel:'Carousel Posts'}[k];
      return '<button class="org-fbtn'+(ORG_KIND===k?' on':'')+'" onclick="orgSetKind(\''+k+'\')">'+esc(lbl)+'<span class="n">'+n+'</span></button>';
    }).join('')+'</div>';
  }
  const bar='<div class="org-top">'+orgDatePicker()
    +'<input class="org-search" id="orgQ" placeholder="Search caption or page…" value="'+esc(ORG_Q)+'" oninput="orgSearch(this.value)">'
    +pageSel+'</div>';

  let body='';
  const igLinked=(ORG_PAGES||[]).some(function(p){return p.network==='instagram';});
  if(ti===0){
    body=orgOverview(rows);
  } else if(!rows.length){
    let msg;
    if(ti===2&&!igLinked) msg='<i class="fa-brands fa-instagram"></i>Instagram is not linked to the Jain Group Facebook Page yet, so Meta sends nothing for it.<br>'
      +'Link it in Meta Business Suite (Settings → Accounts → Instagram accounts), and it fills in at the next nightly refresh.';
    else if((ORG_ROWS||[]).length) msg='<i class="fa-regular fa-folder-open"></i>Nothing in this date range or filter.<br>Try widening the dates, or choose <b>Lifetime</b>.';
    else msg='<i class="fa-regular fa-folder-open"></i>Nothing saved yet - it fills in at the nightly refresh.';
    body='<div class="org-empty">'+msg+'</div>';
  } else if(ti===3){
    const top=rows.slice().sort(function(a,b){return orgEng(b)-orgEng(a);}).slice(0,20);
    const sorted=ORG_SORT==='date'&&ORG_DIR===-1?top:orgSortRows(top);
    body='<div class="org-note"><i class="fa-solid fa-trophy"></i><span>The 20 posts and reels with the most interactions (reactions + comments + shares + saves) in the period. Click a heading to re-order them.</span></div>'
      +orgTable(sorted,orgColsFor(3,sorted),{rank:true});
  } else {
    const list=orgSortRows(rows);
    const pages=Math.max(1,Math.ceil(list.length/ORG_PER));
    if(ORG_PG>=pages)ORG_PG=pages-1;
    const slice=list.slice(ORG_PG*ORG_PER,(ORG_PG+1)*ORG_PER);
    const note=ti===1?'<b>Viewers</b> = unique people who saw the post (Meta keeps them about two years). <b>Follows</b> = follows gained, reported by Meta for videos and reels only. Engagement Rate = Interactions ÷ Views × 100.'
      :'Instagram'+"'"+'s per-post reach is shown as <b>Viewers</b>. Engagement Rate = Interactions ÷ Views × 100.';
    body='<div class="org-note"><i class="fa-solid fa-circle-info"></i><span>'+note+' Click a column heading to sort.</span></div>'
      +chips+orgTable(slice,orgColsFor(ti,slice))
      +'<div class="org-pager"><span class="info">Showing '+(ORG_PG*ORG_PER+1)+'–'+Math.min((ORG_PG+1)*ORG_PER,list.length)+' of '+list.length+'</span>'
      +'<span><button onclick="orgGo(-1)"'+(ORG_PG<=0?' disabled':'')+'><i class="fa-solid fa-chevron-left"></i> Previous</button> '
      +'<button onclick="orgGo(1)"'+(ORG_PG>=pages-1?' disabled':'')+'>Next <i class="fa-solid fa-chevron-right"></i></button></span></div>';
  }
  v.innerHTML=head+orgStatusBar()+bar+mTabs('organic',ORG_TABS,ti)+'<div style="margin-top:14px">'+body+'</div>';
};

// Daily Page reach as bars - one per day in the range (Meta's own Viewers figure).
function orgDailyChart(days){
  if(!days.length) return '';
  const W=900,H=150,pad=22, max=Math.max.apply(null,days.map(function(d){return Number(d.viewers)||0;}))||1;
  const bw=(W-pad)/days.length;
  const bars=days.map(function(d,i){ const h=Math.round((Number(d.viewers)||0)/max*(H-pad-8));
    return '<rect x="'+(pad+i*bw+1).toFixed(1)+'" y="'+(H-pad-h)+'" width="'+Math.max(1,bw-2).toFixed(1)+'" height="'+h+'"><title>'
      +esc(new Date(d.day+'T00:00:00').toLocaleDateString('en-IN',{day:'numeric',month:'short'}))+': '+orgN(d.viewers)+' viewers</title></rect>'; }).join('');
  const lab=function(i){ const d=days[i]; return '<text x="'+(pad+i*bw).toFixed(1)+'" y="'+(H-6)+'">'
    +esc(new Date(d.day+'T00:00:00').toLocaleDateString('en-IN',{day:'numeric',month:'short'}))+'</text>'; };
  return '<svg class="org-chart" viewBox="0 0 '+W+' '+H+'" preserveAspectRatio="none">'
    +'<text x="0" y="12">'+orgN(max)+'</text>'+bars+lab(0)+(days.length>1?lab(days.length-1):'')+'</svg>';
}

function orgOverview(rows){
  const days=(ORG_DAILY||[]).filter(function(d){ return orgInRange(d.day) && (ORG_PAGE==='all'||String(d.page_id)===String(ORG_PAGE)); });
  const sum=function(k){ return days.reduce(function(a,d){return a+(Number(d[k])||0);},0); };
  const fb=(ORG_PAGES||[]).filter(function(p){return p.network==='facebook';});
  const ig=(ORG_PAGES||[]).filter(function(p){return p.network==='instagram';});
  const fbFollowers=fb.reduce(function(a,p){return a+(Number(p.followers)||Number(p.fan_count)||0);},0);
  const igFollowers=ig.reduce(function(a,p){return a+(Number(p.followers)||0);},0);
  const tot=rows.reduce(function(a,r){
    a.eng+=orgEng(r); a.shares+=Number(r.shares)||0;
    if(r.kind==='reel'){ a.reels++; a.plays+=orgViews(r); a.watch+=Number(r.video_total_time_ms)||0; a.follows+=Number(r.follows)||0; }
    return a; },{eng:0,shares:0,reels:0,plays:0,watch:0,follows:0});
  const kpi=function(icon,k,val,sub){return '<div class="org-kpi"><div class="k"><i class="fa-solid '+icon+'"></i> '+k+'</div><div class="v">'+val+'</div>'+(sub?'<div class="s">'+sub+'</div>':'')+'</div>';};
  const dash='—';
  const kpis='<div class="org-h2"><i class="fa-brands fa-facebook"></i> The Page</div><div class="org-kpis">'
    +kpi('fa-users','Followers',orgN(fbFollowers+igFollowers),'Facebook '+orgN(fbFollowers)+' · Instagram '+(ig.length?orgN(igFollowers):'not linked'))
    +kpi('fa-eye','Reach (viewers)',days.length?orgN(sum('viewers')):dash,'added up day by day')
    +kpi('fa-play','Views',days.length?orgN(sum('views')):dash,'times content was seen')
    +kpi('fa-user-plus','New follows',days.length?orgN(sum('new_follows')):dash,days.length?orgN(sum('unfollows'))+' unfollowed':'')
    +kpi('fa-hand-pointer','Engagements',days.length?orgN(sum('engagements')):dash,'on the Page\'s posts')
    +kpi('fa-door-open','Page visits',days.length?orgN(sum('page_visits')):dash,'')
    +kpi('fa-video','Video views',days.length?orgN(sum('video_views')):dash,'')
    +kpi('fa-layer-group','Published',String(rows.length),tot.reels+' reels · '+(rows.length-tot.reels)+' posts')
    +'</div>'
    +'<div class="org-h2"><i class="fa-solid fa-film"></i> Reels</div><div class="org-kpis">'
    +kpi('fa-play','Plays',orgN(tot.plays),'')
    +kpi('fa-clock','Watch time',tot.watch?orgWatch(tot.watch):dash,'all viewers together')
    +kpi('fa-share','Shares (all content)',orgN(tot.shares),'')
    +kpi('fa-user-plus','Follows from reels',orgN(tot.follows),'')
    +'</div>';
  const chart=days.length>1?'<div class="org-card"><div class="org-h2" style="margin-top:0"><i class="fa-solid fa-chart-column"></i> Page reach by day</div>'+orgDailyChart(days)+'</div>':'';
  const agg=function(keyFn){
    const o={}; rows.forEach(function(r){ const k=keyFn(r)||'—';
      (o[k]=o[k]||{n:0,views:0,eng:0}); o[k].n++; o[k].views+=orgViews(r); o[k].eng+=orgEng(r); });
    return o; };
  const tbl=function(obj,lbl){
    const keys=Object.keys(obj).sort(function(a,b){return obj[b].eng-obj[a].eng;});
    if(!keys.length) return '<div class="org-empty" style="padding:18px">Nothing published in this period.</div>';
    return '<div class="org-tblwrap"><table class="org-tbl plain" style="min-width:420px"><thead><tr><th>'+lbl+'</th><th class="n">Posts</th><th class="n">Views</th><th class="n">Interactions</th><th class="n">Avg / post</th></tr></thead><tbody>'
      +keys.map(function(k){const o=obj[k];return '<tr><td><b>'+esc(k)+'</b></td><td class="n">'+o.n+'</td>'
        +'<td class="n">'+(o.views?orgN(o.views):dash)+'</td><td class="n">'+orgN(o.eng)+'</td><td class="n org-er">'+orgN(Math.round(o.eng/o.n))+'</td></tr>';}).join('')
      +'</tbody></table></div>';
  };
  const top=rows.slice().sort(function(a,b){return orgEng(b)-orgEng(a);}).slice(0,5);
  return kpis+chart
    +'<div class="org-h2"><i class="fa-solid fa-shapes"></i> By post type</div>'+tbl(agg(function(r){return orgKindLabel(r.kind)+'s';}),'Post type')
    +(top.length?'<div class="org-h2" style="margin-top:14px"><i class="fa-solid fa-trophy"></i> Top 5 this period</div>'+orgTable(top,['views','likes','rate'],{rank:true}):'')
    +'<div class="org-note" style="margin-top:14px"><i class="fa-solid fa-circle-info"></i><span><b>Reach</b> here is Meta\'s daily Viewers for the Page, added up day by day - someone who saw the Page on two days counts twice, as Meta gives no de-duplicated total. Meta does not give reach for each Facebook post.</span></div>';
}
