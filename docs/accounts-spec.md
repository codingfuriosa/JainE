# JNE Accounts Module — Specification (as built, 05-Oct-2026)

Status: built and verified in the database (rolled-back SQL tests) and in the browser with a fake-data harness. **Not committed.** Never clicked through signed-in against live data.
Source of the requirements: the two-page note of 05-Oct-2026. Page 1 became the **Transactions** tab, page 2 the **Ledgers & postings** tab, inside one new module **Accounts** (Governance group, `accounts.html`, route `accounts/<tab>/<section>`).

Follows the Purchase & Stores pattern: new `accounts` schema (new tables only), `accounts*.js` loaded on demand by `nexus-core.js`, reads follow the module grant, every write to a voucher goes through a database function.

Migrations (applied to the live DB): `20261005100000_accounts_core.sql`, `20261005110000_accounts_payables_banking.sql`, `20261005120000_accounts_postings_reports.sql` (applied in several parts; two small follow-ups — `pending_postings` blocker summary, helper `search_path` — are folded into the files / listed below).

---

## 1. Who can do what
- **View:** anyone given the *Accounts* module in the Control Panel (`adm.users.modules` holds `accounts`; the module is registered in `public.erp_modules`, granted per person, never by default). Enforced in RLS (`accounts.can_read()`), not only by hiding the menu.
- **Post** (accountant) and **administer** (structure, chart groups, access list): rows in `accounts.access`. Seeded administrators: `ayushruia1@gmail.com`, `businessanalyst@thejaingroup.com`, `system3.thejaingroup@gmail.com`. Super admins can do everything. **Audit tab:** administrators only (section 4a).
- Staff get SELECT only on the tables; masters (companies, ledgers…) are edited directly under role policies; **vouchers cannot be inserted, edited or deleted directly** — only through `voucher_post`, `vendor_payment`, `post_*`, `voucher_cancel`, `reverse_posting` (verified: a stranger sees nothing, an administrator is refused a direct voucher insert).

