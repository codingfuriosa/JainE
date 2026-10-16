-- YouTube tab: every video of every followed channel, not just the newest 50 (16 Oct 2026).
-- digital-metrics-sync (part yt_public) reads each channel's whole uploads playlist, 50 a page,
-- keeping YouTube's page token here so a long channel (Godrej: ~1,500 videos) carries on in the
-- next run if one run runs out of time. Once a channel has been read to the end (list_full_at), only
-- its newest page is read for new uploads, and every stored video gets a fresh statistics reading
-- each day (videos.list, 50 ids per call).
alter table camp.dm_yt_channels add column if not exists list_cursor text;          -- playlist page token mid-read
alter table camp.dm_yt_channels add column if not exists list_full_at timestamptz;  -- last time the whole list was read
create index if not exists dm_yt_videos_channel on camp.dm_yt_videos (channel_id, published_at desc);
