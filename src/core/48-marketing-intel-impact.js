/* ============================ MARKETING INTELLIGENCE: PROVE ACTIONS ============================
   16 Nov 2026, Ayush: "Build all four" - intelligence whose actions prove themselves. Four more cards (maReg):
   ACTION IMPACT     every budget raise / cut, launch and pause of the last 75 days, measured against comparable campaigns
                     that were not changed (difference-in-differences with a bootstrap over the comparison campaigns and
                     Gamma-Poisson noise on the counts): did it bring leads, at what cost per extra lead, how sure.
                     Events: exact budget changes from camp.ads_budget_daily (16 Nov 2026 on) + sustained spend-level
                     shifts found in the daily spend (median of the 7 days after vs the 7 before, 40%+), launches, pauses.
   EARLY QUALITY     QL nowcasting: from how a cohort's QL count grows with lead age (maturity curve, pooled per platform,
                     each project's mature rate as reference), each new campaign's FINAL qualified-lead rate is estimated
                     from its first days (Beta posterior) - a weak campaign is visible in a week, not after 21 days.
   BOOKINGS AHEAD    the same maturity method on bookings: bookings still to come from leads already in the CRM, and how
                     many land in the next 30 days; return on ad spend = bookings x the project's median flat value
                     (Post Sales, last 12 months) / spend, for lead cohorts old enough to have booked.
   BEST HOURS        leads per rupee by 4-hour block of the day (camp.ads_hourly, last 28 days, from 17 Nov 2026), chi-
                     square test + a 15% practical threshold, for ad scheduling.
   Decision support only. Maths: the document "JainE Marketing Analytics: Models and Calculations". */
let MA_PA=null, MA_PALOADING=null;
const _maLoadExtraGC=maLoadExtra;
maLoadExtra=async function(){ await Promise.all([_maLoadExtraGC(),maLoadPA()]); };
function maPAReady(){ return !!MA_PA; }
async function maLoadPA(){
  if(MA_PA&&MA_PA.today===MA_D.today) return;
  if(MA_PALOADING) return MA_PALOADING;
  MA_PALOADING=(async function(){
    const today=MA_D.today, safe=function(p){ return p.catch(function(){ return null; }); };
    const [bud,bk,pj,hr]=await Promise.all([
      safe(maAll(function(){ return sb.schema('camp').from('ads_budget_daily').select('day,platform,kind,id,campaign_id,status,daily_budget').gte('day',obAdd(today,-80)).order('day'); })),
      safe(maAll(function(){ return sb.schema('postsales').from('bookings').select('project_id,booking_date,status,total_consideration').gte('booking_date',obAdd(today,-365)); })),
      sb.schema('cust').from('projects').select('id,name'),
      safe(maAll(function(){ return sb.schema('camp').from('ads_hourly').select('platform,campaign_id,hour,spend,leads'); }))
    ]);
    MA_PA={today:today,bud:bud,bk:bk||[],pj:(pj&&pj.data)||[],hr:hr};
  })();
  try{ await MA_PALOADING; } finally{ MA_PALOADING=null; }
}

