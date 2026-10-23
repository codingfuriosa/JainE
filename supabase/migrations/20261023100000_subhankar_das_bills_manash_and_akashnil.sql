-- INVOICE PROCESSING: SUBHANKAR DAS'S BILLS ON AYUSH RUIA'S DESK - AYUSH, MANASH AND AKASHNIL.
--
-- (23 Oct 2026) 20261017120000 moved SUBHANKAR DAS's bills on Ayush's desk away from Manash
-- Choudhury to Akashnil Basu - but only as a read-only viewer, so Bill 545 (JainE Id 545) could be
-- received and forwarded by Ayush alone. Now all three handle them:
--
--   Manash Choudhury (digitalmarketing@) - the SUBHANKAR DAS exception is taken off his view; he
--     already stands in for Ayush on Invoice Processing, so he sees and handles these as any other.
--   Akashnil Basu (socialmedia@) - stands in for Ayush on Invoice Processing too, but only on bills
--     whose Vendor is SUBHANKAR DAS (wf_proxy.only_when, same shape as a case_viewers only_when).
--     His view was already limited to those bills, and his task list now is as well.

alter table acc.wf_proxy add column if not exists only_when jsonb;

-- 1. Manash: no SUBHANKAR DAS exception any more.
update acc.flows f
   set case_viewers = (
     select coalesce(jsonb_agg(
              case when lower(coalesce(v->>'viewer','')) = 'digitalmarketing@thejaingroup.com'
                    and lower(coalesce(v->>'watches','')) = 'system.admin@thejaingroup.com'
                   then v - 'unless' else v end), '[]'::jsonb)
       from jsonb_array_elements(coalesce(f.case_viewers,'[]'::jsonb)) v)
 where f.id = 26;

-- 2. Akashnil: stands in for Ayush on SUBHANKAR DAS bills.
insert into acc.wf_proxy (principal_email, proxy_email, flow_id, active, note, created_by, only_when)
select 'system.admin@thejaingroup.com', 'socialmedia@thejaingroup.com', 26, true,
       'Akashnil Basu receives and forwards Ayush Ruia''s SUBHANKAR DAS bills on his behalf', 'system',
       '{"label":"Vendor","in":["SUBHANKAR DAS"]}'::jsonb
where not exists (select 1 from acc.wf_proxy where lower(principal_email)='system.admin@thejaingroup.com'
                    and lower(proxy_email)='socialmedia@thejaingroup.com' and flow_id=26);

-- 3. A stand-in limited by only_when gets only the matching bills in their task list.
create or replace function acc.wf_proxy_task_ids()
returns table(task_id bigint, principal_email text, flow_id bigint)
language sql stable security definer
set search_path to 'acc','public'
as $function$
  select distinct fcs.task_id, lower(x.principal_email), c.flow_id
    from acc.wf_proxy x
    join acc.flow_cases c
      on (x.flow_id is null or c.flow_id = x.flow_id)
    join acc.flow_case_steps fcs
      on fcs.case_id = c.id
     and lower(coalesce(fcs.person,'')) = lower(x.principal_email)
   where x.active
     and lower(x.proxy_email) = lower(coalesce(app.current_user_email(),''))
     and fcs.task_id is not null
     and fcs.forwarded_at is null
     and coalesce(c.status,'') not in ('Done','Cancelled')
     and (x.only_when is null
          or acc.wf_viewer_entry_applies(jsonb_build_object('only_when', x.only_when), c.trigger_details));
$function$;
