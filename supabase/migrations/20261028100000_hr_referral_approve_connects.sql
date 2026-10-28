/* Approving a referral connects it to a position in the same step.

   Asked for on 28 Oct 2026: "if Approved it will be Connected Automatically". Approving only set
   the referral to Approved; HR then had to go to Recruitment > Referrals and press Connect to pick
   the position, and only that made the candidate. Two steps for one decision, and an approved
   referral could sit unconnected with nobody noticing.

   Now the approver picks the position on the approval itself, and this does everything at once:
   the referral is marked Approved and linked to the position, the candidate is created (already
   approved, by hr.candidate_referral_preapproved), and their Interviews row is made. One
   transaction, so a referral is never left Approved without its candidate.

   Allowed for HR, administrators, and whoever holds the open approval task for this referral. */
create or replace function hr.referral_approve_connect(p_ref_id bigint, p_req_id bigint, p_entity text default null)
 returns hr.referrals
 language plpgsql security definer set search_path to 'hr', 'acc', 'public'
as $function$
declare
  v_me    text := lower(coalesce(app.current_user_email(), ''));
  v_ref   hr.referrals;
  v_title text;
  v_row   bigint;
  v_cand  bigint;
  v_tr    bigint;
begin
  if not (hr.is_hr_or_admin(v_me) or coalesce(app.is_superadmin(), false)
          or exists (select 1 from acc.ptasks
                      where referral_id = p_ref_id and lower(coalesce(delegator,'')) = v_me)) then
    raise exception 'Only HR or the approver of this referral can approve it';
  end if;

  select * into v_ref from hr.referrals where id = p_ref_id for update;
  if not found then raise exception 'Referral not found'; end if;
  -- Pressing it twice, or in two windows, must not make the same person a candidate twice.
  if v_ref.candidate_id is not null then
    raise exception '% is already connected to a position', coalesce(v_ref.referred_name, 'This referral');
  end if;

  select job_title into v_title from hr.manpower_requests
   where id = p_req_id and coalesce(status, 'Open') = 'Open';
  if not found then raise exception 'That position is not open'; end if;

  -- Approved_by is written before the candidate, so the pre-approval trigger credits this approver.
  update hr.referrals
     set approval_status = 'Approved', approved_by = v_me, approved_at = now(), rejection_reason = null,
         manpower_request_id = p_req_id, position = v_title
   where id = p_ref_id;

  v_row := hr.tracker_row_for_request(p_req_id, null);

  insert into hr.candidates (tracker_row_id, manpower_request_id, name, email, phone, position,
                             source, entity, resume_id, created_by, applied_at)
  values (v_row, p_req_id, v_ref.referred_name, v_ref.referred_email, v_ref.referred_phone, v_title,
          'Referral', p_entity, v_ref.resume_id, v_me, now())
  returning id into v_cand;

  insert into hr.interview_tracker (candidate_name, position, source, entity, number, email, created_at,
                                    notes, candidate_id)
  values (v_ref.referred_name, v_title, 'Referral', p_entity, v_ref.referred_phone, v_ref.referred_email, now(),
          'Referred by ' || coalesce(v_ref.referred_by, 'someone')
            || case when coalesce(v_ref.notes, '') <> '' then ' — ' || v_ref.notes else '' end,
          v_cand)
  returning id into v_tr;

  update hr.candidates set tracker_id = v_tr where id = v_cand;
  update hr.referrals  set candidate_id = v_cand, tracker_id = v_tr where id = p_ref_id
  returning * into v_ref;

  return v_ref;
end $function$;

revoke all on function hr.referral_approve_connect(bigint, bigint, text) from public, anon;
grant execute on function hr.referral_approve_connect(bigint, bigint, text) to authenticated;
