-- Invoices due on the same day are paid in payment-plan order (milestone seq), not invoice-number order:
-- a balance-booking demand raised by hand after a stage's bulk invoices still gets paid first.
create or replace function postsales.reallocate_booking(p_booking_id bigint) returns void
 language plpgsql security invoker set search_path = postsales, public
as $$
declare
  rc record; inv record; v_rem numeric; v_open numeric; v_take numeric;
begin
  delete from postsales.receipt_allocations a using postsales.receipts r
   where a.receipt_id = r.id and r.booking_id = p_booking_id;
  for rc in select id, amount, against_interest from postsales.receipts
             where booking_id = p_booking_id and status = 'active' order by receipt_date, id loop
    v_rem := rc.amount;
    for inv in select i.id, i.total from postsales.invoices i
                left join postsales.booking_milestones bm on bm.id = i.booking_milestone_id
                where i.booking_id = p_booking_id and i.status = 'open'
                  and (case when rc.against_interest then i.kind = 'interest' else i.kind <> 'interest' end)
                order by i.due_date, coalesce(bm.seq, 9999), i.invoice_date, i.id loop
      exit when v_rem <= 0;
      select inv.total - coalesce(sum(a.amount), 0) into v_open from postsales.receipt_allocations a where a.invoice_id = inv.id;
      continue when v_open <= 0;
      v_take := least(v_open, v_rem);
      insert into postsales.receipt_allocations(receipt_id, invoice_id, amount) values (rc.id, inv.id, v_take);
      v_rem := v_rem - v_take;
    end loop;
  end loop;
end $$;
