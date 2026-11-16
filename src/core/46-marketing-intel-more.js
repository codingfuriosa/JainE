/* ============================ MARKETING INTELLIGENCE: THE FOUR MODELS ============================
   16 Nov 2026, Ayush: "a very complex Marketing Intelligence - every Statistics, Probability applied ... I know how many
   leads or money is going to be spent tomorrow ... important, relevant and useful things only ... not noisy at all".
   Four cards, each a page (registered with maReg, 45-marketing-analytics.js). Decision support only.

   1. TOMORROW & THIS MONTH   per campaign: spend = recency-weighted average x weekday effect; leads = spend x recency-
      weighted lead rate (shrunk to its project) x weekday effect, as a negative binomial (counts that vary more than
      Poisson). Ranges calibrated on a 30-day backtest of the same forecast; month-end by Monte Carlo (2,000 runs).
   2. WATCH LIST              one feed ranked by spend involved: Bayesian change-point on each campaign's lead rate
      (Gamma-Poisson), zero-result tests, yesterday's robust z-scores, creative fatigue (two-proportion z) - all the
      frequentist tests pass Benjamini-Hochberg false-discovery control at 5%.
   3. BUDGET OPTIMISER        per campaign leads = e^a x Adstock(spend)^b (carry-over chosen by fit), quasi-Poisson;
      greedy equal-marginal allocation of extra money to qualified leads, with a simulated range; Search lost-to-budget.
   4. LEAD QUALITY            Beta-Binomial shrinkage of each campaign's QL rate toward its project, credible ranges
      for cost per QL, Monte Carlo chance of being the cheapest per QL, Google vs Facebook, monthly QL-rate trend.
   Maths: the document "JainE Marketing Analytics: Models and Calculations". */
let MA_X=null, MA_XLOADING=null, MA_FC=null;
MA.extra=100000; MA.qtab='camp'; MA.wall=false;

// ---------------------------------------------------------------- extra data (after the first paint)
async function maLoadExtra(){
  if(MA_X&&MA_X.today===MA_D.today) return;
  if(MA_XLOADING) return MA_XLOADING;
  MA_XLOADING=(async function(){
    const today=MA_D.today, from=obAdd(today,-60);
    const ads=await maAll(function(){ return sb.schema('camp').from('ads_ad_daily').select('platform,account_id,campaign_id,ad_id,adset_id,day,spend,impressions,clicks,results,form_leads').gte('day',from).order('day'); }).catch(function(){ return null; });
    let is=null, rf=null;
    const q=await sb.schema('camp').from('ads_daily').select('campaign_id,day,imp_share,budget_lost_is,rank_lost_is').eq('platform','google').gte('day',obAdd(today,-15)).not('imp_share','is',null);
    if(!q.error) is=q.data||[];
    // Facebook reach / frequency per campaign and day (collected from 16 Nov 2026) - for audience saturation
    const f=await sb.schema('camp').from('ads_daily').select('campaign_id,day,impressions,clicks,reach,frequency').eq('platform','meta').gte('day',obAdd(today,-28)).not('frequency','is',null);
    if(!f.error) rf=f.data||[];
    MA_X={today:today,ads:ads,is:is,rf:rf};
  })();
  try{ await MA_XLOADING; } finally{ MA_XLOADING=null; }
}
function maXReady(){ return !!MA_X; }

// ---------------------------------------------------------------- maths
function maLnG(z){ const g=[76.18009172947146,-86.50532032941677,24.01409824083091,-1.231739572450155,0.1208650973866179e-2,-0.5395239384953e-5];
  let y=z, t=z+5.5; t-=(z+0.5)*Math.log(t); let s=1.000000000190015; for(let j=0;j<6;j++) s+=g[j]/++y; return -t+Math.log(2.5066282746310005*s/z); }
function maMed(a){ if(!a.length) return null; const s=a.slice().sort(function(x,y){ return x-y; }), m=s.length>>1; return s.length%2?s[m]:(s[m-1]+s[m])/2; }
function maMad(a){ const m=maMed(a); return maMed(a.map(function(x){ return Math.abs(x-m); })); }
function maZ2(x1,n1,x2,n2){ const p=(x1+x2)/(n1+n2), se=Math.sqrt(p*(1-p)*(1/n1+1/n2)); return se>0?(x2/n2-x1/n1)/se:0; }
function maP2(z){ return 2*(1-maNorm(Math.abs(z))); }
// Benjamini-Hochberg: keeps the items whose p-values pass false-discovery control at level q
function maBH(items,q){ const s=items.slice().sort(function(a,b){ return a.p-b.p; }), m=s.length; let k=0; s.forEach(function(x,i){ if(x.p<=(i+1)/m*q) k=i+1; }); return s.slice(0,k); }
// random draws
let MA_SEED=20261116; function maRnd(){ MA_SEED=(MA_SEED*1664525+1013904223)%4294967296; return (MA_SEED+0.5)/4294967296; }
function maRn(){ let u=0,v=0; while(u===0) u=maRnd(); v=maRnd(); return Math.sqrt(-2*Math.log(u))*Math.cos(2*Math.PI*v); }
function maRGamma(k){ if(k<1){ return maRGamma(k+1)*Math.pow(maRnd(),1/k); } const d=k-1/3, c=1/Math.sqrt(9*d);
  for(;;){ let x,v; do{ x=maRn(); v=1+c*x; }while(v<=0); v=v*v*v; const u=maRnd(); if(u<1-0.0331*x*x*x*x||Math.log(u)<0.5*x*x+d*(1-v+Math.log(v))) return d*v; } }
function maRPois(l){ if(l<=0) return 0; if(l>40) return Math.max(0,Math.round(l+Math.sqrt(l)*maRn())); const L=Math.exp(-l); let k=0,p=1; do{ k++; p*=maRnd(); }while(p>L); return k-1; }
function maRNB(mu,k){ return mu<=0?0:maRPois(maRGamma(k)*mu/k); }
function maRBeta(a,b){ const x=maRGamma(a), y=maRGamma(b); return x/(x+y); }
// negative binomial quantile (mean mu, size k)
function maNBq(mu,k,pr){ if(mu<=0) return 0; if(mu>400){ const sd=Math.sqrt(mu+mu*mu/k); return Math.max(0,Math.round(mu+sd*maNormInv(pr))); }
  const p=k/(k+mu); let f=Math.exp(k*Math.log(p)), c=f, y=0; while(c<pr&&y<5000){ y++; f*=(y+k-1)/y*(1-p); c+=f; } return y; }
function maNormInv(p){ // Acklam
  const a=[-39.6968302866538,220.946098424521,-275.928510446969,138.357751867269,-30.6647980661472,2.50662827745924], b=[-54.4760987982241,161.585836858041,-155.698979859887,66.8013118877197,-13.2806815528857],
    c=[-0.00778489400243029,-0.322396458041136,-2.40075827716184,-2.54973253934373,4.37466414146497,2.93816398269878], d=[0.00778469570904146,0.32246712907004,2.445134137143,3.75440866190742];
  const q=p<0.02425?Math.sqrt(-2*Math.log(p)):p>0.97575?Math.sqrt(-2*Math.log(1-p)):0;
  if(p<0.02425) return (((((c[0]*q+c[1])*q+c[2])*q+c[3])*q+c[4])*q+c[5])/((((d[0]*q+d[1])*q+d[2])*q+d[3])*q+1);
  if(p>0.97575) return -(((((c[0]*q+c[1])*q+c[2])*q+c[3])*q+c[4])*q+c[5])/((((d[0]*q+d[1])*q+d[2])*q+d[3])*q+1);
  const r=p-0.5, s=r*r; return (((((a[0]*s+a[1])*s+a[2])*s+a[3])*s+a[4])*s+a[5])*r/(((((b[0]*s+b[1])*s+b[2])*s+b[3])*s+b[4])*s+1); }
