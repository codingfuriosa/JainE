-- REIMBURSEMENT: A WOW MOMENT IS A REIMBURSEMENT - ONE OPEN CLAIM AT A TIME, WHATEVER THE KIND.
--
-- (24 Oct 2026) 20261017120000 counted "one open claim at a time" per kind, so a Sales Manager
-- with a Wow Moment in process could still raise a travel claim, and the other way round. A Wow
-- Moment is a Reimbursement too: while either kind is in process, neither can be raised. The
-- refusal names the kind of the claim that is holding things up ("Your wow moment #12 ...").

create or replace function acc.wf_new_instance_block_reason(p_flow_id bigint, p_email text, p_variant text)
returns text
language plpgsql stable security definer
set search_path to 'acc','public'
as $function$
declare
  v_flow  acc.flows;
  v_case  acc.flow_cases;
  v_step  acc.flow_case_steps;
  v_noun  text;
  v_title text;
  v_mine  boolean;
  v_who   text;
begin
  if p_email is null or btrim(p_email) = '' then return null; end if;
  select * into v_flow from acc.flows where id = p_flow_id;
  if not found then return null; end if;
  if not coalesce(v_flow.one_open_instance_per_person, false) then return null; end if;

  -- any kind: an ordinary claim and a Wow Moment hold each other up
  select fc.* into v_case
    from acc.flow_cases fc
   where fc.flow_id = p_flow_id
     and lower(coalesce(fc.created_by,'')) = lower(p_email)
     and fc.current_step > 1
     and coalesce(fc.status,'') not in ('Done','Cancelled')
     and fc.returned_at is null
   order by fc.case_no
   limit 1;
  if not found then return null; end if;

  -- named after the claim that is open, not the one being raised
  v_noun := lower(coalesce(v_flow.variants -> v_case.variant ->> 'label', v_flow.instance_noun, 'instance'));

  select fcs.* into v_step
    from acc.flow_case_steps fcs
   where fcs.case_id = v_case.id
     and fcs.appeared_at  is not null
     and fcs.forwarded_at is null
   order by fcs.seq
   limit 1;

  v_title := coalesce(btrim(v_step.title), '');
  v_mine  := v_step.id is not null
             and (lower(coalesce(v_step.person,'')) = lower(p_email)
                  or lower(p_email) = any(select lower(x) from unnest(coalesce(v_step.candidates,'{}')) x));

  if v_mine then
    return (case
              when v_title = '' or v_title ilike '%payment%'
                then format('Waiting for you to confirm payment on #%s — open it and mark it Done.', v_case.case_no)
                else format('Waiting for you on #%s at "%s" — open it and mark it Done.', v_case.case_no, v_title)
            end)
           || ' You can save this one as a draft in the meantime.';
  end if;

  select string_agg(nm, ', ' order by nm) into v_who
    from (select distinct nullif(btrim(u.full_name),'') as nm
            from unnest(case when coalesce(v_step.person,'') <> '' then array[v_step.person]
                             else coalesce(v_step.candidates, '{}'::text[]) end) as e(email)
            join adm.users u on lower(u.email) = lower(e.email)
           where nullif(btrim(u.full_name),'') is not null) s;

  return format('Your %s #%s has not finished yet%s%s. You can save this one as a draft and send it once #%s is closed.',
                v_noun, v_case.case_no,
                case when v_title <> '' then format(' — it is at "%s"', v_title) else '' end,
                case when coalesce(v_who,'') <> '' then format(', with %s', v_who) else '' end,
                v_case.case_no);
end;
$function$;
