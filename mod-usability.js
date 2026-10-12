function usbBandBar(rows){
  const total=rows.length||1;
  return '<div style="display:flex;height:8px;border-radius:5px;overflow:hidden;background:#f1f5f9">'
    +USB_BANDS.map(function(b){
        const n=rows.filter(function(r){return r.band===b[0];}).length;
        return n?'<div title="'+esc(b[0]+': '+n)+'" style="width:'+(n*100/total)+'%;background:'+b[1]+'"></div>':'';
      }).join('')
  +'</div>';
}
function usbBandChips(rows){
  return '<div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:8px">'
    +USB_BANDS.map(function(b){
        const n=rows.filter(function(r){return r.band===b[0];}).length;
        const s=usbBandStyle(b[0]);
        return '<span class="badge" style="background:'+s.bg+';color:'+s.ink+'">'+esc(b[0])+' '+n+'</span>';
      }).join('')
  +'</div>';
}
function usbModuleGridHtml(){
  const rows=USB.rows||[];
  const by={};
  rows.forEach(function(r){ (by[r.module_id]=by[r.module_id]||{label:r.module_label,rows:[]}).rows.push(r); });
  const mods=Object.keys(by).sort(function(a,b){ return by[a].label.localeCompare(by[b].label); });
  if(!mods.length)return '<div class="card card-pad empty" style="margin-top:16px;padding:40px"><i class="fa-solid fa-chart-simple"></i><div>No features registered yet</div></div>';
  return '<div class="grid" style="grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:14px;margin-top:16px">'
    +mods.map(function(id){
      const g=by[id], uses=g.rows.reduce(function(a,r){return a+Number(r.uses||0);},0);
      const used=g.rows.filter(function(r){return Number(r.uses||0)>0;}).length;
      return '<div class="card card-pad" style="cursor:pointer" onclick="navTo(\'usability/'+encodeURIComponent(id)+'\')">'
        +'<div style="display:flex;justify-content:space-between;align-items:baseline;gap:8px">'
          +'<div style="font-weight:700;font-size:14px">'+esc(g.label)+'</div>'
          +'<div style="font-size:18px;font-weight:800;color:'+(uses?'#0f766e':'var(--slate)')+'">'+uses.toLocaleString('en-IN')+'</div>'
        +'</div>'
        +'<div style="font-size:12px;color:var(--slate);margin:2px 0 10px">'+used+' of '+g.rows.length+' features used · '+uses.toLocaleString('en-IN')+' use'+(uses===1?'':'s')+'</div>'
        +usbBandBar(g.rows)+usbBandChips(g.rows)
      +'</div>';
    }).join('')
  +'</div>';
}
VIEWS.usability=async function(v,seg){
  setCrumb(['Administration','Usability']);
  loader(v);
  await usbLoad();
  if(USB.rows===null){
    v.innerHTML=mHead('fa-chart-simple','#7c3aed','Usability')
      +'<div class="card card-pad empty" style="margin-top:16px;padding:40px"><i class="fa-solid fa-lock"></i>'
      +'<div>'+esc(USB.err||'Could not load usage')+'</div></div>';
    return;
  }
  const moduleId=seg&&seg[0]?decodeURIComponent(seg[0]):null;
  USB.moduleId=moduleId;
  if(moduleId){ v.innerHTML=mHead('fa-chart-simple','#7c3aed','Usability')+'<div id="usbDetailWrap">'+usbModuleDetailHtml(moduleId)+'</div>'; return; }
  const rows=USB.rows;
  const totalUses=rows.reduce(function(a,r){return a+Number(r.uses||0);},0);
  const used=rows.filter(function(r){return Number(r.uses||0)>0;}).length;
  /* Said plainly rather than left to be inferred from a screen of zeros: until the portal reports
     what people click, every feature here reads Inactive because nothing has been recorded, which
     is not the same as nobody using it. */
  const notice=totalUses===0
    ? '<div class="card card-pad" style="margin-top:14px;background:#fffbeb;border-color:#fde68a;font-size:13.5px">'
      +'<i class="fa-solid fa-circle-info" style="color:#b45309"></i> <b>No usage has been recorded yet.</b> '
      +'Every feature reads Inactive because nothing has been logged — not because nobody is using it. '
      +'The catalogue below is complete and the counts will fill in once the portal starts reporting what people open.</div>'
    : '';
  v.innerHTML=mHead('fa-chart-simple','#7c3aed','Usability')
    +'<div class="card card-pad" style="margin-top:14px;background:#faf5ff;border-color:#e9d5ff;font-size:13.5px">'
      +'<i class="fa-solid fa-chart-simple" style="color:#7c3aed"></i> Which parts of the portal are actually being used. '
      +'<b>'+used+'</b> of <b>'+rows.length+'</b> features used in this period · <b>'+totalUses.toLocaleString('en-IN')+'</b> total uses.</div>'
    +notice
    +usbControlsHtml()
    +usbModuleGridHtml();
};