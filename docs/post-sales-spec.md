# JNE Post Sales Module — Specification

Status: agreed with Ayush Ruia, 01-Oct-2026. Build order: Post Sales → Engineering → Purchase & Stores → Property Maintenance → Accounts.
Sales invoices, receipts, refunds and transfers produced here are later posted to Accounts; every money document carries a "ready to post" status and a slot for its accounting entry.

Post Sales extends the existing Customer Portal (`cust.*`) instead of replacing it. Farvision CSV imports keep working until JainE becomes the system of record.

---

## 1. Setup (Stage 1)

### 1.1 Hierarchy
**Project → Towers → Floors → Flats.**

- **Project:** links to the existing `cust.projects` row. Each project gets a short **project code** (e.g. `DG`) that's used in document numbers.
- **Tower:** each tower has its **own layout**:
  - number of floors and the first floor number
  - flat positions per floor (A, B, C… any number)
  - the typical BHK and areas for each position
- **Floor and flat generation:** floors and flats are generated from the layout. Flat code = floor + position (e.g. `1C`), shown with its tower (e.g. `Block A1 - 1C`).
- **Flat areas:** each flat holds super built-up, built-up and carpet area, copied from its position and editable per flat.
- **Flat status:** Available / Booked / Registered / Possession / Blocked.

### 1.2 Pricing basis
- **Area basis:** all per-sq-ft rates use **super built-up area (SBA)**.
- **List rate:** each tower has a list base rate per sq ft. It's used in the availability report; the actual rate is entered at booking.

### 1.3 PLC — Preferred Location Charges
- **PLC types:** set up per project, each with a fixed **rate per sq ft** and a GST rate (default 5%). Examples: South Facing, Garden Facing.
- **Assigned by position:** PLC types are attached to a **flat position within a tower**. Tagging position C as South Facing + Garden Facing applies both to every C flat on every floor of that tower.
- **Multiple PLCs stack:** total PLC = sum of the rates × SBA.
- **No per-flat overrides.**

### 1.4 FRC — Floor Rise Charges
- **Set per tower:** an FRC **rate per sq ft per floor** and a **starting floor**.
- **Formula:** FRC rate for floor `f` = `max(0, f − start + 1) × rate`. For example, ₹20 from the 3rd floor gives 3rd = ₹20, 4th = ₹40, 5th = ₹60.
- **Amount and GST:** FRC amount = FRC rate × SBA. GST defaults to 5%.

### 1.5 Other charges (EDC, deposits, etc.)
- **Charge list:** set up per project. Each charge has a basis: **per sq ft** (× SBA), **fixed** amount, or **% of unit price**. Each charge also has a GST rate.
- **Typical charges:** Club Membership, Electricity, Generator, Legal Documentation, Maintenance Deposit, Advance Maintenance, Association Formation. These come from the Farvision cost sheets already in the portal.
- **Group:** each charge is marked **EDC** (split across milestones like the unit price) or **Other**.

### 1.6 Car parking
- **Parking types:** set up per project (Open, Covered, …), each with a price and GST rate.
- **No slot allotment:** a booking chooses a type and a count, and parking is only a charge on the cost sheet.

### 1.7 GST defaults
- Unit price: 5%
- PLC / FRC / parking: 5%
- EDC: 18%

Every rate is editable in setup.

### 1.8 Payment plans
**Plans:** 3–4 **standard plans** per project. Each plan is an ordered list of milestones.

**Each milestone holds:**
- **Name:** e.g. "On Commencement of Foundation".
- **Trigger type:**
  - **Individual:** raised for one booking. Can be due automatically N days after booking (e.g. "within 30 days of booking").
  - **Tower level:** raised in bulk for every booked flat in a tower when the stage is done (foundation, Nth floor casting/slab, roof).
  - **Floor level:** raised in bulk for every booked flat on that floor when the work is done (brickwork, flooring, POP).
