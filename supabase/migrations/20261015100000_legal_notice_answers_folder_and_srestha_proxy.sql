-- LEGAL > LEGAL NOTICE ANSWERS - an ordinary category, like Litigation and Projects.
-- Replies to notices are kept here. It is deliberately NOT a notice folder: the notice pipeline
-- (acc.legal_notice_folder_ids) matches the exact name 'Legal Notice' and its sub-folders, so an
-- upload here is filed and nothing more - no reading, no task.
insert into doc.folders (name, parent_id, department, created_by)
select 'Legal Notice Answers', null, 'Legal', 'system'
where not exists (
  select 1 from doc.folders
  where department = 'Legal' and name = 'Legal Notice Answers' and parent_id is null
);

-- INVOICE PROCESSING: Srestha Sarkar acts for Sanchari Mitra, the same way Manash Choudhury acts
-- for Ayush Ruia and Sanhita Mukherjee for Sandip Das.
insert into acc.wf_proxy (principal_email, proxy_email, flow_id, active, note, created_by)
select 'legal3@thejaingroup.com', 'legal2@thejaingroup.com', f.id, true,
       'Srestha Sarkar receives and forwards Sanchari Mitra''s bills on her behalf', 'system'
from acc.flows f
where f.name = 'Invoice Processing'
  and not exists (
    select 1 from acc.wf_proxy p
    where p.principal_email = 'legal3@thejaingroup.com'
      and p.proxy_email = 'legal2@thejaingroup.com'
      and p.flow_id = f.id
  );
