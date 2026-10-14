/* ============ WHAT EACH MODULE'S ACTIONS ARE ABOUT ==========================================
   The drill-down's last column used to be "Assigned to" everywhere, which only means something in
   Accountability - a task is handed to somebody; a document is not. Everywhere else it was a column
   of dashes taking the width that the one useful fact should have had, and which fact that is
   depends on what the module does: an inspection happens to a flat, a document lives in a folder,
   a call belongs to a lead, a requisition is for a position.

   These helpers answer that question per module. Every one of them is defensive on purpose: they
   read whatever list the screen already has in memory, and if the row is not there (a stale id, a
   list not loaded yet, a global that does not exist on this page) they return null and the column
   shows a dash rather than a wrong answer. Telemetry must never be the thing that breaks a click.

   Note on the wrapper: it logs BEFORE the function it wraps runs, so anything read here must be the
   state as it is at the moment of the click. That is why these take the id from the click's own
   arguments rather than reading "what is currently open" - the latter would describe the record the
   person just left. */
function usbFrom(list, id, build){
  try{
    if(id==null) return null;
    const r=(list||[]).find(function(x){ return String(x.id)===String(id); });
    return r?build(r):null;
  }catch(e){ return null; }
}
// Legal · MIS — which case, and where it is being heard
function usbMisMeta(id){
  return usbFrom(window._misRows, id, function(r){
    return {title:r.cause_title||r.case_no||undefined, case_no:r.case_no||undefined, court:r.court||undefined};
  });
}
// Legal · Advocates — which court they appear in
function usbAdvMeta(id){
  return usbFrom(window._advRows, id, function(r){
    return {title:r.advocate_name||undefined, court:r.court||undefined, case_type:r.case_type||undefined};
  });
}
/* Legal · Documents and Document Library — where the document sits. There is no in-memory list of
   documents (they are fetched one at a time), so this reports the folder the screen is currently
   showing, which is the folder the document being acted on is in. */
function usbDocScope(){
  try{
    const d=(typeof DOC!=='undefined')?DOC:null; if(!d) return null;
    const out={};
    if(d.dept) out.department=String(d.dept);
    if(d.cat)  out.folder=String(d.cat);
    return Object.keys(out).length?out:null;
  }catch(e){ return null; }
}
// Transcription — the lead the call belongs to. Checks the deleted list and the open call too, so
// restoring a call or acting from the detail screen still names it.
function usbCallMeta(id){
  const pick=function(r){
    return {title:r.title||r.file_name||undefined, lead:r.customer_name||undefined, project:r.project||undefined};
  };
  try{
    return usbFrom(TR_ROWS, id, pick) || usbFrom(TR_DELETED_ROWS, id, pick)
        || (TR_DETAIL_ROW?pick(TR_DETAIL_ROW):null);
  }catch(e){ return null; }
}
// Recruitment — the position or the thing being acted on
function usbTestMeta(id){ return usbFrom((typeof RT_RECORDS!=='undefined')?RT_RECORDS:null, id,
  function(r){ return {title:r.name||undefined}; }); }
// A job description IS a position - its name is the position's name - so it fills both, and the
// column stops being blank on the preview and download actions that only had an id to go on.
function usbJdMeta(id){ return usbFrom(window._recAllJDs, id,
  function(r){ var n=r.name||r.file_name||undefined; return {title:n, position:r.name||undefined}; }); }
function usbMpMeta(id){ return usbFrom((typeof MP_RECORDS!=='undefined')?MP_RECORDS:null, id,
  function(r){ return {title:r.job_title||undefined, position:r.job_title||undefined, department:r.department||undefined}; }); }
function usbRefMeta(id){ return usbFrom((typeof REF_RECORDS!=='undefined')?REF_RECORDS:null, id,
  function(r){ return {title:r.referred_name||undefined, position:r.position||undefined}; }); }
// HR — the candidate, and the position they are for
function usbTrkMeta(id){ return usbFrom(window._trRows, id,
  function(r){ return {title:r.candidate_name||undefined, position:r.position||undefined}; }); }
// Resumes are filed against a ROLE, not a position - that is the word the rows actually carry, and
// picking 'position' for the column meant it could never match no matter how much was captured.
function usbResumeMeta(id){ return usbFrom((typeof RS_ROWS!=='undefined')?RS_ROWS:null, id,
  function(r){ return {title:r.file_name||undefined, role:r.role||r.position||undefined}; }); }
/* HR · Monthly Update is keyed by the requisition behind the row, not by an id of its own.
   The position's name is the thing the row is ABOUT, so it goes in Details as a bare name. What
   the click decided - approved or rejected, hiring closed or reopened - is a different fact and
   gets its own column: one button that can go two ways is unreadable if both ways look identical
   in the report. Only 'title' is returned, never 'position' as well, or Details would print the
   same name twice. */
function usbMuRow(manpowerId){
  try{
    const r=((typeof MU_ROWS!=='undefined'&&MU_ROWS)||[]).find(function(x){ return x.manpower_id===manpowerId; });
    return r||null;
  }catch(e){ return null; }
}
function usbMuBase(manpowerId){
  const r=usbMuRow(manpowerId);
  const out={};
  if(r&&r.position_title) out.title=String(r.position_title);
  try{ if(typeof MU_CUR!=='undefined'&&MU_CUR) out.month=muMonthLabel(MU_CUR); }catch(e){}
  return out;
}
function usbMuMeta(manpowerId){
  const o=usbMuBase(manpowerId);
  return Object.keys(o).length?o:null;
}
function usbMuDecision(manpowerId, decision){
  const o=usbMuBase(manpowerId);
  if(decision) o.decision=decision;
  return Object.keys(o).length?o:null;
}
/* Campaign Analytics — every number on this screen is "for this period, from this source", so that
   pair is the context every action here needs. Read from the state rather than the click, because
   most of these buttons change one half of it and the other half still matters. */
function usbCmpMeta(){
  try{
    const per=(typeof CMP_PERIOD!=='undefined')?CMP_PERIOD:null;
    const label=(per==='custom' && typeof CMP_SINCE!=='undefined' && CMP_SINCE)
      ? (CMP_SINCE+' → '+((typeof CMP_UNTIL!=='undefined'&&CMP_UNTIL)||'today'))
      : (per?String(per).replace(/_/g,' '):null);
    const out={};
    if(label) out.period=label;
    if(typeof CMP_SOURCE!=='undefined'&&CMP_SOURCE) out.source=String(CMP_SOURCE);
    return Object.keys(out).length?out:null;
  }catch(e){ return null; }
}
/* Internet Speed — the window being looked at. The speed reading itself was the first idea, but it
   is not in hand at the moment of the click (the refresh that produces it has not run yet, and the
   chart's numbers live inside the render), so reporting it here would mean reporting the PREVIOUS
   reading against this action - worse than useless. The range is what every feature on this screen
   genuinely has, and it is what tells two otherwise identical rows apart. */
function usbNetMeta(){
  try{
    const r=(typeof NET_RANGE!=='undefined')?NET_RANGE:null;
    if(!r) return null;
    const l=((typeof NET_RANGES!=='undefined'&&NET_RANGES)||[]).find(function(x){ return x[0]===r; });
    return {range:(l&&l[1])||String(r)};
  }catch(e){ return null; }
}
/* Post Sales · ADHOC — how the replacement job is doing. The document's own name goes in Details;
   what the column adds is the thing you would ask next, which is whether it worked and how many
   replacements it covers. Both are on the row already. */