function maTable(heads,rows){ return '<div style="overflow-x:auto"><table class="ma-tbl"><thead><tr>'+heads.map(function(h){ return '<th>'+h+'</th>'; }).join('')+'</tr></thead><tbody>'+rows.join('')+'</tbody></table></div>'; }
function maPctl(a,p){ const s=a.slice().sort(function(x,y){ return x-y; }); return s[Math.min(s.length-1,Math.max(0,Math.floor(p*(s.length-1))))]; }
// leads = exp(a + b ln x): quasi-Poisson by Newton's method
function maFitPow(pts){
  const n=pts.length; if(n<5) return null;
  const xs=pts.map(function(p){ return Math.log(p.s); }), ys=pts.map(function(p){ return p.l; });
  let a=Math.log(Math.max(1e-6,ys.reduce(function(s,v){ return s+v; },0)/n)), b=0;
  for(let it=0;it<60;it++){ let u0=0,u1=0,i00=0,i01=0,i11=0;
    for(let i=0;i<n;i++){ const mu=Math.exp(a+b*xs[i]); u0+=ys[i]-mu; u1+=(ys[i]-mu)*xs[i]; i00+=mu; i01+=mu*xs[i]; i11+=mu*xs[i]*xs[i]; }
    const det=i00*i11-i01*i01; if(!(det>0)) return null; const da=(i11*u0-i01*u1)/det, db=(i00*u1-i01*u0)/det; a+=da; b+=db; if(Math.abs(da)+Math.abs(db)<1e-9) break; }
  let i00=0,i01=0,i11=0,phi=0,dev=0;
  for(let i=0;i<n;i++){ const mu=Math.exp(a+b*xs[i]); i00+=mu; i01+=mu*xs[i]; i11+=mu*xs[i]*xs[i]; phi+=(ys[i]-mu)*(ys[i]-mu)/Math.max(mu,1e-9); dev+=2*((ys[i]>0?ys[i]*Math.log(ys[i]/mu):0)-(ys[i]-mu)); }
  phi=Math.max(1,phi/(n-2)); const det=i00*i11-i01*i01; if(!(det>0)||!isFinite(b)) return null;
  return {a:a,b:b,seB:Math.sqrt(phi*i00/det),n:n,dev:dev}; }

// ---------------------------------------------------------------- shared: campaign day series
function maSeries(){
  if(MA_D.__ser) return MA_D.__ser;
  const D=MA_D, y=obAdd(D.today,-1), start=obAdd(D.today,-MA_DAYS_BACK), days=[], ix={};
  for(let d=start;d<=y;d=obAdd(d,1)){ ix[d]=days.length; days.push(d); }
  const S={};
  D.rows.forEach(function(r){ const i=ix[r.day]; if(i==null) return; let o=S[r.c.id];
    if(!o){ const n=days.length; o=S[r.c.id]={c:r.c,s:new Float64Array(n),l:new Float64Array(n),im:new Float64Array(n),k:new Float64Array(n),lead:r.leads!=null}; }
    o.s[i]+=r.spend; o.im[i]+=r.impr; o.k[i]+=r.clicks; if(r.leads!=null) o.l[i]+=r.leads; });
  const dow=days.map(function(d){ return new Date(d+'T00:00:00Z').getUTCDay(); });
  // weekday effects per platform, last 12 weeks: spend level and leads per rupee, each shrunk halfway to 1
  const eff={};
  ['google','meta'].forEach(function(pl){ const sp=[0,0,0,0,0,0,0], ls=[0,0,0,0,0,0,0], cnt=[0,0,0,0,0,0,0]; const i0=Math.max(0,days.length-84);
    for(let i=i0;i<days.length;i++) cnt[dow[i]]++;
    Object.keys(S).forEach(function(id){ const o=S[id]; if(o.c.platform!==pl) return; for(let i=i0;i<days.length;i++){ sp[dow[i]]+=o.s[i]; if(o.lead) ls[dow[i]]+=o.l[i]; } });
    const totS=sp.reduce(function(a,b){ return a+b; },0), totL=ls.reduce(function(a,b){ return a+b; },0), totC=cnt.reduce(function(a,b){ return a+b; },0);
    eff[pl]={s:sp.map(function(v,w){ return totS&&cnt[w]?Math.sqrt((v/cnt[w])/(totS/totC)):1; }),r:ls.map(function(v,w){ return totS&&totL&&sp[w]?Math.sqrt((v/sp[w])/(totL/totS)):1; })}; });
  // project + platform lead rate (last 56 days): the prior each campaign's rate is pulled toward
  const pr={}; Object.keys(S).forEach(function(id){ const o=S[id]; if(!o.lead) return; const k=o.c.project+'|'+o.c.platform, x=pr[k]=pr[k]||{s:0,l:0};
    for(let i=Math.max(0,days.length-56);i<days.length;i++){ x.s+=o.s[i]; x.l+=o.l[i]; } });
  MA_D.__ser={days:days,ix:ix,dow:dow,S:S,eff:eff,pr:pr};
  return MA_D.__ser;
}
// forecast one campaign for day index t (t may be days.length = today/tomorrow), from data before t only
function maPredict(o,t,ser,dowT,live){
  const s=o.s; if(t<4) return {s:0,l:0};
  if(live===false) return {s:0,l:0};
  if(s[t-1]===0&&s[t-2]===0&&s[t-3]===0) return {s:0,l:0};
  let ws=0,w=0; for(let a=1;a<=14&&t-a>=0;a++){ const k=Math.pow(0.5,(a-1)/3); ws+=k*s[t-a]; w+=k; }
  const e=ser.eff[o.c.platform]||{s:[1,1,1,1,1,1,1],r:[1,1,1,1,1,1,1]}, sp=w?ws/w*e.s[dowT]:0;
  if(!o.lead) return {s:sp,l:0};
  let wl=0,wsp=0; for(let a=1;a<=28&&t-a>=0;a++){ const k=Math.pow(0.5,(a-1)/7); wl+=k*o.l[t-a]; wsp+=k*s[t-a]; }
  const p=ser.pr[o.c.project+'|'+o.c.platform], pRate=p&&p.s?p.l/p.s:0, rate=pRate>0?(wl+5)/(wsp+5/pRate):(wsp?wl/wsp:0);
  return {s:sp,l:sp*rate*e.r[dowT]};
}

