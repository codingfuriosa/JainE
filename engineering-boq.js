/* ===========================================================================
   JAIN-E · ENGINEERING — BOQ   [loads after engineering.js]
   A BOQ line = one activity at one location: the project (external work), a block, a floor,
   a flat, or a portion of a flat (bedroom, kitchen, bathroom ...). The "Add BOQ" form generates
   one line per location (e.g. Plastering × Block A1 × floors 1-7 × every flat × Bathroom).
   =========================================================================== */
(function(){
  if(typeof window.ENG==='undefined')return;
  const ENG=window.ENG;
  const {E,lc,num,inr,q,val,numOrNull,lvTag,LOAD,fail,run,fetchAll,chunk,head,modal,cancelBtn,opts,pager,projBar,curProject,loadTowers,loadGeo,actById,C}=ENG;
  const PAGE_SIZE=100;
  const PORTIONS=['Living / Dining','Master Bedroom','Bedroom 2','Bedroom 3','Kitchen','Bathroom','Toilet','Balcony','Utility / Wash area','Passage / Lobby'];
  const L=()=>ENG.L;
  const F=()=>(L().boqF=L().boqF||{tower:'',group:'',level:'',q:'',page:0});

  ENG.routes.boq=async function(v,a,t){
    const pid=curProject();
    v.innerHTML=head('boq','Bill of quantities — activities by location, ready to be tagged on work orders',
      pid?'<button class="btn btn-primary" onclick="ENG.f.boqForm()"><i class="fa-solid fa-plus"></i> Add BOQ</button>':'')+projBar(false)+'<div id="engBody">'+(pid?LOAD:'')+'</div>';
    if(!pid){
      $('engBody').innerHTML='<div class="card card-pad empty"><i class="fa-solid fa-list-ol"></i><div style="font-weight:600;color:var(--ink)">Pick a project</div><p>A BOQ is built per project — choose one above to see or add its lines.</p></div>';
      return;
    }
    const [towers,rows]=await Promise.all([loadTowers(pid),
      fetchAll(()=>E().from('v_boq').select('*').eq('project_id',pid).order('group_sort').order('activity_name').order('tower_sort').order('floor_no',{nullsFirst:true}).order('flat_code',{nullsFirst:true}).order('id'))]);
    if(ENG.stale(t))return;
    L().boqRows=rows;L().boqSel=new Set();L().boqF={tower:'',group:'',level:'',q:'',page:0};
    $('engBody').innerHTML=
      '<div class="eng-filter">'+
        '<div class="toolbar grow" style="margin:0;flex:1;min-width:200px"><div class="grow"><i class="fa-solid fa-magnifying-glass"></i><input id="boqQ" placeholder="Search activity or location…" oninput="ENG.f.boqFilter(\'q\',this.value)"></div></div>'+
        '<select class="sel" onchange="ENG.f.boqFilter(\'tower\',this.value)"><option value="">All locations</option><option value="P">Project level (external work)</option>'+opts(towers,x=>x.id,x=>x.name,'')+'</select>'+
        '<select class="sel" onchange="ENG.f.boqFilter(\'group\',this.value)">'+opts(C.groups,g=>g.id,g=>g.name,'','All activity groups')+'</select>'+
        '<select class="sel" onchange="ENG.f.boqFilter(\'level\',this.value)">'+opts(['Project','Block','Floor','Flat','Portion'],x=>x,x=>x,'','All levels')+'</select>'+
      '</div><div class="card eng-tbl"><div id="boqHead" class="card-pad" style="border-bottom:1px solid var(--line)"></div><div id="boqTable"></div></div>';
    ENG.f.boqRender();
  };

  function filtered(){
    const f=F(),qq=lc(f.q).trim();
    return (L().boqRows||[]).filter(r=>
      (!f.tower||(f.tower==='P'?r.tower_id==null:String(r.tower_id)===f.tower))&&
      (!f.group||String(r.group_id)===f.group)&&(!f.level||r.location_level===f.level)&&
      (!qq||lc(r.activity_name+' '+r.group_name+' '+r.location_label).indexOf(qq)>=0));
  }
  ENG.f.boqFilter=function(k,v){const f=F();f[k]=v;f.page=0;ENG.f.boqRender();};
  ENG.f.boqPage=function(p){F().page=p;ENG.f.boqRender();};
  ENG.f.boqRender=function(){
    const rows=filtered(),f=F(),sel=L().boqSel;
    const totalVal=rows.reduce((x,r)=>x+num(r.value),0),tagged=rows.filter(r=>num(r.tagged_qty)>0).length;
    const pageRows=rows.slice(f.page*PAGE_SIZE,(f.page+1)*PAGE_SIZE);
    const allOnPage=pageRows.length&&pageRows.every(r=>sel.has(r.id));
    $('boqHead').innerHTML=
      '<div style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap"><div class="eng-sum"><span><b>'+rows.length+'</b> line'+(rows.length===1?'':'s')+'</span><span>Value <b>'+inr(totalVal)+'</b></span><span><b>'+tagged+'</b> on work orders</span></div>'+
      '<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">'+
        (sel.size?'<span style="font-size:12.5px;color:var(--slate)">'+sel.size+' selected</span><button class="btn btn-sm btn-danger" onclick="ENG.f.boqDelSel()"><i class="fa-solid fa-trash"></i> Delete selected</button><button class="btn btn-sm" onclick="ENG.f.boqSelClear()">Clear</button>':
          (rows.length>PAGE_SIZE?'<button class="btn btn-sm" onclick="ENG.f.boqSelAll()">Select all '+rows.length+' matching</button>':''))+
      '</div></div>';
    $('boqTable').innerHTML=rows.length?
      '<table class="tbl"><thead><tr><th style="width:34px"><input type="checkbox" '+(allOnPage?'checked':'')+' onchange="ENG.f.boqTickPage(this.checked)"></th><th>Activity</th><th>Location</th><th class="r">Quantity</th><th class="r">Rate</th><th class="r">Value</th><th class="r">Tagged</th><th></th></tr></thead><tbody>'+
      pageRows.map(r=>{
        const tg=num(r.tagged_qty);
        return '<tr class="'+(sel.has(r.id)?'sel':'')+'"><td><input type="checkbox" '+(sel.has(r.id)?'checked':'')+' onchange="ENG.f.boqTick('+r.id+',this.checked)"></td>'+
          '<td><b>'+esc(r.activity_name)+'</b><div class="sub" style="font-size:12px;color:var(--slate)">'+esc(r.group_name)+'</div></td>'+
          '<td>'+lvTag(r.location_level)+' <span style="margin-left:4px">'+esc(r.location_label)+'</span></td>'+
          '<td class="r">'+q(r.qty)+' <span style="color:var(--slate)">'+esc(r.uom)+'</span></td><td class="r">'+inr(r.rate)+'</td><td class="r">'+inr(r.value)+'</td>'+
          '<td class="r">'+(tg>0?'<span class="tag '+(num(r.remaining_qty)<=0?'t-green':'t-amber')+'">'+q(tg)+' / '+q(r.qty)+'</span>':'<span style="color:var(--slate)">—</span>')+'</td>'+
          '<td style="white-space:nowrap;text-align:right"><button class="btn btn-sm" title="Edit" onclick="ENG.f.boqEdit('+r.id+')"><i class="fa-solid fa-pen"></i></button> <button class="btn btn-sm btn-danger" title="Delete" '+(tg>0?'disabled':'')+' onclick="ENG.f.boqDel('+r.id+')"><i class="fa-solid fa-trash"></i></button></td></tr>';
      }).join('')+'</tbody></table>'+pager(rows.length,f.page,PAGE_SIZE,'ENG.f.boqPage'):
      '<div class="empty" style="padding:40px"><i class="fa-solid fa-list-ol"></i><div style="font-weight:600;color:var(--ink)">'+((L().boqRows||[]).length?'No lines match these filters':'No BOQ yet for this project')+'</div>'+((L().boqRows||[]).length?'':'<p>Use <b>Add BOQ</b> to generate lines for an activity across blocks, floors, flats or portions.</p>')+'</div>';
  };
  ENG.f.boqTick=function(id,on){const s=L().boqSel;on?s.add(id):s.delete(id);ENG.f.boqRender();};
  ENG.f.boqTickPage=function(on){const f=F(),s=L().boqSel;filtered().slice(f.page*PAGE_SIZE,(f.page+1)*PAGE_SIZE).forEach(r=>on?s.add(r.id):s.delete(r.id));ENG.f.boqRender();};
  ENG.f.boqSelAll=function(){filtered().forEach(r=>L().boqSel.add(r.id));ENG.f.boqRender();};
  ENG.f.boqSelClear=function(){L().boqSel.clear();ENG.f.boqRender();};

  ENG.f.boqDelSel=async function(){
    const byId={};(L().boqRows||[]).forEach(r=>byId[r.id]=r);
    const ids=[...L().boqSel].filter(id=>byId[id]&&num(byId[id].tagged_qty)===0),skipped=L().boqSel.size-ids.length;
    if(!ids.length)return toast('None of the selected lines can be deleted — they are all on work orders.','warn');
    if(!await confirmDialog('Delete '+ids.length+' BOQ line'+(ids.length===1?'':'s')+'?'+(skipped?' '+skipped+' that are on work orders will be left alone.':''),{okLabel:'Delete'}))return;
    try{
      for(const c of chunk(ids,200)){const {error}=await E().from('boq_items').delete().in('id',c);if(error)throw error;}
      toast(ids.length+' line'+(ids.length===1?'':'s')+' deleted','ok');renderPage();
    }catch(e){fail(e);renderPage();}
  };
  ENG.f.boqDel=async function(id){
    if(!await confirmDialog('Delete this BOQ line?',{okLabel:'Delete'}))return;
    try{const {error}=await E().from('boq_items').delete().eq('id',id);if(error)throw error;toast('BOQ line deleted','ok');renderPage();}catch(e){fail(e);}
  };

  ENG.f.boqEdit=function(id){
    const r=(L().boqRows||[]).find(x=>x.id===id);if(!r)return;
    const tg=num(r.tagged_qty);
    modal('Edit BOQ line',
      '<div style="font-weight:600">'+esc(r.activity_name)+'</div><div style="color:var(--slate);font-size:13px;margin-top:2px">'+esc(r.location_label)+'</div>'+
      (tg>0?'<div class="eng-note" style="margin-top:10px">'+q(tg)+' '+esc(r.uom)+' of this line is already on work orders, so the quantity can’t go below that.</div>':'')+
      '<div class="two"><div><label>Quantity ('+esc(r.uom)+')</label><input id="beQty" type="number" min="0" step="0.001" value="'+num(r.qty)+'"></div><div><label>Estimated rate (₹)</label><input id="beRate" type="number" min="0" step="0.01" value="'+num(r.rate)+'"></div></div>'+
      '<label>Remarks <span style="color:var(--slate);font-weight:400">(optional)</span></label><input id="beRem" value="'+esc(r.remarks)+'">',
      cancelBtn+'<button class="btn btn-primary" onclick="ENG.f.boqEditSave(this,'+id+')"><i class="fa-solid fa-check"></i> Save</button>');
  };
  ENG.f.boqEditSave=function(btn,id){
    return run(btn,async()=>{
      const qty=numOrNull(val('beQty')),rate=numOrNull(val('beRate'));
      if(qty==null||isNaN(qty)||qty<=0)return toast('Enter a quantity above zero','warn');
      if(rate!=null&&(isNaN(rate)||rate<0))return toast('Enter a valid rate','warn');
      const {error}=await E().from('boq_items').update({qty:qty,rate:rate||0,remarks:val('beRem').trim()||null}).eq('id',id);
      if(error)throw error;
      closeModal();toast('BOQ line updated','ok');renderPage();
    });
  };

  /* ---------------------------------------------------------------- generator */
  const G={geo:null,pid:null};
  ENG.f.boqForm=async function(){
    const pid=curProject();if(!pid)return toast('Pick a project first','warn');
    G.pid=pid;G.geo=null;
    modal('Add BOQ — '+esc(ENG.projName(pid)),
      '<div class="two"><div><label>Activity group</label><select id="bgGroup" onchange="ENG.f.bgGroup()">'+opts(C.groups.filter(g=>g.active),g=>g.id,g=>g.name,'','Select a group…')+'</select></div>'+
      '<div><label>Activity</label><select id="bgAct" onchange="ENG.f.bgAct()"><option value="">Select a group first</option></select></div></div>'+
      '<label>Location level — where the work is measured</label><select id="bgLevel" onchange="ENG.f.bgLoc()">'+opts([['project','Project — external / common work'],['block','Block / tower'],['floor','Floor'],['flat','Flat'],['portion','Portion of a flat (bedroom, kitchen, bathroom…)']],x=>x[0],x=>x[1],'flat')+'</select>'+
      '<div id="bgLoc">'+LOAD+'</div>'+
      '<div class="two"><div><label>Quantity at each location <span id="bgUom" style="color:var(--slate);font-weight:400"></span></label><input id="bgQty" type="number" min="0" step="0.001" oninput="ENG.f.bgSum()"></div>'+
      '<div><label>Estimated rate (₹) <span style="color:var(--slate);font-weight:400">optional</span></label><input id="bgRate" type="number" min="0" step="0.01"></div></div>'+
      '<label>Remarks <span style="color:var(--slate);font-weight:400">(optional)</span></label><input id="bgRem">'+
      '<div id="bgSum" class="eng-note" style="margin-top:14px"></div>',
      cancelBtn+'<button class="btn btn-primary" id="bgGo" onclick="ENG.f.bgCreate(this)"><i class="fa-solid fa-check"></i> Create lines</button>','lg');
    try{G.geo=await loadGeo(pid);}catch(e){fail(e);}
    ENG.f.bgLoc();
  };
  ENG.f.bgGroup=function(){
    const gid=Number(val('bgGroup'));const acts=C.acts.filter(a=>a.active&&a.group_id===gid);
    $('bgAct').innerHTML=opts(acts,a=>a.id,a=>a.name+' ('+a.uom+')','',acts.length?'Select an activity…':'No active activities in this group');
    ENG.f.bgAct();
  };
  ENG.f.bgAct=function(){
    const a=actById(val('bgAct'));
    $('bgUom').textContent=a?'('+a.uom+')':'';
    if(a&&a.est_rate!=null&&!val('bgRate'))$('bgRate').value=a.est_rate;
    ENG.f.bgSum();
  };
  const checks=id=>Array.prototype.slice.call(document.querySelectorAll('#'+id+' input[type=checkbox]:checked')).map(x=>x.value);
  const grid=(id,items,onchg)=>'<div class="eng-grid" id="'+id+'">'+items.map(i=>'<label><input type="checkbox" value="'+esc(i[0])+'"'+(i[2]?' checked':'')+' onchange="'+onchg+'"> '+esc(i[1])+'</label>').join('')+'</div>'+
    '<div style="font-size:12px;margin-top:5px"><a style="cursor:pointer;color:var(--brand)" onclick="ENG.f.bgAll(\''+id+'\',true)">Select all</a> · <a style="cursor:pointer;color:var(--brand)" onclick="ENG.f.bgAll(\''+id+'\',false)">None</a></div>';
  ENG.f.bgAll=function(id,on){document.querySelectorAll('#'+id+' input[type=checkbox]').forEach(x=>x.checked=on);if(id==='bgBlocks')ENG.f.bgBlocks();else ENG.f.bgSum();};
  ENG.f.bgBlocks=function(){ENG.f.bgPos();ENG.f.bgSum();};

  ENG.f.bgLoc=function(){
    const host=$('bgLoc'),lvl=val('bgLevel'),geo=G.geo;
    if(!geo){host.innerHTML=LOAD;return;}
    if(lvl==='project'){host.innerHTML='<div class="eng-note">One line for work outside the blocks — roads, boundary wall, landscape, external services.</div>';return ENG.f.bgSum();}
    const towers=geo.towers||[];
    const fn=geo.floors.map(f=>f.floor_no),f1=fn.length?Math.min.apply(null,fn):1,f2=fn.length?Math.max.apply(null,fn):1;
    let h='<label>Blocks</label>'+(towers.length?grid('bgBlocks',towers.map(x=>[x.id,x.name,true]),'ENG.f.bgBlocks()'):'<div class="eng-note">This project has no blocks set up in Post Sales yet.</div>');
    if(lvl!=='block'){
      h+='<label>Floors</label><div style="display:flex;gap:10px;align-items:center">From <input id="bgF1" type="number" value="'+f1+'" style="width:90px" oninput="ENG.f.bgSum()"> to <input id="bgF2" type="number" value="'+f2+'" style="width:90px" oninput="ENG.f.bgSum()"> <span style="color:var(--slate);font-size:12.5px">floors a block doesn’t have are skipped</span></div>';
    }
    if(lvl==='flat'||lvl==='portion'){
      h+='<label>Flats</label><select id="bgPosMode" onchange="ENG.f.bgPos()"><option value="all">Every flat on those floors</option><option value="sel">Only certain positions (A, B, C …)</option></select><div id="bgPosHost"></div>';
    }
    if(lvl==='portion'){
      h+='<label>Portions</label>'+grid('bgPortions',PORTIONS.map(p=>[p,p,p==='Bathroom'||p==='Toilet']),'ENG.f.bgSum()')+
        '<input id="bgPortOther" placeholder="Other portions, separated by commas (optional)" style="margin-top:8px" oninput="ENG.f.bgSum()">';
    }
    host.innerHTML=h;
    ENG.f.bgPos();ENG.f.bgSum();
  };
  ENG.f.bgPos=function(){
    const h=$('bgPosHost');if(!h)return;
    if(val('bgPosMode')!=='sel'){h.innerHTML='';return ENG.f.bgSum();}
    const tw=new Set(checks('bgBlocks').map(Number));
    const prev=new Set(checks('bgPos'));
    const codes=[...new Set(G.geo.positions.filter(p=>tw.has(p.tower_id)).map(p=>p.code))].sort();
    h.innerHTML=codes.length?grid('bgPos',codes.map(c=>[c,'Position '+c,prev.has(c)]),'ENG.f.bgSum()'):'<div class="eng-note">No flat positions defined for the selected blocks.</div>';
    ENG.f.bgSum();
  };

  function genRows(){
    const geo=G.geo;if(!geo)return[];
    const lvl=val('bgLevel'),act=Number(val('bgAct'));
    const qty=numOrNull(val('bgQty')),rate=numOrNull(val('bgRate'));
    const base={project_id:G.pid,activity_id:act,qty:qty,rate:(rate&&!isNaN(rate))?rate:0,remarks:val('bgRem').trim()||null};
    const mk=x=>Object.assign({},base,x);
    if(lvl==='project')return[mk({})];
    const tw=new Set(checks('bgBlocks').map(Number));
    if(lvl==='block')return[...tw].map(t=>mk({tower_id:t}));
    const f1=Number(val('bgF1')),f2=Number(val('bgF2'));
    const floors=geo.floors.filter(f=>tw.has(f.tower_id)&&f.floor_no>=f1&&f.floor_no<=f2);
    if(lvl==='floor')return floors.map(f=>mk({tower_id:f.tower_id,floor_id:f.id}));
    const fset=new Set(floors.map(f=>f.id));
    const posCode={};geo.positions.forEach(p=>posCode[p.id]=p.code);
    const only=val('bgPosMode')==='sel'?new Set(checks('bgPos')):null;
    const flats=geo.flats.filter(fl=>fset.has(fl.floor_id)&&(!only||only.has(posCode[fl.position_id])));
    if(lvl==='flat')return flats.map(fl=>mk({tower_id:fl.tower_id,floor_id:fl.floor_id,flat_id:fl.id}));
    const extra=val('bgPortOther').split(',').map(s=>s.trim()).filter(Boolean);
    const portions=[...new Set(checks('bgPortions').concat(extra))];
    const out=[];flats.forEach(fl=>portions.forEach(p=>out.push(mk({tower_id:fl.tower_id,floor_id:fl.floor_id,flat_id:fl.id,portion:p}))));
    return out;
  }
  ENG.f.bgSum=function(){
    const host=$('bgSum');if(!host)return;
    const rows=genRows(),a=actById(val('bgAct')),qty=numOrNull(val('bgQty'));
    let msg;
    if(!a)msg='Choose an activity to see how many lines this will create.';
    else if(!rows.length)msg='Nothing selected yet — pick at least one block, floor, flat or portion.';
    else{
      const per=(qty&&!isNaN(qty))?' · '+q(qty)+' '+esc(a.uom)+' each = <b>'+q(qty*rows.length)+' '+esc(a.uom)+'</b> in total':'';
      msg='This will create <b>'+rows.length+'</b> BOQ line'+(rows.length===1?'':'s')+' for <b>'+esc(a.name)+'</b>'+per+'. Lines that already exist for the same activity and location are skipped.';
      if(rows.length>5000)msg+=' <span style="color:var(--err);font-weight:600">That is more than 5,000 lines — narrow the selection.</span>';
    }
    host.innerHTML=msg;
    const go=$('bgGo');if(go)go.disabled=!a||!rows.length||rows.length>5000;
  };
  ENG.f.bgCreate=function(btn){
    return run(btn,async()=>{
      const a=actById(val('bgAct')),qty=numOrNull(val('bgQty')),rate=numOrNull(val('bgRate'));
      if(!a)return toast('Choose an activity','warn');
      if(qty==null||isNaN(qty)||qty<=0)return toast('Enter the quantity at each location','warn');
      if(rate!=null&&(isNaN(rate)||rate<0))return toast('Enter a valid rate','warn');
      const rows=genRows();
      if(!rows.length)return toast('Nothing selected','warn');
      let ins=0,skp=0,done=0;
      for(const c of chunk(rows,400)){
        btn.innerHTML='<i class="fa-solid fa-spinner fa-spin"></i> '+done+' / '+rows.length;
        const {data,error}=await E().rpc('boq_bulk_add',{p_rows:c});
        if(error)throw error;
        ins+=num(data&&data.inserted);skp+=num(data&&data.skipped);done+=c.length;
      }
      closeModal();
      toast(ins+' BOQ line'+(ins===1?'':'s')+' created'+(skp?' · '+skp+' already existed':''),ins?'ok':'warn');
      renderPage();
    });
  };
})();
