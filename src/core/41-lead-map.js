/* ============================ LEAD MAP ============================
   Where our Site Visit and Booked customers come from, by PIN code, one month at a time (30 Oct 2026).
   Its own module ('lead_map') under Sales.

   A red pin for every PIN code that had a Site Visit or Booking in the chosen month, for Dream
   Ananta, Dream Gurukul and Dream World City; the number on the pin is how many. A new month starts
   with an empty map on the 1st. The months before stay as they were - pick one to see it.

   WHERE THE DATA COMES FROM. The CRM, read every morning and evening by the digital-metrics-sync
   worker (lead-map.ts) once its API address is saved as a Supabase secret - no change here needed.
   PIN codes can also be typed in below. Only the PIN code, project, type and date are kept - never a
   name or phone number. A pin marks the MIDDLE of the PIN code area, not anybody's address.

   THE MAP. Google Maps once GOOGLE_MAPS_BROWSER_KEY is set as a Supabase secret; until then the same
   red pins on OpenStreetMap, so it works from day one. */
// LM_MONTH is 'YYYY-MM', or 'all' (every month from January 2026 together - the default).
let LM_MONTH='all', LM_PROJ='all', LM_KIND='all', LM_MAP=null, LM_KEY;
let LM_GEO_TRIES=0; const LM_GEO_MAX=25;   // a backstop under the progress test in lmRender()
const LM_PROJECTS=['Dream Ananta','Dream Gurukul','Dream World City'];
const LM_KINDS={site_visit:'Site Visit',booked:'Booked',test:'Test'};
const LM_FN=SUPABASE_URL+'/functions/v1/digital-metrics-sync';
// The look of both Lead Map pages, kept in one place. Uses the app's own colour variables.
const LM_CSS='<style>'
  +'.lm-head{display:flex;justify-content:space-between;align-items:flex-start;gap:16px;flex-wrap:wrap;margin-bottom:16px}'
  +'.lm-head h1{margin:0;font-size:24px;font-weight:700;display:flex;align-items:center;gap:10px}'
  +'.lm-head p{margin:5px 0 0;color:var(--slate);font-size:13.5px;max-width:760px;line-height:1.5}'
  +'.lm-bar{display:flex;gap:10px;flex-wrap:wrap;align-items:center;padding:12px 14px;border:1px solid var(--line);border-radius:12px;background:var(--card,#fff);margin-bottom:16px}'
  +'.lm-ring{display:inline-block;width:12px;height:12px;border-radius:50%;border:2px solid;background:transparent;vertical-align:-2px;margin-right:2px}'
  +'.lm-kpis{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;margin-bottom:16px}'
  +'.lm-kpi{background:var(--card,#fff);border:1px solid var(--line);border-radius:12px;padding:14px 16px;min-width:0}'
  +'.lm-kpi .k-l{font-size:11.5px;color:var(--slate);font-weight:700;text-transform:uppercase;letter-spacing:.5px}'
  +'.lm-kpi .k-v{font-size:28px;font-weight:700;margin-top:6px;line-height:1.1}'
  +'.lm-kpi .k-v small{font-size:14px;color:var(--slate);font-weight:600}'
  +'.lm-kpi .k-s{font-size:12px;color:var(--slate);margin-top:6px;line-height:1.45}'
  +'.lm-main{display:grid;grid-template-columns:minmax(0,1fr) 360px;gap:16px}'
  +'.lm-mapcard{border:1px solid var(--line);border-radius:12px;overflow:hidden;background:var(--card,#fff);display:flex;flex-direction:column;min-width:0}'
  +'#lmMap{height:620px;background:#e8edf3}'
  +'.lm-dist-btn{margin-left:auto;display:inline-flex;align-items:center;gap:8px;height:36px;padding:0 16px;border-radius:9px;border:1px solid #bfdbfe;background:#eff6ff;color:#1d4ed8;font:inherit;font-size:13px;font-weight:700;cursor:pointer;transition:.15s}'
  +'.lm-dist-btn:hover{background:#dbeafe;border-color:#93c5fd}'
  +'.lm-dist-btn.on{background:#1d4ed8;border-color:#1d4ed8;color:#fff}'
  +'.lm-mapwrap{position:relative}'
  +'.lm-maplegend{position:absolute;left:10px;bottom:22px;z-index:900;background:rgba(255,255,255,.95);border:1px solid var(--line);border-radius:10px;padding:8px 11px;font-size:12px;line-height:1.75;color:#334155;box-shadow:0 2px 10px rgba(15,23,42,.12)}'
  +'.lm-maplegend svg{vertical-align:-2px;margin:0 3px 0 1px}'
  // map buttons (re-center, full screen) styled like the zoom buttons
  +'.lm-ctl a{display:flex!important;align-items:center;justify-content:center;width:30px;height:30px;color:#334155;font-size:14px;cursor:pointer;background:#fff}'
  +'.lm-ctl a:hover{background:#f4f4f4;color:#1d4ed8}'
  // the map-style switch, as a compact row of choices
  +'#lmMap .leaflet-control-layers{border:1px solid var(--line);border-radius:10px;box-shadow:0 2px 10px rgba(15,23,42,.12);padding:0}'
  +'#lmMap .leaflet-control-layers-base{display:flex;gap:2px;padding:4px}'
  +'#lmMap .leaflet-control-layers-base label{margin:0}'
  +'#lmMap .leaflet-control-layers-base label>span{display:block;cursor:pointer}'
  +'#lmMap .leaflet-control-layers-base input{display:none}'
  +'#lmMap .leaflet-control-layers-base input+span{padding:5px 11px;border-radius:7px;font:600 12px Inter,system-ui,sans-serif;color:#475569}'
  +'#lmMap .leaflet-control-layers-base input:checked+span{background:#1d4ed8;color:#fff}'
  +'#lmMap .leaflet-control-layers-separator,#lmMap .leaflet-control-layers-overlays{display:none}'
  +'.lm-mapcard:fullscreen{border-radius:0;border:0}'
  +'.lm-mapcard:fullscreen .lm-mapwrap{flex:1;min-height:0}.lm-mapcard:fullscreen #lmMap{height:100%}'
  // the distance panel floats over the map's top-left corner
  +'.lm-measure{position:absolute;top:10px;left:56px;z-index:1000;width:320px;max-width:calc(100% - 70px);background:#fff;border:1px solid var(--line);border-radius:12px;box-shadow:0 8px 28px rgba(15,23,42,.18);padding:12px;font-size:13px}'
  +'.lm-measure input{width:100%;height:34px;border:1px solid var(--line);border-radius:8px;padding:0 10px;font:inherit;font-size:13px}'
  +'.lm-measure .row{display:flex;gap:6px}'
  +'.lm-pt{display:grid;grid-template-columns:22px minmax(0,1fr) auto;gap:8px;align-items:center;padding:7px 0;border-bottom:1px solid #f1f5f9}'
  +'.lm-pt .dot{width:20px;height:20px;border-radius:50%;background:#1d4ed8;color:#fff;font-size:11px;font-weight:700;display:flex;align-items:center;justify-content:center}'
  +'.lm-pt .nm{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.lm-pt .leg{font-size:11.5px;color:var(--slate)}'
  +'.lm-search{position:relative}'
  +'.lm-search>i{position:absolute;left:11px;top:11px;color:#94a3b8;font-size:13px}'
  +'.lm-search input{height:38px;padding-left:32px!important;border-radius:9px!important}'
  +'.lm-search input:focus{outline:none;border-color:#1d4ed8;box-shadow:0 0 0 3px rgba(29,78,216,.12)}'
  +'.lm-sug-box{position:absolute;left:0;right:0;top:42px;z-index:5;background:#fff;border:1px solid var(--line);border-radius:10px;box-shadow:0 10px 28px rgba(15,23,42,.18);padding:4px;max-height:300px;overflow:auto}'
  +'.lm-sug{display:grid;grid-template-columns:18px minmax(0,1fr);gap:8px;padding:8px 9px;border-radius:7px;cursor:pointer;align-items:start}'
  +'.lm-sug.on,.lm-sug:hover{background:#eff6ff}.lm-sug i{color:#1d4ed8;margin-top:3px;text-align:center}'
  +'.lm-sug .t{font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.lm-sug .s{font-size:11.5px;color:var(--slate);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}'
  +'.lm-sug-msg{padding:8px 10px;font-size:12px;color:var(--slate)}'
  +'.lm-pick{display:grid;grid-template-columns:14px minmax(0,1fr);column-gap:6px;padding:6px 8px;border-radius:7px;cursor:pointer;color:var(--ink)}.lm-pick:hover{background:#eff6ff}'
  +'.lm-pick i{color:#1d4ed8;margin-top:2px}.lm-pick span{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.lm-pick small{grid-column:2;color:var(--slate);font-size:11px}'
  +'.lm-tot{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:10px}.lm-tot div{background:#f8fafc;border-radius:8px;padding:8px 10px}.lm-tot b{display:block;font-size:17px}'
  +'.lm-tot span{font-size:11px;color:var(--slate);text-transform:uppercase;letter-spacing:.4px;font-weight:700}'
  +'.lm-note{font-size:11.5px;color:var(--slate);padding:8px 12px;border-top:1px solid var(--line)}'
  +'.lm-side{border:1px solid var(--line);border-radius:12px;background:var(--card,#fff);display:flex;flex-direction:column;height:700px;min-width:0}'
  +'.lm-side-h{padding:12px 14px;border-bottom:1px solid var(--line);display:flex;flex-direction:column;gap:10px}'
  +'.lm-side-h input{height:34px;border:1px solid var(--line);border-radius:8px;padding:0 10px;font:inherit;font-size:13px}'
  +'.lm-cols{display:flex;gap:6px;font-size:11px;color:var(--slate);font-weight:700;text-transform:uppercase}.lm-cols span{width:38px;text-align:center}'
  +'.lm-list{overflow-y:auto;flex:1}'
  +'.lm-item{display:grid;grid-template-columns:22px minmax(0,1fr) auto;gap:10px;padding:10px 14px;border-bottom:1px solid var(--line-2,#eef1f6);cursor:pointer;align-items:center}'
  +'.lm-item:hover{background:#f8fafc}'
  +'.lm-rank{font-size:11.5px;color:#94a3b8;font-weight:700;text-align:right}'
  +'.lm-code{font-weight:700;font-size:13.5px}'
  +'.lm-area{font-size:12px;color:var(--slate);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}'
  +'.lm-near{font-size:11.5px;margin-top:2px;font-weight:600}'
  +'.lm-up{font-size:11px;color:#94a3b8;margin-top:2px}.lm-up i{margin-right:3px}'
  +'.lm-test{font-size:10.5px;font-weight:700;color:#64748b;background:#f1f5f9;border-radius:6px;padding:1px 6px;vertical-align:1px}'
  +'.lm-counts{display:flex;gap:6px}'
  +'.lm-c{width:38px;text-align:center;border-radius:8px;padding:4px 0;font-size:12.5px;font-weight:700}'
  +'.lm-c.sv{background:#fef2f2;color:#dc2626}.lm-c.bk{background:#f0fdf4;color:#16a34a}.lm-c.z{color:#cbd5e1}'
  +'.lm-empty{text-align:center;color:var(--slate);padding:50px 20px;display:flex;flex-direction:column;align-items:center;gap:12px;font-size:13px}.lm-empty i{font-size:30px;color:#cbd5e1}'
  +'@media(max-width:1200px){.lm-kpis{grid-template-columns:repeat(2,minmax(0,1fr))}.lm-main{grid-template-columns:1fr}.lm-side{height:auto;max-height:520px}.lm-dist-btn{margin-left:0}}'
  +'@media(max-width:600px){#lmMap{height:440px}}'
  // the Add PIN codes page
  +'.lm-form{width:100%}'
  +'.lm-tip{display:flex;gap:10px;align-items:flex-start;padding:12px 14px;border-radius:10px;background:#eff6ff;color:#1e3a8a;font-size:13px;line-height:1.5;margin-bottom:16px}'
  +'.lm-batch{border:1px solid var(--line);border-radius:12px;background:var(--card,#fff);margin-bottom:16px;overflow:hidden}'
  +'.lm-batch-top{display:grid;grid-template-columns:auto minmax(180px,1.4fr) minmax(150px,1fr) minmax(150px,1fr) auto;gap:14px;padding:14px 16px;background:#f8fafc;border-bottom:1px solid var(--line);align-items:end}'
  +'.lm-batch-hd{font-weight:700;font-size:13px;color:var(--ink);align-self:center;white-space:nowrap}'
  +'.lm-batch-top label{display:flex;flex-direction:column;gap:5px;font-size:11.5px;font-weight:700;color:var(--slate);text-transform:uppercase;letter-spacing:.4px}'
  +'.lm-batch-top select,.lm-batch-top input{height:38px;border:1px solid var(--line);border-radius:8px;padding:0 10px;font:inherit;font-size:13.5px;text-transform:none;letter-spacing:0;background:#fff;color:var(--ink)}'
  +'.lm-grid{width:100%;border-collapse:collapse}'
  +'.lm-grid thead th{font-size:11px;text-transform:uppercase;letter-spacing:.5px;color:#7b8aa3;text-align:left;padding:10px 8px;background:#fff;border-bottom:1px solid var(--line);position:static}'
  +'.lm-grid td{padding:6px 8px;border-bottom:1px solid var(--line-2,#eef1f6);vertical-align:middle}'
  +'.lm-grid td.n{width:40px;color:#94a3b8;font-size:12px;text-align:right;padding-left:16px}'
  +'.lm-grid input,.lm-grid select{width:100%;height:36px;border:1px solid var(--line);border-radius:8px;padding:0 10px;font:inherit;font-size:13.5px;background:#fff;color:var(--ink)}'
  +'.lm-grid input:focus,.lm-grid select:focus,.lm-batch-top select:focus,.lm-batch-top input:focus{outline:none;border-color:var(--brand,#2563eb);box-shadow:0 0 0 3px rgba(37,99,235,.12)}'
  +'.lm-grid tr.bad input.lm-pin,.lm-grid tr.bad input.lm-num{border-color:#dc2626;background:#fef2f2}'
  +'.lm-ccbtn{width:100%;height:36px;display:flex;align-items:center;gap:8px;border:1px solid var(--line);border-radius:8px;padding:0 10px;background:#fff;font:inherit;font-size:13.5px;color:var(--ink);cursor:pointer;text-align:left}'
  +'.lm-ccbtn span{flex:1}.lm-ccbtn i{font-size:10px;color:#94a3b8}.lm-ccbtn:hover{border-color:#94a3b8}'
  +'.lm-flag{width:22px;height:15px;object-fit:cover;border-radius:3px;box-shadow:0 0 0 1px rgba(15,23,42,.12);flex:none}'
  +'.lm-cclist{position:absolute;z-index:3000;background:#fff;border:1px solid var(--line);border-radius:10px;box-shadow:0 10px 30px rgba(15,23,42,.18);padding:6px;max-height:300px;overflow:auto}'
  +'.lm-ccopt{display:flex;align-items:center;gap:10px;padding:7px 10px;border-radius:7px;cursor:pointer;font-size:13.5px}.lm-ccopt:hover{background:#f1f5f9}'
  +'.lm-st{font-size:12px;line-height:1.35}.lm-st.ok{color:#16a34a;font-weight:600}.lm-st.err{color:#b91c1c}'
  +'.lm-x{border:0;background:none;color:#94a3b8;cursor:pointer;width:32px;height:32px;border-radius:8px}.lm-x:hover{background:#fef2f2;color:#dc2626}'
  +'.lm-addrow{display:flex;gap:8px;align-items:center;padding:12px 16px;color:var(--brand,#2563eb);font-weight:600;font-size:13px;cursor:pointer;background:none;border:0;font-family:inherit}'
  +'.lm-addrow:hover{text-decoration:underline}'
  +'.lm-foot{position:sticky;bottom:12px;display:flex;gap:10px;align-items:center;flex-wrap:wrap;padding:12px 16px;background:var(--card,#fff);border:1px solid var(--line);border-radius:12px;box-shadow:0 6px 24px rgba(15,23,42,.10);z-index:5}'
  +'@media(max-width:800px){.lm-batch-top{grid-template-columns:1fr 1fr}.lm-batch-hd{grid-column:1/-1}}'
  +'</style>';
