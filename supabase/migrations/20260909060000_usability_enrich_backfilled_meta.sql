-- Usability: give the backfilled events a Details column worth reading.
--
-- The one-time historical backfill stamped {ref:'<table>.<action>:<id>', backfill:true} onto 5,531
-- old events - an internal pointer back to the row each was reconstructed from, and nothing a
-- person would recognise. With those two internal keys correctly hidden from the UI, every one of
-- those events showed an empty Details column, and the report's own project column had never been
-- written at all (0 of 7,500+ rows), because nothing ever passed one.
--
-- This resolves each ref against the row it points to and ADDS the readable fields to meta. It is
-- purely additive: 'ref' and 'backfill' are left in place, so the events stay marked as
-- reconstructed and stripping the added keys undoes this completely. Rows whose source record has
-- since been deleted stay empty - correctly, since there is nothing left to recover.
--
-- Two ref kinds resolve against backup tables (hr.interview_tracker_backup_20260906,
-- hr.hs_candidates_backup_20260907) because the live tables were rebuilt after the backfill ran.
-- 'jd:<n>' is skipped: recruit.job_descriptions.id is a uuid, so those refs cannot be ids.

-- Tasks
update public.erp_usage_events ev
set meta = ev.meta || jsonb_strip_nulls(jsonb_build_object('title', nullif(t.title,''), 'project', nullif(p.name,''))),
    project = coalesce(ev.project, left(nullif(p.name,''),64))
from acc.ptasks t left join acc.projects p on p.id = t.project_id
where ev.meta->>'ref' ~ '^ptask\.new:[0-9]+$' and t.id = split_part(ev.meta->>'ref',':',2)::bigint;

update public.erp_usage_events ev
set meta = ev.meta || jsonb_strip_nulls(jsonb_build_object('task', nullif(t.title,''), 'change', nullif(a.detail,'')))
from acc.ptask_activity a left join acc.ptasks t on t.id = a.task_id
where ev.meta->>'ref' ~ '^pa:[0-9]+$' and a.id = split_part(ev.meta->>'ref',':',2)::bigint;

update public.erp_usage_events ev
set meta = ev.meta || jsonb_strip_nulls(jsonb_build_object('task', nullif(t.title,''),
      'comment', nullif(left(regexp_replace(cm.body,'\s+',' ','g'),140),'')))
from acc.ptask_comments cm left join acc.ptasks t on t.id = cm.task_id
where ev.meta->>'ref' ~ '^pcm:[0-9]+$' and cm.id = split_part(ev.meta->>'ref',':',2)::bigint;

update public.erp_usage_events ev
set meta = ev.meta || jsonb_strip_nulls(jsonb_build_object('task', nullif(t.title,''), 'file', nullif(f.file_name,'')))
from acc.ptask_files f left join acc.ptasks t on t.id = f.task_id
where ev.meta->>'ref' ~ '^pfile:[0-9]+$' and f.id = split_part(ev.meta->>'ref',':',2)::bigint;

update public.erp_usage_events ev
set meta = ev.meta || jsonb_strip_nulls(jsonb_build_object('task', nullif(t.title,''), 'item', nullif(s.title,'')))
from acc.ptask_subtasks s left join acc.ptasks t on t.id = s.task_id
where ev.meta->>'ref' ~ '^psub:[0-9]+$' and s.id = split_part(ev.meta->>'ref',':',2)::bigint;

-- Workflows
update public.erp_usage_events ev
set meta = ev.meta || jsonb_strip_nulls(jsonb_build_object('step', nullif(s.title,''), 'instance', nullif(c.title,''), 'workflow', nullif(fl.name,'')))
from acc.flow_case_steps s left join acc.flow_cases c on c.id = s.case_id
     left join acc.flows fl on fl.id = c.flow_id
where ev.meta->>'ref' ~ '^fcs\.[rf]:[0-9]+$' and s.id = split_part(ev.meta->>'ref',':',2)::bigint;

update public.erp_usage_events ev
set meta = ev.meta || jsonb_strip_nulls(jsonb_build_object('instance', nullif(c.title,''), 'workflow', nullif(fl.name,''), 'ref_no', c.case_no))
from acc.flow_cases c left join acc.flows fl on fl.id = c.flow_id
where ev.meta->>'ref' ~ '^(fcase|fcase\.rj):[0-9]+$' and c.id = split_part(ev.meta->>'ref',':',2)::bigint;

-- Documents
update public.erp_usage_events ev
set meta = ev.meta || jsonb_strip_nulls(jsonb_build_object('document', nullif(coalesce(d.title, d.file_name),''),
      'department', nullif(d.department,''), 'category', nullif(d.category,'')))
from doc.documents d
where ev.meta->>'ref' ~ '^doc:[0-9]+$' and d.id = split_part(ev.meta->>'ref',':',2)::bigint;

update public.erp_usage_events ev
set meta = ev.meta || jsonb_strip_nulls(jsonb_build_object('folder', nullif(fo.name,''), 'department', nullif(fo.department,'')))
from doc.folders fo
where ev.meta->>'ref' ~ '^dfold:[0-9]+$' and fo.id = split_part(ev.meta->>'ref',':',2)::bigint;

-- Legal
update public.erp_usage_events ev
set meta = ev.meta || jsonb_strip_nulls(jsonb_build_object('file', nullif(f.file_name,'')))
from public.mis_case_files f
where ev.meta->>'ref' ~ '^misf:[0-9]+$' and f.id = split_part(ev.meta->>'ref',':',2)::bigint;

update public.erp_usage_events ev
set meta = ev.meta || jsonb_strip_nulls(jsonb_build_object('advocate', nullif(a.advocate_name,''), 'court', nullif(a.court,''), 'case_type', nullif(a.case_type,'')))
from public.legal_advocates a
where ev.meta->>'ref' ~ '^adv:[0-9]+$' and a.id = split_part(ev.meta->>'ref',':',2)::bigint;

