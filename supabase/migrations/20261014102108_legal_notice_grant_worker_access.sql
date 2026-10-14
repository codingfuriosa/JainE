-- THE WORKER COULD NOT READ ITS OWN QUEUE.
--
--   "notices pass: queue: permission denied for function legal_notice_pending"
--
-- The three pipeline functions were locked down with `revoke all ... from public, anon`, which was
-- right in intent and wrong in effect: service_role holds no grant of its own on them, it was
-- relying on PUBLIC's, so revoking PUBLIC locked out the very worker the functions exist for. The
-- edge function connects with the service-role key, so every notice sat pending at zero attempts
-- and the feature looked broken while the trigger, the queue and the reader all worked perfectly.
--
-- It cost the first real upload: the file went up, the row was queued, and nothing happened. The
-- failure was also invisible from the database - the error is returned in the worker's JSON reply,
-- which nothing was reading, and the row was never claimed so extract_error stayed null. Found by
-- calling the function by hand and reading net._http_response.
--
-- Nothing is widened here. anon and PUBLIC stay revoked; service_role is named explicitly, which
-- is what should have been done in the first place rather than leaning on an inherited grant.
grant execute on function acc.legal_notice_pending(int)                             to service_role;
grant execute on function acc.legal_notice_note_failure(bigint, text)               to service_role;
grant execute on function acc.legal_notice_save(bigint,text,text,text[],text,jsonb) to service_role;

-- The reading functions are called by signed-in people, not by the worker, but the same
-- belt-and-braces applies if anything server-side ever needs them.
grant execute on function acc.legal_notice_folder_ids() to service_role;
grant execute on function acc.legal_notice_tracker()    to service_role;
grant execute on function acc.legal_notice_scoreboard() to service_role;
