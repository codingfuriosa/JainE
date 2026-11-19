
/* ---------------------------------------------------------------- Jain Group Fb Ads / Jain Group Google Ads (Competitor Data)
   OUR OWN ADS, FROM OUR OWN AD ACCOUNTS (19 Nov 2026, Ayush: "I want to see the ads in Facebook and Google showing in
   Campaign Analytics ... their data won't come from Ads Transparency Center"). Every ad that ran in our own accounts in the
   chosen period, project by project, each with its full creative read from Meta / Google by the edge function gads-probe
   (a reused slot - see its header). Nothing here spends Proxy credits.
   Later the same day, as asked: no status dropdown, no "read at" line or refresh button, no spend or other figures anywhere
   (the cards show the ad, the popup shows the ad and its words), a plain loader, each tab keeps its own period, the answer is
   kept warm by an hourly job and the other tab's ads are fetched in the background, Facebook videos are fetched before they
   are opened, and in the popup the pictures / video go one at a time (previous / next) and the words sit in sections of
   which exactly one is open, so the popup keeps one height. */
const OA={days:{meta:30,google:30},proj:{meta:'',google:''},data:{},busy:{},wait:{}};
try{ const s=JSON.parse(localStorage.getItem('oaWhere')||'{}'); if(s.days&&typeof s.days==='object') OA.days=Object.assign(OA.days,s.days); }catch(e){}
function oaKeep(){ try{ localStorage.setItem('oaWhere',JSON.stringify({days:OA.days})); }catch(e){} }
// YouTube refuses to play ("Error 153") when it cannot tell which site embeds it, so the page's address is always sent
function oaYtSrc(id,auto){ return 'https://www.youtube.com/embed/'+encodeURIComponent(id)+'?rel=0&playsinline=1&modestbranding=1'+(auto?'&autoplay=1&mute=1':'')+'&origin='+encodeURIComponent(location.origin); }
const OA_CSS='<style id="oaCss">'
  +'.oa-bar{display:flex;flex-wrap:wrap;gap:8px 10px;align-items:center;margin:0 0 14px}'
  +'.oa-bar select{height:34px;border:1px solid var(--line);border-radius:9px;padding:0 10px;background:#fff;font:inherit;font-size:13px}'
  +'.oa-chip{height:30px;display:inline-flex;align-items:center;gap:6px;padding:0 11px;border:1px solid var(--line);border-radius:999px;background:#fff;font-size:12.5px;cursor:pointer;white-space:nowrap}'
  +'.oa-chip b{font-weight:700;color:var(--slate);font-size:11.5px}.oa-chip.on{background:#0f172a;border-color:#0f172a;color:#fff}.oa-chip.on b{color:#cbd5e1}'
  +'.oa-sec{margin:0 0 22px}.oa-sec h3{margin:0 2px 10px;font-size:15px}'
  +'.oa-ad{padding-bottom:12px}.oa-ad .pic{position:relative;aspect-ratio:1/1;background:#f1f5f9;display:flex;align-items:center;justify-content:center;overflow:hidden}'
  +'.oa-ad .pic img{width:100%;height:100%;object-fit:contain}'
  +'.oa-ad .pic .play{position:absolute;width:44px;height:44px;border-radius:50%;background:rgba(15,23,42,.72);color:#fff;display:flex;align-items:center;justify-content:center;font-size:15px}'
  +'.oa-ad .pic .n{position:absolute;top:8px;right:8px;background:rgba(15,23,42,.72);color:#fff;font-size:11px;font-weight:600;border-radius:999px;padding:2px 8px}'
  +'.oa-srch{padding:16px 14px;background:#fff;overflow:hidden;font-family:Arial,sans-serif}.oa-ad .oa-srch{aspect-ratio:1/1;border-bottom:1px solid var(--line)}'
  +'.oa-srch .sp{font-size:11px;font-weight:700;color:#202124;margin-bottom:4px}.oa-srch .u{font-size:12px;color:#202124;margin-bottom:6px;word-break:break-all}'
  +'.oa-srch .h{font-size:16px;line-height:1.3;color:#1a0dab;margin-bottom:6px}.oa-srch .d{font-size:13px;line-height:1.45;color:#4d5156}'
  +'.oa-ad .hd{padding:9px 12px 0;font-size:13px;font-weight:700;line-height:1.35;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}'
  +'.oa-ad .tx{padding:4px 12px 0;font-size:12.5px;color:#334155;line-height:1.45;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden;white-space:pre-line}'
  +'.oa-ad .cp{padding:7px 12px 0;font-size:11.5px;color:var(--slate);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}'
  // the popup: media on the left (one at a time), the words on the right (one section open)
  +'.oa-pop{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:18px;align-items:start}@media(max-width:820px){.oa-pop{grid-template-columns:1fr}}'
  // one fixed height for the media and the words, so the popup never changes size: a picture or video sits inside it at
  // its own shape (no box drawn round it), whatever its length
  +'.oa-pop{--oa-h:min(62vh,540px)}'
  +'.oa-stage{position:relative;height:var(--oa-h);display:flex;align-items:center;justify-content:center}'
  +'.oa-stage img,.oa-stage video{display:block;max-width:100%;max-height:100%;width:auto;height:auto;object-fit:contain;border-radius:10px}'
  +'.oa-stage .yt{width:100%;max-height:100%;aspect-ratio:16/9}.oa-stage .yt iframe{width:100%;height:100%;border:0;display:block;border-radius:10px}'
  +'.oa-stage .fbw{width:100%;height:100%}.oa-stage .fbp{width:100%;height:100%;border:0;display:block}'
  +'.oa-stage .wait{color:#94a3b8;font-size:22px;padding:60px}'
  +'.oa-nav{display:flex;align-items:center;justify-content:center;gap:12px;margin-top:10px;font-size:12.5px;color:var(--slate)}'
  +'.oa-nav button{width:34px;height:34px;border-radius:50%;border:1px solid var(--line);background:#fff;cursor:pointer;display:inline-flex;align-items:center;justify-content:center}.oa-nav button:disabled{opacity:.35;cursor:default}'
  +'.oa-cap{font-size:12.5px;margin-top:8px;line-height:1.45}'
  +'.oa-acc{border:1px solid var(--line);border-radius:12px;overflow:hidden;height:var(--oa-h);display:flex;flex-direction:column}'
  +'.oa-acc .h{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:11px 14px;font-weight:700;font-size:13px;cursor:pointer;background:#f8fafc;border-top:1px solid var(--line)}'
  +'.oa-acc .h:first-child{border-top:0}.oa-acc .h.on{cursor:default;background:#fff}.oa-acc .h span{color:var(--slate);font-weight:600;font-size:12px}'
  +'.oa-acc .b{display:none;padding:4px 14px 12px;flex:1 1 auto;min-height:0;overflow:auto}.oa-acc .b.on{display:block}.oa-acc .h{flex:none}'
  +'.oa-acc ol{margin:0;padding-left:20px}.oa-acc li{margin:0 0 8px;line-height:1.5;white-space:pre-line;font-size:13px}'
  +'.oa-yt{margin-top:8px;text-align:center;font-size:12px}'
  +'</style>';
