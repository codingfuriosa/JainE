/* Public vendor quotation form -- no Supabase client, no key, ever, in this file.
   Everything goes through the vendor-quote edge function (action 'get' | 'submit'), which is the actual
   security boundary. This file only renders what that function returns and posts back what the vendor typed.
   The link's token (?t=) is the only credential. */
(function(){
  const SB='https://rkxsgtauigjrpcjkmccu.supabase.co';
  const URL_FN=SB+'/functions/v1/vendor-quote';
  const token=new URLSearchParams(location.search).get('t');
  const app=document.getElementById('app');
  const esc=s=>String(s==null?'':s).replace(/[&<>"]/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[m]));
  const dmy=d=>{ if(!d) return '—'; const x=new Date(d); return String(x.getDate()).padStart(2,'0')+'/'+String(x.getMonth()+1).padStart(2,'0')+'/'+x.getFullYear(); };
  let DATA=null;

  if(!token){ app.innerHTML='<p class="err">This link is missing its reference. Please use the exact link we emailed you.</p>'; return; }

  async function call(body){
    try{
      const res=await fetch(URL_FN,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(Object.assign({token},body))});
      const out=await res.json().catch(()=>({error:'Unexpected response'}));
      if(!res.ok&&!out.error) out.error='Something went wrong (status '+res.status+')';
      return out;
    }catch(e){ return {error:'Could not reach the server. Please check your connection and try again.'}; }
  }
  const uomOpts=sel=>DATA.uoms.map(u=>'<option value="'+u.id+'"'+(u.id===sel?' selected':'')+'>'+esc(u.code)+'</option>').join('');

  function render(d){
    DATA=d; const cur=d.current||{}, t=f=>esc(cur[f]||'');
    const rows=d.lines.map((l,i)=>{ const q=l.q||null, quoting=q?q.quoting:true;
      return '<tr class="ln" data-line="'+l.id+'"><td>'+(i+1)+'</td><td><b>'+esc(l.name)+'</b><small>'+esc(l.code)+' · HSN '+esc(l.hsn)+'</small></td><td>'+Number(l.qty).toLocaleString('en-IN',{maximumFractionDigits:3})+' '+esc(l.uom)+'</td>'
        +'<td><input type="checkbox" class="on"'+(quoting?' checked':'')+' onchange="vqToggle(this)"></td>'
        +'<td><select class="uom">'+uomOpts(q&&q.uom_id?q.uom_id:l.uom_id)+'</select></td>'
        +'<td><input class="rate num" type="number" step="0.01" min="0" value="'+(q&&q.rate!=null?esc(q.rate):'')+'">'+((d.counter&&d.counter.targets&&d.counter.targets[l.id]!=null)?'<small style="color:#b45309">Our target: ₹'+Number(d.counter.targets[l.id]).toLocaleString('en-IN',{minimumFractionDigits:2})+'</small>':'')+'</td>'
        +'<td><input class="gst" type="number" step="0.01" min="0" max="100" value="'+(q&&q.gst_rate!=null?esc(q.gst_rate):esc(l.gst_rate))+'"></td>'
        +'<td><input class="make" type="text" value="'+esc(q&&q.make||'')+'"></td><td><input class="rem" type="text" value="'+esc(q&&q.remark||'')+'"></td></tr>'; }).join('');
    app.innerHTML='<h1>Quotation for '+esc(d.doc_no)+'</h1><p class="sub">Dear '+esc(d.vendor)+', please quote your rate for each item below and state your terms. You can come back to this link and revise your quotation until the last date.</p>'
      +'<div class="meta"><div><b>RFQ</b>'+esc(d.doc_no)+'</div><div><b>Last date for quotations</b>'+dmy(d.due_date)+'</div>'+(d.status==='quoted'?'<div><b>Your status</b>Quoted (revision '+(cur.revision||1)+') — you may revise it</div>':'')+'</div>'
      +(d.counter?'<div class="ask" style="background:#eff6ff;border-color:#bfdbfe"><b>Counter offer'+(d.counter.round_no?' (round '+d.counter.round_no+')':'')+':</b> we would like you to review your rates.'+(d.counter.note?'<br>'+esc(d.counter.note):'')+'</div>':'')
      +(d.terms_requested?'<div class="ask"><b>Please state:</b> '+esc(d.terms_requested)+'</div>':'')
      +'<h2>Items</h2><div class="tbl"><table><thead><tr><th>#</th><th>Item</th><th>Quantity</th><th>Quoting</th><th>Unit</th><th>Rate (₹)</th><th>GST %</th><th>Make</th><th>Remark</th></tr></thead><tbody>'+rows+'</tbody></table></div>'
      +'<p class="hint">Rates are per the unit you choose. Untick "Quoting" for any item you will not quote.</p>'
      +'<h2>Terms (common to all items)</h2><div class="grid">'
      +'<div><label class="fld">Payment terms</label><input type="text" id="pay" value="'+t('payment_terms')+'" placeholder="e.g. 30 days from invoice"></div>'
      +'<div><label class="fld">Delivery</label><input type="text" id="del" value="'+t('delivery_terms')+'" placeholder="e.g. within 7 days of order"></div>'
      +'<div><label class="fld">Warranty / guarantee</label><input type="text" id="war" value="'+t('warranty_terms')+'"></div>'
      +'<div><label class="fld">Freight</label><input type="text" id="fre" value="'+t('freight_terms')+'" placeholder="included / extra at actuals"></div>'
      +'<div><label class="fld">Price validity</label><input type="text" id="val" value="'+t('price_validity')+'" placeholder="e.g. 30 days"></div>'
      +'<div><label class="fld">Other terms</label><input type="text" id="oth" value="'+t('other_terms')+'"></div></div>'
      +'<div style="margin-top:14px"><label class="fld">Remarks</label><textarea id="rmk" rows="2">'+t('remarks')+'</textarea></div>'
      +'<div class="hp" aria-hidden="true"><label>Website <input type="text" id="website" tabindex="-1" autocomplete="off"></label></div>'
      +'<div id="msg" class="err" style="display:none"></div>'
      +'<div style="margin-top:24px"><button class="btn" id="go" onclick="vqSubmit()">'+(d.status==='quoted'?'Submit revised quotation':'Submit quotation')+'</button><button class="link" onclick="vqDecline()">We will not be quoting</button></div>';
    document.querySelectorAll('.ln').forEach(tr=>window.vqToggle(tr.querySelector('.on')));
  }
  window.vqToggle=function(cb){ cb.closest('tr').querySelectorAll('.uom,.rate,.gst,.make').forEach(e=>{ e.disabled=!cb.checked; }); };
  const v=id=>{const e=document.getElementById(id);return e?e.value.trim():'';};
  function fail(m){ const e=document.getElementById('msg'); e.textContent=m; e.style.display='block'; e.scrollIntoView({behavior:'smooth',block:'center'}); return false; }
  function done(msg){ app.innerHTML='<div class="center"><div class="ok-check">✓</div><h1>Thank you</h1><p class="sub" style="margin-bottom:0">'+esc(msg)+'</p></div>'; }

  window.vqSubmit=async function(){
    document.getElementById('msg').style.display='none';
    const lines=[];
    for(const tr of document.querySelectorAll('.ln')){
      const on=tr.querySelector('.on').checked, rate=parseFloat(tr.querySelector('.rate').value);
      if(on&&!(rate>0)) return fail('Please enter a rate for every item you are quoting, or untick "Quoting" for it.');
      lines.push({rfq_line_id:parseInt(tr.dataset.line,10),quoting:on,uom_id:on?parseInt(tr.querySelector('.uom').value,10):null,rate:on?rate:null,
        gst_rate:on?(parseFloat(tr.querySelector('.gst').value)||0):null,make:on?tr.querySelector('.make').value.trim():'',remark:tr.querySelector('.rem').value.trim()});
    }
    if(!lines.some(l=>l.quoting)) return fail('Please quote at least one item, or choose "We will not be quoting".');
    const btn=document.getElementById('go'); btn.disabled=true; btn.textContent='Submitting…';
    const out=await call({action:'submit',website:v('website'),lines,payment_terms:v('pay'),delivery_terms:v('del'),warranty_terms:v('war'),freight_terms:v('fre'),price_validity:v('val'),other_terms:v('oth'),remarks:v('rmk')});
    if(out.error){ btn.disabled=false; btn.textContent='Submit quotation'; return fail(out.error); }
    done(out.message||'Your quotation has been received.');
  };
  window.vqDecline=async function(){
    const why=prompt('You are telling us you will not be quoting on this request. Reason (optional):');
    if(why===null) return;
    const out=await call({action:'submit',decline:true,reason:why});
    if(out.error) return fail(out.error);
    done(out.message||'Noted — thank you.');
  };

  (async function(){
    const out=await call({action:'get'});
    if(out.error){ app.innerHTML='<h1>Request for quotation</h1><p class="sub" style="margin-bottom:0">'+esc(out.error)+'</p>'; return; }
    render(out);
  })();
})();
