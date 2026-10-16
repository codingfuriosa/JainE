-- YouTube tab video list (16 Oct 2026): every stored video of the given channels with YouTube's
-- latest public counts, and the reading at the start of the chosen period, so the tab can show
-- "views gained in the period" without downloading every daily reading. The base reading is the
-- same rule as dm_yt_public_compare: the reading on or before p_from if there is one, otherwise the
-- earliest one after it (the screen then says from which date it is counting). Nothing is filled in:
-- a video with no reading has nulls.
create or replace function camp.dm_yt_video_list(p_channels text[], p_from date)
returns table(video_id text, channel_id text, title text, published_at timestamptz, duration_sec int, thumbnail text,
              latest_date date, views bigint, likes bigint, comments bigint, base_date date, base_views bigint)
language sql
stable
set search_path to ''
as $$
  select v.video_id, v.channel_id, v.title, v.published_at, v.duration_sec, v.thumbnail,
         l.snap_date, l.views, l.likes, l.comments, b.snap_date, b.views
    from camp.dm_yt_videos v
    join camp.dm_yt_channels c on c.channel_id = v.channel_id and c.confirmed and c.active
    left join lateral (select d.snap_date, d.views, d.likes, d.comments from camp.dm_yt_video_daily d
                        where d.video_id = v.video_id order by d.snap_date desc limit 1) l on true
    left join lateral (select d.snap_date, d.views from camp.dm_yt_video_daily d where d.video_id = v.video_id
                        order by (d.snap_date <= p_from) desc,
                                 case when d.snap_date <= p_from then p_from - d.snap_date else d.snap_date - p_from end
                        limit 1) b on true
   where v.channel_id = any(p_channels)
   order by v.published_at desc nulls last
$$;
grant execute on function camp.dm_yt_video_list(text[], date) to authenticated;