window.lmFilterList=function(q){
  q=String(q||'').trim().toLowerCase();
  document.querySelectorAll('#lmList .lm-item').forEach(function(el){ el.style.display=!q||el.dataset.q.indexOf(q)!==-1?'':'none'; });
};
function lmIst(){ return new Date(Date.now()+5.5*3600000).toISOString().slice(0,10); }
function lmMonths(){
  const out=[], now=lmIst().slice(0,7);
  for(let y=2026,m=1;(y+'-'+String(m).padStart(2,'0'))<=now;m++){ if(m>12){m=0;y++;continue;} out.push(y+'-'+String(m).padStart(2,'0')); }
  return out.reverse();
}
const lmMonthName=function(ym){ return ym==='all'?'All months':new Date(ym+'-01T00:00:00').toLocaleDateString('en-IN',{month:'long',year:'numeric'}); };
// The date a new entry defaults to: today when looking at this month or at all months, else the 1st.
function lmDefaultDate(){ return (LM_MONTH==='all'||LM_MONTH===lmIst().slice(0,7))?lmIst():LM_MONTH+'-01'; }
async function lmCall(body){
  const {data:{session}}=await sb.auth.getSession();
  const r=await fetch(LM_FN,{method:'POST',headers:{'Content-Type':'application/json','apikey':SUPABASE_KEY,'Authorization':'Bearer '+((session&&session.access_token)||'')},body:JSON.stringify(body)});
  const jr=await r.json().catch(function(){return {};});
  if(!r.ok||jr.error)throw new Error(jr.error||('server said '+r.status));
  return jr;
}
function lmLoadScript(src){ return new Promise(function(res,rej){ if(document.querySelector('script[src="'+src+'"]'))return res(); const s=document.createElement('script'); s.src=src; s.onload=res; s.onerror=function(){rej(new Error('could not load '+src));}; document.head.appendChild(s); }); }
function lmLoadCss(href){ if(document.querySelector('link[href="'+href+'"]'))return; const l=document.createElement('link'); l.rel='stylesheet'; l.href=href; document.head.appendChild(l); }
// The Google key is asked for once per visit; none set yet = OpenStreetMap.
async function lmMapKey(){ if(LM_KEY!==undefined)return LM_KEY; try{ LM_KEY=(await lmCall({action:'lead_map_key'})).key||null; }catch(e){ LM_KEY=null; } return LM_KEY; }

