-- Usability: give every historical event a Details a person can read.
--
-- The one-time backfill reconstructed 5,344 events from the business tables and stamped each with
-- an internal pointer, {ref:'<table>.<action>:<id>', backfill:true}, and nothing else. Only
-- create_task was ever enriched beyond that, so on every other feature the drill-down's Details
-- column was a dash - or, before the marker was hidden, the marker itself, which read as garbled
-- data. 1,746 documents uploaded, 590 interviews added, 517 calls transcribed, 597 case files,
-- and not one of them said WHICH.
--
-- The pointer is enough to go back and ask. Each block below follows one kind of ref to the row it
-- came from and copies out the name that row is known by, plus at most one or two things worth
-- saying beside it. Where the action was about a person (a task's assignees, a step's next owner)
-- the name goes in 'assignee', which the report shows in its own column.
--
-- Every block is additive and idempotent: it writes only into events that still have no title,
-- touches no other key, and re-running changes nothing. Names for people come from
-- acc.user_profile - the same source acc.people() and the app itself use.
--
-- Rows whose source has since been deleted keep an empty Details. That is the honest answer, and
-- there are 301 of them left after this runs, nearly all workflow steps and instances that were
-- deleted along with their tasks.

-- ── Accountability · Tasks ────────────────────────────────────────────────────
-- pa:<ptasks.id> covers eight features (approve, decline, mark done, revert, delegate and the
-- edit-title/description/due-date/project set) - all of them actions ON a task, so all of them
-- want the task's name and who it is assigned to.
with pm as (
  select lower(email) as e, nullif(trim(full_name), '') as fn
  from acc.user_profile where nullif(trim(full_name), '') is not null
),
t as (
  select p.id as tid, nullif(trim(p.title), '') as title,
    (select string_agg(distinct coalesce(pm.fn, split_part(lower(a.email), '@', 1)), ', ')
       from acc.ptask_assignees a left join pm on pm.e = lower(a.email)
      where a.task_id = p.id) as asg
  from acc.ptasks p
)
update public.erp_usage_events ev
set meta = ev.meta || jsonb_strip_nulls(jsonb_build_object('title', t.title, 'assignee', t.asg))
from t
where ev.meta->>'ref' like 'pa:%'
  and t.tid = split_part(ev.meta->>'ref', ':', 2)::bigint
  and ev.meta->>'title' is null;

-- A comment's own text is not the detail - the task it was left on is.
with pm as (
  select lower(email) as e, nullif(trim(full_name), '') as fn
  from acc.user_profile where nullif(trim(full_name), '') is not null
),
c as (
  select cm.id as cid, nullif(trim(p.title), '') as title,
    (select string_agg(distinct coalesce(pm.fn, split_part(lower(a.email), '@', 1)), ', ')
       from acc.ptask_assignees a left join pm on pm.e = lower(a.email)
      where a.task_id = p.id) as asg
  from acc.ptask_comments cm left join acc.ptasks p on p.id = cm.task_id
)
update public.erp_usage_events ev
set meta = ev.meta || jsonb_strip_nulls(jsonb_build_object('title', c.title, 'assignee', c.asg))
from c
where ev.meta->>'ref' like 'pcm:%'
  and c.cid = split_part(ev.meta->>'ref', ':', 2)::bigint
  and ev.meta->>'title' is null;

with pm as (
  select lower(email) as e, nullif(trim(full_name), '') as fn
  from acc.user_profile where nullif(trim(full_name), '') is not null
),
f as (
  select fl.id as fid, nullif(trim(fl.file_name), '') as fname, nullif(trim(p.title), '') as task,
    (select string_agg(distinct coalesce(pm.fn, split_part(lower(a.email), '@', 1)), ', ')
       from acc.ptask_assignees a left join pm on pm.e = lower(a.email)
      where a.task_id = p.id) as asg
  from acc.ptask_files fl left join acc.ptasks p on p.id = fl.task_id
)
update public.erp_usage_events ev
set meta = ev.meta || jsonb_strip_nulls(jsonb_build_object('title', f.task, 'file', f.fname, 'assignee', f.asg))
from f
where ev.meta->>'ref' like 'pfile:%'
  and f.fid = split_part(ev.meta->>'ref', ':', 2)::bigint
  and ev.meta->>'title' is null;

