/* ============================ POST SALES — ADHOC bulk replace ============================
   Converted output files upload to S3 (postsales/adhoc/...) and the conversion record (file
   name, replacement count, uploader, timestamp) is stored in postsales.adhoc_docs — a shared,
   company-wide log: everyone with Post Sales access sees everyone else's conversions, not just
   their own, and can download/preview them anytime via a signed URL. Upload -> replace "adhoc"
   (any case) with "Contracted Extra Charges" in the browser (JSZip for .docx, pdf.js+pdf-lib for
   .pdf) -> upload the result to S3 -> record it -> preview (mammoth.js / embedded PDF) or
   download. */
let PSA_SEQ=1;
const PSA={queue:[],loaded:false};
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
function psaRender(){
  const host=$('psaBody'); if(!host)return;
  const rows=PSA.queue;
  const processed=rows.filter(function(r){return r.status==='done';}).length;
  const totalRepl=rows.reduce(function(s,r){return s+(r.count||0);},0);
  const failed=rows.filter(function(r){return r.status==='error';}).length;
  const kpis=mKpis([
    ['All Time',String(processed),'documents processed'],
    ['"ADHOC" Replaced',String(totalRepl),'to "Contracted Extra Charges" · all time'],
    ['Failed',String(failed),failed?'check & re-upload':'all clear',failed?'#dc2626':'#16a34a'],
  ]);
  const toolbar='<div class="toolbar psa-toolbar">'
    +'<div class="psa-hint"><i class="fa-solid fa-shield-halved"></i> Converted files are saved to a shared Post Sales folder — visible to everyone with Post Sales access, downloadable anytime. Removing a row deletes it for everyone (and from S3).</div>'
    +'<button class="btn" id="psaBulkDl" '+(rows.length?'':'disabled')+' onclick="psaDownloadAllZip()"><i class="fa-solid fa-file-zipper"></i> Download All'+(rows.length>1?' (ZIP)':'')+'</button>'
    +'<button class="btn btn-primary" onclick="psaUploadModal()"><i class="fa-solid fa-upload"></i> Upload Documents</button>'
    +'</div>';
  const body=rows.length?rows.map(psaRowHtml).join(''):'<tr><td colspan="6"><div class="empty"><i class="fa-regular fa-file-word"></i><div>No documents processed yet</div><button class="btn btn-primary btn-sm" style="margin-top:12px" onclick="psaUploadModal()"><i class="fa-solid fa-upload"></i> Upload documents</button></div></td></tr>';
  host.innerHTML=kpis+toolbar+'<div class="card psa-card"><div style="overflow-x:auto"><table class="tbl psa-tbl"><thead><tr>'
    +'<th>Document</th><th>Uploaded by</th><th>Replacements</th><th>Size</th><th>Status</th><th></th>'
    +'</tr></thead><tbody>'+body+'</tbody></table></div></div>';
}
function psaExt(name){return (String(name||'').split('.').pop()||'').toLowerCase();}
function psaRowHtml(r){
  const statusTag=r.status==='error'
    ? '<span class="tag t-red" title="'+esc(r.error||'Error')+'"><i class="fa-solid fa-circle-exclamation"></i> Error</span>'
    : '<span class="tag t-green"><i class="fa-solid fa-circle-check"></i> Ready</span>';
  const hasFile=!!(r.blob||r.s3Path);
  return '<tr>'
    +'<td><div style="display:flex;align-items:center;gap:9px"><i class="fa-solid '+(psaExt(r.name)==='pdf'?'fa-file-pdf" style="color:#dc2626;font-size:18px"':'fa-file-word" style="color:#2563eb;font-size:18px"')+'></i><div class="psa-fname" id="psaName_'+r.id+'" title="'+esc(r.name)+'">'+esc(r.name)+'</div><button class="btn btn-sm btn-ghost psa-rename-btn" title="Rename" onclick="psaRenameStart('+r.id+')"><i class="fa-solid fa-pen"></i></button></div></td>'
    +'<td class="psa-uploader" title="'+esc(r.uploadedBy||'')+'">'+esc((r.uploadedBy||'').split('@')[0]||'—')+'</td>'
    +'<td>'+(r.count?('<span class="tag t-blue">'+r.count+' replaced</span>'):'<span style="color:var(--slate)">—</span>')+'</td>'
    +'<td>'+fmtBytes(r.size)+'</td>'
    +'<td>'+statusTag+(r.status==='done'&&!hasFile?'<div class="psa-expired">Upload failed to save — re-upload</div>':'')+'</td>'
    +'<td class="psa-row-actions">'
      +(r.status==='done'&&hasFile?'<button class="btn btn-sm btn-ghost" title="Preview" onclick="psaPreview('+r.id+')"><i class="fa-solid fa-eye"></i></button>':'')
      +(r.status==='done'&&hasFile?'<button class="btn btn-sm btn-ghost" title="Download" onclick="psaDownloadOne('+r.id+')"><i class="fa-solid fa-download"></i></button>':'')
      +'<button class="btn btn-sm btn-ghost" title="Remove" onclick="psaRemove('+r.id+')"><i class="fa-solid fa-trash"></i></button>'
    +'</td></tr>';
}
function psaSplitExt(name){
  const s=String(name||''); const i=s.lastIndexOf('.');
  if(i<=0) return [s,'']; return [s.slice(0,i), s.slice(i)];
}
window.psaRenameStart=function(id){
  const r=psaFind(id); if(!r)return;
  const cell=$('psaName_'+id); if(!cell)return;
  const parts=psaSplitExt(r.name);
  cell.innerHTML='<input type="text" id="psaRenameInput_'+id+'" class="psa-rename-input" value="'+esc(parts[0])+'">'
    +'<span class="psa-rename-ext">'+esc(parts[1])+'</span>';
  const inp=$('psaRenameInput_'+id); if(!inp)return;
  inp.focus(); inp.select();
  inp.addEventListener('keydown',function(e){
    if(e.key==='Enter'){ e.preventDefault(); psaRenameSave(id); }
    else if(e.key==='Escape'){ e.preventDefault(); psaRender(); }
  });
  inp.addEventListener('blur',function(){ psaRenameSave(id); });
};
window.psaRenameSave=async function(id){
  const r=psaFind(id); if(!r){ psaRender(); return; }
  const inp=$('psaRenameInput_'+id);
  if(inp){
    const parts=psaSplitExt(r.name);
    const base=String(inp.value||'').trim();
    if(base){
      const newName=base+parts[1];
      r.name=newName;
      try{ await sb.schema('postsales').from('adhoc_docs').update({file_name:newName}).eq('id',id); }catch(e){}
    }
  }
  psaRender();
};
window.psaRemove=async function(id){
  const r=psaFind(id);
  PSA.queue=PSA.queue.filter(function(x){return x.id!==id;});
  psaRender();
  if(r){
    try{ await sb.schema('postsales').from('adhoc_docs').delete().eq('id',id); }catch(e){}
    if(r.s3Path) s3Delete(r.s3Path);
  }
};
function psaFind(id){ return PSA.queue.find(function(r){return r.id===id;}); }
async function psaGetBlob(r){
  if(r.blob) return r.blob;
  if(!r.s3Path) return null;
  try{
    const key=r.s3Path.slice(3);
    const {data,error}=await s3Sign('get',key);
    if(error||!data) return null;
    const resp=await fetch(data.url);
    if(!resp.ok) return null;
    const blob=await resp.blob();
    r.blob=blob;
    return blob;
  }catch(e){ return null; }
}
window.psaDownloadOne=async function(id){
  const r=psaFind(id); if(!r)return;
  const blob=await psaGetBlob(r);
  if(!blob){ toast('Could not retrieve this file','err'); return; }
  const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download=r.name; document.body.appendChild(a); a.click(); a.remove();
};
window.psaDownloadAllZip=async function(){
  const rows=PSA.queue.filter(function(r){return r.status==='done'&&(r.blob||r.s3Path);});
  if(!rows.length){toast('Nothing to download','warn');return;}
  if(rows.length===1){ psaDownloadOne(rows[0].id); return; }
  const JZ=await loadJSZip(); if(!JZ){toast('ZIP library failed to load','err');return;}
  const zip=new JZ(); const used={};
  for(const r of rows){
    const blob=await psaGetBlob(r); if(!blob)continue;
    let name=r.name;
    if(used[name]!=null){ used[name]++; name=name.replace(/(\.[^.]+)?$/,'_'+used[name]+'$1'); } else used[name]=0;
    zip.file(name,blob);
  }
  const out=await zip.generateAsync({type:'blob'});
  const a=document.createElement('a'); a.href=URL.createObjectURL(out); a.download='adhoc-contracted-extra-charges.zip'; document.body.appendChild(a); a.click(); a.remove();
};
window.psaPreview=async function(id){
  const r=psaFind(id); if(!r)return;
  openModal('<div class="modal-head"><h3><i class="fa-solid fa-eye"></i> '+esc(r.name)+'</h3><span class="x" onclick="closeModal()">&times;</span></div><div class="modal-body" id="psaPreviewBody" style="max-height:70vh;overflow:auto;padding:'+(psaExt(r.name)==='pdf'?'0':'')+'"><div class="loader"><div class="spin"></div></div></div><div class="modal-foot"><button class="btn" onclick="closeModal()">Close</button><button class="btn btn-primary" onclick="psaDownloadOne('+id+')"><i class="fa-solid fa-download"></i> Download</button></div>','lg');
  const el=$('psaPreviewBody'); if(!el)return;
  const blob=await psaGetBlob(r);
  if(!blob){ el.innerHTML='<div class="empty"><i class="fa-solid fa-triangle-exclamation"></i><div>Could not retrieve this file</div></div>'; return; }
  if(psaExt(r.name)==='pdf'){
    const url=URL.createObjectURL(blob);
    el.innerHTML='<embed src="'+url+'" type="application/pdf" style="width:100%;height:70vh;border:0">';
    return;
  }
  try{
    const MM=await loadMammoth();
    if(!MM){ el.innerHTML='<div class="empty"><i class="fa-regular fa-file-word"></i><div>Preview unavailable — download to view</div></div>'; return; }
    const buf=await blob.arrayBuffer();
    const result=await MM.convertToHtml({arrayBuffer:buf});
    el.innerHTML='<div class="psa-preview-doc">'+result.value+'</div>';
  }catch(e){ el.innerHTML='<div class="empty"><i class="fa-solid fa-triangle-exclamation"></i><div>Could not render preview</div></div>'; }
};
window.psaUploadModal=function(){
  openModal('<div class="modal-head"><h3><i class="fa-solid fa-upload"></i> Upload documents — Contracted Extra Charges</h3><span class="x" onclick="closeModal()">&times;</span></div>'
    +'<div class="modal-body frm">'
    +'<div class="dropzone" ondragover="event.preventDefault()" ondrop="psaDrop(event)" onclick="document.getElementById(\'psaFile\').click()"><i class="fa-solid fa-cloud-arrow-up"></i><div id="psaUpName">Drag & drop or click to select Word or PDF documents</div><div style="font-size:12px;margin-top:4px">.docx and .pdf · up to 500 at once · every "ADHOC" (any case) becomes "Contracted Extra Charges" · converted file is saved to your Post Sales S3 folder</div></div>'
    +'<input type="file" id="psaFile" class="hidden" multiple accept=".docx,.pdf" onchange="psaUpPick()">'
    +'<div id="psaUpList" style="margin-top:10px"></div>'
    +'</div>'
    +'<div class="modal-foot"><button class="btn" onclick="closeModal()">Cancel</button><button class="btn btn-primary" id="psaUpBtn" onclick="psaUploadStart()" disabled><i class="fa-solid fa-wand-magic-sparkles"></i> Process</button></div>','lg');
};
window.psaDrop=function(ev){
  ev.preventDefault();
  const dt=ev.dataTransfer; if(!dt||!dt.files||!dt.files.length)return;
  const inp=$('psaFile'); if(!inp)return;
  const buf=new DataTransfer();
  [...dt.files].forEach(function(f){buf.items.add(f);});
  inp.files=buf.files;
  window._psaWasDrop=true;
  psaUpPick();
};
window.psaUpPick=function(){
  const fs=[...$('psaFile').files];
  const supported=fs.filter(function(f){return /\.(docx|pdf)$/i.test(f.name);});
  const unsupported=fs.length-supported.length;
  $('psaUpName').textContent=fs.length?(fs.length+' file(s) selected'):'Drag & drop or click to select Word or PDF documents';
  let notes='';
  if(unsupported) notes+='<div class="tag t-red" style="margin-bottom:8px"><i class="fa-solid fa-triangle-exclamation"></i> '+unsupported+' file(s) are not .docx or .pdf and will be skipped</div>';
  $('psaUpList').innerHTML=notes;
  const btn=$('psaUpBtn'); if(btn) btn.disabled=!supported.length;
};
window.psaUploadStart=async function(){
  const fs=[...$('psaFile').files].filter(function(f){return /\.(docx|pdf)$/i.test(f.name);});
  if(!fs.length){toast('Select at least one .docx or .pdf file','err');return;}
  const btn=$('psaUpBtn'); btn.disabled=true;
  const listHost=$('psaUpList');
  let done=0, ok=0, fail=0;
  const total=fs.length;
  const renderProgress=function(current){
    if(!listHost)return;
    listHost.innerHTML='<div class="psa-progress"><div class="psa-progress-bar"><div class="psa-progress-fill" style="width:'+Math.round(done/total*100)+'%"></div></div>'
      +'<div class="psa-progress-label">Processing '+done+' of '+total+' — '+ok+' done'+(fail?(', '+fail+' failed'):'')+(current?('<br><span style="color:var(--slate)">'+esc(current)+'</span>'):'')+'</div></div>';
  };
  renderProgress('');
  const CONCURRENCY=4;
  let idx=0;
  async function worker(){
    while(idx<fs.length){
      const my=idx++; const f=fs[my];
      renderProgress(f.name);
      const rec={id:null,name:f.name,size:f.size,blob:null,count:0,status:'error',error:'',s3Path:null,uploadedBy:''};
      try{
        const out=await psaProcessOne(f);
        rec.blob=out.blob; rec.size=out.blob.size; rec.count=out.count; rec.status='done';
        ok++;
        try{
          const key=s3KeyForPostSalesAdhoc(f.name);
          const up=await uploadFileToS3(key,out.blob);
          if(up&&up.data&&up.data.path) rec.s3Path=up.data.path;
        }catch(e){ /* best-effort — row still usable for this session via the in-memory blob */ }
      }catch(e){ rec.error=String((e&&e.message)||e); fail++; }
      rec.ts=Date.now();
      try{
        const {data}=await sb.schema('postsales').from('adhoc_docs').insert({
          file_name:rec.name,s3_path:rec.s3Path,replacements_count:rec.count,
          size_bytes:rec.size,status:rec.status,error_text:rec.error||null
        }).select('id,uploaded_by,created_at').single();
        if(data){
          rec.id=data.id; rec.uploadedBy=data.uploaded_by||'';
          rec.ts=data.created_at?new Date(data.created_at).getTime():rec.ts;
        }
      }catch(e){ /* row still shows for this session even if the shared record failed to save */ }
      if(rec.id==null) rec.id=PSA_SEQ++;
      PSA.queue.unshift(rec);
      done++;
      renderProgress('');
    }
  }
  await Promise.all(Array.from({length:Math.min(CONCURRENCY,fs.length)},worker));
  toast(ok+' document'+(ok!==1?'s':'')+' processed'+(fail?(', '+fail+' failed'):''),fail?'warn':'ok');
  if(ok && window._psaWasDrop){ try{usageQueue('postsales.adhoc.bulk_drag_and_drop_upload','create',{count:ok});}catch(_e){} }
  window._psaWasDrop=false;
  closeModal();
  psaRender();
};
function psaReplaceInXml(xml){
  let count=0;
  const wordRe=/\badhoc\b/gi;
  const decode=function(s){return s.replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&apos;/g,"'").replace(/&amp;/g,'&');};
  const encode=function(s){return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');};
  const newXml=xml.replace(/<w:p\b[^>]*>[\s\S]*?<\/w:p>/g,function(pBlock){
    const tRe=/<w:t\b([^>]*)>([\s\S]*?)<\/w:t>/g;
    let m, matches=[];
    while((m=tRe.exec(pBlock))){ matches.push({attrs:m[1],inner:m[2],index:m.index,len:m[0].length}); }
    if(!matches.length)return pBlock;
    const combined=matches.map(function(x){return decode(x.inner);}).join('');
    wordRe.lastIndex=0;
    if(!wordRe.test(combined))return pBlock;
    wordRe.lastIndex=0;
    const localMatches=combined.match(wordRe)||[];
    count+=localMatches.length;
    const replaced=combined.replace(wordRe,'Contracted Extra Charges');
    let result='',cursor=0;
    matches.forEach(function(mt,i){
      result+=pBlock.slice(cursor,mt.index);
      let attrs=mt.attrs;
      if(!/xml:space=/.test(attrs)) attrs=attrs+' xml:space="preserve"';
      if(i===0) result+='<w:t'+attrs+'>'+encode(replaced)+'</w:t>';
      else result+='<w:t'+attrs+'></w:t>';
      cursor=mt.index+mt.len;
    });
    result+=pBlock.slice(cursor);
    return result;
  });
  return {xml:newXml,count:count};
}
async function psaProcessOne(file){
  return psaExt(file.name)==='pdf' ? psaProcessPdf(file) : psaProcessDocx(file);
}
async function psaProcessDocx(file){
  const JZ=await loadJSZip();
  if(!JZ) throw new Error('ZIP library failed to load');
  const buf=await file.arrayBuffer();
  const zip=await JZ.loadAsync(buf);
  const targets=Object.keys(zip.files).filter(function(p){return /^word\/(document|header\d*|footer\d*|footnotes|endnotes)\.xml$/.test(p);});
  let total=0;
  for(const path of targets){
    const xml=await zip.files[path].async('string');
    const out=psaReplaceInXml(xml);
    if(out.count){ zip.file(path,out.xml); total+=out.count; }
  }
  const blob=await zip.generateAsync({type:'blob',mimeType:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',compression:'DEFLATE'});
  return {blob:blob,count:total};
}
// PDF has no reflow like Word does, so "replacement" here is a visual redact + overlay:
// each pdf.js text item containing "adhoc" is whited out ENTIRELY and redrawn with the
// reconstructed string (original text, every "adhoc" occurrence replaced), using a bold or
// regular weight to match what the original item actually looked like (a bold "Adhoc" that
// got redrawn in plain Helvetica used to visibly lose its weight). When the longer replacement
// doesn't fit before a real neighboring item on the same row, it is NOT crammed in by shrinking
// the font (that reads as cramped/too-close text) — instead it word-wraps onto extra line(s)
// below, at the ORIGINAL font size, same as the line above; that wrapped text keeps the same
// bold/regular weight decision as the single-line case. Wrapping is only used when the space
// below is actually clear of real content; if something genuine is sitting there (so wrapping
// would draw over it), that's the one case font-shrink is still used as a fallback, since
// overwriting unrelated real content is worse than a slightly smaller word.
async function psaProcessPdf(file){
  const pdfjsLib=await loadPdfJs();
  const PDFLibMod=await loadPdfLib();
  if(!pdfjsLib||!PDFLibMod) throw new Error('PDF library failed to load');
  const buf=await file.arrayBuffer();
  const pdf=await pdfjsLib.getDocument({data:buf.slice(0)}).promise;
  const pdfDoc=await PDFLibMod.PDFDocument.load(buf);
  const fontRegular=await pdfDoc.embedFont(PDFLibMod.StandardFonts.Helvetica);
  const fontBold=await pdfDoc.embedFont(PDFLibMod.StandardFonts.HelveticaBold);
  const NEW_TEXT='Contracted Extra Charges';
  let total=0;
  const n=pdf.numPages;
  function isBoldItem(page,item){
    try{
      const fo=page.commonObjs.get(item.fontName);
      if(!fo)return false;
      if(fo.bold||fo.black)return true;
      const nm=String(fo.name||fo.fallbackName||'').toLowerCase();
      return /bold|black|semibold|heavy/.test(nm);
    }catch(e){ return false; }
  }
  function rowTolFor(a,b){ return Math.max(4,a*0.9,b*0.9); }
  function wrapToWidth(text,size,maxWidth,fnt){
    const words=text.split(' ');
    const lines=[]; let cur='';
    for(const w of words){
      const test=cur?cur+' '+w:w;
      if(!cur||fnt.widthOfTextAtSize(test,size)<=maxWidth){ cur=test; }
      else { lines.push(cur); cur=w; }
    }
    if(cur) lines.push(cur);
    return lines;
  }
  for(let i=1;i<=n;i++){
    const page=await pdf.getPage(i);
    const content=await page.getTextContent();
    const pdfPage=pdfDoc.getPage(i-1);
    const items=content.items;
    for(let idx=0;idx<items.length;idx++){
      const item=items[idx];
      const str=item.str||'';
      const matches=str.match(/adhoc/gi);
      if(!matches)continue;
      total+=matches.length;
      const newStr=str.replace(/adhoc/gi,NEW_TEXT);
      const font=isBoldItem(page,item)?fontBold:fontRegular;
      const tr=item.transform;
      const fontSize=Math.hypot(tr[2],tr[3])||10;
      const x0=tr[4];
      const y0=tr[5];
      const oldW=item.width||font.widthOfTextAtSize(str,fontSize);
      // nearest real text item to the right on the same visual row — caps how wide we can safely draw
      let limitX=null;
      for(let j=0;j<items.length;j++){
        if(j===idx)continue;
        const o=items[j];
        if(!o.str||!o.str.trim())continue;
        const otr=o.transform;
        const oFontSize=Math.hypot(otr[2],otr[3])||fontSize;
        if(Math.abs(otr[5]-y0)>rowTolFor(fontSize,oFontSize))continue;
        if(otr[4]<=x0)continue;
        if(limitX===null||otr[4]<limitX) limitX=otr[4];
      }
      const requiredGap=Math.max(15,fontSize*2.2);
      const budget=limitX!==null?Math.max(oldW,(limitX-x0)-requiredGap):oldW*5;
      const fullW=font.widthOfTextAtSize(newStr,fontSize);
      const lineHeight=fontSize*1.25;
      let size=fontSize, lines=[newStr];
      if(fullW>budget){
        const wrapped=wrapToWidth(newStr,fontSize,budget,font);
        // always prefer wrapping at the ORIGINAL font size over shrinking — the only time that's
        // not possible is an unbreakable single word wider than the budget, with no space to wrap on
        if(wrapped.length>1){ lines=wrapped; }
        else { size=Math.max(fontSize*0.45,fontSize*(budget/fullW)); lines=[newStr]; }
      }
      const maxLineW=Math.max(oldW, lines.reduce(function(m,l){return Math.max(m,font.widthOfTextAtSize(l,size));},0));
      const rectTop=y0+fontSize*0.95;
      const rectBottom=y0-fontSize*0.28-lineHeight*(lines.length-1);
      pdfPage.drawRectangle({x:x0-1,y:rectBottom,width:maxLineW+2,height:rectTop-rectBottom,color:PDFLibMod.rgb(1,1,1)});
      lines.forEach(function(ln,k){
        pdfPage.drawText(ln,{x:x0,y:y0-lineHeight*k,size:size,font:font,color:PDFLibMod.rgb(0,0,0)});
      });
    }
  }
  const outBytes=await pdfDoc.save();
  const blob=new Blob([outBytes],{type:'application/pdf'});
  return {blob:blob,count:total};
}

VIEWS.inventory=async function(v,seg){
  setCrumb(['Operations','Inventory']);
  const isAdmin=typeof window.pusIsAdmin==='function'&&await window.pusIsAdmin();
  const tabs=['Setup','Vendors','Indents','RFQ & Quotes','Purchase orders','Stores','Stock & reports'].concat(isAdmin?['Admin']:[]);const ti=mTab(seg,tabs.length);
  if(ti===0){
    // Purchase & Stores setup (items, groups, UOM, warehouses, legal entities) lives in purchase.js -
    // see PAGE_EXTRA_SCRIPT and docs/purchase-stores-spec.md.
    v.innerHTML=mHead('fa-boxes-stacked','#0f766e','Inventory & Procurement')+mTabs('inventory',tabs,ti)+'<div id="pusBody" style="margin-top:16px"></div>';
    const host=$('pusBody');
    if(typeof window.pusRender!=='function'){ host.innerHTML='<div class="empty"><i class="fa-solid fa-triangle-exclamation"></i><div>Purchase setup could not finish loading - refresh the page.</div></div>'; return; }
    await window.pusRender(host,seg.slice(1));
    return;
  }
  if(ti===1){
    // Vendor enlistment (Stage 2) - also in purchase.js.
    v.innerHTML=mHead('fa-boxes-stacked','#0f766e','Inventory & Procurement')+mTabs('inventory',tabs,ti)+'<div id="pusBody" style="margin-top:16px"></div>';
    const host=$('pusBody');
    if(typeof window.pusVendorRender!=='function'){ host.innerHTML='<div class="empty"><i class="fa-solid fa-triangle-exclamation"></i><div>Vendors could not finish loading - refresh the page.</div></div>'; return; }
    await window.pusVendorRender(host);
    return;
  }
  if(ti===2){
    // Indents and their approval (Stage 3) - purchase-indent.js.
    v.innerHTML=mHead('fa-boxes-stacked','#0f766e','Inventory & Procurement')+mTabs('inventory',tabs,ti)+'<div id="pusBody" style="margin-top:16px"></div>';
    const host=$('pusBody');
    if(typeof window.pusIndentRender!=='function'){ host.innerHTML='<div class="empty"><i class="fa-solid fa-triangle-exclamation"></i><div>Indents could not finish loading - refresh the page.</div></div>'; return; }
    await window.pusIndentRender(host,seg.slice(1));
    return;
  }
  if(ti===7){
    // Purchase administrators only (approvers, warehouses, legal entities, who the administrators are) -
    // the tab is only listed for them, and the database refuses these writes to anyone else.
    v.innerHTML=mHead('fa-boxes-stacked','#0f766e','Inventory & Procurement')+mTabs('inventory',tabs,ti)+'<div id="pusBody" style="margin-top:16px"></div>';
    await window.pusRender($('pusBody'),seg.slice(1),'admin');
    return;
  }
  if(ti===3){
    // RFQs and quotations (Stage 4) - purchase-rfq.js.
    v.innerHTML=mHead('fa-boxes-stacked','#0f766e','Inventory & Procurement')+mTabs('inventory',tabs,ti)+'<div id="pusBody" style="margin-top:16px"></div>';
    const host=$('pusBody');
    if(typeof window.pusRfqRender!=='function'){ host.innerHTML='<div class="empty"><i class="fa-solid fa-triangle-exclamation"></i><div>RFQs could not finish loading - refresh the page.</div></div>'; return; }
    await window.pusRfqRender(host,seg.slice(1));
    return;
  }
  if(ti===4){
    // Purchase orders (Stage 5) - purchase-po.js.
    v.innerHTML=mHead('fa-boxes-stacked','#0f766e','Inventory & Procurement')+mTabs('inventory',tabs,ti)+'<div id="pusBody" style="margin-top:16px"></div>';
    const host=$('pusBody');
    if(typeof window.pusPoRender!=='function'){ host.innerHTML='<div class="empty"><i class="fa-solid fa-triangle-exclamation"></i><div>Purchase orders could not finish loading - refresh the page.</div></div>'; return; }
    await window.pusPoRender(host,seg.slice(1));
    return;
  }
  if(ti===5){
    // Stores (Stage 6): GRN, returns, issues, adjustments, transfers - purchase-stores.js.
    v.innerHTML=mHead('fa-boxes-stacked','#0f766e','Inventory & Procurement')+mTabs('inventory',tabs,ti)+'<div id="pusBody" style="margin-top:16px"></div>';
    const host=$('pusBody');
    if(typeof window.pusStoresRender!=='function'){ host.innerHTML='<div class="empty"><i class="fa-solid fa-triangle-exclamation"></i><div>Stores could not finish loading - refresh the page.</div></div>'; return; }
    await window.pusStoresRender(host,seg.slice(1));
    return;
  }
  if(ti===6){
    // Stock ledger and current stock (Stage 6) - purchase-stores.js.
    v.innerHTML=mHead('fa-boxes-stacked','#0f766e','Inventory & Procurement')+mTabs('inventory',tabs,ti)+'<div id="pusBody" style="margin-top:16px"></div>';
    const host=$('pusBody');
    if(typeof window.pusLedgerRender!=='function'){ host.innerHTML='<div class="empty"><i class="fa-solid fa-triangle-exclamation"></i><div>The stock ledger could not finish loading - refresh the page.</div></div>'; return; }
    await window.pusLedgerRender(host,seg.slice(1));
    return;
  }
};

