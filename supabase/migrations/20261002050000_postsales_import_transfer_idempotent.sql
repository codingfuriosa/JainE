-- import_farvision skipped a Farvision PTC transfer only when a payout already carried its id. A transfer whose
-- source flat is not a Post Sales booking has no payout, so every re-run (the Farvision sync) added its
-- transfer-in receipt again. Also skip when the transfer-in receipt already exists.
do $do$
declare src text := pg_get_functiondef('postsales.import_farvision(boolean)'::regprocedure);
        old text := 'and not exists(select 1 from postsales.payouts x where x.farvision_ptc_id = p.id) order by p.document_date, p.id loop';
begin
  if position(old in src) = 0 then raise exception 'pattern not found'; end if;
  src := replace(src, old, 'and not exists(select 1 from postsales.payouts x where x.farvision_ptc_id = p.id)
             and not exists(select 1 from postsales.receipts x where x.mode = ''transfer'' and x.instrument_no = p.document_no and x.receipt_no like p.document_no || ''/IN%'') order by p.document_date, p.id loop');
  execute src;
end $do$;

-- undo the duplicate transfer-in receipts created by the first sync run (02-Oct-2026 10:26 IST)
do $do$
declare ids bigint[]; bk bigint;
begin
  select array_agg(id) into ids from postsales.receipts
   where created_at = '2026-10-02 04:56:42.716832+00' and mode = 'transfer' and receipt_no ~ '/IN/[0-9]+$';
  delete from postsales.receipt_allocations where receipt_id = any(ids);
  delete from postsales.receipts where id = any(ids);
  for bk in select distinct booking_id from postsales.receipts where mode = 'transfer' loop
    perform postsales.reallocate_booking(bk);
  end loop;
end $do$;