-- A checklist item is only meaningful under its task, so the task leads and the item follows.
with s as (
  select st.id as sid, nullif(trim(st.title), '') as item, nullif(trim(p.title), '') as task
  from acc.ptask_subtasks st left join acc.ptasks p on p.id = st.task_id
)
update public.erp_usage_events ev
set meta = ev.meta || jsonb_strip_nulls(jsonb_build_object(
      'title', coalesce(s.task, s.item),
      'item', case when s.task is null then null else s.item end))
from s
where ev.meta->>'ref' like 'psub:%'
  and s.sid = split_part(ev.meta->>'ref', ':', 2)::bigint
  and ev.meta->>'title' is null;

-- ── Accountability · Workflow ─────────────────────────────────────────────────
-- What makes a workflow event readable is which step, of which instance, of which workflow - the
-- same four keys the live code now captures (workflow / instance / ref_no / step), so history and
-- new events read identically. For a forward, 'assignee' is the person it moved ON to; for a
-- reject, the person it went back to; for a new instance, whoever holds the first step.
update public.erp_usage_events ev
set meta = ev.meta || jsonb_strip_nulls(jsonb_build_object('workflow', f.name))
from acc.flows f
where ev.meta->>'ref' like 'flow:%'
  and f.id = split_part(ev.meta->>'ref', ':', 2)::bigint
  and not (ev.meta ? 'workflow');

with pm as (
  select lower(email) as e, nullif(trim(full_name), '') as fn
  from acc.user_profile where nullif(trim(full_name), '') is not null
),
s as (
  select st.id as fcs_id, st.case_id, st.seq, nullif(trim(st.title), '') as step,
         f.name as flow_name, nullif(trim(c.title), '') as inst,
         coalesce(c.jaine_id, c.case_no) as refno
  from acc.flow_case_steps st
  left join acc.flow_cases c on c.id = st.case_id
  left join acc.flows f on f.id = c.flow_id
),
w as (
  select s.*,
    (select string_agg(distinct coalesce(pm.fn, split_part(lower(trim(em)), '@', 1)), ', ')
       from unnest(case when coalesce(n.claimed_by, n.person) is not null
                        then string_to_array(coalesce(n.claimed_by, n.person), ',')
                        else coalesce(n.candidates, array[]::text[]) end) em
       left join pm on pm.e = lower(trim(em))
      where nullif(trim(em), '') is not null) as next_owner
  from s
  -- the step the instance moved on to: the next one that actually appeared, not merely the next
  -- number - a route can skip steps, and a skipped step never held the work
  left join lateral (
    select n2.* from acc.flow_case_steps n2
     where n2.case_id = s.case_id and n2.seq > s.seq and n2.appeared_at is not null
     order by n2.seq limit 1
  ) n on true
)
update public.erp_usage_events ev
set meta = ev.meta || jsonb_strip_nulls(jsonb_build_object(
      'workflow', w.flow_name, 'instance', w.inst,
      'ref_no', case when w.refno is null then null else w.refno::text end,
      'step', w.step,
      'assignee', case when ev.meta->>'ref' like 'fcs.f:%' then w.next_owner else null end))
from w
where ev.meta->>'ref' ~ '^fcs\.(f|r):'
  and w.fcs_id = split_part(ev.meta->>'ref', ':', 2)::bigint
  and not (ev.meta ? 'workflow');

