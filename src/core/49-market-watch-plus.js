/* MARKET WATCH - OUR ADS' HOOK AND HOLD RATES (16 Nov 2026, Ayush: "Build all three"): our own Facebook video ads ranked by
   hook rate (3-second views / impressions) and hold rate (ThruPlays / 3-second views), joined to the CRM's leads and
   qualified leads per ad. Shown as Hook Library > Our ads (50-market-watch-ai.js). The Kolkata-buyers and the word-rule
   launch list that were here were replaced the same evening by the AI Trends and Launches (Ayush: "Remove Kolkata Buyers",
   "the data of Launches is wrong, it's not based on Ads"). */

const MWP_CSS='<style>'
  +'.mwp-stats{display:flex;gap:10px;flex-wrap:wrap;margin:0 0 14px}'
  +'.mwp-st{background:var(--card,#fff);border:1px solid var(--line);border-radius:10px;padding:10px 14px;min-width:150px}'
  +'.mwp-st b{display:block;font-size:20px;font-weight:700;color:var(--ink)}.mwp-st span{font-size:11.5px;color:var(--slate)}'
  +'.mwp-card{background:var(--card,#fff);border:1px solid var(--line);border-radius:12px;overflow:hidden;display:flex;flex-direction:column}'
  +'.mwp-th{aspect-ratio:1/1;background:#0f172a center/contain no-repeat}'
  +'.mwp-cb{padding:10px 12px 12px;display:flex;flex-direction:column;gap:6px;min-width:0}'
  +'.mwp-row{display:flex;gap:6px;flex-wrap:wrap}'
  +'.mwp-pill{font-size:11.5px;font-weight:650;padding:3px 8px;border-radius:999px;background:#f1f5f9;color:#334155}'
  +'.mwp-pill.good{background:#dcfce7;color:#166534}.mwp-pill.low{background:#fef3c7;color:#92400e}'
  +'.mwp-h{font-size:15px;font-weight:700;margin:4px 0 4px;color:var(--ink)}'
  +'.mwp-up{color:#16a34a;font-weight:700}.mwp-dn{color:#dc2626;font-weight:700}'
  +'.mwp-sec{margin:0 0 18px}'
  +'</style>';
const mwpDay=function(n){ const d=new Date(Date.now()+5.5*3600e3); d.setUTCDate(d.getUTCDate()+n); return d.toISOString().slice(0,10); };
const mwpPct=function(x,dp){ return isFinite(x)?(x*100).toFixed(dp==null?1:dp)+'%':'—'; };
const mwpRs=function(x){ return isFinite(x)&&x>0?'₹'+inrGroup(String(Math.round(x))):'—'; };
function mwpMed(a){ const s=a.filter(isFinite).slice().sort((x,y)=>x-y); if(!s.length) return NaN; const m=s.length>>1; return s.length%2?s[m]:(s[m-1]+s[m])/2; }
function mwpSpark(vals,w,h){
  w=w||110; h=h||26; const v=vals.map(Number).filter(isFinite); if(v.length<2) return '';
  const mx=Math.max.apply(null,v), mn=Math.min.apply(null,v), r=mx-mn||1;
  const pts=v.map((y,i)=>(i*(w-2)/(v.length-1)+1).toFixed(1)+','+(h-2-(y-mn)/r*(h-4)).toFixed(1)).join(' ');
  return '<svg width="'+w+'" height="'+h+'" viewBox="0 0 '+w+' '+h+'" style="display:block"><polyline points="'+pts+'" fill="none" stroke="var(--brand)" stroke-width="1.6" stroke-linejoin="round"/></svg>';
}