// ================================================================ 1. TOMORROW & THIS MONTH
function maFcData(){
  const D=MA_D, ser=maSeries(), n=ser.days.length, ids=Object.keys(ser.S);
  const proj={}; ids.forEach(function(id){ proj[ser.S[id].c.project]=1; });
  // backtest: the same forecast for each of the last 30 days, from data before that day
  const bt={}; Object.keys(proj).forEach(function(p){ bt[p]=[]; }); bt.__all=[];
  for(let t=n-30;t<n;t++){ const acc={}; ids.forEach(function(id){ const o=ser.S[id], f=maPredict(o,t,ser,ser.dow[t]); const a=acc[o.c.project]=acc[o.c.project]||{ps:0,pl:0,as:0,al:0};
      a.ps+=f.s; a.pl+=f.l; a.as+=o.s[t]; if(o.lead) a.al+=o.l[t]; });
    let T={ps:0,pl:0,as:0,al:0}; Object.keys(acc).forEach(function(p){ bt[p].push(acc[p]); ['ps','pl','as','al'].forEach(function(k){ T[k]+=acc[p][k]; }); }); bt.__all.push(T); }
  const calib=function(arr){ const ls=arr.filter(function(x){ return x.ps>0&&x.as>0; }).map(function(x){ return Math.log(x.as/x.ps); });
    const sig=ls.length>4?Math.sqrt(ls.reduce(function(s,v){ return s+v*v; },0)/ls.length):0.35;
    let num=0,den=0; arr.forEach(function(x){ if(x.pl>0){ num+=x.pl*x.pl; den+=(x.al-x.pl)*(x.al-x.pl)-x.pl; } });
    const k=den>0?Math.min(1000,Math.max(2,num/den)):1000;
    const mapeS=arr.filter(function(x){ return x.as>0; }).reduce(function(s,x,_,A){ return s+Math.abs(x.ps-x.as)/x.as/A.length; },0);
    const mapeL=arr.filter(function(x){ return x.al>0; }).reduce(function(s,x,_,A){ return s+Math.abs(x.pl-x.al)/x.al/A.length; },0);
    const inS=arr.filter(function(x){ return x.as>0&&x.ps>0; }).filter(function(x){ return Math.abs(Math.log(x.as/x.ps))<=1.2816*sig; }).length;
    return {sig:Math.min(1,Math.max(0.03,sig)),k:k,mapeS:mapeS,mapeL:mapeL,inS:inS,nS:arr.filter(function(x){ return x.as>0&&x.ps>0; }).length}; };
  const cal={}; Object.keys(bt).forEach(function(p){ cal[p]=calib(bt[p]); });
  // tomorrow (and each remaining day of the month) from today's state: paused campaigns spend nothing
  const today=D.today, tom=obAdd(today,1), dim=new Date(Date.UTC(+today.slice(0,4),+today.slice(5,7),0)).getUTCDate(), endM=today.slice(0,8)+String(dim).padStart(2,'0');
  const future=[]; for(let d=today;d<=endM;d=obAdd(d,1)) future.push(d);
  const per={}; // project -> per future day {s,l}
  ids.forEach(function(id){ const o=ser.S[id], live=caLive(o.c.status); future.forEach(function(d,j){ const f=maPredict(o,n,ser,new Date(d+'T00:00:00Z').getUTCDay(),live);
      const x=(per[o.c.project]=per[o.c.project]||future.map(function(){ return {s:0,l:0}; }))[j]; x.s+=f.s; x.l+=f.l; }); });
  const jT=future.indexOf(tom);
  const tomorrow=Object.keys(per).map(function(p){ const x=per[p][jT]||{s:0,l:0}, c=cal[p]||cal.__all;
    return {p:p,s:x.s,sLo:x.s*Math.exp(-1.2816*c.sig),sHi:x.s*Math.exp(1.2816*c.sig),l:x.l,lLo:maNBq(x.l,c.k,0.1),lHi:maNBq(x.l,c.k,0.9)}; })
    .filter(function(r){ return r.s>0||r.l>0; }).sort(function(a,b){ return b.s-a.s; });
  const TT=tomorrow.reduce(function(a,r){ return {s:a.s+r.s,l:a.l+r.l}; },{s:0,l:0}), cA=cal.__all;
  // month to date (through yesterday) and last month
  const m0=today.slice(0,8)+'01', y=obAdd(today,-1), lm0=obAdd(m0,-1).slice(0,8)+'01', lm1=obAdd(m0,-1);
  const sumP=function(p,a,b){ let s=0,l=0; ids.forEach(function(id){ const o=ser.S[id]; if(p&&o.c.project!==p) return; for(let i=0;i<n;i++){ const d=ser.days[i]; if(d<a||d>b) continue; s+=o.s[i]; if(o.lead) l+=o.l[i]; } }); return {s:s,l:l}; };
  // Monte Carlo month-end: a shared spend shock per run (budgets persist) + daily noise; leads negative binomial
  const P=Object.keys(per), R=2000, simS={}, simL={}, allS=new Float64Array(R), allL=new Float64Array(R);
  P.forEach(function(p){ simS[p]=new Float64Array(R); simL[p]=new Float64Array(R); });
  MA_SEED=20261116;
  for(let r=0;r<R;r++){ P.forEach(function(p){ const c=cal[p]||cA, zc=maRn(); let ss=0, ll=0;
      per[p].forEach(function(x){ const m=Math.exp(c.sig*(0.7071*zc+0.7071*maRn())-c.sig*c.sig/2); ss+=x.s*m; ll+=maRNB(x.l*m,c.k); });
      simS[p][r]=ss; simL[p][r]=ll; allS[r]+=ss; allL[r]+=ll; }); }
  const month=P.map(function(p){ const mt=sumP(p,m0,y), lm=sumP(p,lm0,lm1), S2=Array.from(simS[p]).map(function(v){ return v+mt.s; }), L2=Array.from(simL[p]).map(function(v){ return v+mt.l; });
    return {p:p,s50:maPctl(S2,0.5),s10:maPctl(S2,0.1),s90:maPctl(S2,0.9),l50:maPctl(L2,0.5),l10:maPctl(L2,0.1),l90:maPctl(L2,0.9),lm:lm,pBeat:lm.l>0?L2.filter(function(v){ return v>lm.l; }).length/R:null}; })
    .filter(function(r){ return r.s50>0; }).sort(function(a,b){ return b.s50-a.s50; });
  const mtA=sumP(null,m0,y), lmA=sumP(null,lm0,lm1), S3=Array.from(allS).map(function(v){ return v+mtA.s; }), L3=Array.from(allL).map(function(v){ return v+mtA.l; });
  const mAll={s50:maPctl(S3,0.5),s10:maPctl(S3,0.1),s90:maPctl(S3,0.9),l50:maPctl(L3,0.5),l10:maPctl(L3,0.1),l90:maPctl(L3,0.9),lm:lmA,pBeat:lmA.l>0?L3.filter(function(v){ return v>lmA.l; }).length/R:null};
  // budget pacing: last 7 days' spend against each running campaign's daily budget (delivery ratio)
  let budTot=0, delTot=0; const pace=[];
  ids.forEach(function(id){ const o=ser.S[id], B=+o.c.budget||0; if(!caLive(o.c.status)||!(B>0)) return;
    // average from its first day of spend in the window, so a campaign launched mid-week is not read as under-delivering
    let first=n-7; while(first<n&&o.s[first]===0) first++; const days=n-first; if(days<2&&B<500) return; let s7=0; for(let i=first;i<n;i++) s7+=o.s[i]; const avg=days?s7/days:0, r=avg/B;
    budTot+=B; delTot+=avg; if((r<0.7&&B>=500)||r>1.15) pace.push({c:o.c,B:B,avg:avg,r:r}); });
  pace.sort(function(a,b){ return Math.abs(b.avg-b.B)-Math.abs(a.avg-a.B); });
  return {pace:pace,budTot:budTot,delTot:delTot,tom:tom,tomorrow:tomorrow,TT:TT,tLo:TT.s*Math.exp(-1.2816*cA.sig),tHi:TT.s*Math.exp(1.2816*cA.sig),tlLo:maNBq(TT.l,cA.k,0.1),tlHi:maNBq(TT.l,cA.k,0.9),cal:cA,month:month,mAll:mAll,left:future.length};
}
function maRange(lo,hi,f){ return '<div class="ma-sub">'+f(lo)+' – '+f(hi)+'</div>'; }
function maStat(label,val,sub){ return '<div class="ma-st"><div class="ma-stl">'+label+'</div><div class="ma-stv">'+val+'</div><div class="ma-sub">'+sub+'</div></div>'; }
maReg({id:'fc',title:'Tomorrow & this month',icon:'fa-solid fa-chart-line',data:maFcData,
  card:function(d){ return {val:obMoney(d.TT.s)+' · '+obNum(Math.round(d.TT.l))+' leads',sub:'tomorrow ('+obDmyS(d.tom)+') · month-end '+obMoney(d.mAll.s50)+', '+obNum(Math.round(d.mAll.l50))+' leads'}; },
  view:function(d){ const n0=function(x){ return obNum(Math.round(x)); }, c=d.cal;
    return maHead('fa-solid fa-chart-line','','Tomorrow & this month',
        'Per campaign: spend = recency-weighted average of the last 14 days (half-life 3 days) × the platform’s weekday effect; leads = that spend × its recency-weighted lead rate (half-life 7 days, pulled toward its project) × weekday effect. Paused campaigns spend nothing. Leads are modelled as a negative binomial and every range is calibrated on how this same forecast did over the last 30 days. Month-end = 2,000 simulated runs of the remaining days. Ranges are 80%.')
      +'<div class="ma-stats">'+maStat('Tomorrow · spend',obMoney(d.TT.s),obMoney(d.tLo)+' – '+obMoney(d.tHi))+maStat('Tomorrow · leads',n0(d.TT.l),n0(d.tlLo)+' – '+n0(d.tlHi))
        +maStat('Month-end · spend',obMoney(d.mAll.s50),obMoney(d.mAll.s10)+' – '+obMoney(d.mAll.s90))
        +maStat('Month-end · leads',n0(d.mAll.l50),n0(d.mAll.l10)+' – '+n0(d.mAll.l90)+(d.mAll.pBeat!=null?' · '+Math.round(d.mAll.pBeat*100)+'% chance to beat last month':''))+'</div>'
      +'<div class="ma-note">Track record (last 30 days, same method): spend off by '+Math.round(c.mapeS*100)+'% on a typical day, leads by '+Math.round(c.mapeL*100)+'%; the spend range held on '+c.inS+' of '+c.nS+' days.</div>'
      +maTable(['Project','Tomorrow spend','Tomorrow leads','Month-end spend','Month-end leads','Last month leads','Chance to beat it'],
        d.month.map(function(m){ const t=d.tomorrow.find(function(x){ return x.p===m.p; })||{s:0,sLo:0,sHi:0,l:0,lLo:0,lHi:0};
          return '<tr><td>'+esc(m.p)+'</td><td><b>'+obMoney(t.s)+'</b>'+maRange(t.sLo,t.sHi,obMoney)+'</td><td><b>'+n0(t.l)+'</b>'+maRange(t.lLo,t.lHi,n0)+'</td>'
            +'<td><b>'+obMoney(m.s50)+'</b>'+maRange(m.s10,m.s90,obMoney)+'</td><td><b>'+n0(m.l50)+'</b>'+maRange(m.l10,m.l90,n0)+'</td><td>'+n0(m.lm.l)+'</td><td>'+(m.pBeat==null?'—':Math.round(m.pBeat*100)+'%')+'</td></tr>'; }))
      +'<div class="ma-h" style="margin-top:22px"><i class="fa-solid fa-gauge-high"></i> Budget pacing'+maInfo('Last 7 days’ average daily spend against each running campaign’s daily budget as set today. Under 70% = the campaign cannot spend its budget (audience too small, bid or cost cap, low quality, limited approvals); over 115% = it spends more than set (Google may spend up to 2× on a day; Facebook budgets changed mid-week). Only those are listed.')+'</div>'
      +'<div class="ma-note">Running campaigns’ budgets add up to '+obMoney(d.budTot)+' a day; they actually spent '+obMoney(d.delTot)+' a day over the last 7 days ('+(d.budTot?Math.round(d.delTot/d.budTot*100):0)+'%).</div>'
      +(d.pace.length?maTable(['Campaign','Daily budget','Spent / day (last 7)','Delivery','Read'],d.pace.map(function(x){ return '<tr><td class="ma-n">'+maPlat(x.c.platform)+' '+esc(x.c.name)+'<div class="ma-sub">'+esc(x.c.project)+'</div></td><td>'+obMoney(x.B)+'</td><td>'+obMoney(x.avg)+'</td><td class="'+(x.r<0.7?'ma-dn':'')+'"><b>'+Math.round(x.r*100)+'%</b></td><td class="ma-n">'+(x.r<0.7?'Not spending its budget':'Spending above budget')+'</td></tr>'; }))
        :'<div class="ma-card">Every running campaign is spending close to its budget.</div>'); }});