with pm as (
  select lower(email) as e, nullif(trim(full_name), '') as fn
  from acc.user_profile where nullif(trim(full_name), '') is not null
),
c as (
  select fc.id as case_id, f.name as flow_name, nullif(trim(fc.title), '') as inst,
         coalesce(fc.jaine_id, fc.case_no) as refno, nullif(trim(fc.returned_to), '') as ret_to
  from acc.flow_cases fc left join acc.flows f on f.id = fc.flow_id
),
w as (
  select c.*,
    (select string_agg(distinct coalesce(pm.fn, split_part(lower(trim(em)), '@', 1)), ', ')
       from unnest(case when coalesce(f1.claimed_by, f1.person) is not null
                        then string_to_array(coalesce(f1.claimed_by, f1.person), ',')
                        else coalesce(f1.candidates, array[]::text[]) end) em
       left join pm on pm.e = lower(trim(em))
      where nullif(trim(em), '') is not null) as first_owner,
    (select coalesce(pm.fn, split_part(lower(c.ret_to), '@', 1)) from pm where pm.e = lower(c.ret_to)) as ret_name
  from c
  left join lateral (
    select st.* from acc.flow_case_steps st where st.case_id = c.case_id order by st.seq limit 1
  ) f1 on true
)
update public.erp_usage_events ev
set meta = ev.meta || jsonb_strip_nulls(jsonb_build_object(
      'workflow', w.flow_name, 'instance', w.inst,
      'ref_no', case when w.refno is null then null else w.refno::text end,
      'assignee', case when ev.meta->>'ref' like 'fcase.rj:%'
                       then coalesce(w.ret_name, w.ret_to) else w.first_owner end))
from w
where ev.meta->>'ref' ~ '^(fcase|fcase\.rj|fupd):'
  and w.case_id = split_part(ev.meta->>'ref', ':', 2)::bigint
  and not (ev.meta ? 'workflow');

-- Invoice Processing was rebuilt on 7 Sep and its old instances dropped, taking their steps and
-- tasks with them. The backup taken at the time is the only place those names still exist.
with pm as (
  select lower(email) as e, nullif(trim(full_name), '') as fn
  from acc.user_profile where nullif(trim(full_name), '') is not null
),
bs as (
  select st.id as fcs_id, st.case_id, st.seq, nullif(trim(st.title), '') as step,
         coalesce(f.name, 'Invoice Processing') as flow_name,
         nullif(trim(c.title), '') as inst, coalesce(c.jaine_id, c.case_no) as refno
  from acc.flow31_backup_case_steps_20260907 st
  left join acc.flow31_backup_cases_20260907 c on c.id = st.case_id
  left join acc.flow31_backup_flow_20260907 f on f.id = c.flow_id
),
w as (
  select bs.*,
    (select string_agg(distinct coalesce(pm.fn, split_part(lower(trim(em)), '@', 1)), ', ')
       from unnest(case when coalesce(n.claimed_by, n.person) is not null
                        then string_to_array(coalesce(n.claimed_by, n.person), ',')
                        else coalesce(n.candidates, array[]::text[]) end) em
       left join pm on pm.e = lower(trim(em))
      where nullif(trim(em), '') is not null) as next_owner
  from bs
  left join lateral (
    select n2.* from acc.flow31_backup_case_steps_20260907 n2
     where n2.case_id = bs.case_id and n2.seq > bs.seq and n2.appeared_at is not null
     order by n2.seq limit 1
  ) n on true
)
update public.erp_usage_events ev
set meta = ev.meta || jsonb_strip_nulls(jsonb_build_object(
      'workflow', w.flow_name, 'instance', w.inst,
      'ref_no', case when w.refno is null then null else w.refno::text end,
      'step', w.step,
      'assignee', case when ev.meta->>'ref' like 'fcs.f:%' then w.next_owner else null end))
from w
where ev.meta->>'ref' ~ '^fcs\.(f|r):'
  and w.fcs_id = split_part(ev.meta->>'ref', ':', 2)::bigint
  and not (ev.meta ? 'workflow');

