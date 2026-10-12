# career-apply

The public end of the careers pages. `thejaingroup.com/career/<slug>` is one static file holding
no jobs; it asks this function for the position the URL names, posts the CV here, and posts the
application back here.

**This function is deliberately public — `verify_jwt` is OFF.** The careers site carries no
Supabase key of any kind, so there is no token for it to send; every request is validated inside
the function instead. Supabase's deploy tooling defaults `verify_jwt` to **true**, so a deploy
that forgets to pass `false` takes the whole careers page offline for everyone. That has already
happened once, on 5 Oct 2026, for about seventy seconds.

```
verify_jwt: false        <-- pass this on EVERY deploy
```

## Live source

The deployed source is the authority and is not mirrored here as a file — it is large, and a
stale copy in the repo would be worse than none. Read the current version with the Supabase MCP
`get_edge_function`, or from the dashboard, before changing it.

## Things that have bitten

- **An unrecognised source used to be rewritten to the word "Other"** (fixed v21, 5 Oct 2026).
  Someone who found the job through Google was filed under the same label as everybody else who
  found it anywhere unlisted, so a working channel reported zero applicants. The typed value is
  now stored as given, and `hr.source_remember()` adds it to `hr.sources` on the way through.
- **The duplicate check outlived the candidate it created** (fixed v22, 5 Oct 2026).
  `hr.applications.candidate_id` is `ON DELETE SET NULL`, so deleting a candidate in Interviews
  leaves the application row behind. The guard only looked for a previous application row, so the
  applicant was told "we have your application" while Interviews had nothing — a dead end
  invisible from both sides. A previous application now only blocks while its candidate still
  exists.
- **The careers page ignored the source list** this function has been returning alongside each
  position. `career-position.html` had four names hard-coded while HR had seven. Fixed in the
  JainGroup website repo, 5 Oct 2026.

## What creates the candidate

Nothing here. `hr.application_landed`, a `BEFORE INSERT` trigger on `hr.applications`, creates the
resume row, the candidate and the interview_tracker row. If an application exists but has no
candidate, the trigger is not the suspect — check whether the candidate was deleted afterwards.
