VIEWS.crm=function(v,seg){
  setCrumb(['Sales','CRM & Sales']);
  v.innerHTML=mHead('fa-handshake','#7c3aed','CRM & Sales')
    +'<div style="margin:-8px 0 12px"><button class="btn btn-primary" onclick="window.open(\'https://www.realtybucket.com/\',\'_blank\')"><i class="fa-solid fa-arrow-up-right-from-square"></i> Open</button></div>'
    +'<div style="margin-top:16px"><div id="crmDuWrap"><div class="loader"><div class="spin"></div></div></div></div>';
  crmDuLoad();
};
/* ============================ CRM & SALES — DAILY UPDATES TAB ============================
   Read-only viewer over acc.crm_daily_updates: the Qualified / Site Visits / Agent Visits rollup
   that the daily-crm-updates scheduled task extracts from RealtyBucket and writes to Supabase
   each morning (replacing the old "CRM Updates" Google Sheet). Nothing on this tab writes data —
   it only ever selects from the table, one report_date at a time, most recent first by default,
   with a date picker so any past day can be reopened. */
let CRM_DU_DATE=null; // yyyy-mm-dd string picked by the user; null = "most recent available"
async function crmDuLoad(){
  const wrap=$('crmDuWrap'); if(!wrap)return;
  loader(wrap);
  try{
    let dateStr=CRM_DU_DATE;
    if(!dateStr){
      const {data:latest,error:e1}=await sb.schema('acc').from('crm_daily_updates').select('report_date').order('report_date',{ascending:false}).limit(1).maybeSingle();
      if(e1)throw e1;
      dateStr=latest?latest.report_date:null;
    }
    if(!dateStr){
      wrap.innerHTML=crmDuDatePicker(null)+'<div class="card card-pad empty" style="padding:36px;text-align:center"><i class="fa-regular fa-chart-bar"></i><div>No CRM Updates recorded yet</div><p style="max-width:380px;margin:6px auto 0;color:var(--slate)">The daily-crm-updates task writes here every morning once it runs.</p></div>';
      return;
    }
    const {data,error}=await sb.schema('acc').from('crm_daily_updates').select('*').eq('report_date',dateStr).order('sort_order',{ascending:true});
    if(error)throw error;
    crmDuRender(dateStr,data||[]);
  }catch(e){
    wrap.innerHTML=crmDuDatePicker(CRM_DU_DATE)+'<div class="card card-pad empty" style="padding:32px"><i class="fa-solid fa-triangle-exclamation"></i><div>Could not load CRM Updates</div><p>'+esc((e&&e.message)||String(e))+'</p></div>';
  }
}
function crmDuDatePicker(dateStr){
  return '<div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:14px">'
    +'<label style="font-size:13px;color:var(--slate)">Report date</label>'
    +'<input type="date" class="sel" id="crmDuDate" value="'+esc(dateStr||'')+'" onchange="crmDuOnDateChange(this.value)" style="max-width:170px;height:38px">'
    +'<span style="font-size:12px;color:var(--slate)">Month = 1st of the month through this date &middot; Yesterday = this date only</span>'
    +'</div>';
}
function crmDuRender(dateStr,rows){
  const wrap=$('crmDuWrap'); if(!wrap)return;
  const props=rows.filter(function(r){return !r.is_total;});
  const total=rows.find(function(r){return r.is_total;});
  const rowsHtml=props.map(function(r){
    return [r.property_label,r.month_qualified+' / '+r.yesterday_qualified,r.month_visits+' / '+r.yesterday_visits,r.agent_month_visits+' / '+r.agent_yesterday_visits];
  });
  if(total){
    rowsHtml.push(['<b>Total</b>','<b>'+total.month_qualified+' / '+total.yesterday_qualified+'</b>','<b>'+total.month_visits+' / '+total.yesterday_visits+'</b>','<b>'+total.agent_month_visits+' / '+total.agent_yesterday_visits+'</b>']);
  }
  const tableHtml=rowsHtml.length
    ? mTable(['Property','Qualified (Month / Yesterday)','Site Visits (Month / Yesterday)','Agent Visits (Month / Yesterday)'],rowsHtml)
    : '<div class="card card-pad empty" style="padding:32px;text-align:center">No rows recorded for '+esc(fmtDate(dateStr))+'</div>';
  const runAt=props.length&&props[0].run_at?('<div style="font-size:12px;color:var(--slate);margin-top:10px">Last extracted '+esc(fmtDate(props[0].run_at))+'</div>'):'';
  wrap.innerHTML=crmDuDatePicker(dateStr)+tableHtml+runAt;
}
window.crmDuOnDateChange=function(v){ CRM_DU_DATE=v||null; crmDuLoad(); };

/* ============================ POST SALES — ADHOC bulk replace ============================
   Converted output files upload to S3 (postsales/adhoc/...) and the conversion record (file
   name, replacement count, uploader, timestamp) is stored in postsales.adhoc_docs — a shared,
   company-wide log: everyone with Post Sales access sees everyone else's conversions, not just
   their own, and can download/preview them anytime via a signed URL. Upload -> replace "adhoc"
   (any case) with "Contracted Extra Charges" in the browser (JSZip for .docx, pdf.js+pdf-lib for
   .pdf) -> upload the result to S3 -> record it -> preview (mammoth.js / embedded PDF) or
   download. */