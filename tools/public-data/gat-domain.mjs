const UA='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
for(const d of process.argv.slice(2)){
  const r=await fetch('https://adstransparency.google.com/anji/_/rpc/SearchService/SearchCreatives?authuser=',{method:'POST',headers:{'User-Agent':UA,'Content-Type':'application/x-www-form-urlencoded'},body:'f.req='+encodeURIComponent(JSON.stringify({"2":40,"3":{"8":[2356],"12":{"1":d,"2":true}},"7":{"1":1,"2":0,"3":2356}}))});
  const j=await r.json(); const advs={}; for(const c of j["1"]||[]){const k=c["12"]+' ['+c["1"]+']'; advs[k]=(advs[k]||0)+1;}
  console.log(d, r.status, JSON.stringify(advs), 'more:', !!j["2"]); await sleep(4000);
}
