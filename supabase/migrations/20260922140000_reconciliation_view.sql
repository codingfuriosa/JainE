-- Does the portal agree with Farvision, per unit?
--
-- Nothing checked this before, which is how cust.invoices and cust.money_receipts went eleven days
-- without being written while every import reported success. The Ledger kept rendering - just with a
-- current summary above an eleven-day-old transaction list.
--
-- Farvision's own definitions, verified against the Outstanding Summary (all 80 units satisfy it
-- exactly, which is why this view reproduces it rather than inventing its own arithmetic):
--
--   Net Outstanding = Bill Outstanding - On Account
--
--   Bill Outstanding : demands raised, not yet paid
--   On Account       : money received but NOT allocated against any demand
--
-- The portal side mirrors that using receipt_items.against_demand_no, which is what distinguishes
-- allocated money from money sitting on account. A reversal (bounced cheque) is added back to bill
-- outstanding: the demand it had paid becomes due again.
--
-- Both sides are exposed, not just a verdict. A number that disagrees is a question, and whoever
-- answers it needs to see which side moved.

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
  -- Farvision's "No. Of Bills" on an OUTSTANDING report counts bills still owing, not every bill
  -- ever raised, so this counts bills whose allocated receipts fall short of their value.
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
  'definition (Net Outstanding = Bill Outstanding - On Account). status is matched / mismatched / '
  'unchecked, the last meaning Farvision sent no snapshot for that unit, so nothing can be asserted '
  'about it either way.';

grant select on cust.reconciliation to authenticated;
