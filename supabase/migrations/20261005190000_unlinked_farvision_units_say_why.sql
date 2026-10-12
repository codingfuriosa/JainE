-- NOW WITH THE REASON, BECAUSE THE REASON IS FIXABLE IN THIRTY SECONDS AND THE SYMPTOM IS NOT.
--
-- postsales.import_farvision DOES create bookings from the Booking Register. It walks every
-- FarVision unit with no booking yet, finds the Post Sales tower by portal_tower, then:
--
--     select * into v_fl from postsales.flats f
--      where f.tower_id = u.ps_tower_id and upper(f.flat_code) = upper(u.unit_code) ...;
--     continue when v_fl.id is null;      <-- silently gives up on this unit
--
-- A flat that was sold but never added to Post Sales Setup is skipped without a word. Nothing is
-- logged, no count is incremented, and the unit simply never becomes a booking.
--
-- Dream Gateway Pailan BLOCK-3 is the live example. Blocks 1 and 2 are set up with nine flats a
-- floor, A to I; Block-3 has 32 flats in all and its sixth floor holds only 6C, 6E, 6F and 6G.
-- 6B and 7H were sold on 02-10-2026, came through in the Booking Register, matched, created their
-- units - and were dropped at that `continue`, taking 76,70,151 out of the MIS.
--
-- Block-3 will do it again: every flat in it that is not set up is a future silent skip.
--
-- Telling somebody there is a gap is not enough when the fix is "add flat 6B to Block-3 in Setup".

drop function if exists postsales.unlinked_farvision_units();

create function postsales.unlinked_farvision_units()
returns table(project_id bigint, project text, unit_id bigint, unit_code text, tower text,
              outstanding numeric, bills integer, first_seen date, reason text, fix text)
language sql stable set search_path to 'postsales','cust','public' as $$
  with latest as (
    select distinct on (s.unit_id) s.unit_id, s.net_outstanding, s.no_of_bills
    from cust.outstanding_snapshot s
    where s.deleted_at is null and s.is_current
    order by s.unit_id, s.id desc)
  select u.project_id, p.name, u.id, u.unit_code, u.tower,
         round(coalesce(latest.net_outstanding,0), 2), coalesce(latest.no_of_bills,0),
         u.created_at::date,
         case
           when t.id is null then 'Block "'||coalesce(u.tower,'?')||'" is not set up in Post Sales'
           when f.id is null then 'Flat '||u.unit_code||' is not set up in '||t.name
           else 'Set up correctly - the import has simply not run since this unit appeared'
         end,
         case
           when t.id is null then 'Post Sales > Setup > Towers: add a block whose portal name is "'||coalesce(u.tower,'?')||'"'
           when f.id is null then 'Post Sales > Setup > '||t.name||': add flat '||u.unit_code||', then press Sync now'
           else 'Press Sync now on Bookings'
         end
  from cust.units u
  join cust.projects p on p.id = u.project_id
  left join latest on latest.unit_id = u.id
  left join postsales.towers t on t.project_id = u.project_id
                              and lower(t.portal_tower) = lower(u.tower) and t.deleted_at is null
  left join postsales.flats  f on f.tower_id = t.id
                              and upper(f.flat_code) = upper(u.unit_code) and f.deleted_at is null
  where u.deleted_at is null
    and not exists (select 1 from postsales.bookings b where b.farvision_unit_id = u.id)
    and (coalesce(latest.net_outstanding,0) > 0 or t.id is null or f.id is null)
  order by coalesce(latest.net_outstanding,0) desc, p.name, u.tower, u.unit_code
$$;

grant execute on function postsales.unlinked_farvision_units() to authenticated;