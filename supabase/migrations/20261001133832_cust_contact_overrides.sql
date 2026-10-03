/* Let a customer correct their own phone, email and postal address.

   WHY A SEPARATE TABLE RATHER THAN EDITING THE CONTACT ROW.
   The portal reads contact details from cust.farvision_contacts, which is an IMPORT table — it
   carries import_batch_id, is_current and the raw payload, and the farvision-import job rewrites it
   on a nightly cron. An edit written there would look saved, survive the afternoon, and be silently
   replaced overnight by whatever Farvision still holds. So customer edits live in their own table
   and the portal prefers them when present; the import can then do whatever it likes to its own
   rows without touching what the customer told us.

   It also keeps the two facts separate, which accounts will want: what Farvision has on file, and
   what the customer says is correct. The override does not overwrite the source of truth, it sits
   beside it.

   NAME IS NOT EDITABLE. contact_name is the registered name against the booking and appears on
   receipts, demand letters and the statement. A customer rewriting it would put those documents out
   of step with the agreement. Only the three contact fields are offered.

   PER UNIT, NOT PER CUSTOMER, because that is how the contact row itself is keyed — somebody with
   two flats may genuinely want different correspondence addresses for them.

   WRITES GO THROUGH THE RPC, not a blanket UPDATE policy. The function fixes which three columns
   can change and re-checks ownership against cust.units.customer_id on every call, so there is no
   policy a customer could satisfy while writing something unintended. Blank input clears a field
   back to "use whatever Farvision has" rather than storing an empty string. */
create table if not exists cust.contact_overrides (
  unit_id         bigint primary key references cust.units(id) on delete cascade,
  contact_phone   text,
  contact_email   text,
  contact_address text,
  updated_at      timestamptz not null default now(),
  updated_by      text
);

comment on table cust.contact_overrides is
  'Contact details a customer corrected themselves. Preferred over cust.farvision_contacts, which the nightly import rewrites.';

alter table cust.contact_overrides enable row level security;

drop policy if exists contact_overrides_staff_all on cust.contact_overrides;
create policy contact_overrides_staff_all on cust.contact_overrides
  for all using (app.is_custportal_staff()) with check (app.is_custportal_staff());

/* Read-only for the customer: they see their own override so the page can show what they saved.
   Writing is the RPC's job. */
drop policy if exists contact_overrides_customer_select on cust.contact_overrides;
create policy contact_overrides_customer_select on cust.contact_overrides
  for select using (
    exists (select 1 from cust.units u
             where u.id = contact_overrides.unit_id
               and u.customer_id = app.current_customer_id())
  );

create or replace function cust.save_my_contact(
  p_unit_id bigint, p_phone text, p_email text, p_address text)
 returns void
 language plpgsql
 security definer
 set search_path to 'cust', 'public'
as $function$
declare v_cust bigint := app.current_customer_id();
        v_phone text := nullif(btrim(coalesce(p_phone,'')),'');
        v_email text := nullif(btrim(coalesce(p_email,'')),'');
        v_addr  text := nullif(btrim(coalesce(p_address,'')),'');
begin
  if v_cust is null then
    raise exception 'Please sign in again to save your details.';
  end if;
  if not exists (select 1 from cust.units u
                  where u.id = p_unit_id and u.customer_id = v_cust) then
    raise exception 'That flat is not on your account.';
  end if;

  /* Checked here rather than only in the page, because the page is not the only thing that can
     call this. The messages are the ones the customer reads, so they say what to do. */
  if v_email is not null and v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception 'That email address does not look right — please check it.';
  end if;
  if v_phone is not null and length(regexp_replace(v_phone,'[^0-9]','','g')) not between 7 and 15 then
    raise exception 'That phone number does not look right — please check it.';
  end if;
  if v_addr is not null and length(v_addr) > 500 then
    raise exception 'Please keep the address under 500 characters.';
  end if;

  insert into cust.contact_overrides(unit_id, contact_phone, contact_email, contact_address, updated_by)
  values (p_unit_id, v_phone, v_email, v_addr, auth.jwt() ->> 'email')
  on conflict (unit_id) do update
    set contact_phone   = excluded.contact_phone,
        contact_email   = excluded.contact_email,
        contact_address = excluded.contact_address,
        updated_at      = now(),
        updated_by      = excluded.updated_by;
end;
$function$;

revoke all on function cust.save_my_contact(bigint, text, text, text) from public;
grant execute on function cust.save_my_contact(bigint, text, text, text) to authenticated;
