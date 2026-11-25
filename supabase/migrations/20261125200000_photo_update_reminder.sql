-- CONSTRUCTION PROGRESS PHOTOS: A REMINDER EVERY 15 DAYS (25 Nov 2026).
--
-- Achinta Biswas (engineer4thejaingroup@gmail.com) uploads the progress photos customers see - per flat,
-- per block and for the whole project - and nothing told him when they had gone stale (the newest block
-- photo was 30 Sep). Every 15 days he now gets one bell message and one email listing what is due:
--
--   * which projects: Dream Gurukul only (project id 1, cust.photo_reminder_config.project_ids).
--   * what is due: a sold flat (customer linked, not cancelled), a block with sold flats, or the project
--     itself, whose newest photo that was not rejected is 15+ days old - or that has none yet.
--     Photos waiting for approval count: the update has been made.
--   * nothing due, nothing sent; the next check is still 15 days on.
--
-- cust.photo_reminder_config holds the switch, who gets it, how often and the next due date. The bell
-- row (acc.notifications, kind 'media_update_due') is emailed by workflow-mailer through the existing
-- media_notice_email trigger. Checked daily at 10:30 IST, office hours, Monday to Saturday (a reminder
-- due on a Sunday goes on Monday); cust.photo_update_reminder_tick(true) sends one now.
-- Run after 20:00 IST (no schema changes in office hours).

create table if not exists cust.photo_reminder_config (
  id           int primary key default 1 check (id = 1),
  enabled      boolean not null default true,
  recipients   text[] not null default array['engineer4thejaingroup@gmail.com'],
  every_days   int not null default 15 check (every_days between 1 and 90),
  project_ids  bigint[] not null default array[1]::bigint[],   -- which projects are checked: 1 = Dream Gurukul
  next_due     date not null,
  last_sent_at timestamptz,
  last_summary jsonb,
  updated_at   timestamptz not null default now()
);
insert into cust.photo_reminder_config (id, next_due)
values (1, (now() at time zone 'Asia/Kolkata')::date + 1)
on conflict (id) do nothing;

alter table cust.photo_reminder_config enable row level security;
revoke all on cust.photo_reminder_config from anon;
grant select on cust.photo_reminder_config to authenticated;
drop policy if exists photo_reminder_config_staff_read on cust.photo_reminder_config;
create policy photo_reminder_config_staff_read on cust.photo_reminder_config for select to authenticated
  using (app.is_custportal_staff());

-- What is due today: one row per project, block or flat.
create or replace function cust.photo_update_due(p_days int default 15, p_projects bigint[] default array[1]::bigint[])
returns table(project_id bigint, project_name text, level text, tower text, unit_code text, last_photo date)
language sql stable security definer set search_path = '' as $$
  with cutoff as (select (now() at time zone 'Asia/Kolkata')::date - p_days as d),
  projs as (
    select p.id, p.name from cust.projects p
     where p.deleted_at is null and p.id = any(p_projects)),
  sold as (
    select u.id, u.project_id, coalesce(nullif(btrim(u.tower), ''), '-') as tower, u.unit_code
      from cust.units u join projs on projs.id = u.project_id
     where u.deleted_at is null and u.customer_id is not null and coalesce(u.status, '') <> 'cancelled'),
  flats as (
    select s.project_id, s.tower, s.unit_code,
           (select max((ph.created_at at time zone 'Asia/Kolkata')::date) from cust.unit_photos ph
             where ph.unit_id = s.id and ph.deleted_at is null and ph.status <> 'rejected') as last_photo
      from sold s),
  blocks as (
    select b.project_id, b.tower,
           (select max((tp.created_at at time zone 'Asia/Kolkata')::date) from cust.tower_photos tp
             where tp.project_id = b.project_id and coalesce(nullif(btrim(tp.tower), ''), '-') = b.tower
               and tp.deleted_at is null and tp.status <> 'rejected') as last_photo
      from (select distinct project_id, tower from sold) b),
  whole as (
    select pr.id as project_id,
           (select max((pp.created_at at time zone 'Asia/Kolkata')::date) from cust.project_photos pp
             where pp.project_id = pr.id and pp.deleted_at is null and pp.status <> 'rejected') as last_photo
      from projs pr)
  select w.project_id, pr.name, 'project', null::text, null::text, w.last_photo
    from whole w join projs pr on pr.id = w.project_id, cutoff
   where w.last_photo is null or w.last_photo <= cutoff.d
  union all
  select b.project_id, pr.name, 'block', b.tower, null, b.last_photo
    from blocks b join projs pr on pr.id = b.project_id, cutoff
   where b.last_photo is null or b.last_photo <= cutoff.d
  union all
  select f.project_id, pr.name, 'flat', f.tower, f.unit_code, f.last_photo
    from flats f join projs pr on pr.id = f.project_id, cutoff
   where f.last_photo is null or f.last_photo <= cutoff.d