with pm as (
  select lower(email) as e, nullif(trim(full_name), '') as fn
  from acc.user_profile where nullif(trim(full_name), '') is not null
),
bc as (
  select c.id as case_id, coalesce(f.name, 'Invoice Processing') as flow_name,
         nullif(trim(c.title), '') as inst, coalesce(c.jaine_id, c.case_no) as refno,
         nullif(trim(c.returned_to), '') as ret_to
  from acc.flow31_backup_cases_20260907 c
  left join acc.flow31_backup_flow_20260907 f on f.id = c.flow_id
),
w as (
  select bc.*,
    (select coalesce(pm.fn, split_part(lower(bc.ret_to), '@', 1)) from pm where pm.e = lower(bc.ret_to)) as ret_name,
    (select string_agg(distinct coalesce(pm2.fn, split_part(lower(trim(em)), '@', 1)), ', ')
       from unnest(case when coalesce(f1.claimed_by, f1.person) is not null
                        then string_to_array(coalesce(f1.claimed_by, f1.person), ',')
                        else coalesce(f1.candidates, array[]::text[]) end) em
       left join pm pm2 on pm2.e = lower(trim(em))
      where nullif(trim(em), '') is not null) as first_owner
  from bc
  left join lateral (
    select s.* from acc.flow31_backup_case_steps_20260907 s where s.case_id = bc.case_id order by s.seq limit 1
  ) f1 on true
)
update public.erp_usage_events ev
set meta = ev.meta || jsonb_strip_nulls(jsonb_build_object(
      'workflow', w.flow_name, 'instance', w.inst,
      'ref_no', case when w.refno is null then null else w.refno::text end,
      'assignee', case when ev.meta->>'ref' like 'fcase.rj:%'
                       then coalesce(w.ret_name, w.ret_to) else w.first_owner end))
from w
where ev.meta->>'ref' ~ '^(fcase|fcase\.rj|fupd):'
  and w.case_id = split_part(ev.meta->>'ref', ':', 2)::bigint
  and not (ev.meta ? 'workflow');

-- ── Legal · Documents and MIS ─────────────────────────────────────────────────
update public.erp_usage_events ev
set meta = ev.meta || jsonb_strip_nulls(jsonb_build_object(
      'title', coalesce(nullif(trim(d.title), ''), nullif(trim(d.file_name), '')),
      'department', nullif(trim(d.department), '')))
from doc.documents d
where ev.meta->>'ref' like 'doc:%'
  and d.id::text = split_part(ev.meta->>'ref', ':', 2)
  and ev.meta->>'title' is null;

update public.erp_usage_events ev
set meta = ev.meta || jsonb_strip_nulls(jsonb_build_object(
      'title', nullif(trim(fo.name), ''), 'department', nullif(trim(fo.department), '')))
from doc.folders fo
where ev.meta->>'ref' like 'dfold:%'
  and fo.id::text = split_part(ev.meta->>'ref', ':', 2)
  and ev.meta->>'title' is null;

-- A case file is filed under a case, and the case is what a reader recognises.
update public.erp_usage_events ev
set meta = ev.meta || jsonb_strip_nulls(jsonb_build_object(
      'title', coalesce(nullif(trim(mc.cause_title), ''), nullif(trim(mf.file_name), '')),
      'file', case when nullif(trim(mc.cause_title), '') is null then null else nullif(trim(mf.file_name), '') end,
      'case_no', nullif(trim(mc.case_no), '')))
from public.mis_case_files mf
  left join public.mis_case_folders mfo on mfo.id = mf.folder_id
  left join public.mis_cases mc on mc.id = mfo.case_id
where ev.meta->>'ref' like 'misf:%'
  and mf.id::text = split_part(ev.meta->>'ref', ':', 2)
  and ev.meta->>'title' is null;

update public.erp_usage_events ev
set meta = ev.meta || jsonb_strip_nulls(jsonb_build_object(
      'title', coalesce(nullif(trim(mc.cause_title), ''), nullif(trim(ma.action_needed), '')),
      'action', case when nullif(trim(mc.cause_title), '') is null then null else nullif(trim(ma.action_needed), '') end,
      'case_no', nullif(trim(mc.case_no), '')))
