const UA='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
const urls=process.argv.slice(2);
for(const u of urls){ try{ const r=await fetch(u,{headers:{'User-Agent':UA,'Accept-Language':'en-IN,en;q=0.9'},redirect:'follow'}); const t=await r.text(); console.log('==',u,r.status,r.url,t.length); console.log(t.replace(/\s+/g,' ').slice(0,600)); }catch(e){ console.log('==',u,'ERR',e.cause?.code||e.message); } await new Promise(r=>setTimeout(r,3000)); }
