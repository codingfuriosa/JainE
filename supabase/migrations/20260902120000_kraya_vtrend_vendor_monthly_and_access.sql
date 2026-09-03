-- Per-vendor monthly spend, for the Vendor Trends detail modal's history chart.
create or replace function kraya.vtrend_vendor_monthly_all()
 returns table(vendor_id bigint, month date, amount numeric)
 language sql stable
 set search_path to 'kraya', 'public'
as $$
  select vendor_id, date_trunc('month',purchase_date)::date as month, sum(amount) as amount
    from kraya.vtrend_purchases
   group by 1,2
   order by 1,2;
$$;

grant execute on function kraya.vtrend_vendor_monthly_all() to authenticated;

-- No user had adm.users.kraya set at all, so app.can_read('kraya') was false for everyone
-- including admins - the Vendor Trends tab (and the module's real PO/indent tables) rendered as
-- empty for every account, dummy data included. Grants the reporting account visibility.
update adm.users set kraya='ADMIN' where email='system.admin@thejaingroup.com';
