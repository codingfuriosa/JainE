# TDS return file (Form 140) - checks and how to follow a new format version

The Accounts screen **Ledgers & postings > TDS returns** makes the text file the Income Tax Department prescribes for the
quarterly statement of tax deducted on non-salary payments to residents (Form 140, the old 26Q), for Tax Year 2026-27 onwards.
The generator is the block `TDSG` in `accounts-books.js`; the screen follows it. Nothing here runs in the app.

## Run the checks (Node 24, from the repository root)

    node tools/tds-form140/check-form140.js          # 579 checks: the file against the official layout, the validations, the due dates
    node tools/tds-form140/check-form140-screen.js   # 42 checks: the real screen code, every action, what it sends and shows

`check-form140.js` reads the generator out of `accounts-books.js` and compares each line of a sample statement, field by field,
with `official-layout.json` (field count, mandatory fields, size limits, "not applicable" fields empty, record cross-totals).

## When Protean / the Income Tax Department publishes a new version of the file format

The format is published as a spreadsheet per form on Protean's TIN site (Downloads > e-TDS/TCS > "File Format for Form Number 140").
Current: version 1.2 of 22 Jul 2026 (`Form Number 140 - 26Q - Q1 to Q4_22072026.xlsx`), FVU / RPU 1.2.

1. Download the new sheet and read it as data: `powershell -File tools/tds-form140/xlsx-to-text.ps1 -Xlsx <sheet.xlsx> -OutDir <empty folder>`
2. Compact it: `perl -pe 's/\t\[[A-Z]+\] *(?=\t|$)//g; s/\t\[([A-Z]+)\] /\t$1: /g; s/^\x{FEFF}//' <folder>/sheet1_*.txt > <folder>/compact.txt`
3. `node tools/tds-form140/extract-layout.js <folder>` - rewrites `official-layout.json` and `tds_codes_seed.sql`. The row ranges inside are those of
   version 1.2; the script stops with an assertion if the sheet has moved, and the ranges are then adjusted by hand.
4. Run both checks. Differences in field counts or new mandatory fields show up as failures; update the generator (`TDSG.build` / `TDSG.validate`),
   and `accounts.tds_codes` if the tax codes changed (a new migration; the seed is `tds_codes_seed.sql`).

## What the file is, and what it is not

The file is the **input of the File Validation Utility (FVU)**. FVU checks it and makes the `.fvu` file that is uploaded on the e-filing portal / TRACES.
These checks reproduce the published layout; only FVU itself is the authority, so the first real file of each quarter should go through it.
