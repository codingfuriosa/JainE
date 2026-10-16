const UA='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
for(const q of process.argv.slice(2)){
  const r=await fetch('https://adstransparency.google.com/anji/_/rpc/SearchService/SearchSuggestions?authuser=',{method:'POST',headers:{'User-Agent':UA,'Content-Type':'application/x-www-form-urlencoded'},body:'f.req='+encodeURIComponent(JSON.stringify({"1":q,"2":10,"3":10}))});
  const j=await r.json(); const out=(j["1"]||[]).map(s=>s["1"]?`ADV ${s["1"]["1"]} [${s["1"]["2"]}] ${s["1"]["3"]} ads~${s["1"]["4"]?.["2"]?.["1"]??'?'}`:`DOMAIN ${s["2"]["1"]}`);
  console.log('## '+q+'\n  '+out.join('\n  ')); await sleep(4000);
}
