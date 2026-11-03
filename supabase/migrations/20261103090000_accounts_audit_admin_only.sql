/* THE AUDIT REGISTERS ARE FOR ACCOUNTS ADMINISTRATORS ONLY.

   WHAT WAS THERE.
   20261102150000 let anyone who can read Accounts read the audit registers: audit_log had a select policy on
   accounts.can_read(), and the Transfer / Reversal views simply read vouchers, which anyone with Accounts can read.

   WHAT CHANGES.
   Reading the audit log now needs accounts.is_admin() - an Accounts administrator (the people with the admin
   role in accounts.access) or a platform super admin, the same test that already guards editing the structure.
   The two views over vouchers (v_audit_reversals, v_audit_transfers) carry the same test, so asking the API for
   them directly returns nothing to anyone else; v_audit_log is covered by the table's own policy. The screens
   still read exactly these three views, so nothing else changes for an administrator.
   Accountants and everyone else with the module keep everything they had in Transactions and Ledgers & postings:
   the vouchers themselves are untouched, only these audit views stopped answering them. */

drop policy if exists audit_log_read on accounts.audit_log;
create policy audit_log_read on accounts.audit_log for select to authenticated using ((select accounts.is_admin()));

create or replace view accounts.v_audit_reversals with (security_invoker = true) as
  select 'voucher'::text as kind, v.id, v.company_id, v.business_unit_id, v.doc_no, v.voucher_type as doc_type, v.voucher_date as doc_date,
         v.amount, coalesce(v.payee, v.narration) as particulars, v.source_type,
         v.created_by as entered_by, v.created_at as entered_at,
         v.cancelled_by as reversed_by, v.cancelled_at as reversed_at, v.cancel_reason as reason
    from accounts.vouchers v
   where v.status = 'cancelled' and (select accounts.is_admin())
  union all
  select 'opening_bill'::text, p.id, p.company_id, p.business_unit_id, 'Opening bill ' || coalesce(p.ref_no, ''), 'opening_bill'::text, p.ref_date,
         p.amount, (select s.name from accounts.sub_ledgers s where s.id = p.sub_ledger_id), 'opening'::text,
         e.by, e.at, r.by, r.at, r.remark
    from accounts.payables p
    left join lateral (select l.by, l.at from accounts.doc_log l
                        where l.doc_type = 'payable' and l.doc_id = p.id and l.action = 'Opening bill entered' order by l.at limit 1) e on true
    left join lateral (select l.by, l.at, l.remark from accounts.doc_log l
                        where l.doc_type = 'payable' and l.doc_id = p.id and l.action = 'Bill cancelled' order by l.at desc limit 1) r on true
   where p.source_type = 'opening' and p.status = 'cancelled' and (select accounts.is_admin());

create or replace view accounts.v_audit_transfers with (security_invoker = true) as
  select v.id, v.company_id, v.business_unit_id, v.doc_no, v.voucher_type, v.voucher_date, v.amount, v.status, v.mode,
         v.instrument_no, v.instrument_date, v.narration,
         (select string_agg(distinct l.name, ', ') from accounts.voucher_lines vl join accounts.ledgers l on l.id = vl.ledger_id
           where vl.voucher_id = v.id and vl.cr > 0) as from_account,
         (select string_agg(distinct l.name, ', ') from accounts.voucher_lines vl join accounts.ledgers l on l.id = vl.ledger_id
           where vl.voucher_id = v.id and vl.dr > 0) as to_account,
         v.created_by, v.created_at, v.cancelled_by, v.cancelled_at, v.cancel_reason
    from accounts.vouchers v
   where v.voucher_type in ('contra', 'deposit', 'withdrawal') and (select accounts.is_admin());
