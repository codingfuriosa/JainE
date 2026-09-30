/* Usability catalog entry for "Add a recording to transcribe".

   A meeting occurrence can now be transcribed after the fact: upload the audio (a phone recording,
   a dictaphone, Meet's own recording) on the meeting's line item or its log page, and it joins the
   very same queue a live in-app recording does, so the Gemini transcriber picks it up. That is the
   feature being registered here.

   WHY SEED IT RATHER THAN LET IT AUTO-REGISTER.
   erp_log_usage registers a feature the first time it fires, but it derives the name from the key
   with initcap() - this one would read "Add A Recording For Transcription" - and it appends it to
   the very end of the catalog, far from the Meetings features it belongs with. Seeding gives it a
   readable name and a place: sort 35, immediately after Start/stop recording (34), which is the
   live counterpart to this one.

   THE SHIFT.
   sort is a plain integer and is NOT unique (274 rows currently share 270 values), so nothing here
   is required for correctness - but opening a gap is what "insert into an ordered list" means, and
   it keeps every other feature's relative order exactly as it was. One statement, no reordering
   anywhere else.

   Idempotent in the sense that matters: re-running it is harmless if the feature is already in the
   catalog (the update branch just corrects the derived name), and the shift is guarded so it can
   only open the gap once. */
do $$
begin
  if not exists (select 1 from public.erp_feature_catalog
                  where feature_key = 'tasks.meetings.add_a_recording_for_transcription') then
    update public.erp_feature_catalog set sort = sort + 1 where sort >= 35;
  end if;
end $$;

insert into public.erp_feature_catalog
  (feature_key, module_id, module_label, tab, feature, sort, active, auto_added)
values
  ('tasks.meetings.add_a_recording_for_transcription', 'tasks', 'Accountability', 'Meetings',
   'Add a recording to transcribe', 35, true, false)
on conflict (feature_key) do update
  set feature    = excluded.feature,
      tab        = excluded.tab,
      active     = true,
      auto_added = false;
