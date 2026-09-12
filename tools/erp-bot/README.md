# ERP entry — the office PC does it by itself

When a Booking Form is filed in JAIN-E, a note goes into a queue saying an ERP entry is wanted.
A watcher on the always-awake office PC asks every 30 seconds whether there is anything for it,
and when there is, it starts Claude. Claude opens Farvision in Chrome and makes the entry.

```
JAIN-E                          the office PC
──────                          ─────────────
booking filed
  → note in the queue   ←─────  every 30s: "anything for me?"
                        ─────→  claims one, starts Claude
                                  Claude opens 192.168.1.5 in Chrome
                                  and fills in the ERP entry
                        ←─────  writes back: done, or what stopped it
```

**Why it asks rather than being told.** Farvision is at `192.168.1.5` — an address that exists
only inside the office. Nothing on the internet can reach it, and nothing can reach this PC
either. So the PC asks. That also means no tunnel to keep alive, no port to open, and it picks
itself up after a reboot or a night switched off.

## Setting it up, once

On the machine that stays awake:

1. **Install Claude Code** and sign in. Check it works: `claude -p "say ok"`.
2. **Connect the Chrome extension** in the browser that will do the work, and leave that Chrome
   running. The automation is pinned to one browser on purpose (see below).
3. **Put the queue's secret in the environment** rather than leaving it in the file:
   ```
   setx JAINE_ERP_SECRET "<the value from acc.job_secrets where name = 'erp_bot'>"
   ```
4. **Try one job by hand, without saving anything:**
   ```
   powershell -ExecutionPolicy Bypass -File watch-erp.ps1 -Once
   ```
   Claude fills the form and stops before saving. Read `watch-erp.log` and check the entry on
   screen.
5. **Leave it running** once you are happy:
   ```
   powershell -ExecutionPolicy Bypass -File watch-erp.ps1
   ```
   To start it at boot, add it to Task Scheduler: *At startup*, run `powershell.exe` with
   `-ExecutionPolicy Bypass -File <full path>\watch-erp.ps1`, *Run whether user is logged on or
   not* **off** — it needs a desktop session to drive a browser.

## Nothing is saved until you say so

`watch-erp.ps1` is a **dry run by default**. Claude fills the form, screenshots it and stops.
Add `-Live` only once you have watched several dry runs and are happy with them:

```
powershell -ExecutionPolicy Bypass -File watch-erp.ps1 -Live
```

## The safety rails

- **One booking at a time.** The queue hands out one job and will not hand out the same one
  twice, even if the watcher is started twice by mistake.
- **One entry per booking, ever.** The queue is unique on the booking, so a re-run cannot make a
  second ERP entry for the same flat.
- **It stops rather than guesses.** An unfamiliar screen, a validation error, a missing value, or
  an entry that looks like it already exists — Claude writes `STOPPED` and why, the job is left
  for a person, and nothing is saved.
- **Three attempts, then it waits.** A job that keeps failing stops being retried and sits as
  `failed` for somebody to read. An ERP entry that goes wrong repeatedly should be read, not
  retried for ever.
- **One pinned browser.** Temporarily fixed to device `e1ebe563-7a2f-4576-b39d-a5191ea94617`. If
  that Chrome is not connected the job fails and says so, rather than typing into whatever
  browser happens to answer.
- **Its own secret.** The watcher holds a secret that can claim and finish ERP jobs and nothing
  else. It is not the service key. Revoke it by changing one row in `acc.job_secrets`.

## Changing what it does

- **What Claude is asked** lives in `erp-entry-prompt.md`. Edit that; the watcher has no
  instructions of its own.
- **Which browser**, and the ERP address, are the two constants at the top of `watch-erp.ps1`.

## Looking at the queue

```sql
select j.id, c.case_no, j.status, j.attempts, j.note, j.claimed_at, j.finished_at
from acc.erp_jobs j join acc.flow_cases c on c.id = j.case_id
order by j.id desc;
```

`note` holds Claude's own account of what it did, or what stopped it.

## Not done yet

The prompt tells Claude to "go to the ERP Entry screen and fill it in" — **which screen, and
which fields, is not yet written down**, because we have not mapped it. Until that is in
`erp-entry-prompt.md`, Claude will open Farvision, fail to find a screen it is confident about,
and stop. That is the intended behaviour for now, not a fault.
