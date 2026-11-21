/* =============================================================================================
   RECKONER (module id 'reckoner', 21 Nov 2026 - Ayush). One verified source of project information
   for Sales: Project Directory, the same 8-tab Profile for every project, Comparison, Pending
   Verifications, Audit log, Roles. Plan: "Claude outputs/Reckoner/Reckoner plan.md".
   Database: schema rk (migration 20261121205000_reckoner.sql).
   - Nobody writes a record directly. Every add / change / removal goes to rk.changes through
     rk.propose() and only reaches the record when an approver accepts it (rk.review). rk.changes is
     also the audit log.
   - Every record carries its verification status. Missing is shown as "Not Available", never as 0.
     "Customer view" shows only Verified, in-date, customer-facing values.
   - Sales see internal information too (Ayush, 21 Nov) - it is marked Internal.
   - Inventory shows only free units: units Farvision has booked are hidden (rk.units_free).
   - Approvers: super admins + rk.roles 'sales_head' / 'project_admin' (mgr.sales@, agm.sales@, sm.sales2@).
   Second file: 61-reckoner-review.js (Pending Verifications, Audit, Compare, Roles).
   ============================================================================================= */
const RK={role:null,projects:null,cfg:[],rates:[],stats:{},lists:{},fv:null,proj:{},q:'',f:{cat:'',status:'',city:'',cfg:''},cust:false,cmp:[],pendN:0,inv:{q:'',tower:'',cfg:'',status:''}};
const RKS=function(){ return sb.schema('rk'); };
const RK_TABS=['Overview','Configurations','Pricing','Inventory','Amenities','Location','Sales Info','Documents'];
const RK_TBL_LABEL={projects:'Project',locations:'Location',configurations:'Configuration',charges:'Price component',payment_plans:'Payment plan stage',offers:'Offer',units:'Unit',amenities:'Amenity',landmarks:'Landmark',sales_notes:'Sales note',bank_approvals:'Bank approval',documents:'Document',assignments:'Team member'};
const RK_NOTE_KIND={usp:'USP',selling_point:'Selling point',target_customer:'Target customer',differentiator:'Differentiator',booking_procedure:'Booking procedure',faq:'FAQ',guideline:'Guideline',do_not_promise:'Do not promise',pitch:'Pitch',other:'Other'};
const RK_CHARGE_KIND={base_rate:'Base rate',unit_price:'Unit price',edc:'EDC',idc:'IDC',gst:'GST',parking:'Parking',frc:'FRC',plc:'PLC',club:'Club',maintenance:'Maintenance',registration:'Registration',other:'Other'};
const RK_PER={per_sqft:'per sq ft',lump_sum:'lump sum',percent:'%'};
/* the form of each record table: [column, label, type, required]. Types: text, area, num, int, date, bool,
   list:<rk.lists list>, sel:a=A,b=B (or plain values), cfg (a configuration of this project), fv (Farvision project), file */
const RK_F={
  projects:[['name','Project name','text',1],['code','Short code'],['category','Category','list:category'],['status','Status','list:status'],['stage','Development stage'],['city','City'],['locality','Locality'],['developer','Developer'],['land_area','Land area (as stated, e.g. 5.12 Acres)'],['towers','Towers / blocks'],['height','Height (e.g. B+G+8)'],['total_units','Total units','int'],['open_space','Open space'],['launch_date','Launch date','date'],['possession_date','Possession date','date'],['possession_note','Possession note'],['rera_no','RERA number'],['rera_note','RERA note'],['description','Description','area'],['fv_project_ids','Farvision project(s) (hides booked units)','fv']],
  locations:[['address','Address','area',1],['pin','PIN code'],['maps_url','Google Maps link'],['lat','Latitude','num'],['lng','Longitude','num'],['directions','Directions','area']],
  configurations:[['name','Name (e.g. 2 BHK Type A)','text',1],['kind','Type (Apartment, Bungalow, Studio, Shop)'],['bedrooms','Bedrooms','num'],['bathrooms','Bathrooms','num'],['balconies','Balconies','num'],['sba_min','Super built-up from (sq ft)','num'],['sba_max','Super built-up to (sq ft)','num'],['built_up','Built-up (sq ft)','num'],['carpet','Carpet (sq ft)','num'],['area_note','Area note'],['floors','Floors'],['facing','Facing'],['room_sizes','Room sizes','area'],['features','Features','area'],['sort','Order','int']],
  charges:[['name','Component','text',1],['kind','Kind','sel:'+Object.keys(RK_CHARGE_KIND).map(function(k){ return k+'='+RK_CHARGE_KIND[k]; }).join(','),1],['configuration_id','Applies to','cfg'],['amount','Amount / rate','num'],['unit','Per','sel:per_sqft=per sq ft,lump_sum=lump sum,percent=% of base'],['in_base','Included in base price','tri'],['in_final','Included in final price','tri'],['gst_included','GST included','tri'],['edc_included','EDC included','tri'],['parking_included','Parking included','tri'],['confirmed','Confirmed (not indicative)','bool'],['internal','Internal only (do not pitch)','bool'],['note','Note','area'],['sort','Order','int']],
  payment_plans:[['stage','Stage','text',1],['percent','Percent','num'],['amount','Amount','num'],['note','Note'],['sort','Order','int']],
  offers:[['title','Offer','text',1],['details','Details','area'],['internal','Internal only','bool']],
  units:[['unit_no','Unit no.','text',1],['tower','Tower / block'],['floor','Floor'],['configuration_id','Configuration','cfg'],['area','Area (sq ft)','num'],['facing','Facing'],['view','View'],['base_price','Base price','num'],['extra_charges','Extra charges','num'],['quoted_price','Quoted price','num'],['status','Status','sel:Available,On Hold,Booked,Sold,Blocked,Under Verification'],['booking_date','Booking date','date'],['note','Remarks']],
  amenities:[['name','Amenity','text',1],['category','Category','list:amenity'],['description','Description','area'],['status','Status (e.g. Ready, Under construction)'],['place','Where in the project'],['sort','Order','int']],
  landmarks:[['name','Landmark','text',1],['category','Category','list:landmark'],['distance_km','Distance (km)','num'],['travel_min','Travel time (minutes)','num'],['travel_note','Travel note'],['sort','Order','int']],
  sales_notes:[['kind','Kind','sel:'+Object.keys(RK_NOTE_KIND).map(function(k){ return k+'='+RK_NOTE_KIND[k]; }).join(','),1],['title','Title'],['body','Text','area',1],['internal','Internal only','bool'],['sort','Order','int']],
  bank_approvals:[['bank','Bank','text',1],['status','Status'],['reference','Reference']],
  documents:[['category','Category','list:document',1],['title','Title','text',1],['version','Version'],['internal','Internal only','bool'],['s3_key','File','file']],
  assignments:[['email','Email','text',1],['name','Name'],['role','Role','sel:project_manager=Project manager,sales_executive=Sales executive,project_admin=Project admin',1]]
};
const RK_COMMON=[['effective_from','Effective from','date'],['valid_until','Valid until','date'],['source','Source / reference'],['remarks','Remarks','area']];

const RK_CSS='<style>'
+'.rk-nav{display:flex;gap:4px;background:#f1f5f9;border-radius:12px;padding:4px;margin:0 0 16px;overflow-x:auto;scrollbar-width:none}'
+'.rk-nav a{border-radius:9px;padding:8px 16px;font-size:13.5px;font-weight:600;color:#475569;cursor:pointer;white-space:nowrap;text-decoration:none}'
+'.rk-nav a.on{background:#fff;color:#0f172a;box-shadow:0 1px 3px rgba(15,23,42,.12)}'
+'.rk-nav .n{background:#f59e0b;color:#fff;border-radius:9px;padding:1px 7px;font-size:11.5px;margin-left:5px}'
+'.rk-bar{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin:0 0 14px}'
+'.rk-bar input,.rk-bar select,.rk-form input,.rk-form select,.rk-form textarea{border:1px solid var(--line);border-radius:9px;padding:8px 11px;font-size:13.5px;font-family:inherit;background:#fff;color:#0f172a}'
+'.rk-bar input[type=search]{flex:1;min-width:200px}'
+'.rk-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(290px,1fr));gap:14px}'
+'.rk-card{background:#fff;border:1px solid var(--line);border-radius:14px;padding:16px;cursor:pointer;display:flex;flex-direction:column;gap:8px;position:relative}'
+'.rk-card:hover{border-color:#94a3b8;box-shadow:0 4px 14px rgba(15,23,42,.06)}'
+'.rk-card h3{margin:0;font-size:16px;color:#0f172a;padding-right:70px}'
+'.rk-card .loc{color:#64748b;font-size:13px}'
+'.rk-card .cmp{position:absolute;top:14px;right:14px;font-size:12px;color:#475569;display:flex;gap:5px;align-items:center}'
+'.rk-chips{display:flex;flex-wrap:wrap;gap:5px}'
+'.rk-chip{background:#f1f5f9;color:#334155;border-radius:7px;padding:2px 8px;font-size:12px}'
+'.rk-meta{display:grid;grid-template-columns:1fr 1fr;gap:4px 12px;font-size:12.5px;color:#475569}'
+'.rk-meta b{color:#0f172a;font-weight:600}'
+'.rk-prog{height:6px;background:#e2e8f0;border-radius:4px;overflow:hidden}.rk-prog i{display:block;height:100%;background:#16a34a}'
+'.rk-vs{display:inline-flex;align-items:center;gap:4px;border-radius:7px;padding:1px 7px;font-size:11.5px;font-weight:600;white-space:nowrap;vertical-align:middle}'
+'.rk-vs.verified{background:#dcfce7;color:#166534}.rk-vs.pending{background:#fef3c7;color:#92400e}.rk-vs.outdated{background:#fee2e2;color:#991b1b}'
+'.rk-vs.rejected{background:#fee2e2;color:#991b1b}.rk-vs.na{background:#e2e8f0;color:#475569}.rk-vs.internal{background:#ede9fe;color:#5b21b6}.rk-vs.chg{background:#dbeafe;color:#1e40af}'
+'.rk-na{color:#94a3b8;font-style:italic}'
+'.rk-ph{display:flex;flex-wrap:wrap;align-items:center;gap:10px;margin:0 0 6px}'
+'.rk-ph h2{margin:0;font-size:21px}'
+'.rk-tabs{display:flex;gap:2px;border-bottom:1px solid var(--line);margin:12px 0 16px;overflow-x:auto;scrollbar-width:none}'
+'.rk-tabs a{padding:9px 14px;font-size:13.5px;font-weight:600;color:#64748b;cursor:pointer;border-bottom:2px solid transparent;white-space:nowrap}'
+'.rk-tabs a.on{color:#0f172a;border-bottom-color:#2563eb}'
+'.rk-sec{background:#fff;border:1px solid var(--line);border-radius:14px;padding:16px;margin:0 0 14px}'
+'.rk-sec>h4{margin:0 0 12px;font-size:14.5px;display:flex;align-items:center;gap:8px}'
+'.rk-sec>h4 .r{margin-left:auto;display:flex;gap:6px}'
+'.rk-kv{display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:10px 18px}'
+'.rk-kv>div{font-size:13.5px}.rk-kv .k{color:#64748b;font-size:12px;margin-bottom:2px}'
+'.rk-t{width:100%;border-collapse:collapse;font-size:13px}'
+'.rk-t th{text-align:left;color:#64748b;font-weight:600;font-size:12px;padding:7px 8px;border-bottom:1px solid var(--line);white-space:nowrap}'
+'.rk-t td{padding:8px;border-bottom:1px solid #f1f5f9;vertical-align:top}'
+'.rk-t tr.int td{background:#faf5ff}'
+'.rk-wrap{overflow-x:auto}'
+'.rk-ib{border:0;background:transparent;color:#64748b;cursor:pointer;padding:2px 5px;border-radius:6px;font-size:12.5px}.rk-ib:hover{background:#f1f5f9;color:#0f172a}'
+'.rk-two{display:grid;grid-template-columns:1fr 1fr;gap:14px}'
+'.rk-pend{background:#eff6ff;border:1px dashed #93c5fd;border-radius:10px;padding:8px 12px;font-size:12.5px;color:#1e40af;margin:8px 0 0}'
+'.rk-form{display:grid;grid-template-columns:1fr 1fr;gap:10px 14px}'
+'.rk-form label{display:flex;flex-direction:column;gap:4px;font-size:12px;color:#475569;font-weight:600}'
+'.rk-form label.w{grid-column:1/-1}'
+'.rk-form label.cb{flex-direction:row;align-items:center;gap:8px;font-weight:500;color:#0f172a;font-size:13px}'
+'.rk-form hr{grid-column:1/-1;border:0;border-top:1px solid var(--line);margin:4px 0}'
+'.rk-empty{padding:22px;text-align:center;color:#64748b;font-size:13.5px}'
+'.rk-tot{font-size:20px;font-weight:700;color:#0f172a}'
+'@media(max-width:760px){.rk-two,.rk-form{grid-template-columns:1fr}.rk-grid{grid-template-columns:1fr}.rk-meta{grid-template-columns:1fr}}'
+'@media print{.rk-noprint,.sidebar,.topbar{display:none!important}}'
+'</style>';