function usbPsaMeta(id){
  try{
    const r=(typeof PSA!=='undefined'&&PSA&&PSA.queue)?PSA.queue.find(function(x){return x.id===id;}):null;
    if(!r) return null;
    return {title:r.name||undefined, status:r.status||undefined,
            replacements:(r.count!=null?r.count+' replacement'+(r.count===1?'':'s'):undefined)};
  }catch(e){ return null; }
}
// Competitor Ads — whose ads, and over what window. Read from the filter bar, which is what every
// action on that screen is relative to.
function usbCompMeta(){
  try{
    const f=(typeof COMP_F!=='undefined')?COMP_F:null; if(!f) return null;
    const out={};
    if(f.wl && f.wl!=='all') out.competitor=String(f.wl);
    if(f.range==='custom' && (f.from||f.to)) out.range=(f.from||'any')+' → '+(f.to||'today');
    else if(f.range) out.range=String(f.range).replace(/_/g,' ');
    if(f.media && f.media!=='all') out.media=String(f.media);
    return Object.keys(out).length?out:null;
  }catch(e){ return null; }
}
// Posts & Reels — which window, and which network's content is being looked at.
function usbOrgMeta(){
  try{
    const p=(typeof ORG_PERIOD!=='undefined')?ORG_PERIOD:null;
    const out={};
    if(p==='custom' && typeof ORG_SINCE!=='undefined' && ORG_SINCE)
      out.period=ORG_SINCE+' → '+((typeof ORG_UNTIL!=='undefined'&&ORG_UNTIL)||'today');
    else if(p) out.period=String(p).replace(/_/g,' ');
    if(typeof ORG_NET!=='undefined' && ORG_NET && ORG_NET!=='all') out.network=String(ORG_NET);
    if(typeof ORG_KIND!=='undefined' && ORG_KIND && ORG_KIND!=='all') out.kind=String(ORG_KIND);
    return Object.keys(out).length?out:null;
  }catch(e){ return null; }
}
// Procurement · Quote Comp — which category of document. It arrives as the click's own argument on
// every one of these, which is why they are wired to read it rather than to a lookup.
function usbProcCat(cat){
  try{ return cat?{category:String(cat)}:null; }catch(e){ return null; }
}
// Procurement · Vendor Trends — which vendor
function usbVendorMeta(id){
  try{
    const v=(typeof VT_CACHE!=='undefined'&&VT_CACHE&&VT_CACHE.vendors)?VT_CACHE.vendors[id]:null;
    return v?{title:v.name||undefined, vendor:v.name||undefined}:null;
  }catch(e){ return null; }
}
const USAGE_MAP={
  // Accountability — Tasks
  // taskSave itself is NOT mapped here (see the direct usageQueue call inside it) - the title it
  // creates only exists as a DOM value read inside the function body, which a wrapper here can never
  // see; only the function itself can capture it.
  taskUpdateDue:'tasks.tasks.edit_task_due_date',
  taskDelegateSave:'tasks.tasks.delegate_task_to_someone',
  // taskMarkComplete(id, makeComplete) toggles both ways from the same button pair - makeComplete
  // false is "un-complete a task" (Completed -> back to Pending), not another mark-done, and it was
  // silently inflating that count every time someone reopened a task by mistake.
  taskMarkComplete:function(id,makeComplete){ return makeComplete ? 'tasks.tasks.mark_task_done_send_for_approval' : 'tasks.tasks.revert_reopen_a_task'; },
  taskApprove:'tasks.tasks.approve_a_completed_task', taskDecline:'tasks.tasks.decline_a_completed_task',
  // This entry is what made "Insert a task at a specific position" read 0 uses for months.
  // window.taskReorderDrop is still defined further up this file, so the wrapper installed
  // cleanly and nothing ever looked wrong - but no element carries an ondrop for it any more:
  // the HTML5 drag it belonged to was replaced by the pointer-events one (wireProjTaskDrag),
  // and the old handler was left behind unreachable. A wrapped function that is never called
  // logs nothing. The three places the feature really happens - the "+ Add task here" strip
  // and the swap drag in accountability.js, and persistProjTaskOrder here - log themselves at
  // the point the position is actually saved.
  cmAdd:'tasks.tasks.comment_on_a_task', taskAttachUpload:'tasks.tasks.attach_file_to_a_task_or_comment',
  taskAttachDelete:'tasks.tasks.delete_attached_file', taskAttachDeleteSel:'tasks.tasks.delete_attached_file',
  // notifDismissAllDue and notifMarkAllGeneralRead both log 'mark all notifications as read'
  // directly at their source instead - see the note on each. Mapped here they would have carried
  // two different verbs ('delete' vs 'view', read off their names) for one feature, and would have
  // counted clicks that cleared nothing.
  /* The Accountability module's OWN Tasks tab (accountability.js, table ptasks) turned out to have a
     second, separate implementation of most of these actions from the Projects/Goals one above
     (table acc.tasks) - global functions, just never added here. Real day-to-day task editing goes
     through these, so several catalog rows (edit title/description/members, delegate, sub-tasks,
     search) had a live feature and zero events against it, not because nobody used them but because
     nothing was watching this half of the app. */
  // accEditTitleSave / accEditDescSave / accEditProjectSave / accEditMembersSave / accEditDueSave
  // are NOT mapped here on purpose - each now logs directly (accountability.js), only when the
  // edit actually changed something, capturing the new value itself rather than a bare click.
  // accInsCreate / accSelfInsCreate / accDelegateSave are NOT mapped here on purpose - they log
  // directly (accountability.js) so the event carries what was actually created: the title, who
  // it went to, its due date and its project. Creating a task through this tab logged nothing at
  // all until now: the only create_task call in the codebase sat inside taskSave(), which writes
  // to acc.tasks - a table with zero rows - while every real task goes to acc.ptasks from here.
  // 103 tasks were created in the five days to 9 Sep 2026 and not one produced an event.
  accInsPickProject:'tasks.tasks.edit_task_project', accSelfInsPickProject:'tasks.tasks.edit_task_project',
  accSubAdd:'tasks.tasks.add_checklist_sub_task_item', accSubToggle:'tasks.tasks.mark_sub_task_complete',
  accSubDel:'tasks.tasks.delete_sub_task',
  // accTaskSearch is NOT mapped here on purpose - it fires on every keystroke for instant
  // filtering, and the generic wrapper logging every keystroke turned one real search into a
  // burst of single-character fragments; it logs directly instead, debounced to the settled query.
  // accP3(k) switches the Tasks tab between its three groupings - Priority is the tab's own default
  // view (already implied by simply landing on the tab), so only the other two are worth a feature
  // of their own; returning nothing for 'priority' means switching back to it logs no event.
  accP3:function(k){ return k==='project'?'tasks.tasks.view_tasks_grouped_by_tag':k==='person'?'tasks.tasks.view_tasks_grouped_by_person':k==='workflow'?'tasks.tasks.view_tasks_grouped_by_workflow':null; },
  /* Accountability — Meetings. Missed entirely on the first pass: the whole tab reported nothing,
     which is why Meetings read as untouched however much it was used. mtgFormSave is mapped to
     scheduling rather than editing because it saves both and scheduling is the act it usually is;
     "Edit a meeting" is deliberately left unmapped rather than counted wrongly. */
  // mtgFormSave logs itself in accountability.js instead - one form saves a NEW meeting and an
  // EDIT, and a fixed key here counted every edit, and every click validation turned back, as a
  // meeting scheduled.
  mtgCancelDo:'tasks.meetings.cancel_a_meeting',
  mtgReschedApply:'tasks.meetings.reschedule_one_occurrence_or_a_whole_series',
  mtgTryJoin:'tasks.meetings.join_a_meeting',
  mtgRecStart:'tasks.meetings.start_stop_recording', mtgRecStop:'tasks.meetings.start_stop_recording',
  mtgSetLang:'tasks.meetings.set_transcription_language',
  mtgWrapSave:'tasks.meetings.save_meeting_wrap_up_summary',
  mtgSetGroup:'tasks.meetings.filter_meetings_by_group',
  // Inspection / Campaigns entry points that had no mapping
  inspGo:'inspection.console.start_new_inspection',
  // cmpShowProjectAds (the Ads tab's own row-click drill-down into per-ad spend) is NOT mapped here
  // on purpose - it opens a different table than the By Project tab's campaign rollup, and there is
  // no catalog feature for an Ads-tab drill-in; mapping it to by_project's key (as it was) miscredited
  // Ads-tab clicks to a By Project feature that in fact never logged anything.
  /* Accountability — Workflow.
     Almost nothing from this tab is mapped here any more, and the reason is worth stating: a
     generic wrapper fires on the CLICK, before the work happens and before anything is known
     about what the work was about. On this tab that produced two whole classes of wrong number.
       Counted the intent, not the act: wfNew and wfEdit only OPEN the builder, so abandoning the
       form still counted as a workflow created, and three pokes at the builder read as three new
       workflows. wfDelete, wfInstDelSel, wfDone, wfReopen and wfRevert each open a confirmation
       dialog, so a delete somebody thought better of counted as a delete.
       Counted the click and nothing else: every one of these logged meta:null, so the report's
       Details column was a dash on all 1,449 workflow events - it could say a step was forwarded
       but never which step, of which instance, of which workflow, or to whom.
     All of them log directly in accountability.js instead: after the RPC has actually succeeded,
     with the step/instance/workflow read from the tables and, where the question "who has it now"
     means something (forward, reject, revert), the person it moved to. wfEventSave had to move for
     a third reason - it both creates and edits an instance from one function, so mapped here every
     edit was counted as "Start a new instance". */
  wfUpdFilePicked:'tasks.workflow.attach_a_file_to_an_update',
  /* wfUpiPick used to be mapped here and is not any more - it logs from accountability.js like the
     rest of Workflow, so it can name the id that was reused instead of recording a bare click.
     Mapped by function name it also only ever caught HALF the feature: the QR upload goes through
     the shared attachment handler, which this map cannot see, so four real uploads last week
     produced no events while the feature sat reading Inactive. */
  // Transcription
  /* An upload is the one action on this screen with no lead behind it yet - the call does not
     exist until it has been uploaded, so there is nothing to look up. 517 uses, and the column
     would have been a dash on every one of them. What it genuinely has is the files themselves:
     how many, and the first one's name. */
  trUploadStart:{key:'transcription.all_calls.upload_call_recording_s',
    meta:function(){
      try{
        const f=Array.prototype.slice.call(($('trFile')&&$('trFile').files)||[]);
        if(!f.length) return null;
        return {title:f[0].name, files:f.length===1?'1 recording':f.length+' recordings'};
      }catch(e){ return null; }
    }},
  /* Which filter, and which dates - a "Filter calls" row with nothing beside it says only that
     somebody narrowed the list, never to what. Both read what the click itself carries. */
  trSetFilter:{key:"transcription.all_calls.filter_calls_by_outcome_or_date",
               meta:function(f){ return f?{filter:String(f)}:null; }},
  trApplyDateRange:{key:"transcription.all_calls.filter_calls_by_outcome_or_date",
               meta:function(){ var a=$("trDateFrom"),b=$("trDateTo");
                 return (a&&a.value)||(b&&b.value) ? {from:(a&&a.value)||"any", to:(b&&b.value)||"any"} : null; }},
  trPinSelected:{key:'transcription.all_calls.pin_unpin_calls', meta:usbCallMeta},
  trAssignToFolder:{key:'transcription.all_calls.add_calls_to_a_folder', meta:usbCallMeta},
  trDownloadReport:{key:'transcription.all_calls.download_call_report_or_copy_link', meta:usbCallMeta},
  /* Every recording download link routes its click through trRecClick (see trRecLink). One handler
     serves several views that are different features, so the key travels in the call site's own
     `feat` and this resolver just passes it through - a link from a view that was never counted
     passes '' and, since the wrapper skips a falsy key, logs nothing. */
  trRecClick:function(ev,feat){return feat||'';},
  trRetry:{key:'transcription.all_calls.retry_failed_transcription', meta:usbCallMeta}, trDelete:{key:'transcription.all_calls.delete_a_call', meta:usbCallMeta},
  trFolderRenameSave:'transcription.folders.rename_delete_a_folder',
  trFolderDeleteConfirm:'transcription.folders.rename_delete_a_folder',
  trRemoveFromFolder:'transcription.folders.add_or_remove_calls_from_a_folder',
  trAddSelectedToTarget:'transcription.folders.add_or_remove_calls_from_a_folder',
  trDownloadFolder:'transcription.folders.download_all_calls_in_a_folder',
  trRestore:{key:'transcription.deleted.restore_a_deleted_call_single_or_all', meta:usbCallMeta},
  trRestoreAll:'transcription.deleted.restore_a_deleted_call_single_or_all',
  trShowHistory:'transcription.deleted.view_delete_restore_activity_history',
  // Which language, on which call - the language is the whole point of the click, and the call is
  // what makes the row identifiable among everybody else's language switches.
  trSetLang:{key:'transcription.call_detail.switch_transcript_language',
             meta:function(lang){ const m=usbCallMeta()||{};
               if(lang) m.language=String(lang);
               return Object.keys(m).length?m:null; }},
  trCmAdd:{key:'transcription.call_detail.add_delete_a_remark', meta:usbCallMeta}, trCmDelete:{key:'transcription.call_detail.add_delete_a_remark', meta:usbCallMeta},
  trDownload:{key:'transcription.call_detail.play_download_recording', act:'export', meta:usbCallMeta},
  // Legal — Documents
  docNewFolderSave:{key:'legal.documents.add_folder_sub_category', meta:usbDocScope}, docUploadSave:{key:'legal.documents.upload_document', meta:usbDocScope},
  // docPreview / docDownload are NOT mapped here: the document is fetched inside the function, so
  // only the function itself can say WHICH document was opened. They log directly at their source.
  docRenameSave:{key:'legal.documents.rename_document', meta:usbDocScope},
  docMoveSave:{key:'legal.documents.move_document_to_another_category', meta:usbDocScope},
  docMoveSaveLegal:{key:'legal.documents.move_document_to_another_category', meta:usbDocScope},
  docReplaceSave:{key:'legal.documents.replace_document_version', meta:usbDocScope}, docPin:{key:'legal.documents.pin_unpin_document', meta:usbDocScope},
  docDeleteConfirm:{key:'legal.documents.delete_document_s', meta:usbDocScope},
  docBulkDeleteConfirm:{key:'legal.documents.bulk_download_delete', act:'delete', meta:usbDocScope},
  // Legal — MIS / Actions / Advocates
  misSave:{key:'legal.mis.add_case', meta:function(){ try{ var r=misCollect()||{}; var t=r.cause_title||r.case_no; return t?{title:t, case_no:r.case_no||undefined, court:r.court||undefined}:null; }catch(e){ return null; } }}, misUpdate:{key:'legal.mis.edit_case', meta:usbMisMeta},
  // misDeleteSel is NOT mapped here on purpose - it logs directly, after the delete has actually
  // succeeded, and reads the cases before they are gone. See the note at its definition.
  misSetRange:{key:"legal.mis.filter_cases_by_hearing_date_range",
               meta:function(v){ return v?{range:String(v)}:null; }},
  misRangePick:{key:"legal.mis.filter_cases_by_hearing_date_range",
               meta:function(v){ return v?{range:String(v)}:null; }},
  misActionExecute:{key:'legal.mis.record_execute_a_case_action', meta:usbMisMeta},
  misActionSave:{key:'legal.mis.record_execute_a_case_action', meta:usbMisMeta},
  misSwipeToggle:{key:'legal.mis.mark_case_complete_reopen', meta:usbMisMeta},
  misDocsPick:{key:'legal.mis.upload_documents_for_a_case', meta:usbMisMeta},
  // misExportCauselist / misViewCauselist are NOT mapped here on purpose - they log directly,
  // after misBuildCauselist actually produces a sheet, so a click warned off for no date
  // range or no matching hearings doesn't count as a use the way the generic wrapper would.
  // misFilter / misAiSearch, legalActionsFilter, advFilter, hsFilter, trackerFilter,
  // inspRespFilter, inspLogFilter, compSearch, orgSearch are likewise NOT mapped here - every one
  // of them is wired to oninput for instant live filtering, and the generic wrapper logging on
  // every keystroke turned one real search into a burst of single/two-character fragments a few
  // milliseconds apart. Each logs directly via usageQueueDebounced, once typing actually settles.
  // advSave logs itself below - the same button adds AND edits, so a fixed key here counted
  // every edit as an advocate added.
  advDelete:{key:'legal.advocates.remove_advocate', meta:usbAdvMeta},
  // Human Resources
  // H/S Candidates was removed - nothing left to log.
  // Monthly Update no longer has cells anybody types into - the nine columns are counted from the
  // candidates - so the old create-month / add-row / edit-cell actions have nothing to log.
  // Which month was opened - the whole point of the action, and it is right there in the argument.
  muViewMonth:{key:"hr.monthly_update.open_a_month",
               meta:function(iso){ var l=muMonthLabel(iso); return l?{month:l}:null; }},
  // muDeleteSel logs directly (see below) after the delete actually succeeds, using the catalog's
  // real key 'delete_rows_or_whole_month' - the string that was here, 'remove_position_from_month',
  // does not exist in erp_feature_catalog and so could never be attributed to anything.
  /* Both of these are one button that goes two ways, and the way it went is the whole point. The
     position's name lands in Details; the decision gets its own column, so an approval and a
     rejection of the same requisition can be told apart at a glance instead of reading as the
     same row twice. */
  muApprove:{key:'hr.monthly_update.approve_reject_requisition',
             meta:function(manpowerId, ok){ return usbMuDecision(manpowerId, ok?'Approved':'Rejected'); }},
  muSetHiring:{key:'hr.monthly_update.close_reopen_hiring',
             meta:function(manpowerId, open){ return usbMuDecision(manpowerId, open?'Hiring reopened':'Hiring closed'); }},
  muFilter:'hr.monthly_update.search_filter_positions',
  trackerSave:{key:'hr.interview_tracker.add_interview', meta:function(){ try{ var a=$('trFName'),b=$('trFPos'); var nm=a&&a.value.trim(), p=b&&b.value.trim(); return (nm||p)?{title:nm||undefined, position:p||undefined}:null; }catch(e){ return null; } }}, trackerUpdate:{key:'hr.interview_tracker.edit_interview_entry', meta:usbTrkMeta},
  trackerDelete:{key:'hr.interview_tracker.delete_interview_entry_ies', meta:usbTrkMeta},
  trackerDeleteSel:'hr.interview_tracker.delete_interview_entry_ies',
  // trackerFilter is NOT mapped here - it logs directly via usageQueueDebounced.
  trResumeOpen:{key:'hr.interview_tracker.preview_download_candidate_cv', meta:usbTrkMeta},
  rsUploadSave:{key:'hr.resumes.upload_resume', meta:function(){ try{ var el=$('rsFile'); var f=el&&el.files&&el.files[0]; return f?{title:f.name}:null; }catch(e){ return null; } }}, rsPreview:{key:'hr.resumes.preview_download_resume', meta:usbResumeMeta},
  rsDownload:{key:'hr.resumes.preview_download_resume', act:'export', meta:usbResumeMeta}, rsDelete:{key:'hr.resumes.delete_resume_s', meta:usbResumeMeta},
  rsBulkDelete:'hr.resumes.delete_resume_s',
  // the AI resume search is gone - a plain name/file filter replaced it. rsDownload used to be
  // listed a second time on the next line, and the later, meta-less copy silently won - downloads
  // lost their Details for as long as both existed.
  rsFilter:'hr.resumes.search_resumes',
  igGenerate:'hr.interview_qs.generate_ai_interview_guide', igDelete:'hr.interview_qs.delete_interview_guide',
  // Recruitment (ATS)
  rtSave:{key:'recruitment.tests.add_test', meta:function(){ try{ var a=$('rtFName'); var nm=a&&a.value&&a.value.trim(); return nm?{title:nm}:null; }catch(e){ return null; } }}, rtUpdate:{key:'recruitment.tests.rename_test', meta:usbTestMeta},
  rtDelete:'recruitment.tests.delete_test_s',
  rtPreview:{key:"recruitment.tests.preview_test_responses_scores",
               meta:function(id){ var r=(RT_RECORDS||[]).find(function(x){return x.id===id;});
                 return r&&r.name?{title:r.name}:null; }},
  recJdSave:{key:'recruitment.descriptions.upload_job_description', meta:function(){ try{ var a=$('recJdName'); var nm=a&&a.value.trim(); return nm?{title:nm, position:nm}:null; }catch(e){ return null; } }},
  recJdOpen:{key:"recruitment.descriptions.preview_download_job_description",
               meta:function(id){ var j=(window._recAllJDs||[]).find(function(x){return x.id===id;});
                 return j&&(j.name||j.file_name)?{title:j.name||j.file_name}:null; }},
  recJdDownload:{key:"recruitment.descriptions.preview_download_job_description", act:'export',
               meta:function(id){ var j=(window._recAllJDs||[]).find(function(x){return x.id===id;});
                 return j&&(j.name||j.file_name)?{title:j.name||j.file_name}:null; }},
  recDeleteSel:'recruitment.descriptions.delete_job_description_s',
  mpSave:{key:'recruitment.manpower_form.submit_requisition', meta:function(){ try{ var d=mpCollect()||{}; return d.job_title?{title:d.job_title, position:d.job_title, department:d.department||undefined}:null; }catch(e){ return null; } }}, mpUpdate:{key:'recruitment.manpower_form.edit_requisition', meta:usbMpMeta},
  mpDeleteSel:'recruitment.manpower_form.delete_requisition_s',
  mpDeleteOne:{key:'recruitment.manpower_form.delete_requisition_s', meta:usbMpMeta},
  mpAiGenerate:{key:'recruitment.manpower_form.generate_jd_post_text_creative', meta:usbMpMeta},
  mpAiCopyPost:'recruitment.manpower_form.copy_platform_post_text',
  refSave:{key:'recruitment.referrals.refer_someone', meta:function(){ try{ var a=$('refFName'); var nm=a&&a.value&&a.value.trim(); return nm?{title:nm}:null; }catch(e){ return null; } }}, refDecide:{key:'recruitment.referrals.approve_reject_referral', meta:usbRefMeta},
  refDelete:{key:'recruitment.referrals.delete_referral', meta:usbRefMeta},
  /* Inspection. Every one of these carries the unit it happened to - the flat, floor, tower or
     project - because that is the fact an inspection row is useless without. New Inspection reads
     the form as it stands, Form Responses reads the submission that is open, and the Console
     reports whatever it is currently narrowed to. */
  inspSave:{key:'inspection.new_inspection.submit_inspection', meta:inspFormUnit},
  inspBulk:{key:'inspection.new_inspection.bulk_mark_all_items_ok', meta:inspFormUnit},
  inspPick:{key:'inspection.new_inspection.mark_item_ok_not_ok_n_a', meta:inspFormUnit},
  inspLevelPick:{key:'inspection.new_inspection.select_project_block_floor_flat_work_category', meta:inspFormUnit},
  inspDrill:{key:'inspection.console.drill_into_a_status_count', meta:inspScopeMeta},
  inspScope:{key:'inspection.console.filter_by_project_block_floor_flat_work_type',
             // called as inspScope(dim, val) - read the choice being made, not the state before it
             meta:function(dim,val){ const m=inspScopeMeta()||{};
               if(dim && val && val!=='All') m[String(dim)]=String(val);
               return m; }},
  inspOpenSub:{key:'inspection.responses.open_and_edit_a_submission', meta:inspSubUnit},
  inspEditSub:{key:'inspection.responses.open_and_edit_a_submission', meta:inspSubUnit},
  inspUpdateSub:{key:'inspection.responses.update_check_status_per_item', meta:inspSubUnit},
  inspBulkE:{key:'inspection.responses.bulk_mark_all_checks_ok', meta:inspSubUnit},
  // inspOpenPhoto only OPENS a photo for viewing - it was counted as adding one. The real
  // add happens on the submit, logged at its own source.
  // Campaign Analytics
  /* These three read the choice from the CLICK, not from the state. The wrapper logs before the
     wrapped function runs, so usbCmpMeta - which reads CMP_SOURCE and CMP_PERIOD - was reporting
     what the person switched AWAY from, not what they switched to. "Switched to Meta" recorded as
     Google is a wrong answer, and a quiet one. */
  cmpSetSource:{key:'campaigns.overview.switch_data_source_meta_google_both',
    meta:function(s){ const m=usbCmpMeta()||{}; if(s) m.source=String(s); return Object.keys(m).length?m:null; }},
  cmpSetPeriod:{key:'campaigns.overview.select_or_customize_date_range',
    meta:function(p){ const m=usbCmpMeta()||{}; if(p) m.period=String(p).replace(/_/g,' '); return Object.keys(m).length?m:null; }},
  cmpSetCustom:{key:'campaigns.overview.select_or_customize_date_range',
    meta:function(){ const m=usbCmpMeta()||{};
      const a=$('cmpSince'), b=$('cmpUntil');
      if(a&&a.value&&b&&b.value) m.period=a.value+' → '+b.value;
      return Object.keys(m).length?m:null; }},
  // cmpShowProject opens the same project drill-down modal from two places that are two distinct
  // catalog features - the Overview tab's chart bars and the By Project tab's table rows. The By
  // Project row's onclick now passes 'by_project' as a second argument so this resolver can tell
  // them apart; the Overview chart click passes nothing, which resolves to the Overview key.
  cmpShowProject:function(accId,srcTab){return srcTab==='by_project'?'campaigns.by_project.drill_into_a_project_s_campaigns':'campaigns.overview.drill_into_a_project_s_campaigns';},
  cmpSetStatus:{key:'campaigns.campaigns.filter_campaigns_by_project_status', meta:usbCmpMeta},
  cmpSetCampProject:{key:'campaigns.campaigns.filter_campaigns_by_project_status', meta:usbCmpMeta},
  cmpSetAdProject:{key:'campaigns.ads.filter_ads_by_project', meta:usbCmpMeta},
  // Internet Speed
  netRefresh:{key:'network.overview.refresh_speed_test_now', meta:usbNetMeta},
  // netRangeChange logs itself - the same picker serves both Network tabs, and a fixed key
  // here credited every All-readings filter to Overview.
  // Post Sales
  psaUploadStart:{key:'postsales.adhoc.upload_document_for_adhoc_replacement', meta:function(){ try{ var el=document.getElementById('psaFile'); var f=el&&el.files; return (f&&f.length)?{title:f[0].name, replacements:(f.length===1?'1 file':f.length+' files')}:null; }catch(e){ return null; } }},
  psaRenameSave:{key:'postsales.adhoc.rename_a_document', meta:usbPsaMeta},
  psaRemove:{key:'postsales.adhoc.remove_a_document', meta:usbPsaMeta}, psaPreview:{key:'postsales.adhoc.preview_a_document', meta:usbPsaMeta},
  psaDownloadOne:{key:'postsales.adhoc.download_a_document', meta:usbPsaMeta},
  psaDownloadAllZip:{key:'postsales.adhoc.download_all_documents_as_zip', meta:function(){ try{ var q=(typeof PSA!=='undefined'&&PSA&&PSA.queue)?PSA.queue.length:0; return q?{replacements:q+' document'+(q===1?'':'s')}:null; }catch(e){ return null; } }},
  // Procurement / Projects / Construction — previously untracked
  procUploadSave:{key:'procurement.quote_comp.upload_document', meta:usbProcCat}, procEditSave:{key:'procurement.quote_comp.rename_replace_document', meta:function(id,cat){ return usbProcCat(cat); }},
  procDeleteSel:{key:'procurement.quote_comp.delete_document_s', meta:usbProcCat}, procDownloadSel:{key:'procurement.quote_comp.download_document_s', meta:function(){ try{ var k=(typeof PROC!=='undefined'&&PROC)?PROC.sel.size:0; return {category:(typeof PROC!=='undefined'&&PROC&&PROC.tab)||undefined, replacements:k?k+' file'+(k===1?'':'s'):undefined}; }catch(e){ return null; } }},
  vtBuToggle:'procurement.vendor_trends.filter_by_business_unit',
  vtOpenVendor:{key:'procurement.vendor_trends.view_vendor_detail_spend_history', meta:usbVendorMeta},
  // Finance / Compliance / Documents / Video — previously untracked
  // Same trap as cmpSetSource: docPickCat(c) is what SETS DOC.cat, and the wrapper logs before it
  // runs - so usbDocScope() would read the folder being left, not the one being opened, and picking
  // "All" would record whatever folder happened to be open before it. The picked value is the
  // argument, so take it from there. Nothing wrong is stored yet: this feature has 0 uses so far.
  docPickCat:{key:'documents.department_library.browse_filter_by_category_folder',
    meta:function(c){ try{ var d=(typeof DOC!=='undefined')?DOC:null; var out={};
      if(d&&d.dept) out.department=String(d.dept);
      out.folder=c?String(c):'All';
      return out; }catch(e){ return null; } }},
  // Competitors / Organic / Scaling / Playbook — previously untracked
  compShowOnly:{key:'competitors.overview.drill_into_a_single_competitor', meta:usbCompMeta},
  compSetFilter:{key:'competitors.overview.filter_by_competitor_date_range_status_or_media', meta:usbCompMeta},
  compSetDate:{key:'competitors.overview.filter_by_competitor_date_range_status_or_media', meta:usbCompMeta},
  // compSave, compManualPull, compToggleActive, compRemove and
  // compOpenDetail are NOT mapped here on purpose - each has a real success/failure (or
  // found/not-found, or confirmed/cancelled) branch and logs directly, only once that branch is
  // actually known, same as misExportCauselist/taskSave above. compSearch is likewise unmapped -
  // see the oninput/usageQueueDebounced note further up.
  orgSetPeriod:{key:'organic.all_content.filter_by_date_range', meta:usbOrgMeta},
  orgSetNet:{key:'organic.all_content.filter_by_network_content_type_or_page', meta:usbOrgMeta},
  orgSetKind:{key:'organic.all_content.filter_by_network_content_type_or_page', meta:usbOrgMeta},
  orgSetPageId:{key:'organic.all_content.filter_by_network_content_type_or_page', meta:usbOrgMeta},
  orgSetSort:{key:'organic.all_content.sort_content_by_metric', meta:usbOrgMeta},
  orgOpen:{key:'organic.all_content.view_post_detail', meta:usbOrgMeta}
  // orgApplyCustom is NOT mapped here on purpose - it has real validation (missing dates, From
  // after To) and logs directly, same reason as compSave above. orgSearch is likewise unmapped -
  // see the oninput/usageQueueDebounced note further up. Scaling Up and Playbook are both
  // entirely static, hardcoded screens (no wired buttons at all) - see USAGE_VIEWS instead.
};
/* Some features ARE looking at something — Archive, the Scoreboard, the Calendar, the campaign and
   speed-test tables. Wrapping buttons can never catch those: there is no button, the act is opening
   the tab. They stayed empty no matter how often anyone used them, which reads as "nobody goes
   there" when it actually meant "nothing here reports".
   Keyed on page/tab. The numeric ones are the tab index the module already routes on. */