/* ---------------------------------------------------------------- 1. Hook Library > Our ads */
let MWP_HOOKS=null, MWP_HSORT='ql';
async function mwOurHooks(){
  const x=$('mwX'); if(!x) return;
  if(!MWP_HOOKS){
    const from=mwpDay(-90);
    let rows;
    try{
      rows=await ciAll(()=>sb.schema('camp').from('ads_ad_daily').select('ad_id,campaign_id,spend,impressions,video_3s,video_p25,video_p50,video_p100,video_thruplay').eq('platform','meta').gte('day',from).gt('impressions',0));
    }catch(e){
      if(/video_3s/.test((e&&e.message)||'')){ x.innerHTML=MWP_CSS+'<div class="card card-pad empty"><i class="fa-solid fa-clock"></i><div>Our ads\u2019 video plays are read from Facebook tonight (from 20:20). Hook and hold rates show here from tomorrow morning.</div></div>'; return; }
      throw e;
    }
    const by={};
    rows.forEach(r=>{ const o=by[r.ad_id]=by[r.ad_id]||{ad_id:r.ad_id,campaign_id:r.campaign_id,spend:0,imp:0,v3:0,p25:0,p50:0,p100:0,thru:0};
      o.spend+=+r.spend||0; o.imp+=+r.impressions||0; o.v3+=+r.video_3s||0; o.p25+=+r.video_p25||0; o.p50+=+r.video_p50||0; o.p100+=+r.video_p100||0; o.thru+=+r.video_thruplay||0; });
    const ads=Object.values(by).filter(o=>o.v3>0&&o.imp>=3000);
    const ids=ads.map(o=>o.ad_id);
    const [crm,ents]=await Promise.all([
      ids.length?ciAll(()=>sb.schema('camp').from('crm_adset_daily').select('ad_id,leads,qualified').eq('src','facebook').eq('level','ad').gte('day',from)):[],
      ids.length?ciAll(()=>sb.schema('camp').from('ads_entities').select('id,kind,name,thumbnail,body,status').eq('platform','meta').in('kind',['ad','campaign'])):[]
    ]);
    const cr={}; crm.forEach(r=>{ const o=cr[r.ad_id]=cr[r.ad_id]||{l:0,q:0}; o.l+=+r.leads||0; o.q+=+r.qualified||0; });
    const en={}; ents.forEach(e=>{ en[e.kind+'|'+e.id]=e; });
    // Shrunk rates (Beta prior from all our video ads): an ad with few impressions is pulled toward the average, so a
    // lucky 2,000-impression ad does not top a steady 2-lakh one.
    const H=ads.reduce((s,o)=>s+o.v3,0)/ads.reduce((s,o)=>s+o.imp,0)||0;
    const T=ads.reduce((s,o)=>s+o.thru,0)/ads.reduce((s,o)=>s+o.v3,0)||0;
    const KH=2000, KT=300;
    ads.forEach(o=>{ const c=cr[o.ad_id]||{l:0,q:0}; o.leads=c.l; o.ql=c.q;
      o.hook=(o.v3+KH*H)/(o.imp+KH); o.hold=(o.thru+KT*T)/(o.v3+KT); o.rawHook=o.v3/o.imp; o.rawHold=o.v3?o.thru/o.v3:0;
      const a=en['ad|'+o.ad_id]||{}, c2=en['campaign|'+o.campaign_id]||{};
      o.name=a.name||o.ad_id; o.thumb=a.thumbnail||''; o.body=a.body||''; o.status=a.status||''; o.camp=c2.name||''; });
    MWP_HOOKS={ads,H,T,medH:mwpMed(ads.map(o=>o.hook)),medT:mwpMed(ads.map(o=>o.hold))};
  }
  mwDrawOurHooks();
}
window.mwHSort=function(v){ MWP_HSORT=v; mwDrawOurHooks(); };
function mwDrawOurHooks(){
  const x=$('mwX'); if(!x||!MWP_HOOKS) return;
  const d=MWP_HOOKS, list=d.ads.slice();
  if(!list.length){ x.innerHTML=MWP_CSS+'<div class="card card-pad empty"><i class="fa-solid fa-film"></i><div>No video ads with 3,000+ impressions in the last 90 days yet.</div></div>'; return; }
  if(MWP_HSORT==='hook') list.sort((a,b)=>b.hook-a.hook);
  else if(MWP_HSORT==='hold') list.sort((a,b)=>b.hold-a.hold);
  else list.sort((a,b)=>(b.ql-a.ql)||(b.hook-a.hook));
  const chip=(v,l)=>'<button class="mw-chip'+(MWP_HSORT===v?' on':'')+'" onclick="mwHSort(\''+v+'\')">'+l+'</button>';
  const pill=(lab,v,med)=>'<span class="mwp-pill '+(v>=med*1.15?'good':v<=med*0.85?'low':'')+'">'+lab+' '+mwpPct(v)+'</span>';
  x.innerHTML=MWP_CSS
    +'<div class="mwp-stats">'
      +'<div class="mwp-st"><b>'+list.length+'</b><span>video ads, last 90 days</span></div>'
      +'<div class="mwp-st"><b>'+mwpPct(d.H)+'</b><span>hook rate overall (3-sec views / impressions)</span></div>'
      +'<div class="mwp-st"><b>'+mwpPct(d.T)+'</b><span>hold rate overall (ThruPlays / 3-sec views)</span></div>'
    +'</div>'
    +'<div class="mw-bar">'+chip('ql','Most qualified leads')+chip('hook','Best hook')+chip('hold','Best hold')+'</div>'
    +'<div class="mw-sub" style="margin:-6px 0 12px">Green = 15%+ above our median, amber = 15%+ below. Rates are adjusted for how many people saw the ad, so a small lucky ad does not top a proven one. Leads and QL are the CRM\u2019s count for that ad.</div>'
    +'<div class="mw-grid">'+list.slice(0,24).map(o=>{
      const cpq=o.ql?o.spend/o.ql:NaN;
      return '<div class="mwp-card" title="'+esc('Of 3-second viewers: '+mwpPct(o.p25/o.v3,0)+' reached 25%, '+mwpPct(o.p50/o.v3,0)+' 50%, '+mwpPct(o.p100/o.v3,0)+' the end')+'">'
        +'<div class="mwp-th" style="background-image:url(\''+esc(o.thumb)+'\')"></div>'
        +'<div class="mwp-cb"><div class="mw-ct" title="'+esc(o.name)+'">'+esc(o.name)+'</div>'
          +'<div class="mw-cc">'+esc(o.camp)+(o.status&&o.status!=='ACTIVE'?' · '+esc(o.status.toLowerCase())+'':'')+'</div>'
          +'<div class="mwp-row">'+pill('Hook',o.hook,d.medH)+pill('Hold',o.hold,d.medT)+'</div>'
          +'<div class="mw-cs"><span>'+inrGroup(String(o.leads))+' leads</span><span><b>'+inrGroup(String(o.ql))+'</b> QL</span><span>'+(o.ql?mwpRs(cpq)+' / QL':mwpRs(o.spend)+' spent')+'</span></div>'
        +'</div></div>';
    }).join('')+'</div>';
}

