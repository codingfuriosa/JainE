-- Edit a generated Digital Booking Form link (11 Nov 2026): Sales / the Administrator can change the details they set while the link is still open.
-- The link (token) stays the same. A customer who already started keeps what they typed; the locked answers always come from here, on every load and save.
create or replace function acc.update_booking_link(p_id uuid, p_prefill jsonb)
returns boolean language plpgsql security definer set search_path to '' as $$
begin
  if not acc.can_generate_booking_form() then raise exception 'Not allowed to edit booking forms'; end if;
  if p_prefill is null or jsonb_typeof(p_prefill) <> 'object' or jsonb_typeof(p_prefill->'values') <> 'object'
     or jsonb_typeof(p_prefill->'locked') <> 'array' or length(p_prefill::text) > 20000 then
    raise exception 'Invalid prefill';
  end if;
  update acc.digital_booking_links
     set prefill = p_prefill,
         customer_name = left(coalesce(p_prefill->'values'->'applicants'->0->>'full_name',''), 200)
   where id = p_id and status = 'open';
  if not found then raise exception 'This link is not open any more'; end if;
  return true;
end $$;
revoke all on function acc.update_booking_link(uuid, jsonb) from public, anon;
grant execute on function acc.update_booking_link(uuid, jsonb) to authenticated;