const USAGE_VIEWS={
  /* Two catalog features describe this one screen: the month/week/day calendar itself, and the fact
     that tasks, meetings and Legal hearing dates all land on it together. The second had no mapping
     anywhere in the app, so it was the only active feature in the whole catalogue guaranteed to read
     zero forever - not because nobody opens the calendar, but because nothing reported it. Logged as
     an array (same shape network/0 already uses) so one look at the screen counts once for each,
     rather than a second navigation being invented to carry it. */
  'tasks/calendar':      ['tasks.calendar.view_month_week_day_calendar',
                           'tasks.calendar.see_tasks_meetings_and_legal_dates_in_one_view'],
  'tasks/archive':       'tasks.archive.view_completed_archived_tasks',
  'tasks/scoreboard':    'tasks.scoreboard.view_task_completion_leaderboard',
  'campaigns/0':         'campaigns.overview.view_spend_leads_cost_charts',
  'campaigns/1':         'campaigns.campaigns.view_campaign_performance_list',
  'campaigns/2':         'campaigns.by_project.view_per_project_rollup_table',
  'campaigns/3':         'campaigns.ads.view_ad_level_performance_table',
  'campaigns/4':         'campaigns.trend.view_spend_results_trend_vs_previous_period',
  'campaigns/5':         'campaigns.ad_fatigue.view_fatigue_ranking_by_ad_campaign',
  // Overview is one render that shows five distinct catalog features at once (live status, the
  // three KPI cards, the chart, and the settings block) - USAGE_VIEWS values can now be an array
  // so a single navigation logs all of them, instead of only the first one ever tracked here.
  'network/0':           ['network.overview.view_live_monitoring_status',
                           'network.overview.view_latest_download_upload_ping_readings',
                           'network.overview.view_low_reading_count_24h',
                           'network.overview.view_speed_over_time_chart',
                           'network.overview.view_monitoring_threshold_settings'],
  'network/1':           'network.all_readings.view_full_readings_table',
  // Console is Inspection's default landing tab, reached with NO segment in the hash at all
  // (inspGo builds a bare '#/inspection' for it) - usageViewTick's own fallback for "no segment"
  // is the string '0', not the tab's name, so the key has to be '0' to ever actually match.
  'inspection/0':        'inspection.console.view_inspection_kpis_and_breakdowns',
  // Procurement / Projects / Construction — previously untracked
  'procurement/4':       'procurement.vendor_trends.view_spend_kpis_trend_charts',
  'projects/0':          'projects.overview.view_ongoing_sold_out_projects_gallery',
  // Finance / Compliance / Documents / Video — previously untracked
  'finance/0':           'finance.overview.view_collections_payables_cash_summary',
  'compliance/0':        'compliance.compliance_calendar.view_statutory_contractual_due_dates',
  'compliance/1':        'compliance.licences_repository.view_licences_registrations_expiry_status',
  'compliance/2':        'compliance.warranties_guarantees.view_amc_warranty_expiry_status',
  'documents/0':         'documents.libraries.view_department_galleries_pinned_recent',
  'documents/dept':      'documents.department_library.view_department_library',
  'documents/all':       'documents.all_documents.view_all_documents_across_departments',
  'documents/search':    'documents.search.view_document_search_results',
  'video/0':             'video.all_videos.view_all_videos_grid',
  'video/1':             'video.training.view_training_videos',
  'video/2':             'video.youtube.view_youtube_videos',
  'video/3':             'video.walkthrough.view_walkthrough_videos',
  // Competitors / Organic / Scaling / Playbook — previously untracked
  'competitors/0':       'competitors.overview.view_competitor_watchlist_and_stored_ads',
  'organic/0':           'organic.overview.view_engagement_overview_by_type_and_page',
  'organic/1':           'organic.all_content.view_all_posts_and_reels_list',
  'organic/2':           'organic.top_performers.view_top_20_posts_by_engagement',
  // Scaling Up and Playbook are entirely static, hardcoded screens (no wired buttons anywhere -
  // the "pills" and search box on Playbook's All plays tab carry no onclick/oninput at all), so
  // opening each tab is the only distinguishable action there is.
  'scaling/0':           'scaling.strategy_opsp.view_purpose_values_bhag_targets',
  'scaling/1':           'scaling.priorities_rocks.view_quarterly_rocks_progress',
  'scaling/2':           'scaling.kpi_scoreboard.view_kpi_targets_vs_actuals',
  'scaling/3':           'scaling.meeting_rhythm.view_meeting_cadence_schedule',
  'scaling/4':           'scaling.learning_hub.view_learning_resources_list',
  'playbook/0':          'playbook.all_plays.view_process_playbook_list',
  'playbook/1':          'playbook.featured_play.view_featured_play_steps',
  'playbook/2':          'playbook.roles_raci.view_raci_roles_by_step',
  // Helpdesk / Reports / Inventory / Maintenance — previously untracked
  // Assistant is Help Desk's default landing tab, reached with NO segment in the hash at all
  // is the string '0', not the tab's name, so '0' has to be listed too for that landing to ever
  // match; clicking the Assistant tab explicitly (from Tickets) sets the hash to 'assistant' instead.
  'inventory/2':         'inventory.indents_rfq.view_indent_rfq_pipeline',
  'inventory/3':         'inventory.quote_comparison.view_quote_comparison',
  'inventory/4':         'inventory.purchase_orders.view_purchase_orders',
  'inventory/5':         'inventory.grn_qc.view_grn_qc_status',
  'inventory/6':         'inventory.stock_ledger.view_stock_ledger',
  'inventory/7':         'inventory.admin.view_admin',
  'inventory/0':         'inventory.setup.view_setup',
  'inventory/1':         'inventory.vendors.view_vendors',
  'maintenance/0':       'maintenance.asset_register.view_asset_register',
  'maintenance/1':       'maintenance.preventive_maintenance.view_pm_schedule',
  'maintenance/2':       'maintenance.breakdowns_repairs.view_breakdown_repair_tickets',
  'maintenance/3':       'maintenance.location_wise.view_assets_by_location',
  // GTD / CRM / Dashboard — previously untracked. All three are entirely static/hardcoded
  // demo screens (no wired buttons anywhere - GTD's Capture/Clarify buttons and CRM's tab
  // bodies carry no onclick besides mTabs' own tab-switch navTo), so opening each tab is the
  // only distinguishable action there is. Dashboard has no tabs at all - a bare landing and
  // every navTo('dashboard') both fall through usageViewTick's no-segment default of '0'.
  'transcription/4':     'transcription.discrepancies.view_calls_flagged_with_a_data_mismatch',
  'transcription/5':     'transcription.compilation.view_a_lead_s_combined_call_history',
  'transcription/view':  'transcription.call_detail.view_qualification_checklist_and_entities',
  'dashboard/0':         'dashboard.overview.view_home_dashboard_summary',
  'accounts/0':          'accounts.transactions.view_transactions',
  'accounts/1':          'accounts.ledgers_postings.view_ledgers_postings',
  'gtd/0':               'gtd.inbox.view_capture_inbox_clarify_queue',
  'gtd/1':               'gtd.next_actions.view_next_actions_by_context',
  'gtd/2':               'gtd.projects.view_active_projects_next_steps',
  'gtd/3':               'gtd.waiting_for.view_items_waiting_on_others',
  'gtd/4':               'gtd.someday_maybe.view_someday_maybe_ideas_list',
  'gtd/5':               'gtd.weekly_review.view_weekly_review_checklist',
  // CRM & Sales is a single screen now - the eight demonstration tabs that used to be listed here
  // are gone, and with them the eight keys that recorded somebody opening a mock-up.
  'crm/0':               'crm.daily_updates.view_daily_crm_updates'
};
let USAGE_LAST_VIEW='', USAGE_LAST_VIEW_AT=0;
function usageViewTick(){
  try{
    let seg=location.hash.replace(/^#\/?/,'').split('/').filter(Boolean);
    if(seg[0]===PAGE) seg=seg.slice(1);
    // No tab in the hash means the module's own first tab, which each one indexes from 0.
    const tab=(seg[0]!==undefined&&seg[0]!=='')?String(seg[0]):(PAGE==='tasks'?'work':'0');
    const key=USAGE_VIEWS[PAGE+'/'+tab];
    if(!key) return;
    /* renderPage can fire twice for one navigation - accountability.js re-renders defensively after
       it loads - and two events for one look would overstate every view feature. Dedup on the hash
       segment itself, not the resolved key(s), so a tab mapped to SEVERAL distinct catalog features
       (e.g. network/0's Overview widgets) still collapses to one log per look instead of one per key. */
    const dedupeId=PAGE+'/'+tab;
    const now=Date.now();
    if(dedupeId===USAGE_LAST_VIEW && (now-USAGE_LAST_VIEW_AT)<3000) return;
    USAGE_LAST_VIEW=dedupeId; USAGE_LAST_VIEW_AT=now;
    /* Opening a screen has no object behind it, but on some modules it does have a CONTEXT worth
       recording - which date range the Internet Speed chart is on, which period and source the
       campaign numbers are for, which department's library is open. Without it every view of those
       screens reads identically, and the last column has nothing to show. */
    const vm=(USAGE_VIEW_META[PAGE]&&USAGE_VIEW_META[PAGE]())||null;
    // whatever screen they were on is now finished - close it before opening the next
    usageCloseView();
    const drawn=[];
    (Array.isArray(key)?key:[key]).forEach(function(k){
      // cleared first, so a key usageQueue refuses (no feature, not signed in) cannot make the
      // previous event get described a second time
      USAGE_LAST_QUEUED=null;
      usageQueue(k,'view',vm?Object.assign({},vm):null);
      if(USAGE_LAST_QUEUED) drawn.push(USAGE_LAST_QUEUED);
    });
    // 700ms is after the render this navigation triggered and long before the batch is sent.
    if(drawn.length) setTimeout(function(){ usageDescribeScreen(drawn); }, 700);
    // held from here until they leave, so the event can carry how long they stayed
    USAGE_OPEN_VIEW={evs:drawn, at:Date.now()};
  }catch(e){}
}
/* The verb the report prints in its Action column. It used to be guessed from the JavaScript
   FUNCTION'S name, which records how the code happens to be written rather than what the person
   did - and the two drift apart badly. cmpSetPeriod contains "set", so changing the date filter on
   a read-only spend chart was filed as "update": somebody who did nothing but look at last month's
   numbers appeared in the report to have edited something. accSubDel contains no word the list
   recognised, so deleting a sub-task fell through to "view" - the same mistake pointing the other
   way, and the more dangerous one, because the report then says nobody deleted anything.
   "Delete an instance" ended up split 17 "delete" / 7 "view" purely on which code path logged it.
   The feature key already states the act, in words written for a human to read -
   "filter_cases_by_hearing_date_range", "delete_an_instance", "switch_data_source". Reading the verb
   from there is not a guess, and it stays right for features nobody has written yet: a new key
   named after what it does is labelled correctly the first time it is ever clicked.
   The old name-based guess survives only as a fallback for the few callers that log a bare module
   key with no feature part on it. */
function usageActionFromKey(key){
  const parts=String(key||'').split('.');
  if(parts.length<3) return null;
  // "bulk_" only says how many; the verb is whatever follows it (bulk_mark_all_ok is still a mark).
  const leaf=parts.slice(2).join('.').toLowerCase().replace(/^bulk_/,'');
  if(!leaf) return null;
  if(/^(delete|remove|cancel)_/.test(leaf))                            return 'delete';
  if(/^(download|export|print|copy)_/.test(leaf))                      return 'export';
  if(/^(filter|search|sort|ask)_/.test(leaf) || /_search(_|$)/.test(leaf)) return 'search';
  // only a leading or trailing "upload" is a file going up - "download_upload_ping_readings" is a
  // network measurement, and matching the word anywhere would have filed reading it as a create.
  if(/^upload_/.test(leaf) || /_upload$/.test(leaf))                   return 'create';
  if(/^(view|open|browse|select|switch|drill|preview|see|play|read|expand|show|join|click|refresh|disabled)_/.test(leaf)) return 'view';
  if(/^(add|create|new|submit|save|raise|start|log|record|attach|post|insert|comment|schedule|refer|generate|email|share|fetch)_/.test(leaf)) return 'create';
  if(/^(update|edit|rename|move|mark|approve|decline|reject|forward|revert|reopen|toggle|set|assign|delegate|change|complete|replace|pin|restore|retry|receive|reschedule|drag|close|rebuild|ai)_/.test(leaf)) return 'update';
  return 'view';
}
function usageAction(fn, key){
  const fromKey=usageActionFromKey(key);
  if(fromKey) return fromKey;
  if(/delete|remove|dismiss/i.test(fn))            return 'delete';
  if(/download|export|print/i.test(fn))            return 'export';
  if(/filter|search/i.test(fn))                    return 'search';
  if(/save|create|add|upload|submit|new/i.test(fn))return 'create';
  /* Approving, forwarding and rejecting are all changes of state, and the server's vocabulary has no
     verb of their own for them - without this line they fell through to "view", which reads as
     somebody merely looking at a task they in fact approved. */
  if(/approve|decline|forward|reject|receive|revert|reopen|done|retry|restore|share|generate|complete/i.test(fn)) return 'update';
  if(/update|edit|rename|pin|move|replace|toggle|set/i.test(fn)) return 'update';
  return 'view';
}
let USAGE_Q=[], USAGE_TIMER=null;
/* The event the most recent click queued, and when. Only ever read by the confirm-dialog retraction
   above: an "are you sure?" that opens within a moment of a click is that click's dialog, and a
   "no" means the thing the event claims happened never did. 1.5s is generous for a modal that opens
   in the same call stack as the click, and tight enough that an older, unrelated event can never be
   mistaken for this one. Held here rather than on the event itself so nothing extra travels to the
   server in the batch payload. */
let USAGE_LAST_EV=null, USAGE_LAST_AT=0, USAGE_LAST_QUEUED=null;
/* ---- How long somebody actually stayed on a screen -------------------------------------------
   A read-only screen has one honest usability question: was it read, or bounced off? Opening the
   Scoreboard for six seconds and sitting with it for six minutes are different facts, and the
   report could tell them apart for none of its 1,000-odd view events.
   duration_ms has been on the events table from the start, erp_log_usage already reads it out of
   the payload, and in 9,258 events not one has ever carried a value - the browser simply never
   sent one. This fills it in.
   The catch is timing: the event is queued the moment the screen opens, and the batch leaves eight
   seconds later, long before anybody has finished reading. So the view event is HELD back - kept in
   the queue, skipped by the flush - until the person navigates away, hides the tab or closes it.
   Then its duration is stamped on and it goes with the next batch.
   Holding it is safe because every exit path closes it: the next navigation, visibilitychange, and
   the unload flush. The count itself is never at risk - the event exists in the queue from the
   first moment, so the worst case is a use recorded without a duration, never a lost use. */
let USAGE_OPEN_VIEW={evs:[], at:0};
const USAGE_MAX_VIEW_MS=4*60*60*1000;   // a tab left open overnight is not four hours of reading
function usageSpan(ms){
  const s=Math.round(ms/1000);
  if(s<60) return s+'s';
  const m=Math.floor(s/60); if(m<60) return m+'m'+(s%60?' '+(s%60)+'s':'');
  const h=Math.floor(m/60); return h+'h'+(m%60?' '+(m%60)+'m':'');
}
function usageCloseView(){
  try{
    const open=USAGE_OPEN_VIEW;
    USAGE_OPEN_VIEW={evs:[], at:0};
    if(!open.evs.length || !open.at) return;
    const ms=Date.now()-open.at;
    if(ms>0 && ms<USAGE_MAX_VIEW_MS){
      const span=usageSpan(ms);
      open.evs.forEach(function(ev){
        ev.duration_ms=ms;                                   // the column that has always been there
        ev.meta=Object.assign({}, ev.meta||{}, {time_spent:span});  // and a readable copy for the report
      });
    }
    // the flush timer may have given up while the only thing queued was being held
    if(USAGE_Q.length && !USAGE_TIMER) USAGE_TIMER=setTimeout(usageFlush, 8000);
  }catch(e){ USAGE_OPEN_VIEW={evs:[], at:0}; }
}
// Everything queued EXCEPT a view still being timed. Used instead of splicing from the front, so
// one held event cannot block the batch behind it.
function usageTakeBatch(n){
  const out=[];
  for(let i=0;i<USAGE_Q.length && out.length<n;i++){
    if(USAGE_OPEN_VIEW.evs.indexOf(USAGE_Q[i])!==-1) continue;
    out.push(USAGE_Q[i]);
  }
  out.forEach(function(ev){ const i=USAGE_Q.indexOf(ev); if(i!==-1) USAGE_Q.splice(i,1); });
  return out;
}
/* What was actually on the screen, written onto a "view" event after the screen has drawn.
   Opening a tab is the one kind of action with no object behind it - no task, no document, nobody
   it went to - so the report's Details column has always been a dash for all 984 of them, and there
   is nothing in the database that could ever fill it in, because nothing specific happened. What
   CAN be said is what the person was looking at: "View completed/archived tasks - 128 rows" answers
   the next question, where a bare dash answers none.
   It has to run after the render, so the event is queued first and annotated a moment later - the
   batch does not leave for eight seconds, so there is time. If the screen has no table, or the
   event has already gone, nothing is written and the dash stays honest. */
function usageDescribeScreen(evs){
  try{
    const v=$('view'); if(!v) return;
    const n=v.querySelectorAll('table tbody tr').length;
    if(!n) return;
    evs.forEach(function(ev){
      // merged into whatever context the navigation already recorded, rather than replacing it:
      // "Last 3 days" and "50 rows" are both worth having, and neither is the other.
      if(USAGE_Q.indexOf(ev)!==-1){
        ev.meta=Object.assign({}, ev.meta||{}, {showing:n+' row'+(n===1?'':'s')});
      }
    });
  }catch(e){}
}
/* Screen-level context per module, for "opened a screen" events only. Deliberately short: a module
   belongs here when the screen genuinely has a state worth recording, not just to fill the column.
   Transcription is absent on purpose - viewing the call list is not about any one call, and
   attaching the last-opened one would be a wrong answer dressed as a right one. */
const USAGE_VIEW_META={
  network:    function(){ return usbNetMeta(); },
  campaigns:  function(){ return usbCmpMeta(); },
  documents:  function(){ return usbDocScope(); },
  /* Accountability's only screen with a screen-level state worth recording is the Calendar, and it
     keeps that state in accountability.js's own closure - hence the window hop. It returns null off
     the Calendar tab, so the Tasks, Workflow, Archive and Scoreboard views are unaffected. */
  tasks:      function(){ try{ return (window.gcalUsageMeta && window.gcalUsageMeta()) || null; }
                          catch(e){ return null; } }
};
function usagePendingClick(){
  return (USAGE_LAST_EV && (Date.now()-USAGE_LAST_AT)<1500) ? USAGE_LAST_EV : null;
}
function usageRetract(ev){
  if(!ev) return false;
  const i=USAGE_Q.indexOf(ev);
  if(i===-1) return false;                       // already flushed - too late to take it back
  USAGE_Q.splice(i,1);
  if(USAGE_LAST_EV===ev){ USAGE_LAST_EV=null; USAGE_LAST_AT=0; }
  return true;
}
// During an extended outage the queue would otherwise grow without bound; past this it's the
// freshest activity that's kept, not the oldest, since an approximate recent picture beats an
// exact but ancient one for a report read in terms of "the last 30 days".
const USAGE_MAX_Q=600;
// meta is the specific thing the action was ABOUT - a task's title, a search query, who a claim
// was delegated to - not just that the feature fired. Optional and feature-by-feature: most call
// sites still pass nothing, same as before this existed. erp_log_usage only keeps it when it is a
// plain object, so anything else here is silently dropped rather than corrupting the row.
// project is the 4th argument rather than a meta key because erp_usage_events has had a dedicated
// project column since the table was created - and it was still empty on every one of the 7,500+
// rows logged so far, because nothing ever passed one. It is the project a task/record belongs to,
// which the Usability report shows in its own column; a call site that doesn't know one passes
// nothing, exactly as before. Trimmed to 64 chars because that is what erp_log_usage stores.
/* A once-only id for each event, so a batch that arrives at the server twice is only stored once.
   This is not hypothetical: 28 events are sitting in the table as exact duplicates - same person,
   same feature, same microsecond - and the retry path is how they got there. usageFlush puts a
   failed batch back on the queue and sends it again, but "failed" from the client's side includes
   the case where the server committed the rows and the response was lost on the way back (a tab
   going hidden mid-request does exactly this, which is why forwarding and receiving workflow steps
   - clicked and immediately navigated away from - are the worst affected). The client cannot tell
   that apart from a real failure, and it should not have to: the id makes re-sending harmless, so
   the retry stays as safe as it is useful. randomUUID needs a secure context; the fallback is only
   ever reached on http or a very old browser, and being unique per event is all that is asked of
   it. */
function usageEventId(){
  try{ if(window.crypto&&crypto.randomUUID) return crypto.randomUUID(); }catch(e){}
  return 'x'+Date.now().toString(16)+'-'+Math.random().toString(16).slice(2,10)
        +'-'+Math.random().toString(16).slice(2,10);
}
function usageQueue(featureKey, action, meta, project){
  if(!featureKey || !(state&&state.email)) return;
  const ev={module_id:String(featureKey).split('.')[0], feature_key:featureKey,
                action:action||'view', occurred_at:new Date().toISOString(), eid:usageEventId()};
  if(meta && typeof meta==='object') ev.meta=meta;
  if(project) ev.project=String(project).trim().slice(0,64) || undefined;
  USAGE_Q.push(ev);
  USAGE_LAST_EV=ev; USAGE_LAST_AT=Date.now();    // so a refused confirm can take it back out again
  USAGE_LAST_QUEUED=ev;                          // and so a view can be described once it has drawn
  if(USAGE_Q.length>USAGE_MAX_Q) USAGE_Q.splice(0, USAGE_Q.length-USAGE_MAX_Q);
  // 60 is the server's own per-call ceiling; flush before reaching it rather than losing the tail.
  if(USAGE_Q.length>=40){ usageFlush(); }
  else if(!USAGE_TIMER){ USAGE_TIMER=setTimeout(usageFlush, 8000); }
}
// For a search/filter box wired to oninput (fires on every keystroke): logging through the
// generic USAGE_MAP wrapper turned one real search into a burst of near-duplicate events a few
// milliseconds apart (typing "182" logged "1", "18" and "182" as three separate uses) - both
// inflating the count wildly and flooding the Usability report's per-person Details view with
// noise. This logs only the SETTLED value, once typing actually pauses; a fresh keystroke
// within the delay cancels the pending log and restarts the wait, same idea as debouncing a
// live-filter re-render, just applied to telemetry instead of the DOM. Empty/cleared input logs
// nothing - clearing a search box is not itself a search.
const USAGE_DEBOUNCE_T={};
function usageQueueDebounced(featureKey, val, action, delay){
  clearTimeout(USAGE_DEBOUNCE_T[featureKey]);
  if(!val) return;
  USAGE_DEBOUNCE_T[featureKey]=setTimeout(function(){
    try{ usageQueue(featureKey, action||'search', {query:String(val)}); }catch(_e){}
  }, delay||800);
}
/* A failed send used to just discard its batch — one network blip during the retry window silently
   erased that activity from the report, with nothing anywhere to show it had ever happened. A failed
   batch now goes back on the front of the queue, tagged with a try count, so the next flush (8s later,
   or the next click that tops up the queue) has another go — capped at 5 tries so a batch that's
   failing for a real reason (malformed row, RPC actually broken) can't retry forever. */
async function usageFlush(){
  if(USAGE_TIMER){ clearTimeout(USAGE_TIMER); USAGE_TIMER=null; }
  if(!USAGE_Q.length) return;
  const batch=usageTakeBatch(60);
  if(!batch.length) return;                // only a view still being timed - nothing to send yet
  try{
    const {error}=await sb.rpc('erp_log_usage',{p_events:batch});
    if(error) throw error;
  }catch(e){
    batch.forEach(function(ev){ ev._tries=(ev._tries||0)+1; });
    USAGE_Q=batch.filter(function(ev){ return ev._tries<5; }).concat(USAGE_Q);
    if(!USAGE_TIMER && USAGE_Q.length) USAGE_TIMER=setTimeout(usageFlush, 8000);
  }
}
/* pagehide/visibilitychange used to point straight at usageFlush — an async function whose promise
   the browser never waits for, so the request it kicks off can be, and regularly was, cut off
   mid-flight by the very unload it was reacting to. The last few seconds of activity before every
   tab close or navigation-away were silently lost this way, with no error anywhere to show it.
   A keepalive fetch is the one request type a browser guarantees to actually send even after the
   page has started unloading. It can't go through supabase-js — that's a plain async call under the
   hood, the same problem all over again — so it's built here from the token boot() already keeps
   cached for exactly this: a fetch fired from an unload handler can't safely await getSession(). */
function usageFlushOnUnload(){
  // the screen is going away, so whatever was being timed is finished - stamp it and send it too
  usageCloseView();
  if(USAGE_TIMER){ clearTimeout(USAGE_TIMER); USAGE_TIMER=null; }
  if(!USAGE_Q.length || !USAGE_TOKEN) return;
  const batch=USAGE_Q.splice(0, 60);
  fetch(SUPABASE_URL+'/rest/v1/rpc/erp_log_usage',{
    method:'POST', keepalive:true,
    headers:{'Content-Type':'application/json','Authorization':'Bearer '+USAGE_TOKEN,'apikey':SUPABASE_KEY},
    body:JSON.stringify({p_events:batch})
  }).catch(function(){
    // Only reachable if this context is still alive to see it — a hidden-but-not-closing tab.
    // An actual unload destroys the page before this callback could ever run either way.
    batch.forEach(function(ev){ ev._tries=(ev._tries||0)+1; });
    USAGE_Q=batch.filter(function(ev){ return ev._tries<5; }).concat(USAGE_Q);
  });
}
function usageInstall(){
  let n=0;
  /* Navigation is the event for a view feature, and renderPage is the one place every navigation
     goes through — the hashchange listener, boot, and each in-page tab click all land here. Also
     used to re-run usageInstall on every navigation (below), not just twice near page load: a
     function defined later than that — a slow connection, a tab whose handlers only exist once it's
     first opened — would otherwise go permanently untracked with no sign anything was missed. */
  if(typeof window.renderPage==='function' && !window.renderPage.__usageViewWrapped){
    const origRender=window.renderPage;
    const wrappedRender=function(){
      const r=origRender.apply(this,arguments);
      try{ usageViewTick(); usageInstall(); }catch(e){}
      return r;
    };
    wrappedRender.__usageViewWrapped=true;
    try{ window.renderPage=wrappedRender; }catch(e){}
  }
  Object.keys(USAGE_MAP).forEach(function(fn){
    const orig=window[fn];
    if(typeof orig!=='function' || orig.__usageWrapped) return;
    const mapped=USAGE_MAP[fn];

    // Most entries are one function, one feature - a plain string. A few functions do two different
    // things depending on an argument (taskSave(kind) creates a task OR delegates one from the same
    // modal and Save button), and a fixed string would count every delegation as "create task" while
    // "delegate a task" itself never fired. Those entries are a resolver instead: called with the
    // same arguments as the wrapped function, returning whichever feature key actually happened.
    // A THIRD shape, {key, meta}, additionally captures the specific thing the action was about -
    // only usable when that thing is itself one of the wrapped function's own arguments (a search
    // box's typed value, say); anything read from the DOM inside the function's own body is outside
    // what a wrapper can see, and is logged directly at the source instead (see crystallizeAndSwap).
    const isDescriptor=mapped&&typeof mapped==='object'&&('key' in mapped);
    const keySrc=isDescriptor?mapped.key:mapped;
    // act: is the escape hatch for the few rows where one catalogue entry covers two different
    // buttons - "Preview / Download document" is one feature but a preview is not an export, and
    // only the function that was actually called knows which of the two happened.
    const actOverride=(isDescriptor && mapped.act) ? mapped.act : null;

    const metaFn=isDescriptor?mapped.meta:null;
    const wrapped=function(){
      try{
        const key=(typeof keySrc==='function') ? keySrc.apply(this, arguments) : keySrc;
        if(key){
          let meta=null;
          if(metaFn){ try{ meta=metaFn.apply(this, arguments); }catch(_e){} }
          usageQueue(key, actOverride || usageAction(fn, key), meta);

        }
      }catch(e){}
      return orig.apply(this, arguments);      // called through no matter what happened above
    };
    wrapped.__usageWrapped=true;
    try{ window[fn]=wrapped; n++; }catch(e){}
  });
  return n;
}
/* Installed twice near load on purpose: accountability.js loads AFTER this file and defines its own
   globals, so a single pass here would wrap only half the map. Every navigation re-runs it too (see
   usageInstall's own wrap of renderPage above) — the __usageWrapped guard makes every pass past the
   first free and idempotent, so this costs nothing and closes the gap a fixed timeout can't. */
window.addEventListener('load', function(){ usageInstall(); setTimeout(usageInstall, 2000); });
// Anything still queued when the tab goes away would otherwise be lost.
window.addEventListener('pagehide', usageFlushOnUnload);
document.addEventListener('visibilitychange', function(){ if(document.visibilityState==='hidden') usageFlushOnUnload(); });
