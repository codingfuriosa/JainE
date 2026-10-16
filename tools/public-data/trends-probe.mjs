const UA='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
let cookie='';
const r0=await fetch('https://trends.google.com/trends/explore?geo=IN-WB&q=Dream%20Gurukul&hl=en-US',{headers:{'User-Agent':UA}});
const sc=r0.headers.getSetCookie(); cookie=sc.map(c=>c.split(';')[0]).join('; ');
console.log('home',r0.status,sc.map(c=>c.split('=')[0]));
await sleep(4000);
const req={comparisonItem:[{keyword:'Dream Gurukul',geo:'IN-WB',time:'today 12-m'},{keyword:'Madhyamgram flats',geo:'IN-WB',time:'today 12-m'}],category:0,property:''};
const r=await fetch('https://trends.google.com/trends/api/explore?hl=en-US&tz=-330&req='+encodeURIComponent(JSON.stringify(req)),{headers:{'User-Agent':UA,Cookie:cookie,Referer:'https://trends.google.com/trends/explore'}});
const t=await r.text(); console.log('explore',r.status,t.slice(0,800));
if(r.ok){ const j=JSON.parse(t.slice(t.indexOf('{'))); const w=j.widgets.find(w=>w.id==='TIMESERIES'); await sleep(4000);
 const r2=await fetch('https://trends.google.com/trends/api/widgetdata/multiline?hl=en-US&tz=-330&req='+encodeURIComponent(JSON.stringify(w.request))+'&token='+w.token,{headers:{'User-Agent':UA,Cookie:cookie}});
 const t2=await r2.text(); console.log('multiline',r2.status,t2.slice(0,1200)); }