// ================================================================ 2. WATCH LIST
function maChangepoint(o,ser){ // Bayesian single change-point on the lead rate, last 56 days
  const n=ser.days.length, W=56, i0=n-W; if(i0<0) return null;
  let Y=0,Sp=0; for(let i=i0;i<n;i++){ Y+=o.l[i]; Sp+=o.s[i]; } if(Y<20||Sp<=0) return null;
  const rbar=Y/Sp, al=2, be=al/rbar;
  const ml=function(y,s){ return maLnG(al+y)-maLnG(al)+al*Math.log(be)-(al+y)*Math.log(be+s); };
  const m0=ml(Y,Sp); const cands=[]; let yb=0,sb=0;
  const cy=[],cs=[]; for(let i=i0;i<n;i++){ cy.push(yb); cs.push(sb); yb+=o.l[i]; sb+=o.s[i]; }
  for(let j=14;j<=W-5;j++){ const yB=cy[j], sB=cs[j]; if(sB<=0||Sp-sB<=0) continue; cands.push({j:j,lm:ml(yB,sB)+ml(Y-yB,Sp-sB),yB:yB,sB:sB}); }
  if(!cands.length) return null;
  const mx=Math.max(m0,Math.max.apply(null,cands.map(function(c){ return c.lm; })));
  const w0=0.5*Math.exp(m0-mx); let wc=0, best=cands[0]; cands.forEach(function(c){ c.w=0.5/cands.length*Math.exp(c.lm-mx); wc+=c.w; if(c.w>best.w) best=c; });
  const post=wc/(w0+wc), rB=best.yB/best.sB, rA=(Y-best.yB)/(Sp-best.sB);
  return {post:post,day:ser.days[i0+best.j],j:i0+best.j,rB:rB,rA:rA,ch:rB>0?rA/rB-1:null,i0:i0};
}
function maParts2(o,a,b){ let s=0,im=0,k=0,l=0; for(let i=a;i<b;i++){ s+=o.s[i]; im+=o.im[i]; k+=o.k[i]; l+=o.l[i]; } return {s:s,im:im,k:k,l:l,cpm:im?s/im*1000:null,ctr:im?k/im:null,cvr:k?l/k:null}; }
function maCause(B,A){ if(!(B.im&&A.im&&B.k&&A.k&&B.l&&A.l)) return '';
  const parts=[[Math.log(A.cpm/B.cpm),'auction cost',A.cpm/B.cpm-1],[-Math.log(A.ctr/B.ctr),'click rate',A.ctr/B.ctr-1],[-Math.log(A.cvr/B.cvr),'clicks to leads',A.cvr/B.cvr-1]]
    .filter(function(x){ return Math.abs(x[0])>0.03; }).sort(function(x,y){ return Math.abs(y[0])-Math.abs(x[0]); });
  return parts.slice(0,2).map(function(x){ return x[1]+' '+maPct(x[2]); }).join(', '); }
