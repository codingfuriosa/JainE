import { legacyFetch } from '../market-valuation-direct/legacy-fetch.mjs';
import fs from 'fs';
const UA='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
const r=await legacyFetch('https://rera.wb.gov.in/district_project.php?dcode=0',{headers:{'User-Agent':UA}}); const t=await r.text();
fs.writeFileSync(process.env.TMPF,t);
console.log(r.status,t.length);
const rows=t.split(/<tr/i); console.log('rows',rows.length);
console.log(rows.slice(0,4).join('<tr').replace(/\s+/g,' ').slice(-2500));
console.log('JAIN/DREAM hits:', (t.match(/dream|jain/gi)||[]).length);
