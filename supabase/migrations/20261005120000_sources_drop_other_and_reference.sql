-- "Other" and "Reference" leave the source list.
--
-- "Other" was never a source. It is the careers page's way of saying "none of these", and the
-- box it opens is where the real answer gets typed - but career-apply was throwing that answer
-- away and storing the word "Other" instead, so somebody who found us through Google was filed
-- under the same label as everybody else who found us anywhere unlisted. The whole point of the
-- column is to answer "where do our candidates come from", and "Other" answers it with a shrug.
-- career-apply now stores what was typed, and hr.source_remember() puts it in this list, so the
-- next applicant can simply pick Google.
--
-- "Reference" and "Referral" are the same thing said twice, and two spellings of one channel
-- split its count in half. Referral is the one the system actually writes - it is set when a
-- referral is connected to a position, and the Tracker locks that cell precisely so the link
-- back to the colleague who put the candidate forward cannot be edited away. Reference was only
-- ever pickable, and nothing has ever been filed under it: zero candidates, zero tracker rows,
-- zero applications. It goes.

delete from hr.sources where lower(btrim(name)) in ('other', 'reference');

-- The trigger that remembers new sources must not put "Other" back. One tracker row and two
-- applications still carry the literal word from before career-apply was fixed, and the Tracker
-- lists a row's own value even when it is off the list - so editing one of those rows would
-- otherwise re-insert "Other" and quietly undo the line above.
create or replace function hr.source_remember() returns trigger
language plpgsql security definer set search_path = hr, public as $$
declare v text;
begin
  v := nullif(btrim(regexp_replace(coalesce(new.source,''), '\s+', ' ', 'g')), '');
  if v is null or length(v) > 60 then return new; end if;
  -- "Other" is a placeholder, not a channel, and "Reference" duplicates "Referral".
  if lower(v) in ('other', 'reference') then return new; end if;
  -- already there case-insensitively is already there: "linkedin" must not join "LinkedIn"
  if exists (select 1 from hr.sources s where lower(s.name) = lower(v)) then return new; end if;
  insert into hr.sources(name, sort) values (v, 100) on conflict (name) do nothing;
  return new;
end $$;
