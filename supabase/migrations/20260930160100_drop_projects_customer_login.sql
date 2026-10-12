-- Sign-in moved into Customer Features (20260930160000), so the per-project switch column on
-- cust.projects is no longer read by anything. Applied once the admin screen that showed it was live
-- without it.
alter table cust.projects drop column if exists customer_login;
