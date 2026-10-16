const UA='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
async function rpc(svc, req){
  const r=await fetch(`https://adstransparency.google.com/anji/_/rpc/${svc}?authuser=`,{method:'POST',headers:{'User-Agent':UA,'Content-Type':'application/x-www-form-urlencoded','Origin':'https://adstransparency.google.com','Referer':'https://adstransparency.google.com/?region=IN'},body:'f.req='+encodeURIComponent(JSON.stringify(req))});
  return [r.status, await r.text()];
}
const [s,t]=await rpc('SearchService/SearchCreatives',{"2":40,"3":{"8":[2356],"12":{"1":"thejaingroup.com","2":true}},"7":{"1":1,"2":0,"3":2356}});
console.log(s,t.slice(0,4000));