/* ---------------------------------------------------------------- small helpers */
function rkToday(){ return new Date(Date.now()+5.5*3600e3).toISOString().slice(0,10); }
function rkState(r){ if(!r) return 'na'; if(r.vstatus==='na') return 'na'; if(r.vstatus==='verified'&&r.valid_until&&r.valid_until<rkToday()) return 'outdated'; return r.vstatus||'pending'; }
function rkOk(r){ return rkState(r)==='verified'; }
function rkChip(r,always){
  const s=rkState(r), src=r&&r.source?'Source: '+r.source:'';
  // the question raised about this value (workbook conflicts etc.) - shown to staff, never in Customer view
  const q=r&&r.remarks&&!RK.cust?' <i class="fa-solid fa-circle-exclamation" style="color:#d97706;cursor:help" title="'+esc(r.remarks)+'"></i>':'';
  if(s==='verified'&&!always) return '<span class="rk-vs verified" title="Verified'+(r.verified_by?' by '+esc(r.verified_by):'')+(r.verified_at?' on '+esc(fmtDate(r.verified_at)):'')+(src?' · '+esc(src):'')+'"><i class="fa-solid fa-check"></i></span>'+q;
  const L={verified:'Verified',pending:'Pending verification',outdated:'Outdated',rejected:'Rejected',na:'Not applicable'};
  return '<span class="rk-vs '+s+'" title="'+esc(src)+'">'+L[s]+'</span>'+q;
}
function rkInt(r){ return r&&r.internal?' <span class="rk-vs internal">Internal</span>':''; }
function rkNA(){ return '<span class="rk-na">Not Available</span>'; }
function rkInr(n){ if(n==null||n==='') return null; n=Number(n); if(!isFinite(n)) return null;
  const neg=n<0; n=Math.abs(n); const r=Math.round(n*100)/100; let [a,b]=String(r).split('.');
  const last=a.slice(-3), rest=a.slice(0,-3); a=(rest?rest.replace(/\B(?=(\d{2})+(?!\d))/g,',')+',':'')+last;
  return (neg?'-':'')+'₹'+a+(b?'.'+(b+'0').slice(0,2):''); }
function rkCr(n){ n=Number(n); if(!isFinite(n)) return ''; if(n>=1e7) return '₹'+(Math.round(n/1e5)/100)+' Cr'; if(n>=1e5) return '₹'+(Math.round(n/1e3)/100)+' L'; return rkInr(n); }
function rkNum(n){ if(n==null||n==='') return null; const x=Number(n); return isFinite(x)?x.toLocaleString('en-IN'):String(n); }
function rkArea(c){ if(!c) return null; const a=c.sba_min, b=c.sba_max; if(a==null&&b==null) return null; if(a!=null&&b!=null&&Number(a)!==Number(b)) return rkNum(a)+' – '+rkNum(b)+' sq ft'; return rkNum(a!=null?a:b)+' sq ft'; }
function rkCopyBtn(t){ if(t==null||t==='') return ''; return ' <button class="rk-ib rk-noprint" title="Copy" onclick="event.stopPropagation();rkCopy(this)" data-t="'+esc(String(t))+'"><i class="fa-regular fa-copy"></i></button>'; }
window.rkCopy=function(b){ const t=b.getAttribute('data-t'); try{ navigator.clipboard.writeText(t).then(function(){ toast('Copied','ok'); }); }catch(e){ toast('Could not copy','err'); } };
function rkCanPropose(pid){ const r=RK.role; if(r==='super'||r==='sales_head') return true; const d=pid&&RK.proj[pid];
  if(r==='project_admin') return !pid||!!(d&&d.mine); if(r==='project_manager') return !!(pid&&d&&d.mine); return false; }
function rkCanApprove(){ return RK.role==='super'||RK.role==='sales_head'||RK.role==='project_admin'; }
function rkErrText(e){ const m=String((e&&e.message)||e||''); if(/schema must be one of|rk\.|does not exist|PGRST106|Invalid schema/i.test(m)) return 'setup'; return m; }
function rkProjName(id){ const p=(RK.projects||[]).find(function(x){ return x.id===id; }); return p?p.name:'(project)'; }
// rows the customer may see: verified, in date, not internal
function rkShow(rows){ return RK.cust?(rows||[]).filter(function(r){ return rkOk(r)&&!r.internal; }):(rows||[]); }
function rkChgFor(d,id){ return (d&&d.pend||[]).filter(function(c){ return c.record_id===id; }); }
function rkChgChip(d,id){ const n=rkChgFor(d,id).length; return n?' <span class="rk-vs chg" title="A change to this is waiting for approval">Change pending</span>':''; }
function rkNewPend(d,tbl){ const n=(d&&d.pend||[]).filter(function(c){ return c.tbl===tbl&&c.op==='insert'; }).length;
  return n?'<div class="rk-pend"><i class="fa-regular fa-clock"></i> '+n+' new '+(n===1?'entry':'entries')+' waiting for approval - <a href="javascript:void(0)" onclick="navTo(\'reckoner/pending\')">see Pending Verifications</a></div>':''; }

/* ---------------------------------------------------------------- loading */
async function rkPages(q){ let out=[]; for(let f=0;;f+=1000){ const r=await q().range(f,f+999); if(r.error) throw r.error; out=out.concat(r.data||[]); if((r.data||[]).length<1000) return out; } }
async function rkBase(force){
  if(RK.projects&&!force) return;
  const S=RKS();
  const role=await S.rpc('my_role'); if(role.error) throw role.error;
  RK.role=role.data||'viewer';
  const got=await Promise.all([
    rkPages(function(){ return S.from('projects').select('*').eq('archived',false).order('name'); }),
    rkPages(function(){ return S.from('configurations').select('id,project_id,name,kind,bedrooms,sba_min,sba_max,vstatus,valid_until,updated_at').eq('archived',false).order('sort'); }),
    rkPages(function(){ return S.from('charges').select('id,project_id,configuration_id,kind,amount,unit,vstatus,valid_until,internal,confirmed,updated_at').eq('archived',false).in('kind',['base_rate','unit_price']); }),
    S.from('lists').select('*').order('sort').then(function(r){ return r.data||[]; }),
    S.from('changes').select('id',{count:'exact',head:true}).eq('status','pending').then(function(r){ return r.count||0; },function(){ return 0; })
  ].concat(['locations','amenities','landmarks','sales_notes','documents','units','charges','assignments'].map(function(t){
    return rkPages(function(){ return S.from(t).select(t==='assignments'?'project_id,email,updated_at':'project_id,updated_at').eq('archived',false); }).then(function(rows){ return [t,rows]; });
  })));
  RK.projects=got[0]; RK.cfg=got[1]; RK.rates=got[2]; RK.pendN=got[4];
  RK.lists={}; got[3].forEach(function(l){ (RK.lists[l.list]=RK.lists[l.list]||[]).push(l.value); });
  const st={}; const me=String((state.user&&state.user.email)||'').toLowerCase();
  RK.projects.forEach(function(p){ st[p.id]={n:{},last:p.updated_at,mine:false}; });
  RK.cfg.forEach(function(c){ const s=st[c.project_id]; if(s){ s.n.configurations=(s.n.configurations||0)+1; if(c.updated_at>s.last) s.last=c.updated_at; } });
  got.slice(5).forEach(function(pair){ pair[1].forEach(function(r){ const s=st[r.project_id]; if(!s) return; s.n[pair[0]]=(s.n[pair[0]]||0)+1; if(r.updated_at>s.last) s.last=r.updated_at; if(pair[0]==='assignments'&&String(r.email||'').toLowerCase()===me) s.mine=true; }); });
  RK.stats=st;
}
// how much of the 8 tabs has anything in it
function rkComplete(p){ const n=(RK.stats[p.id]||{}).n||{};
  const have=[!!(p.possession_date||p.description||p.rera_no||p.total_units), n.configurations, n.charges, n.units, n.amenities, (n.locations||n.landmarks), n.sales_notes, n.documents];
  return Math.round(have.filter(Boolean).length/8*100); }
