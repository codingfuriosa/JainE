-- Folds PTC into cust.reconciliation's own arithmetic, so the internal alarm agrees with what the
-- Ledger already computes (see 20260924070000_ptc_transfers.sql) rather than staying blind to the
-- one document type that explained most of the 21 mismatches.
--
-- Rebuilt from the view's LIVE definition (pg_get_viewdef), not from an earlier copy of this file:
-- the 'cost_sheet_only' status and its two fv_cost_sheet_* columns were added directly against the
-- database at some point with no matching migration in this repo - the first sign of that being this
-- session's own reconciliation query returning a status this migration's author had never seen. That
-- gap is worth closing separately; this migration preserves the drifted logic rather than reverting
-- it, since it is itself a correct and useful addition (a unit with a Sales Details cost sheet but no
-- Outstanding snapshot still has a Farvision-sourced figure to check against).
--
-- Verified against Pallabi Mukherjee's unit 2D against her real Farvision Customer Ledger printout:
-- billed 7,445,848 - allocated 5,963,042 - ptc_net(+210,000) = 1,272,806, Farvision's own balance.
--
-- That check caught a second, pre-existing bug while rebuilding this: rcpt's on_account bucket was
-- filtered on `lb.document_no is null`, true both for a receipt with NO target and for one pointing
-- at a CANCELLED invoice - conflating "unapplied money" with "money against a superseded demand".
-- Farvision's own printed ledger carries neither as a line item unless a PTC formally moves it (see
-- Pallabi's two receipts against her unit's own earlier, cancelled OHINV/0012524-25 and
-- OHINV/0015524-25: Rs 7,67,213 that inflated her mismatch by that exact amount before this fix).
-- on_account is now filtered on `ri.against_demand_no is null` - genuinely unallocated only - and a
-- receipt against a cancelled invoice is excluded from both allocated and on_account, exactly as the
-- Ledger (custTabLedger in nexus-core.js) already treats it.
--
-- Note this does NOT change anything a customer sees: the Statement reads Farvision's Outstanding
-- snapshot or cost sheet directly, never this view's own arithmetic, and the gate (custReconGate in
-- nexus-core.js) already shows a unit whenever status != 'unchecked' - matched AND mismatched alike -
-- because either way what renders is Farvision's own figure, not this view's. What this migration
-- improves is which units are correctly flagged 'matched' for the people auditing the books.

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
         sum(ri.amount) filter (where lb.document_no is not null)   as allocated,
         sum(ri.amount) filter (where ri.against_demand_no is null) as on_account
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
ptc as (
  select unit_id, sum(net) as net_credit from (
    select transferee_unit_id as unit_id, amount as net
      from cust.ptc_transfers where transferee_unit_id is not null and not is_reversed and deleted_at is null
    union all
    select source_unit_id, -amount
      from cust.ptc_transfers where source_unit_id is not null and not is_reversed and deleted_at is null
  ) x group by 1),
cs as (
  select unit_id, count(*) as n, sum(balance_amount) as balance, sum(received_amount) as received
    from cust.cost_sheet_items
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
  round(coalesce(b.amt,0) - coalesce(rc.allocated,0) + coalesce(rv.amt,0) - coalesce(ptc.net_credit,0), 2) as portal_bill_outstanding,
  round(coalesce(rc.on_account,0), 2)                                        as portal_on_account,
  round(coalesce(b.amt,0) - coalesce(rc.allocated,0) + coalesce(rv.amt,0) - coalesce(ptc.net_credit,0)
        - coalesce(rc.on_account,0), 2)                                      as portal_net_outstanding,
  coalesce(up.n,0)                                                           as portal_unpaid_bills,
  u.agreement_value                                                          as portal_total_consideration,
  round(coalesce(os.net_outstanding,0)
        - (coalesce(b.amt,0) - coalesce(rc.allocated,0) + coalesce(rv.amt,0) - coalesce(ptc.net_credit,0)
           - coalesce(rc.on_account,0)), 2)                                  as net_outstanding_delta,
  round(coalesce(os.on_account,0) - coalesce(rc.on_account,0), 2)            as on_account_delta,
  coalesce(os.no_of_bills,0) - coalesce(up.n,0)                              as bill_count_delta,
  case
    when os.unit_id is not null then
      case when abs(coalesce(os.net_outstanding,0)
                    - (coalesce(b.amt,0) - coalesce(rc.allocated,0) + coalesce(rv.amt,0) - coalesce(ptc.net_credit,0)
                       - coalesce(rc.on_account,0))) <= 1 then 'matched' else 'mismatched' end
    when cs.n is not null then 'cost_sheet_only'
    when coalesce(b.amt,0)=0 and coalesce(rc.allocated,0)=0 and coalesce(rc.on_account,0)=0
         and coalesce(rv.amt,0)=0 and coalesce(ptc.net_credit,0)=0 then 'no_activity'
    else 'unchecked'
  end as status,
  round(cs.balance,2)  as fv_cost_sheet_balance,
  round(cs.received,2) as fv_cost_sheet_received
from cust.units u
left join cust.projects  p  on p.id = u.project_id
left join cust.customers c  on c.id = u.customer_id
left join os      on os.unit_id = u.id
left join billed  b  on b.unit_id  = u.id
left join rcpt    rc on rc.unit_id = u.id
left join rev     rv on rv.unit_id = u.id
left join unpaid  up on up.unit_id = u.id
left join ptc     on ptc.unit_id = u.id
left join cs      on cs.unit_id = u.id
where u.deleted_at is null;

grant select on cust.reconciliation to authenticated;
