import { legacyFetch } from '../market-valuation-direct/legacy-fetch.mjs';
const UA='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
const r=await legacyFetch('https://rera.wb.gov.in/',{headers:{'User-Agent':UA}}); const t=await r.text();
console.log([...new Set([...t.matchAll(/href="([^"#]+)"/g)].map(m=>m[1]).filter(h=>!/^http|pdf|css|^img/i.test(h)))].join('\n'));