$$;
revoke all on function cust.photo_update_due(int, bigint[]) from public, anon;
grant execute on function cust.photo_update_due(int, bigint[]) to authenticated;

-- Daily at 10:30 IST, not on Sundays. On or after next_due: list what is due, put one bell message per recipient (the
-- trigger emails it), move next_due on by every_days. p_force sends one now, whatever the date.
create or replace function cust.photo_update_reminder_tick(p_force boolean default false)
returns text language plpgsql security definer set search_path = '' as $$
declare
  cfg   cust.photo_reminder_config;
  today date := (now() at time zone 'Asia/Kolkata')::date;
  pr    record;
  body  text := '';
  title text;
  n_flats int; n_blocks int; n_proj int; who text;
  dd    text;
begin
  select * into cfg from cust.photo_reminder_config where id = 1;
  if cfg.id is null or not cfg.enabled then return 'off'; end if;
  if not p_force and today < cfg.next_due then return 'not due until ' || cfg.next_due; end if;
  -- office days only: a reminder due on a Sunday goes on Monday morning instead
  if not p_force and extract(isodow from today) = 7 then return 'Sunday - goes out on Monday'; end if;

  create temp table if not exists pg_temp._photo_due on commit drop as select * from cust.photo_update_due(cfg.every_days, cfg.project_ids) limit 0;
  truncate pg_temp._photo_due;
  insert into pg_temp._photo_due select * from cust.photo_update_due(cfg.every_days, cfg.project_ids);
  select count(*) filter (where level = 'flat'), count(*) filter (where level = 'block'), count(*) filter (where level = 'project')
    into n_flats, n_blocks, n_proj from pg_temp._photo_due;

  update cust.photo_reminder_config
     set next_due = today + cfg.every_days, updated_at = now(),
         last_sent_at = case when n_flats + n_blocks + n_proj > 0 then now() else last_sent_at end,
         last_summary = jsonb_build_object('on', today, 'flats', n_flats, 'blocks', n_blocks, 'projects', n_proj)
   where id = 1;
  if n_flats + n_blocks + n_proj = 0 then return 'nothing due'; end if;

  for pr in select distinct project_id, project_name from pg_temp._photo_due order by project_name loop
    body := body || case when body = '' then '' else E'\n\n' end || upper(pr.project_name);
    -- the project itself
    select string_agg(case when last_photo is null then 'Project photos: none yet'
                           else 'Project photos: last ' || to_char(last_photo, 'DD Mon') end, '')
      into dd from pg_temp._photo_due where project_id = pr.project_id and level = 'project';
    if dd is not null then body := body || E'\n• ' || dd; end if;
    -- blocks
    select string_agg(tower || ' (' || coalesce('last ' || to_char(last_photo, 'DD Mon'), 'none yet') || ')', ', ' order by tower)
      into dd from pg_temp._photo_due where project_id = pr.project_id and level = 'block';
    if dd is not null then body := body || E'\n• Block photos: ' || dd; end if;
    -- flats, one line per block
    for who in select distinct tower from pg_temp._photo_due where project_id = pr.project_id and level = 'flat' order by tower loop
      select tower || ' (' || count(*) || '): ' || string_agg(unit_code, ', ' order by unit_code)
        into dd from pg_temp._photo_due where project_id = pr.project_id and level = 'flat' and tower = who group by tower;
      body := body || E'\n• Flats in ' || dd;
    end loop;
  end loop;
  body := body || E'\n\nPlease upload new photos in Customer Portal Admin > Photos & Videos.';

  title := 'Construction progress photos due for an update: '
        || concat_ws(', ',
             case when n_proj   > 0 then n_proj   || ' project' || case when n_proj   > 1 then 's' else '' end end,
             case when n_blocks > 0 then n_blocks || ' block'   || case when n_blocks > 1 then 's' else '' end end,
             case when n_flats  > 0 then n_flats  || ' flat'    || case when n_flats  > 1 then 's' else '' end end);

  insert into acc.notifications (recipient, kind, title, body)
  select lower(r), 'media_update_due', title, body from unnest(cfg.recipients) r;
  return 'sent: ' || title;
end $$;
revoke all on function cust.photo_update_reminder_tick(boolean) from public, anon, authenticated;

-- the existing photo-notice email trigger now also mails the reminder
drop trigger if exists media_notice_email on acc.notifications;
create trigger media_notice_email after insert on acc.notifications
  for each row when (new.kind in ('media_pending', 'media_rejected', 'media_published', 'media_update_due'))
  execute function cust.media_notice_email();

select cron.unschedule('photo-update-reminder') where exists (select 1 from cron.job where jobname = 'photo-update-reminder');
-- 05:00 UTC = 10:30 IST, inside office hours (bell and email arrive together)
select cron.schedule('photo-update-reminder', '0 5 * * *', 'select cust.photo_update_reminder_tick()');
