-- Accounts: two read-only helpers for the receipt / payment form.
--   ledger_balance  - what the ledger (or one of its sub-ledgers) stands at on a date: opening + posted vouchers.
--                     Positive = debit balance, negative = credit balance. Runs as the caller, so row security
--                     decides what they can see.
--   peek_doc_no     - the number the next voucher of that type would get, WITHOUT using it up. The real number is
--                     still taken by next_doc_no when the voucher is posted, so the form shows it as the next number.

create or replace function accounts.ledger_balance(p_company bigint, p_ledger bigint, p_sub bigint default null, p_as_on date default current_date)
returns numeric
language sql
stable
set search_path to 'accounts', 'public'
as $$
  select coalesce((select sum(o.dr - o.cr) from accounts.opening_balances o
                    where o.company_id = p_company and o.ledger_id = p_ledger and (p_sub is null or o.sub_ledger_id = p_sub)), 0)
       + coalesce((select sum(l.dr - l.cr) from accounts.voucher_lines l join accounts.vouchers v on v.id = l.voucher_id
                    where v.company_id = p_company and v.status = 'posted' and v.voucher_date <= coalesce(p_as_on, current_date)
                      and l.ledger_id = p_ledger and (p_sub is null or l.sub_ledger_id = p_sub)), 0)
$$;

create or replace function accounts.peek_doc_no(p_company bigint, p_type text, p_date date)
returns text
language plpgsql
stable
security definer
set search_path to 'accounts', 'public'
as $$
declare c accounts.companies; v_y int; v_fy text; v_n int;
begin
  if not accounts.can_read() then raise exception 'You do not have access to Accounts'; end if;
  select * into c from accounts.companies where id = p_company;
  if not found then return null; end if;
  v_y := extract(year from p_date)::int;
  if extract(month from p_date) < c.fy_start_month then v_y := v_y - 1; end if;
  v_fy := case when c.fy_start_month = 1 then lpad((v_y % 100)::text, 2, '0') else lpad((v_y % 100)::text, 2, '0') || '-' || lpad(((v_y + 1) % 100)::text, 2, '0') end;
  select last_no + 1 into v_n from accounts.doc_counters where company_id = p_company and doc_type = accounts._doc_prefix(p_type) and fy = v_fy;
  return c.short_code || '/' || accounts._doc_prefix(p_type) || '/' || v_fy || '/' || lpad(coalesce(v_n, 1)::text, 4, '0');
end $$;

revoke all on function accounts.ledger_balance(bigint, bigint, bigint, date) from public, anon;
revoke all on function accounts.peek_doc_no(bigint, text, date) from public, anon;
grant execute on function accounts.ledger_balance(bigint, bigint, bigint, date) to authenticated;
grant execute on function accounts.peek_doc_no(bigint, text, date) to authenticated;