from public.mis_actions ma left join public.mis_cases mc on mc.id = ma.case_id
where ev.meta->>'ref' like 'misact:%'
  and ma.id::text = split_part(ev.meta->>'ref', ':', 2)
  and ev.meta->>'title' is null;

update public.erp_usage_events ev
set meta = ev.meta || jsonb_strip_nulls(jsonb_build_object(
      'title', nullif(trim(la.advocate_name), ''), 'court', nullif(trim(la.court), '')))
from public.legal_advocates la
where ev.meta->>'ref' like 'adv:%'
  and la.id::text = split_part(ev.meta->>'ref', ':', 2)
  and ev.meta->>'title' is null;

-- ── HR and Recruitment ────────────────────────────────────────────────────────
-- Each of these reads the live table first and its backup second, so a row deleted since the
-- backfill still gets its name from wherever it survives.
update public.erp_usage_events ev
set meta = ev.meta || jsonb_strip_nulls(jsonb_build_object(
      'title', nullif(trim(it.candidate_name), ''), 'position', nullif(trim(it.position), '')))
from hr.interview_tracker it
where ev.meta->>'ref' like 'itr:%' and it.id::text = split_part(ev.meta->>'ref', ':', 2)
  and ev.meta->>'title' is null;

update public.erp_usage_events ev
set meta = ev.meta || jsonb_strip_nulls(jsonb_build_object(
      'title', nullif(trim(it.candidate_name), ''), 'position', nullif(trim(it.position), '')))
from hr.interview_tracker_backup_20260906 it
where ev.meta->>'ref' like 'itr:%' and it.id::text = split_part(ev.meta->>'ref', ':', 2)
  and ev.meta->>'title' is null;

-- hr.hs_candidates itself is gone; its 7 Sep backup is all that is left of those 79 events.
update public.erp_usage_events ev
set meta = ev.meta || jsonb_strip_nulls(jsonb_build_object(
      'title', nullif(trim(hc.name), ''), 'position', nullif(trim(hc.position), '')))
from hr.hs_candidates_backup_20260907 hc
where ev.meta->>'ref' like 'hsc:%' and hc.id::text = split_part(ev.meta->>'ref', ':', 2)
  and ev.meta->>'title' is null;

update public.erp_usage_events ev
set meta = ev.meta || jsonb_strip_nulls(jsonb_build_object('title', nullif(trim(g.title), '')))
from hr.interview_guides g
where ev.meta->>'ref' like 'ig:%' and g.id::text = split_part(ev.meta->>'ref', ':', 2)
  and ev.meta->>'title' is null;

update public.erp_usage_events ev
set meta = ev.meta || jsonb_strip_nulls(jsonb_build_object('title', nullif(trim(mu.month_label), '')))
from hr.monthly_updates mu
where ev.meta->>'ref' like 'mup:%' and mu.id::text = split_part(ev.meta->>'ref', ':', 2)
  and ev.meta->>'title' is null;

update public.erp_usage_events ev
set meta = ev.meta || jsonb_strip_nulls(jsonb_build_object('title', nullif(trim(mu.month_label), '')))
from hr.monthly_updates_backup_20260907 mu
where ev.meta->>'ref' like 'mup:%' and mu.id::text = split_part(ev.meta->>'ref', ':', 2)
  and ev.meta->>'title' is null;

update public.erp_usage_events ev
set meta = ev.meta || jsonb_strip_nulls(jsonb_build_object(
      'title', coalesce(nullif(trim(r.candidate_name), ''), nullif(trim(r.file_name), '')),
      'role', nullif(trim(r.role_title), '')))
from hr.resumes r
where ev.meta->>'ref' like 'res:%' and r.id::text = split_part(ev.meta->>'ref', ':', 2)
  and ev.meta->>'title' is null;

update public.erp_usage_events ev
set meta = ev.meta || jsonb_strip_nulls(jsonb_build_object(
      'title', nullif(trim(m.job_title), ''), 'department', nullif(trim(m.department), '')))
