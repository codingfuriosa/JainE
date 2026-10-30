-- public-intel: indexes for the two reads the collector repeats every 5 minutes, which showed up
-- among the heavier queries on 30 Oct 2026 (~790 ms and ~650 ms each on the Micro instance).
-- Apply AFTER HOURS (after 20:00 IST): any DDL reloads the PostgREST schema cache, which stalls the
-- 1 GB server for everyone.

-- Creatives still waiting for their per-ad detail (index.ts: detail_at is null, preview_url not null,
-- image_url null or a video/text ad). Partial, so it only holds the rows still to do.
create index if not exists pi_gads_need_detail_idx
  on camp.pi_gads_creatives (first_seen_at)
  where detail_at is null and preview_url is not null
    and (image_url is null or format in ('video', 'text'));

-- Weekly re-read of followed promoters: promoter_name = any(...) ordered by detail_fetched_at.
-- The existing pi_rera_promoter_idx is on lower(promoter_name), which an exact match cannot use.
create index if not exists pi_rera_promoter_fetched_idx
  on camp.pi_rera_projects (promoter_name, detail_fetched_at);
