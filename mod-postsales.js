async function psaFetchAll(){
  try{
    const {data,error}=await sb.schema('postsales').from('adhoc_docs').select('*').order('created_at',{ascending:false});
    if(error||!data) return [];
    return data.map(function(d){
      return {
        id:d.id,name:d.file_name,size:d.size_bytes||0,count:d.replacements_count||0,
        status:d.status,error:d.error_text||'',
        ts:d.created_at?new Date(d.created_at).getTime():Date.now(),
        s3Path:d.s3_path||null,uploadedBy:d.uploaded_by||'',blob:null
      };
    });
  }catch(e){ return []; }
}
VIEWS.postsales=async function(v,seg){
  setCrumb(['Sales','Post Sales']);
  // The old MIS tab (built by hand from Farvision files) was retired 02-Oct-2026 - the MIS Report now
  // lives under Reports and is built from Post Sales data. An old #/mis link lands on Bookings.
  const tabs=[['bookings','Bookings'],['invoices','Invoices'],['receipts','Receipts'],['reports','Reports'],['adhoc','Contracted Extra Charges'],['setup','Setup']];
  const tab=tabs.some(function(t){return t[0]===(seg&&seg[0]);})?seg[0]:'bookings';
  // One body div per tab rather than one shared one: they are rendered by different code
  // that each look up their own host by id, and a shared id would have them fighting over it.
  const bodyId={setup:'pssBody',bookings:'psbBody',receipts:'psrBody',invoices:'psiBody',reports:'psrpBodyHost'}[tab]||'psaBody';
  v.innerHTML=mHead('fa-headset','#7e22ce','Post Sales')
    +'<div class="tabs" style="margin-top:14px">'+tabs.map(function(t){return '<div class="tab '+(tab===t[0]?'active':'')+'" onclick="navTo(\'postsales/'+t[0]+'\')">'+t[1]+'</div>';}).join('')+'</div>'
    +'<div id="'+bodyId+'" style="margin-top:16px"></div>';
  // Bookings and Setup (projects → towers → floors → flats, PLC, FRC, charges, parking, payment
  // plans) live in postsales.js - see PAGE_EXTRA_SCRIPT and docs/post-sales-spec.md.
  if(tab==='setup'||tab==='bookings'||tab==='receipts'||tab==='invoices'||tab==='reports'){
    const host=$(bodyId); if(!host) return;
    const fn={setup:window.pssRender,bookings:window.psbRender,receipts:window.psrRender,invoices:window.psiRender,reports:window.psrpRender}[tab];
    if(typeof fn!=='function'){ host.innerHTML='<div class="empty"><i class="fa-solid fa-triangle-exclamation"></i><div>Post Sales could not finish loading - refresh the page.</div></div>'; return; }
    await fn(host, seg.slice(1));
    return;
  }
  if(tab==='adhoc'){
    const host=$('psaBody'); if(host) loader(host);
    PSA.queue=await psaFetchAll();
    PSA.queue.forEach(function(r){ if(typeof r.id==='number'&&r.id>=PSA_SEQ) PSA_SEQ=r.id+1; });
    PSA.loaded=true;
    psaRender();
  }
};