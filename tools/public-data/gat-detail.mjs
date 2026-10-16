const UA='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
const r=await fetch('https://adstransparency.google.com/anji/_/rpc/LookupService/GetCreativeById?authuser=',{method:'POST',headers:{'User-Agent':UA,'Content-Type':'application/x-www-form-urlencoded'},body:'f.req='+encodeURIComponent(JSON.stringify({"1":"AR04991908941882458113","2":"CR17228813677822476289","5":{"1":1,"2":0,"3":2356}}))});
const t=await r.text(); console.log(r.status); console.log(t.slice(0,3500));
