-- ONLY PRE-SALES CALLS ARE TRANSCRIBED.
--
-- The queue took every follow-up that carried a recording, whoever made the call. What the QA
-- rubric actually judges - the opening script, the qualification questions, the call-to-action - is
-- the pre-sales callers' work. A Sales Executive's call is a different conversation being marked
-- against a script it was never meant to follow, and it was being paid for twice over (Gemini to
-- transcribe, OpenAI to judge) to produce a verdict nobody reads.
--
-- So the queue now takes pre-sales calls only. Who counts as pre-sales is NOT re-decided here:
-- acc.crm_personnel_team() over acc.crm_presales_emails() is the one list, and the transcription
-- page reads the same function, so the queue and the screen can never disagree about a caller.
--
-- CALLS ALREADY IN THE QUEUE ARE LEFT EXACTLY AS THEY ARE. Nothing is deleted, nothing is
-- un-transcribed: the Sales calls already transcribed keep their transcripts and their QA. This
-- only decides what is picked up from here on.
--
-- WHY THE SKIP COUNTS ARE RETURNED. A filter that silently queues nothing looks identical to a
-- pipeline that has died. The CRM only started sending personnel on every row on 2026-09-02, and if
-- it ever stops again every call becomes team NULL and the night would go quiet with no explanation.
-- skipped_sales / skipped_no_personnel put the reason in the run's own response, next to the zero.
create or replace function public.crm_build_queue(p_snapshot_id bigint, p_tz_offset_min integer default 330)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'acc', 'public'
as $function$
declare
  v_n       integer;
  v_start   bigint;
  v_ins     integer := 0;
  v_sales   integer := 0;
  v_nobody  integer := 0;
begin
  select count(*) filter (where acc.crm_personnel_team(f.personnel_email) = 'Pre-Sales'),
         count(*) filter (where acc.crm_personnel_team(f.personnel_email) = 'Sales'),
         count(*) filter (where acc.crm_personnel_team(f.personnel_email) is null)
    into v_n, v_sales, v_nobody
  from acc.crm_snapshot_followups f
  where f.snapshot_id = p_snapshot_id and f.has_recording
    and not exists (select 1 from acc.transcription_queue q where q.follow_up_id = f.follow_up_id);

  if coalesce(v_n, 0) = 0 then
    update acc.crm_snapshots set status = 'queued', updated_at = now() where id = p_snapshot_id;
    return jsonb_build_object('queued', 0, 'already_queued', true,
                              'skipped_sales', v_sales, 'skipped_no_personnel', v_nobody);
  end if;

  v_start := public.next_crm_queue_block(v_n);

  with candidates as (
    select f.*,
           row_number() over (order by f.communication_time desc nulls last,
                                       f.follow_up_id desc) - 1 as rn
    from acc.crm_snapshot_followups f
    where f.snapshot_id = p_snapshot_id and f.has_recording
      and acc.crm_personnel_team(f.personnel_email) = 'Pre-Sales'
      and not exists (select 1 from acc.transcription_queue q where q.follow_up_id = f.follow_up_id)
  )
  insert into acc.transcription_queue
    (follow_up_id, lead_id, snapshot_id, snapshot_date, call_date, recording_url, callid, queue_seq)
  select c.follow_up_id, c.lead_id, p_snapshot_id, c.snapshot_date,
         (c.communication_time + make_interval(mins => p_tz_offset_min))::date,
         c.recording_url, c.callid, v_start + c.rn
  from candidates c
  on conflict (follow_up_id) do nothing;
  get diagnostics v_ins = row_count;

  update acc.crm_snapshots set
    new_recording_count = v_ins, status = 'queued', updated_at = now()
  where id = p_snapshot_id;

  return jsonb_build_object('queued', v_ins,
                            'skipped_sales', v_sales, 'skipped_no_personnel', v_nobody);
end;
$function$;