// ================================================================ ACTION IMPACT
function maImpactData(){
  const D=MA_D, ser=maSeries(), n=ser.days.length, ids=Object.keys(ser.S).filter(function(id){ return ser.S[id].lead; }), ev=[];
  const sum=function(a,i0,i1){ let s=0; for(let i=Math.max(0,i0);i<Math.min(n,i1);i++) s+=a[i]; return s; };
  const med=function(a,i0,i1){ const v=[]; for(let i=Math.max(0,i0);i<Math.min(n,i1);i++) v.push(a[i]); return maMed(v); };
  const lo=n-75;
  // exact budget changes (daily record, 16 Nov 2026 on)
  const exact={}; if(MA_PA&&MA_PA.bud){ const last={}; MA_PA.bud.forEach(function(r){ const cid=r.kind==='campaign'?r.id:r.campaign_id, k=r.kind+':'+r.id, prev=last[k]; last[k]=r;
      if(!prev||!cid||!ser.S[cid]||prev.daily_budget==null||r.daily_budget==null||!(+prev.daily_budget>0)) return; const ch=+r.daily_budget/+prev.daily_budget-1;
      if(Math.abs(ch)>=0.2&&ser.ix[r.day]!=null){ exact[cid+'|'+r.day]=1; ev.push({cid:cid,t:ser.ix[r.day],kind:ch>0?'raise':'cut',label:'Budget '+(ch>0?'raised ':'cut ')+Math.round(Math.abs(ch)*100)+'%',exact:true}); } }); }
  ids.forEach(function(id){ const o=ser.S[id], s=o.s;
    // launch / pause
    let first=-1; for(let i=0;i<n;i++) if(s[i]>0){ first=i; break; }
    if(first>=lo&&first>=14&&first<=n-7&&sum(s,first-14,first)===0) ev.push({cid:id,t:first,kind:'launch',label:'Campaign launched',proj:true});
    let lastS=-1; for(let i=n-1;i>=0;i--) if(s[i]>0){ lastS=i; break; }
    if(lastS>=lo&&lastS<=n-8&&sum(s,lastS-13,lastS+1)>=7*300) ev.push({cid:id,t:lastS+1,kind:'pause',label:'Campaign paused',proj:true});
    // sustained spend-level shifts (budget changes before the daily record existed)
    let lastT=-99; const cands=[];
    for(let t=Math.max(lo,7);t<=n-7;t++){ const b=med(s,t-7,t), a=med(s,t,t+7); if(!(b>0)||!(a>0)) continue; const r=Math.log(a/b); if(Math.abs(r)>=Math.log(1.4)) cands.push({t:t,r:r}); }
    cands.sort(function(x,y){ return Math.abs(y.r)-Math.abs(x.r); }).forEach(function(c){ if(ev.some(function(e){ return e.cid===id&&Math.abs(e.t-c.t)<14; })) return; if(Math.abs(c.t-lastT)<14) return; lastT=c.t;
      ev.push({cid:id,t:c.t,kind:c.r>0?'raise':'cut',label:'Spend '+(c.r>0?'raised ':'cut ')+Math.round(Math.abs(Math.exp(c.r)-1)*100)+'%',exact:false}); }); });
  // evaluation: difference-in-differences against comparable unchanged campaigns, bootstrap + Gamma-Poisson noise
  const busy=function(cid,t){ return ev.some(function(e){ return e.cid===cid&&Math.abs(e.t-t)<14; }); };
  MA_SEED=2026; const out=[];
  ev.forEach(function(e){ const o=ser.S[e.cid]; if(!o) return; const pre0=e.t-14, post1=Math.min(n,e.t+14), pd=post1-e.t; if(pd<7||pre0<0) return;
    const plat=o.c.platform;
    // treated: the campaign itself, or for launch / pause its whole project + platform
    const group=e.proj?ids.filter(function(id){ const x=ser.S[id]; return x.c.project===o.c.project&&x.c.platform===plat; }):[e.cid];
    const T=function(a){ return group.reduce(function(s,id){ return s+sum(ser.S[id][a],pre0,e.t); },0); }, Tp=function(a){ return group.reduce(function(s,id){ return s+sum(ser.S[id][a],e.t,post1); },0); };
    const Lb=T('l'), La=Tp('l'), Sb=T('s'), Sa=Tp('s'); if(Lb+La<10) return;
    const ctrl=ids.filter(function(id){ const x=ser.S[id]; if(group.indexOf(id)>=0||x.c.platform!==plat) return false; if(e.proj&&x.c.project===o.c.project) return false;
      return sum(x.s,pre0,e.t)>0&&sum(x.s,e.t,post1)>0&&sum(x.l,pre0,e.t)>=5&&!busy(id,e.t); });
    if(ctrl.length<3) return;
    const cs=ctrl.map(function(id){ const x=ser.S[id]; return {b:sum(x.l,pre0,e.t),a:sum(x.l,e.t,post1)}; });
    const draws=[];
    for(let k=0;k<1500;k++){ let cb=0,ca=0; for(let j=0;j<cs.length;j++){ const c=cs[Math.floor(maRnd()*cs.length)]; cb+=c.b; ca+=c.a; } if(!(cb>0)) continue;
      const rb=maRGamma(1+Lb)/14, ra=maRGamma(1+La)/pd, cr=(ca/pd)/(cb/14); draws.push(ra-rb*cr); }
    if(draws.length<200) return;
    const eff=maPctl(draws,0.5), effLo=maPctl(draws,0.1), effHi=maPctl(draws,0.9), pUp=draws.filter(function(v){ return v>0; }).length/draws.length;
    const dS=Sa/pd-Sb/14, preCpl=Lb?Sb/Lb:null, mcpl=eff>0&&dS>0?dS/eff:null;
    let verdict, tone;
    if(e.kind==='raise'||e.kind==='launch'){ if(pUp>=0.9&&(mcpl==null||!preCpl||mcpl<=1.5*preCpl)){ verdict='Worked'; tone='good'; } else if(pUp>=0.9){ verdict='Worked, but expensive'; tone='warn'; } else { verdict='No real gain'; tone='bad'; } }
    else { if(pUp<=0.1){ verdict='Lost leads'; tone='bad'; } else { verdict='Saved money, kept leads'; tone='good'; } }
    out.push({e:e,c:o.c,day:ser.days[e.t],pd:pd,eff:eff,effLo:effLo,effHi:effHi,pUp:pUp,dS:dS,mcpl:mcpl,preCpl:preCpl,verdict:verdict,tone:tone,n:ctrl.length}); });
  out.sort(function(a,b){ return a.day<b.day?1:-1; });
  return {list:out};
}
maReg({id:'impact',title:'Action impact',icon:'fa-solid fa-flask',data:maImpactData,ready:maPAReady,
  card:function(d){ const w=d.list.filter(function(x){ return x.tone==='good'; }).length, b=d.list.filter(function(x){ return x.tone==='bad'; }).length;
    return d.list.length?{val:w+' worked · '+b+' did not',sub:d.list.length+' changes in the last 75 days measured against unchanged campaigns',tone:b>w?'warn':null}:{val:'—',sub:'no measurable change yet'}; },
  view:function(d){ const n1=function(x){ return (x>=0?'+':'')+x.toFixed(1); };
    return maHead('fa-solid fa-flask','','Action impact',
        'Each budget raise or cut, launch and pause in the last 75 days, measured over up to 14 days after it against the same platform’s campaigns that were NOT changed (difference-in-differences): if those moved too, it was the market, not the action. Range from 1,500 simulations (re-drawing the comparison campaigns and the lead counts). Launch / pause are measured on the whole project + platform, so leads that just moved between campaigns do not count. Budget changes are exact from 16 Nov 2026; before that they are read from sustained 40%+ shifts in daily spend.')
      +(d.list.length?maTable(['Date','Campaign','Action','Verdict','Leads / day change (80% range)','Cost of each extra lead'],d.list.map(function(x){
          return '<tr><td>'+obDmyS(x.day)+'</td><td class="ma-n">'+maPlat(x.c.platform)+' '+esc(x.e.proj?x.c.project+' (all '+(x.c.platform==='google'?'Google':'Facebook')+')':x.c.name)+'<div class="ma-sub">'+esc(x.e.proj?x.c.name:x.c.project)+'</div></td><td>'+esc(x.e.label)+(x.e.exact?'':' <span class="ma-sub">(from spend)</span>')+'</td>'
            +'<td><span class="ma-b '+x.tone+'">'+x.verdict+'</span><div class="ma-sub">'+Math.round(Math.max(x.pUp,1-x.pUp)*100)+'% sure of the direction</div></td><td><b>'+n1(x.eff)+'</b><div class="ma-sub">'+n1(x.effLo)+' to '+n1(x.effHi)+' · '+x.pd+' days after</div></td><td>'+(x.mcpl?obMoney(x.mcpl)+'<div class="ma-sub">was '+obMoney(x.preCpl)+' per lead</div>':'—')+'</td></tr>'; }))
        :'<div class="ma-card">No budget change, launch or pause in the last 75 days has enough leads and comparison campaigns to measure yet.</div>'); }});