VIEWS.lead_map=async function(v,seg){
  if(seg&&seg[0]==='add')return lmAddPage(v);
  setCrumb(['Sales','Lead Map']);
  const sel=function(id,opts,cur,fn){ return '<select class="mu-sel" id="'+id+'" onchange="'+fn+'(this.value)">'+opts.map(function(o){return '<option value="'+esc(o[0])+'"'+(o[0]===cur?' selected':'')+'>'+esc(o[1])+'</option>';}).join('')+'</select>'; };
  v.innerHTML=LM_CSS
    +'<div class="lm-head"><div><h1><i class="fa-solid fa-map-location-dot" style="color:#dc2626"></i> Lead Map</h1>'
      +'<p>Where our Site Visit and Booked customers come from, by PIN code - one map per month.</p></div>'
      +'<button class="btn btn-primary" onclick="navTo(\'lead_map/add\')"><i class="fa-solid fa-plus"></i> Add PIN codes</button></div>'
    +'<div class="lm-bar">'
      +sel('lmMonth',[['all','All months']].concat(lmMonths().map(function(m){return [m,lmMonthName(m)];})),LM_MONTH,'lmSetMonth')
      +sel('lmProj',[['all','All three projects']].concat(LM_PROJECTS.map(function(p){return [p,p];})),LM_PROJ,'lmSetProj')
      +sel('lmKind',[['all','Site Visit + Booked'],['site_visit','Site Visit only'],['booked','Booked only']],LM_KIND,'lmSetKind')
      +'<button class="lm-dist-btn" id="lmMeasureBtn" onclick="lmMeasureToggle()"><i class="fa-solid fa-route"></i> Distance between places</button>'
    +'</div>'
    +'<div id="lmBody"><div class="loader"><div class="spin"></div></div></div>';
  try{ await lmRender(); }catch(e){ $('lmBody').innerHTML='<div class="card card-pad empty"><i class="fa-solid fa-triangle-exclamation"></i><div>Could not load: '+esc(e.message||String(e))+'</div></div>'; }
};
window.lmSetMonth=function(m){ LM_MONTH=m; LM_GEO_TRIES=0; renderPage(); };
window.lmSetProj=function(p){ LM_PROJ=p; LM_GEO_TRIES=0; renderPage(); };
window.lmSetKind=function(k){ LM_KIND=k; LM_GEO_TRIES=0; renderPage(); };

