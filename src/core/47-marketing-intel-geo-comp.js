/* ============================ MARKETING INTELLIGENCE: GEOGRAPHY + COMPETITORS ============================
   16 Nov 2026, Ayush: "Ok make all". Two more cards for the Analytics tab (maReg, 45-marketing-analytics.js).
   GEOGRAPHY   from the Lead Map's site visits and bookings by PIN code (camp.lm_pins + lm_pincodes): how fast visits and
               bookings fall off with distance from the project (catchment), whether booking conversion falls with distance
               (Cochran-Armitage trend test), PIN-code hotspots (Getis-Ord Gi*, Benjamini-Hochberg), areas that convert visits
               into bookings best (Beta shrinkage); Google cost per site visit by PIN code once camp.ads_geo_monthly fills.
               Project location = its RERA PIN code (Gurukul and Ananta, one site: 700132; Dream World City, Joka: 700104).
               Visit density mostly shows where we advertised, not pure demand - read as "where our marketing lands".
   COMPETITORS from their Meta Ad Library ads, Google Ads Transparency creatives and WB RERA: weekly ad activity and surges
               (Poisson test), how long their ads run (Kaplan-Meier median lifetime) and which have proven themselves, the
               messages and offers they push (transparent keyword rules, no AI), whether our auction cost / cost per lead
               moves with their activity (Spearman correlation, permutation test), new launches near our projects.
               Never their spend - India's Ad Library does not publish it. */
let MA_GC=null, MA_GCLOADING=null;
const MA_PROJ_PIN={'Dream Gurukul':'700132','Dream Ananta':'700132','Dream World City':'700104'};
const _maLoadExtraAds=maLoadExtra;
maLoadExtra=async function(){ await Promise.all([_maLoadExtraAds(),maLoadGC()]); };
function maGCReady(){ return !!MA_GC; }
async function maLoadGC(){
  if(MA_GC&&MA_GC.today===MA_D.today) return;
  if(MA_GCLOADING) return MA_GCLOADING;
  MA_GCLOADING=(async function(){
    const today=MA_D.today, safe=function(p){ return p.catch(function(){ return null; }); };
    const camp=sb.schema('camp');
    const [pins,pc,wl,fb,gg,rera,geo]=await Promise.all([
      safe(maAll(function(){ return camp.from('lm_pins').select('project,kind,pincode,event_date').neq('kind','test'); })),
      safe(maAll(function(){ return camp.from('lm_pincodes').select('pincode,lat,lng,place,district').not('lat','is',null); })),
      camp.from('competitor_watchlist').select('id,name,category,is_own_brand'),
      safe(maAll(function(){ return camp.from('competitor_ads').select('id,watchlist_id,ad_creative_bodies,ad_creative_link_titles,headline,ad_delivery_start_time,ad_delivery_stop_time,last_seen_at').gte('last_seen_at',obAdd(today,-200)); })),
      safe(maAll(function(){ return camp.from('pi_gads_creatives').select('creative_id,watchlist_id,advertiser_name,first_shown,last_shown,ad_headline,ad_description').gte('last_shown',obAdd(today,-200)); })),
      safe(maAll(function(){ return camp.from('pi_rera_projects').select('name,promoter_name,reg_date,pincode,district,apartments').eq('list_status','approved').gte('reg_date',obAdd(today,-365)); })),
      safe(maAll(function(){ return camp.from('ads_geo_monthly').select('account_id,campaign_id,month,postal_code,spend,clicks').gte('month',obAdd(today.slice(0,8)+'01',-62).slice(0,8)+'01'); }))
    ]);
    MA_GC={today:today,pins:pins||[],pc:pc||[],wl:(wl&&wl.data)||[],fb:fb||[],gg:gg||[],rera:rera||[],geo:geo};
  })();
  try{ await MA_GCLOADING; } finally{ MA_GCLOADING=null; }
}
function maKm(a,b){ const R=6371, r=Math.PI/180, dl=(b.lat-a.lat)*r, dn=(b.lng-a.lng)*r, x=Math.sin(dl/2)*Math.sin(dl/2)+Math.cos(a.lat*r)*Math.cos(b.lat*r)*Math.sin(dn/2)*Math.sin(dn/2); return 2*R*Math.asin(Math.sqrt(x)); }

