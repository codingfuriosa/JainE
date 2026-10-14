/* ===== PROCUREMENT MODULE ===== */
const PROC={sel:new Set(),tab:'Quote Comp'};

async function procFetch(cat){
  const {data,error}=await sb.schema('doc').from('documents')
    .select('*').eq('department','Procurement').eq('category',cat)
    .order('created_at',{ascending:false});
  if(error){toast('Load failed: '+error.message,'err');return[];}
  return data||[];
}

function procRefresh(cat){
  const host=$('procHost');if(!host)return;
  procFetch(cat).then(docs=>{ host.innerHTML=procCardsHtml(docs,cat); procActionBar(cat); });
}

function procActionBar(cat){
  const bar=$('procBar');if(!bar)return;
  const n=PROC.sel.size;
  const dis='opacity:.38;cursor:not-allowed;pointer-events:none';
  bar.innerHTML=
    `<button class="btn btn-primary" onclick="procUploadModal('${cat}')"><i class="fa-solid fa-upload"></i> Upload</button>`+
    `<button class="btn" onclick="procDownloadSel()" ${n===0?'disabled':''} style="${n===0?dis:''}"><i class="fa-solid fa-download"></i> Download</button>`+
    `<button class="btn" onclick="procEditModal()" ${n!==1?'disabled':''} style="${n!==1?dis:''}" title="${n>1?'Select only one file to edit':'Edit selected'}"><i class="fa-solid fa-pen"></i> Edit</button>`+
    `<button class="btn" style="${n===0?dis:'color:var(--err)'}" ${n===0?'disabled':''} onclick="procDeleteSel('${cat}')"><i class="fa-solid fa-trash"></i> Delete</button>`+
    (n>0?`<span style="font-size:12px;color:var(--slate);margin-left:4px">${n} selected</span>`:'');
}

function procCardsHtml(docs,cat){
  if(!docs.length)return '<div class="empty" style="padding:48px;text-align:center;color:var(--slate)"><i class="fa-solid fa-file-circle-plus" style="font-size:32px;margin-bottom:12px;display:block"></i>No sheets yet — upload one</div>';
  return '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:16px;padding:4px 0">'+
    docs.map(d=>{
      const sel=PROC.sel.has(d.id);
      const ext=(d.file_name||'').split('.').pop().toLowerCase();
      return `<div class="proc-card${sel?' proc-sel':''}" onclick="procToggle(${d.id},'${cat}')" ondblclick="event.stopPropagation();docPreview(${d.id})" title="Click to select · Double-click to preview" style="border:2px solid ${sel?'var(--brand)':'var(--line)'};border-radius:12px;padding:16px 14px;cursor:pointer;position:relative;background:${sel?'#eff6ff':'var(--card)'}">
        <div style="position:absolute;top:10px;right:10px;width:18px;height:18px;border-radius:50%;border:2px solid ${sel?'var(--brand)':'var(--line)'};background:${sel?'var(--brand)':'transparent'};display:flex;align-items:center;justify-content:center">
          ${sel?'<i class="fa-solid fa-check" style="color:#fff;font-size:9px"></i>':''}
        </div>
        <div style="font-size:32px;margin-bottom:10px;text-align:center">${fileIcon(ext)||'<span style="font-size:32px">📄</span>'}</div>
        <div style="font-weight:600;font-size:13px;word-break:break-word;margin-bottom:4px">${esc(d.title||d.file_name)}</div>
        <div style="font-size:11px;color:var(--slate)">${fmtBytes(d.file_size)} · ${d.created_at?new Date(d.created_at).toLocaleDateString('en-IN',{day:'2-digit',month:'short',year:'numeric'}):''}</div>
      </div>`;
    }).join('')+'</div>';
}

window.procToggle=function(id,cat){
  if(PROC.sel.has(id))PROC.sel.delete(id);else PROC.sel.add(id);
  procRefresh(cat);
};

window.procDownloadSel=async function(){
  for(const id of PROC.sel){
    const d=await getDoc(id);if(!d||!d.storage_path)continue;
    if(isS3Path(d.storage_path)){ await s3OpenSigned(d.storage_path,d.file_name||'file'); continue; }
    const {data}=await sb.storage.from(bucketFor(d.department)).createSignedUrl(d.storage_path,120);
    if(data){const a=document.createElement('a');a.href=data.signedUrl;a.download=d.file_name||'file';document.body.appendChild(a);a.click();a.remove();}
  }
};