function maWatchData(){
  const D=MA_D, ser=maSeries(), n=ser.days.length, items=[], tests=[];
  const monthly=function(o){ let s=0; for(let i=n-14;i<n;i++) s+=o.s[i]; return s/14*30; };
  Object.keys(ser.S).forEach(function(id){ const o=ser.S[id]; if(!caLive(o.c.status)) return; const mon=monthly(o); if(mon<3000) return;
    // (a) Bayesian change-point in the lead rate
    if(o.lead){ const cp=maChangepoint(o,ser);
      if(cp&&cp.post>=0.95&&cp.ch!=null&&Math.abs(cp.ch)>=0.25&&cp.j>=n-28){ const B=maParts2(o,cp.i0,cp.j), A=maParts2(o,cp.j,n), worse=cp.ch<0;
        items.push({sev:worse?2:0,tone:worse?'bad':'good',c:o.c,mon:mon,title:'Lead rate '+(worse?'down ':'up ')+Math.round(Math.abs(cp.ch)*100)+'% since '+obDmyS(cp.day),
          why:(maCause(B,A)?'Mostly '+maCause(B,A)+'. ':'')+Math.round(cp.post*100)+'% certain it is a real shift, not chance.',act:worse?'Check what changed around '+obDmyS(cp.day)+': form, landing page, creative, audience.':'Find what changed on '+obDmyS(cp.day)+' and repeat it.'}); } }
    // (b) no leads for 7 days although its rate says some were due
    if(o.lead){ let rs=0,rl=0,bs=0,bl=0; for(let i=n-7;i<n;i++){ rs+=o.s[i]; rl+=o.l[i]; } for(let i=n-35;i<n-7;i++){ bs+=o.s[i]; bl+=o.l[i]; }
      if(rs>=3000&&rl===0&&bs>0&&bl>0){ const lam=rs*bl/bs; tests.push({p:Math.exp(-lam),it:{sev:3,tone:'bad',c:o.c,mon:mon,title:'No leads in 7 days',why:'Spent '+obMoney(rs)+'; about '+obNum(Math.round(lam))+' leads were due at its usual rate.',act:'Check the lead form, tracking and recent ad changes.'}}); } }
    // (c) yesterday's spend / auction cost / click rate vs its own last 28 days (robust z)
    const t=n-1; const yS=o.s[t], yI=o.im[t], yK=o.k[t]; const base=[]; for(let i=n-29;i<n-1;i++) if(o.s[i]>0) base.push(i);
    if(base.length>=14){ const avg=base.reduce(function(s,i){ return s+o.s[i]; },0)/base.length;
      if(yS===0&&avg>=500) items.push({sev:3,tone:'bad',c:o.c,mon:mon,title:'Delivery stopped yesterday',why:'Nothing spent; it usually spends '+obMoney(avg)+' a day.',act:'Check billing, approvals and whether it was paused by mistake.'});
      const z=function(label,val,arr,ok,badUp){ if(!ok||arr.length<10) return; const m=maMed(arr), md=maMad(arr); if(!(m>0)||!(md>0)) return; const zz=(val-m)/(1.4826*md), rel=val/m-1; if(Math.abs(rel)<0.3||Math.abs(zz)<3) return;
        tests.push({p:maP2(zz),it:{sev:1,tone:(rel>0)===badUp?'warn':'mid',c:o.c,mon:mon,title:label+(rel>0?' up ':' down ')+Math.round(Math.abs(rel)*100)+'% yesterday',why:'Far outside its usual day-to-day range (robust z = '+zz.toFixed(1)+').',act:label==='Spend'?'Confirm the budget change was intended.':label==='Auction cost'?'Check competition and audience size; watch cost per lead.':'Check the creative and placements.'}}); };
      if(yS>0){ z('Spend',yS,base.map(function(i){ return o.s[i]; }),true,true);
        z('Auction cost',yI?yS/yI*1000:0,base.filter(function(i){ return o.im[i]>=500; }).map(function(i){ return o.s[i]/o.im[i]*1000; }),yI>=500,true);
        z('Click rate',yI?yK/yI:0,base.filter(function(i){ return o.im[i]>=1000; }).map(function(i){ return o.k[i]/o.im[i]; }),yI>=1000,false); } }
  });
  // (d) leads that never qualify (settled window), from the waste model
  maAlertsData().filter(function(a){ return a.kind&&a.kind.indexOf('qualified')>=0; }).forEach(function(a){ items.push({sev:2,tone:'warn',c:a.c,mon:0,title:'Leads, but none qualify',why:a.what+'.',act:'Check targeting, the ad’s promise and the form’s questions.'}); });
  // (e) creative fatigue, ad level
  if(MA_X&&MA_X.ads){ const by={}; MA_X.ads.forEach(function(r){ if(r.day>obAdd(D.today,-1)) return; const c=D.camp[r.campaign_id]; if(!c||!caLive(c.status)) return; const e=D.E['ad:'+r.ad_id]; if(!e||!caLive(e.status)) return;
      const g=by[r.ad_id]=by[r.ad_id]||{c:c,name:e.name||r.ad_id,d:[]}; if(+r.impressions>0) g.d.push({d:r.day,i:+r.impressions,k:+r.clicks||0,s:+r.spend||0}); });
    Object.keys(by).forEach(function(id){ const g=by[id]; g.d.sort(function(a,b){ return a.d<b.d?-1:1; }); if(g.d.length<14) return;
      const f=g.d.slice(0,7), l=g.d.slice(-7), su=function(a,k){ return a.reduce(function(s,x){ return s+x[k]; },0); }, fi=su(f,'i'), li=su(l,'i'), fk=su(f,'k'), lk=su(l,'k');
      if(fi<3000||li<3000||fk<10) return; const drop=(lk/li)/(fk/fi)-1, zz=maZ2(fk,fi,lk,li); if(drop>-0.25) return;
      tests.push({p:maP2(zz),it:{sev:1,tone:'warn',c:g.c,mon:su(l,'s')/7*30,title:'Ad wearing out: '+g.name,why:'Click rate '+obPct(fk/fi*100)+' → '+obPct(lk/li*100)+' ('+maPct(drop)+') since its early days.',act:'Refresh or replace this creative.'}}); }); }
  // (f) audience saturation (Facebook): the same people seeing the ads more often while fewer click - daily frequency
  // last 7 days vs the 14 before up 30%+, click rate down 20%+ (two-proportion z-test). Needs reach / frequency (16 Nov 2026 on).
  if(MA_X&&MA_X.rf&&MA_X.rf.length){ const y=obAdd(D.today,-1), a0=obAdd(D.today,-7), b0=obAdd(D.today,-21), g={};
    MA_X.rf.forEach(function(r){ if(r.day>y) return; const c=D.camp[r.campaign_id]; if(!c||!caLive(c.status)) return; const o=g[r.campaign_id]=g[r.campaign_id]||{c:c,a:{f:[],i:0,k:0},b:{f:[],i:0,k:0}};
      const s=r.day>=a0?o.a:r.day>=b0?o.b:null; if(!s) return; s.f.push(+r.frequency||0); s.i+=+r.impressions||0; s.k+=+r.clicks||0; });
    Object.keys(g).forEach(function(id){ const o=g[id]; if(o.a.f.length<5||o.b.f.length<7||o.a.i<5000||o.b.i<5000) return;
      const fa=o.a.f.reduce(function(s,v){ return s+v; },0)/o.a.f.length, fb=o.b.f.reduce(function(s,v){ return s+v; },0)/o.b.f.length, ctrCh=(o.a.k/o.a.i)/(o.b.k/o.b.i)-1, zz=maZ2(o.b.k,o.b.i,o.a.k,o.a.i);
      if(fb>0&&fa/fb-1>=0.3&&ctrCh<=-0.2) tests.push({p:maP2(zz),it:{sev:2,tone:'warn',c:o.c,mon:monthly(ser.S[id]||{s:new Float64Array(n)}),title:'Audience saturating',why:'Daily frequency '+fb.toFixed(2)+' → '+fa.toFixed(2)+' while click rate fell '+Math.round(-ctrCh*100)+'%: the same people are seeing the ads too often.',act:'Widen the audience or add fresh creatives; consider a frequency cap.'}}); }); }
  // false-discovery control over every frequentist test at 5%
  maBH(tests,0.05).forEach(function(t){ items.push(t.it); });
  // quiet by design: one row per campaign for yesterday's unusual moves, nothing under Rs 10,000 a month (except a stop)
  const out=[], day={};
  items.forEach(function(x){ if(x.mon<10000&&x.sev<3&&x.mon) return;
    if(/yesterday$/.test(x.title)&&x.sev===1){ const g=day[x.c.id]; if(g){ g.parts.push(x.title.replace(/ yesterday$/,'')); if(x.tone==='warn') g.tone='warn'; return; }
      day[x.c.id]={sev:1,tone:x.tone,c:x.c,mon:x.mon,parts:[x.title.replace(/ yesterday$/,'')],title:'',why:'Far outside its usual day-to-day range.',act:'Check what changed yesterday: budget, audience, creative or competition.'}; out.push(day[x.c.id]); return; }
    out.push(x); });
  out.forEach(function(x){ if(x.parts) x.title='Unusual day yesterday: '+x.parts.join(', ').toLowerCase().replace(/^./,function(c){ return c.toUpperCase(); }); });
  out.sort(function(a,b){ return b.sev-a.sev||b.mon-a.mon; });
  return {items:out,tested:Object.keys(ser.S).length};
}
maReg({id:'watch',title:'Watch list',icon:'fa-solid fa-binoculars',data:maWatchData,ready:maXReady,
  card:function(d){ const bad=d.items.filter(function(x){ return x.tone==='bad'; }).length; return d.items.length?{val:d.items.length+' to look at',sub:bad?bad+' need action now':'nothing urgent',tone:bad?'bad':'warn'}:{val:'All clear',sub:'nothing beyond normal variation',tone:'good'}; },
  view:function(d){ const list=MA.wall?d.items:d.items.slice(0,8);
    return maHead('fa-solid fa-binoculars','','Watch list',
        'One list of what needs attention, most urgent and biggest spend first. Lead-rate shifts: a Bayesian change-point model (Gamma-Poisson) on each campaign’s last 56 days, shown when 95%+ certain and 25%+ in size. Zero-lead, unusual-day and creative-fatigue tests all pass Benjamini-Hochberg false-discovery control at 5%, so checking many campaigns does not produce chance alarms.')
      +(d.items.length?'<div class="ma-feed">'+list.map(function(x){ return '<div class="ma-fi"><span class="ma-dot2 '+(x.tone||'mid')+'"></span><div class="ma-fb"><div class="ma-ft">'+esc(x.title)+'</div>'
          +'<div class="ma-fc">'+maPlat(x.c.platform)+' '+esc(x.c.name)+' · '+esc(x.c.project)+(x.mon?' · '+obMoney(x.mon)+'/month':'')+'</div><div class="ma-fw">'+esc(x.why)+'</div></div><div class="ma-fa">'+esc(x.act)+'</div></div>'; }).join('')+'</div>'
        +(d.items.length>8?'<div style="margin-top:10px"><button class="ma-btn" onclick="MA.wall=!MA.wall;maPaint()">'+(MA.wall?'Show top 8':'Show all '+d.items.length)+'</button></div>':'')
      :'<div class="ma-card">All clear: no campaign moved beyond normal variation.</div>'); }});