// ================================================================ GEOGRAPHY
function maGeoData(){
  const G=MA_GC, pcm={}; G.pc.forEach(function(p){ pcm[p.pincode]={lat:+p.lat,lng:+p.lng,place:p.place||p.pincode,district:p.district}; });
  const out=[];
  Object.keys(MA_PROJ_PIN).forEach(function(proj){ const home=pcm[MA_PROJ_PIN[proj]]; if(!home) return;
    const pv={}, pb={}; let nv=0,nb=0,nox=0;
    G.pins.forEach(function(p){ if(p.project!==proj) return; if(!pcm[p.pincode]){ nox++; return; } if(p.kind==='site_visit'){ pv[p.pincode]=(pv[p.pincode]||0)+1; nv++; } else if(p.kind==='booked'){ pb[p.pincode]=(pb[p.pincode]||0)+1; nb++; } });
    if(nv<30) return;
    const dist=function(pin){ return maKm(home,pcm[pin]); };
    const vd=[], bd=[]; Object.keys(pv).forEach(function(k){ for(let i=0;i<pv[k];i++) vd.push(dist(k)); }); Object.keys(pb).forEach(function(k){ for(let i=0;i<pb[k];i++) bd.push(dist(k)); });
    // distance bands: visits, bookings, conversion with a Beta range
    const bands=[[0,5],[5,10],[10,20],[20,40],[40,1e9]].map(function(b,i){ let v=0,bk=0; Object.keys(pv).forEach(function(k){ const d=dist(k); if(d>=b[0]&&d<b[1]) v+=pv[k]; }); Object.keys(pb).forEach(function(k){ const d=dist(k); if(d>=b[0]&&d<b[1]) bk+=pb[k]; });
      const dr=[]; MA_SEED=50+i; for(let t=0;t<2000;t++) dr.push(maRBeta(1+bk,1+Math.max(0,v-bk)));
      return {lab:b[1]>1e8?b[0]+'+ km':b[0]+'–'+b[1]+' km',v:v,b:bk,x:i,conv:v?bk/v:null,lo:maPctl(dr,0.1),hi:maPctl(dr,0.9)}; });
    // Cochran-Armitage trend test: does visit-to-booking conversion change with distance band?
    const N=bands.reduce(function(s,b){ return s+b.v; },0), B=bands.reduce(function(s,b){ return s+Math.min(b.b,b.v); },0), pbar=N?B/N:0;
    let T=0,s1=0,s2=0; bands.forEach(function(b){ T+=b.x*(Math.min(b.b,b.v)-b.v*pbar); s1+=b.v*b.x*b.x; s2+=b.v*b.x; });
    const vT=pbar*(1-pbar)*(s1-s2*s2/(N||1)), zT=vT>0?T/Math.sqrt(vT):0;
    // Getis-Ord Gi* hotspots of visits over every mapped PIN code within 40 km, neighbours within 5 km
    const area=Object.keys(pcm).filter(function(k){ return dist(k)<=40; }), xs=area.map(function(k){ return pv[k]||0; }), n=area.length;
    const xbar=xs.reduce(function(s,v){ return s+v; },0)/n, S=Math.sqrt(xs.reduce(function(s,v){ return s+v*v; },0)/n-xbar*xbar);
    const hs=[]; area.forEach(function(k,i){ let sw=0,swx=0; area.forEach(function(k2,j){ if(maKm(pcm[k],pcm[k2])<=5){ sw++; swx+=xs[j]; } });
      const den=S*Math.sqrt((n*sw-sw*sw)/(n-1)); if(!(den>0)) return; const z=(swx-xbar*sw)/den; hs.push({pin:k,place:pcm[k].place,z:z,p:1-maNorm(z),v:pv[k]||0,b:pb[k]||0,d:dist(k)}); });
    const hot=maBH(hs,0.05).filter(function(h){ return h.z>0; }).sort(function(a,b){ return b.z-a.z; });
    // areas converting visits into bookings best: Beta shrinkage to the project rate (worth 20 visits)
    const pr=N?B/N:0, areas=Object.keys(pv).filter(function(k){ return pv[k]>=5; }).map(function(k){ const v=pv[k], b=Math.min(pb[k]||0,v), a=b+20*pr, bb=v-b+20*(1-pr); let above=0; MA_SEED=k.length+v; for(let t=0;t<2000;t++) if(maRBeta(a,bb)>pr) above++;
      return {pin:k,place:pcm[k].place,v:v,b:b,rate:a/(a+bb),pAbove:above/2000,d:dist(k)}; }).sort(function(a,b){ return b.rate-a.rate; });
    // Google cost per site visit by PIN code (camp.ads_geo_monthly, this month and the 2 before, from 17 Nov 2026)
    let gcost=null; if(G.geo&&G.geo.length){ const accs={}; Object.keys(MA_D.camp).forEach(function(id){ const c=MA_D.camp[id]; if(c.project===proj&&c.platform==='google') accs[id]=1; });
      const sp={}; G.geo.forEach(function(r){ if(accs[r.campaign_id]) sp[r.postal_code]=(sp[r.postal_code]||0)+(+r.spend||0); });
      gcost=Object.keys(sp).filter(function(k){ return pv[k]>=3&&sp[k]>0; }).map(function(k){ return {pin:k,place:(pcm[k]||{}).place||k,s:sp[k],v:pv[k],cpv:sp[k]/pv[k]}; }).sort(function(a,b){ return a.cpv-b.cpv; }); }
    out.push({proj:proj,home:MA_PROJ_PIN[proj],nv:nv,nb:nb,nox:nox,v50:maPctl(vd,0.5),v80:maPctl(vd,0.8),b50:bd.length?maPctl(bd,0.5):null,b80:bd.length?maPctl(bd,0.8):null,
      bands:bands,zT:zT,pT:maP2(zT),hot:hot,areas:areas,gcost:gcost}); });
  return {list:out};
}
window.maGeoProj=function(p){ MA.geo=p; maPaint(); };
maReg({id:'geo',title:'Geography',icon:'fa-solid fa-map-location-dot',data:maGeoData,ready:maGCReady,
  card:function(d){ const g=d.list[0]; return g?{val:'Half within '+Math.round(g.v50)+' km',sub:esc(g.proj)+' site visits · '+g.hot.length+' hotspot'+(g.hot.length===1?'':'s')+' · bookings: half within '+(g.b50!=null?Math.round(g.b50)+' km':'—')}:{val:'—',sub:'not enough mapped site visits yet'}; },
  view:function(d){ if(!d.list.length) return maHead('fa-solid fa-map-location-dot','','Geography','')+'<div class="ma-card">Not enough mapped site visits yet.</div>';
    const cur=d.list.find(function(g){ return g.proj===MA.geo; })||d.list[0];
    const seg='<div class="ma-seg">'+d.list.map(function(g){ return '<button class="'+(g===cur?'on':'')+'" onclick="maGeoProj(\''+esc(g.proj)+'\')">'+esc(g.proj)+'</button>'; }).join('')+'</div>';
    const pc=function(x){ return x==null?'—':Math.round(x*100)+'%'; }, km=function(x){ return x==null?'—':(x<10?x.toFixed(1):Math.round(x))+' km'; };
    return maHead('fa-solid fa-map-location-dot','','Geography',
        'From the Lead Map’s site visits and bookings by PIN code, measured from the project’s RERA PIN code. Catchment = distance within which half / 80% of visits or bookings come. Conversion = bookings ÷ visits per distance band with 80% Beta ranges; the trend test (Cochran-Armitage) says whether conversion really changes with distance. Hotspots = PIN-code clusters (5 km) with far more visits than the area’s average (Getis-Ord Gi*, false-discovery controlled). Visits show where our marketing lands, not pure demand. PIN codes without map coordinates are left out.',seg)
      +'<div class="ma-stats">'+maStat('Half of site visits within',km(cur.v50),'80% within '+km(cur.v80)+' · '+obNum(cur.nv)+' visits')+maStat('Half of bookings within',km(cur.b50),'80% within '+km(cur.b80)+' · '+obNum(cur.nb)+' bookings')
        +maStat('Conversion vs distance',Math.abs(cur.zT)>=1.96?(cur.zT<0?'Falls with distance':'Rises with distance'):'No real change','trend test p = '+cur.pT.toFixed(3))+maStat('Hotspots',String(cur.hot.length),'PIN-code clusters beyond chance')+'</div>'
      +maTable(['Distance from project','Site visits','Bookings','Visit → booking (80% range)'],cur.bands.map(function(b){ return '<tr><td>'+b.lab+'</td><td>'+obNum(b.v)+'</td><td>'+obNum(b.b)+'</td><td><b>'+pc(b.conv)+'</b>'+(b.v?maRange(b.lo,b.hi,pc):'')+'</td></tr>'; }))
      +'<div class="ma-h" style="margin-top:20px"><i class="fa-solid fa-fire"></i> Hotspots and best-converting areas</div>'
      +maTable(['Area (PIN)','Distance','Site visits','Bookings','Read'],cur.hot.slice(0,8).map(function(h){ return '<tr><td>'+esc(h.place)+' <span class="ma-sub">'+h.pin+'</span></td><td>'+km(h.d)+'</td><td>'+obNum(h.v)+'</td><td>'+obNum(h.b)+'</td><td><span class="ma-b good">hotspot</span> <span class="ma-sub">z = '+h.z.toFixed(1)+'</span></td></tr>'; })
        .concat(cur.areas.filter(function(a){ return a.pAbove>=0.8; }).slice(0,8).map(function(a){ return '<tr><td>'+esc(a.place)+' <span class="ma-sub">'+a.pin+'</span></td><td>'+km(a.d)+'</td><td>'+obNum(a.v)+'</td><td>'+obNum(a.b)+'</td><td><span class="ma-b good">converts well</span> <span class="ma-sub">'+Math.round(a.rate*100)+'% · '+Math.round(a.pAbove*100)+'% sure above average</span></td></tr>'; })))
      // Google cost per site visit by PIN code: shown only once Google's spend by PIN code is in (16 Nov 2026, Ayush: no empty block)
      +(cur.gcost&&cur.gcost.length?'<div class="ma-h" style="margin-top:20px"><i class="fa-brands fa-google"></i> Google cost per site visit by PIN code</div>'
        +maTable(['Area (PIN)','Google spend (3 months)','Site visits','Cost per visit'],cur.gcost.slice(0,10).map(function(g){ return '<tr><td>'+esc(g.place)+' <span class="ma-sub">'+g.pin+'</span></td><td>'+obMoney(g.s)+'</td><td>'+obNum(g.v)+'</td><td><b>'+obMoney(g.cpv)+'</b></td></tr>'; })):''); }});