// ================================================================ EARLY QUALITY (QL NOWCAST)
function maMaturity(field,buckets,refLo,refHi){
  const D=MA_D, today=D.today, age=function(d){ return Math.round((Date.parse(today)-Date.parse(d))/864e5); };
  const ref={}; D.crm.forEach(function(r){ const a=age(r.day); if(a<refLo||a>refHi) return; const k=r.project+'|'+r.platform, x=ref[k]=ref[k]||{l:0,q:0}; x.l+=r.leads; x.q+=r[field]; });
  const F=buckets.map(function(){ return {num:0,den:0}; });
  D.crm.forEach(function(r){ const a=age(r.day), b=buckets.findIndex(function(x){ return a>=x[0]&&a<=x[1]; }); if(b<0) return; const R=ref[r.project+'|'+r.platform]; if(!R||!(R.l>=50)||!(R.q>0)) return;
    F[b].num+=r[field]; F[b].den+=r.leads*R.q/R.l; });
  const f=F.map(function(x){ return x.den>0?Math.min(1,Math.max(0.03,x.num/x.den)):null; });
  for(let i=1;i<f.length;i++) if(f[i]!=null&&f[i-1]!=null&&f[i]<f[i-1]) f[i]=f[i-1];   // completeness never falls with age
  return {f:f,ref:ref,age:age};
}
function maEarlyData(){
  const D=MA_D, B=[[0,3],[4,7],[8,14],[15,21],[22,30],[31,45],[46,59]], M=maMaturity('ql',B,60,200);
  const Fof=function(a){ if(a>=60) return 1; const i=B.findIndex(function(x){ return a>=x[0]&&a<=x[1]; }); return i>=0&&M.f[i]!=null?M.f[i]:null; };
  const by={}; D.crm.forEach(function(r){ if(!r.cid) return; const a=M.age(r.day); if(a>21) return; const F=Fof(a); if(F==null) return; const c=D.camp[r.cid]; if(!c||!caLive(c.status)) return;
    const g=by[r.cid]=by[r.cid]||{c:c,l:0,q:0,e:0}; g.l+=r.leads; g.q+=r.ql; g.e+=r.leads*F; });
  MA_SEED=404; const list=[];
  Object.keys(by).forEach(function(id){ const g=by[id]; if(g.l<10||g.e<1) return; const R=M.ref[g.c.project+'|'+g.c.platform]; if(!R||!(R.l>=50)) return; const p=R.q/R.l;
    const a=g.q+10*p, b=Math.max(0.5,g.e-g.q)+10*(1-p); let below=0, above=0; const dr=[];
    for(let k=0;k<2000;k++){ const t=maRBeta(a,b); dr.push(t); if(t<0.7*p) below++; if(t>1.3*p) above++; }
    const est=a/(a+b), v=below/2000>=0.8?'weak':above/2000>=0.8?'strong':'normal';
    list.push({c:g.c,l:g.l,q:g.q,est:est,lo:maPctl(dr,0.1),hi:maPctl(dr,0.9),p:p,v:v,pBelow:below/2000,pAbove:above/2000}); });
  list.sort(function(a,b){ return ({weak:0,strong:1,normal:2}[a.v])-({weak:0,strong:1,normal:2}[b.v])||b.l-a.l; });
  return {list:list,f:M.f,B:B};
}
maReg({id:'early',title:'Early quality',icon:'fa-solid fa-seedling',data:maEarlyData,
  card:function(d){ const w=d.list.filter(function(x){ return x.v==='weak'; }).length, s=d.list.filter(function(x){ return x.v==='strong'; }).length;
    return d.list.length?{val:w?w+' look weak early':'None weak',sub:(s?s+' look strong · ':'')+d.list.length+' campaigns judged on leads from the last 21 days',tone:w?'warn':'good'}:{val:'—',sub:'no campaign has enough new CRM leads'}; },
  view:function(d){ const pc=function(x){ return Math.round(x*100)+'%'; }, i7=d.f[1], i14=d.f[2];
    return maHead('fa-solid fa-seedling','','Early quality',
        'The CRM marks a lead qualified days or weeks after it arrives, so a new campaign’s QL rate looks low at first. From past months we learn how complete the QL count is at each lead age (maturity curve, per platform, each project’s settled rate as the reference), then estimate each running campaign’s FINAL QL rate from its leads of the last 21 days (Beta posterior, pulled toward its project’s rate). Weak / strong = 80%+ sure it ends 30% below / above its project’s usual rate.')
      +'<div class="ma-note">How the CRM fills in: by day 7 about '+(i7?pc(i7):'—')+' of a lead batch’s eventual QLs are marked, by day 14 about '+(i14?pc(i14):'—')+'.</div>'
      +(d.list.length?maTable(['Campaign','Leads (21 days)','QL so far','Expected final QL rate (80% range)','Project usual','Read'],d.list.map(function(x){
          return '<tr><td class="ma-n">'+maPlat(x.c.platform)+' '+esc(x.c.name)+'<div class="ma-sub">'+esc(x.c.project)+'</div></td><td>'+obNum(x.l)+'</td><td>'+obNum(x.q)+'</td><td><b>'+pc(x.est)+'</b>'+maRange(x.lo,x.hi,pc)+'</td><td>'+pc(x.p)+'</td><td>'
            +(x.v==='weak'?'<span class="ma-b bad">Weak - '+Math.round(x.pBelow*100)+'% sure</span>':x.v==='strong'?'<span class="ma-b good">Strong - '+Math.round(x.pAbove*100)+'% sure</span>':'<span class="ma-sub">in line</span>')+'</td></tr>'; }))
        :'<div class="ma-card">No running campaign has 10+ CRM leads in the last 21 days.</div>'); }});

