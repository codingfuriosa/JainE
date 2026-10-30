-- OUTSTANDING REMINDERS - THE LIST, NOT THE SENDING (30 Oct 2026, as asked).
-- Every morning the Customer Portal imports Farvision's "Customer Outstanding Summary" (cust.import_batches,
-- import_type 'outstanding'). The reminder list is built from the newest of those files: every customer in
-- the chosen projects with a Net Outstanding above zero, with their email from the Farvision contacts
-- (matched on booking number). Each row is compared with the file before it - New, Amount changed, or the
-- same - and customers who were on yesterday's list but are not on today's are listed as Removed.
-- Post Sales can hold a customer (e.g. an amount the customer disputes) so they are never reminded.
-- NOTHING HERE SENDS AN EMAIL. Sending is to be added only when Ayush asks for it.

create table if not exists postsales.reminder_settings (
  id integer primary key default 1 check (id = 1),
  projects text[] not null default array['DREAM GURUKUL(DOLTALA MADHYAMGRAM)','DREAM ANANTA','DREAM GATEWAY PAILAN PROJECTS','DREAM JAIN-PAILAN'],
  subject text, body text,
  attachment_path text, attachment_name text,
  updated_by text, updated_at timestamptz not null default now());
insert into postsales.reminder_settings (id, subject, body) values (1,
  'Reminder: Outstanding amount for Flat {Flat}, {Project}',
  E'Dear {Customer Name},\n\nGreetings from The Jain Group!\n\nThis is a gentle reminder that an amount of Rs. {Net Outstanding} is outstanding as on {Date} against Flat {Flat}, {Project}.\n\nWe request you to kindly clear the dues at the earliest. If you have already made the payment, please ignore this email and share the payment details with us so that we can update our records.\n\nPlease feel free to get in touch with the undersigned for any queries.\n\nThanking you,\nPallabita Ghosh\nManager - Post Sales\nReach me @ 8420541541')
on conflict (id) do nothing;

create table if not exists postsales.reminder_holds (
  booking_no text primary key,
  customer_name text, reason text not null,
  held_by text, held_at timestamptz not null default now());

alter table postsales.reminder_settings enable row level security;
alter table postsales.reminder_holds enable row level security;
drop policy if exists prs_staff on postsales.reminder_settings;
create policy prs_staff on postsales.reminder_settings for all to authenticated using (not (select app.is_customer())) with check (not (select app.is_customer()));
drop policy if exists prh_staff on postsales.reminder_holds;
create policy prh_staff on postsales.reminder_holds for all to authenticated using (not (select app.is_customer())) with check (not (select app.is_customer()));
grant select, insert, update, delete on postsales.reminder_settings, postsales.reminder_holds to authenticated;

-- The list. change: new | changed | same | removed (on the previous file, not on this one).
create or replace function postsales.outstanding_reminder_list()
returns table (booking_no text, customer_name text, project text, tower text, unit_code text,
               net_outstanding numeric, prev_net numeric, change text, email text,
               held boolean, hold_reason text, file_date timestamptz, prev_file_date timestamptz)
language plpgsql stable security definer set search_path to 'postsales', 'cust', 'public' as $$
declare v_cur bigint; v_prev bigint; v_cur_at timestamptz; v_prev_at timestamptz; v_proj text[];
begin
  if (select app.is_customer()) then return; end if;
  select projects into v_proj from postsales.reminder_settings where id = 1;
  select id, imported_at into v_cur, v_cur_at from cust.import_batches
   where import_type = 'outstanding' and status = 'completed' order by id desc limit 1;
  select id, imported_at into v_prev, v_prev_at from cust.import_batches
   where import_type = 'outstanding' and status = 'completed' and id < v_cur order by id desc limit 1;
  return query
  with cur as (
    select r->>'bookingNo' bk, r->>'customerName' nm, r->>'businessUnit' bu, r->>'tower' tw, r->>'unitCode' uc,
           (r->>'netOutstanding')::numeric net
      from cust.import_batches b, jsonb_array_elements(b.raw_rows) r
     where b.id = v_cur and r->>'businessUnit' = any(v_proj)),
  prv as (
    select r->>'bookingNo' bk, r->>'customerName' nm, r->>'businessUnit' bu, r->>'tower' tw, r->>'unitCode' uc,
           (r->>'netOutstanding')::numeric net
      from cust.import_batches b, jsonb_array_elements(b.raw_rows) r
     where b.id = v_prev and r->>'businessUnit' = any(v_proj)),
  rows as (
    select c.bk, c.nm, c.bu, c.tw, c.uc, c.net, p.net pnet,
           case when p.bk is null or coalesce(p.net, 0) <= 0 then 'new'
                when round(p.net) <> round(c.net) then 'changed' else 'same' end ch
      from cur c left join prv p on p.bk = c.bk
     where c.net > 0
    union all
    select p.bk, p.nm, p.bu, p.tw, p.uc, coalesce(c.net, 0), p.net, 'removed'
      from prv p left join cur c on c.bk = p.bk
     where p.net > 0 and coalesce(c.net, 0) <= 0)
  select x.bk, x.nm, x.bu, x.tw, x.uc, x.net, x.pnet, x.ch,
         (select lower(btrim(fc.contact_email)) from cust.farvision_contacts fc
           where fc.booking_no = x.bk and fc.deleted_at is null and coalesce(fc.contact_email, '') <> ''
           order by fc.is_current desc nulls last, fc.created_at desc limit 1),
         (h.booking_no is not null), h.reason, v_cur_at, v_prev_at
    from rows x left join postsales.reminder_holds h on h.booking_no = x.bk
   order by (x.ch = 'removed'), x.bu, x.net desc;
end $$;
revoke all on function postsales.outstanding_reminder_list() from public, anon;
grant execute on function postsales.outstanding_reminder_list() to authenticated;

-- Test customers (added the same day): shown in their own group so the email can be tried on them first.
create table if not exists postsales.reminder_test_recipients (
  id bigserial primary key,
  customer_name text not null, email text not null,
  project text not null default 'TEST', flat text, net_outstanding numeric not null default 10000,
  added_by text, created_at timestamptz not null default now());
alter table postsales.reminder_test_recipients enable row level security;
drop policy if exists prt_staff on postsales.reminder_test_recipients;
create policy prt_staff on postsales.reminder_test_recipients for all to authenticated using (not (select app.is_customer())) with check (not (select app.is_customer()));
grant select, insert, update, delete on postsales.reminder_test_recipients to authenticated;
grant usage, select on sequence postsales.reminder_test_recipients_id_seq to authenticated;