async function lmRender(){
  /* "All months" asks for each month and adds them up here: the same counts camp.lm_month gives,
     month by month, so nothing is counted twice or estimated. */
  const months=LM_MONTH==='all'?lmMonths():[LM_MONTH];
  const res=await Promise.all(months.map(function(m){ return sb.schema('camp').rpc('lm_month',{p_month:m+'-01'}); }));
  const err=res.filter(function(r){return r.error;})[0]; if(err)throw err.error;
  const merged={};
  res.forEach(function(r){ (r.data||[]).forEach(function(x){
    const k=x.pincode+'|'+(x.project||'')+'|'+x.kind;
    if(merged[k])merged[k].n=Number(merged[k].n)+Number(x.n); else merged[k]=Object.assign({},x,{n:Number(x.n)});
  }); });
  const data=Object.keys(merged).map(function(k){return merged[k];});
  const ups=await lmUploads(months);
  // test pins (typed in to try the map) show only with "All three projects"
  const rows=(data||[]).filter(function(r){
    if(LM_PROJ!=='all'&&r.project!==LM_PROJ)return false;
    if(LM_KIND!=='all'&&r.kind!==LM_KIND&&!(r.kind==='test'&&LM_PROJ==='all'))return false;
    return true; });
  const byPin={};
  rows.forEach(function(r){
    const p=byPin[r.pincode]=byPin[r.pincode]||{pincode:r.pincode,lat:r.lat,lng:r.lng,place:r.place,district:r.district,state:r.state,err:r.lookup_error,n:0,sv:0,bk:0,test:0,lines:[]};
    p.n+=Number(r.n); if(r.kind==='site_visit')p.sv+=Number(r.n); else if(r.kind==='booked')p.bk+=Number(r.n); else p.test+=Number(r.n);
    p.lines.push((r.project||'Test pin')+' · '+LM_KINDS[r.kind]+': '+r.n);
  });
  const pins=Object.keys(byPin).map(function(k){return byPin[k];}).sort(function(a,b){return b.n-a.n;});
  pins.forEach(function(p){ p.ups=ups[p.pincode]||[]; });
  const placed=pins.filter(function(p){return p.lat!=null;}), waiting=pins.filter(function(p){return p.lat==null;});
  const tot=function(k){ return pins.reduce(function(a,p){return a+p[k];},0); };
  const people=tot('sv')+tot('bk'), abroad=pins.filter(function(p){return p.lat!=null&&!lmInIndia(p);}).length;
  const pct=function(n){ return people?Math.round(n*100/people)+'%':'—'; };
  // people whose PIN code centre is inside a project's 10 km circle (test pins not counted)
  const groups=lmSiteGroups().map(function(g){ return {g:g,n:placed.reduce(function(a,p){return a+(lmKm(p,g)<=LM_RADIUS_KM?p.sv+p.bk:0);},0)}; });
  const anyNear=placed.reduce(function(a,p){ return a+(lmSiteGroups().some(function(g){return lmKm(p,g)<=LM_RADIUS_KM;})?p.sv+p.bk:0); },0);
  const kpi=function(label,val,sub,color){ return '<div class="lm-kpi"><div class="k-l">'+label+'</div><div class="k-v" style="color:'+color+'">'+val+'</div><div class="k-s">'+sub+'</div></div>'; };
  $('lmBody').innerHTML='<div class="lm-kpis">'
      +kpi('Site Visits',tot('sv'),esc(lmMonthName(LM_MONTH)),'#dc2626')
      +kpi('Booked',tot('bk'),people?'1 booking per '+(tot('bk')?(tot('sv')/tot('bk')).toFixed(1):'—')+' site visits':esc(lmMonthName(LM_MONTH)),'#16a34a')
      +kpi('PIN codes',pins.length,[abroad?abroad+' outside India':'',tot('test')?tot('test')+' test pin'+(tot('test')===1?'':'s'):'',waiting.length?waiting.length+' not on the map yet':''].filter(Boolean).join(' · ')||'all on the map','#0f172a')
      +kpi('Within 10 km',anyNear+' <small>'+pct(anyNear)+'</small>',groups.map(function(x){return '<span style="color:'+x.g.color+';font-weight:600">'+esc(x.g.label)+'</span> '+x.n;}).join(' · '),'#0f172a')
    +'</div>'
    +'<div class="lm-main">'
      +'<div class="lm-mapcard" id="lmMapCard">'
        +'<div class="lm-mapwrap"><div id="lmMap"></div><div class="lm-measure" id="lmMeasure" hidden></div>'
          // the key, in the map's bottom-left corner
          +'<div class="lm-maplegend"><div><svg width="11" height="15" viewBox="0 0 30 42"><path d="M15 1C7.3 1 1 7.2 1 14.9 1 25.4 15 41 15 41s14-15.6 14-26.1C29 7.2 22.7 1 15 1z" fill="#ea4335"/></svg> Customers</div>'
            +lmSiteGroups().map(function(g){ return '<div><i class="lm-ring" style="border-color:'+g.color+'"></i> '+esc(lmShortSite(g.label))+' · 10 km</div>'; }).join('')+'</div>'
        +'</div>'
        +'<div id="lmMapNote" class="lm-note"></div></div>'
      +'<div class="lm-side"><div class="lm-side-h"><div style="display:flex;justify-content:space-between;align-items:baseline"><b>PIN codes</b><span class="lm-cols"><span>SV</span><span>Bkd</span></span></div>'
        +(pins.length>8?'<input placeholder="Find a PIN code or area…" oninput="lmFilterList(this.value)">':'')+'</div>'
        +'<div class="lm-list" id="lmList">'
        +(pins.length?pins.map(function(p,i){
            const near=lmNear(p)[0];
            return '<div class="lm-item" data-q="'+esc((p.pincode+' '+(p.place||'')+' '+(p.district||'')).toLowerCase())+'" onclick="lmFocus('+JSON.stringify(p.pincode).replace(/"/g,'&quot;')+')">'
              +'<div class="lm-rank">'+(i+1)+'</div>'
              +'<div style="min-width:0"><div class="lm-code">'+esc(lmCodeLabel(p.pincode))+(p.test?' <span class="lm-test">test</span>':'')+'</div>'
                +'<div class="lm-area">'+esc(p.place||[p.district,p.state].filter(Boolean).join(', ')||'')+'</div>'
                +(p.lat==null?'<div class="lm-near" style="color:#b45309">'+esc(p.err||'finding it on the map…')+'</div>'
                  :near?'<div class="lm-near" style="color:'+near.color+'">'+near.km.toFixed(1)+' km from '+esc(near.label)+'</div>':'')
                +(p.ups.length?'<div class="lm-up"><i class="fa-regular fa-clock"></i> '+(p.ups.length>1?'Last uploaded ':'Uploaded ')+esc(lmWhen(p.ups[0].at))+'</div>':'')+'</div>'
              +'<div class="lm-counts"><span class="lm-c '+(p.sv?'sv':'z')+'">'+(p.sv||'–')+'</span><span class="lm-c '+(p.bk?'bk':'z')+'">'+(p.bk||'–')+'</span></div></div>';
          }).join('')
          :'<div class="lm-empty"><i class="fa-solid fa-map-pin"></i><div>No Site Visits or Bookings for '+esc(lmMonthName(LM_MONTH))+' yet.</div>'
            +'<button class="btn btn-primary btn-sm" onclick="navTo(\'lead_map/add\')"><i class="fa-solid fa-plus"></i> Add PIN codes</button></div>')
        +'</div></div>'
    +'</div>';
  await lmDraw(placed);
  /* ANYTHING STILL UNPLACED GETS LOOKED UP NOW, AND THE MAP REDRAWS ONLY IF THAT PLACED SOMETHING.
     Redrawing on a bare "the call came back" is what spun it: the worker answers 200 even when it
     placed nothing, renderPage() re-enters this view and blanks it to its spinner, and a PIN that
     can never be placed asks again for ever. Requiring placed > 0 can only happen as many times as
     there are PIN codes left to place, so the sequence has to end; LM_GEO_MAX stops it even if a
     later change breaks that count. */
  if(waiting.some(function(p){return !p.err;})&&!lmRender._busy&&LM_GEO_TRIES<LM_GEO_MAX){
    lmRender._busy=true; LM_GEO_TRIES++;
    lmCall({action:'lead_map_geocode'}).then(function(r){ lmRender._busy=false; if(r&&r.placed>0&&PAGE==='lead_map')renderPage(); }).catch(function(){ lmRender._busy=false; });
  }
}
/* WHEN EACH PIN CODE WAS UPLOADED. Every row in camp.lm_pins carries the moment it was saved
   (created_at), who typed it in, or that it came from the CRM. Rows saved together - one batch on the
   Add PIN codes page, or one CRM read - share that moment, so they are shown as one upload with a
   count. Read for the months on screen, 1,000 rows at a time, and narrowed by the same project /
   type filters as the map. Returns { pincode: [uploads, newest first] }. */
async function lmUploads(months){
  const from=months.slice().sort()[0]+'-01', to=lmNextMonth(months.slice().sort().pop())+'-01';
  const all=[];
  for(let off=0;off<50000;off+=1000){
    const {data,error}=await sb.schema('camp').from('lm_pins').select('pincode,project,kind,event_date,source,added_by,created_at')
      .gte('event_date',from).lt('event_date',to).order('created_at',{ascending:false}).range(off,off+999);
    if(error){ console.warn('[lead map] upload times',error); break; }
    all.push.apply(all,data||[]);
    if(!data||data.length<1000)break;
  }
  const out={}, idx={};
  all.forEach(function(r){
    if(LM_PROJ!=='all'&&r.project!==LM_PROJ)return;
    if(LM_KIND!=='all'&&r.kind!==LM_KIND&&!(r.kind==='test'&&LM_PROJ==='all'))return;
    const k=r.pincode+'|'+r.created_at+'|'+(r.project||'')+'|'+r.kind+'|'+r.event_date+'|'+r.source+'|'+(r.added_by||'');
    if(idx[k]){ idx[k].n++; return; }
    idx[k]={at:r.created_at,project:r.project,kind:r.kind,date:r.event_date,source:r.source,by:r.added_by,n:1};
    (out[r.pincode]=out[r.pincode]||[]).push(idx[k]);
  });
  return out;
}
// "30 Oct 2026, 4:12 pm" in India time
function lmWhen(ts){ try{ return new Date(ts).toLocaleString('en-IN',{day:'numeric',month:'short',year:'numeric',hour:'numeric',minute:'2-digit',hour12:true,timeZone:'Asia/Kolkata'}); }catch(e){ return String(ts); } }
function lmNextMonth(ym){ let [y,m]=ym.split('-').map(Number); m++; if(m>12){m=1;y++;} return y+'-'+String(m).padStart(2,'0'); }

// ---------------------------------------------------------------- the map itself
const LM_CENTER={lat:22.5726,lng:88.3639};   // Kolkata
/* WHERE EACH PROJECT IS, for its 10 km circle. Taken from the Google Map each project's own website
   embeds (30 Oct 2026): Dream World City from dreamworldcity.co.in, Dream Gurukul from
   thejaingroup.com/dream_gurukul.php. Dream Ananta has no page of its own; RERA registers it
   ("Dream Ananta Gurukul", WBRERA/P/NOR/2026/004487) at the same 154 Old Jessore Road campus as
   Dream Gurukul, so it shares that point and its circle sits on Gurukul's. */
const LM_SITES=[
  {project:'Dream World City',lat:22.425118985258926,lng:88.30052531495693,color:'#2563eb'},
  {project:'Dream Gurukul',lat:22.67727787645114,lng:88.45681189976243,color:'#9333ea'},
  {project:'Dream Ananta',lat:22.67727787645114,lng:88.45681189976243,color:'#ea580c'}];
const LM_RADIUS_KM=10;
// straight-line distance in km between two points on the earth
function lmKm(a,b){ const R=6371,r=Math.PI/180,dl=(b.lat-a.lat)*r,dg=(b.lng-a.lng)*r;
  const h=Math.sin(dl/2)**2+Math.cos(a.lat*r)*Math.cos(b.lat*r)*Math.sin(dg/2)**2; return 2*R*Math.asin(Math.sqrt(h)); }
// Short names for the legend: "Dream World City", "Gurukul & Ananta".
function lmShortSite(label){ return label.indexOf(' + ')!==-1?label.split(' + ').map(function(s){return s.replace(/^Dream /,'');}).join(' & '):label; }
function lmSitesShown(){ return LM_SITES.filter(function(s){return LM_PROJ==='all'||s.project===LM_PROJ;}); }
// Projects at the same spot share one circle (Gurukul and Ananta), labelled with both names.
function lmSiteGroups(){
  const g={};
  lmSitesShown().forEach(function(s){ const k=s.lat.toFixed(5)+','+s.lng.toFixed(5);
    if(g[k]){ g[k].label+=' + '+s.project; g[k].names.push(s.project); } else g[k]={lat:s.lat,lng:s.lng,color:s.color,label:s.project,names:[s.project]}; });
  return Object.keys(g).map(function(k){return g[k];});
}
// Which shown project circles a PIN's centre falls inside, nearest first, with the distance.
function lmNear(p){
  if(p.lat==null)return [];
  return lmSiteGroups().map(function(g){ return {label:g.label,color:g.color,km:lmKm(p,g)}; })
    .filter(function(x){return x.km<=LM_RADIUS_KM;}).sort(function(a,b){return a.km-b.km;});
}
/* Pin size grows with the number of people: 1 person ~ 28px tall, 10 ~ 47px, 50+ ~ 72px. By square
   root, so the pin's AREA follows the count - a pin for 10 people looks about ten times as heavy as
   one for 1, not ten times as tall. */
function lmPinSize(n){ const h=Math.round(Math.min(72,22+6*Math.sqrt(Math.max(1,n)))); return {w:Math.round(h*0.72),h:h}; }
function lmPinSvg(n){
  const s=lmPinSize(n), fs=n<10?13:n<100?11:9;   // in the drawing's own units, so it scales with the pin
  return {s:s,svg:'<svg xmlns="http://www.w3.org/2000/svg" width="'+s.w+'" height="'+s.h+'" viewBox="0 0 30 42">'
    +'<path d="M15 1C7.3 1 1 7.2 1 14.9 1 25.4 15 41 15 41s14-15.6 14-26.1C29 7.2 22.7 1 15 1z" fill="#ea4335" stroke="#a52714" stroke-width="1.5"/>'
    +'<text x="15" y="19.5" text-anchor="middle" font-family="system-ui,Arial,sans-serif" font-weight="700" font-size="'+fs+'" fill="#fff">'+n+'</text></svg>'};
}
let LM_MARKERS={};
function lmPopup(p){
  const ups=p.ups||[];
  return '<div style="font:13px/1.45 system-ui,sans-serif;min-width:230px;max-width:320px"><b style="font-size:14px">'+esc(lmCodeLabel(p.pincode))+'</b>'
    +(p.place?'<div>'+esc(p.place)+'</div>':'')+'<div style="color:#64748b">'+esc([p.district,p.state].filter(Boolean).join(', '))+'</div>'
    +'<div style="margin-top:6px">'+p.lines.map(esc).join('<br>')+'</div>'
    // when each lot for this PIN code was put into JAIN-E, and by whom
    +(ups.length?'<div style="margin-top:8px;border-top:1px solid #e2e8f0;padding-top:6px"><div style="font-weight:700;font-size:11px;letter-spacing:.4px;text-transform:uppercase;color:#64748b;margin-bottom:3px">Uploaded</div>'
      +ups.slice(0,6).map(function(u){
        return '<div style="margin-bottom:4px"><b>'+esc(lmWhen(u.at))+'</b><div style="color:#475569;font-size:12px">'
          +esc((u.project||'Test pin')+' · '+LM_KINDS[u.kind]+(u.n>1?' ×'+u.n:'')+' · '+(LM_KINDS[u.kind]==='Booked'?'booking':'visit')+' date '+fmtDateShort(u.date))
          +'<br>'+esc(u.source==='crm'?'from the CRM':'added by hand'+(u.by?' by '+u.by:''))+'</div></div>'; }).join('')
      +(ups.length>6?'<div style="color:#64748b;font-size:12px">+ '+(ups.length-6)+' earlier upload'+(ups.length-6===1?'':'s')+'</div>':'')+'</div>':'')
    +'<div style="margin-top:6px;color:#475569">'+lmSiteGroups().map(function(g){ const km=lmKm(p,g);
      return esc(g.label)+': '+km.toFixed(1)+' km'+(km<=LM_RADIUS_KM?' <b style="color:'+g.color+'">· inside 10 km</b>':''); }).join('<br>')+'</div></div>';
}
async function lmDraw(pins){
  const box=$('lmMap'); if(!box)return;
  LM_MARKERS={};
  const key=await lmMapKey();
  if(key){
    try{
      if(!(window.google&&google.maps))await lmLoadScript('https://maps.googleapis.com/maps/api/js?key='+encodeURIComponent(key)+'&v=weekly');
      const map=new google.maps.Map(box,{center:LM_CENTER,zoom:10,mapTypeControl:false,streetViewControl:false});
      const bounds=new google.maps.LatLngBounds(), info=new google.maps.InfoWindow();
      lmSiteGroups().forEach(function(g){
        const c=new google.maps.Circle({map:map,center:{lat:g.lat,lng:g.lng},radius:LM_RADIUS_KM*1000,strokeColor:g.color,strokeWeight:2,
          fillOpacity:0,clickable:false});   // outline only
        new google.maps.Marker({map:map,position:{lat:g.lat,lng:g.lng},title:g.label,zIndex:1,
          icon:{path:google.maps.SymbolPath.CIRCLE,scale:7,fillColor:g.color,fillOpacity:1,strokeColor:'#fff',strokeWeight:2}});
        bounds.union(c.getBounds());
      });
      pins.slice().sort(function(a,b){return b.n-a.n;}).forEach(function(p,i){
        // a red pin whose size follows the number of people, the count written on it
        const ic=lmPinSvg(p.n);
        const mk=new google.maps.Marker({position:{lat:p.lat,lng:p.lng},map:map,title:p.pincode+' ('+p.n+')',zIndex:10+i,
          icon:{url:'data:image/svg+xml;charset=UTF-8,'+encodeURIComponent(ic.svg),scaledSize:new google.maps.Size(ic.s.w,ic.s.h),anchor:new google.maps.Point(ic.s.w/2,ic.s.h)}});
        mk.addListener('click',function(){ info.setContent(lmPopup(p)); info.open({map:map,anchor:mk}); });
        LM_MARKERS[p.pincode]={focus:function(){ map.setCenter(mk.getPosition()); map.setZoom(13); info.setContent(lmPopup(p)); info.open({map:map,anchor:mk}); }};
        if(lmKm(p,LM_CENTER)<=LM_NEAR_KM)bounds.extend(mk.getPosition());
      });
      map.fitBounds(bounds,30);
      $('lmMapNote').textContent='Google Maps · pins mark the middle of each PIN code area';
      // the distance tool is built on the OpenStreetMap map; not offered on Google Maps yet
      const mb=$('lmMeasureBtn'); if(mb)mb.style.display='none';
      return;
    }catch(e){ console.warn('[lead map] Google Maps did not load, using OpenStreetMap',e); }
  }
  lmLoadCss('https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css');
  await lmLoadScript('https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js');
  if(LM_MAP){ try{LM_MAP.remove();}catch(e){} }
  const map=LM_MAP=L.map(box).setView([LM_CENTER.lat,LM_CENTER.lng],10);
  /* MAP STYLES (top-right switch). "Detailed" is the default: Esri's street map names far more towns,
     neighbourhoods, roads and landmarks at every zoom than OpenStreetMap's standard style did.
     "Satellite" is Esri's imagery with place names laid over it; "Simple" is the original style.
     The last choice is remembered on this computer. (Google Maps, with every shop and landmark, takes
     over by itself once GOOGLE_MAPS_BROWSER_KEY is set - see lmDraw above.) */
  const ESRI='https://server.arcgisonline.com/ArcGIS/rest/services/';
  const styles={
    'Detailed':L.tileLayer(ESRI+'World_Street_Map/MapServer/tile/{z}/{y}/{x}',{maxZoom:19,attribution:'Tiles &copy; Esri'}),
    'Satellite':L.layerGroup([L.tileLayer(ESRI+'World_Imagery/MapServer/tile/{z}/{y}/{x}',{maxZoom:19,attribution:'Imagery &copy; Esri'}),
      L.tileLayer(ESRI+'Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}',{maxZoom:19}),
      L.tileLayer(ESRI+'Reference/World_Transportation/MapServer/tile/{z}/{y}/{x}',{maxZoom:19,opacity:.7})]),
    'Simple':L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'&copy; OpenStreetMap contributors'})};
  let pick='Detailed'; try{ const s=localStorage.getItem('lmMapStyle'); if(styles[s])pick=s; }catch(e){}
  styles[pick].addTo(map);
  L.control.layers(styles,null,{position:'topright',collapsed:false}).addTo(map);
  map.on('baselayerchange',function(e){ try{ localStorage.setItem('lmMapStyle',e.name); }catch(_){} });
  let bounds=null;
  lmSiteGroups().forEach(function(g){
    // outline only - no colour inside the circle, so the map underneath stays readable
    const c=L.circle([g.lat,g.lng],{radius:LM_RADIUS_KM*1000,color:g.color,weight:2.5,fill:false,interactive:false}).addTo(map);
    L.circleMarker([g.lat,g.lng],{radius:7,color:'#fff',weight:2,fillColor:g.color,fillOpacity:1}).addTo(map)
      .bindTooltip(g.label+' · '+LM_RADIUS_KM+' km circle',{direction:'top'});
    bounds=bounds?bounds.extend(c.getBounds()):c.getBounds();
  });
  pins.slice().sort(function(a,b){return b.n-a.n;}).forEach(function(p,i){
    // a red map pin whose size follows the number of people, the count in its head
    const ic=lmPinSvg(p.n);
    const icon=L.divIcon({className:'',iconSize:[ic.s.w,ic.s.h],iconAnchor:[ic.s.w/2,ic.s.h],popupAnchor:[0,-ic.s.h+6],html:ic.svg});
    const mk=L.marker([p.lat,p.lng],{icon:icon,title:p.pincode,zIndexOffset:i*10}).addTo(map).bindPopup(lmPopup(p));
    LM_MARKERS[p.pincode]={focus:function(){ map.setView([p.lat,p.lng],13); mk.openPopup(); }};
    // the map always opens on one common area: Kolkata and its surroundings (both project circles).
    // Pins further away are still on the map - zoom out to see them.
    if(lmKm(p,LM_CENTER)<=LM_NEAR_KM)bounds=bounds?bounds.extend([p.lat,p.lng]):L.latLngBounds([[p.lat,p.lng],[p.lat,p.lng]]);
  });
  lmMeasureAttach(map);
  // Re-center (back to the common view) and Full screen, under the zoom buttons
  const home=function(){ if(bounds)map.fitBounds(bounds,{padding:[30,30],maxZoom:13}); };
  const Ctl=L.Control.extend({options:{position:'topleft'},onAdd:function(){
    const d=L.DomUtil.create('div','leaflet-bar lm-ctl');
    d.innerHTML='<a title="Re-center the map" id="lmHomeBtn"><i class="fa-solid fa-crosshairs"></i></a>'
      +'<a title="Full screen" id="lmFsBtn"><i class="fa-solid fa-expand"></i></a>';
    L.DomEvent.disableClickPropagation(d);
    d.querySelector('#lmHomeBtn').onclick=home;
    d.querySelector('#lmFsBtn').onclick=function(){ lmFullscreen(); };
    return d; }});
  new Ctl().addTo(map);
  /* THE MAP MUST KNOW ITS REAL SIZE BEFORE IT ZOOMS. Fitted while the page was still being laid out
     (or while the window was hidden), Leaflet took the box as 0 px wide, zoomed right in and loaded a
     single strip of tiles. So it is re-measured and re-fitted whenever the box changes size, until it
     has been fitted once at a real size. */
  let fitted=false;
  const fit=function(){
    if(!box.isConnected)return;
    map.invalidateSize();
    if(!fitted&&box.clientWidth>50&&box.clientHeight>50){ fitted=true; if(bounds)map.fitBounds(bounds,{padding:[30,30],maxZoom:13}); }
  };
  if(window.ResizeObserver){ const ro=new ResizeObserver(fit); ro.observe(box); map.on('unload',function(){ro.disconnect();}); }
  requestAnimationFrame(fit); setTimeout(fit,300);
  const far=pins.filter(function(p){return lmKm(p,LM_CENTER)>LM_NEAR_KM;}).reduce(function(a,p){return a+p.n;},0);
  $('lmMapNote').innerHTML='Each pin sits in the middle of its PIN code area · click a pin for details'
    +(far?' · <b>'+far+'</b> '+(far===1?'person is':'people are')+' from further away - zoom out to see them':'');
}
const LM_NEAR_KM=80;   // the common view: within 80 km of the city centre - both projects and their circles fit

