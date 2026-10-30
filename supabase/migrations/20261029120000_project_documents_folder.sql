-- PROJECT DOCUMENTS KEEP THEIR FOLDERS (29 Oct 2026)
-- A project's legal set is kept in Drive as folders inside folders, and every project's tree is
-- different. Customer Portal Admin -> Documents now takes a whole folder and stores each file's
-- folder path here ('Land papers/Mutation'; null = not in a folder). The customer Documents tab
-- shows one section per folder. No list of allowed folder names: the tree is whatever was uploaded.
alter table cust.project_documents add column if not exists folder text;
comment on column cust.project_documents.folder is
  'Folder path the document sits in, segments joined by "/" (e.g. "Land papers/Mutation"); null = not in a folder. Taken from the uploaded folder tree; renamed/moved in Customer Portal Admin -> Documents.';