// ================================================================ BOOKINGS AHEAD + RETURN ON SPEND
function maProjValue(){ const P=MA_PA, nm={}; P.pj.forEach(function(p){ nm[p.id]=String(p.name||'').toUpperCase(); });
  const map=function(s){ return /GURUKUL/.test(s)?'Dream Gurukul':/ANANTA/.test(s)?'Dream Ananta':/EXOTICA/.test(s)?'Dream Exotica':/VALLEY/.test(s)?'Dream Valley':/ECO ?CITY/.test(s)?'Dream Eco City':/DREAM ONE/.test(s)?'Dream One':/PAILAN/.test(s)?'Dream World City':null; };
  const v={}; P.bk.forEach(function(b){ if(/cancel/i.test(b.status||'')||!(+b.total_consideration>0)) return; const p=map(nm[b.project_id]||''); if(p) (v[p]=v[p]||[]).push(+b.total_consideration); });
  const out={}; Object.keys(v).forEach(function(p){ out[p]={med:maMed(v[p]),n:v[p].length}; }); return out; }
function maBookData(){
  const D=MA_D;
  /* NEXT 30 DAYS FROM POST SALES (16 Nov 2026): the CRM ties only a fraction of bookings to ad leads (about 35 of Post
     Sales' 160 in a year), so the forecast uses Post Sales' own bookings - all channels - per project: last 90 days' rate,
     negative binomial range (k from the month-to-month spread of the last 12 months). The CRM's share shows how many of
     those bookings the CRM credits to ads. */
  const P=MA_PA, nm={}; P.pj.forEach(function(p){ nm[p.id]=String(p.name||'').toUpperCase(); });
  const mapP=function(s){ return /GURUKUL/.test(s)?'Dream Gurukul':/ANANTA/.test(s)?'Dream Ananta':/EXOTICA/.test(s)?'Dream Exotica':/VALLEY/.test(s)?'Dream Valley':/ECO ?CITY/.test(s)?'Dream Eco City':/DREAM ONE/.test(s)?'Dream One':/PAILAN/.test(s)?'Dream World City':null; };
  const t90=obAdd(D.today,-90), pr={};
  P.bk.forEach(function(b){ if(/cancel/i.test(b.status||'')||!b.booking_date||!(+b.total_consideration>0)) return;   /* real bookings only: the 5 Nov 2026 bulk import (292, no value, dated November) is left out */ const p=mapP(nm[b.project_id]||''); if(!p) return; const x=pr[p]=pr[p]||{n90:0,mon:{}}; if(b.booking_date>=t90) x.n90++; const m=b.booking_date.slice(0,7); x.mon[m]=(x.mon[m]||0)+1; });
  const crm90={}; D.crm.forEach(function(r){ if(r.day>=t90) crm90[r.project]=(crm90[r.project]||0)+r.bk; });
  Object.keys(pr).forEach(function(p){ const x=pr[p], ms=Object.keys(x.mon).map(function(m){ return x.mon[m]; }), m=ms.reduce(function(s,v){ return s+v; },0)/Math.max(1,ms.length), v=ms.length>1?maSd(ms)*maSd(ms):m;
    x.k=v>m?Math.max(1,m*m/(v-m)):1000; x.next=x.n90/3; x.lo=maNBq(x.next,x.k,0.1); x.hi=maNBq(x.next,x.k,0.9); x.crm=crm90[p]||0; });
  const vals=maProjValue();
  // return on ad spend: lead cohorts 90-270 days old (old enough to have booked), bookings x median flat value / spend
  const a0=obAdd(D.today,-270), a1=obAdd(D.today,-90), roas={};
  D.rows.forEach(function(r){ if(!maIn(r.day,a0,a1)) return; const k=r.c.project+'|'+r.c.platform, x=roas[k]=roas[k]||{p:r.c.project,pl:r.c.platform,s:0,b:0}; x.s+=r.spend; });
  D.crm.forEach(function(r){ if(!maIn(r.day,a0,a1)) return; const x=roas[r.project+'|'+r.platform]; if(x) x.b+=r.bk; });
  MA_SEED=88; const rl=Object.keys(roas).map(function(k){ const x=roas[k], v=vals[x.p]; if(!v||!(x.s>0)) return null; const dr=[]; for(let i=0;i<2000;i++) dr.push(maRGamma(x.b+0.5)*v.med/x.s);
    return {p:x.p,pl:x.pl,s:x.s,b:x.b,v:v.med,r:x.b*v.med/x.s,lo:maPctl(dr,0.1),hi:maPctl(dr,0.9),cpb:x.b?x.s/x.b:null}; }).filter(Boolean).sort(function(a,b){ return b.r-a.r; });
  const rows=Object.keys(pr).map(function(p){ const x=pr[p]; return {p:p,next:x.next,lo:x.lo,hi:x.hi,n90:x.n90,crm:x.crm,v:vals[p]?vals[p].med:null}; }).filter(function(x){ return x.n90>0; }).sort(function(a,b){ return b.next-a.next; });
  const T=rows.reduce(function(s,x){ return s+x.next; },0), N90=rows.reduce(function(s,x){ return s+x.n90; },0), C90=rows.reduce(function(s,x){ return s+x.crm; },0);
  return {rows:rows,next:T,nextLo:maNBq(T,8,0.1),nextHi:maNBq(T,8,0.9),n90:N90,crm90:C90,roas:rl};
}
maReg({id:'book',title:'Bookings ahead',icon:'fa-solid fa-house-circle-check',data:maBookData,ready:maPAReady,
  card:function(d){ const b=d.roas.filter(function(x){ return x.b>=2; })[0]; return {val:'≈'+obNum(Math.round(d.next))+' bookings in 30 days',sub:'all channels, from Post Sales'+(b?' · best ad return: '+esc(b.p)+' '+(b.pl==='google'?'Google':'Facebook')+' ₹'+b.r.toFixed(0)+' sales per ₹1':'')}; },
  view:function(d){ const n0=function(x){ return obNum(Math.round(x)); };
    return maHead('fa-solid fa-house-circle-check','','Bookings ahead',
        'Next 30 days: each project’s bookings in Post Sales over the last 90 days (all channels - ads, channel partners, walk-ins), projected forward; the 80% range is a negative binomial whose spread comes from how much monthly bookings varied over the last year. The CRM column shows how many of those bookings the CRM credits to ad leads. Return on ad spend = bookings the CRM credits to a project + platform × the project’s median flat value in Post Sales (last 12 months) ÷ its ad spend, for leads 90-270 days old (old enough to have booked); range from a Gamma-Poisson posterior. Post Sales’ Pailan projects are counted as Dream World City.')
      +'<div class="ma-stats">'+maStat('Bookings in the next 30 days',n0(d.next),n0(d.nextLo)+' – '+n0(d.nextHi)+' (80%), all channels')+maStat('Bookings in the last 90 days',obNum(d.n90),'the CRM credits '+obNum(d.crm90)+' of them to ad leads')+'</div>'
      +maTable(['Project','Next 30 days (80% range)','Last 90 days','Credited to ads by the CRM','Median flat value'],d.rows.map(function(x){ return '<tr><td>'+esc(x.p)+'</td><td><b>'+n0(x.next)+'</b>'+maRange(x.lo,x.hi,n0)+'</td><td>'+obNum(x.n90)+'</td><td>'+obNum(x.crm)+'</td><td>'+obMoney(x.v)+'</td></tr>'; }))
      +'<div class="ma-h" style="margin-top:20px"><i class="fa-solid fa-sack-dollar"></i> Return on ad spend <span class="ma-sub" style="font-weight:500">· leads from '+obDmyS(obAdd(MA_D.today,-270))+' to '+obDmyS(obAdd(MA_D.today,-90))+'</span></div>'
      +maTable(['Project / platform','Ad spend','Bookings','Cost per booking','Sales per ₹1 of ads (80% range)'],d.roas.map(function(x){ return '<tr><td>'+maPlat(x.pl)+' '+esc(x.p)+'</td><td>'+obMoney(x.s)+'</td><td>'+obNum(x.b)+'</td><td>'+obMoney(x.cpb)+'</td><td><b>₹'+x.r.toFixed(0)+'</b><div class="ma-sub">₹'+x.lo.toFixed(0)+' – ₹'+x.hi.toFixed(0)+'</div></td></tr>'; })); }});

