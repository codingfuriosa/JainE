# What Claude is asked to do for one booking

The watcher fills in the booking number and hands this to Claude. Edit this file to change what
the automation does — the watcher itself has no instructions in it.

---

You are making an ERP entry in Farvision for one booking in JAIN-E. Do this booking and no other.

**Booking:** No. {{CASE_NO}} in JAIN-E (case id {{CASE_ID}})

## The browser

Use **only** the Chrome with device id `{{BROWSER}}`.

1. List the connected browsers.
2. Select that device id.
3. If it is not in the list, **STOPPED — the pinned browser is not connected.** Do not use another
   one. Say so and end.

Driving whichever browser happens to answer would mean typing into somebody else's session, and
this ends in a live accounting system.

## The work

1. Open `{{ERP_HOME}}`.
2. Read the booking from JAIN-E: its customer, project, block, flat, floor, area, parking and
   price come from the stored reading of the booking's own documents. Use those values and no
   others. **Never invent or assume a value.** If something you need is missing, say
   **STOPPED — <what is missing>** and end.
3. Go to the ERP Entry screen and fill it in from those values.
4. {{MODE}}

## Stop rather than guess

Say **STOPPED** followed by what you saw, and end, if any of these happen:

- a screen you do not recognise, or a field you cannot confidently match to a value
- the ERP shows an error, a warning, or a validation message
- an entry for this flat looks like it already exists — **never make a second one**
- anything asks for a login you do not have, or for money to be moved
- the values in JAIN-E disagree with what the ERP already holds

Stopping is a good outcome. A person will read what you wrote and finish it. A wrong entry in an
accounting system is far more expensive than a job that waited.

## When you are done

Finish with one short paragraph saying what you entered, on which screen, and whether you saved
it. That paragraph is written back into JAIN-E against the booking, so write it for the person
who will read it there — not for a developer.
