-- THE SAME BILL, ENTERED TWICE, AND NOTHING TO STOP IT.
--
-- Invoice Processing had no check of any kind on the bill number. On 5 Nov 2026 S S Security's
-- bill 164 went in twice, seven hours apart:
--
--   JainE id 650  "S.S.F.M.S/26-27/164"  DREAM GURUKUL  Rs 143177  by Dream Gurukul Store
--   JainE id 654  "164"                  D.G.H.L.       Rs 143117  by Front Office
--
-- Same vendor, same date, same piece of paper - and not one field written the same way. The bill
-- number carries the vendor's series on one and not the other, the vendor's name differs by its
-- full stops, the company is spelt out on one and initialled on the other, and the amounts are
-- sixty rupees apart because one of them has 17 and 11 transposed. An exact-match rule would have
-- caught none of it. It had happened before, too: ids 183 and 300, the same vendor's bill 118,
-- same date, Rs 121065 on both.
--
-- So the comparison takes the punctuation out of the vendor and the bill number, and also counts a
-- bill number that ENDS in the same run of three or more digits. Three and not two is deliberate:
-- several vendors here number their bills 05/26, 06/26 by financial year, and those are different
-- bills - a two-digit rule would flag every one of them.
--
-- Run over all 528 bills on file this returns six pairs, each worth a human glance:
--   650/654 and 183/300 (S S Security, as above), 160/199 (Lokenath Arts, 0144, same amount and
--   date), 151/152 (Netlify, same number and amount), 148/525 (K.R. Garden, bill 09 twice at
--   Rs 3500) and 220/221 (Dhrubajit Chakraborty, two bills both numbered 02 for different amounts
--   - the one case here that is probably not a duplicate, which is exactly why the form warns
--   rather than refuses).
--
-- The caller passes the bill it is about to save; an edit passes its own case id so an instance
-- does not report itself. Five matches is plenty for a warning.

create or replace function acc.wf_duplicate_bills(
  p_flow_id bigint,
  p_vendor text,
  p_bill_no text,
  p_except_case_id bigint default null)
returns table(jaine_id integer, bill_no text, bill_date text, amount text, raised_by text, why text)
language sql
stable security definer
set search_path to 'acc', 'public'
as $function$
  with asked as (
    select lower(regexp_replace(coalesce(p_vendor ,''),'[^a-zA-Z0-9]','','g')) as vnorm,
           lower(regexp_replace(coalesce(p_bill_no,''),'[^a-zA-Z0-9]','','g')) as bnorm,
           -- the run of digits the bill number ends in, if it ends in one at all
           nullif(regexp_replace(coalesce(p_bill_no,''),'^.*[^0-9]','','g'),'')  as tail
  ),
  onfile as (
    select c.jaine_id, c.created_by,
           max(case when d->>'label'='Bill No.'  then d->>'value' end) as bill_no,
           max(case when d->>'label'='Bill Date' then d->>'value' end) as bill_date,
           max(case when d->>'label'='Amount'    then d->>'value' end) as amount,
           max(case when d->>'label'='Vendor'    then d->>'value' end) as vendor
      from acc.flow_cases c
      cross join lateral jsonb_array_elements(c.trigger_details) d
     where c.flow_id = p_flow_id
       and jsonb_typeof(c.trigger_details) = 'array'
       and (p_except_case_id is null or c.id <> p_except_case_id)
     group by c.jaine_id, c.created_by
  )
  select o.jaine_id, o.bill_no, o.bill_date, o.amount, o.created_by,
         case when lower(regexp_replace(coalesce(o.bill_no,''),'[^a-zA-Z0-9]','','g')) = a.bnorm
              then 'the same bill number'
              else 'the same number at the end' end
    from onfile o, asked a
   where a.vnorm <> ''
     and o.jaine_id is not null
     and lower(regexp_replace(coalesce(o.vendor,''),'[^a-zA-Z0-9]','','g')) = a.vnorm
     and (
          (a.bnorm <> ''
           and lower(regexp_replace(coalesce(o.bill_no,''),'[^a-zA-Z0-9]','','g')) = a.bnorm)
       or (a.tail is not null and length(a.tail) >= 3
           and nullif(regexp_replace(coalesce(o.bill_no,''),'^.*[^0-9]','','g'),'') = a.tail)
     )
   order by o.jaine_id desc
   limit 5;
$function$;

revoke all on function acc.wf_duplicate_bills(bigint, text, text, bigint) from public, anon;
grant execute on function acc.wf_duplicate_bills(bigint, text, text, bigint) to authenticated;
