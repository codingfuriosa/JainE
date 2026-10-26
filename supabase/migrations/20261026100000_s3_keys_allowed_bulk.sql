-- S3 SIGNING IN ONE CALL FOR A WHOLE PAGE OF KEYS.
--
-- (26 Oct 2026) The Competitor Ads grid signed every tile's picture with its own s3-sign call - up
-- to 200 calls for one screen, each doing its own sign-in check and its own s3_key_allowed lookup.
-- Tiles queued behind each other and many timed out as "Media unavailable". s3-sign now takes a
-- list of keys; this answers "which of these may the caller read" in one query, with exactly the
-- same rule as s3_key_allowed (staff: any key; everyone else: only keys their own rows point at).
-- Run as the caller (not security definer), like s3_key_allowed, so customer RLS still decides.

create or replace function app.s3_keys_allowed(p_action text, p_keys text[])
returns text[]
language plpgsql
stable
set search_path to 'app', 'public'
as $function$
begin
  if auth.uid() is null or p_keys is null then return '{}'::text[]; end if;
  if app.is_s3_staff() then
    return coalesce((select array_agg(k) from unnest(p_keys) k
                      where coalesce(k,'') <> '' and k not like '%..%'), '{}'::text[]);
  end if;
  return coalesce((select array_agg(k) from unnest(p_keys) k
                    where app.s3_key_allowed(p_action, k)), '{}'::text[]);
end $function$;

revoke all on function app.s3_keys_allowed(text, text[]) from public, anon;
grant execute on function app.s3_keys_allowed(text, text[]) to authenticated;
