# JNE Purchase & Stores Module — Specification (DRAFT)

Status: draft from the requirement notes of 04-Oct-2026, for review. Items marked **[?]** are open questions (collected at the end) with the default I'll build if nobody objects.
Build order (from the Post Sales spec): Post Sales → Engineering → **Purchase & Stores** → Property Maintenance → Accounts. Bill booking, debit notes and service bills are produced here and later posted to Accounts, so every money document carries a "ready to post" status and a slot for its accounting entry, exactly as in Post Sales.

Follows the Post Sales pattern: a new `purchase` schema (new tables only), one `purchase*.js` loaded on demand by `nexus-core.js`, staged delivery, each stage reviewed locally before anything is pushed.

It replaces the placeholder tabs on the existing **Inventory** and **Procurement** pages. The real parts of Procurement (Quote Comp document store, Vendor Trends on `kraya.*`) stay untouched; Vendor Trends can later be pointed at real POs.

**Out of scope:** services taken from contractors (Engineering module's work orders / RA bills).

---

## 1. Setup (Stage 1)

### 1.1 Item groups and items
- **Item group → items.** Groups can be nested **[?]**.
- **Item:** code (auto, e.g. `CEM-0001`), name, group, **HSN code**, GST rate (default from HSN), make/brand optional, active flag.
- **HSN is mandatory** on every item.

### 1.2 UOM and dual UOM
- **UOM master:** Bags, MT, Nos, Sqft, Brass, Ltr…
- **Primary (receipt) UOM** on every item. An item may also have a **secondary (issue) UOM** with a fixed **conversion factor** (e.g. receive in MT, issue in Kg: 1 MT = 1000 Kg).
- **Stock is held in the issue UOM** when there is one, otherwise the receipt UOM. GRN is entered in the receipt UOM and converted on posting; issues and returns are in the issue UOM. **[?]** which one is the stock UOM.

### 1.3 Warehouses
- **Multiple warehouses per project**, each with code, description (the `name` column, labelled *Description*), an optional **Type** (free text with suggestions - Main store, Site store, Sub store, Godown, Yard - plus any type already used; column `wh_type`, migration `20261005200000_purchase_warehouse_type`) and an Active / Inactive switch (the optional in-charge field was removed from the form and list on 2026-10-05; the database column is left in place, unused). A project belongs to a **legal entity / company**; this drives the transfer rule in §6.5. **[?]** whether the legal entity already exists anywhere in JainE.

---

## 2. Vendor enlistment (Stage 2)
- **Vendor master (as built):** legal name, type (supplier / service provider / both), PAN, GSTIN, address, **one vendor email (required - RFQ mails are sent there)**, ledger name / parent description / group, item groups supplied, payment terms default. The enlist form has **no trade name and no MSME / Udyam number** (removed 2026-10-05; the columns stay in the database, unused) and **no contacts list**. It has a **Bank account details** section (2026-10-05): bank name, branch, account holder name, account number (6-20 digits) and IFSC - all optional, but a bank needs name, number and IFSC together; one account, stored in `vendor_banks` (the default one, else the oldest, is the one shown and edited; emptying every box removes it). Changing bank details does **not** send an approved vendor back for re-approval. The old `vendor_contacts` table is kept untouched because the self-registration page (not live yet, and it still asks trade name / MSME / several bank accounts) writes to it - when a vendor registers itself, the first contact that gets RFQs becomes its email. The vendor list shows the email (or a "No email" flag) and searches it. Re-approval after an edit now covers **GSTIN and PAN only**, and "documents before approval" covers the PAN card and GST certificate only.
- **Enlistment flow:** vendor is added by Purchase, or self-registers through a tokenised link; Purchase verifies and marks **Approved**. Only approved vendors can receive an RFQ or a PO.
- Documents (PAN, GST certificate, cancelled cheque) uploaded to the existing S3 store.
- **Ledger (as built):** the enlist / edit form has a **Ledger** section: **Ledger Name, Parent Description, Last Modified On, Group**. (Ledger code, ledger type and sub ledger type were tried and removed at the user's request.) Plain text typed by whoever enlists the vendor - JainE has no ledger master to pick from yet; Group suggests what other vendors already use. **Last Modified On** is read-only and kept by the database: stamped when a ledger detail is first filled in or changed, untouched by any other edit or by approval. All optional, none triggers re-approval, not asked on the vendor's own self-registration page, searchable from the vendor list. Columns `ledger_name, ledger_parent_description, ledger_group, ledger_modified_at` and `email` on `purchase.vendors` (migrations `20261004410000_purchase_vendor_ledger.sql`, then `20261004430000_purchase_vendor_simplify.sql`).

---

## 3. Indent (Stage 3)
- **Indent:** project, warehouse/site, required-by date, lines (item, qty in receipt UOM, remark), raised by.
- Document number per project: `<PROJ>/IND/26-27/0001`.
- **Approval (as built):** a per-project approver chain set up on the Admin tab (Approvers) — ordered levels, and at each level any **one** of the listed people approves or rejects. The person who raised an indent can never decide it. Rejection needs a reason; the raiser corrects and resubmits (a new submission round). It deliberately does **not** use the Accountability workflow engine: that engine models multi-step tasks and has no callback into a business record, so an approved case could not move an indent. The same chain mechanism will serve PO approval (by value slab) and stock adjustments.
- **Numbering (as built):** given on first submission, so drafts leave no gaps. The project code comes from Post Sales → Setup → Project.
- **Locking:** once submitted, an indent and its items cannot be edited; only the database functions can move it through approve / reject / short close.
- **Status:** Draft → Approved → (RFQ raised) → Partly ordered → Ordered → Closed / **Short closed**.
- **Indent short closure:** closes the unordered balance of selected lines with a reason; the lines drop out of "pending to order".
- **Two sections (as built):** the Indents tab has **Create an indent** (the register: Drafts / Awaiting approval / Awaiting my approval / Approved / Closed, plus *New indent*) and **Revise an indent**. Revise lists **only rejected indents**, each with who rejected it, at which level, when and why; the person who raised it (or a super admin) corrects it with **Revise…** and sends it for approval again - a new submission round, the earlier decisions stay in Approval History. **An approved indent is never edited**; what is no longer needed is short closed. A rejected indent leaves the Create list and returns to it once resubmitted.
- **No attachments:** the indent has no Attachment tab or upload (Main Info, Delivery Info, Change History, Approval History only). The old `indent_attachments` table is left in the database, unused.
- **Items by unique code:** an item's code is unique across the module (automatic like `CEM-0001`, or typed in Setup → Items; the database refuses a duplicate). On an indent line you type or pick the **code**; the description, HSN and unit fill in from the item. Only active registered items are accepted, and the same code cannot be on an indent twice. Route: `inventory/2/create`, `inventory/2/revise`.

---

## 4. RFQ and quotation (Stage 4)
**As built (Stage 4):** an RFQ is for **one project** and is made from the open (approved, not yet ordered) lines of that project's approved indents; the same item on several indents is quoted once, and the RFQ remembers which indent lines it covers. Only **approved vendors** can be invited. The RFQ is numbered `<PROJ>/RFQ/<FY>/<serial>` when sent. Every quotation save is a new **revision** (nothing is overwritten); a vendor may quote in a different unit than requested (flagged for the comparison). Purchase can enter or revise a quotation for a vendor at any time while the RFQ is open or closed; vendors can only quote while it is open and before the last date. The vendor's no-sign-in page (`vendor-quote.html`) and the emailing are written but not live until the Supabase edge-function limit is resolved.

**Business unit in the RFQ (as built):** an RFQ's "business unit" is its **project**. Creating an RFQ starts with choosing the business unit; the screen then lists that unit's earlier (approved) indents, one row per item still open, with the columns **Indent No, Date, Group and Item** (plus the open balance, the quantity to quote, and any RFQ the item is already in). Rows can be searched by indent no, date, group or item, and the ticks survive searching. The RFQ list and detail say "Business unit" instead of "Project". An RFQ still covers a single business unit (a legal entity spanning several projects was considered and not chosen).

### 4.1 RFQ
- Created from one or more approved indents (lines picked); a due date for quotes; common terms asked.
- **Vendors picked** from approved vendors (suggested by item group).
- **On sending**, each vendor contact is **emailed automatically** (reusing the Gmail-based edge-function pattern) with a link.

### 4.2 Vendor link — no sign-in
- Link carries an unguessable **token per vendor per RFQ**; opens a public page (like `feedback-fill.html`) showing the items and a quote form. Token expires at the due date (extendable) and only exposes that vendor's own quote.
- **Per line:** unit (UOM), rate, make, optionally GST%, remark. Vendor can quote "not quoting" per line.
- **Common to all items:** payment terms, delivery terms/period, warranty / guarantee, freight, price validity, other.
- Vendor can re-open and revise until the due date (each save kept as a revision).

### 4.3 Manual entry
Purchase can fill the same quotation form on behalf of a vendor (e.g. quote received by phone/email/PDF), with the source marked "entered by Purchase".

---

## 5. Comparison, counter-offer and PO (Stage 5)
**As built (Stage 5):** the RFQ detail has a **Comparison** tab - one column per vendor with each item's rate ranked **L1, L2, L3...** (ties share a rank; quotes in a different unit than requested are shown but not ranked), per-vendor totals, the lowest-on-every-item total, the vendors' **terms side by side heading by heading**, and the **last 3 PO rates** per item (from approved/closed POs made here). A **counter offer** goes to the vendors Purchase chooses (optional target rate per item + note); the vendor revises through the same link; every quotation revision is stamped with the round it answers, which feeds the **Bid history** tab. Ranking uses the basic rate or the rate including GST (Admin -> Rules; freight is stated in words so it is shown, not ranked). From the comparison Purchase gives each item to a vendor and one **draft PO per vendor** is created with the quoted rate / GST / make / terms. A PO is submitted through the project's **PO approver chain with value slabs** (Admin -> Approvers: each level starts at an order value); on submission the quantity is **reserved on the indent lines** (they can never be over-ordered); rejection, cancellation and amendment release it. Approved POs can be **amended** (kept as a revision, back through approval, only while nothing is received), **cancelled**, or **short closed** (optionally returning the quantity to the indents). Numbering `<PROJ>/PO/<FY>/<serial>`. Not built: PO PDF/print, emailing a PO to the vendor, direct POs without an RFQ.

### 5.1 Quotation comparison (auto, from 2+ quotes)
- **Item-wise grid:** vendors as columns, each rate ranked **L1, L2, L3…** (lowest first), with total per vendor and total if L1 is taken per item. Comparison is on rate with GST/freight shown separately so it is like-for-like **[?]**.
- **Terms comparison heading-wise** (payment, delivery, warranty…) side by side.
- **Last 3 PO rates** for each item (rate, vendor, date) shown beside the quotes.

### 5.2 Counter offer and bid history
- From the comparison, Purchase sends a **counter offer** to chosen vendors (e.g. a target rate per line) by email + the same link.
- Vendor revises rates through the link; **every round is stored** and a **bid history** (round-by-round rates per vendor per item) is visible in the comparison.

### 5.3 Purchase order
- Purchaser picks the vendor **per item or for the whole RFQ** (split POs per vendor created automatically) and proceeds to a **PO** carrying the agreed rates, quote terms, delivery location (warehouse), GST and HSN per line.
- PO numbering `<PROJ>/PO/26-27/0001`; goes through approval **[?]** (value-based approval levels).
- PO is tagged back to its indents; indent balance updates. Amendments create a new revision.
- **PO short closure:** closes the unreceived balance of selected lines with a reason.
- **Header fields (as built):** every purchase order shows **Business Unit** (the project), **Document Type**, **Document No**, **Document Date**, **Financial Year**, **Supplier** and **Parent Account Head**, in that order, on the order itself, on the edit form and as the first columns of the list. *Document Type* comes from a master on **Setup → PO types** (administrators; one type, "Purchase Order", is seeded) and is chosen when the orders are made from the RFQ comparison; it can be changed while the order is a draft or rejected (`po_types`, `pos.po_type_id`, migration `20261004450000_purchase_po_types.sql`). *Parent Account Head* is the supplier's **Ledger → Parent Description** on the Vendors tab, read live from the vendor (shown as "—" if the vendor has none). Business Unit and Supplier are the old Project and Vendor under their new names.
- **Two sections (as built):** the Purchase orders tab has **Purchase orders** (the register and approval flow: Drafts / Awaiting approval / Awaiting my approval / Approved / Closed / Cancelled) and **Revise a purchase order**. Revise lists, with a *state* and a *reason* column: **rejected** orders (who rejected, level, date, why) to correct and send for approval again; orders **reopened by an amendment** (*Revision N in draft*, with the amendment reason) to finish and send; and **approved orders that nothing has been received against or short closed**, which can be **amended** (the current version is kept in the Revisions tab, the order goes back to a draft as the next revision, and is approved again). Rejected and amendment-draft orders leave the register while they are being revised. An order with goods received can no longer be amended - short close what is not needed. Routes `inventory/4/orders`, `inventory/4/revise`.

---

## 6. Stores (Stage 6)
**As built (Stage 6):** the **Stores** tab holds GRN, Returns to vendor, Issues, Issue returns, Adjustments and Transfers; **Stock ledger** shows current stock and every movement. Stock is held in the item's **stock UOM** (its issue UOM when it has one) and valued at the **weighted-average basic rate**; the ledger is append-only and stock can never go negative. A **GRN** is entered against an approved PO (partial deliveries; received = accepted + rejected, a reason is required for rejected quantity; over-receipt up to the **tolerance rule**, default 0%); posting puts the accepted quantity into stock and onto the PO (a posted GRN is never edited - a **return to vendor** corrects it and puts the quantity back on the PO). **Issues** must say what the material is for and cannot exceed stock; an **issue return** brings unused material back at its issue cost. **Adjustments** (physical count / damage / other) go through the project's adjustment approver chain (value slabs) and post on final approval; the person who raised one cannot approve it. **Transfers**: same legal entity = pure transfer, via "in transit" (rule `transfer.in_transit`, shortfall on receipt goes back to the sender); different legal entities = two linked approved adjustments posted at once and **flagged for Accounts**. Not built: stock reports (summary / ageing - Stage 9), batch tracking, GRN print, linking a return to a debit note (Stage 7).

### 6.1 GRN
- Created against an **approved PO** (partial deliveries allowed; over-receipt blocked or tolerance **[?]**). Fields: warehouse, challan/invoice no. and date, vehicle, received by, qty received/accepted/rejected per line.
- Posts stock **in** the warehouse at accepted qty; weighted-average cost kept per item per warehouse.

### 6.2 Return to vendor
Against a GRN (quality or other) with reason; stock out, and an optional linked debit note (§7).

### 6.3 Issue and issue return
- **Issue** from a warehouse to a purpose (project / block / activity / requested by); blocked when stock is insufficient.
- **Issue return** back to the warehouse against an issue.

### 6.4 Stock adjustment
Increase / decrease entries for physical stock-taking differences and damage, with mandatory reason and approval **[?]**.

### 6.5 Inter-site transfer
- **Same legal entity:** a pure transfer (out of A, in at B, through a "in transit" state **[?]**).
- **Different legal entity:** automatically routed through **simultaneous stock-adjustment decrease at the sending site and increase at the receiving site**, linked to each other, flagged for Accounts.

---

## 7. Bill booking and debit notes (Stage 7)
**Status: no screen at present.** The "Accounts payable" tab was removed from the Inventory page at the user's request (it overstated what was built - bill booking, not payments or ledgers). Everything below is still in the database and in `purchase-bills.js` (route `inventory/7/...`, no longer loaded by `nexus-core.js` or `inventory.html`); Admin → Approvers (Non-store / Work orders rows), Setup → Expense heads, the billing rules and the `bill.book` / `nonstore.purchase` permissions are still there. To bring it back: re-add the tab name to `VIEWS.inventory`, the `ti` dispatch to `pusPayableRender`, and the script to `PAGE_EXTRA_SCRIPT` and `inventory.html`.
**As built (Stages 7 and 8):** the former **Accounts payable** tab had four sections - **Bills**, **Awaiting bill**, **Non-store & services** and **Debit notes**. A bill is one of three kinds: **goods** (against posted GRN lines of a PO), **non-store** (against an approved non-store purchase order) or **service** (against an approved service work order, or **direct** with no order). A draft bill is saved first and then **booked**; booking checks everything again and gives the bill a number (`<PROJ>/BILL/<FY>/<serial>`) and the status **Ready to post** (Accounts later sets Posted / On hold - those columns exist, the Accounts side is not built).
- **3-way match:** a goods-bill line can never exceed *accepted - returned - already billed* on its GRN line; the PO rate is the "agreed rate" shown beside the invoice rate. A rate above the agreed rate needs a **reason** (default) or is **blocked**, with an optional **tolerance %** (rules `billing.rate_variance`, `billing.rate_tolerance_pct`). A rate below it is always fine. Bills of other kinds are limited the same way against the order's quantity.
- Duplicate **vendor invoice numbers** are refused (per vendor, ignoring case, cancelled bills excluded). The invoice date cannot be in the future. GST is chosen as **within the state (CGST + SGST)** or **inter-state (IGST)**; **other charges** (freight etc.) carry their own GST rate. **TDS** is captured only when the rule `billing.capture_tds` is on and is taken off the amount payable.
- A **booked bill cannot be edited** - cancel it (a reason is needed; its quantities become billable again) and enter it afresh. A bill Accounts has posted cannot be cancelled here.
- **Debit notes** are raised on a booked bill and reduce its payable amount; together they can never exceed the bill. **Quantity** (per line, up to what is left on the line; optional link to a return to vendor), **rate** (per line: the agreed rate, below the invoice rate, applied to the quantity still on the bill; once per line) and **amount** (a lump sum with its own GST rate). Cancelling a debit note restores everything it changed. Numbers `<PROJ>/DN/<FY>/<serial>`.
- Permissions: `bill.book` for goods bills and their debit notes; `nonstore.purchase` for everything in §8. Drafts can only be changed by the person who entered them.
- Tables / functions: `bills`, `bill_lines`, `debit_notes`, `debit_note_lines`; `bill_save / bill_book / bill_delete / bill_cancel`, `debit_note_create / debit_note_cancel`. Migration `20261004370000_purchase_bills_orders.sql`. Not built: bill print, bank/payment tracking, a TDS section/threshold master, matching a bill to several POs.

- **Bill booking against a GRN** linked to a PO: vendor invoice no./date, taxable value, GST split, TDS **[?]**; 3-way match (PO ↔ GRN ↔ invoice) with variance shown; cannot bill beyond received qty.
- **Debit note**, three kinds: **quantity based** (returns/shortage), **rate based** (rate difference), **amount based** (lump sum). Linked to the bill/GRN.
- Both carry a "ready to post" status for Accounts.

---

## 8. Non-store purchase and services (Stage 8)
**As built:** both live in **Accounts payable → Non-store & services** as one kind of document, an **expense order** (`expense_orders`, kind *non-store purchase* or *service work order*): project, approved vendor (a service order needs a vendor enlisted as *service* or *both*), expense head (new master on **Setup → Expense heads**), subject, scope, payment terms and lines (description, **HSN / SAC mandatory** - 4, 6 or 8 digits, qty, unit, rate, GST). It is submitted through the project's approver chain - **Admin → Approvers** now has **Non-store** and **Work orders** rows next to Indents / Purchase orders / Adjustments, each with value slabs; self-approval follows the `po.allow_self_approval` rule. Numbers `<PROJ>/NSP/<FY>/<serial>` and `<PROJ>/WO/<FY>/<serial>`. Once approved, bills are booked against it (up to its quantity, in parts); it can be **closed** (nothing more billed) or **cancelled** (only if nothing is billed). A **direct service bill** needs no order. Contractor services stay with the Engineering module. Not built: print, amending an approved order, advance payments.
- **Non-store purchase:** expenditure that does not go into stores (no stock effect): vendor, expense head, lines, GST, HSN, approval, then bill booking.
- **Services (not contractors):** either **against a Work Order** (service WO → bill) or **directly via service bill booking**. **HSN/SAC is mandatory** in both.

---

## 9. Reports (Stage 9)
**As built:** the **Stock ledger** tab is now **Stock & reports** (permission `report.view`; Administrators always have it). Besides *Current stock* and *Movements* it has three reports, each with filters and **Download CSV**: **Stock summary** (as on a date; project, warehouse and item group - a group includes the groups inside it; subtotal per warehouse), **Item stock ledger** (one item, one or all warehouses, from / to date: opening, receipts, issues, returns, adjustments, transfers, closing, then every movement with a running quantity and value) and **Stock ageing** (0-30 / 31-60 / 61-90 / 91-180 / over 180 days, quantity or value; stock is held at weighted-average cost so ageing assumes first-in-first-out - what is left is counted against the newest receipts). "As on a date" is computed from the signed movements dated on or before it, so back-dated documents are handled. Functions `report_stock_summary / report_item_ledger / report_stock_ageing` (migration `20261004390000_purchase_reports.sql`). Not built: pending indents / pending POs / vendor-wise purchases / payables ageing.

- **Stock summary** (by warehouse/project/group, as on a date, qty and value).
- **Stock ledger**, item-wise (opening, receipts, issues, returns, adjustments, transfers, closing, with running balance).
- **Stock ageing** (buckets by age of receipt).
- Later candidates: pending indents, pending POs, vendor-wise purchases (feeds Vendor Trends).

---

## Technical notes
- **Schema:** new `purchase` schema; money in `numeric(14,2)`; soft-delete (`deleted_at/by`) as in `postsales`; document numbers per project/financial year from a counter table; audit columns `created_by/updated_by` via `app.current_user_email()`; RLS in the same style as `postsales`, with the initplan fix applied from the start.
- **Stock ledger** is an append-only table (one row per movement, signed qty and value); stock summary/ageing are queries over it, so every document just posts rows.
- **Vendor link:** SECURITY DEFINER RPCs keyed by token (no table access for anon); RFQ email through a new edge function modelled on `receive-reminder-mailer`.
- **Frontend:** `purchase.js` (setup, indent, RFQ, comparison, PO) and `stores.js` (GRN, issue, adjust, transfer, billing, reports) via `PAGE_EXTRA_SCRIPT`; vendor quote page `vendor-quote.html` + `.js`.
- **Usability tracking keys** added for each new tab, as the existing pages do.
- **Edit / delete while awaiting approval (as built):** the maker of an **indent, purchase order or stock adjustment** (and, in the dormant screens, an expense order) can **Edit** or **Delete** it for as long as its status is *awaiting approval*; a super admin may do the same. Once the document is **approved** neither is possible (an approved PO can only be *Amended* while untouched, or *Cancelled*; an approved indent is short closed; a posted adjustment stands). *Edit* is a **pull-back**: `*_withdraw` returns the document to *draft* (same number, same revision, the unfinished approval steps are removed, the PO's hold on the indent quantity is released), the maker corrects it and **Save & send for approval again** starts a new approval round at level 1 - approvals already given do not carry over. *Cancel* in the edit form leaves the document as it was. **Delete** is a soft delete, written to the change history; it releases a PO's hold on the indent quantity. A purchase order that has been amended (revision > 0) cannot be deleted - only cancelled. Functions: `indent_withdraw/indent_delete`, `po_withdraw/po_delete`, `adjustment_withdraw/adjustment_delete`, `eo_withdraw/eo_delete` (migration `20261005180000_purchase_pending_edit_delete`). Each refuses anyone but the maker (or a super admin) and any status other than awaiting approval, so if the final approval lands first the document is approved and the pull-back is refused.
- **Detail dialogs:** a wide dialog (`.modal.xl`) keeps **one width on every tab** (`min(1120px, 100vw - 40px)`) and a minimum height, and the tab strip is one row that scrolls sideways on a narrow screen. Previously the dialog took the width of the current tab's content, so *Change History* shrank it, the strip wrapped and *Approval History* dropped out of reach. The rules live in `piCss()` (`purchase-indent.js`) and apply to indent, RFQ, PO, stores and order dialogs.
- **Confirmation boxes:** the shared `confirmDialog` shows a red **Delete** button unless the caller passes `{title, okLabel, danger}`. Every non-delete confirmation in the module therefore passes its own label (Send RFQ → **Send**, Close quotations, Post goods receipt → **Post receipt**, Approve anyway, Remove, …).

## Administration (as built)
The **Admin** tab is visible only to the module administrators (Administrator, Prerna, Vivky; the list itself is editable there). It holds:
- **Approvers** - the per-project approval chain (levels; any one person per level).
- **Roles** - permissions are a fixed catalogue; roles are bundles of them (Purchase manager, Purchase officer, Store keeper, Site engineer, Accounts, Viewer, plus custom ones); people hold one or more roles. Everyone on staff can **read**; writes need the matching permission. Administrators always can. A switch (`roles.enforce`) turns enforcement off. Permissions for stages not yet built are stored and take effect when those stages arrive.
- **Rules** - the module's decisions as settings (self-approval, required-by date, vendor documents before approval, re-approval on change, quote ranking basis, over-receipt tolerance, in-transit transfers, and for billing: TDS capture, what happens when the invoice rate is above the agreed rate, and a tolerance %).
- **Administrators** - the list of module administrators. (Warehouses and Legal entities now live on the Setup tab; everyone on staff can see them, only administrators can change them.)
All of it is enforced in the database (row-level security and the functions), not only by hiding screens.

## Open questions
1. **Nested item groups?** Default: yes, unlimited depth.
2. **Stock UOM for dual-UOM items.** Default: the issue UOM.
3. **Legal entity** per project: does it exist anywhere in JainE? Default: add a `legal_entity` master and tag each project.
4. **Approvals** (indent, PO, adjustment): use the existing workflow engine (`wf_*`) with approver chains per project? Default: yes, PO approval by value slab.
5. **Comparison basis:** rank on basic rate; show GST/freight/total alongside. OK?
6. **Over-receipt** against a PO: block, or allow within a % tolerance? Default: block.
7. **Inter-site transfer** same entity: direct, or with an in-transit stage? Default: in-transit (out at A, received at B).
8. **TDS / retention** on bill booking: needed now or left to Accounts? Default: left to Accounts.
9. **Stage order.** Default: 1 → 9 as above; Stage 4's email/link piece is the riskiest and could be built earlier.