// ================================================================ COMPETITORS
const MA_MSG=[['Price / EMI',/(₹|rs\.?\s?\d|lakh|lac\b|\bcr\b|crore|emi|price|starting|onwards|all.?inclusive)/i],['Offer',/(offer|discount|free|waiver|cashback|gift|limited|book now|zero|no pre-?emi|subvention)/i],
  ['Location',/(metro|airport|highway|near|minutes?|mins?\b|connect|location|road|station|school|hospital)/i],['Amenities',/(amenit|club|pool|gym|garden|green|lifestyle|luxur|premium|landscap)/i],
  ['Ready / possession',/(ready to move|ready-to-move|possession|handover|move in|oc received|completion)/i],['Trust / brand',/(trusted|legacy|years|award|rera|delivered|families|brand)/i]];
function maCompData(){
  const G=MA_GC, D=MA_D, today=D.today, wl={}; G.wl.forEach(function(w){ wl[w.id]=w; });
  const keyOf=function(w){ const k=(typeof mwKeyOf==='function'?mwKeyOf(w.name):String(w.name).toUpperCase()).split(' ')[0]; return k; };
  const nameOf={}; G.wl.forEach(function(w){ if(w.category==='competitor'){ const k=keyOf(w); if(!nameOf[k]||w.name.length<nameOf[k].length) nameOf[k]=w.name.replace(/\s*(group|realty|private limited|pvt\.? ltd\.?|limited|kolkata)\b.*$/i,'')||w.name; } });
  const ads=[];
  G.fb.forEach(function(a){ const w=wl[a.watchlist_id]; if(!w) return; const st=(a.ad_delivery_start_time||'').slice(0,10), en=(a.ad_delivery_stop_time||a.last_seen_at||'').slice(0,10); if(!st) return;
    const txt=[].concat(a.ad_creative_bodies||[],a.ad_creative_link_titles||[],a.headline||[]).join(' '); ads.push({src:'Facebook',w:w,k:w.category==='competitor'?keyOf(w):null,own:!!w.is_own_brand,st:st,en:en,running:!a.ad_delivery_stop_time,txt:txt}); });
  G.gg.forEach(function(a){ const w=wl[a.watchlist_id]; if(!w) return; const st=(a.first_shown||'').slice(0,10), en=(a.last_shown||'').slice(0,10); if(!st) return;
    ads.push({src:'Google',w:w,k:w.category==='competitor'?keyOf(w):null,own:!!w.is_own_brand,st:st,en:en,running:en>=obAdd(today,-3),txt:[a.ad_headline,a.ad_description].filter(Boolean).join(' ')}); });
  const comp=ads.filter(function(a){ return a.k; });
  // weekly active ads per competitor, last 26 weeks
  const weeks=[]; for(let i=25;i>=0;i--) weeks.push(obAdd(today,-7*i-6));
  const act=function(list,ws){ const we=obAdd(ws,6); return list.filter(function(a){ return a.st<=we&&a.en>=ws; }).length; };
  const keys=Object.keys(nameOf), per=keys.map(function(k){ const L=comp.filter(function(a){ return a.k===k; }), series=weeks.map(function(w){ return act(L,w); });
    const now=series[25], base=series.slice(17,25), mean=base.reduce(function(s,v){ return s+v; },0)/8, p=mean>0?1-maPoisCdf(now-1,mean):1, fresh=L.filter(function(a){ return a.st>=obAdd(today,-7); }).length;
    // Kaplan-Meier median lifetime of its ads started in the last 180 days (still-running ads are censored)
    const life=L.filter(function(a){ return a.st>=obAdd(today,-180); }).map(function(a){ return {t:Math.max(1,(Date.parse(a.en)-Date.parse(a.st))/864e5+1),e:!a.running}; }).sort(function(a,b){ return a.t-b.t; });
    let S=1, med=null, atRisk=life.length; for(let i=0;i<life.length;i++){ if(life[i].e){ S*=1-1/atRisk; if(S<=0.5&&med==null) med=life[i].t; } atRisk--; }
    return {k:k,name:nameOf[k],series:series,now:now,mean:mean,p:p,fresh:fresh,med:med,n:L.length,ads:L}; }).filter(function(x){ return x.n>0; });
  const surge=maBH(per.filter(function(x){ return x.now>=1.5*x.mean&&x.now>=5; }),0.05);
  // proven ads: still running and older than twice their brand's median lifetime (and 30+ days)
  const proven=[]; per.forEach(function(x){ x.ads.forEach(function(a){ const age=(Date.parse(today)-Date.parse(a.st))/864e5; if(a.running&&age>=Math.max(30,2*(x.med||15))&&a.txt) proven.push({name:x.name,src:a.src,age:age,txt:a.txt}); }); });
  proven.sort(function(a,b){ return b.age-a.age; });
  const seenTxt={}; for(let i=0;i<proven.length;i++){ const k=proven[i].name+'|'+String(proven[i].txt).slice(0,60); if(seenTxt[k]){ proven.splice(i,1); i--; } else seenTxt[k]=1; }   // keep the oldest of repeated texts
  // message mix, ads started in the last 90 days: competitors (top 6 by ads) and us
  const cls=function(t){ return MA_MSG.map(function(m){ return m[1].test(t||''); }); };
  const mix=function(list){ const n=list.filter(function(a){ return a.txt; }).length, c=MA_MSG.map(function(){ return 0; }); list.forEach(function(a){ if(!a.txt) return; cls(a.txt).forEach(function(v,i){ if(v) c[i]++; }); }); return {n:n,share:c.map(function(v){ return n?v/n:null; })}; };
  const recent=function(l){ return l.filter(function(a){ return a.st>=obAdd(today,-90); }); };
  const mixRows=per.slice().sort(function(a,b){ return recent(b.ads).length-recent(a.ads).length; }).slice(0,6).map(function(x){ return {name:x.name,m:mix(recent(x.ads))}; }).filter(function(r){ return r.m.n>=3; });
  const ours=mix(recent(ads.filter(function(a){ return a.own; })));
  // does our auction cost / cost per lead move with their activity? weekly Spearman correlation, permutation test
  const ser=maSeries(), wk=weeks.map(function(ws){ const we=obAdd(ws,6); let s=0,im=0,l=0; Object.keys(ser.S).forEach(function(id){ const o=ser.S[id]; if(o.c.platform!=='meta') return; ser.days.forEach(function(d,i){ if(d<ws||d>we) return; s+=o.s[i]; im+=o.im[i]; if(o.lead) l+=o.l[i]; }); }); return {cpm:im?s/im*1000:null,cpl:l?s/l:null}; });
  const tot=weeks.map(function(_,i){ return per.reduce(function(s,x){ return s+x.series[i]; },0); });
  const rank=function(a){ const ix=a.map(function(v,i){ return [v,i]; }).sort(function(x,y){ return x[0]-y[0]; }), r=new Array(a.length); ix.forEach(function(p,j){ r[p[1]]=j; }); return r; };
  const rho=function(x,y){ const rx=rank(x), ry=rank(y), n=x.length, mx=(n-1)/2; let num=0,dx=0,dy=0; for(let i=0;i<n;i++){ num+=(rx[i]-mx)*(ry[i]-mx); dx+=(rx[i]-mx)*(rx[i]-mx); dy+=(ry[i]-mx)*(ry[i]-mx); } return num/Math.sqrt(dx*dy); };
  const test=function(f){ const idx=[]; wk.forEach(function(w,i){ if(w[f]!=null&&i<25) idx.push(i); }); if(idx.length<12) return null; const x=idx.map(function(i){ return tot[i]; }), y=idx.map(function(i){ return wk[i][f]; }), r=rho(x,y);
    MA_SEED=77; let ext=0; for(let t=0;t<2000;t++){ const yy=y.slice(); for(let i=yy.length-1;i>0;i--){ const j=Math.floor(maRnd()*(i+1)); const tmp=yy[i]; yy[i]=yy[j]; yy[j]=tmp; } if(Math.abs(rho(x,yy))>=Math.abs(r)) ext++; } return {r:r,p:(ext+1)/2001,n:idx.length}; };
  const link={cpm:test('cpm'),cpl:test('cpl')};
  // launches near our projects: last 12 months, within 8 km of a project PIN code
  const pcm={}; G.pc.forEach(function(p){ pcm[p.pincode]={lat:+p.lat,lng:+p.lng}; });
  const near=[]; Object.keys(MA_PROJ_PIN).forEach(function(proj){ const h=pcm[MA_PROJ_PIN[proj]]; if(!h) return; G.rera.forEach(function(r){ const q=pcm[r.pincode]; if(!q||/dream gateway/i.test(r.promoter_name||'')) return; const d=maKm(h,q);
      if(d<=8&&((+r.apartments||0)>=50||(typeof MW_REPUTED!=='undefined'&&MW_REPUTED.some(function(x){ return x[1].test(String(r.promoter_name||'').toUpperCase()); })))) near.push({proj:proj,name:r.name,dev:r.promoter_name,reg:r.reg_date,flats:r.apartments,d:d}); }); });
  near.sort(function(a,b){ return a.reg<b.reg?1:-1; });
  return {per:per.sort(function(a,b){ return b.now-a.now; }),surge:surge,proven:proven,mixRows:mixRows,ours:ours,link:link,near:near,weeks:weeks};
}
maReg({id:'comp',title:'Competitors',icon:'fa-solid fa-chess',data:maCompData,ready:maGCReady,
  card:function(d){ const top=d.per[0]; return d.surge.length?{val:d.surge.length+' surging',sub:d.surge.map(function(x){ return esc(x.name); }).join(', ')+' running far more ads than usual',tone:'warn'}:{val:'Activity normal',sub:top?'most active: '+esc(top.name)+' ('+top.now+' ads live)'+(d.near.length?' · '+d.near.length+' launches near us':''):'no competitor data'}; },
  view:function(d){ const lk=function(t,lab){ if(!t) return '<b>not enough weeks yet</b>'; return Math.abs(t.r)>=0.3&&t.p<0.05?'<b>'+(t.r>0?'rises':'falls')+' when they run more ads</b> (Spearman ρ = '+t.r.toFixed(2)+', p = '+t.p.toFixed(3)+')':'<b>no real link</b> (ρ = '+t.r.toFixed(2)+', p = '+t.p.toFixed(2)+')'; };
    const pc=function(x){ return x==null?'—':Math.round(x*100)+'%'; };
    return maHead('fa-solid fa-chess','','Competitors',
        'From competitors’ Facebook Ad Library ads, Google Ads Transparency creatives and WB RERA - never their spend, which India’s Ad Library does not publish. Live ads per week; a surge = this week 1.5×+ its 8-week average and beyond chance (Poisson test, false-discovery controlled). Median ad life by Kaplan-Meier (ads still running counted as still alive). A "proven" ad is still running after twice its brand’s median life - advertisers keep what works. Messages are tagged by transparent keyword rules. The link test correlates their weekly live ads with our Facebook auction cost and cost per lead (Spearman, 2,000-shuffle permutation test) - a link is not proof of cause.')
      +'<div class="ma-stats">'+maStat('Surging this week',String(d.surge.length),d.surge.length?d.surge.map(function(x){ return esc(x.name); }).join(', '):'no unusual jump')+maStat('Live competitor ads',obNum(d.per.reduce(function(s,x){ return s+x.now; },0)),'across '+d.per.filter(function(x){ return x.now; }).length+' competitors')
        +maStat('Launches near our projects',String(d.near.length),'last 12 months, within 8 km')+'</div>'
      +'<div class="ma-card">Our Facebook auction cost '+lk(d.link.cpm)+'. Our Facebook cost per lead '+lk(d.link.cpl)+'.</div>'
      +maTable(['Competitor','Live ads now','8-week average','New this week','Median ad life','Read'],d.per.slice(0,10).map(function(x){ const s=d.surge.indexOf(x)>=0;
        return '<tr><td>'+esc(x.name)+'</td><td><b>'+x.now+'</b></td><td>'+x.mean.toFixed(1)+'</td><td>'+x.fresh+'</td><td>'+(x.med?Math.round(x.med)+' days':'—')+'</td><td>'+(s?'<span class="ma-b warn">surging</span>':'<span class="ma-sub">normal</span>')+'</td></tr>'; }))
      +'<div class="ma-h" style="margin-top:20px"><i class="fa-solid fa-comment-dots"></i> What they say vs us <span class="ma-sub" style="font-weight:500">· ads started in the last 90 days, share mentioning each theme</span></div>'
      +maTable(['Advertiser'].concat(MA_MSG.map(function(m){ return m[0]; })),[{name:'Jain Group (us)',m:d.ours,us:true}].concat(d.mixRows).filter(function(r){ return r.m.n; }).map(function(r){ return '<tr'+(r.us?' class="ma-p"':'')+'><td>'+esc(r.name)+' <span class="ma-sub">'+r.m.n+' ads</span></td>'+r.m.share.map(function(v){ return '<td>'+pc(v)+'</td>'; }).join('')+'</tr>'; }))
      +(d.proven.length?'<div class="ma-h" style="margin-top:20px"><i class="fa-solid fa-medal"></i> Their proven ads <span class="ma-sub" style="font-weight:500">· still running long after their usual life</span></div>'
        +maTable(['Competitor','Running for','Message'],d.proven.slice(0,8).map(function(a){ return '<tr><td>'+esc(a.name)+' <span class="ma-sub">'+a.src+'</span></td><td>'+Math.round(a.age)+' days</td><td class="ma-n">'+esc(String(a.txt).slice(0,180))+'</td></tr>'; })):'')
      +(d.near.length?'<div class="ma-h" style="margin-top:20px"><i class="fa-solid fa-building"></i> New launches near our projects</div>'
        +maTable(['Near','Project','Developer','Registered','Flats','Distance'],d.near.slice(0,10).map(function(r){ return '<tr><td>'+esc(r.proj)+'</td><td>'+esc(r.name)+'</td><td class="ma-n">'+esc(r.dev)+'</td><td>'+obDmyS(r.reg)+'</td><td>'+(r.flats||'—')+'</td><td>'+r.d.toFixed(1)+' km</td></tr>'; })):''); }});