- **Amounts:**
  - % of unit value (unit + PLC + FRC)
  - % of EDC
  - % of parking
  - or a **fixed amount** (booking amount)
- **"Less booking amount" flag:** e.g. "10% of flat value less booking amount".

**Totals check:** the percentages must add to 100% for unit, EDC and parking.

### 1.9 Rate locking
- **Snapshot at booking:** PLC rates, FRC rate, charges, GST rates and the plan are copied onto the booking.
- **Later changes:** rate changes only affect flats booked afterwards.

---

## 2. Booking (Stage 2)

### Applicants
**One or more per booking**, in order. Each applicant has:
- Title, name, relation (S/o, D/o, W/o, C/o) + relation name
- Date of birth, nationality, PAN, passport
- Spouse, marriage anniversary
- Occupation (Salaried / Business), profession, company, designation, gross income (optional)
- Mobile, phone (residence), phone (office), email
- Residential address and office address, with mailing and permanent address each chosen from them
- NRI bank details
- KYC uploads (PAN, Aadhaar, other ID)

Marketing fields from the paper form are dropped. Only the **1st applicant** gets a Customer Portal login.

### Booking details
- **Flat:** picked from Available flats; tower, floor and BHK fill in automatically.
- **Pricing inputs:** booking rate per sq ft, parking type and count, discount (per sq ft **or** lump sum, no approval).
- **Other details:** purpose (Residential/Investment), loan required + preferred bank, source and why they chose the project, sales person / booking agent, CRM Lead ID, booking date, attachments.

### Cost sheet
Generated automatically:

| Line | Calculation |
|---|---|
| Unit price | Rate × SBA |
| PLC | Sum of PLC rates × SBA |
| FRC | FRC rate × SBA |
| Parking | Price × count |
| Charges | Per §1.5 |
| Discount | Minus discount |
| GST | Per line, at its rate |
| Total | |

It prints as the **Estimated Offer Price** (same layout as the current form): unit charges, EDC table, and a payment schedule with **Unit / Parking / EDC / Gross** columns.

### Payment plan
- **Choice:** pick one of the standard plans.
- **Non-standard:** any edit (milestone, %, amount, due rule) marks the plan **Non-standard**. No approval is needed.

---

## 3. Money Received (Stage 3)

**Fields** (same as Farvision receipts):
- Booking/flat, receipt no. and date
- Mode: Net Banking, Cheque, DD, RTGS/NEFT/IMPS, UPI, Cash, JV
- Instrument no. and date, drawn-on bank and branch
- Deposit bank (company bank account list)
- Amount, narration, paid by (which applicant), attachment

**Rules:**
- **Numbering:** per project per financial year: `<CODE>/MR/<FY>/<0001>`, e.g. `DG/MR/26-27/0001`.
- **Split:** automatic, against the **oldest unpaid dues first**, broken down by demand and revenue head.
- **Advance:** money received before any demand exists is held as **advance against booking** and applied automatically when demands are raised.
- **Interest:** receipts always go to **principal**. They go to interest only when the user ticks "Against interest" (customer consent recorded).
- **No verification:** the receipt is live on the Customer Portal immediately.
- **Reversal/bounce:** recorded with reason, number and date; the amount goes back to outstanding. An optional Cheque Dishonoured Charge can be raised.

---

## 4. Invoicing / Demands (Stage 4)

- **Individual milestones:** raised from the booking, or automatically on their due rule date.
- **Tower-level milestones:**
  1. Mark the stage complete for a tower (stage + date).
  2. Preview every booked flat in the tower with its amount from its own plan.
  3. Deselect any flat if needed.
  4. Raise in bulk.
- **Floor-level milestones:** same flow, for one floor of one tower.
- **Late bookings:** a flat booked after some stages are complete gets **all completed milestones invoiced together at booking**.
- **Due date:** invoice date + **30 days**.
- **Numbering:** `<CODE>/INV/<FY>/<0001>`.
- **After raising:** the invoice is visible on the portal immediately, and any advance is applied to it.
- **Construction progress:** stage completion is recorded per tower and floor. The Engineering module will later mark stages complete.

