-- POSTS & REELS: the 19 content types settled with the user on 7 Nov 2026 (from their own sheets).
-- Added: Birthday Post, Client Testimonial (also "Testimonial Post"), PR Post, Trending Post, Moment
-- Marketing. "Office Event" counts as HR Activity; "EGC Post" = EGC; "Blog Post" = Web Blog; "Near
-- Airport" is not a type. The AI labels made against the first 14 types are cleared so every post is
-- judged again; hand corrections (label_source 'manual') are kept.
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
  if p_type is not null and p_type not in ('Employee Post','Birthday Post','Wish Post','Contest Post','Quiz Post','CP Testimonial',
      'Client Testimonial','Channel Partner Post','CP Post','Event Post','CARE Post','Creative Post','Project Post',
      'HR Activity','EGC','Web Blog','PR Post','Trending Post','Moment Marketing') then
    raise exception 'unknown content type %', p_type;
  end if;
  update camp.social_posts
     set post_name = nullif(btrim(coalesce(p_name, '')), ''),
         content_type = p_type,
         label_source = 'manual', label_by = app.current_user_email(), label_at = now()
   where id = p_id;
end $$;

update camp.social_posts set post_name = null, content_type = null, label_source = null, label_at = null
 where label_source = 'ai';