async function rkDetail(id,force){
  if(RK.proj[id]&&!force) return RK.proj[id];
  const S=RKS(), all=function(t,q){ return rkPages(function(){ let b=S.from(t).select('*').eq('project_id',id); if(t!=='units_free') b=b.eq('archived',false); return q?q(b):b; }); };
  const got=await Promise.all([
    S.from('projects').select('*').eq('id',id).maybeSingle(),
    all('locations'), all('configurations',function(b){ return b.order('sort').order('name'); }), all('charges',function(b){ return b.order('sort'); }),
    all('payment_plans',function(b){ return b.order('sort'); }), all('offers'), all('units_free',function(b){ return b.order('tower').order('unit_no'); }),
    all('amenities',function(b){ return b.order('sort').order('name'); }), all('landmarks',function(b){ return b.order('sort').order('travel_min'); }),
    all('sales_notes',function(b){ return b.order('sort'); }), all('bank_approvals'), all('documents',function(b){ return b.order('category').order('title'); }), all('assignments'),
    S.from('changes').select('*').eq('project_id',id).eq('status','pending').order('id').then(function(r){ return r.data||[]; }),
    rkFv()
  ]);
  if(got[0].error) throw got[0].error;
  if(!got[0].data) throw new Error('This project was not found (it may have been archived).');
  const me=String((state.user&&state.user.email)||'').toLowerCase();
  const d={p:got[0].data,loc:got[1],cfg:got[2],chg:got[3],plan:got[4],off:got[5],units:got[6],am:got[7],lm:got[8],notes:got[9],bank:got[10],docs:got[11],team:got[12],pend:got[13]};
  d.mine=d.team.some(function(a){ return String(a.email||'').toLowerCase()===me; });
  RK.proj[id]=d; return d;
}
function rkFv(){ if(RK.fv) return Promise.resolve(RK.fv);
  return sb.schema('cust').from('projects').select('id,name').order('name').then(function(r){ RK.fv=r.data||[]; return RK.fv; },function(){ RK.fv=[]; return RK.fv; }); }

/* ---------------------------------------------------------------- the page */
function rkNav(on){
  const items=[['','Directory','fa-building'],['compare','Compare','fa-scale-balanced'],['pending','Pending Verifications','fa-clipboard-check'],['audit','Audit Log','fa-clock-rotate-left']];
  if(RK.role==='super') items.push(['roles','Roles','fa-user-shield']);
  return '<div class="rk-nav rk-noprint">'+items.map(function(i){ return '<a class="'+(i[0]===on?'on':'')+'" onclick="navTo(\'reckoner'+(i[0]?'/'+i[0]:'')+'\')"><i class="fa-solid '+i[2]+'"></i> '+i[1]+(i[0]==='pending'&&RK.pendN?'<span class="n">'+RK.pendN+'</span>':'')+'</a>'; }).join('')+'</div>';
}
VIEWS.reckoner=async function(v,seg){
  setCrumb(['Sales','Reckoner']);
  const head=RK_CSS+mHead('fa-book-bookmark','#0f766e','Reckoner');
  const s0=seg&&seg[0]||'';
  try{
    if(!RK.projects){ v.innerHTML=head+'<div class="loader"><div class="spin"></div></div>'; await rkBase(); if(PAGE!=='reckoner') return; }
    if(s0==='p'&&seg[1]){
      const id=seg[1], ti=Math.max(0,Math.min(7,parseInt(seg[2]||'0',10)||0));
      if(!RK.proj[id]){ v.innerHTML=head+rkNav('')+'<div class="loader"><div class="spin"></div></div>'; await rkDetail(id); if(PAGE!=='reckoner') return; }
      v.innerHTML=head+rkNav('')+rkProfile(id,ti); return;
    }
    if(s0==='compare'){ v.innerHTML=head+rkNav('compare')+'<div class="loader"><div class="spin"></div></div>'; const h=await rkCompareView(); if(PAGE!=='reckoner') return; v.innerHTML=head+rkNav('compare')+h; return; }
    if(s0==='pending'){ v.innerHTML=head+rkNav('pending')+'<div class="loader"><div class="spin"></div></div>'; const h=await rkPendingView(); if(PAGE!=='reckoner') return; v.innerHTML=head+rkNav('pending')+h; return; }
    if(s0==='audit'){ v.innerHTML=head+rkNav('audit')+'<div class="loader"><div class="spin"></div></div>'; const h=await rkAuditView(); if(PAGE!=='reckoner') return; v.innerHTML=head+rkNav('audit')+h; return; }
    if(s0==='roles'){ v.innerHTML=head+rkNav('roles')+'<div class="loader"><div class="spin"></div></div>'; const h=await rkRolesView(); if(PAGE!=='reckoner') return; v.innerHTML=head+rkNav('roles')+h; return; }
    v.innerHTML=head+rkNav('')+rkDirectory();
  }catch(e){
    const t=rkErrText(e);
    v.innerHTML=head+'<div class="card card-pad" style="font-size:13.5px;'+(t==='setup'?'color:#475569':'color:#b91c1c')+'">'
      +(t==='setup'?'<i class="fa-regular fa-clock"></i> Reckoner\'s database is being set up tonight after 8 PM. The page works once that has run.'
        :'<i class="fa-solid fa-triangle-exclamation"></i> Reckoner could not be shown: '+esc(t)+'. <a href="javascript:void(0)" onclick="rkReload()">Try again</a>')+'</div>';
    try{ console.error('reckoner',e); }catch(_e){}
  }
};
window.rkReload=function(){ RK.projects=null; RK.proj={}; renderPage(); };

/* ---------------------------------------------------------------- Directory */
function rkDirectory(){
  const P=RK.projects||[], f=RK.f, q=RK.q.trim().toLowerCase();
  const uniq=function(a){ return Array.from(new Set(a.filter(Boolean))).sort(); };
  const cats=uniq(P.map(function(p){ return p.category; })), sts=uniq(P.map(function(p){ return p.status; })), cities=uniq(P.map(function(p){ return p.city; }));
  const cfgNames=uniq(RK.cfg.map(function(c){ const m=String(c.name||'').match(/\d+(\.\d+)?\s*(BHK|RK)|Studio|Bungalow|Villa|Shop|Duplex|Penthouse/i); return m?m[0].toUpperCase().replace(/\s+/,' '):null; }));
  const cfgOf=function(id){ return RK.cfg.filter(function(c){ return c.project_id===id; }); };
  const list=P.filter(function(p){
    if(f.cat&&p.category!==f.cat) return false; if(f.status&&p.status!==f.status) return false; if(f.city&&p.city!==f.city) return false;
    const cs=cfgOf(p.id);
    if(f.cfg&&!cs.some(function(c){ return String(c.name||'').toUpperCase().replace(/\s+/g,' ').indexOf(f.cfg)!==-1; })) return false;
    if(q){ const hay=[p.name,p.code,p.city,p.locality,p.developer,p.rera_no,p.category,p.status,p.stage].concat(cs.map(function(c){ return c.name; })).join(' ').toLowerCase(); if(hay.indexOf(q)===-1) return false; }
    return true;
  });
  const opt=function(v,arr,lbl){ return '<select onchange="rkF(\''+v+'\',this.value)"><option value="">'+lbl+'</option>'+arr.map(function(x){ return '<option'+(f[v]===x?' selected':'')+'>'+esc(x)+'</option>'; }).join('')+'</select>'; };
  let h='<div class="rk-bar rk-noprint"><input type="search" placeholder="Search project, locality, configuration, RERA..." value="'+esc(RK.q)+'" oninput="rkQ(this.value)" id="rkQ">'
    +opt('cat',cats,'All categories')+opt('status',sts,'All statuses')+opt('city',cities,'All cities')+opt('cfg',cfgNames,'Any configuration')
    +(RK.cmp.length?'<button class="btn btn-primary btn-sm" onclick="navTo(\'reckoner/compare\')"><i class="fa-solid fa-scale-balanced"></i> Compare '+RK.cmp.length+'</button>':'')
    +(rkCanPropose(null)?'<button class="btn btn-sm" onclick="rkEdit(\'projects\',null,null)"><i class="fa-solid fa-plus"></i> Add project</button>':'')+'</div>';
  if(!P.length) return h+'<div class="rk-sec rk-empty">No projects yet.'+(rkCanPropose(null)?' Use <b>Add project</b>; it appears here once an approver accepts it.':'')+'<br>The workbook data is added after it has been reviewed.</div>';
  if(!list.length) return h+'<div class="rk-sec rk-empty">No project matches these filters.</div>';
  return h+'<div class="rk-grid">'+list.map(function(p){
    const s=RK.stats[p.id]||{n:{}}, cs=cfgOf(p.id), pc=rkComplete(p);
    const rates=RK.rates.filter(function(r){ return r.project_id===p.id&&r.kind==='base_rate'&&r.unit==='per_sqft'&&r.amount!=null&&!r.internal; });
    const minRate=rates.length?Math.min.apply(null,rates.map(function(r){ return Number(r.amount); })):null;
    return '<div class="rk-card" onclick="navTo(\'reckoner/p/'+p.id+'\')">'
      +'<label class="cmp rk-noprint" onclick="event.stopPropagation()"><input type="checkbox" '+(RK.cmp.indexOf(p.id)!==-1?'checked':'')+' onchange="rkCmpToggle(\''+p.id+'\',this.checked)"> Compare</label>'
      +'<h3>'+esc(p.name)+'</h3><div class="loc"><i class="fa-solid fa-location-dot"></i> '+(esc([p.locality,p.city].filter(Boolean).join(', '))||'Location not available')+'</div>'
      +'<div class="rk-chips">'+[p.category,p.status,p.stage].filter(Boolean).map(function(x){ return '<span class="rk-chip">'+esc(x)+'</span>'; }).join('')+' '+rkChip(p,true)+'</div>'
      +'<div class="rk-meta"><div>Possession: <b>'+(p.possession_date?esc(fmtDate(p.possession_date)):(p.possession_note?esc(p.possession_note):'—'))+'</b></div>'
      +'<div>Base rate from: <b>'+(minRate!=null?rkInr(minRate)+'/sq ft':'—')+'</b></div>'
      +'<div>Configurations: <b>'+(cs.length?esc(cs.slice(0,4).map(function(c){ return c.name; }).join(', '))+(cs.length>4?' +'+(cs.length-4):''):'—')+'</b></div>'
      +'<div>Updated: <b>'+(s.last?esc(fmtDate(s.last)):'—')+'</b></div></div>'
      +'<div style="display:flex;align-items:center;gap:8px;font-size:12px;color:#64748b"><div class="rk-prog" style="flex:1"><i style="width:'+pc+'%"></i></div>'+pc+'% filled</div>'
      +'</div>';
  }).join('')+'</div>';
}
window.rkF=function(k,v){ RK.f[k]=v; renderPage(); };
let RK_QT=null;
window.rkQ=function(v){ RK.q=v; clearTimeout(RK_QT); RK_QT=setTimeout(function(){ renderPage(); setTimeout(function(){ const i=$('rkQ'); if(i){ i.focus(); i.setSelectionRange(i.value.length,i.value.length); } },0); },250); };
window.rkCmpToggle=function(id,on){ const i=RK.cmp.indexOf(id); if(on&&i===-1){ if(RK.cmp.length>=4){ toast('Compare up to 4 projects','warn'); renderPage(); return; } RK.cmp.push(id); } if(!on&&i!==-1) RK.cmp.splice(i,1); renderPage(); };

