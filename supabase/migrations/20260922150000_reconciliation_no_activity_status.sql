-- Adds a fourth status to cust.reconciliation: no_activity.
--
-- A unit with no snapshot AND nothing billed, received or reversed has no balance to misstate, so
-- gating the portal on it is noise rather than protection. Farvision omits such units from the
-- Outstanding Summary because there is nothing outstanding.
--
-- Note on scale: this turned out to describe exactly ONE unit, not the ~27 first estimated. That
-- estimate tested for zero *outstanding* (billed - received = 0), which also catches fully SETTLED
-- units - they have plenty of activity, it just nets to zero. Those stay 'unchecked' here, because a
-- settled balance the Outstanding Summary never confirmed is still a figure nobody has verified: if
-- the portal is missing some of a unit's demands, it will read as settled when it is not.
--
-- 32 of the unchecked units are in exactly that position. Whether they are safe to show depends on
-- WHY Farvision omits them - if it omits every fully-settled unit by design, portal-says-settled and
-- Farvision-says-nothing agree, and they could render. That is a question about the export, not
-- about this data, and is deliberately not assumed here.

create or replace view cust.reconciliation
with (security_invoker = true) as
with billed as (
  select i.unit_id, sum(it.net_amount) as amt
    from cust.invoices i
    join cust.invoice_items it on it.invoice_id = i.id
   where i.is_current and i.deleted_at is null
     and coalesce(i.status,'') not ilike 'cancel%'
   group by 1),
per_bill as (
  select i.unit_id, i.document_no, sum(it.net_amount) as amt
    from cust.invoices i
    join cust.invoice_items it on it.invoice_id = i.id
   where i.is_current and i.deleted_at is null
     and coalesce(i.status,'') not ilike 'cancel%'
   group by 1,2),
alloc_per_bill as (
  select r.unit_id, ri.against_demand_no as document_no, sum(ri.amount) as amt
    from cust.money_receipts r
    join cust.receipt_items ri on ri.receipt_id = r.id
   where r.is_current and r.deleted_at is null
     and ri.against_demand_no is not null
   group by 1,2),
unpaid as (
  select b.unit_id, count(*) as n
    from per_bill b
    left join alloc_per_bill a
      on a.unit_id = b.unit_id and a.document_no = b.document_no
   where b.amt - coalesce(a.amt,0) > 1
   group by 1),
rcpt as (
  select r.unit_id,
         sum(ri.amount) filter (where ri.against_demand_no is not null) as allocated,
         sum(ri.amount) filter (where ri.against_demand_no is null)     as on_account
    from cust.money_receipts r
    join cust.receipt_items ri on ri.receipt_id = r.id
   where r.is_current and r.deleted_at is null
   group by 1),
rev as (
  select unit_id, sum(reversal_amount) as amt
    from cust.receipt_reversals
   where is_current and deleted_at is null
   group by 1),
os as (
  select unit_id, as_on_date, bill_outstanding, on_account, net_outstanding,
         no_of_bills, total_consideration
    from cust.outstanding_snapshot
   where is_current and deleted_at is null)
select
  u.id as unit_id, u.unit_code, u.tower, p.name as project,
  u.status as unit_status, c.full_name as customer, os.as_on_date,
  os.bill_outstanding    as fv_bill_outstanding,
  os.on_account          as fv_on_account,
  os.net_outstanding     as fv_net_outstanding,
  os.no_of_bills         as fv_no_of_bills,
  os.total_consideration as fv_total_consideration,
  round(coalesce(b.amt,0) - coalesce(rc.allocated,0) + coalesce(rv.amt,0), 2) as portal_bill_outstanding,
  round(coalesce(rc.on_account,0), 2)                                        as portal_on_account,
  round(coalesce(b.amt,0) - coalesce(rc.allocated,0) + coalesce(rv.amt,0)
        - coalesce(rc.on_account,0), 2)                                      as portal_net_outstanding,
  coalesce(up.n,0)                                                           as portal_unpaid_bills,
  u.agreement_value                                                          as portal_total_consideration,
  round(coalesce(os.net_outstanding,0)
        - (coalesce(b.amt,0) - coalesce(rc.allocated,0) + coalesce(rv.amt,0)
           - coalesce(rc.on_account,0)), 2)                                  as net_outstanding_delta,
  round(coalesce(os.on_account,0) - coalesce(rc.on_account,0), 2)            as on_account_delta,
  coalesce(os.no_of_bills,0) - coalesce(up.n,0)                              as bill_count_delta,
  case
    when os.unit_id is null
         and coalesce(b.amt,0) = 0 and coalesce(rc.allocated,0) = 0
         and coalesce(rc.on_account,0) = 0 and coalesce(rv.amt,0) = 0
      then 'no_activity'
    when os.unit_id is null then 'unchecked'
    when abs(coalesce(os.net_outstanding,0)
             - (coalesce(b.amt,0) - coalesce(rc.allocated,0) + coalesce(rv.amt,0)
                - coalesce(rc.on_account,0))) <= 1 then 'matched'
    else 'mismatched'
  end as status
from cust.units u
left join cust.projects  p  on p.id = u.project_id
left join cust.customers c  on c.id = u.customer_id
left join os      on os.unit_id = u.id
left join billed  b  on b.unit_id  = u.id
left join rcpt    rc on rc.unit_id = u.id
left join rev     rv on rv.unit_id = u.id
left join unpaid  up on up.unit_id = u.id
where u.deleted_at is null;

comment on view cust.reconciliation is
  'Per-unit agreement between the portal and Farvision''s Outstanding Summary, using Farvision''s own '
  'definition (Net Outstanding = Bill Outstanding - On Account). status: matched / mismatched / '
  'unchecked (no snapshot but the unit has money movements) / no_activity (no snapshot AND nothing '
  'billed, received or reversed - no balance exists to misstate).';

grant select on cust.reconciliation to authenticated;
