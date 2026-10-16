import { legacyFetch } from '../market-valuation-direct/legacy-fetch.mjs';
import fs from 'fs';
const UA='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
const r=await legacyFetch('https://rera.wb.gov.in/project_details.php?procode='+process.argv[2],{headers:{'User-Agent':UA,'Referer':'https://rera.wb.gov.in/district_project.php?dcode=0'}}); const t=await r.text();
fs.writeFileSync(process.env.TEMP+'/rera_detail.html',t);
const body=t.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi,'').replace(/<[^>]+>/g,' | ').replace(/&nbsp;/g,' ').replace(/(\s*\|\s*)+/g,' | ');
const i=body.search(/Promoter|Project Name/i); console.log(r.status,t.length); console.log(body.slice(Math.max(0,i-200),i+5000));
