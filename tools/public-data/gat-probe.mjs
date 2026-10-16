const UA='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
async function rpc(svc, req){
  const r=await fetch(`https://adstransparency.google.com/anji/_/rpc/${svc}?authuser=`,{method:'POST',headers:{'User-Agent':UA,'Content-Type':'application/x-www-form-urlencoded','Origin':'https://adstransparency.google.com','Referer':'https://adstransparency.google.com/?region=IN'},body:'f.req='+encodeURIComponent(JSON.stringify(req))});
  return [r.status, await r.text()];
}
const q=process.argv[2]||'Jain Group';
const [s,t]=await rpc('SearchService/SearchSuggestions',{"1":q,"2":10,"3":10});
console.log(s,t.slice(0,3000));
