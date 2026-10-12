VIEWS.competitors=async function(v,seg){
  setCrumb(['Growth & Strategy','Competitor Ads']);
  v.innerHTML=mHead('fa-magnifying-glass-chart','#0369a1','Competitor Ads')
    +'<div style="display:flex;align-items:flex-start;gap:14px;flex-wrap:wrap;margin:-8px 0 16px">'
      +'<p style="color:var(--slate);margin:0;flex:1;min-width:240px;font-size:13px">Public ad creative from Meta\'s Ad Library — the creative itself, when it started and where it ran. Meta never publishes spend or reach for ordinary commercial ads.</p>'
      +'<div style="display:flex;gap:10px;flex-wrap:wrap">'
        +'<button class="btn" onclick="compAddModal()"><i class="fa-solid fa-plus"></i> Add Competitor</button>'
        +'<button class="btn btn-primary" id="compSyncBtn" onclick="compSyncFiltered()"><i class="fa-solid fa-rotate"></i> Fetch from Meta</button>'
      +'</div>'
    +'</div>'
    +'<div id="compToolbar"></div>'
    +'<div id="compBody"><div class="loader"><div class="spin"></div></div></div>';
  await compRender();
};
window.compAddModal=function(){
  openModal('<div class="modal-head"><h3><i class="fa-solid fa-plus"></i> Add Competitor</h3><span class="x" onclick="closeModal()">&times;</span></div>'
    +compFormHtml({})
    +'<div class="modal-foot"><button class="btn" onclick="closeModal()">Cancel</button><button class="btn btn-primary" onclick="compSave()"><i class="fa-solid fa-check"></i> Add</button></div>','md');
};