// ---------------------------------------------------------------- full screen
/* The browser's real full screen (the whole monitor), not just filling the window. The map card -
   tools, map and distance panel - goes full screen together; Esc or the button brings it back. */
window.lmFullscreen=function(){
  const card=$('lmMapCard'); if(!card)return;
  if(document.fullscreenElement)document.exitFullscreen();
  else if(card.requestFullscreen)card.requestFullscreen().catch(function(e){ toast('Full screen is not allowed here: '+e.message,'warn'); });
};
document.addEventListener('fullscreenchange',function(){
  const b=$('lmFsBtn'); const on=!!document.fullscreenElement;
  if(b){ b.innerHTML=on?'<i class="fa-solid fa-compress"></i>':'<i class="fa-solid fa-expand"></i>'; b.title=on?'Exit full screen':'Full screen'; }
  if(LM_MAP)setTimeout(function(){ try{LM_MAP.invalidateSize();}catch(e){} },120);
});

// ---------------------------------------------------------------- measuring distance
/* Search a place or PIN code, then another, and see how far apart they are; add stops in between by
   clicking the map ("Add point here"). Two distances are shown:
     straight line - worked out here from the coordinates (great-circle distance)
     by road       - the shortest driving route from OpenStreetMap's public router (OSRM); left blank
                     if the router does not answer, never estimated.
   A PIN code is placed at the middle of its area, the same way the pins are. Nothing is saved. */
