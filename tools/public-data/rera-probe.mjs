import { legacyFetch } from '../market-valuation-direct/legacy-fetch.mjs';
const UA='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
const u=process.argv[2]||'https://rera.wb.gov.in/';
const r=await legacyFetch(u,{headers:{'User-Agent':UA}}); const t=await r.text();
console.log(r.status,r.url,t.length);
const links=[...t.matchAll(/href="([^"]+)"/g)].map(m=>m[1]).filter(h=>/proj|search|regist|district|promot/i.test(h));
console.log([...new Set(links)].slice(0,60).join('\n'));
