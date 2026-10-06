-- MARKET VALUATION AUTOMATION, REMOVED BY REQUEST (06-10-2026).
--
-- Three separate automations had grown up on acc.booking_audits, all firing on the same condition
-- - a booking read, project Dream Gurukul or Dream World City, no valuation recorded yet - and all
-- asking for the same thing:
--
--   trg_booking_audits_market_valuation -> notify_market_valuation
--        queued acc.automation_jobs. 14 jobs, the last on 06-10-2026. The live one.
--
--   trg_agent_market_valuation -> agent_enqueue_market_valuation
--        queued acc.agent_tasks. 1 task, 28-09-2026.
--
--   trg_market_valuation_webhook -> market_valuation_webhook_notify
--        POSTed to an Anthropic Claude Code routine with an API key written into the function
--        body in plain text, fire-and-forget, swallowing its own exceptions - so there is no
--        record of whether it ever worked.
--
-- All three are dropped, and the functions with them. Dropping the function is what takes the
-- exposed key out of the database; THE KEY ITSELF STILL HAS TO BE ROTATED, because anyone who
-- could read the function definition before today has already been able to copy it.
--
-- NOTHING THAT HOLDS INFORMATION IS TOUCHED. The 18 valuations already recorded in
-- acc.booking_audits.market_valuation stay, acc.automation_jobs and acc.agent_tasks keep their
-- history, and the Check List still prints its "Market valuation Sheet" line against whatever is
-- stored. What stops is the asking: from now on a valuation is entered by hand, and until one is
-- entered that line reads NOT OK, which is how it already behaved for the 8 bookings without one.
--
-- To bring it back, recreate the first of the three - it was the only one in use, and it stayed
-- inside this database.

drop trigger if exists trg_market_valuation_webhook on acc.booking_audits;
drop function if exists acc.market_valuation_webhook_notify();

drop trigger if exists trg_agent_market_valuation on acc.booking_audits;
drop function if exists acc.agent_enqueue_market_valuation();

drop trigger if exists trg_booking_audits_market_valuation on acc.booking_audits;
drop function if exists acc.notify_market_valuation();