/* ---------------------------------------------------------------- Profile */
const RK_KEY={locations:'loc',configurations:'cfg',charges:'chg',payment_plans:'plan',offers:'off',units:'units',amenities:'am',landmarks:'lm',sales_notes:'notes',bank_approvals:'bank',documents:'docs',assignments:'team'};
function rkSec(title,icon,tbl,pid,body,extraBtns){
  if(tbl&&pid&&rkCanApprove()&&RK.proj[pid]){ const un=(RK.proj[pid][RK_KEY[tbl]]||[]).filter(function(x){ return rkState(x)==='pending'; });
    if(un.length) extraBtns=(extraBtns||'')+'<button class="btn btn-sm" style="color:#166534" onclick="rkVerifyAll(\''+tbl+'\',\''+pid+'\')"><i class="fa-solid fa-check-double"></i> Verify all ('+un.length+')</button>'; }
  return '<div class="rk-sec"><h4><i class="fa-solid '+icon+'" style="color:#0f766e"></i> '+title+'<span class="r rk-noprint">'+(extraBtns||'')
    +(tbl&&rkCanPropose(pid)?'<button class="btn btn-sm" onclick="rkEdit(\''+tbl+'\',null,\''+pid+'\')"><i class="fa-solid fa-plus"></i> Add</button>':'')+'</span></h4>'+body+'</div>';
}
function rkRowBtns(tbl,r,pid){
  const vb=rkCanApprove()&&rkState(r)!=='verified'?'<button class="rk-ib" title="Mark verified" style="color:#16a34a" onclick="event.stopPropagation();rkVerify(\''+tbl+'\',[\''+r.id+'\'],\''+pid+'\')"><i class="fa-solid fa-check-double"></i></button>':'';
  if(!rkCanPropose(pid)) return vb?'<span class="rk-noprint" style="white-space:nowrap">'+vb+'</span>':'';
  return '<span class="rk-noprint" style="white-space:nowrap">'+vb+'<button class="rk-ib" title="Propose a change" onclick="event.stopPropagation();rkEdit(\''+tbl+'\',\''+r.id+'\',\''+pid+'\')"><i class="fa-solid fa-pen"></i></button>'
    +'<button class="rk-ib" title="Propose removal" onclick="event.stopPropagation();rkArchive(\''+tbl+'\',\''+r.id+'\',\''+pid+'\')"><i class="fa-solid fa-box-archive"></i></button></span>'; }
function rkVal(v,fmt){ if(v==null||v==='') return rkNA(); return fmt?fmt(v):esc(String(v)); }
function rkProfile(id,ti){
  const d=RK.proj[id], p=d.p;
  let h='<div class="rk-ph"><a class="rk-ib rk-noprint" onclick="navTo(\'reckoner\')"><i class="fa-solid fa-arrow-left"></i> Directory</a></div>'
    +'<div class="rk-ph"><h2>'+esc(p.name)+'</h2>'+rkChip(p,true)+rkChgChip(d,p.id)
    +'<span style="margin-left:auto;display:flex;gap:8px;align-items:center" class="rk-noprint">'
    +'<label style="font-size:12.5px;color:#475569;display:flex;gap:5px;align-items:center" title="Show only verified, in-date, customer-facing information"><input type="checkbox" '+(RK.cust?'checked':'')+' onchange="RK.cust=this.checked;renderPage()"> Customer view</label>'
    +'<button class="btn btn-sm" onclick="rkRefresh(\''+id+'\')" title="Load again"><i class="fa-solid fa-rotate"></i></button>'
    +'<button class="btn btn-sm" onclick="window.print()"><i class="fa-solid fa-print"></i> Print</button></span></div>'
    +'<div style="color:#64748b;font-size:13px">'+esc([p.locality,p.city].filter(Boolean).join(', '))+(p.category?' · '+esc(p.category):'')+(p.status?' · '+esc(p.status):'')+'</div>'
    +(RK.cust?'<div class="rk-pend" style="background:#f0fdf4;border-color:#86efac;color:#166534"><i class="fa-solid fa-eye"></i> Customer view: only verified, in-date, customer-facing information is shown.</div>':'')
    +'<div class="rk-tabs rk-noprint">'+RK_TABS.map(function(t,i){ return '<a class="'+(i===ti?'on':'')+'" onclick="navTo(\'reckoner/p/'+id+'/'+i+'\')">'+t+'</a>'; }).join('')+'</div>';
  const body=[rkTabOverview,rkTabConfig,rkTabPricing,rkTabInventory,rkTabAmenities,rkTabLocation,rkTabSales,rkTabDocs][ti](d,id);
  return h+body;
}
window.rkRefresh=async function(id){ try{ await rkDetail(id,true); await rkBase(true); }catch(e){ toast(String(e.message||e),'err'); } renderPage(); };

