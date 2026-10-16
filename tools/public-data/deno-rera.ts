const UA='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
try{ const r=await fetch('https://rera.wb.gov.in/project_details.php?procode=13461000000001',{headers:{'User-Agent':UA}}); const t=await r.text(); console.log('deno rera',r.status,t.length,/Dream Gateway Hotels/i.test(t)); }catch(e){ console.log('deno rera ERR',String(e)); }