let LM_PTS=[], LM_MLAYER=null, LM_MEASURING=false, LM_ROUTE_SEQ=0;
window.lmMeasureToggle=function(){
  LM_MEASURING=!LM_MEASURING;
  const p=$('lmMeasure'), b=$('lmMeasureBtn');
  if(b)b.classList.toggle('on',LM_MEASURING);
  if(p){ p.hidden=!LM_MEASURING; if(LM_MEASURING){ lmMeasureRender(); const i=$('lmMq'); if(i)i.focus(); } }
  if(LM_MAP)LM_MAP.getContainer().style.cursor=LM_MEASURING?'crosshair':'';
  if(!LM_MEASURING)lmMeasureClear(true);
};
function lmMeasureAttach(map){
  LM_PTS=[]; LM_MEASURING=false;
  LM_MLAYER=L.layerGroup().addTo(map);
  // clicking the map while measuring offers "Add point here"
  map.on('click',function(e){
    if(!LM_MEASURING)return;
    const ll=e.latlng;
    L.popup({closeButton:true}).setLatLng(ll).setContent(
      '<div style="font:13px system-ui,sans-serif"><div style="color:#64748b;margin-bottom:6px">'+ll.lat.toFixed(5)+', '+ll.lng.toFixed(5)+'</div>'
      +'<button class="btn btn-sm btn-primary" onclick="lmAddPointHere('+ll.lat+','+ll.lng+')"><i class="fa-solid fa-plus"></i> Add point here</button></div>').openOn(map);
  });
}
// A new point goes between the last two (as a stop on the way) once there is a start and an end.
function lmInsertPoint(pt){ if(LM_PTS.length>=2)LM_PTS.splice(LM_PTS.length-1,0,pt); else LM_PTS.push(pt); lmMeasureRender(); lmRoute(); }
window.lmAddPointHere=function(lat,lng){ if(LM_MAP)LM_MAP.closePopup(); lmInsertPoint({lat:lat,lng:lng,name:'Point on map ('+lat.toFixed(4)+', '+lng.toFixed(4)+')'}); };
window.lmMeasureRemove=function(i){ LM_PTS.splice(i,1); lmMeasureRender(); lmRoute(); };
function lmMeasureClear(keepPanel){ LM_PTS=[]; if(LM_MLAYER)LM_MLAYER.clearLayers(); if(keepPanel!==true)lmMeasureRender(); }
window.lmMeasureClear=lmMeasureClear;
/* SEARCH AS YOU TYPE. Places and PIN codes appear in a list while typing (OpenStreetMap's Photon
   search, India only, nearest to Kolkata first); picking one adds it - there is no separate Add step.
   Arrow keys move through the list, Enter picks the highlighted one, Esc closes it. */
let LM_FOUND=[], LM_SUG_SEQ=0, LM_SUG_T=null, LM_SUG_I=0;
window.lmSuggestInput=function(v){
  clearTimeout(LM_SUG_T);
  const q=String(v||'').trim();
  if(q.length<3){ lmSuggestShow([], q.length?'Keep typing…':''); return; }
  lmSuggestShow(null,'Searching…');
  LM_SUG_T=setTimeout(function(){ lmSuggest(q); },280);
};
async function lmSuggest(q){
  const seq=++LM_SUG_SEQ;
  try{
    const pin=/^[1-9]\d{5}$/.test(q);
    const r=await (await fetch('https://photon.komoot.io/api/?limit=15&lat=22.57&lon=88.36&bbox=68,6,98,37.5&q='+encodeURIComponent(pin?q+' India':q))).json();
    if(seq!==LM_SUG_SEQ)return;                          // the user has typed on since
    const found=(r.features||[]).filter(function(x){ const p=x.properties||{};
        return p.countrycode==='IN'&&(!pin||String(p.postcode||(p.osm_value==='postcode'?p.name:''))===q); })
      .map(function(f){ const p=f.properties, lat=f.geometry.coordinates[1], lng=f.geometry.coordinates[0];
        const isPin=p.osm_value==='postcode';
        const title=isPin?(p.postcode||p.name):(p.name||p.street||p.city||'');
        const sub=[isPin?'PIN code':null,p.locality,p.district||p.city,p.state].filter(Boolean).filter(function(x,i,a){return x!==title&&a.indexOf(x)===i;}).join(', ');
        return {lat:lat,lng:lng,pin:isPin,title:title,sub:sub,km:lmKm({lat:lat,lng:lng},LM_CENTER),name:title+(sub?', '+sub.replace(/^PIN code, ?/,''):'')}; })
      .sort(function(a,b){return a.km-b.km;});
    // the same place can come back twice (a node and an area) - keep one of each
    const seen={}, list=found.filter(function(x){ const k=x.title+'|'+x.sub; if(seen[k])return false; seen[k]=1; return true; }).slice(0,7);
    lmSuggestShow(list, list.length?'':'Nothing found in India - try adding the area or city.');
  }catch(e){ if(seq===LM_SUG_SEQ)lmSuggestShow([], 'Search is not answering right now - try again.'); }
}
function lmSuggestShow(list,msg){
  const box=$('lmSug'); if(!box)return;
  if(list)LM_FOUND=list; LM_SUG_I=0;
  const items=list||[];
  box.innerHTML=(msg?'<div class="lm-sug-msg">'+esc(msg)+'</div>':'')
    +items.map(function(x,k){
      return '<div class="lm-sug'+(k===0?' on':'')+'" onmousedown="event.preventDefault();lmPickFound('+k+')">'
        +'<i class="fa-solid '+(x.pin?'fa-hashtag':'fa-location-dot')+'"></i>'
        +'<div><div class="t">'+esc(x.title)+'</div><div class="s">'+esc(x.sub)+(x.sub?' · ':'')+x.km.toFixed(0)+' km from Kolkata</div></div></div>'; }).join('');
  box.hidden=!msg&&!items.length;
}
window.lmSuggestKey=function(e){
  const box=$('lmSug'); const els=box?box.querySelectorAll('.lm-sug'):[];
  if(e.key==='Escape'){ if(box)box.hidden=true; return; }
  if(!els.length)return;
  if(e.key==='ArrowDown'||e.key==='ArrowUp'){
    e.preventDefault(); LM_SUG_I=(LM_SUG_I+(e.key==='ArrowDown'?1:-1)+els.length)%els.length;
    els.forEach(function(x,k){x.classList.toggle('on',k===LM_SUG_I);});
  } else if(e.key==='Enter'){ e.preventDefault(); lmPickFound(LM_SUG_I); }
};
window.lmPickFound=function(k){ const x=LM_FOUND[k]; if(!x)return; lmInsertPoint({lat:x.lat,lng:x.lng,name:x.name}); const i=$('lmMq'); if(i)i.focus(); };
function lmMeasureRender(){
  const p=$('lmMeasure'); if(!p)return;
  let straight=0; for(let i=1;i<LM_PTS.length;i++)straight+=lmKm(LM_PTS[i-1],LM_PTS[i]);
  p.innerHTML='<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px"><b style="font-size:14px"><i class="fa-solid fa-route" style="color:#1d4ed8"></i> Distance between places</b>'
      +'<button class="lm-x" title="Close" onclick="lmMeasureToggle()"><i class="fa-solid fa-xmark"></i></button></div>'
    +'<div class="lm-search"><i class="fa-solid fa-magnifying-glass"></i>'
      +'<input id="lmMq" autocomplete="off" placeholder="'+(LM_PTS.length?(LM_PTS.length>=2?'Add another place or PIN code':'Search the end point…'):'Search a place or PIN code…')+'" oninput="lmSuggestInput(this.value)" onkeydown="lmSuggestKey(event)" onblur="setTimeout(function(){var b=$(\'lmSug\');if(b)b.hidden=true;},150)">'
      +'<div class="lm-sug-box" id="lmSug" hidden></div></div>'
    +'<div style="font-size:12px;color:var(--slate);margin:8px 0 2px">'+(LM_PTS.length<2?'Pick a start and an end - or click the map to drop a point.':'Click the map to add a stop in between.')+'</div>'
    +LM_PTS.map(function(pt,i){
      const leg=i?lmKm(LM_PTS[i-1],pt):null;
      return '<div class="lm-pt"><div class="dot">'+(i===0?'A':i===LM_PTS.length-1&&LM_PTS.length>1?'B':i)+'</div>'
        +'<div style="min-width:0"><div class="nm" title="'+esc(pt.name)+'">'+esc(pt.name)+'</div>'+(leg!=null?'<div class="leg">'+leg.toFixed(1)+' km from the point before (straight line)</div>':'')+'</div>'
        +'<button class="lm-x" title="Remove" onclick="lmMeasureRemove('+i+')"><i class="fa-solid fa-xmark"></i></button></div>'; }).join('')
    +(LM_PTS.length>=2?'<div class="lm-tot"><div><span>Straight line</span><b>'+straight.toFixed(1)+' km</b></div><div><span>By road</span><b id="lmRoad">…</b></div></div>'
      +'<div style="text-align:right;margin-top:8px"><button class="btn btn-sm" onclick="lmMeasureClear()">Clear</button></div>':'');
}
async function lmRoute(){
  if(!LM_MLAYER)return;
  LM_MLAYER.clearLayers();
  LM_PTS.forEach(function(pt,i){
    const lbl=i===0?'A':i===LM_PTS.length-1&&LM_PTS.length>1?'B':String(i);
    L.marker([pt.lat,pt.lng],{icon:L.divIcon({className:'',iconSize:[24,24],iconAnchor:[12,12],
      html:'<div style="width:24px;height:24px;border-radius:50%;background:#1d4ed8;border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.4);color:#fff;font:700 11px system-ui;display:flex;align-items:center;justify-content:center">'+lbl+'</div>'}),zIndexOffset:5000})
      .bindTooltip(pt.name).addTo(LM_MLAYER);
  });
  if(LM_PTS.length<2)return;
  const line=L.polyline(LM_PTS.map(function(p){return [p.lat,p.lng];}),{color:'#1d4ed8',weight:2,dashArray:'6 6'}).addTo(LM_MLAYER);
  LM_MAP.fitBounds(line.getBounds(),{padding:[60,60],maxZoom:14});
  const seq=++LM_ROUTE_SEQ;
  try{
    const r=await (await fetch('https://router.project-osrm.org/route/v1/driving/'+LM_PTS.map(function(p){return p.lng+','+p.lat;}).join(';')+'?overview=full&geometries=geojson')).json();
    if(seq!==LM_ROUTE_SEQ)return;                         // a newer request has taken over
    const rt=r&&r.code==='Ok'&&r.routes&&r.routes[0];
    const el=$('lmRoad');
    if(!rt){ if(el)el.textContent='—'; return; }
    L.geoJSON(rt.geometry,{style:{color:'#1d4ed8',weight:4,opacity:.75}}).addTo(LM_MLAYER);
    // distance only - a driving time would be a guess about traffic, so it is not shown
    if(el)el.textContent=(rt.distance/1000).toFixed(1)+' km';
  }catch(e){ const el=$('lmRoad'); if(el)el.textContent='—'; }
}
window.lmFocus=function(pin){ const m=LM_MARKERS[pin]; if(m)m.focus(); else toast('This PIN code is not on the map yet','warn'); };

