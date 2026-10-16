const UA='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
const t=await (await fetch('https://rera.wb.gov.in/district_project.php?dcode=0&page=rejected',{headers:{'User-Agent':UA}})).text();
const i=t.indexOf('<tbody'); console.log(t.length, t.slice(i,i+1500));
