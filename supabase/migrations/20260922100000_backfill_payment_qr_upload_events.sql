/* The payment-QR uploads that happened before the counting was fixed.

   The feature was wired to the wrong click (see the 20260922090000 migration and the commit that
   went with it), so 53 Reimbursement claims carrying a QR produced no usage events at all. The
   facts were never lost - they are on the claims themselves - and they can be recovered exactly
   rather than estimated:

     WHEN. s3Stamp() puts Date.now() on the front of every key it mints, so the file name carries
     the millisecond the upload actually happened. Not the claim's timestamp, which is a different
     moment and sometimes a different month - two of the four "uploads" on 21 Sep turned out to be
     images first uploaded on 25 and 31 August.

     WHO. No QR file appears on two different people's claims - checked, zero crossings - so the
     person on the claim is the person who uploaded it, with nothing to infer.

     UPLOAD vs REUSE. A distinct key is one real upload. The same key turning up on a later claim
     is upiScannerMemory pre-filling the last image, which is the auto-remembering working, not a
     second upload. Counting all 53 as uploads would have overstated them by 23 and buried the one
     finding worth having: 23 of 53 payment destinations were reused rather than re-uploaded.

   Marked backfill:true, the same way the earlier historical reconstruction marked its own rows, so
   a reader can always tell a recovered row from a captured one. client_event_id makes this
   re-runnable: a second pass inserts nothing. */

-- Genuine uploads: one per distinct QR file, timed from the S3 key.
insert into public.erp_usage_events
  (feature_key, action, user_email, department, occurred_at, meta, module_id, client_event_id)
select 'tasks.workflow.upload_and_auto_remember_a_payment_qr_upi_id', 'create',
       f.created_by,
       (select u.department[1] from adm.users u where lower(u.email)=lower(f.created_by)),
       to_timestamp(f.ms/1000.0),
       jsonb_build_object('via','QR image','backfill',true),
       'tasks',
       'qr-upload:'||f.qr
  from (
    select distinct on (k.qr) k.qr, k.created_by, k.ms
      from (
        select (select d->>'value' from jsonb_array_elements(fc.trigger_details) d
                 where d->>'label'='QR Code') as qr,
               fc.created_by, fc.created_at
          from acc.flow_cases fc where fc.flow_id = 39
      ) c
      cross join lateral (
        select c.qr, c.created_by, c.created_at,
               (substring(split_part(c.qr,'/',array_length(string_to_array(c.qr,'/'),1))
                          from '^(\d+)_'))::bigint as ms
      ) k
     where btrim(coalesce(k.qr,'')) <> ''
       and k.qr ~ '/\d+_'
     order by k.qr, k.created_at
  ) f
 where not exists (select 1 from public.erp_usage_events e
                    where e.client_event_id = 'qr-upload:'||f.qr);

-- Reuses: the remembered image re-attached to a later claim.
insert into public.erp_usage_events
  (feature_key, action, user_email, department, occurred_at, meta, module_id, client_event_id)
select 'tasks.workflow.upload_and_auto_remember_a_payment_qr_upi_id', 'create',
       r.created_by,
       (select u.department[1] from adm.users u where lower(u.email)=lower(r.created_by)),
       r.created_at,
       jsonb_build_object('via','Reused saved QR','backfill',true),
       'tasks',
       'qr-reuse:'||r.case_id
  from (
    select c.id as case_id, c.created_by, c.created_at, c.qr,
           row_number() over (partition by c.qr order by c.created_at) as seen
      from (
        select fc.id, fc.created_by, fc.created_at,
               (select d->>'value' from jsonb_array_elements(fc.trigger_details) d
                 where d->>'label'='QR Code') as qr
          from acc.flow_cases fc where fc.flow_id = 39
      ) c
     where btrim(coalesce(c.qr,'')) <> ''
  ) r
 where r.seen > 1
   and not exists (select 1 from public.erp_usage_events e
                    where e.client_event_id = 'qr-reuse:'||r.case_id);