---

## 5. Interest on late payment (Stage 5)

- **Rate:** 18% per year, simple interest, on the unpaid part of each invoice from day 31 after the invoice date, for the days it stays unpaid.
- **Accrued only:** interest is calculated and shown on screen; it isn't on the customer's ledger.
- **Interest invoice:** suggested once the overdue payment is received. The user **approves** (raises), edits or waives it.
  - An approved interest invoice carries **18% GST**.
  - This is the only approval step in Post Sales. Approver to be named.
- **Waivers:** reducing or waiving interest needs no approval; the reason, user and date are recorded.

## 6. Cancellation (Stage 5)

**Charge:**

| When cancelled | Charge |
|---|---|
| Within 15 days of application | ₹50,000 + 18% GST |
| After 15 days | 10% of **total consideration incl. EDC, excl. GST** + 18% GST |

**Settlement:**
- **Calculation:** received − charge − any billed interest.
- **Positive balance:** refund, payable in parts and recorded with mode/UTR.
- **Negative balance:** a recoverable cancellation charge invoice to the customer.
- **Waivers:** the charge can be reduced or waived with no approval; the reason is recorded.

**On cancellation:**
- The booking is marked Cancelled and its unpaid invoices are cancelled.
- The flat goes back to Available.
- History is kept and shown on the portal.

## 7. Flat transfer, same customer (Stage 5)

- **Start:** from the old booking, choose the new flat. A new booking opens with the same applicants and a new cost sheet and plan.
- **Original booking date kept:** the 15-day rule and late-booking invoicing count from it. Catch-up invoices are due 30 days from the transfer date.
- **No transfer charge.**
- **Interest:** must be settled or waived first. Settled interest + GST may be deducted, and the **balance** moves.
- **Transfer document:** `<CODE>/PTC/<FY>/<0001>` debits the old flat and credits the new one. The amount is applied to the new flat's oldest dues; the rest stays as advance.
- **Old booking:** marked "Transferred" and its flat goes back to Available. The two bookings are linked to each other.
- **Out of scope:** transfer to a different person (nomination).

---

## 8. Reports (Stage 6)

Anyone with Post Sales access can see these. Filters: project / tower / date. Excel and PDF export.

1. **Applicant Ledger:** all entries by date with a running balance, split into not due / due / overdue.
2. **Flat Availability:** floor × position grid coloured by status, a list with today's price, and counts and area per tower and BHK.
3. **Customer Outstanding with Interest:** invoiced, received, outstanding, overdue, days overdue, interest accrued @18%, interest billed and received, total due. No ageing buckets.
4. **Collection Report:** receipts by date, mode, bank, project and tower.
5. **Demand vs Collection:** per milestone.
6. **Cancellation / Refund Register.**
7. **Sales / Booking Register.**

## 9. Data migration (Stage 7)

- **Projects:** existing Farvision projects get a project code.
- **Towers and flats:** created from the existing `cust.units` tower text and unit codes (floor = leading digits, position = the rest).
- **Bookings:** existing bookings link to their flats, so the portal keeps working.
- **Applicants:** imported contacts become the first applicant records.

---

## Technical notes

- **New tables:** in the existing `postsales` schema. Stage 1 doesn't change any `cust.*` table the live portal reads.
- **Bookings vs flats:** a `cust.units` row is really one *booking* of a flat; cancelled bookings repeat the same flat. Physical flats live in `postsales.flats`, and bookings link to them in Stage 2/7.
- **Access:** staff in Sales / CP Sales / Post Sales / Accounts / Systems / Management (`app.is_custportal_staff()`) can write. Customer sessions are blocked.
- **UI:** a new **Setup** tab in Post Sales, rendered by `postsales.js`.