from hr.manpower_requests m
where ev.meta->>'ref' like 'mpr:%' and m.id::text = split_part(ev.meta->>'ref', ':', 2)
  and ev.meta->>'title' is null;

update public.erp_usage_events ev
set meta = ev.meta || jsonb_strip_nulls(jsonb_build_object(
      'title', nullif(trim(m.job_title), ''), 'department', nullif(trim(m.department), '')))
from hr.manpower_requests_backup_20260907 m
where ev.meta->>'ref' like 'mpr:%' and m.id::text = split_part(ev.meta->>'ref', ':', 2)
  and ev.meta->>'title' is null;

-- job_descriptions.id is a uuid, so the comparison is done as text - a cast of the ref would
-- throw on any marker that is not one.
update public.erp_usage_events ev
set meta = ev.meta || jsonb_strip_nulls(jsonb_build_object(
      'title', coalesce(nullif(trim(j.name), ''), nullif(trim(j.file_name), ''))))
from recruit.job_descriptions j
where ev.meta->>'ref' like 'jd:%' and j.id::text = split_part(ev.meta->>'ref', ':', 2)
  and ev.meta->>'title' is null;

update public.erp_usage_events ev
set meta = ev.meta || jsonb_strip_nulls(jsonb_build_object('title', nullif(trim(t.name), '')))
from recruit.tests t
where ev.meta->>'ref' like 'test:%' and t.id::text = split_part(ev.meta->>'ref', ':', 2)
  and ev.meta->>'title' is null;

-- ── Inspection ────────────────────────────────────────────────────────────────
-- An inspection row is identified by where it happened, so the flat is the title and the thing
-- checked and its verdict sit beside it.
with i as (
  select ins.id,
    nullif(trim(concat_ws(' · ',
      nullif(trim(ins.project), ''),
      nullif(trim(concat_ws('-', nullif(trim(ins.block), ''), nullif(trim(ins.floor), ''), nullif(trim(ins.flat), ''))), ''),
      nullif(trim(coalesce(ins.component, ins.work_category)), '')
    )), '') as label,
    nullif(trim(ins.inspection_check), '') as item, nullif(trim(ins.status), '') as st
  from acc.inspection ins
)
update public.erp_usage_events ev
set meta = ev.meta || jsonb_strip_nulls(jsonb_build_object(
      'title', coalesce(i.label, i.item),
      'checked', case when i.label is null then null else i.item end,
      'result', i.st))
from i
where ev.meta->>'ref' ~ '^(insp|inspitem):'
  and i.id::text = split_part(ev.meta->>'ref', ':', 2)
  and ev.meta->>'title' is null;

-- A submitted inspection is keyed by the flat, not by a row id: insp:<email>:<flat>:<epoch>.
-- The flat is already in the marker, so no lookup is needed.
update public.erp_usage_events ev
set meta = ev.meta || jsonb_build_object('title', split_part(ev.meta->>'ref', ':', 3))
where ev.meta->>'ref' like 'insp:%'
  and ev.meta->>'title' is null
  and nullif(trim(split_part(ev.meta->>'ref', ':', 3)), '') is not null;

-- ── Transcription and Meetings ────────────────────────────────────────────────
update public.erp_usage_events ev
set meta = ev.meta || jsonb_strip_nulls(jsonb_build_object(
      'title', coalesce(nullif(trim(t.customer_name), ''), nullif(trim(t.title), ''), nullif(trim(t.file_name), '')),
      'project', nullif(trim(t.project), '')))
from acc.transcriptions t
where ev.meta->>'ref' ~ '^tr\.(u|d):'
  and t.id::text = split_part(ev.meta->>'ref', ':', 2)
  and ev.meta->>'title' is null;

update public.erp_usage_events ev
set meta = ev.meta || jsonb_strip_nulls(jsonb_build_object(
      'title', coalesce(nullif(trim(t.customer_name), ''), nullif(trim(t.title), ''), nullif(trim(t.file_name), ''))))