window.procDeleteSel=async function(cat){
  if(!PROC.sel.size)return;
  if(!await confirmDialog('Delete '+PROC.sel.size+' file(s)? This cannot be undone.'))return;
  for(const id of [...PROC.sel]){
    const d=await getDoc(id);if(!d)continue;
    if(d.storage_path){ if(isS3Path(d.storage_path)) await s3Delete(d.storage_path); else await sb.storage.from(bucketFor(d.department)).remove([d.storage_path]); }
    await sb.schema('doc').from('documents').delete().eq('id',id);
  }
  PROC.sel.clear();toast('Deleted','ok');procRefresh(cat);
};

window.procUploadModal=function(cat){
  openModal(`<div class="modal-head"><h3><i class="fa-solid fa-upload"></i> Upload Sheet</h3><span class="x" onclick="closeModal()">&times;</span></div>
    <div class="modal-body frm">
      <label>File(s)</label>
      <input type="file" id="procUpFile" multiple accept=".xlsx,.xls,.csv,.pdf,.doc,.docx,.ppt,.pptx,.png,.jpg,.jpeg">
      <label>Name <span style="color:var(--slate);font-weight:400">(optional — uses filename if blank)</span></label>
      <input id="procUpName" placeholder="Custom name…">
    </div>
    <div class="modal-foot">
      <button class="btn" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary" onclick="procUploadSave('${cat}')"><i class="fa-solid fa-upload"></i> Upload</button>
    </div>`,'');
};

window.procUploadSave=async function(cat){
  const files=[...(($('procUpFile')&&$('procUpFile').files)||[])];
  if(!files.length){toast('Select a file','err');return;}
  const customName=$('procUpName')&&$('procUpName').value.trim();
  let ok=0;
  for(const f of files){
    const key=s3KeyForDoc('Procurement',cat,f.name);
    const {data:upData,error:upErr}=await uploadFileToS3(key,f);
    if(upErr){toast('Upload failed: '+upErr.message,'err');continue;}
    const title=(files.length===1&&customName)||f.name.replace(/\.[^.]+$/,'');
    const {error}=await sb.schema('doc').from('documents').insert({title,department:'Procurement',category:cat,file_name:f.name,file_size:f.size,file_type:f.name.split('.').pop(),storage_path:upData.path,uploaded_by:state.email,visibility:'internal',status:'Active',confidential:false,version:'v1',tags:'',description:''});
    if(!error)ok++;
  }
  closeModal();if(ok)toast(ok+' sheet(s) uploaded','ok');procRefresh(cat);
};

window.procEditModal=async function(){
  if(PROC.sel.size!==1){toast('Select exactly one file to edit','err');return;}
  const id=[...PROC.sel][0];
  const d=await getDoc(id);if(!d)return;
  openModal(`<div class="modal-head"><h3><i class="fa-solid fa-pen"></i> Edit Sheet</h3><span class="x" onclick="closeModal()">&times;</span></div>
    <div class="modal-body frm">
      <label>Name</label>
      <input id="procEditName" value="${esc(d.title||d.file_name)}">
      <label>Replace file <span style="color:var(--slate);font-weight:400">(optional — leave blank to keep existing)</span></label>
      <input type="file" id="procEditFile" accept=".xlsx,.xls,.csv,.pdf,.doc,.docx,.ppt,.pptx,.png,.jpg,.jpeg">
    </div>
    <div class="modal-foot">
      <button class="btn" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary" onclick="procEditSave(${id},'${d.category}','${esc(d.storage_path||'')}','${esc(d.department||'')}')">Save</button>
    </div>`,'');
};

window.procEditSave=async function(id,cat,oldPath,dept){
  const newName=($('procEditName')&&$('procEditName').value.trim())||'';
  const file=$('procEditFile')&&$('procEditFile').files[0];
  let update={};
  if(newName)update.title=newName;
  if(file){
    const key=s3KeyForDoc(dept||'Procurement',cat,file.name);
    const {data:upData,error:upErr}=await uploadFileToS3(key,file);
    if(upErr){toast('Upload failed: '+upErr.message,'err');return;}
    update.storage_path=upData.path;update.file_name=file.name;update.file_size=file.size;update.file_type=file.name.split('.').pop();
    // Remove old file
    if(oldPath){ if(isS3Path(oldPath)) await s3Delete(oldPath); else await sb.storage.from('documents').remove([oldPath]); }
  }
  if(!Object.keys(update).length){closeModal();return;}
  const {error}=await sb.schema('doc').from('documents').update(update).eq('id',id);
  if(error){toast('Save failed: '+error.message,'err');return;}
  closeModal();PROC.sel.clear();toast('Updated','ok');procRefresh(cat);
};

