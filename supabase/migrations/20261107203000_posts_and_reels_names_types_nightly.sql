-- POSTS & REELS: Post Name + Content Type on every post, and one refresh at night (7 Nov 2026, as asked).
--
-- 1. camp.social_posts gets post_name / content_type. social-organic-live fills them from the caption
--    with Gemini (label_source 'ai'), only where content_type is still empty; the nightly pull never
--    writes these columns, so a name or type stays put.
-- 2. camp.social_post_set_label(id, name, type) - staff correct a name or type from the post's
--    detail box; the row is then marked 'manual' and the AI never touches it again.
-- 3. No Refresh button any more: the one pull is at night, 23:30 IST (18:00 UTC), instead of 06:00.

alter table camp.social_posts add column if not exists post_name    text;
alter table camp.social_posts add column if not exists content_type text;
alter table camp.social_posts add column if not exists label_source text;   -- ai | manual
alter table camp.social_posts add column if not exists label_by     text;
alter table camp.social_posts add column if not exists label_at     timestamptz;

create or replace function camp.social_post_set_label(p_id text, p_name text, p_type text)
returns void
language plpgsql
security definer
set search_path to ''
as $$
begin
  if (select app.is_customer()) or app.current_user_email() is null then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if p_type is not null and p_type not in ('Employee Post','Wish Post','Contest Post','Quiz Post','CP Testimonial',
      'Channel Partner Post','CP Post','Event Post','CARE Post','Creative Post','Project Post','HR Activity','EGC','Web Blog') then
    raise exception 'unknown content type %', p_type;
  end if;
  update camp.social_posts
     set post_name = nullif(btrim(coalesce(p_name, '')), ''),
         content_type = p_type,
         label_source = 'manual', label_by = app.current_user_email(), label_at = now()
   where id = p_id;
end $$;
revoke all on function camp.social_post_set_label(text, text, text) from public, anon;
grant execute on function camp.social_post_set_label(text, text, text) to authenticated;

select cron.alter_job(jobid, schedule := '0 18 * * *') from cron.job where jobname = 'social-organic-daily';
