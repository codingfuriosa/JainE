const UA='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
for(const u of process.argv.slice(2)){ try{ const r=await fetch(u,{headers:{'User-Agent':UA,'Accept':'text/html,application/xhtml+xml','Accept-Language':'en-IN,en;q=0.9'}}); const t=await r.text();
 const title=(t.match(/<title[^>]*>([^<]*)/i)||[])[1];
 const ld=(t.match(/application\/ld\+json/g)||[]).length; const nd=/__NEXT_DATA__|__INITIAL_STATE__|window\.__PRELOADED_STATE__/.test(t);
 const price=(t.match(/(?:₹|Rs\.?)\s?[\d,.]+\s?(?:L|Lac|Cr|K)?[^<]{0,30}(?:sq\.?\s?ft|sqft)/i)||[])[0];
 const captcha=/captcha|access denied|are you a robot|akamai|perimeterx|cf-chl/i.test(t);
 console.log('==',u,'\n  ',r.status,r.url.slice(0,120),'len',t.length,'| title:',title&&title.trim().slice(0,100),'| ld+json',ld,'| state blob',nd,'| price/sqft',price,'| block-signs',captcha);
 if(u.endsWith('robots.txt')) console.log(t.split('\n').filter(l=>/disallow|user-agent: \*/i.test(l)).slice(0,12).join('\n'));
}catch(e){console.log('==',u,'ERR',e.cause?.code||e.message);} await sleep(5000);}
