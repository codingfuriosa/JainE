-- SYSTEM FEEDBACKS FOR POST SALES AND PRE SALES (25 Nov 2026, Ayush: "add it in System Feedbacks in a new Module named Post
-- Sales and Pre Sales where u add the Feedback for Reckoner which will be given to all Pre Sales Executive And Reminder System
-- which will go to every Post Sales Executive").
--   system_items.audience  the departments a feedback goes to. Empty = as before (Sales and Pre Sales).
--   Post Sales people become raters too, but they only ever see a feedback addressed to Post Sales.
-- Applied by the one-time cron sf_audience_once (20:05 IST 25 Nov).
alter table feedback.system_items add column if not exists audience text[];

create or replace function feedback.my_depts() returns text[]
language sql stable security definer set search_path = '' as $$
  -- the profile's departments, else the JainE user record's (jaingroupcaller11 has no profile row)
  select coalesce((select p.department from acc.user_profile p where lower(p.email) = lower(app.current_user_email()) and cardinality(p.department) > 0 limit 1),
                  (select u.department from adm.users u where lower(u.email) = lower(app.current_user_email()) limit 1), '{}'::text[])
$$;

create or replace function feedback.is_system_rater() returns boolean
language sql stable security definer set search_path = '' as $$
  select not feedback.is_systems()
     and (lower(coalesce(app.current_user_email(),'')) = 'digitalmarketing@thejaingroup.com'
          or feedback.my_depts() && array['Sales','Pre Sales','Post Sales']::text[])
$$;

-- may this rater see this feedback? no audience = Sales and Pre Sales (and digitalmarketing@), as it always was
create or replace function feedback.item_for_me(p_audience text[]) returns boolean
language sql stable security definer set search_path = '' as $$
  select case when p_audience is null or cardinality(p_audience) = 0
              then lower(coalesce(app.current_user_email(),'')) = 'digitalmarketing@thejaingroup.com'
                   or feedback.my_depts() && array['Sales','Pre Sales']::text[]
              else feedback.my_depts() && p_audience end
$$;
grant execute on function feedback.my_depts() to authenticated;
grant execute on function feedback.item_for_me(text[]) to authenticated;

drop policy if exists system_items_read on feedback.system_items;
create policy system_items_read on feedback.system_items for select to authenticated
  using (feedback.is_systems() or (feedback.is_system_rater() and feedback.item_for_me(audience)));

-- the module and the two feedbacks
insert into feedback.system_modules (name, created_by)
select 'Post Sales and Pre Sales', 'ayushruia1@gmail.com'
where not exists (select 1 from feedback.system_modules where name = 'Post Sales and Pre Sales');

insert into feedback.system_items (kind, title, description, executed_by, is_active, created_by, module_id, audience)
select v.kind, v.title, v.descr, array['ayushruia1@gmail.com'], true, 'ayushruia1@gmail.com',
       (select id from feedback.system_modules where name = 'Post Sales and Pre Sales' limit 1), v.aud
from (values
  ('New Feature', 'Reckoner',
   'Sales > Reckoner: every project on one page for customer calls - flats and box prices, car parking, booking amount, possession, key facts, why buy, location, nearby places with minutes and km, amenities, and a budget search (e.g. "40 L 2 BHK"). Download and Print. How useful is it on your calls?',
   array['Pre Sales']),
  ('New Feature', 'Reminder System',
   'Post Sales > Outstanding Reminders: send the outstanding reminder email with the customer''s Reminder Letter in one click, with Farvision''s figures, the Sent log, holds and schedules. How useful is it in your work?',
   array['Post Sales'])
) v(kind, title, descr, aud)
where not exists (select 1 from feedback.system_items i where i.title = v.title and i.module_id = (select id from feedback.system_modules where name = 'Post Sales and Pre Sales' limit 1));

notify pgrst, 'reload schema';
