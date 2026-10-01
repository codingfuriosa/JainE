-- Farvision now sends Sales Details as one file PER PROJECT (eleven attachments in one Gmail thread
-- every morning), all named "Sales Details_<stamp>.xlsx". The farvision-import edge function
-- auto-dismisses older pending files "of the same report type" before queueing a new one, so each
-- project's file marked the previous one completed and only the last project was ever imported
-- (30.09.2026: 10 of 11 dismissed without an import).
--
-- The edge function is fixed in supabase/functions/farvision-import, but it can only be redeployed
-- from the CLI or dashboard. Until then, and as a backstop afterwards, this trigger refuses that
-- particular dismissal: a pending Sales Details row from the last 12 hours cannot be flipped to
-- completed by the service role (the edge function). The admin panel's own "completed" after a real
-- import runs as an authenticated user and is unaffected; files older than 12 hours (a previous
-- day's) can still be dismissed.

create or replace function cust.keep_sales_details_pending()
returns trigger language plpgsql as $$
begin
  if old.status = 'pending' and new.status = 'completed'
     and old.file_name ilike 'Sales Details%'
     and old.created_at > now() - interval '12 hours'
     and coalesce(auth.role(), '') = 'service_role' then
    new.status := old.status;
    new.processed_at := old.processed_at;
  end if;
  return new;
end $$;

drop trigger if exists import_queue_keep_sales_details_pending on cust.import_queue;
create trigger import_queue_keep_sales_details_pending
  before update on cust.import_queue
  for each row execute function cust.keep_sales_details_pending();