-- Transcription
update public.erp_usage_events ev
set meta = ev.meta || jsonb_strip_nulls(jsonb_build_object('call', nullif(coalesce(x.customer_name, x.title, x.file_name),''),
      'project', nullif(x.project,''), 'outcome', nullif(x.qualification,''))),
    project = coalesce(ev.project, left(nullif(x.project,''),64))
from acc.transcriptions x
where ev.meta->>'ref' ~ '^tr\.u:[0-9]+$' and x.id = split_part(ev.meta->>'ref',':',2)::bigint;

-- Inspection
update public.erp_usage_events ev
set meta = ev.meta || jsonb_strip_nulls(jsonb_build_object(
      'location', nullif(concat_ws('/', nullif(ins.block,''), nullif(ins.floor,''), nullif(ins.flat,'')),''),
      'check', nullif(ins.work_category,''), 'result', nullif(ins.status,''), 'project', nullif(ins.project,''))),
    project = coalesce(ev.project, left(nullif(ins.project,''),64))
from acc.inspection ins
where ev.meta->>'ref' ~ '^(inspitem|insp):[0-9]+$' and ins.id = split_part(ev.meta->>'ref',':',2)::bigint;

-- HR / Recruitment. The two _backup_ tables are the ones the refs point at: the live
-- interview_tracker and hs_candidates were rebuilt/dropped after the backfill ran.
update public.erp_usage_events ev
set meta = ev.meta || jsonb_strip_nulls(jsonb_build_object('candidate', nullif(i.candidate_name,''), 'position', nullif(i.position,''), 'stage', nullif(i.status,'')))
from hr.interview_tracker i
where ev.meta->>'ref' ~ '^itr:[0-9]+$' and i.id = split_part(ev.meta->>'ref',':',2)::bigint;

update public.erp_usage_events ev
set meta = ev.meta || jsonb_strip_nulls(jsonb_build_object('candidate', nullif(i.candidate_name,''), 'position', nullif(i.position,''), 'stage', nullif(i.status,'')))
from hr.interview_tracker_backup_20260906 i
where ev.meta->>'ref' ~ '^itr:[0-9]+$' and i.id = split_part(ev.meta->>'ref',':',2)::bigint
  and (select count(*) from jsonb_object_keys(ev.meta) k where k not in ('ref','backfill')) = 0;

update public.erp_usage_events ev
set meta = ev.meta || jsonb_strip_nulls(jsonb_build_object('candidate', nullif(h.name,''), 'position', nullif(h.position,''), 'stage', nullif(h.status,'')))
from hr.hs_candidates_backup_20260907 h
where ev.meta->>'ref' ~ '^hsc:[0-9]+$' and h.id = split_part(ev.meta->>'ref',':',2)::bigint;

update public.erp_usage_events ev
set meta = ev.meta || jsonb_strip_nulls(jsonb_build_object('position', nullif(m.job_title,''), 'department', nullif(m.department,''), 'vacancies', m.no_of_vacancy::text))
from hr.manpower_requests_backup_20260907 m
where ev.meta->>'ref' ~ '^mpr:[0-9]+$' and m.id = split_part(ev.meta->>'ref',':',2)::bigint;

update public.erp_usage_events ev
set meta = ev.meta || jsonb_strip_nulls(jsonb_build_object('test', nullif(te.name,'')))
from recruit.tests te
where ev.meta->>'ref' ~ '^test:[0-9]+$' and te.id = split_part(ev.meta->>'ref',':',2)::bigint;

-- Meetings, Internet Speed
update public.erp_usage_events ev
set meta = ev.meta || jsonb_strip_nulls(jsonb_build_object('meeting', nullif(ml.title,''), 'mode', nullif(ml.mode,'')))
from acc.meeting_logs ml
where ev.meta->>'ref' ~ '^mlog\.[a-z]+:[0-9]+$' and ml.id = split_part(ev.meta->>'ref',':',2)::bigint;

update public.erp_usage_events ev
set meta = ev.meta || jsonb_strip_nulls(jsonb_build_object('trigger', nullif(r.source,''), 'result', nullif(r.status,'')))
from public.net_test_requests r
where ev.meta->>'ref' ~ '^netreq:[0-9]+$' and r.id = split_part(ev.meta->>'ref',':',2)::bigint;

-- Legal, reached through the folder: mis_case_files -> mis_case_folders -> mis_cases. The case
-- carries project_land_name, which is the project a case belongs to - so these events can have a
-- project even though the file row itself has no such column. 133 of 179 cases have one.
update public.erp_usage_events ev
set meta = ev.meta || jsonb_strip_nulls(jsonb_build_object('case', nullif(c.cause_title,''), 'project', nullif(c.project_land_name,''))),
    project = coalesce(ev.project, left(nullif(c.project_land_name,''),64))
from public.mis_case_files f
     join public.mis_case_folders fo on fo.id = f.folder_id
     join public.mis_cases c on c.id = fo.case_id
where ev.meta->>'ref' ~ '^misf:[0-9]+$' and f.id = split_part(ev.meta->>'ref',':',2)::bigint;

update public.erp_usage_events ev
set meta = ev.meta || jsonb_strip_nulls(jsonb_build_object('case', nullif(c.cause_title,''), 'action', nullif(a.action_needed,''), 'project', nullif(c.project_land_name,''))),
    project = coalesce(ev.project, left(nullif(c.project_land_name,''),64))
from public.mis_actions a join public.mis_cases c on c.id = a.case_id
where ev.meta->>'ref' ~ '^misact:[0-9]+$' and a.id = split_part(ev.meta->>'ref',':',2)::bigint;
