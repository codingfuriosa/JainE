-- Photo approval emails never went out: workflow-mailer reads the notification it is handed
-- (acc.notifications, by id) with the service role, and service_role had no SELECT on that table,
-- so every lookup came back empty and the mailer answered 'not found'. The bell kept working,
-- since it reads as the signed-in user. Read access is all the mailer needs here.
grant select on acc.notifications to service_role;