function rkTabOverview(d,id){
  const p=d.p, ok=!RK.cust||rkOk(p);
  const f=function(lbl,v,fmt,copy){ return '<div><div class="k">'+lbl+'</div>'+(ok?rkVal(v,fmt):'<span class="rk-na">Pending Verification</span>')+(ok&&copy?rkCopyBtn(v):'')+'</div>'; };
  let kv='<div class="rk-kv">'+f('Category',p.category)+f('Project status',p.status)+f('Development stage',p.stage)+f('City',p.city)+f('Locality',p.locality)+f('Developer',p.developer)
    +f('Land area',p.land_area)+f('Towers / blocks',p.towers)+f('Height',p.height)+f('Total units',p.total_units,rkNum)+f('Open space',p.open_space)
    +f('Launch date',p.launch_date,fmtDate)+f('Possession',p.possession_date,fmtDate)+f('Possession note',p.possession_note)+f('RERA number',p.rera_no,null,true)+f('RERA note',p.rera_note)
    +(!RK.cust?f('Farvision project',(p.fv_project_ids||[]).length?p.fv_project_ids.map(function(i){ return ((RK.fv||[]).find(function(x){ return String(x.id)===String(i); })||{name:'#'+i}).name; }).join(', '):null):'')+'</div>'
    +(p.description&&ok?'<div style="margin-top:12px;font-size:13.5px;line-height:1.55;white-space:pre-wrap">'+esc(p.description)+'</div>':'')
    +'<div style="margin-top:12px;font-size:12px;color:#64748b">'+(p.source?'Source: '+esc(p.source)+' · ':'')+(p.verified_at?'Verified by '+esc(p.verified_by||'')+' on '+esc(fmtDate(p.verified_at))+' · ':'')+'Updated '+esc(fmtDate(p.updated_at))+(p.valid_until?' · Valid until '+esc(fmtDate(p.valid_until)):'')+'</div>';
  const edit=(rkCanApprove()&&rkState(p)!=='verified'?'<button class="btn btn-sm" style="color:#166534" onclick="rkVerify(\'projects\',[\''+id+'\'],\''+id+'\')"><i class="fa-solid fa-check-double"></i> Mark overview verified</button> ':'')+(rkCanPropose(id)?'<button class="btn btn-sm" onclick="rkEdit(\'projects\',\''+id+'\',\''+id+'\')"><i class="fa-solid fa-pen"></i> Propose change</button>':'');
  let h=rkSec('Overview','fa-circle-info',null,id,kv,edit);
  const off=rkShow(d.off);
  if(!RK.cust||off.length) h+=rkSec('Offers','fa-tag','offers',id,(off.length?'<table class="rk-t"><tr><th>Offer</th><th>Details</th><th>Valid</th><th></th><th></th></tr>'+off.map(function(o){ return '<tr'+(o.internal?' class="int"':'')+'><td><b>'+esc(o.title)+'</b>'+rkInt(o)+'</td><td>'+rkVal(o.details)+'</td><td>'+(o.valid_until?'until '+esc(fmtDate(o.valid_until)):'—')+'</td><td>'+rkChip(o)+rkChgChip(d,o.id)+'</td><td>'+rkRowBtns('offers',o,id)+'</td></tr>'; }).join('')+'</table>':'<div class="rk-empty">No offers recorded.</div>')+rkNewPend(d,'offers'));
  if(!RK.cust) h+=rkSec('Team','fa-users','assignments',id,(d.team.length?'<table class="rk-t"><tr><th>Name</th><th>Email</th><th>Role</th><th></th></tr>'+d.team.map(function(a){ return '<tr><td>'+rkVal(a.name)+'</td><td>'+esc(a.email||'')+'</td><td>'+esc(String(a.role||'').replace(/_/g,' '))+'</td><td>'+rkRowBtns('assignments',a,id)+'</td></tr>'; }).join('')+'</table>':'<div class="rk-empty">No project manager or sales executive assigned yet.</div>')+rkNewPend(d,'assignments'));
  return h;
}
function rkTabConfig(d,id){
  const rows=rkShow(d.cfg);
  const body=rows.length?'<div class="rk-wrap"><table class="rk-t"><tr><th>Configuration</th><th>Type</th><th>Bed / Bath / Balcony</th><th>Super built-up</th><th>Built-up</th><th>Carpet</th><th>Floors</th><th>Facing</th><th></th><th></th></tr>'
    +rows.map(function(c){ return '<tr><td><b>'+esc(c.name)+'</b>'+(c.area_note?'<div style="color:#64748b;font-size:12px">'+esc(c.area_note)+'</div>':'')+(c.room_sizes?'<div style="font-size:12px;white-space:pre-wrap">'+esc(c.room_sizes)+'</div>':'')+(c.features?'<div style="font-size:12px;color:#475569;white-space:pre-wrap">'+esc(c.features)+'</div>':'')+'</td>'
      +'<td>'+rkVal(c.kind)+'</td><td>'+[c.bedrooms,c.bathrooms,c.balconies].map(function(x){ return x==null?'–':rkNum(x); }).join(' / ')+'</td><td>'+(rkArea(c)||rkNA())+'</td><td>'+rkVal(c.built_up,function(x){ return rkNum(x)+' sq ft'; })+'</td><td>'+rkVal(c.carpet,function(x){ return rkNum(x)+' sq ft'; })+'</td>'
      +'<td>'+rkVal(c.floors)+'</td><td>'+rkVal(c.facing)+'</td><td>'+rkChip(c)+rkChgChip(d,c.id)+'</td><td>'+rkRowBtns('configurations',c,id)+'</td></tr>'; }).join('')+'</table></div>'
    :'<div class="rk-empty">'+(RK.cust&&d.cfg.length?'Configurations are pending verification.':'No configurations recorded.')+'</div>';
  return rkSec('Configurations','fa-house','configurations',id,body+rkNewPend(d,'configurations'));
}
function rkTabPricing(d,id){
  const ch=rkShow(d.chg), cfgName=function(cid){ const c=d.cfg.find(function(x){ return x.id===cid; }); return c?c.name:'All configurations'; };
  const fmtAmt=function(c){ if(c.amount==null) return rkNA(); if(c.unit==='percent') return rkNum(c.amount)+'%'; return rkInr(c.amount)+(c.unit==='per_sqft'?' / sq ft':''); };
  const yn=function(v){ return v==null?'<span class="rk-na">–</span>':v?'Yes':'No'; };
  const groups={}; ch.forEach(function(c){ const k=c.configuration_id||''; (groups[k]=groups[k]||[]).push(c); });
  let body=ch.length?Object.keys(groups).sort(function(a,b){ return a===''?-1:b===''?1:cfgName(a).localeCompare(cfgName(b)); }).map(function(k){
    return '<div style="font-weight:600;font-size:13px;margin:10px 0 4px">'+esc(cfgName(k||null))+'</div><div class="rk-wrap"><table class="rk-t"><tr><th>Component</th><th>Amount</th><th>In base</th><th>In final</th><th>GST incl.</th><th>Confirmed</th><th>Valid</th><th></th><th></th></tr>'
      +groups[k].map(function(c){ return '<tr'+(c.internal?' class="int"':'')+'><td><b>'+esc(c.name)+'</b> <span style="color:#64748b;font-size:12px">'+esc(RK_CHARGE_KIND[c.kind]||c.kind)+'</span>'+rkInt(c)+(c.note?'<div style="font-size:12px;color:#475569">'+esc(c.note)+'</div>':'')+'</td>'
        +'<td style="white-space:nowrap">'+fmtAmt(c)+'</td><td>'+yn(c.in_base)+'</td><td>'+yn(c.in_final)+'</td><td>'+yn(c.gst_included)+'</td><td>'+(c.confirmed?'Confirmed':'<span style="color:#b45309">Indicative</span>')+'</td>'
        +'<td style="white-space:nowrap">'+(c.effective_from?esc(fmtDate(c.effective_from)):'')+(c.valid_until?' – '+esc(fmtDate(c.valid_until)):'')+'</td><td>'+rkChip(c)+rkChgChip(d,c.id)+'</td><td>'+rkRowBtns('charges',c,id)+'</td></tr>'; }).join('')+'</table></div>';
  }).join(''):'<div class="rk-empty">'+(RK.cust&&d.chg.length?'Prices are pending verification.':'No price components recorded.')+'</div>';
  let h=rkSec('Price breakdown','fa-indian-rupee-sign','charges',id,body+rkNewPend(d,'charges'));
  h+=rkSec('Price calculator','fa-calculator',null,id,rkCalc(d));
  const plan=rkShow(d.plan);
  h+=rkSec('Payment plan','fa-list-ol','payment_plans',id,(plan.length?'<table class="rk-t"><tr><th>Stage</th><th>Percent</th><th>Amount</th><th>Note</th><th></th><th></th></tr>'+plan.map(function(s){ return '<tr><td>'+esc(s.stage)+'</td><td>'+(s.percent!=null?rkNum(s.percent)+'%':'—')+'</td><td>'+(s.amount!=null?rkInr(s.amount):'—')+'</td><td>'+esc(s.note||'')+'</td><td>'+rkChip(s)+rkChgChip(d,s.id)+'</td><td>'+rkRowBtns('payment_plans',s,id)+'</td></tr>'; }).join('')+'</table>':'<div class="rk-empty">No payment plan recorded.</div>')+rkNewPend(d,'payment_plans'));
  return h;
}
/* The total is worked out only from what is recorded: per-sq-ft components x the area, lump sums as they are,
   percentages of the base. Anything unverified or indicative makes the total "Indicative"; nothing missing is
   counted as 0 - with no base rate or unit price there is no total. */
