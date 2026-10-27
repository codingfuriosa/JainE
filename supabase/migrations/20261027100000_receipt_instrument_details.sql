-- MONEY RECEIPT: Drawn On / Instrument No / Instrument Date (27 Oct 2026)
-- The Receipt Register export always carried Instrument No, Instrument Date, Drawn On, Drawn On
-- Branch, Deposit Bank/Debit Ledger and Narration, but the parser never read them, so every receipt
-- imported since the Gmail queue started printed "—" in the instrument block of the Money Receipt
-- (e.g. Dream Ananta 8G, DA1RECEIPT/0006826-27). The parser (src/core/29-customer-portal.js,
-- cpaParseReceiptRegister) now reads them; this teaches the automatic import to store them.
-- Edits the three receipt statements inside cust.fv_apply_file in place, each found exactly once,
-- so the rest of the function is untouched. Safe to re-run.
do $mig$
declare
  src text := pg_get_functiondef('cust.fv_apply_file(bigint,bigint,text,text)'::regprocedure);
  a text := $a$payment_mode = m.r ->> 'mode', total_amount = g.total,$a$;
  a2 text := $a$payment_mode = m.r ->> 'mode', total_amount = g.total,
        instrument_no = m.r ->> 'instrumentNo', instrument_date = (m.r ->> 'instrumentDate')::date,
        drawn_on = m.r ->> 'drawnOn', drawn_on_branch = m.r ->> 'drawnOnBranch',
        deposit_bank = m.r ->> 'depositBank', narration = m.r ->> 'narration',$a$;
  b text := $b$unit_status_at_receipt, is_current, import_batch_id)$b$;
  b2 text := $b$unit_status_at_receipt, is_current, import_batch_id,
                                       instrument_no, instrument_date, drawn_on, drawn_on_branch, deposit_bank, narration)$b$;
  c text := $c$coalesce(m.r ->> 'isReversed', '') = 'Yes', m.r ->> 'unitStatus', true, v_batch$c$;
  c2 text := $c$coalesce(m.r ->> 'isReversed', '') = 'Yes', m.r ->> 'unitStatus', true, v_batch,
             m.r ->> 'instrumentNo', (m.r ->> 'instrumentDate')::date, m.r ->> 'drawnOn', m.r ->> 'drawnOnBranch',
             m.r ->> 'depositBank', m.r ->> 'narration'$c$;
  cnt int;
begin
  -- 'drawnOn' only appears once this has run ('instrumentNo' is also used by the cheque-return section).
  if position('drawnOn' in src) > 0 then
    raise notice 'already applied';
    return;
  end if;
  foreach cnt in array array[
      (length(src) - length(replace(src, a, ''))) / length(a),
      (length(src) - length(replace(src, b, ''))) / length(b),
      (length(src) - length(replace(src, c, ''))) / length(c)] loop
    if cnt <> 1 then raise exception 'cust.fv_apply_file is not the expected version (anchor found % times)', cnt; end if;
  end loop;
  execute replace(replace(replace(src, a, a2), b, b2), c, c2);
end
$mig$;
