-- WHATSAPP TEMPLATES - REPLIED (25 Nov 2026, Ayush: "In Whatsapp Templates whatever or how many Replies were given can be
-- extracted?? Try again"). Meta's template_analytics gives 'replied' per template per day (metric REPLIED): customers who
-- answered the template with a message of their own. Meta gives the count only, not the text.
-- Applied by the one-time cron wa_replied_ddl_once (20:05 IST 25 Nov); wa-deliveries-sync stores it from then on.
alter table camp.wa_template_daily add column if not exists replied integer not null default 0;
notify pgrst, 'reload schema';
