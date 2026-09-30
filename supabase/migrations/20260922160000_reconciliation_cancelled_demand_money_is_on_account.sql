-- Money paid against a CANCELLED demand was being counted as allocated.
--
-- The view excludes cancelled invoices from "billed" - correct, a cancelled demand is not owed - but
-- still counted the receipts paid against them as allocated. A unit then looked like it had paid more
-- than it was ever billed: unit 5D showed a bill outstanding of -2,420,596, which is not a number
-- that can exist. Its two cancelled booking demands total exactly 2,791,773.
--
-- A receipt against a demand that no longer stands is not allocated to anything, which is precisely
-- what Farvision means by On Account. So a receipt line is now counted as allocated only when a
-- live (current, non-cancelled) invoice exists for that unit and document number; otherwise it is on
-- account. 5D now reads bill outstanding 0, on account 2,420,596 - fully paid, with the cancelled
-- money sitting as credit.
--
-- This does NOT move any reconciliation verdict, and that is arithmetic rather than disappointment:
--   net = (billed - allocated + reversals) - on_account
-- reclassifying X from allocated to on_account raises the first bracket by X and subtracts X again,
-- so net is invariant. What it fixes is the component figures, which are what a person reads when
-- they open a mismatch to investigate it.

create or replace view cust.reconciliation
with (security_invoker = true) as
with live_bill as (
  select distinct i.unit_id, i.document_no
    from cust.invoices i
   where i.is_current and i.deleted_at is null
     and coalesce(i.status,'') not ilike 'cancel%'),
billed as (
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
         sum(ri.amount) filter (where lb.document_no is not null) as allocated,
         sum(ri.amount) filter (where lb.document_no is null)     as on_account
    from cust.money_receipts r
    join cust.receipt_items ri on ri.receipt_id = r.id
    left join live_bill lb
      on lb.unit_id = r.unit_id and lb.document_no = ri.against_demand_no
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

grant select on cust.reconciliation to authenticated;