## 2. Structure — Enterprise › Company › Business unit (Transactions › Structure)
- **Enterprise** → **Company** (name, short code used in voucher numbers, GSTIN, PAN, GST state code, financial-year start month, *books start* date, *books locked up to* date) → **Business unit**.
- A business unit is a **project** (`cust.projects`), chosen when it is created (or "not a project", e.g. head office). This is how bills, work-order bills and Post Sales documents find their company. A project can belong to only one business unit.
- Everything is entered per company; a scope bar (enterprise, company, business unit) filters every screen. Business unit is optional on a voucher ("company level").
- Access list (who may post) is managed here by administrators.
- **Nothing is seeded** except the three administrators. The enterprise, companies and business units are for an administrator to set up (Purchase's `legal_entities` was empty; the only hint in the system is Post Sales project 1 → "Dream Gateway Hotels Ltd.").

## 3. Page 1 — Transactions

### 3.1 Receipts & payments, Deposits & withdrawals, Contra
Voucher numbers `<company code>/<RV|PV|DP|WD|CV|JV>/<FY>/<serial>`; a posted voucher is **never edited** (triggers refuse it) — it is cancelled with a reason and re-entered.
- **Receipt:** debit a bank / cash ledger, credit one or more ledgers (optionally a sub-ledger and a cost / custom ledger per line).
- **Payment:** credit bank / cash, debit other ledgers. **Pay a vendor** (below) is a payment that also settles bills.
- **Deposit:** debit bank, credit cash (mode cash / cheque / DD). **Withdrawal:** debit cash, credit bank. **Contra:** between any two cash / bank ledgers.
- **Journal** (own section, `accounts/0/journal`): free debit / credit lines on any ledgers **except bank and cash**, each line with an optional sub-ledger and cost / custom ledger. A running Debit / Credit / difference line shows "Balanced ✔"; a per-line button puts the balancing amount on that line. At least two lines, a narration ("why is this entry being made?") is required, and the database refuses an unbalanced journal. Cancelled like any manual voucher. A *credit* to a vendor in a journal does **not** create a bill to pay (bills come from Purchase / Engineering); a *debit* to a vendor shows up under on-account and can be set against that vendor's bills.
- Rules enforced in the database: balanced to the paisa; each type only touches the right kind of ledger (a journal can never touch cash / bank); no future dates; no date before the books start or on / before the lock date; ledgers must belong to the company; a ledger with a sub-ledger type needs a sub-ledger on every line; cost / custom ledgers only go in the cost column.
- Register per section with date range, status, search, CSV; each voucher opens to show lines, bills it settles, cheque, history; **Cancel voucher** (with reason) reopens the bills it had settled and voids its cheque.

### 3.2 Bills & on-account (Bills & on-account section)
- **Payables** are created when a bill is posted (see 4). Screen shows outstanding / overdue / retention held / on-account KPIs, a bill register (outstanding, overdue, retention, settled), and a count of booked bills still waiting to be posted.
- **Pay a vendor:** choose vendor → its open bills with a "pay now" amount each (and **Full**), plus an **on-account** amount for money not against any bill. One payment can do both. Posts `Dr Vendor (sub-ledger)  [Dr Retention payable for retention released]  Cr Bank`.
- **On-account adjustment against bills:** an on-account payment (or a debit-note balance) is set against open bills of the same vendor. **No ledger entry** — the vendor's sub-ledger already holds both the advance and the bill; only the matching is recorded. Can be undone from the bill's history.
- Retention is a separate payable (`kind = retention`) that is paid out through the same "Pay a vendor" screen.

### 3.3 Bank reconciliation (BRS)
Per bank ledger and "as on" date: book balance, + cheques issued not presented, − receipts / deposits not credited, = balance as per bank; enter the **bank statement balance** to see the difference ("Reconciled ✔" when nil). Entries are marked cleared on the date the bank cleared them (bulk select; "clear on voucher date"; un-mark). A voucher with a cleared line cannot be cancelled until un-marked. CSV of the statement.

### 3.4 Cheque printing
- **Cheque books** per bank ledger (prefix, from–to, next number, digits). A payment by cheque takes the next number (**Issue & print**); a typed cheque number is registered as it is.
- **Print** draws the bank's cheque leaf: date (one box per digit), payee, amount in words (Indian system, two lines), figures, optional "A/C PAYEE" crossing. Printed through the browser print dialog on the exact leaf size; each print is counted; **Cancel cheque** (spoilt / lost) frees the voucher so the next print uses the next number.
- **Cheque layout** per bank: leaf size and millimetre positions for each field, live preview, **Print test**. Default is a CTS-style 202 × 92 mm layout — **print a test on plain paper and adjust per bank before using real cheques** (not tested against a physical cheque).

## 4. Page 2 — Ledgers & postings

### 4.1 Bill postings (Purchase bills, debit notes, Engineering RA bills)
Nothing posts by itself: booked documents wait on this screen (ready / blocked / posted, with the entries that will be made) and an accountant posts them one by one, selected, or "post next 300". Blockers shown per row (project not mapped, dated before the books start, bill must be posted before its debit note). A posted bill sets `purchase.bills.accounts_status = 'posted'` and `accounts_ref`; **Reverse** releases it again (blocked while payments / debit notes are set against it).

| Document | Entries |
|---|---|
| Purchase bill (goods) | Dr Material purchases (taxable) · Dr Input CGST+SGST or IGST · Cr Vendor (total − TDS) · Cr TDS payable (vendor sub-ledger) |
| Purchase bill (service / non-store) | same, expense ledger from the expense-head mapping, else "Other expenses (unclassified)" |
| Debit note | Dr Vendor · Cr Purchase returns · Cr Input GST; set against its bill's payable |
| **RA bill** (Engineering) | gross = Engineering's own figure (each work-order item rounded after summing its quantities); Dr Contractor / works cost (gross, split by activity group — see 4.4) · Dr Input GST (gst %) · Cr Contractor (gross + GST − retention − TDS − other deduction) · **Cr Retention money payable (retention %)** · Cr TDS payable · Cr Recoveries (other deduction); a retention payable is created for later release |

GST split: bills use the bill's own intra / inter flag; RA bills compare the vendor's GSTIN state with the company's GST state code (CGST+SGST when unknown).

### 4.2 Post Sales flow
- **Money receipt** → `Dr Bank (or cash / the adjustment account) · Cr Advance received from customers` with **one sub-ledger per booking**. The receipt's Post Sales bank account must be linked to a ledger (Posting ledgers); "JV" receipts go to the ledger linked to their adjustment account (e.g. TDS receivable).
- **Invoice** → only the GST: `Dr Advance from customers · Cr Output CGST + SGST` (or IGST, per company setting on that screen). The invoice value itself is never booked.
- Receipts reversed and invoices cancelled in Post Sales after posting are listed under "source cancelled" with a **Reverse** button.
- Live data today: 1,796 active receipts (₹121.9 cr) and 771 invoices with GST. **None has been posted** — the first step is the admin's setup.

### 4.3 Chart of accounts, ledger opening, ledgers
- **Chart:** groups (asset / liability / income / expense, nested), general ledgers (bank / cash flags, bank details, sub-ledger type, link to a Post Sales account), and **cost / custom ledgers** with their **sub-ledgers**. **Load the standard chart** (real-estate default: groups plus the ledgers the postings use) from Structure; safe to repeat.
- **Ledger opening:** opening balance (Dr / Cr) per ledger as at the company's books start, optionally per business unit; ledgers with sub-ledgers (vendors, customers) take it per sub-ledger (vendor picker, or a typed name); cost / custom ledgers carry theirs outside the trial balance. A running total shows whether the general ledgers tally.
- **Ledger statement** (general or cost / custom, optionally one sub-ledger, period, business unit; opening, entries with running balance, closing; CSV), **sub-ledger balances**, **trial balance** (opening, period, closing; profit or loss of earlier financial years is carried into the balance sheet; "Books tally?" check; CSV). Income and expense ledgers start afresh each financial year.
- **Posting ledgers:** which ledger plays each role (16 roles), Post Sales account → ledger links, expense head → ledger, GST split for customer invoices.

### 4.4 Engineering link (Engineering module pushed live 05-Oct-2026, commit `30b6920`)
Migration `20261005140000_accounts_engineering_link.sql`; screens: Engineering › RA Bills (`engineering-ra.js`) and Accounts › Posting ledgers.
- **Same numbers as Engineering.** Accounts takes a *booked* RA bill's amounts exactly as `eng.v_ra_bills` works them out (gross = Σ per work-order item of `round(Σ qty × rate, 2)`; GST, retention and TDS on the gross; net = gross + GST − retention − TDS − other deduction). Tested: gross, GST, retention, TDS and net payable match Engineering's view to the paisa, and the payable in Accounts equals Engineering's *net payable*. (Accounts first rounded the grand total once, which could be paise out.) A rate on a work-order item cannot change once work is entered against it, so a booked bill's amount can never drift after posting.
- **A posted bill cannot be cancelled in Engineering.** A database trigger on `eng.ra_bills` refuses *Cancel* once Accounts has posted the bill ("Accounts has already posted this bill as … ask Accounts to reverse the posting first"). Without it the work would be released for re-billing while the payable (and maybe payments) still stood. Order of events to undo a bill: cancel any payments → *Reverse* in Accounts › Bill postings → cancel in Engineering (verified end to end; the work is then free to bill again). In Engineering the Cancel button is also disabled with the reason.
- **Engineering sees what happened in Accounts.** RA Bills list has an *Accounts* column (Not yet posted / Posted · paid ₹x of ₹y / Paid) and each bill shows a box: voucher, company, net payable, paid, outstanding, retention held / released. Read through `accounts.ra_bill_accounts()`, which shows Engineering only these figures (no ledgers); if Accounts is unavailable the screens just say "not posted".
- **Contractor cost by activity group.** Under Posting ledgers, each Engineering activity group (Civil, Electrical …) can be mapped to a cost / custom ledger (without sub-ledgers). When an RA bill is posted its contractor cost is split by the activity group of the work and tagged to those cost ledgers; unmapped groups stay on the plain *Contractor / works cost* line. Cost to date per group can then be read under Ledgers & trial balance.
- The voucher narration and the payable carry the contractor's own bill number and any sub-contractors; payment is to the parent contractor (as in the RA bill).
- Sub-contractors are not paid separately; payment is to the parent contractor, as in the RA bill.

### 4.5 Retention release (Engineering › Retention, paid from Accounts › Bills & on-account)
Migration `20261005150000_accounts_retention_budget.sql`; screens `engineering-ret.js` and the *Retention releases* card in Accounts.
- **Engineering certifies, Accounts pays.** Retention held back from an RA bill is released only through a *release*: an engineer **requests** it (work order, which RA bills, how much, and why — completion certificate, defect period over …); a **different** person **approves** it (the requester can never approve or reject their own request, super admins included); Accounts then **pays exactly the approved amount** and the release shows *Paid* with the voucher. Statuses: Awaiting approval → Approved (waiting for Accounts) → Paid; or Rejected (reason required) / Cancelled (by the requester, the approver or a super admin, reason required).
- **Only bills Accounts has posted hold releasable retention.** The Retention tab lists each work order's retention deducted / released / in progress / available (and says how many bills are not yet posted). A request can never take more than is still free (outstanding less what other pending releases already cover).
- **Accounts cannot pay retention any other way.** `vendor_payment` refuses retention unless it is paid through an approved release; a release is paid on its own (exactly its lines, no other bills, no on-account), by the *Pay* button on the release. The normal *Pay a vendor* screen shows retention rows as "needs a release approved in Engineering".
- **Undoing.** Cancelling the payment puts the release back to *Approved*; a bill whose retention has a pending release cannot be reversed in Accounts until the release is cancelled in Engineering; numbering `<company>/RR/<FY>/<serial>`.
- Verified with a rolled-back end-to-end run (request → over-request refused → self-approval refused → direct retention payment refused → approval → wrong-amount payment refused → exact payment → cancel payment → release back to Approved → cancel → rejection needs a reason → a stranger is refused).
- Who can request / approve: anyone holding the Engineering module (super admins included). Today four super admins can; **give the Engineering module to the right people before relying on the second signature** — with only one eligible person nothing can be approved.

### 4.6 Budget vs actual payments (Engineering › Overview and Budget)
`accounts.eng_budget_actuals()`; Outflow rows now have a **Paid** column (and the Overview a *Paid (via Accounts)* tile and a Paid column per project).
- **Paid** is what Accounts has actually paid against posted RA bills, shown as *the part of the billed work it settles* so it compares directly with Budget, Committed and Billed: for each bill, work value × (paid ÷ owed), where owed = net payable + retention and paid = payments + on-account adjustments + retention released. GST, TDS and retention are left out. The cell also says "x% of billed" and how much **retention is still held**.
- Attributed to a budget line by the same scope Engineering uses (project / block / activity group): each bill's work is split by block and activity group and its settled share follows.
- Only bills posted in Accounts count (an unposted bill shows as billed but unpaid); advances paid on account to a contractor are not attributed (they belong to no bill). If Accounts is unavailable the column shows "—".

## 4a. Page 3 — Audit (added 02-Nov-2026; `supabase/migrations/20261102150000_accounts_audit_registers.sql`)
Four registers, for **Accounts administrators only** (the admin role in `accounts.access`, or a platform super admin - the same test that guards the structure; `20261103090000_accounts_audit_admin_only.sql`). Anyone else does not see the tab, and the database returns them nothing from `audit_log`, `v_audit_log`, `v_audit_reversals` or `v_audit_transfers` even if asked directly; their vouchers are untouched. Each register has a date range, a search box and Excel / PDF download, and follows the company (and, where it applies, the business unit) chosen at the top.
- **Deleted** — every record removed from Accounts (ledger, sub-ledger, account group, opening balance, business unit, company, ledger link, setting, access, cheque book / layout, bank statement balance), with who, when, and everything the record held.
- **Modification** — every edit to those records (who, when, the columns that changed, before → after), plus the two things that can change on a posted voucher: its cheque / instrument / payee / narration / mode, and a bank-clearance date on a line.
- **Transfer** — contra, deposit and withdrawal vouchers (money moved between the company's own cash and bank accounts): from account, to account, amount, mode, who entered it, posted or cancelled. Journals are not in it.
- **Document reversal** — every cancelled voucher (including bills cancelled from Bills & on-account and postings reversed from Ledgers & postings) and every cancelled opening bill: who entered it, who reversed it, when, why. Dates filter on the date of reversal.
- Deleted and Modification are written by database triggers into the append-only `accounts.audit_log` (nobody can write, change or delete it), so they hold only what happened **from 02-Nov-2026**; Transfer and Document reversal read the vouchers and cover everything ever posted. Not logged: plain inserts, a record edited in the same transaction that created it, edits that touch only `updated_at` / `updated_by`, and a cheque book's next-number counter (it moves by itself). A posted voucher can never be edited or deleted (it is cancelled), so for vouchers the registers are Document reversal and the voucher rows of Modification.

## 4b. TDS returns - Form 140 (added 04-Nov-2026; `supabase/migrations/20261104100000_accounts_tds_returns.sql`, checks in `tools/tds-form140/`)
Route `accounts/1/tds` (**Ledgers & postings › TDS returns**). It makes the text file the Income Tax Department prescribes for the quarterly statement of tax deducted on payments other than salary to residents: **Form 140** (the 26Q of the 1961 Act), Tax Year 2026-27 onwards, in the layout "File Format for Non-Salary TDS File - Form Number 140 (26Q) - Q1 to Q4", Protean (NSDL e-Gov), version 1.2 of 22 Jul 2026 - records FH / BH / CD / DD, `^` delimited, ASCII, CRLF, dates ddmmyyyy. The file is the **input of the File Validation Utility (FVU)**, which checks it and makes the `.fvu` file uploaded on the e-filing portal / TRACES; the screen says so and lists the steps. The company never types the format: it fills five things, in order.
1. **Deductor** (`tds_deductors`, once per company): TAN, name as registered with the TAN, address, deductor type, and the person responsible (name, designation, PAN, address, Indian mobile, e-mail). PAN and GSTIN come from the company.
2. **Deductions** (`tds_entries`): posting a bill with TDS - a Purchase bill, an Engineering RA bill, or *Enter a bill* - writes one row in the same transaction (deductee name and PAN as on the vendor, the amount the rate was applied to **excluding GST**, rate, TDS, deduction date = credit date = the bill date, because tax is deducted at credit). Bills posted before the migration were back-filled. The **nature of payment** (4-digit tax code of the official format, `tds_codes`, 40 codes) comes from the bill (*Enter a bill* has the choice), else the vendor's usual code, else - for RA bills only - from the PAN (4th letter P or H: 1023 contractor individual/HUF; anything else: 1024). Otherwise the row says *Choose*; set it on the screen for many rows at once, with *Remember for the vendor*. A reversed bill leaves the return.
3. **Challans** (`tds_challans`): BSR code (7 digits), serial no., date, tax / interest / fee / other in whole rupees, minor head 200 or 400. Each deduction is **mapped** to the challan that paid it (*Suggest the mapping* does it oldest first); a challan can carry more than the mapped tax but never less. A gap under Rs 1 is rounding (the challan is in whole rupees, the bill's TDS can have paise).
4. **Checks, then the file.** Before the file can be made the screen requires: complete deductor and responsible-person details in the formats the layout demands; a valid code on every row; a PAN on every row (a valid one, or PANNOTAVBL / PANAPPLIED / PANINVALID, which warns that the higher rate applies); amount and tax sensible; deduction and credit dates inside the quarter and not in the future; reason A only with a 10-15 character certificate number and only for codes the layout allows it for; every deduction mapped; each challan at least the tax mapped to it plus its interest and fee; the token of the previous statement (15 digits) if an earlier Form 140 was filed this tax year. It warns about late deposit (due the 7th of the next month, 30 April for March), a challan dated before the deduction, and a late statement (due 31 Jul, 31 Oct, 31 Jan, 31 May; fee Rs 200 a day up to the tax). Making the file logs it in `tds_statements`; its id is the *File Sequence No* of the file header. It can be downloaded again.
5. **Closing.** *Mark as filed* with the 15-digit token closes the quarter (its deductions, PANs, codes, challans and mapping cannot change; an Accounts administrator can reopen) and fills "previous statement" for the next quarter.
The quarter follows the deduction date. Writes go through definer functions (`tds_deductor_save`, `tds_entry_update`, `tds_challan_save / cancel / map`, `tds_auto_map`, `tds_statement_new / finish / filed / reopen`); `tds_statement_data` gives the screen and the file everything for one quarter. The file is built in the browser by `TDSG` (`accounts-books.js`), a set of pure functions checked by `tools/tds-form140/check-form140.js` against the official sheet (579 checks) and `check-form140-screen.js` (42 checks).
**Not covered (and nothing in the system for them):** Form 138 (salary - HR), Form 144 (non-residents), Form 143 (TCS), Form 141 (challan-cum-statement for property and rent paid by individuals), **correction statements**, quarters before Tax Year 2026-27 (they use the old 26Q and FVU 9.5), TDS deducted on **advance payments** (a vendor payment on account carries no TDS here, though tax is due at the earlier of credit and payment), TDS on **opening bills**, lower-deduction reasons other than A and C, interest for late deposit and the late filing fee are only *reported* (never computed into a challan), Form 16A. Only FVU is the authority on the file: the first file of each quarter goes through it.

## 5. Assumptions I made (change if wrong)
1. **Company = a legal entity in Accounts' own master** (optionally to be linked to Purchase's legal entity later); **business unit = project** (as already chosen for RFQs).
2. **Vendors, contractors and customers are sub-ledgers under control ledgers** (Sundry creditors, Advance from customers), created automatically — not separate ledgers.
3. **Cost / custom ledger = an analytical tag on a voucher line** (with its own sub-ledgers and opening), outside the trial balance — my reading of "Cost / Custom Ledger & its subledgers".
4. **Retention** is held as a liability per contractor and released through a payment; the RA-bill amounts follow the work-order percentages (retention and TDS on the gross, GST on the gross).
5. **Customer-invoice GST** is debited to the customer's advance account (not to a receivable), split CGST+SGST unless the company is set to IGST.
6. Posting is **on demand**, not triggered automatically when a bill is booked, so ledgers can be prepared first. (Easy to switch to automatic if wanted.)
7. Default **books start 1 Apr 2026**: `1,247` of the 1,796 receipts and `629` of the 771 GST invoices are older, so they show as "dated before the books start" until the administrator sets an earlier books start date (e.g. 1 Apr 2023 to bring all Post Sales history in) or carries them in an opening balance.

## 6. Not built / open
- Automatic posting on booking; bank-statement file import and auto-matching for BRS; payment advice and Form 16A (the Form 140 return file and TDS challans are in 4b); GST returns; profit & loss and balance sheet statements (the trial balance is there); year-end closing entries (the trial balance carries prior-year profit or loss, but no closing voucher is made).
- Opening **bills** (old unpaid vendor bills from before the books start) — vendor openings are totals per vendor; pay old bills on account.
- No budgets; no approval chain on vouchers; no document attachments; no print of vouchers.
- TDS is posted per vendor (deductee) in the ledger; the section (tax code) is kept per deduction in the TDS register (4b), not in the ledger.
- Customer-side receivables / interest / cancellation charges from Post Sales are not booked (only receipts and invoice GST, as specified).
- Cheque layout is a default; each bank's leaf must be calibrated by a test print.

## 7. Files
`accounts.html`, `accounts.js` (shell, structure, vouchers, bills, on-account), `accounts-bank.js` (BRS, cheques), `accounts-books.js` (postings, TDS returns and the Form 140 file, chart, openings, ledgers, rules, audit); `tools/tds-form140/` (checks of the Form 140 file against the official layout); registration in `nexus-core.js` (NAV, `PAGE_EXTRA_SCRIPT`, `VIEWS.accounts`, usage keys); `public.erp_modules` row `accounts`; usage catalog `accounts.transactions…`, `accounts.ledgers_postings…`.
