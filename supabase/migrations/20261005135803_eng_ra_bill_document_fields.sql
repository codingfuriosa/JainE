/* RA bill: the document fields the contractor's bill actually carries.

   FROM THE USER'S EXISTING ERP (Farvision, Contractor RA Bill screen). Mapped field by field, and
   only the ones that were filled in — Document Type and the blank Period From/To were explicitly
   out of scope, and Period From/To already exist here anyway.

     Business Unit, Contractor Name, Work Order No, Work Order Amount  — already derivable from the
       work order this bill hangs off; shown read-only on the form rather than stored twice.
     Invoice Number  -> the existing contractor_ref, relabelled. Same thing under a clearer name:
       the number on the CONTRACTOR'S bill, as opposed to bill_no which is ours.
     Narration       -> the existing remarks, relabelled.
     Document No     -> the existing bill_no, which this module already generates.
     Document Date   -> the existing bill_date.

   WHAT IS GENUINELY NEW, and why each is stored rather than derived:

   financial_year   Indian FY the bill falls in. Derived from bill_date (April start, matching
                    accounts.companies.fy_start_month = 4) but STORED, because a bill dated in
                    April can legitimately belong to the year just closed and somebody has to be
                    able to say so. Defaulted, never guessed silently.
   invoice_date     The date on the contractor's own invoice, which is not our bill date — the
                    screenshot shows 20/09 against a document date of 03/10. Needed for GST and
                    for matching against what the contractor sent.
   due_date         When it is payable. Accounts needs it to age the payable; without it every RA
                    bill looks due the day it is booked.
   billing_type     Whether this is a running bill, a sub-bill, the final bill or an advance. The
                    screenshot's "Sub-Bill 27" is this plus ra_seq, which we already hold.
   parent_contractor  The control account the contractor sits under ("SUNDRY CREDITORS - EXPENSES").
                    Free text for now: purchase.vendors has no link to accounts.sub_ledgers yet, so
                    a dropdown here would be a dropdown of nothing. Left as text so it can be typed
                    and later migrated onto a real link without losing what was recorded.

   THE ITEM INFO IS ALREADY THE WORK DONE and needs no change: eng.v_ra_bill_lines builds every
   line from eng.work_done rows (wo_item_id, activity, location, qty, rate), and ra_bill_create
   only accepts entries that are Verified and not already billed. Noted here because it was asked
   for and the honest answer is that it is done, not that it was skipped. */

alter table eng.ra_bills
  add column if not exists financial_year    text,
  add column if not exists invoice_date      date,
  add column if not exists due_date          date,
  add column if not exists billing_type      text,
  add column if not exists parent_contractor text;

alter table eng.ra_bills drop constraint if exists ra_bills_billing_type_check;
alter table eng.ra_bills add constraint ra_bills_billing_type_check
  check (billing_type is null or billing_type in ('RA Bill','Sub-Bill','Final Bill','Advance'));

comment on column eng.ra_bills.financial_year    is 'Indian FY the bill falls in, e.g. 2026-27. Defaulted from bill_date (April start) and editable.';
comment on column eng.ra_bills.invoice_date      is 'Date on the contractor''s own invoice, which is not necessarily our bill_date.';
comment on column eng.ra_bills.due_date          is 'When this bill is payable. Read by Accounts to age the payable.';
comment on column eng.ra_bills.billing_type      is 'RA Bill / Sub-Bill / Final Bill / Advance. With ra_seq this gives the old system''s "Sub-Bill 27".';
comment on column eng.ra_bills.parent_contractor is 'Control account the contractor sits under. Free text until purchase.vendors links to accounts.sub_ledgers.';

/* The Indian financial year a date falls in, as '2026-27'. One place, so the form, the view and
   anything later all label a bill the same way. */
create or replace function eng.fy_of(p_date date)
 returns text
 language sql
 immutable
as $function$
  select case when p_date is null then null
              when extract(month from p_date) >= 4
                then extract(year from p_date)::int::text || '-' ||
                     lpad(((extract(year from p_date)::int + 1) % 100)::text, 2, '0')
              else (extract(year from p_date)::int - 1)::text || '-' ||
                   lpad((extract(year from p_date)::int % 100)::text, 2, '0')
         end
$function$;

/* Existing bills get the year their date implies, and the default billing type, so nothing reads
   as blank where it simply predates these columns. */
update eng.ra_bills
   set financial_year = coalesce(financial_year, eng.fy_of(bill_date)),
       billing_type   = coalesce(billing_type, 'RA Bill'),
       due_date       = coalesce(due_date, bill_date)
 where financial_year is null or billing_type is null or due_date is null;
