-- A source typed on the careers page joins the list, so the next applicant can pick it and HR
-- sees it in the Interviews dropdown.
--
-- Done with a trigger on hr.candidates rather than in the careers endpoint, because there is
-- more than one way a candidate gets a source: the public form, HR's own Add Candidate, and
-- the Tracker's own source field. A trigger catches all of them and cannot be forgotten by the
-- next route somebody adds. SECURITY DEFINER because the careers endpoint runs as service_role,
-- which deliberately has only SELECT on this table.

delete from hr.sources a using hr.sources b
 where a.ctid > b.ctid and lower(trim(a.name)) = lower(trim(b.name));

alter table hr.sources add constraint hr_sources_name_key unique (name);

create or replace function hr.source_remember() returns trigger
language plpgsql security definer set search_path = hr, public as $$
declare v text;
begin
  v := nullif(btrim(regexp_replace(coalesce(new.source,''), '\s+', ' ', 'g')), '');
  if v is null or length(v) > 60 then return new; end if;
  -- already there case-insensitively is already there: "linkedin" must not join "LinkedIn"
  if exists (select 1 from hr.sources s where lower(s.name) = lower(v)) then return new; end if;
  insert into hr.sources(name, sort) values (v, 100) on conflict (name) do nothing;
  return new;
end $$;

drop trigger if exists candidates_remember_source on hr.candidates;
create trigger candidates_remember_source
  after insert or update of source on hr.candidates
  for each row execute function hr.source_remember();

insert into hr.sources(name, sort)
select distinct on (lower(btrim(c.source))) btrim(c.source), 100
from hr.candidates c
where nullif(btrim(coalesce(c.source,'')),'') is not null
  and length(btrim(c.source)) <= 60
  and not exists (select 1 from hr.sources s where lower(s.name) = lower(btrim(c.source)))
on conflict (name) do nothing;