// ================================================================ BEST HOURS
function maHourData(){
  const P=MA_PA; if(!P||!P.hr||!P.hr.length) return {na:true};
  const res={}, blocks=[[0,4],[4,8],[8,12],[12,16],[16,20],[20,24]];
  ['google','meta'].forEach(function(pl){ const S=blocks.map(function(){ return 0; }), L=blocks.map(function(){ return 0; });
    P.hr.forEach(function(r){ if(r.platform!==pl) return; const c=MA_D.camp[r.campaign_id]; if(pl==='meta'&&c&&!c.lead) return; const b=blocks.findIndex(function(x){ return r.hour>=x[0]&&r.hour<x[1]; }); S[b]+=+r.spend||0; L[b]+=+r.leads||0; });
    const st=S.reduce(function(a,b){ return a+b; },0), lt=L.reduce(function(a,b){ return a+b; },0); if(!(st>0)||lt<50){ res[pl]=null; return; }
    let chi=0; const idx=S.map(function(s,i){ const e=lt*s/st; if(e>0) chi+=(L[i]-e)*(L[i]-e)/e; return e>0?L[i]/e:null; });
    const p=maGammaQ2(2.5,chi/2), spread=Math.max.apply(null,idx.map(function(v){ return v==null?0:Math.abs(v-1); }));
    res[pl]={idx:idx,cpl:S.map(function(s,i){ return L[i]?s/L[i]:null; }),share:S.map(function(s){ return s/st; }),p:p,real:p<0.01&&spread>=0.15,lt:lt}; });
  return {res:res,blocks:blocks};
}
// upper regularised incomplete gamma (chi-square p-value with 5 degrees of freedom: a = 2.5)
function maGammaQ2(a,x){ if(x<=0) return 1;
  if(x<a+1){ let ap=a, sum=1/a, del=sum; for(let n=0;n<200;n++){ ap++; del*=x/ap; sum+=del; if(Math.abs(del)<Math.abs(sum)*1e-10) break; } return 1-sum*Math.exp(-x+a*Math.log(x)-maLnG(a)); }
  let b=x+1-a, c=1e300, dd=1/b, h=dd; for(let i=1;i<200;i++){ const an=-i*(i-a); b+=2; dd=an*dd+b; if(Math.abs(dd)<1e-300) dd=1e-300; c=b+an/c; if(Math.abs(c)<1e-300) c=1e-300; dd=1/dd; const del=dd*c; h*=del; if(Math.abs(del-1)<1e-10) break; }
  return Math.exp(-x+a*Math.log(x)-maLnG(a))*h; }