from acc.transcription_comments c left join acc.transcriptions t on t.id = c.transcription_id
where ev.meta->>'ref' like 'trcm:%'
  and c.id::text = split_part(ev.meta->>'ref', ':', 2)
  and ev.meta->>'title' is null;

update public.erp_usage_events ev
set meta = ev.meta || jsonb_strip_nulls(jsonb_build_object(
      'title', coalesce(nullif(trim(ml.title), ''), nullif(trim(m.title), ''))))
from acc.meeting_logs ml left join acc.meetings m on m.id = ml.meeting_id
where ev.meta->>'ref' like 'mlog.%'
  and ml.id::text = split_part(ev.meta->>'ref', ':', 2)
  and ev.meta->>'title' is null;

-- ── Post-sales and Network ────────────────────────────────────────────────────
update public.erp_usage_events ev
set meta = ev.meta || jsonb_strip_nulls(jsonb_build_object('title', nullif(trim(a.file_name), '')))
from postsales.adhoc_docs a
where ev.meta->>'ref' like 'psa:%'
  and a.id::text = split_part(ev.meta->>'ref', ':', 2)
  and ev.meta->>'title' is null;

-- A speed test has no name. Its result is the only detail worth showing, so that is the detail.
update public.erp_usage_events ev
set meta = ev.meta || jsonb_strip_nulls(jsonb_build_object(
      'title', nullif(trim(coalesce(n.isp, n.server_name)), ''),
      'result', case when n.download_mbps is null and n.upload_mbps is null then null
                     else concat_ws(' · ',
                       case when n.download_mbps is null then null else round(n.download_mbps::numeric, 1) || ' Mbps down' end,
                       case when n.upload_mbps   is null then null else round(n.upload_mbps::numeric, 1) || ' up' end,
                       case when n.ping_ms       is null then null else round(n.ping_ms::numeric) || ' ms ping' end) end))
from public.net_speed_tests n
where ev.meta->>'ref' like 'netreq:%'
  and n.id::text = split_part(ev.meta->>'ref', ':', 2)
  and ev.meta->>'title' is null;

-- ── Last resort for tasks whose row is gone ───────────────────────────────────
-- A deleted task takes its title with it, but the notification it sent when it was delegated is
-- still there, carrying the name in its title and the person it went to in recipient.
with pm as (
  select lower(email) as e, nullif(trim(full_name), '') as fn
  from acc.user_profile where nullif(trim(full_name), '') is not null
),
miss as (
  select ev.id as ev_id, split_part(ev.meta->>'ref', ':', 2)::bigint as tid
  from public.erp_usage_events ev
  where ev.meta->>'ref' ~ '^(pa|ptask\.new):'
    and ev.meta->>'title' is null
),
cand as (
  select n.task_id as tid,
    nullif(trim(regexp_replace(n.title,
      '^(New workflow step|New task delegated|New task|New sub-task|Rejected back to you|Task approved|Task completed)\s*:\s*', '')), '') as nm,
    row_number() over (partition by n.task_id order by (n.kind = 'task_delegated') desc, n.id) as rn
  from acc.notifications n
  where n.task_id in (select tid from miss) and nullif(trim(n.title), '') is not null
),
who as (
  select n.task_id as tid,
         string_agg(distinct coalesce(pm.fn, split_part(lower(n.recipient), '@', 1)), ', ') as names
  from acc.notifications n left join pm on pm.e = lower(n.recipient)
  where n.task_id in (select tid from miss)
    and n.kind = 'task_delegated'
    and nullif(trim(n.recipient), '') is not null
  group by n.task_id
)
update public.erp_usage_events ev
set meta = ev.meta || jsonb_strip_nulls(jsonb_build_object('title', c.nm, 'assignee', w.names))
from miss m
join cand c on c.tid = m.tid and c.rn = 1
left join who w on w.tid = m.tid
where ev.id = m.ev_id and c.nm is not null;