// ---------------------------------------------------------------- customers from outside India
/* An Indian PIN code is six digits. Anything else is a foreign postal code, kept as '<country>-<code>'
   ('US-11004') so it can never be read as an Indian PIN. Its pin goes on the map where it really is;
   the map still opens on India, and the table lists it with its country. */
const LM_COUNTRIES=[['IN','India'],['US','USA'],['GB','UK'],['AE','UAE'],['SG','Singapore'],['CA','Canada'],['AU','Australia'],
  ['SA','Saudi Arabia'],['QA','Qatar'],['OM','Oman'],['KW','Kuwait'],['BH','Bahrain'],['NZ','New Zealand'],['DE','Germany'],['BD','Bangladesh'],['NP','Nepal']];
function lmCountryName(cc){ const c=LM_COUNTRIES.filter(function(x){return x[0]===cc;})[0]; return c?c[1]:cc; }
function lmCodeLabel(code){ const m=/^([A-Z]{2})-(.+)$/.exec(code||''); return m?m[2]+' ('+lmCountryName(m[1])+')':code; }
function lmInIndia(p){ return p.lat>=6&&p.lat<=37.5&&p.lng>=68&&p.lng<=98; }
// One typed code -> what is stored, or an error. A US ZIP+4 ("11004-0005", or "11004-05") keeps its 5 digits.
function lmNormCode(raw,cc){
  const s=String(raw||'').trim().toUpperCase();
  if(!s)return {err:'empty'};
  if(cc==='IN'){ const d=s.replace(/\s+/g,''); return /^[1-9]\d{5}$/.test(d)?{code:d}:{err:'not a 6-digit PIN code - if this customer is from abroad, pick their country'}; }
  if(cc==='US'){ const m=/^(\d{5})(-\d{1,4})?$/.exec(s.replace(/\s+/g,'')); return m?{code:'US-'+m[1]}:{err:'a US ZIP code is 5 digits'}; }
  const t=s.replace(/[^A-Z0-9 -]/g,'').trim();
  return /^[A-Z0-9][A-Z0-9 -]{1,9}$/.test(t)?{code:cc+'-'+t}:{err:'not a postal code'};
}

// ---------------------------------------------------------------- adding PIN codes by hand
/* Laid out like Reimbursement: a BATCH is one project, one type (Site Visit / Booked) and one date -
   the "date" container - and holds as many rows as needed ("Add row in same batch"); "Add another
   batch" starts a new project / type / date. Each row is a PIN code, how many people, and the country.

   PASTE FROM GOOGLE SHEETS. Copy a column of PIN codes and paste it into a PIN code box: it fills that
   box and the ones below, adding rows as needed. Then copy the column of numbers and paste it into the
   first Number box the same way. Copying two columns side by side (PIN code, Number) fills both at
   once. Stored one row per person, so 700124 with 4 becomes four visits. */
const LM_ENTRY_ROWS=30;
// One row. Only the very first row of a batch shows example text, so empty rows never look filled in.
function lmEntryRowHtml(first){
  return '<tr class="lm-row"><td class="n"></td>'
    +'<td><input class="lm-pin" placeholder="'+(first?'e.g. 700019':'')+'" onpaste="lmPaste(event,0)" oninput="lmEntryCheck()"></td>'
    +'<td><input class="lm-num" type="number" min="1" step="1" placeholder="'+(first?'1':'')+'" onpaste="lmPaste(event,1)" oninput="lmEntryCheck()"></td>'
    +'<td><input type="hidden" class="lm-cc" value="IN">'+lmCcButton('IN')+'</td>'
    +'<td class="lm-st"></td>'
    +'<td style="width:44px"><button type="button" class="lm-x" title="Remove this row" onclick="lmRowRemove(this)"><i class="fa-solid fa-xmark"></i></button></td></tr>';
}
/* THE COUNTRY PICKER. A plain dropdown cannot show a picture, so this is a small button + list with
   each country's flag (flagcdn.com). The chosen code sits in the hidden .lm-cc input beside it,
   which is what lmEntryRead() reads - exactly as the dropdown's value was. */
