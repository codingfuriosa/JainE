VIEWS.hr_new=async function(v,seg){
  setCrumb(['People','Human Resources']);
  const tabs=['Interviews','Monthly Progress','Resumes'];
  const ti=mTab(seg,tabs.length);
  const bodyId=(ti<=1)?'recBody':'hrBody';
  v.innerHTML=REC_RO_CSS+TP_CSS+mHead('fa-users','#be123c','Human Resources')
    +(recCanWrite()?'':'<div class="rec-ro"><i class="fa-solid fa-lock"></i> Approving, editing and deleting here is limited to HR, Abhay Mati and Administrators.</div>')
    +mTabs('hr_new',tabs,ti)+'<div id="'+bodyId+'" style="margin-top:16px"><div class="loader"><div class="spin"></div></div></div>';
  recWatchPerms();
  if(ti===0){await tpTracker();return;}
  if(ti===1){await tpMonthlyUpdate();return;}
  /* Resumes is the last tab now. Interview Qs was removed: it was a library nobody was reaching
     for, and it sat in the tab strip costing a decision on every visit. hrInterviewQs() is left in
     the file rather than deleted, so nothing is lost if it is ever wanted back. */
  await hrResumes();
};

/* ── Monthly Update ──
   Rebuilt against hr.monthly_view. The nine columns — Tests Sent, Test Passed, Interview Scheduled,
   Interview Done, Selected, Rejected, Hold, Backed Out, Joined — are COUNTED from hr.candidates,
   never typed. The old screen was a grid of number boxes somebody had to keep in step with reality
   by hand; every figure here is derived, so it cannot drift.
   The first four columns are cumulative ("how many got at least this far") and read the candidate's
   high-water mark, not their current stage — otherwise anybody who dropped out after their test
   would still be counted as having been interviewed. The last five are exact outcomes. That split
   lives in hr.tracker_stages.counts_as, so adding a stage is a database change, not a code change.
   A candidate begins BELOW all nine, at 'Applied' (seq 0), so filling in the careers-page form no
   longer reports a test as having been sent to them. Nothing counts them until something really
   happens; how many applied is candidate_total, which hr.monthly_view returns separately. */
async function hrResumes(){
  const b=$('hrBody');loader(b);
  try{const {data,error}=await sb.schema('hr').from('resumes').select('*').order('created_at',{ascending:false});if(error)throw error;RS_ROWS=data||[];}
  catch(e){b.innerHTML='<div class="empty" style="padding:40px;color:var(--err)">'+esc(e.message)+'</div>';return;}
  RS_SEARCH=null;RS_SEL=new Set();RS_Q='';
  rsRender();
}
/* Resumes is a filing cabinet, not an analyser. The AI reading was never asked for and never
   finished - rows sat on "Analyzing..." for ever because nothing retried a failed call - so it is
   gone entirely. What a row shows now is what the file actually is. */