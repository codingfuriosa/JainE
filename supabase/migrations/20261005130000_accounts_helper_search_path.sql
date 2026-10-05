-- Accounts: pin the search_path of the two pure helper functions (security advisor) and stop exposing the one
-- nothing outside the database calls. Already applied to the live database.
alter function accounts._doc_prefix(text) set search_path = '';
alter function accounts._key_label(text) set search_path = '';
revoke all on function accounts._doc_prefix(text) from public, anon, authenticated;
revoke all on function accounts._key_label(text) from public, anon;
grant execute on function accounts._key_label(text) to authenticated;
