-- THE 2nd WELCOME LETTER - the Allotment Payment Letter, kind 'welcome2'.
--
-- Emailed by hand (the Email button), as text, the day after the Welcome Letter. It is never sent
-- automatically. What IS automatic is the reminder: if it has not been emailed by the end of the
-- day after the booking was uploaded (Monday, when that day is a Sunday), Pallabita Ghosh gets one
-- email saying so. customer-invite (action booking_welcome2_reminders) sends those; the cron job
-- below asks it to every evening. In test mode the reminder goes to the test inbox like every other
-- booking mail.
--
-- Only bookings uploaded from today get reminders - the ones already in JAIN-E are not chased.

alter table acc.booking_doc_edits drop constraint if exists booking_doc_edits_kind_check;
alter table acc.booking_doc_edits add constraint booking_doc_edits_kind_check
  check (kind = any (array['checklist','welcome','welcome2','allotment','agreement']));

alter table acc.booking_doc_status drop constraint if exists booking_doc_status_kind_check;
alter table acc.booking_doc_status add constraint booking_doc_status_kind_check
  check (kind = any (array['welcome','welcome2','allotment','agreement']));
alter table acc.booking_doc_status add column if not exists reminder_sent_at timestamptz;

create or replace function acc.booking_doc_set_rejected(p_case_id bigint, p_kind text, p_rejected boolean)
returns acc.booking_doc_status
language plpgsql security definer
set search_path to 'acc','public'
as $function$
declare r acc.booking_doc_status;
begin
  if not acc.booking_doc_can_act() then
    raise exception 'only the Administrator and Post Sales can reject a booking document';
  end if;
  if p_kind not in ('welcome','welcome2','allotment','agreement') then
    raise exception 'unknown document %', p_kind;
  end if;
  insert into acc.booking_doc_status (case_id, kind, rejected, rejected_at, rejected_by)
  values (p_case_id, p_kind, p_rejected,
          case when p_rejected then now() end,
          case when p_rejected then app.current_user_email() end)
  on conflict (case_id, kind) do update
     set rejected    = excluded.rejected,
         rejected_at = excluded.rejected_at,
         rejected_by = excluded.rejected_by
  returning * into r;
  return r;
end;
$function$;

-- Bookings already in JAIN-E are never chased.
insert into acc.booking_doc_status (case_id, kind, reminder_sent_at)
select c.id, 'welcome2', now()
  from acc.flow_cases c where c.flow_id = 41
on conflict (case_id, kind) do update set reminder_sent_at = coalesce(acc.booking_doc_status.reminder_sent_at, now());

/* Which bookings are due a reminder now: uploaded, reminder day reached (the day after upload, or
   Monday when that is a Sunday), 2nd Welcome Letter never emailed, not rejected, not reminded. */
create or replace function acc.booking_welcome2_due()
returns table(case_id bigint, uploaded date, remind_on date)
language sql stable security definer
set search_path to 'acc','public'
as $function$
  with c as (
    select fc.id, (fc.created_at at time zone 'Asia/Kolkata')::date as up
      from acc.flow_cases fc
     where fc.flow_id = 41 and coalesce(fc.status,'') <> 'Cancelled'
  ), d as (
    select id, up, case when extract(isodow from up + 1) = 7 then up + 2 else up + 1 end as remind_on from c
  )
  select d.id, d.up, d.remind_on
    from d
    left join acc.booking_doc_status s on s.case_id = d.id and s.kind = 'welcome2'
   where (now() at time zone 'Asia/Kolkata')::date >= d.remind_on
     and s.last_emailed_at is null
     and coalesce(s.rejected,false) = false
     and s.reminder_sent_at is null;
$function$;
revoke all on function acc.booking_welcome2_due() from public, anon, authenticated;
grant execute on function acc.booking_welcome2_due() to service_role;