const RK_CALC={};
function rkCalc(d){
  const pid=d.p.id, st=RK_CALC[pid]=RK_CALC[pid]||{cfg:'',area:''};
  const cfgs=rkShow(d.cfg); if(!st.cfg&&cfgs.length) st.cfg=cfgs[0].id;
  const c=cfgs.find(function(x){ return x.id===st.cfg; });
  const area=st.area!==''?Number(st.area):(c&&(c.sba_min!=null?Number(c.sba_min):c.sba_max!=null?Number(c.sba_max):null));
  const parts=rkShow(d.chg).filter(function(x){ return (!x.configuration_id||x.configuration_id===st.cfg)&&x.amount!=null&&!(x.in_base&&x.kind!=='base_rate'&&x.kind!=='unit_price'); });
  let base=0, hasBase=false, lines=[], tentative=false, needArea=false;
  parts.filter(function(x){ return x.kind==='base_rate'||x.kind==='unit_price'; }).forEach(function(x){
    let v=null; if(x.unit==='per_sqft'){ if(area==null||!isFinite(area)){ needArea=true; return; } v=Number(x.amount)*area; } else if(x.unit!=='percent') v=Number(x.amount);
    if(v==null) return; base+=v; hasBase=true; lines.push([x,v]); if(!rkOk(x)||!x.confirmed) tentative=true; });
  let total=base;
  parts.filter(function(x){ return x.kind!=='base_rate'&&x.kind!=='unit_price'; }).forEach(function(x){
    let v=null; if(x.unit==='percent') v=hasBase?base*Number(x.amount)/100:null; else if(x.unit==='per_sqft'){ if(area==null||!isFinite(area)){ needArea=true; return; } v=Number(x.amount)*area; } else v=Number(x.amount);
    if(v==null) return; total+=v; lines.push([x,v]); if(!rkOk(x)||!x.confirmed) tentative=true; });
  let h='<div class="rk-bar"><select onchange="RK_CALC[\''+pid+'\'].cfg=this.value;RK_CALC[\''+pid+'\'].area=\'\';renderPage()">'+(cfgs.length?cfgs.map(function(x){ return '<option value="'+x.id+'"'+(x.id===st.cfg?' selected':'')+'>'+esc(x.name)+'</option>'; }).join(''):'<option>No configuration</option>')+'</select>'
    +'<input type="number" placeholder="Area (sq ft)" style="width:150px" value="'+(area!=null&&isFinite(area)?area:'')+'" onchange="RK_CALC[\''+pid+'\'].area=this.value;renderPage()"> <span style="font-size:12px;color:#64748b">sq ft</span></div>';
  if(!hasBase) return h+'<div class="rk-empty">'+(needArea?'Enter the area to work out a price.':'Not enough information to total: no base rate or unit price is recorded'+(RK.cust?' and verified':'')+' for this configuration.')+'</div>';
  h+='<table class="rk-t">'+lines.map(function(l){ const x=l[0]; return '<tr><td>'+esc(x.name)+rkInt(x)+'</td><td style="color:#64748b;font-size:12px">'+(x.unit==='per_sqft'?rkInr(x.amount)+' × '+rkNum(area)+' sq ft':x.unit==='percent'?rkNum(x.amount)+'% of base':'')+'</td><td style="text-align:right;white-space:nowrap">'+rkInr(l[1])+'</td><td>'+rkChip(x)+'</td></tr>'; }).join('')
    +'<tr><td colspan="2"><b>Total</b> '+(tentative?'<span class="rk-vs pending">Indicative</span>':'<span class="rk-vs verified">All components verified and confirmed</span>')+'</td><td style="text-align:right" class="rk-tot">'+rkInr(total)+'</td><td>'+rkCopyBtn(rkInr(total))+'</td></tr></table>'
    +(needArea?'<div class="rk-pend">Some per-sq-ft components were left out because no area is set.</div>':'')
    +'<div style="font-size:12px;color:#64748b;margin-top:8px">Components marked "included in base" are not added again. Missing components are not counted.</div>';
  return h;
}
function rkTabInventory(d,id){
  const f=RK.inv, all=rkShow(d.units), uniq=function(a){ return Array.from(new Set(a.filter(Boolean))).sort(); };
  const cfgName=function(cid){ const c=d.cfg.find(function(x){ return x.id===cid; }); return c?c.name:''; };
  const rows=all.filter(function(u){ if(f.tower&&u.tower!==f.tower) return false; if(f.cfg&&u.configuration_id!==f.cfg) return false; if(f.status&&u.status!==f.status) return false;
    if(f.q){ const q=f.q.toLowerCase(); if([u.unit_no,u.tower,u.floor,u.facing,u.view,cfgName(u.configuration_id)].join(' ').toLowerCase().indexOf(q)===-1) return false; } return true; });
  const last=all.reduce(function(m,u){ return u.updated_at>m?u.updated_at:m; },'');
  window._rkInvRows=rows.map(function(u){ return Object.assign({},u,{configuration:cfgName(u.configuration_id)}); });
  const bar='<div class="rk-bar rk-noprint"><input type="search" placeholder="Unit, tower, floor..." value="'+esc(f.q)+'" onchange="RK.inv.q=this.value;renderPage()">'
    +'<select onchange="RK.inv.tower=this.value;renderPage()"><option value="">All towers</option>'+uniq(all.map(function(u){ return u.tower; })).map(function(t){ return '<option'+(f.tower===t?' selected':'')+'>'+esc(t)+'</option>'; }).join('')+'</select>'
    +'<select onchange="RK.inv.cfg=this.value;renderPage()"><option value="">All configurations</option>'+d.cfg.map(function(c){ return '<option value="'+c.id+'"'+(f.cfg===c.id?' selected':'')+'>'+esc(c.name)+'</option>'; }).join('')+'</select>'
    +'<select onchange="RK.inv.status=this.value;renderPage()"><option value="">Any status</option>'+['Available','On Hold','Under Verification'].map(function(s){ return '<option'+(f.status===s?' selected':'')+'>'+s+'</option>'; }).join('')+'</select>'
    +'<button class="btn btn-sm" onclick="rkInvExport(\''+id+'\')"><i class="fa-solid fa-file-excel"></i> Export</button>'
    +(rkCanPropose(id)?'<button class="btn btn-sm" onclick="rkInvImportAsk(\''+id+'\')"><i class="fa-solid fa-file-import"></i> Import Excel</button>':'')+'</div>';
  const body=rows.length?'<div class="rk-wrap"><table class="rk-t"><tr><th>Unit</th><th>Tower</th><th>Floor</th><th>Configuration</th><th>Area</th><th>Facing / view</th><th>Base price</th><th>Quoted price</th><th>Status</th><th></th><th></th></tr>'
    +rows.map(function(u){ return '<tr><td><b>'+esc(u.unit_no)+'</b></td><td>'+rkVal(u.tower)+'</td><td>'+rkVal(u.floor)+'</td><td>'+rkVal(cfgName(u.configuration_id))+'</td><td>'+rkVal(u.area,function(x){ return rkNum(x)+' sq ft'; })+'</td>'
      +'<td>'+esc([u.facing,u.view].filter(Boolean).join(' / ')||'—')+'</td><td>'+rkVal(u.base_price,rkInr)+'</td><td>'+rkVal(u.quoted_price,rkInr)+'</td><td>'+esc(u.status)+(u.note?'<div style="font-size:12px;color:#64748b">'+esc(u.note)+'</div>':'')+'</td>'
      +'<td>'+rkChip(u)+rkChgChip(d,u.id)+'</td><td>'+rkRowBtns('units',u,id)+'</td></tr>'; }).join('')+'</table></div>'
    :'<div class="rk-empty">'+(all.length?'No unit matches these filters.':'No free units recorded.')+'</div>';
  return rkSec('Inventory - free units','fa-table-cells','units',id,'<div style="font-size:12.5px;color:#64748b;margin:-4px 0 10px">'+rows.length+' of '+all.length+' free units'+(last?' · last updated '+esc(fmtDate(last)):'')+' · units Farvision shows as booked are hidden'+((d.p.fv_project_ids||[]).length?'':' (this project is not linked to Farvision yet)')+'</div>'+bar+body+rkNewPend(d,'units'));
}
function rkTabAmenities(d,id){
  const rows=rkShow(d.am), g={}; rows.forEach(function(a){ (g[a.category||'Other']=g[a.category||'Other']||[]).push(a); });
  const order=(RK.lists.amenity||[]).concat(Object.keys(g)).filter(function(k,i,a){ return g[k]&&a.indexOf(k)===i; });
  const body=rows.length?order.map(function(k){ return '<div style="font-weight:600;font-size:13px;margin:10px 0 6px">'+esc(k)+'</div><table class="rk-t">'+g[k].map(function(a){ return '<tr><td style="width:30%"><b>'+esc(a.name)+'</b></td><td>'+esc(a.description||'')+(a.place?'<div style="font-size:12px;color:#64748b">'+esc(a.place)+'</div>':'')+'</td><td>'+esc(a.status||'')+'</td><td>'+rkChip(a)+rkChgChip(d,a.id)+'</td><td>'+rkRowBtns('amenities',a,id)+'</td></tr>'; }).join('')+'</table>'; }).join('')
    :'<div class="rk-empty">'+(RK.cust&&d.am.length?'Amenities are pending verification.':'No amenities recorded.')+'</div>';
  return rkSec('Amenities','fa-person-swimming','amenities',id,body+rkNewPend(d,'amenities'));
}
function rkTabLocation(d,id){
  const loc=rkShow(d.loc);
  let h=rkSec('Address','fa-location-dot','locations',id,(loc.length?loc.map(function(l){ return '<div style="display:flex;gap:10px;align-items:flex-start;margin:0 0 10px"><div style="flex:1;font-size:13.5px"><div style="white-space:pre-wrap">'+esc(l.address||'')+(l.pin?' - '+esc(l.pin):'')+rkCopyBtn([l.address,l.pin].filter(Boolean).join(' - '))+'</div>'
      +(l.directions?'<div style="font-size:12.5px;color:#475569;margin-top:4px;white-space:pre-wrap">'+esc(l.directions)+'</div>':'')
      +((l.maps_url||(l.lat&&l.lng))?'<a href="'+esc(l.maps_url||('https://www.google.com/maps?q='+l.lat+','+l.lng))+'" target="_blank" rel="noopener" style="font-size:13px"><i class="fa-solid fa-map"></i> Open in Google Maps</a>'+rkCopyBtn(l.maps_url||(l.lat+','+l.lng)):'')
      +'</div>'+rkChip(l)+rkChgChip(d,l.id)+rkRowBtns('locations',l,id)+'</div>'; }).join(''):'<div class="rk-empty">No address recorded.</div>')+rkNewPend(d,'locations'));
  const lm=rkShow(d.lm), g={}; lm.forEach(function(a){ (g[a.category||'Landmark']=g[a.category||'Landmark']||[]).push(a); });
  const order=(RK.lists.landmark||[]).concat(Object.keys(g)).filter(function(k,i,a){ return g[k]&&a.indexOf(k)===i; });
  h+=rkSec('Nearby','fa-signs-post','landmarks',id,(lm.length?'<div class="rk-wrap"><table class="rk-t"><tr><th>Place</th><th>Kind</th><th>Distance</th><th>Travel time</th><th>Checked</th><th></th><th></th></tr>'+order.map(function(k){ return g[k].map(function(a){
      return '<tr><td><b>'+esc(a.name)+'</b>'+(a.travel_note?'<div style="font-size:12px;color:#64748b">'+esc(a.travel_note)+'</div>':'')+'</td><td>'+esc(k)+'</td><td>'+(a.distance_km!=null?rkNum(a.distance_km)+' km':rkNA())+'</td><td>'+(a.travel_min!=null?rkNum(a.travel_min)+' min':rkNA())+'</td><td>'+(a.verified_at?esc(fmtDate(a.verified_at)):'—')+'</td><td>'+rkChip(a)+rkChgChip(d,a.id)+'</td><td>'+rkRowBtns('landmarks',a,id)+'</td></tr>'; }).join(''); }).join('')+'</table></div>'
    :'<div class="rk-empty">No nearby places recorded.</div>')+rkNewPend(d,'landmarks'));
  return h;
}
function rkTabSales(d,id){
  const rows=rkShow(d.notes);
  const block=function(list,title,cls){ const g={}; list.forEach(function(n){ (g[n.kind]=g[n.kind]||[]).push(n); });
    return '<div class="rk-sec" style="margin:0'+(cls?';'+cls:'')+'"><h4>'+title+'</h4>'+(list.length?Object.keys(RK_NOTE_KIND).filter(function(k){ return g[k]; }).map(function(k){
      return '<div style="font-weight:600;font-size:12.5px;color:#475569;margin:10px 0 4px;text-transform:uppercase;letter-spacing:.03em">'+RK_NOTE_KIND[k]+'</div>'+g[k].map(function(n){
        return '<div style="display:flex;gap:8px;align-items:flex-start;padding:6px 0;border-bottom:1px solid #f1f5f9"><div style="flex:1;font-size:13.5px">'+(n.title?'<b>'+esc(n.title)+'</b><br>':'')+'<span style="white-space:pre-wrap">'+esc(n.body)+'</span>'+rkCopyBtn(n.body)+'</div>'+rkChip(n)+rkChgChip(d,n.id)+rkRowBtns('sales_notes',n,id)+'</div>'; }).join(''); }).join('')
      :'<div class="rk-empty">Nothing recorded.</div>')+'</div>'; };
  let h=rkSec('Sales information','fa-bullhorn','sales_notes',id,'<div class="rk-two">'+block(rows.filter(function(n){ return !n.internal; }),'<i class="fa-solid fa-user" style="color:#16a34a"></i> Customer-facing')
    +(RK.cust?'':block(rows.filter(function(n){ return n.internal; }),'<i class="fa-solid fa-lock" style="color:#7c3aed"></i> Internal - do not share with customers','background:#faf5ff'))+'</div>'+rkNewPend(d,'sales_notes'));
  const bank=rkShow(d.bank);
  h+=rkSec('Bank approvals','fa-building-columns','bank_approvals',id,(bank.length?'<table class="rk-t"><tr><th>Bank</th><th>Status</th><th>Reference</th><th></th><th></th></tr>'+bank.map(function(b){ return '<tr><td><b>'+esc(b.bank)+'</b></td><td>'+rkVal(b.status)+'</td><td>'+rkVal(b.reference)+'</td><td>'+rkChip(b)+rkChgChip(d,b.id)+'</td><td>'+rkRowBtns('bank_approvals',b,id)+'</td></tr>'; }).join('')+'</table>':'<div class="rk-empty">No bank approvals recorded.</div>')+rkNewPend(d,'bank_approvals'));
  return h;
}
function rkTabDocs(d,id){
  const rows=rkShow(d.docs), g={}; rows.forEach(function(x){ (g[x.category]=g[x.category]||[]).push(x); });
  const order=(RK.lists.document||[]).concat(Object.keys(g)).filter(function(k,i,a){ return g[k]&&a.indexOf(k)===i; });
  const body=rows.length?'<table class="rk-t"><tr><th>Document</th><th>Category</th><th>Version</th><th>Added</th><th></th><th></th></tr>'+order.map(function(k){ return g[k].map(function(x){
      return '<tr'+(x.internal?' class="int"':'')+'><td>'+(x.s3_key?'<a href="javascript:void(0)" onclick="rkOpenDoc(\''+id+'\',\''+x.id+'\')"><i class="fa-regular fa-file"></i> '+esc(x.title)+'</a>':esc(x.title)+' <span class="rk-na">(no file)</span>')+rkInt(x)+'</td><td>'+esc(k)+'</td><td>'+esc(x.version||'')+'</td><td>'+esc(fmtDate(x.entered_at))+(x.entered_by?'<div style="font-size:11.5px;color:#64748b">'+esc(x.entered_by)+'</div>':'')+'</td><td>'+rkChip(x)+rkChgChip(d,x.id)+'</td><td>'+rkRowBtns('documents',x,id)+'</td></tr>'; }).join(''); }).join('')+'</table>'
    :'<div class="rk-empty">No documents uploaded.</div>';
  return rkSec('Documents','fa-folder-open','documents',id,body+rkNewPend(d,'documents'));
}
window.rkOpenDoc=function(pid,did){ const x=(RK.proj[pid].docs||[]).find(function(r){ return r.id===did; }); if(x&&x.s3_key) s3OpenSigned(x.s3_key,x.file_name||x.title); };