// ================================================================ 3. BUDGET OPTIMISER
function maCurves(){
  if(MA_D.__cur) return MA_D.__cur;
  const ser=maSeries(), n=ser.days.length, out=[];
  Object.keys(ser.S).forEach(function(id){ const o=ser.S[id]; if(!o.lead||!caLive(o.c.status)) return;
    let S0=0; for(let i=n-14;i<n;i++) S0+=o.s[i]; S0/=14; const r={o:o,c:o.c,S0:S0,fit:null,why:''};
    const idx=[]; for(let i=n-90;i<n;i++) if(i>=0&&o.s[i]>0) idx.push(i);
    const L=idx.reduce(function(s,i){ return s+o.l[i]; },0), ss=idx.map(function(i){ return o.s[i]; }), m=ss.reduce(function(s,v){ return s+v; },0)/(ss.length||1), cv=ss.length>1?maSd(ss)/m:0;
    if(idx.length<30) r.why='under 30 days of spend'; else if(L<30) r.why='under 30 leads'; else if(cv<0.25) r.why='spend barely varied'; else if(!(S0>0)) r.why='no recent spend';
    else { let best=null; [0,0.3,0.5,0.7].forEach(function(th){ const A=new Float64Array(n); for(let i=0;i<n;i++) A[i]=o.s[i]+(i?th*A[i-1]:0);
        const f=maFitPow(idx.map(function(i){ return {s:A[i]*(1-th),l:o.l[i]}; }).filter(function(p){ return p.s>0; })); if(f&&(!best||f.dev<best.f.dev)) best={f:f,th:th}; });
      if(best){ r.fit=best.f; r.th=best.th; const f=best.f; r.lo=f.b-1.96*f.seB; r.hi=f.b+1.96*f.seB; r.mu0=Math.exp(f.a+f.b*Math.log(S0)); r.mcpl=f.b>0?S0/(f.b*r.mu0):null; r.acpl=S0/r.mu0; r.cls=r.hi<1?'dim':r.lo>1?'inc':'flat'; }
      else r.why='the fit did not settle'; }
    out.push(r); });
  MA_D.__cur=out; return out;
}
function maOptData(){
  const D=MA_D, cur=maCurves(), wEnd=obAdd(D.today,-MA_SETTLE), wStart=obAdd(wEnd,-89);
  const pl={}, cq={}, pq={};
  D.rows.forEach(function(r){ if(r.leads==null||!maIn(r.day,wStart,wEnd)) return; pl[r.c.id]=(pl[r.c.id]||0)+r.leads; const k=r.c.project+'|'+r.c.platform; (pq[k]=pq[k]||{l:0,q:0}).l+=r.leads; });
  D.crm.forEach(function(r){ if(!maIn(r.day,wStart,wEnd)) return; if(r.cid) cq[r.cid]=(cq[r.cid]||0)+r.ql; const k=r.project+'|'+r.platform; (pq[k]=pq[k]||{l:0,q:0}).q+=r.ql; });
  let ts=0,tq=0; D.rows.forEach(function(r){ if(maIn(r.day,wStart,wEnd)) ts+=r.spend; }); D.crm.forEach(function(r){ if(maIn(r.day,wStart,wEnd)) tq+=r.ql; });
  const avgCpq=tq?ts/tq:null, limit=avgCpq?1.5*avgCpq:Infinity;
  cur.forEach(function(r){ const k=r.c.project+'|'+r.c.platform, base=pq[k]&&pq[k].l?pq[k].q/pq[k].l:0, L=pl[r.c.id]||0, Q=cq[r.c.id]; r.q=Q==null?base:(Q+30*base)/(L+30);
    r.mcpq=r.fit&&r.q>0&&r.mcpl?r.mcpl/r.q:null; });
  // Search impression share lost to budget
  const isB={}; if(MA_X&&MA_X.is){ const g={}; MA_X.is.forEach(function(x){ const o=g[x.campaign_id]=g[x.campaign_id]||{n:0,b:0,r:0}; o.n++; o.b+=+x.budget_lost_is||0; o.r+=+x.rank_lost_is||0; }); Object.keys(g).forEach(function(k){ isB[k]={b:g[k].b/g[k].n,r:g[k].r/g[k].n}; }); }
  const cands=cur.filter(function(r){ return r.fit&&r.hi-r.lo<=1&&r.fit.b>0&&r.q>0; }).map(function(r){ return {r:r,x:0,cap:r.S0*0.3}; });
  const mq=function(c,s){ const f=c.r.fit; return c.r.q*f.b*Math.exp(f.a)*Math.pow(s,f.b-1); };
  const step=100; let left=MA.extra/30;
  while(left>=step){ let best=null,bv=0; cands.forEach(function(c){ if(c.x+step>c.cap) return; const v=mq(c,c.r.S0+c.x+step/2); if(v>bv){ bv=v; best=c; } }); if(!best||1/bv>limit) break; best.x+=step; left-=step; }
  const mu=function(f,s){ return Math.exp(f.a+f.b*Math.log(s)); };
  // range of the extra qualified leads: draws of each elasticity b from its estimate
  MA_SEED=7; const sims=[]; for(let k=0;k<1000;k++){ let q=0; cands.forEach(function(c){ if(!c.x) return; const f=c.r.fit, b=f.b+f.seB*maRn(), a=Math.log(c.r.mu0)-b*Math.log(c.r.S0); q+=30*c.r.q*(Math.exp(a+b*Math.log(c.r.S0+c.x))-c.r.mu0); }); sims.push(q); }
  const got=cands.filter(function(c){ return c.x>0; }), dq=got.reduce(function(s,c){ return s+30*c.r.q*(mu(c.r.fit,c.r.S0+c.x)-mu(c.r.fit,c.r.S0)); },0);
  return {cur:cur,got:got,dq:dq,dqLo:maPctl(sims,0.1),dqHi:maPctl(sims,0.9),left:left*30,limit:limit,avgCpq:avgCpq,isB:isB};
}
window.maSetExtra=function(v){ MA.extra=+v; maPaint(); };
maReg({id:'opt',title:'Budget optimiser',icon:'fa-solid fa-scale-balanced',data:maOptData,ready:maXReady,
  card:function(d){ return d.got.length?{val:'+'+obNum(Math.round(d.dq))+' qualified leads',sub:'a month from '+obMoney(MA.extra)+' more, placed where it works'}:{val:'Hold',sub:'no campaign can take more money well'}; },
  /* PLAIN FIRST (16 Nov 2026, Ayush: "the Budget optimiser looks weird - what is it?"): the answer in one sentence, then only
     the recommended moves; the full curve table sits behind a button. Same maths as before. */
  view:function(d){ const seg='<div class="ma-seg">'+[[50000,'₹50k'],[100000,'₹1 lakh'],[200000,'₹2 lakh']].map(function(o){ return '<button class="'+(MA.extra===o[0]?'on':'')+'" onclick="maSetExtra('+o[0]+')">'+o[1]+'</button>'; }).join('')+'</div>';
    const mu=function(r,s){ return Math.exp(r.fit.a+r.fit.b*Math.log(s)); };
    const read={dim:'Each extra rupee brings fewer leads',flat:'Still brings leads at about the same cost',inc:'Brings leads cheaper as it grows'};
    const moves=d.got.slice().sort(function(a,b){ return b.x-a.x; }).map(function(c){ const r=c.r, dl=30*(mu(r,r.S0+c.x)-mu(r,r.S0));
      return '<tr><td class="ma-n">'+maPlat(r.c.platform)+' '+esc(r.c.name)+'<div class="ma-sub">'+esc(r.c.project)+'</div></td><td>'+obMoney(r.S0)+'/day</td><td><b class="ma-up">+'+obMoney(c.x)+'/day</b><div class="ma-sub">+'+obMoney(c.x*30)+' a month</div></td>'
        +'<td>+'+obNum(Math.round(dl))+'</td><td><b>+'+obNum(Math.round(dl*r.q))+'</b></td><td>'+obMoney(r.mcpq)+'</td></tr>'; });
    const all=d.cur.filter(function(r){ return r.fit; }).sort(function(a,b){ return (a.mcpq||9e15)-(b.mcpq||9e15); }).map(function(r){ const ib=d.isB[r.c.id];
      return '<tr><td class="ma-n">'+maPlat(r.c.platform)+' '+esc(r.c.name)+'<div class="ma-sub">'+esc(r.c.project)+'</div></td><td class="ma-n">'+read[r.cls]+'</td><td>'+obMoney(r.S0)+'</td><td>'+obMoney(r.acpl)+'</td><td>'+obMoney(r.mcpl)+'</td><td><b>'+obMoney(r.mcpq)+'</b></td><td>'+(ib?Math.round(ib.b*100)+'%':'—')+'</td></tr>'; });
    const answer=d.got.length?'If you spend <b>'+obMoney(MA.extra)+' more a month</b>, put <b>'+obMoney(MA.extra-d.left)+'</b> into the '+d.got.length+' campaign'+(d.got.length===1?'':'s')+' below for about <b>'+obNum(Math.round(d.dq))+' more qualified leads</b> a month (likely '+obNum(Math.round(Math.max(0,d.dqLo)))+'–'+obNum(Math.round(d.dqHi))+').'+(d.left>=100?' Keep the other <b>'+obMoney(d.left)+'</b>: every other place would pay over '+obMoney(d.limit)+' for each extra qualified lead.':'')
      :'Hold the extra money: no running campaign can turn it into qualified leads for under '+obMoney(d.limit)+' each.';
    return maHead('fa-solid fa-scale-balanced','','Budget optimiser',
        'What it does: for each running campaign it learns, from its last 90 days, how many more leads each extra rupee brings (that number falls as spend rises - diminishing returns), and how many of its leads qualify. It then places the extra money a little at a time wherever the next rupee brings the most qualified leads, never pushing a campaign more than 30% above its recent spend (beyond that is untested) and never where a qualified lead would cost over 1.5× the average. Maths: quasi-Poisson power curve with adstock (carry-over), Beta-shrunk QL rates, 1,000 simulations for the range.',seg)
      +'<div class="ma-card" style="font-size:14px">'+answer+'</div>'
      +(moves.length?maTable(['Put more into','Spends now','Add','More leads / month','More QL / month','Each extra QL costs'],moves):'')
      +(all.length?'<div style="margin-top:12px"><button class="ma-btn" onclick="MA.optAll=!MA.optAll;maPaint()">'+(MA.optAll?'Hide':'Show')+' every measured campaign ('+all.length+')</button></div>'
        +(MA.optAll?'<div style="margin-top:12px">'+maTable(['Campaign','What more money does','Spend / day','Avg cost / lead','Next lead costs','Next QL costs','Search lost to budget'],all)+'</div>':''):''); }});

