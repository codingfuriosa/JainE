/* Usability: put the right verb in the Action column, on 219 events that carry the wrong one.

   The verb was never read from the feature - it was guessed from the name of the JavaScript
   function behind the button, which describes how the code was written, not what the person did.
   The two drift apart immediately:

     cmpSetPeriod   contains "set"  -> changing the date filter on a read-only spend chart was
                                       filed as "update". Somebody who only looked at last month's
                                       numbers appears in the report to have edited something.
     accSubDel      contains no word the list knew -> deleting a sub-task fell through to "view",
                                       the same mistake pointing the other way and the worse of the
                                       two: the report then says nobody deleted anything.

   "Delete an instance" ended up split 17 "delete" / 7 "view" on nothing but which code path
   happened to log it - the clearest proof the verb was never a property of the feature at all.

   The feature key already states the act in words written for a human: filter_cases_by_hearing_
   date_range, delete_an_instance, switch_data_source. This reads the verb from there. The same
   rule now runs client-side (usageActionFromKey), so the two agree and every feature added from
   here on is labelled correctly the first time it is clicked, with nobody having to remember to
   add it to a list.

   Deliberately NOT touched: the "preview / download" rows (legal documents, job descriptions,
   resumes, call recordings). One catalogue row there covers two different buttons, so no verb read
   from the key can be right for every event under it - a preview is not an export, and relabelling
   28 genuine previews as downloads, or 28 genuine downloads as looks, would be the same kind of
   wrong answer this migration exists to remove. Those are settled in the client instead, where the
   function that ran is known: rsDownload, recJdDownload and trDownload now declare act:'export',
   and their preview counterparts keep "view". */

update public.erp_usage_events e
   set action = v.want
  from (
    select id,
           case
             when leaf ~ '^(delete|remove|cancel)_'                           then 'delete'
             when leaf ~ '^(download|export|print|copy)_'                     then 'export'
             when leaf ~ '(^(filter|search|sort|ask)_|_search$|_search_)'     then 'search'
             when leaf ~ '(^upload_|_upload$)'                                then 'create'
             when leaf ~ '^(view|open|browse|select|switch|drill|preview|see|play|read|expand|show|join|click|refresh|disabled)_' then 'view'
             when leaf ~ '^(add|create|new|submit|save|raise|start|log|record|attach|post|insert|comment|schedule|refer|generate|email|share|fetch)_' then 'create'
             when leaf ~ '^(update|edit|rename|move|mark|approve|decline|reject|forward|revert|reopen|toggle|set|assign|delegate|change|complete|replace|pin|restore|retry|receive|reschedule|drag|close|rebuild|ai)_' then 'update'
             else 'view'
           end as want
      from (
        select id,
               regexp_replace(lower(split_part(feature_key,'.',3)),'^bulk_','') as leaf
          from public.erp_usage_events
         where feature_key like '%.%.%'
           -- the two-buttons-one-row features, settled in the client instead
           and split_part(feature_key,'.',3) !~ '(preview|play)_download'
      ) s
  ) v
 where e.id = v.id
   and e.action <> v.want;
