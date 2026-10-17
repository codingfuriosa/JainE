-- BOOKING DOCUMENTS: PALLABITA GHOSH ONLY, AND THE AUTOMATIC WELCOME LETTER ACTUALLY FIRES.
--
-- 1. Only Pallabita Ghosh (customercare1@thejaingroup.com, Manager - Post Sales) may email or
--    reject a booking document (17 Oct 2026). Not the Administrator, not the rest of Post Sales.
--    acc.booking_doc_can_act() is the one switch: customer-invite checks it before any email and
--    booking_doc_set_rejected() before any reject. Viewing, editing and downloading are unchanged.
--
-- 2. The automatic Welcome Letter was built (customer-invite, action booking_welcome_auto) but
--    nothing ever called it. This trigger does: the first time a booking's reading finishes
--    ('done'), customer-invite is asked to send it. customer-invite itself sends it at most once
--    per booking (auto_emailed_at), never for one marked auto_skip, never when rejected.
--
-- 3. Bookings already read are left alone - the automatic letter is for bookings read from now on.

create or replace function acc.booking_doc_can_act()
returns boolean
language sql stable security definer
set search_path to 'adm','acc','public'
as $function$
  select lower(coalesce(app.current_user_email(),'')) = 'customercare1@thejaingroup.com';
$function$;

create or replace function acc.booking_doc_set_rejected(p_case_id bigint, p_kind text, p_rejected boolean)
returns acc.booking_doc_status
language plpgsql security definer
set search_path to 'acc','public'
as $function$
declare r acc.booking_doc_status;
begin
  if not acc.booking_doc_can_act() then
    raise exception 'only Pallabita Ghosh can reject a booking document';
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

create or replace function acc.booking_welcome_auto_kick()
returns trigger
language plpgsql security definer
set search_path to 'acc','public','pg_temp'
as $function$
declare v_secret text;
begin
  select value into v_secret from acc.job_secrets where name = 'booking_audit';
  if v_secret is null then return null; end if;
  perform net.http_post(
    url := 'https://rkxsgtauigjrpcjkmccu.supabase.co/functions/v1/customer-invite',
    headers := jsonb_build_object(
      'Content-Type','application/json',
      'apikey','sb_publishable_16E3r7KtxA7RMVdtm08gkA_DSEAo94n',
      'x-audit-secret', v_secret),
    body := jsonb_build_object('action','booking_welcome_auto','case_id', new.case_id),
    timeout_milliseconds := 60000);
  return null;
exception when others then
  -- never let the letter hold up the reading
  return null;
end $function$;

drop trigger if exists trg_booking_welcome_auto on acc.booking_audits;
create trigger trg_booking_welcome_auto
  after insert or update of status on acc.booking_audits
  for each row
  when (new.status = 'done')
  execute function acc.booking_welcome_auto_kick();

-- Bookings already read: not emailed automatically (Pallabita can still send them by hand).
insert into acc.booking_doc_status (case_id, kind, auto_skip)
select a.case_id, 'welcome', true from acc.booking_audits a where a.status = 'done'
on conflict (case_id, kind) do update
   set auto_skip = true
 where acc.booking_doc_status.auto_emailed_at is null;