// ================================================================ 4. LEAD QUALITY
function maLQData(){
  const D=MA_D, wEnd=obAdd(D.today,-MA_SETTLE), wStart=obAdd(wEnd,-(MA.win-1));
  const sp={}, cl={}, ql={}, sv={}, bk={}, pr={};
  D.rows.forEach(function(r){ if(!maIn(r.day,wStart,wEnd)) return; sp[r.c.id]=(sp[r.c.id]||0)+r.spend; });
  D.crm.forEach(function(r){ if(!maIn(r.day,wStart,wEnd)) return; const k=r.project+'|'+r.platform, x=pr[k]=pr[k]||{s:0,l:0,q:0,v:0,b:0}; x.l+=r.leads; x.q+=r.ql; x.v+=r.sv; x.b+=r.bk;
    if(r.cid){ cl[r.cid]=(cl[r.cid]||0)+r.leads; ql[r.cid]=(ql[r.cid]||0)+r.ql; sv[r.cid]=(sv[r.cid]||0)+r.sv; bk[r.cid]=(bk[r.cid]||0)+r.bk; } });
  D.rows.forEach(function(r){ if(!maIn(r.day,wStart,wEnd)) return; const x=pr[r.c.project+'|'+r.c.platform]; if(x) x.s+=r.spend; });
  const K=30, camps=[];
  Object.keys(cl).forEach(function(id){ const c=D.camp[id]; if(!c||!caLive(c.status)||!(sp[id]>=5000)||cl[id]<5) return; /* running campaigns only (16 Nov 2026) */ const p=pr[c.project+'|'+c.platform], p0=p&&p.l?Math.max(0.005,p.q/p.l):0.05;
    const a=ql[id]+K*p0, b=cl[id]-ql[id]+K*(1-p0); camps.push({c:c,s:sp[id],l:cl[id],q:ql[id],v:sv[id],bk:bk[id],a:a,b:b,rate:a/(a+b)}); });
  // credible ranges and chance of being the cheapest per QL WITHIN ITS PROJECT (projects sell different things:
  // banquets vs flats), by Monte Carlo over the Beta posteriors
  MA_SEED=99; const R=3000, wins=new Float64Array(camps.length), draws=camps.map(function(){ return []; });
  for(let r=0;r<R;r++){ const best={}; camps.forEach(function(x,i){ const th=maRBeta(x.a,x.b), cpq=x.s/(x.l*th); draws[i].push(cpq); const p=x.c.project; if(!best[p]||cpq<best[p].v) best[p]={v:cpq,i:i}; });
    Object.keys(best).forEach(function(p){ wins[best[p].i]++; }); }
  const nIn={}; camps.forEach(function(x){ nIn[x.c.project]=(nIn[x.c.project]||0)+1; });
  camps.forEach(function(x,i){ x.cpq=x.s/(x.l*x.rate); x.lo=maPctl(draws[i],0.1); x.hi=maPctl(draws[i],0.9); x.pBest=nIn[x.c.project]>1?wins[i]/R:null; x.cpv=x.v?x.s/x.v:null; });
  camps.sort(function(a,b){ return a.c.project<b.c.project?-1:a.c.project>b.c.project?1:a.cpq-b.cpq; });
  // Google vs Facebook per project: chance Facebook is cheaper per QL
  const P={}; Object.keys(pr).forEach(function(k){ const pp=k.split('|'); (P[pp[0]]=P[pp[0]]||{})[pp[1]]=pr[k]; });
  const plat=Object.keys(P).filter(function(p){ return P[p].google&&P[p].meta&&P[p].google.s>0&&P[p].meta.s>0&&P[p].google.l>0&&P[p].meta.l>0; }).map(function(p){ const g=P[p].google, m=P[p].meta; let fb=0;
    for(let r=0;r<2000;r++){ const tg=maRBeta(g.q+1,g.l-g.q+1), tm=maRBeta(m.q+1,m.l-m.q+1); if(m.s/(m.l*tm)<g.s/(g.l*tg)) fb++; }
    return {p:p,g:g,m:m,pFb:fb/2000}; }).sort(function(a,b){ return (b.g.s+b.m.s)-(a.g.s+a.m.s); });
  return {camps:camps,plat:plat,trend:maTrendData(),wStart:wStart,wEnd:wEnd};
}
function maTrendData(){
  const D=MA_D, settled=obAdd(D.today,-MA_SETTLE), M={};
  D.crm.forEach(function(r){ const m=r.day.slice(0,7), pm=M[r.project]=M[r.project]||{}, o=pm[m]=pm[m]||{l:0,q:0}; o.l+=r.leads; o.q+=r.ql; });
  const months=[]; for(let i=11;i>=0;i--) months.push(new Date(Date.UTC(+D.today.slice(0,4),+D.today.slice(5,7)-1-i,1)).toISOString().slice(0,7));
  for(let i=months.length-1;i>=0;i--) if(!Object.keys(M).some(function(p){ return M[p][months[i]]&&M[p][months[i]].l>0; })) months.splice(i,1);   // only months the CRM has data for
  const isSet=function(m){ return new Date(Date.UTC(+m.slice(0,4),+m.slice(5,7),0)).toISOString().slice(0,10)<=settled; };
  return {months:months,list:Object.keys(M).map(function(p){ const mm=months.map(function(m){ const o=M[p][m]||{l:0,q:0}; return {m:m,l:o.l,q:o.q,set:isSet(m)}; });
    const st=mm.filter(function(x){ return x.set&&x.l>0; }); let v=null;
    if(st.length>=4){ const last=st[st.length-1], prev=st.slice(-4,-1), pl=prev.reduce(function(s,x){ return s+x.l; },0), pq=prev.reduce(function(s,x){ return s+x.q; },0);
      if(last.l>=30&&pl>=60){ const z=maZ2(pq,pl,last.q,last.l); v={z:z,real:Math.abs(z)>=1.96}; } }
    return {p:p,mm:mm,v:v,tot:mm.reduce(function(s,x){ return s+x.l; },0)}; }).filter(function(x){ return x.tot>=30; }).sort(function(a,b){ return b.tot-a.tot; })};
}
window.maQTab=function(t){ MA.qtab=t; maPaint(); };
window.maSetWin2=function(v){ MA.win=+v; maPaint(); };
maReg({id:'lq',title:'Lead quality',icon:'fa-solid fa-ranking-star',data:maLQData,
  card:function(d){ const clear=d.camps.filter(function(x){ return x.pBest!=null&&x.pBest>=0.8; }), b=d.camps.slice().sort(function(a,c){ return a.cpq-c.cpq; })[0];
    return b?{val:clear.length?clear.length+' clear winner'+(clear.length===1?'':'s'):'No clear winner',sub:clear.length?clear.slice(0,2).map(function(x){ return esc(x.c.project)+': '+esc(x.c.name)+' ('+Math.round(x.pBest*100)+'%)'; }).join(' · '):'campaigns within each project cost about the same per QL'}:{val:'—',sub:'not enough CRM leads'}; },
  view:function(d){ const tabs='<div class="ma-seg">'+[['camp','Campaigns'],['plat','Google vs Facebook'],['trend','Quality trend']].map(function(t){ return '<button class="'+(MA.qtab===t[0]?'on':'')+'" onclick="maQTab(\''+t[0]+'\')">'+t[1]+'</button>'; }).join('')+'</div>';
    const win='<div class="ma-seg">'+[[30,'30 days'],[60,'60 days'],[90,'90 days']].map(function(o){ return '<button class="'+(MA.win===o[0]?'on':'')+'" onclick="maSetWin2('+o[0]+')">'+o[1]+'</button>'; }).join('')+'</div>';
    let body='';
    if(MA.qtab==='camp'){ let last=null; body=maTable(['Campaign','Spend','CRM leads','QL rate','Cost per QL (80% range)','Chance cheapest in project','Cost per SV','Booked'],d.camps.reduce(function(rows,x){
        if(x.c.project!==last){ last=x.c.project; rows.push('<tr class="ma-p"><td colspan="8">'+esc(x.c.project)+'</td></tr>'); }
        rows.push('<tr><td class="ma-n" style="padding-left:22px">'+maPlat(x.c.platform)+' '+esc(x.c.name)+(caLive(x.c.status)?'':' <span class="ma-b mid">paused</span>')+'</td><td>'+obMoney(x.s)+'</td><td>'+obNum(x.l)+'</td><td>'+Math.round(x.rate*100)+'%</td>'
          +'<td><b>'+obMoney(x.cpq)+'</b>'+maRange(x.lo,x.hi,obMoney)+'</td><td>'+(x.pBest==null?'<span class="ma-sub">only one</span>':x.pBest>=0.8?'<b class="ma-up">'+Math.round(x.pBest*100)+'%</b>':x.pBest>=0.005?Math.round(x.pBest*100)+'%':'<1%')+'</td><td>'+obMoney(x.cpv)+'</td><td>'+obNum(x.bk)+'</td></tr>'); return rows; },[])); }
    else if(MA.qtab==='plat') body=maTable(['Project','Google cost per QL','Facebook cost per QL','Chance Facebook is cheaper','Google QL rate','Facebook QL rate'],d.plat.map(function(x){
        return '<tr><td>'+esc(x.p)+'</td><td>'+obMoney(x.g.q?x.g.s/x.g.q:null)+'</td><td>'+obMoney(x.m.q?x.m.s/x.m.q:null)+'</td><td><b>'+Math.round(x.pFb*100)+'%</b></td><td>'+Math.round(x.g.q/x.g.l*100)+'%</td><td>'+Math.round(x.m.q/x.m.l*100)+'%</td></tr>'; }));
    else { const mn=function(m){ return new Date(m+'-01T00:00:00Z').toLocaleString('en-IN',{month:'short',timeZone:'UTC'}); };
      body=maTable(['Project'].concat(d.trend.months.map(mn)),d.trend.list.map(function(x){ return '<tr><td>'+esc(x.p)+(x.v&&x.v.real?' <span class="ma-b '+(x.v.z<0?'bad':'good')+'">'+(x.v.z<0?'falling':'rising')+'</span>':'')+'</td>'
        +x.mm.map(function(c){ return '<td'+(c.set?'':' style="color:#94a3b8" title="still settling"')+'>'+(c.l?Math.round(c.q/c.l*100)+'%':'—')+'<div class="ma-sub">'+obNum(c.l)+'</div></td>'; }).join('')+'</tr>'; })); }
    return maHead('fa-solid fa-ranking-star','','Lead quality',
        'What a qualified lead, site visit or booking costs, from the CRM, over a window that ends 21 days ago (the CRM qualifies leads late). Each campaign’s QL rate is a Beta posterior pulled toward its project’s rate (worth 30 leads), so a few lucky leads cannot top the list; ranges are 80% credible intervals. "Chance cheapest in project" = share of 3,000 simulated draws in which the campaign had its project2019s lowest cost per QL (projects sell different things, so they are not ranked against each other). Quality trend: latest settled month vs the 3 before (two-proportion z-test, 95%).',
        '<span style="margin-left:auto"></span>'+(MA.qtab==='trend'?'':win))
      +'<div style="margin:0 0 12px">'+tabs+'</div>'+body; }});