/* ---------------------------------------------------------------- proposing a change */
function rkFields(tbl){ return RK_F[tbl].concat(tbl==='assignments'?[]:RK_COMMON); }
function rkRec(tbl,id,pid){ if(tbl==='projects') return (RK.proj[id]&&RK.proj[id].p)||(RK.projects||[]).find(function(p){ return p.id===id; });
  const d=RK.proj[pid]; if(!d) return null; const m={locations:'loc',configurations:'cfg',charges:'chg',payment_plans:'plan',offers:'off',units:'units',amenities:'am',landmarks:'lm',sales_notes:'notes',bank_approvals:'bank',documents:'docs',assignments:'team'};
  return (d[m[tbl]]||[]).find(function(r){ return r.id===id; }); }
function rkInput(f,val,pid){
  const col=f[0], lbl=f[1], ty=f[2]||'text', req=f[3]?' *':'', v=val==null?'':val, nm=' data-c="'+col+'" data-t="'+ty.split(':')[0]+'"';
  if(ty==='bool') return '<label class="cb"><input type="checkbox"'+nm+(val?' checked':'')+'> '+esc(lbl)+'</label>';
  if(ty==='fv'){ const on=(Array.isArray(val)?val:[]).map(String);
    return '<label class="w">'+esc(lbl)+'<span'+nm+' style="display:flex;flex-wrap:wrap;gap:6px 16px;font-weight:500;color:#0f172a">'+(RK.fv||[]).map(function(p){ return '<span style="display:inline-flex;gap:5px;align-items:center"><input type="checkbox" value="'+p.id+'"'+(on.indexOf(String(p.id))!==-1?' checked':'')+'> '+esc(p.name)+'</span>'; }).join('')+'</span></label>'; }
  if(ty==='tri') return '<label>'+esc(lbl)+'<select'+nm+'><option value="">Not known</option><option value="true"'+(val===true?' selected':'')+'>Yes</option><option value="false"'+(val===false?' selected':'')+'>No</option></select></label>';
  if(ty==='area') return '<label class="w">'+esc(lbl)+req+'<textarea rows="3"'+nm+'>'+esc(String(v))+'</textarea></label>';
  if(ty==='file') return '<label class="w">'+esc(lbl)+(val?' (a file is attached; choose one to replace it)':'')+'<input type="file"'+nm+'></label>';
  if(ty.indexOf('sel:')===0||ty.indexOf('list:')===0||ty==='cfg'||ty==='fv'){
    let opts=[];
    if(ty.indexOf('sel:')===0) opts=ty.slice(4).split(',').map(function(o){ const p=o.split('='); return [p[0],p[1]||p[0]]; });
    else if(ty.indexOf('list:')===0) opts=(RK.lists[ty.slice(5)]||[]).map(function(o){ return [o,o]; });
    else if(ty==='cfg') opts=[['','All configurations / not specific']].concat(((RK.proj[pid]||{}).cfg||[]).map(function(c){ return [c.id,c.name]; }));
    else opts=[['','Not linked']].concat((RK.fv||[]).map(function(p){ return [String(p.id),p.name]; }));
    if(ty.indexOf('list:')===0&&v&&!opts.some(function(o){ return o[0]===v; })) opts.push([v,v]);
    return '<label>'+esc(lbl)+req+'<select'+nm+'>'+(ty==='cfg'||ty==='fv'?'':'<option value=""></option>')+opts.map(function(o){ return '<option value="'+esc(o[0])+'"'+(String(v)===String(o[0])?' selected':'')+'>'+esc(o[1])+'</option>'; }).join('')+'</select></label>';
  }
  const it=ty==='num'||ty==='int'?'number" step="any':ty==='date'?'date':'text';
  return '<label'+(col==='name'||col==='title'||col==='maps_url'?' class="w"':'')+'>'+esc(lbl)+req+'<input type="'+it+'"'+nm+' value="'+esc(String(v))+'"></label>';
}
window.rkEdit=async function(tbl,id,pid){
  if(tbl==='projects') await rkFv();
  const r=id?rkRec(tbl,id,pid):null;
  if(id&&!r){ toast('This record is not loaded - refresh the page','err'); return; }
  const pend=id&&pid&&RK.proj[pid]?rkChgFor(RK.proj[pid],id):[];
  openModal('<div class="modal-head"><h3><i class="fa-solid fa-pen"></i> '+(id?'Propose a change - ':'Add ')+esc(RK_TBL_LABEL[tbl])+'</h3><span class="x" onclick="closeModal()">&times;</span></div>'
    +'<div class="modal-body"><div class="rk-pend" style="margin:0 0 12px"><i class="fa-solid fa-shield-halved"></i> Nothing changes until an approver accepts it. Until then the current approved value stays on screen, marked "Change pending".</div>'
    +(pend.length?'<div class="rk-pend" style="margin:0 0 12px;background:#fffbeb;border-color:#fcd34d;color:#92400e">'+pend.length+' change(s) to this are already waiting for approval.</div>':'')
    +'<div class="rk-form" id="rkForm">'+rkFields(tbl).map(function(f){ return rkInput(f,r?r[f[0]]:(f[2]==='bool'?false:null),pid); }).join('')
    +'<hr><label class="w">Reason for this change<input type="text" id="rkReason" placeholder="e.g. new price list from 20 Nov"></label></div></div>'
    +'<div class="modal-foot"><button class="btn" onclick="closeModal()">Cancel</button><button class="btn btn-primary" id="rkSave" onclick="rkSave(\''+tbl+'\','+(id?'\''+id+'\'':'null')+','+(pid?'\''+pid+'\'':'null')+')"><i class="fa-solid fa-paper-plane"></i> Send for approval</button></div>','lg');
};
window.rkSave=async function(tbl,id,pid){
  const btn=$('rkSave'), form=$('rkForm'); if(!form) return;
  const r=id?rkRec(tbl,id,pid):null, payload={};
  let file=null, missing=[];
  form.querySelectorAll('[data-c]').forEach(function(el){
    const c=el.getAttribute('data-c'), t=el.getAttribute('data-t'); let v;
    if(t==='file'){ if(el.files&&el.files[0]) file=el.files[0]; return; }
    if(t==='fv'){ v=Array.from(el.querySelectorAll('input:checked')).map(function(x){ return Number(x.value); }).sort(function(a,b){ return a-b; }); if(!v.length) v=null; } else if(t==='bool') v=el.checked; else if(t==='tri') v=el.value===''?null:el.value==='true'; else { v=el.value.trim(); if(v==='') v=null; else if(t==='num') v=Number(v); else if(t==='int') v=parseInt(v,10); }
    const f=rkFields(tbl).find(function(x){ return x[0]===c; }); if(f&&f[3]&&(v==null||v==='')) missing.push(f[1]);
    if(r){ const old=Array.isArray(r[c])?r[c].slice().sort(function(a,b){ return a-b; }):r[c]; const same=(old==null&&v==null)||(old!=null&&v!=null&&String(old)===String(v))||(t==='bool'&&!!old===!!v); if(!same) payload[c]=v; }
    else if(t==='bool'||v!=null) payload[c]=v;
  });
  if(tbl==='documents'&&!id&&!file) missing.push('File');
  if(missing.length){ toast('Please fill: '+missing.join(', '),'warn'); return; }
  btn.disabled=true; btn.innerHTML='<i class="fa-solid fa-spinner fa-spin"></i> Sending...';
  try{
    if(file){
      const up=await uploadFileToS3('portal/reckoner/'+(pid||'new')+'/'+s3Stamp()+'_'+s3SafeName(file.name),file);
      if(up.error) throw up.error;
      Object.assign(payload,{s3_key:up.data.path,file_name:file.name,mime:file.type||null,size_bytes:file.size});
    }
    if(id&&!Object.keys(payload).length){ toast('Nothing was changed','warn'); btn.disabled=false; btn.innerHTML='<i class="fa-solid fa-paper-plane"></i> Send for approval'; return; }
    if(!id&&tbl!=='projects') payload.project_id=pid;
    const res=await RKS().rpc('propose',{p_tbl:tbl,p_record:id,p_op:id?'update':'insert',p_payload:payload,p_reason:($('rkReason')||{}).value||null,p_source:payload.source||null,p_project:tbl==='projects'?id:pid,p_batch:null});
    if(res.error) throw res.error;
    closeModal(); toast('Sent for approval','ok'); RK.pendN++;
    if(pid) await rkDetail(pid,true);
    renderPage();
  }catch(e){ toast(String((e&&e.message)||e),'err'); btn.disabled=false; btn.innerHTML='<i class="fa-solid fa-paper-plane"></i> Send for approval'; }
};
window.rkArchive=async function(tbl,id,pid){
  const r=rkRec(tbl,id,pid); if(!r) return;
  const ok=await confirmDialog('Propose removing "'+(r.name||r.title||r.unit_no||r.stage||r.bank||r.email||r.address||'this entry')+'"? It stays visible until an approver accepts the removal, and is kept in the history after that.',{title:'Propose removal',okLabel:'Send for approval',danger:false});
  if(!ok) return;
  const res=await RKS().rpc('propose',{p_tbl:tbl,p_record:id,p_op:'archive',p_payload:{},p_reason:null,p_source:null,p_project:pid,p_batch:null});
  if(res.error){ toast(res.error.message,'err'); return; }
  toast('Removal sent for approval','ok'); RK.pendN++; await rkDetail(pid,true); renderPage();
};

