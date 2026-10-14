/* ===== reference-matched module builders ===== */
function mTabs(id,tabs,ti){return '<div class="tabs">'+tabs.map((t,i)=>'<div class="tab '+(i===ti?'active':'')+'" onclick="navTo(\''+id+'/'+i+'\')">'+esc(t)+'</div>').join('')+'</div>';}
function mKpis(arr){return '<div class="grid kpis" style="grid-template-columns:repeat('+arr.length+',1fr)">'+arr.map(k=>'<div class="kpi"><div class="lbl" style="margin-bottom:7px">'+esc(k[0])+'</div><div class="val">'+esc(k[1])+'</div><div style="font-size:12px;color:'+(k[3]||'var(--slate)')+';margin-top:3px">'+esc(k[2]||'')+'</div></div>').join('')+'</div>';}
function mStep(steps,active){const ai=steps.indexOf(active);return '<div class="mstep">'+steps.map((s,i)=>'<span class="mstep-i'+(s===active?' on':(i<ai?' done':''))+'">'+esc(s)+'</span>'+(i<steps.length-1?'<span class="mstep-a">→</span>':'')).join('')+'</div>';}
function mFunnel(items){const max=Math.max.apply(null,items.map(x=>x[1]));return '<div class="mfunnel">'+items.map(x=>'<div class="mfunnel-r"><div class="mfunnel-bar" style="width:'+Math.max(20,Math.round(x[1]/max*100))+'%">'+esc(x[0])+'</div><span class="mfunnel-v">'+x[1]+'</span></div>').join('')+'</div>';}
// A cell starting with '<' is already-built HTML from the caller (a status pill, a clickable
// vendor link) and must pass through as-is; everything else is a plain value and gets escaped.
// Used to only recognise '<span' pills - Vendor Trends' clickable '<a ...>' vendor names fell
// through that narrower check and rendered as literal, visible markup instead of a link.
function mTable(cols,rows){return '<div class="card qc-table-card" style="padding:0"><div style="overflow-x:auto"><table class="tbl"><thead><tr>'+cols.map(c=>'<th>'+esc(c)+'</th>').join('')+'</tr></thead><tbody>'+rows.map(r=>'<tr>'+r.map(c=>'<td>'+(String(c).charAt(0)==='<'?c:esc(c))+'</td>').join('')+'</tr>').join('')+'</tbody></table></div></div>';}
function mCard(title,inner){return '<div class="card card-pad"><div class="sec-title" style="margin:0 0 12px">'+esc(title)+'</div>'+inner+'</div>';}
function mHead(icon,color,title){return '<div class="page-head"><div><h1><i class="fa-solid '+icon+'" style="color:'+color+'"></i> '+esc(title)+'</h1></div></div>';}
function mTab(seg,n){let t=parseInt(seg&&seg[0]);return (isNaN(t)||t<0||t>=n)?0:t;}