function lmFlag(cc){ return '<img src="https://flagcdn.com/w40/'+cc.toLowerCase()+'.png" alt="" class="lm-flag">'; }
function lmCcButton(cc){
  return '<button type="button" class="lm-ccbtn" onclick="lmCcOpen(this)">'+lmFlag(cc)+'<span>'+esc(lmCountryName(cc))+'</span><i class="fa-solid fa-chevron-down"></i></button>';
}
window.lmCcOpen=function(btn){
  lmCcClose();
  const r=btn.getBoundingClientRect();
  const list=document.createElement('div'); list.className='lm-cclist'; list.id='lmCcList';
  list.style.top=(r.bottom+window.scrollY+4)+'px'; list.style.left=(r.left+window.scrollX)+'px'; list.style.minWidth=r.width+'px';
  list.innerHTML=LM_COUNTRIES.map(function(c){ return '<div class="lm-ccopt" data-cc="'+c[0]+'">'+lmFlag(c[0])+'<span>'+esc(c[1])+'</span></div>'; }).join('');
  list.onclick=function(e){
    const o=e.target.closest('.lm-ccopt'); if(!o)return;
    const td=btn.closest('td'); td.querySelector('.lm-cc').value=o.dataset.cc;
    btn.outerHTML=lmCcButton(o.dataset.cc);
    lmCcClose(); lmEntryCheck();
  };
  document.body.appendChild(list);
  setTimeout(function(){ document.addEventListener('mousedown',lmCcOutside); },0);
};
function lmCcOutside(e){ if(!e.target.closest('#lmCcList'))lmCcClose(); }
function lmCcClose(){ const l=$('lmCcList'); if(l)l.remove(); document.removeEventListener('mousedown',lmCcOutside); }
function lmBatchHtml(n){
  const today=lmDefaultDate();
  let rows=''; for(let i=0;i<LM_ENTRY_ROWS;i++)rows+=lmEntryRowHtml(i===0);
  return '<div class="lm-batch">'
    +'<div class="lm-batch-top"><div class="lm-batch-hd">Batch '+n+'</div>'
      +'<label>Project<select class="lm-proj" onchange="lmEntryCheck()">'+LM_PROJECTS.map(function(p){return '<option>'+esc(p)+'</option>';}).join('')+'</select></label>'
      +'<label>Site Visit or Booking<select class="lm-kind" onchange="lmEntryCheck()"><option value="site_visit">Site Visit</option><option value="booked">Booked</option></select></label>'
      +'<label>Date<input type="date" class="lm-date" value="'+esc(today)+'" onchange="lmEntryCheck()"></label>'
      +'<button type="button" class="lm-x" title="Remove this batch" onclick="lmBatchRemove(this)"><i class="fa-solid fa-trash"></i></button></div>'
    +'<div style="overflow-x:auto"><table class="lm-grid"><thead><tr><th></th><th style="width:34%">PIN code</th><th style="width:22%">Number of people</th><th style="width:24%">Country</th><th style="width:20%"></th><th></th></tr></thead>'
      +'<tbody>'+rows+'</tbody></table></div>'
    +'<button type="button" class="lm-addrow" onclick="lmAddRow(this)"><i class="fa-solid fa-plus"></i> Add row in same batch</button>'
  +'</div>';
}
// The "Add PIN codes" page (lead_map/add): only the form - Save puts the rows on the map and goes back to it.
function lmAddPage(v){
  setCrumb(['Sales',['Lead Map','#/'],'Add PIN codes']);
  v.innerHTML=LM_CSS+'<div class="lm-form">'
    +'<div class="lm-head"><div><h1><i class="fa-solid fa-map-pin" style="color:#dc2626"></i> Add PIN codes</h1>'
      +'<p>Choose the project, Site Visit or Booking, and the date. Then enter each PIN code and how many people came from it.</p></div>'
      +'<button class="btn" onclick="navTo(\'lead_map\')"><i class="fa-solid fa-arrow-left"></i> Back to map</button></div>'
    +'<div id="lmBatches">'+lmBatchHtml(1)+'</div>'
    +'<div class="lm-foot">'
      +'<button class="btn" onclick="lmAddBatch()"><i class="fa-solid fa-layer-group"></i> Add another batch</button>'
      +'<span id="lmEntrySum" style="flex:1;min-width:200px;color:var(--slate);font-size:13px"></span>'
      +'<button class="btn" onclick="navTo(\'lead_map\')">Cancel</button>'
      +'<button class="btn btn-primary" id="lmSaveBtn" onclick="lmSave()"><i class="fa-solid fa-map-pin"></i> Save and plot</button></div>'
  +'</div>';
  lmEntryCheck();
  const first=v.querySelector('.lm-pin'); if(first)first.focus();
}
window.lmAddRow=function(btn){ const tb=btn.closest('.lm-batch').querySelector('tbody'); tb.insertAdjacentHTML('beforeend',lmEntryRowHtml(false)); lmEntryCheck(); tb.lastElementChild.querySelector('.lm-pin').focus(); };
window.lmRowRemove=function(btn){ const tb=btn.closest('tbody'); btn.closest('tr').remove(); if(!tb.children.length)tb.insertAdjacentHTML('beforeend',lmEntryRowHtml(true)); lmEntryCheck(); };
window.lmBatchRemove=function(btn){
  const w=$('lmBatches'); btn.closest('.lm-batch').remove();
  if(!w.querySelector('.lm-batch'))w.insertAdjacentHTML('beforeend',lmBatchHtml(1));
  lmRenumberBatches(); lmEntryCheck();
};
function lmRenumberBatches(){ [].slice.call(document.querySelectorAll('#lmBatches .lm-batch-hd')).forEach(function(h,i){h.textContent='Batch '+(i+1);}); }
window.lmAddBatch=function(){
  const w=$('lmBatches'); w.insertAdjacentHTML('beforeend',lmBatchHtml(w.querySelectorAll('.lm-batch').length+1));
  lmRenumberBatches(); lmEntryCheck();
  const b=w.lastElementChild; b.scrollIntoView({behavior:'smooth',block:'start'});
};
// Pasting several lines (or two columns) fills downward from the box it was pasted into.
window.lmPaste=function(ev,col){
  const txt=(ev.clipboardData||window.clipboardData).getData('text');
  if(!txt||!/[\n\t]/.test(txt.trim()))return;              // a single value: let the box take it normally
  ev.preventDefault();
  const lines=txt.replace(/\r/g,'').split('\n'); while(lines.length&&!lines[lines.length-1].trim())lines.pop();
  const tb=ev.target.closest('tbody');
  let tr=ev.target.closest('tr');
  lines.forEach(function(line,i){
    if(i>0){ tr=tr.nextElementSibling; if(!tr){ tb.insertAdjacentHTML('beforeend',lmEntryRowHtml(false)); tr=tb.lastElementChild; } }
    const cells=line.split('\t');
    const put=function(cls,val){ const el=tr.querySelector(cls); if(el&&val!==undefined)el.value=String(val).trim(); };
    if(col===0){ put('.lm-pin',cells[0]); if(cells.length>1)put('.lm-num',cells[1]); }
    else put('.lm-num',cells[0]);
  });
  lmEntryCheck();
};
// Reads every row, marks the bad ones, and says what will be saved.
function lmEntryRead(){
  const out=[], bad=[];
  [].slice.call(document.querySelectorAll('#lmBatches .lm-batch')).forEach(function(b){
    const proj=b.querySelector('.lm-proj').value, kind=b.querySelector('.lm-kind').value, date=b.querySelector('.lm-date').value;
    [].slice.call(b.querySelectorAll('tr.lm-row')).forEach(function(tr,i){
      tr.querySelector('td.n').textContent=i+1;
      const raw=tr.querySelector('.lm-pin').value.trim(), nraw=tr.querySelector('.lm-num').value.trim(), cc=tr.querySelector('.lm-cc').value;
      const st=tr.querySelector('.lm-st'); tr.classList.remove('bad'); st.className='lm-st'; st.textContent='';
      if(!raw&&!nraw)return;                                  // an empty row is simply skipped
      const c=lmNormCode(raw,cc), n=nraw===''?1:Number(nraw);
      let err=c.err||(!(Number.isInteger(n)&&n>=1&&n<=500)?'number must be a whole number from 1':null)||(!date?'pick the date':null);
      if(err){ tr.classList.add('bad'); st.className='lm-st err'; st.textContent=err; bad.push(raw||'(blank)'); return; }
      st.className='lm-st ok'; st.innerHTML='<i class="fa-solid fa-check"></i> '+n+' '+(n===1?'person':'people');
      out.push({project:proj,kind:kind,date:date,code:c.code,n:n});
    });
  });
  return {rows:out,bad:bad};
}
window.lmEntryCheck=function(){
  const r=lmEntryRead(), s=$('lmEntrySum'); if(!s)return r;
  const people=r.rows.reduce(function(a,x){return a+x.n;},0);
  s.innerHTML=r.rows.length?'<b>'+r.rows.length+'</b> PIN code row'+(r.rows.length===1?'':'s')+' · <b>'+people+'</b> '+(people===1?'person':'people')
    +(r.bad.length?' · <span style="color:#b91c1c">'+r.bad.length+' row'+(r.bad.length===1?'':'s')+' to fix</span>':''):'Paste or type PIN codes and numbers.';
  return r;
};
window.lmSave=async function(){
  const r=lmEntryCheck();
  if(r.bad.length)return toast('Fix the rows marked in red first','err');
  if(!r.rows.length)return toast('Nothing to save yet','warn');
  const ins=[]; r.rows.forEach(function(x){ for(let i=0;i<x.n;i++)ins.push({project:x.project,kind:x.kind,pincode:x.code,event_date:x.date,source:'manual',added_by:state.email||null}); });
  const b=$('lmSaveBtn'); if(b){b.disabled=true;b.innerHTML='<i class="fa-solid fa-rotate fa-spin"></i> Saving…';}
  const {error}=await sb.schema('camp').from('lm_pins').insert(ins);
  if(error){ if(b){b.disabled=false;b.innerHTML='<i class="fa-solid fa-map-pin"></i> Save and plot';} return toast(error.message,'err'); }
  toast('Saved '+ins.length+' '+(ins.length===1?'entry':'entries')+' - placing them on the map','ok');
  if(LM_MONTH!=='all')LM_MONTH=r.rows[0].date.slice(0,7);   // All months stays on All
  LM_GEO_TRIES=0;   // PIN codes just added deserve a fresh allowance
  try{ await lmCall({action:'lead_map_geocode'}); }catch(e){ toast('Saved; finding them on the map failed for now: '+e.message,'warn'); }
  navTo('lead_map');
};