maReg({id:'hours',title:'Best hours',icon:'fa-solid fa-clock',data:maHourData,ready:maPAReady,
  card:function(d){ if(d.na) return {val:'From 17 Nov',sub:'hourly figures are collected from tonight'};
    const parts=[]; ['google','meta'].forEach(function(pl){ const r=d.res[pl]; if(!r||!r.real) return; let bi=0; r.idx.forEach(function(v,i){ if(v>r.idx[bi]) bi=i; }); parts.push((pl==='google'?'Google':'Facebook')+': '+d.blocks[bi][0]+':00–'+d.blocks[bi][1]+':00'); });
    return parts.length?{val:parts[0].split(': ')[1],sub:parts.join(' · ')+' brings the most leads per rupee'}:{val:'No pattern',sub:'every time of day performs about the same'}; },
  view:function(d){ if(d.na) return maHead('fa-solid fa-clock','','Best hours','')+'<div class="ma-card">Hourly figures are collected from tonight (16 Nov 2026); this fills in tomorrow.</div>';
    const cell=function(v){ if(v==null) return '<td>—</td>'; const c=v-1; return '<td class="'+(c>=0.15?'ma-up':c<=-0.15?'ma-dn':'')+'"><b>'+(c>=0?'+':'')+Math.round(c*100)+'%</b></td>'; };
    const rows=[]; ['google','meta'].forEach(function(pl){ const r=d.res[pl]; if(!r) return;
      rows.push('<tr><td>'+maPlat(pl)+' '+(pl==='google'?'Google':'Facebook')+'<div class="ma-sub">'+(r.real?'real pattern (p '+(r.p<0.001?'< 0.001':'= '+r.p.toFixed(3))+')':'no pattern worth acting on')+'</div></td>'+r.idx.map(cell).join('')+'</tr>');
      rows.push('<tr><td class="ma-sub" style="padding-left:24px">share of spend</td>'+r.share.map(function(s){ return '<td class="ma-sub">'+Math.round(s*100)+'%</td>'; }).join('')+'</tr>'); });
    return maHead('fa-solid fa-clock','','Best hours',
        'Last 28 days, lead campaigns: leads each 4-hour block brought for its share of spend. +30% = 30% more leads than its spend predicts at the average rate. A real pattern needs the chi-square test (p < 0.01) and some block 15%+ off average. Use it to schedule ads or shift bids by time of day.')
      +(rows.length?maTable(['Platform'].concat(d.blocks.map(function(b){ return b[0]+':00–'+b[1]+':00'; })),rows):'<div class="ma-card">Not enough leads in the hourly figures yet.</div>'); }});