// ================================================================ 5. CREATIVE PERFORMANCE
/* Which ad in each running campaign really brings leads cheapest (16 Nov 2026, "consider all - don't exclude any").
   Per ad, last 30 days: leads ~ Poisson(rate x spend), rate ~ Gamma(2 + leads, 2/campaign-rate + spend) - a Gamma-
   Poisson posterior pulled toward its campaign's own rate, so an ad with little spend cannot look like a winner by luck.
   3,000 draws per campaign give each ad's chance of being the cheapest per lead; 80% ranges for its cost per lead. */
function maCreativeData(){
  const D=MA_D, X=MA_X; if(!X||!X.ads) return {na:true,list:[]};
  const y=obAdd(D.today,-1), a0=obAdd(D.today,-30), by={};
  X.ads.forEach(function(r){ if(r.day<a0||r.day>y) return; const c=D.camp[r.campaign_id]; if(!c||!caLive(c.status)) return; const e=D.E['ad:'+r.ad_id]; if(!e||!caLive(e.status)) return;
    const lead=c.platform==='google'?(r.form_leads!=null?+r.form_leads:null):(c.lead?+r.results||0:null); if(lead==null) return;
    const g=by[c.id]=by[c.id]||{c:c,ads:{}}, a=g.ads[r.ad_id]=g.ads[r.ad_id]||{id:r.ad_id,name:e.name||r.ad_id,s:0,l:0,i:0,k:0};
    a.s+=+r.spend||0; a.l+=lead; a.i+=+r.impressions||0; a.k+=+r.clicks||0; });
  MA_SEED=31; const list=[];
  Object.keys(by).forEach(function(cid){ const g=by[cid], ads=Object.keys(g.ads).map(function(k){ return g.ads[k]; }).filter(function(a){ return a.s>=1000; });
    if(ads.length<2) return; const S=ads.reduce(function(s,a){ return s+a.s; },0), L=ads.reduce(function(s,a){ return s+a.l; },0); if(L<10) return;
    const r0=L/S, wins=ads.map(function(){ return 0; }), dr=ads.map(function(){ return []; });
    for(let t=0;t<3000;t++){ let bi=0,bv=Infinity; ads.forEach(function(a,i){ const rate=maRGamma(2+a.l)/(2/r0+a.s), cpl=1/rate; dr[i].push(cpl); if(cpl<bv){ bv=cpl; bi=i; } }); wins[bi]++; }
    ads.forEach(function(a,i){ a.pBest=wins[i]/3000; a.cpl=maPctl(dr[i],0.5); a.lo=maPctl(dr[i],0.1); a.hi=maPctl(dr[i],0.9); a.raw=a.l?a.s/a.l:null; a.ctr=a.i?a.k/a.i:null; });
    ads.sort(function(a,b){ return a.cpl-b.cpl; });
    const best=ads[0], weak=ads.filter(function(a){ return a!==best&&a.pBest<0.05&&a.cpl>1.5*best.cpl&&a.s>=3000; });
    list.push({c:g.c,ads:ads,best:best,clear:best.pBest>=0.8,weak:weak,s:S}); });
  list.sort(function(a,b){ return (b.clear?1:0)-(a.clear?1:0)||b.s-a.s; });
  return {list:list};
}
maReg({id:'creative',title:'Creative performance',icon:'fa-solid fa-photo-film',data:maCreativeData,ready:maXReady,
  card:function(d){ if(d.na) return {val:'—',sub:'ad-level data not available'}; const clear=d.list.filter(function(x){ return x.clear; }), weak=d.list.reduce(function(s,x){ return s+x.weak.length; },0);
    return clear.length?{val:clear.length+' clear winner'+(clear.length===1?'':'s'),sub:weak?weak+' ad'+(weak===1?'':'s')+' costing 1.5×+ the winner in the same campaign':'among '+d.list.length+' campaigns with several ads',tone:weak?'warn':null}:{val:'No clear winner',sub:'ads within each campaign perform about the same'}; },
  /* ONLY WHAT TO ACT ON (16 Nov 2026, Ayush: "too noisy ... I just want the Clear Winners and those whose Budgets need to
     move"): one row per campaign that has a clear winner or an ad to move money out of; nothing else. */
  view:function(d){ const act=d.list.filter(function(x){ return x.clear||x.weak.length; });
    let gain=0; const rows=act.map(function(x){ const w=x.best, g=x.weak.reduce(function(s,a){ return s+a.s*(1/w.cpl-1/a.cpl); },0); gain+=g;
      return '<tr><td class="ma-n">'+maPlat(x.c.platform)+' '+esc(x.c.name)+'<div class="ma-sub">'+esc(x.c.project)+'</div></td>'
        +'<td class="ma-n"><b>'+esc(w.name)+'</b><div class="ma-sub">'+obMoney(w.cpl)+' per lead · '+Math.round(w.pBest*100)+'% sure it is the best</div></td>'
        +'<td class="ma-n">'+(x.weak.length?x.weak.map(function(a){ return esc(a.name)+'<div class="ma-sub">'+obMoney(a.cpl)+' per lead · '+obMoney(a.s)+' spent in 30 days</div>'; }).join('<div style="height:6px"></div>'):'<span class="ma-sub">—</span>')+'</td>'
        +'<td>'+(g>0.5?'<b class="ma-up">+'+obNum(Math.round(g))+'</b>':'—')+'</td></tr>'; });
    return maHead('fa-solid fa-photo-film','','Creative performance',
        'Only campaigns where one ad is clearly the cheapest per lead (80%+ sure) or where an ad should give its budget to that winner (under 5% chance of being best, 1.5×+ the winner’s cost per lead, ₹3,000+ spent). Ads compared within their own campaign over the last 30 days; each ad’s lead rate is a Gamma-Poisson posterior pulled toward its campaign, so a little-spent ad cannot look best by luck. "More leads" = the moved ads’ 30-day spend at the winner’s cost per lead instead of theirs - an upper estimate, as the winner may get dearer with more money.')
      +(act.length?'<div class="ma-card" style="font-size:14px">'+act.filter(function(x){ return x.clear; }).length+' campaigns have a clear winning ad. Moving the weaker ads’ money to their campaign’s winner would bring about <b>'+obNum(Math.round(gain))+' more leads a month</b> for the same spend.</div>'
        +maTable(['Campaign','Winning ad - give it more','Move budget away from','More leads / month'],rows)
        :'<div class="ma-card">No campaign has a clear winning ad or an ad worth moving money out of right now.</div>'); }});
