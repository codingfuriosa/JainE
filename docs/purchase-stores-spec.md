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
- **Multiple warehouses per project**, each with name, code and (optional) in-charge. A project belongs to a **legal entity / company**; this drives the transfer rule in §6.5. **[?]** whether the legal entity already exists anywhere in JainE.

---

## 2. Vendor enlistment (Stage 2)
- **Vendor master:** legal name, trade name, type (supplier / service provider / both), PAN, GSTIN, MSME, address, contacts (several, with email for RFQs), bank details, item groups supplied, payment terms default.
- **Enlistment flow:** vendor is added by Purchase, or self-registers through a tokenised link; Purchase verifies and marks **Approved**. Only approved vendors can receive an RFQ or a PO.
- Documents (PAN, GST certificate, cancelled cheque) uploaded to the existing S3 store.

---

## 3. Indent (Stage 3)
- **Indent:** project, warehouse/site, required-by date, lines (item, qty in receipt UOM, remark), raised by.
- Document number per project: `<PROJ>/IND/26-27/0001`.
- Goes through the existing workflow/approval engine **[?]** (approver chain per project).
- **Status:** Draft → Approved → (RFQ raised) → Partly ordered → Ordered → Closed / **Short closed**.
- **Indent short closure:** closes the unordered balance of selected lines with a reason; the lines drop out of "pending to order".

---

## 4. RFQ and quotation (Stage 4)

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

---

## 6. Stores (Stage 6)

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
- **Bill booking against a GRN** linked to a PO: vendor invoice no./date, taxable value, GST split, TDS **[?]**; 3-way match (PO ↔ GRN ↔ invoice) with variance shown; cannot bill beyond received qty.
- **Debit note**, three kinds: **quantity based** (returns/shortage), **rate based** (rate difference), **amount based** (lump sum). Linked to the bill/GRN.
- Both carry a "ready to post" status for Accounts.

---

## 8. Non-store purchase and services (Stage 8)
- **Non-store purchase:** expenditure that does not go into stores (no stock effect): vendor, expense head, lines, GST, HSN, approval, then bill booking.
- **Services (not contractors):** either **against a Work Order** (service WO → bill) or **directly via service bill booking**. **HSN/SAC is mandatory** in both.

---

## 9. Reports (Stage 9)
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
