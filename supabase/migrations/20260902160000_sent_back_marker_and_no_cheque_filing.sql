/* Two fixes to how a bill's state is recorded.

   1. "SENT BACK" STUCK FOREVER. wf_reject(id,reason) set flow_cases.returned_at and nothing ever
      cleared it - not wf_forward, not the cheque-choice forward. The tracker shows "Sent back"
      whenever the current step's case carries that marker, so a bill sent back once, corrected and
      passed on kept reading Sent Back at every later step. Meanwhile the ONE-argument reject - the
      one the Reject button actually calls - never set the marker at all, so an ordinary rejection
      showed "Waiting" instead of "Sent back".

      Both are the same question - has this instance been pushed backwards, and has it since moved
      on - and it is answered by what happens to the STEPS. So it is answered here, rather than
      inside two long functions being edited for other reasons, and it holds for every path
      including ones written later:

        a completed step becoming incomplete -> pushed back -> mark the case returned
        a step being completed               -> moved on    -> clear the marker

      Deliberately not keyed on "reject": a revert pushes work back too, and reads the same to
      whoever is looking at the row.

   2. NO CHEQUE SKIPPED THE FILING. The No-Cheque path skipped steps 7 to 12, but 12 is Bill Filing,
      which is not cheque work - it is what happens to the paperwork of every bill however it was
      settled. A No-Cheque bill therefore finished at GST Approval and was never filed, which is the
      one step you would least want silently dropped, the filing being the audit trail. The list is
      now 7..11. */

create or replace function acc.wf_mark_returned_from_steps()
 returns trigger language plpgsql security definer set search_path to 'acc','public'
as $function$
begin
  if old.forwarded_at is not null and new.forwarded_at is null then
    update acc.flow_cases set returned_at = now()
     where id = new.case_id and returned_at is null;
  elsif old.forwarded_at is null and new.forwarded_at is not null then
    update acc.flow_cases set returned_at = null, returned_reason = null
     where id = new.case_id and returned_at is not null;
  end if;
  return null;
end; $function$;

drop trigger if exists trg_wf_mark_returned_from_steps on acc.flow_case_steps;
create trigger trg_wf_mark_returned_from_steps
  after update of forwarded_at on acc.flow_case_steps
  for each row
  when (old.forwarded_at is distinct from new.forwarded_at)
  execute function acc.wf_mark_returned_from_steps();

create or replace function acc.wf_forward_rtp_cheque_choice(p_fcs_id bigint, p_cheque boolean)
 returns void
 language plpgsql security definer set search_path to 'acc','public'
as $function$
declare v_email text := app.current_user_email(); v acc.flow_case_steps; v_flow_id bigint;
begin
  select * into v from acc.flow_case_steps where id=p_fcs_id;
  if not found then raise exception 'step not found'; end if;
  if lower(coalesce(v.person,'')) <> lower(coalesce(v_email,'')) then raise exception 'not your step'; end if;

  select flow_id into v_flow_id from acc.flow_cases where id=v.case_id;
  if v_flow_id is distinct from 26 or v.seq is distinct from 5 then
    raise exception 'The Cheque / No Cheque choice only applies to the RTP / Schedule Payment step of Invoice Processing';
  end if;

  if not p_cheque then
    /* GST Approval still happens, and so does Bill Filing - only the cheque-specific steps between
       them are dropped. Recorded on the case so wf_materialise_steps never brings them back on a
       later forward, and set BEFORE the delete so a failure part way cannot leave rows gone with
       nothing recording why. */
    update acc.flow_cases set skipped_seqs=array[7,8,9,10,11] where id=v.case_id;
    delete from acc.flow_case_steps
     where case_id=v.case_id and seq in (7,8,9,10,11)
       and forwarded_at is null and status is distinct from 'done';
  end if;

  perform acc.wf_forward(p_fcs_id);
end; $function$;
