-- BOOKING DOCUMENTS: EMAIL AND REJECT.
--
-- The Welcome Letter, Allotment Letter and Agreement Draft each get an Email and a Reject button.
-- This is what those buttons need on the database side:
--
--   acc.booking_doc_status   one row per booking and document - whether it is rejected, when it
--                            was emailed automatically, and the last time it was emailed by hand.
--   acc.booking_doc_set_rejected(case, kind, on/off)
--                            Reject / un-reject. A rejected document can still be opened, edited
--                            and downloaded; it can only not be emailed.
--   acc.booking_doc_can_act()
--                            who may press either button: the Administrator and Post Sales, the
--                            same people wfBookingCanAct lets act on a booking in accountability.js.
--
-- The mail itself is sent by the customer-invite edge function (it already holds the
-- customercare1@thejaingroup.com mailbox - Pallabita Ghosh's - for portal invitations), action
-- booking_doc_mail. It writes the emailed_* columns here with the service role.
--
-- TEST MODE. acc.job_secrets 'booking_mail_mode' is 'test' until somebody decides otherwise: every
-- one of these emails goes to 'booking_mail_test_to' instead of the customer, saying who it would
-- have gone to. Only a deliberate change of that row sends anything to a real customer.
--
-- The Agreement Draft becomes editable like the other three, so booking_doc_edits accepts it too.

alter table acc.booking_doc_edits drop constraint if exists booking_doc_edits_kind_check;
alter table acc.booking_doc_edits add constraint booking_doc_edits_kind_check
  check (kind = any (array['checklist','welcome','allotment','agreement']));

create table if not exists acc.booking_doc_status (
  case_id           bigint not null references acc.flow_cases(id) on delete cascade,
  kind              text   not null check (kind = any (array['welcome','allotment','agreement'])),
  rejected          boolean not null default false,
  rejected_at       timestamptz,
  rejected_by       text,
  -- set once, by the automatic Welcome Letter; never re-sent automatically after that
  auto_emailed_at   timestamptz,
  -- bookings read before this existed are never emailed automatically
  auto_skip         boolean not null default false,
  last_emailed_at   timestamptz,
  last_emailed_by   text,
  last_email_to     text[],
  last_email_test   boolean,
  last_email_modified boolean,
  email_count       integer not null default 0,
  primary key (case_id, kind)
);
alter table acc.booking_doc_status enable row level security;

create or replace function acc.booking_doc_can_act()
returns boolean
language sql stable security definer
set search_path to 'adm','acc','public'
as $function$
  select app.is_superadmin()
      or lower(coalesce(app.current_user_email(),'')) = 'ayushruia1@gmail.com'
      or exists (select 1 from adm.users u
                  where lower(u.email) = lower(app.current_user_email())
                    and u.department && array['Post Sales']::text[]);
$function$;

drop policy if exists booking_doc_status_read on acc.booking_doc_status;
create policy booking_doc_status_read on acc.booking_doc_status
  for select to authenticated using (not app.is_customer());

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
  if p_kind not in ('welcome','allotment','agreement') then
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

revoke all on function acc.booking_doc_set_rejected(bigint,text,boolean) from public, anon;
grant execute on function acc.booking_doc_set_rejected(bigint,text,boolean) to authenticated, service_role;
grant execute on function acc.booking_doc_can_act() to authenticated, service_role;
grant select on acc.booking_doc_status to authenticated;

-- Every booking already read is left alone by the automatic Welcome Letter.
insert into acc.booking_doc_status (case_id, kind, auto_skip)
select b.case_id, 'welcome', true
  from acc.booking_audits b
  join acc.flow_cases c on c.id = b.case_id
on conflict (case_id, kind) do update set auto_skip = true;

-- Test mode, and where test mail goes.
insert into acc.job_secrets (name, value) values
  ('booking_mail_mode', 'test'),
  ('booking_mail_test_to', 'ayushruia1@gmail.com')
on conflict (name) do nothing;
