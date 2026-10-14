-- Fortnightly recurring tasks were refused by the shape check, which only listed
-- daily/weekly/monthly/quarterly/yearly. A fortnightly rule may also carry "start", the first
-- date the user chose; recur_anchor (the first due date) is what the database counts from.
alter table acc.ptasks drop constraint ptasks_recur_shape_chk;
alter table acc.ptasks add constraint ptasks_recur_shape_chk check (
  (recur is null) or ((jsonb_typeof(recur) = 'object')
    and ((recur->>'freq') = any (array['daily','weekly','fortnightly','monthly','quarterly','yearly'])))) not valid;
alter table acc.ptasks validate constraint ptasks_recur_shape_chk;