const oaLive=function(s){ s=String(s||''); return s==='ACTIVE'||s==='ENABLED'; };
function oaRunning(a){ return oaLive(a.status)&&(!a.campaign_status||oaLive(a.campaign_status))&&(!a.adset_status||oaLive(a.adset_status)); }
/* REMEMBERED IN THIS BROWSER (19 Nov 2026, Ayush: "it will load once but should be remembered"). The last answer for each
   tab and period is kept in this browser, so the tab opens on it at once; the server is still asked, quietly, and the page
   is redrawn only if the server has a newer read. When the browser's storage is full the older copies make room. */
function oaMemGet(key){ try{ const s=localStorage.getItem('oaAds:'+key); return s?JSON.parse(s):null; }catch(e){ return null; } }
function oaMemPut(key,t){
  const s=JSON.stringify(t);
  for(let n=0;n<3;n++){
    try{ localStorage.setItem('oaAds:'+key,s); return; }
    catch(e){ try{ Object.keys(localStorage).filter(function(k){ return k.indexOf('oaAds:')===0&&k!=='oaAds:'+key; }).slice(0,2).forEach(function(k){ localStorage.removeItem(k); }); }catch(_){ return; } }
  }
}
function oaTidy(t){
  (t.ads||[]).forEach(function(a){
    if(a.url&&/^https?:\/\/fb\.me\/?$/i.test(a.url)) a.url=null;
    a.images=(a.images||[]).filter(function(u){ return !(a.video&&a.video.frame===u); });
    a.cards=a.cards||[]; a.headlines=a.headlines||[]; a.texts=a.texts||[]; });
  return t;
}
async function oaLoad(pl,days){
  const key=pl+'-'+days; if(OA.data[key]&&OA.fresh&&OA.fresh[key]) return; if(OA.wait[key]) return OA.wait[key];
  OA.fresh=OA.fresh||{};
  if(!OA.data[key]){ const m=oaMemGet(key); if(m&&m.ok){ OA.data[key]=oaTidy(m); oaVidPrefetch(pl,m); } }
  if(OA.data[key]){ OA.fresh[key]=true; oaFetch(pl,days,key); return; }   // shown at once; the server is asked quietly
  OA.fresh[key]=true;
  return oaFetch(pl,days,key);
}
function oaVidPrefetch(pl,t){
  if(pl!=='meta'||typeof caVidLoad!=='function') return;
  const ids=(t.ads||[]).filter(function(a){ return a.video&&a.video.meta_id; }).map(function(a){ return String(a.id); });
  for(let i=0;i<ids.length;i+=30) caVidLoad(ids.slice(i,i+30));
}
function oaFetch(pl,days,key){
  if(OA.wait[key]) return OA.wait[key];
  OA.busy[key]=true;
  OA.wait[key]=(async function(){
    try{
      const {data:{session}}=await sb.auth.getSession();
      const r=await fetch(SUPABASE_URL+'/functions/v1/gads-probe',{method:'POST',headers:{'Content-Type':'application/json','apikey':SUPABASE_KEY,'Authorization':'Bearer '+((session&&session.access_token)||'')},body:JSON.stringify({platform:pl,days:days})});
      const t=await r.json().catch(function(){ return {}; });
      const had=OA.data[key];
      if(t&&t.ok){
        oaMemPut(key,t);
        if(!had||had.err||had.built_at!==t.built_at){
          OA.data[key]=oaTidy(t);
          oaVidPrefetch(pl,t);   // Facebook videos: their playable file is asked for now, so the popup opens on the video at once
          if(had&&OA.pl===pl&&OA.days[pl]===days&&!$('oaStage')) oaPaint();   // a newer read arrived: redraw (not under an open popup)
        }
      } else if(!had||had.err) OA.data[key]={err:(t&&t.error)||('HTTP '+r.status)};   // a failed refresh keeps what is shown
    }catch(e){ if(!OA.data[key]||OA.data[key].err) OA.data[key]={err:String(e&&e.message||e)}; }
    OA.busy[key]=false; delete OA.wait[key];
  })();
  return OA.wait[key];
}
window.ownAdsView=async function(host,pl){
  OA.pl=pl; OA.host=host;
  if(!$('oaCss')) document.head.insertAdjacentHTML('beforeend',OA_CSS);
  // the ad card styles of Campaign Analytics (41-our-brand-ads.js), which may not have been opened in this visit
  if(!$('oaObCss')&&typeof OB_CSS==='string') document.head.insertAdjacentHTML('beforeend',OB_CSS.replace('<style>','<style id="oaObCss">'));
  const days=OA.days[pl], other=pl==='meta'?'google':'meta';
  if(!OA.data[pl+'-'+days]){ oaPaint(); await oaLoad(pl,days); }
  oaPaint();
  oaLoad(other,OA.days[other]);   // the other tab's ads, in the background
};
window.oaSetDays=function(v){ OA.days[OA.pl]=v; OA.proj[OA.pl]=''; oaKeep(); ownAdsView(OA.host,OA.pl); };
window.oaSetProj=function(p){ OA.proj[OA.pl]=p; oaPaint(); };
function oaPaint(){
  const host=OA.host; if(!host||!document.body.contains(host)) return;
  const pl=OA.pl, days=OA.days[pl], key=pl+'-'+days, D=OA.data[key];
  const W=pl==='google'?{icon:'fa-brands fa-google',name:'Google'}:{icon:'fa-brands fa-facebook',name:'Facebook'};
  if(!D) { host.innerHTML='<div class="loader"><div class="spin"></div></div>'; return; }
  let bar='<div class="oa-bar"><select onchange="oaSetDays(+this.value)">'+[7,30,90].map(function(d){ return '<option value="'+d+'"'+(days===d?' selected':'')+'>Last '+d+' days</option>'; }).join('')+'</select>';
  if(D.err){ host.innerHTML=bar+'</div><div class="card card-pad" style="color:#b91c1c">Could not read the ads: '+esc(D.err)+'</div>'; return; }
  const all=D.ads||[];
  const by={}, order=[];
  all.forEach(function(a){ if(!by[a.project]){ by[a.project]={ads:[],w:0}; order.push(a.project); } by[a.project].ads.push(a); by[a.project].w+=(+a.spend||0); });
  order.sort(function(x,y){ return by[y].w-by[x].w; });
  let proj=OA.proj[pl]; if(proj&&!by[proj]) proj=OA.proj[pl]='';
  bar+='<span class="oa-chip'+(proj?'':' on')+'" onclick="oaSetProj(\'\')">All projects <b>'+all.length+'</b></span>'
    +order.map(function(p){ return '<span class="oa-chip'+(proj===p?' on':'')+'" onclick="oaSetProj('+esc(JSON.stringify(p)).replace(/"/g,'&quot;')+')">'+esc(p)+' <b>'+by[p].ads.length+'</b></span>'; }).join('')+'</div>';
  window._oaAds=[];
  const card=function(a){
    const i=window._oaAds.push(a)-1;
    const head=a.headlines[0]||a.name||('Ad '+a.id), txt=a.texts[0]||'';
    let media;
    if(a.format==='search'||(!a.images.length&&!a.video&&!a.cards.length)){
      media='<div class="oa-srch"><div class="sp">Sponsored</div>'+(a.url?'<div class="u">'+esc(String(a.url).replace(/^https?:\/\//,'').split('?')[0])+'</div>':'')
        +'<div class="h">'+esc(a.headlines.slice(0,3).join(' | ')||head)+'</div><div class="d">'+esc(txt)+'</div></div>';
    } else {
      const pic=(a.video&&a.video.frame)||a.images[0]||(a.cards[0]&&a.cards[0].image);
      const n=a.images.length+a.cards.length+(a.video?1:0);
      media='<div class="pic">'+(pic?'<img src="'+esc(pic)+'" loading="lazy" referrerpolicy="no-referrer" alt="">':'<i class="'+W.icon+'" style="font-size:28px;color:#cbd5e1"></i>')
        +(a.video?'<span class="play"><i class="fa-solid fa-play"></i></span>':'')+(n>1?'<span class="n">1 / '+n+'</span>':'')+'</div>';
    }
    return '<div class="ob-ad oa-ad" style="cursor:pointer" title="Open this ad" onclick="oaOpen('+i+')">'+media
      +'<div class="hd">'+esc(head)+'</div>'+(txt&&a.format!=='search'?'<div class="tx">'+esc(txt)+'</div>':'')
      +'<div class="cp">'+(oaRunning(a)?'<span class="tag t-green" style="font-size:10.5px">Running</span> ':'<span class="tag t-gray" style="font-size:10.5px">Stopped</span> ')+esc(a.campaign||'')+'</div></div>';
  };
  let body=(proj?[proj]:order).map(function(p){
    return '<div class="oa-sec"><h3>'+esc(p)+'</h3><div class="ob-ads">'+by[p].ads.map(card).join('')+'</div></div>'; }).join('');
  if(!all.length) body='<div class="card card-pad" style="color:var(--slate)">No '+W.name+' ad ran in the last '+days+' days.</div>';
  host.innerHTML=bar+body;
}
/* ---- the popup */
function oaSlides(a){
  const s=[];
  if(a.video&&a.video.youtube) (a.videos&&a.videos.length?a.videos:[a.video]).forEach(function(v){ s.push({yt:v.youtube}); });
  else if(a.video&&a.video.meta_id) s.push({fb:String(a.id),frame:a.video.frame});
  a.cards.forEach(function(c){ if(c.image) s.push({img:c.image,cap:[c.title,c.text].filter(Boolean).join(' - ')}); });
  a.images.forEach(function(u){ s.push({img:u}); });
  return s;
}
function oaSlideHtml(x){
  if(x.yt) return '<div class="yt"><iframe src="'+esc(oaYtSrc(x.yt,false))+'" referrerpolicy="strict-origin-when-cross-origin" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowfullscreen></iframe></div>';
  if(x.fb){ const v=window._caVid&&window._caVid[x.fb];
    if(v&&v.src) return '<video src="'+esc(v.src)+'"'+(v.poster?' poster="'+esc(v.poster)+'"':'')+' controls autoplay muted playsinline></video>';
    if(v&&v.iframe) return '<div class="fbw"><iframe class="fbp" src="'+esc(v.iframe)+'" allow="autoplay; encrypted-media; fullscreen" allowfullscreen scrolling="yes"></iframe></div>';
    if(v&&(v.error||v.video===false)) return x.frame?'<img src="'+esc(x.frame)+'" referrerpolicy="no-referrer" alt="">':'<div class="wait">Meta did not give this video</div>';
    return '<div class="wait"><i class="fa-solid fa-spinner fa-spin"></i></div>'; }
  return '<img src="'+esc(x.img)+'" referrerpolicy="no-referrer" alt="">';
}
window.oaSlide=function(d){
  const P=window._oaPop; if(!P) return; P.i=Math.max(0,Math.min(P.s.length-1,P.i+d)); oaPaintSlide();
};
function oaPaintSlide(){
  const P=window._oaPop, st=$('oaStage'); if(!P||!st) return;
  const x=P.s[P.i]; st.innerHTML=x?oaSlideHtml(x):'';
  const nav=$('oaNav'); if(nav) nav.innerHTML=P.s.length>1?'<button onclick="oaSlide(-1)"'+(P.i?'':' disabled')+' title="Previous"><i class="fa-solid fa-chevron-left"></i></button><span>'+(P.i+1)+' / '+P.s.length+'</span><button onclick="oaSlide(1)"'+(P.i<P.s.length-1?'':' disabled')+' title="Next"><i class="fa-solid fa-chevron-right"></i></button>':'';
  const cap=$('oaCap'); if(cap) cap.innerHTML=x&&x.cap?esc(x.cap):'';
  const yt=$('oaYt'); if(yt) yt.innerHTML=x&&x.yt?'<a href="https://www.youtube.com/watch?v='+encodeURIComponent(x.yt)+'" target="_blank" rel="noopener"><i class="fa-brands fa-youtube"></i> Watch on YouTube</a>':'';
  // a Facebook video not fetched yet: fetch it and show it as soon as it arrives
  const V=window._caVid||{};
  if(x&&x.fb&&!(x.fb in V)&&typeof caVidLoad==='function'&&(P.tries=(P.tries||0)+1)<3)
    caVidLoad([x.fb]).then(function(){ if(window._oaPop===P&&P.s[P.i]===x) oaPaintSlide(); });
  else if(x&&x.fb&&V[x.fb]===null)   // being fetched (the background fetch started when the tab opened)
    setTimeout(function(){ if(window._oaPop===P&&P.s[P.i]===x&&document.body.contains(st)) oaPaintSlide(); },400);
}
window.oaAcc=function(n){
  document.querySelectorAll('#oaAcc .h').forEach(function(h,i){ h.classList.toggle('on',i===n); });
  document.querySelectorAll('#oaAcc .b').forEach(function(b,i){ b.classList.toggle('on',i===n); });
};
window.oaOpen=function(i){
  const a=(window._oaAds||[])[i]; if(!a) return;
  const pl=OA.pl;
  const secs=[['Headlines',a.headlines],['Long headlines',a.long_headlines],[pl==='google'?'Descriptions':'Primary text',a.texts],['Descriptions',a.descriptions]]
    .map(function(x){ return [x[0],(x[1]||[]).filter(Boolean)]; }).filter(function(x){ return x[1].length; });
  const acc=secs.length?'<div class="oa-acc" id="oaAcc">'+secs.map(function(x,k){
      return '<div class="h'+(k?'':' on')+'" onclick="oaAcc('+k+')">'+esc(x[0])+(x[1].length>1?' <span>'+x[1].length+'</span>':'')+'</div>'
        +'<div class="b'+(k?'':' on')+'"><ol>'+x[1].map(function(t){ return '<li>'+esc(t)+'</li>'; }).join('')+'</ol></div>'; }).join('')+'</div>':'';
  const s=oaSlides(a);
  window._oaPop={s:s,i:0};
  const left=s.length?'<div class="oa-stage" id="oaStage"></div><div class="oa-cap" id="oaCap"></div><div class="oa-nav" id="oaNav"></div><div class="oa-yt" id="oaYt"></div>'
    :'<div style="border:1px solid var(--line);border-radius:12px;overflow:hidden"><div class="oa-srch"><div class="sp">Sponsored</div>'+(a.url?'<div class="u">'+esc(String(a.url).replace(/^https?:\/\//,'').split('?')[0])+(a.path?'/'+esc(a.path):'')+'</div>':'')
      +'<div class="h">'+esc(a.headlines.slice(0,3).join(' | '))+'</div><div class="d">'+esc(a.texts.slice(0,2).join(' '))+'</div></div></div>';
  openModal('<div class="modal-head"><h3><i class="'+(pl==='google'?'fa-brands fa-google':'fa-brands fa-facebook')+'"></i> '+esc(a.name||'Ad')+'</h3><span class="x" onclick="closeModal()">&times;</span></div>'
    +'<div class="modal-body"><div class="oa-pop"><div>'+left+'</div><div>'+acc+'</div></div></div>','lg');
  if(s.length) oaPaintSlide();
};
