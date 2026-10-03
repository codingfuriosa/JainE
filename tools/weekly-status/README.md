# Re-syncing Weekly Status from the OPS Google Sheet

The sheet is still where the minutes get typed. These two scripts read its first tab and turn it
into the JSON `ops.import_sheet()` expects.

**Sheet:** `OPS weekly meeting Monday / Incharge : Shafat`, first tab only
(`1yMhFYrvs9H90ku0YTTL2JRRaed8w-JWZI57wk4j1cM0`, `gid=0`).

```powershell
# 1. pull the tab down as CSV (it is readable without signing in)
Invoke-WebRequest -OutFile ops.csv `
  'https://docs.google.com/spreadsheets/d/1yMhFYrvs9H90ku0YTTL2JRRaed8w-JWZI57wk4j1cM0/export?format=csv&gid=0'

# 2. parse it
.\parse-ops.ps1            # -> ops.json, and prints meeting/item counts

# 3. split into pieces small enough to hand to the database in one call each
.\emit-chunks.ps1          # -> chunks\chunk01.txt ...
```

Then run `select ops.import_sheet('<contents of chunkNN.txt>'::jsonb);` once per chunk, signed in
as somebody who carries the `weekly_status` module.

## What the parser has to cope with

The sheet has been kept by hand since February 2025 and its shape changed three times. All three
are read rather than tidied up, because the sheet is still live and will keep changing shape:

| era | meeting header | where the task text sits |
|---|---|---|
| Feb–May 2025 | `Minutes of Meeting : OPS MEETING (11th feb'25)` on its own row | column B, project in column A |
| Sep 2025 – Aug 2026 | the date moved into the header row, column A | column B, project is a heading alone in column A |
| Sep 2026 → | same header | column A, column B empty |

Other things it handles, each of which was a real bug before it did:

- **Column F is era 1's `Status` column** (its own header row says so) and later becomes
  `Problem solver`, a person's name. A dozen 2025 items were only ever marked DONE there.
- **`Minutes of Site Visit`** headers, not just `Minutes of Meeting` — missing these merged two
  whole meetings into one.
- **Two meetings on 19 Dec 2025**, a site visit and an OPS meeting, both titled only by their date.
  They are told apart by kind, not by title.
- **`Task | … | Person Responsible | Done/Not Done`** header rows, which otherwise file themselves
  as action items.
- **Bullet dashes** (`- Entrance gate to Club…`) are the sheet's own bullets, not part of the text —
  and a bullet is never a project heading however short it is.
- **Indian day-first dates** in every format the sheet uses: `12/2/25`, `25.9.25`, `16th April'25`,
  `30th June`, `21-09-2026`.

## Re-running is safe

`ops.import_sheet` is keyed on (meeting date, kind, note) and (meeting, source row, item text), so
a second run updates the rows it made the first time rather than doubling them. **It will not undo
work done inside JAIN-E**: once somebody has ticked an item off there, the import refreshes the
sheet's text around it and leaves the status, and who closed it and when, alone.

Names and projects are grouped through `ops.owner_aliases` and `ops.project_aliases`. If the import
puts something under the wrong person or the wrong project, fix the alias row — not the parser.
