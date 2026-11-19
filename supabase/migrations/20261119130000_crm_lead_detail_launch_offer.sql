-- The lead page's call rows now carry the Ananta launch-offer verdict (acc.followup_qa
-- launch_offer_status / launch_offer_check) and the lead's CRM source (crm_leads.raw source_id /
-- source_name). Merged in here rather than added to followup_timeline_v,
-- so the list's speed-tuned view is untouched. Every other key of each row is exactly as before.
CREATE OR REPLACE FUNCTION acc.crm_lead_detail(p_lead_ids bigint[])
 RETURNS TABLE(lead_id bigint, lead jsonb, followups jsonb)
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'acc', 'public'
AS $function$
DECLARE
  v_id bigint;
BEGIN
  IF p_lead_ids IS NULL THEN
    RETURN;
  END IF;

  -- DISTINCT and NOT NULL up front: the caller's list is whatever was on screen, which can repeat an
  -- id, and asking twice would return the same lead twice.
  FOR v_id IN
    SELECT DISTINCT u FROM unnest(p_lead_ids) AS u WHERE u IS NOT NULL ORDER BY 1
  LOOP
    lead_id := v_id;

    SELECT to_jsonb(l) INTO lead
      FROM acc.crm_leads l
     WHERE l.lead_id = v_id;

    SELECT COALESCE(
             jsonb_agg(to_jsonb(t)
                       || jsonb_build_object('launch_offer_status', q.launch_offer_status,
                                             'launch_offer_check',  q.launch_offer_check,
                                             'lead_source_id',      l.raw->>'source_id',
                                             'lead_source_name',    l.raw->>'source_name')
                       ORDER BY t.communication_time NULLS FIRST, t.follow_up_id),
             '[]'::jsonb)
      INTO followups
      FROM acc.followup_timeline_v t
      LEFT JOIN acc.followup_qa q ON q.follow_up_id = t.follow_up_id
      LEFT JOIN acc.crm_leads   l ON l.lead_id = t.lead_id
     WHERE t.lead_id = v_id;

    RETURN NEXT;
  END LOOP;
END;
$function$;