/* ---------------------------------------------------------------- inventory Excel */
const RK_INV_COLS=[['unit_no','Unit no.'],['tower','Tower'],['floor','Floor'],['configuration','Configuration'],['area','Area (sq ft)'],['facing','Facing'],['view','View'],['base_price','Base price'],['extra_charges','Extra charges'],['quoted_price','Quoted price'],['status','Status'],['note','Remarks']];
window.rkInvExport=async function(pid){
  const XL=await loadXLSX(); if(!XL){ toast('Excel library did not load','err'); return; }
  const rows=(window._rkInvRows||[]).map(function(u){ const o={}; RK_INV_COLS.forEach(function(c){ o[c[1]]=u[c[0]]==null?'':u[c[0]]; }); o['Verification']=rkState(u); return o; });
  const ws=XL.utils.json_to_sheet(rows.length?rows:[RK_INV_COLS.reduce(function(o,c){ o[c[1]]=''; return o; },{})]);
  const wb=XL.utils.book_new(); XL.utils.book_append_sheet(wb,ws,'Inventory');
  XL.writeFile(wb,'Reckoner inventory - '+rkProjName(pid).replace(/[^\w\- ]/g,'')+' - '+rkToday()+'.xlsx');
};
window.rkInvImportAsk=function(pid){
  openModal('<div class="modal-head"><h3><i class="fa-solid fa-file-import"></i> Import units from Excel</h3><span class="x" onclick="closeModal()">&times;</span></div>'
    +'<div class="modal-body" style="font-size:13.5px"><p>Columns (first row): '+RK_INV_COLS.map(function(c){ return '<b>'+c[1]+'</b>'; }).join(', ')+'. Use <b>Export</b> for a sheet with these headings.</p>'
    +'<p>A unit already in Reckoner (same unit no. and tower) becomes a proposed change; a new one becomes a proposed addition. All of it waits for approval.</p>'
    +'<input type="file" id="rkInvFile" accept=".xlsx,.xls,.csv"><div id="rkInvOut" style="margin-top:10px"></div></div>'
    +'<div class="modal-foot"><button class="btn" onclick="closeModal()">Close</button><button class="btn btn-primary" id="rkInvGo" onclick="rkInvImport(\''+pid+'\')">Read and send</button></div>');
};
window.rkInvImport=async function(pid){
  const inp=$('rkInvFile'), out=$('rkInvOut'), btn=$('rkInvGo'); if(!inp||!inp.files[0]){ toast('Choose a file','warn'); return; }
  btn.disabled=true;
  try{
    const XL=await loadXLSX(); const wb=XL.read(await inp.files[0].arrayBuffer(),{type:'array'});
    const raw=XL.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]],{defval:''});
    const norm=function(s){ return String(s).toLowerCase().replace(/[^a-z]/g,''); };
    const d=RK.proj[pid];
    const allU=await rkPages(function(){ return RKS().from('units').select('*').eq('project_id',pid).eq('archived',false); });
    const key=function(u,t){ return String(u||'').trim().toUpperCase()+'|'+String(t||'').trim().toUpperCase(); };
    const have={}; allU.forEach(function(u){ have[key(u.unit_no,u.tower)]=u; });
    const batch='import-'+Date.now(); let add=0, chg=0, same=0, bad=[];
    const jobs=[];
    raw.forEach(function(row,i){
      const get=function(lbl){ const k=Object.keys(row).find(function(k){ return norm(k)===norm(lbl); }); return k==null?undefined:row[k]; };
      const p={};
      RK_INV_COLS.forEach(function(c){ let v=get(c[1]); if(v===undefined) return; v=typeof v==='string'?v.trim():v; if(v==='') v=null;
        if(c[0]==='configuration'){ if(v==null){ p.configuration_id=null; return; } const cf=d.cfg.find(function(x){ return norm(x.name)===norm(v); }); if(!cf){ bad.push('row '+(i+2)+': configuration "'+v+'" not found'); return; } p.configuration_id=cf.id; return; }
        if(['area','base_price','extra_charges','quoted_price'].indexOf(c[0])!==-1&&v!=null){ const n=Number(String(v).replace(/[,₹\s]/g,'')); if(!isFinite(n)){ bad.push('row '+(i+2)+': '+c[1]+' is not a number'); return; } v=n; }
        if(c[0]==='status'&&v!=null&&['Available','On Hold','Booked','Sold','Blocked','Under Verification'].indexOf(v)===-1){ bad.push('row '+(i+2)+': status "'+v+'" not allowed'); return; }
        p[c[0]]=v==null?null:(typeof v==='number'?v:String(v)); });
      if(!p.unit_no){ if(Object.keys(p).length) bad.push('row '+(i+2)+': no unit no.'); return; }
      const ex=have[key(p.unit_no,p.tower)];
      if(ex){ const diff={}; Object.keys(p).forEach(function(k){ if(String(ex[k]==null?'':ex[k])!==String(p[k]==null?'':p[k])) diff[k]=p[k]; });
        if(!Object.keys(diff).length){ same++; return; } chg++; jobs.push({p_tbl:'units',p_record:ex.id,p_op:'update',p_payload:diff,p_reason:'Excel import',p_source:inp.files[0].name,p_project:pid,p_batch:batch}); }
      else { add++; p.project_id=pid; if(!p.status) p.status='Available'; jobs.push({p_tbl:'units',p_record:null,p_op:'insert',p_payload:p,p_reason:'Excel import',p_source:inp.files[0].name,p_project:pid,p_batch:batch}); }
    });
    if(bad.length){ out.innerHTML='<div style="color:#b91c1c">Nothing was sent. Please fix these rows:<br>'+bad.slice(0,30).map(esc).join('<br>')+(bad.length>30?'<br>... and '+(bad.length-30)+' more':'')+'</div>'; btn.disabled=false; return; }
    if(!jobs.length){ out.innerHTML='Nothing to send: every row matches what is already recorded ('+same+').'; btn.disabled=false; return; }
    let done=0, fail=[];
    for(let i=0;i<jobs.length;i+=5){
      const got=await Promise.all(jobs.slice(i,i+5).map(function(j){ return RKS().rpc('propose',j); }));
      got.forEach(function(r,k){ if(r.error) fail.push((jobs[i+k].p_payload.unit_no||'unit')+': '+r.error.message); else done++; });
      out.innerHTML='Sending... '+done+' of '+jobs.length;
    }
    out.innerHTML='<b>'+done+'</b> sent for approval ('+add+' new, '+chg+' changed, '+same+' unchanged).'+(fail.length?'<div style="color:#b91c1c">Not sent: '+fail.slice(0,20).map(esc).join('; ')+'</div>':'');
    RK.pendN+=done; await rkDetail(pid,true); renderPage();
  }catch(e){ out.innerHTML='<div style="color:#b91c1c">'+esc(String((e&&e.message)||e))+'</div>'; btn.disabled=false; }
};

/* Verifying a record as it is (workbook imports arrive as Pending Verification): approvers only, through rk.set_vstatus,
   which is re-checked in the database and written to the audit log. */
window.rkVerify=async function(tbl,ids,pid,quiet){
  let ok=0, err=null;
  for(const id of ids){ const r=await RKS().rpc('set_vstatus',{p_tbl:tbl,p_id:id,p_status:'verified',p_remarks:null}); if(r.error){ err=r.error.message; break; } ok++; }
  if(err) toast(err,'err'); else if(!quiet) toast(ok===1?'Verified':'Verified '+ok,'ok');
  if(pid){ try{ await rkDetail(pid,true); }catch(e){} } RK.projects=null; renderPage();
};
window.rkVerifyAll=async function(tbl,pid){
  const d=RK.proj[pid]; if(!d) return; const rows=(d[RK_KEY[tbl]]||[]).filter(function(x){ return rkState(x)==='pending'; });
  const ok=await confirmDialog('Mark all '+rows.length+' '+(RK_TBL_LABEL[tbl]||tbl).toLowerCase()+' entries of '+d.p.name+' as verified? Check each one against its source first - this tells Sales they are correct.',{title:'Verify all',okLabel:'Verify '+rows.length,danger:false});
  if(!ok) return; rkVerify(tbl,rows.map(function(x){ return x.id; }),pid);
};
