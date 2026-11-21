# Reckoner — implementation plan (for approval)

21 Nov 2026 · prepared from: the requirements note, `Reckoner Jain Group.xlsx` (13 sheets), and the JAIN-E code and database as they are today.

---

## 1. What I found

### The workbook
13 sheets, about 22,000 characters of free text in all, plus 19 images. Unit-level data appears only as Dream One's per-floor rows and short availability notes.

| Sheet | Reckoner project | Notes |
|---|---|---|
| Dream Ananta | Dream Ananta | 460 apts, 5.12 acres, B+G+8, prices 64 L–1.20 Cr incl. EDC & GST, RERA Dec 2032 / handover Dec 2030 |
| New Project (Madhyamgram) | **? same as Ananta** | titled "Ananta" but says 296 apts, 5.5 acres, G+8, 62 L / 68 L / 1.14 Cr excl. parking — **conflicts with the Ananta sheet** |
| Dream World City (Joka) | Dream World City | ready; 1/2/3 BHK; full landmark list (schools, hospitals, dining, shopping) with minutes; one stray cell "erfgb", a loose "72 lakhs" |
| Dream Gurukul (Madhyamgram) | Dream Gurukul | possession Oct 2028; base rate 5399 marked **"Do not pitch"**; also carries Ananta 4 BHK prices (1.26–1.36 Cr — differs from Ananta sheet's 1.20 Cr) |
| Dream One (New Town) | Dream One | only sheet with **unit-level rows** (sizes, floors, prices); "Amenities" cell holds a 4 BHK price instead |
| Dream Diamond Banglows JOKA | Dream Diamond (Farvision: "DREAM DIAMOND.") | bungalows; location given twice (5 and 10 mins from metro) |
| Dream Palazo | **? same as DREAM PALAZZO** | one unit: 1C, Tower 2 (Milan), 1385 sqft, ₹4,500/sqft, ≈ ₹82.57 L |
| DREAM PALAZZO | Dream Palazzo | "only 01 3 BHK available 1385 sqft 1st floor, 82.57 L" — **matches Dream Palazo's unit 1C** |
| Dream Exotica Madhyamgram | Dream Exotica | 1 RK / 2 / 3 BHK, rate 3900 |
| Dream Valley Siliguri | Dream Valley | stray number "45609" and note "4bhk cant say", "transformer charges edc not added" |
| DREAM RESIDENCY MANOR Rajarhat | Dream Residency Manor | several fields only "Sales Manager will guide" |
| Dream EcoCity Durgapur (Flats) | Dream EcoCity | configuration-wise floor availability |
| Dream Ecocity Durgapur (Bungalo… | Dream EcoCity Bungalow | under construction, handover 2028 |

**Not in the workbook but in Farvision:** Dream Jain-Pailan, Dream Gateway Pailan Projects, Dream Excellency, Dream One Studio, Durbaar Banquets (marketing). They get profiles with "Not Available" until data is entered.

### JAIN-E today
- **Projects:** Farvision's `cust.projects` (15 real projects, used by Post Sales / Customer Portal) and `cust.units` (Farvision units with booking status). There is also an old demo table `proj.projects` with three made-up Mumbai projects — Reckoner will **not** use it.
- **Access:** menu entries come from `adm.users.modules`; super admins see all; the database checks `app.has_module(...)` and `app.is_superadmin()`. Per-module edit roles exist only for a few older modules (`app.module_role`).
- **Files:** private S3 through the `s3-sign` function with a database access rule (`app.s3_key_allowed`).
- **Pages:** one shared front end (`src/core/*.js`, built by `tools/build.mjs`), one HTML page per module.
- **Rule:** database changes run after 20:00 IST.

---

## 2. Proposed design

### Where it lives
- New menu entry **Reckoner** (Sales group), page `reckoner.html`, code `src/core/60-reckoner*.js`, module id `reckoner`.
- New database schema **`rk`** (added to the API's exposed schemas), so it stays separate from every other module.
- Each Reckoner project links to Farvision's `cust.projects` row where one exists (for inventory, see below), but Reckoner's own data never overwrites Farvision's.

### Tables (UUID keys, all linked by `project_id`)
| Table | Holds |
|---|---|
| `rk.projects` | overview fields (name, code, category, status, stage, land area, towers, height, units, open space, launch, possession, RERA no., description), Farvision link, archived flag |
| `rk.project_locations` | address, maps link, lat/long |
| `rk.configurations` | per configuration: name, type, bedrooms, baths, balconies, SBA / BA / carpet, area range, floors, facing, room sizes, features, remarks, floor-plan file |
| `rk.charges` | each price component: name, kind (base rate, EDC, GST, parking, FRC, PLC, club, maintenance, registration, other), amount or rate, per (sqft / unit / %), applies to (project / configuration / unit), included-in-base, included-in-final, GST incl./excl., indicative/confirmed, effective / valid-until |
| `rk.payment_plans`, `rk.offers` | payment plan stages; offers and discounts with validity |
| `rk.units` | unit no., tower, floor, configuration, area, facing, view, base / quoted price, status (Available / On Hold / Booked / Sold / Blocked / Under Verification), booking date, remarks |
| `rk.unit_status_history` | every status change |
| `rk.amenities` | name, category (the 8 given), description, status, location, image |
| `rk.landmarks` | name, category, distance (km), travel time (min) — kept separate — verification date, remarks |
| `rk.sales_notes` | USPs, selling points, target customer, differentiators, booking procedure, FAQs, guidelines, **do-not-promise**; each marked **customer-facing** or **internal** |
| `rk.bank_approvals` | bank, status, reference |
| `rk.documents` | category, title, version, file (S3), visibility, uploaded by/at |
| `rk.assignments` | project ↔ person: project manager / sales executive / project admin |
| `rk.roles` | person → Reckoner role |
| `rk.changes` | **every** proposed change: table, record, field, old value, new value, reason, source document, by, at, status (pending / approved / rejected), reviewer, reviewed at, review remarks — this is also the **audit log** (no update / delete for anyone but the approve/reject function) |

**Every record table also carries:** verification status (Verified / Pending Verification / Outdated / Rejected / Not Available), entered by, updated by/at, verified by/at, effective date, expiry date, source / reference, remarks.

### How approval works (no silent overwrites)
1. An editor's change goes to `rk.changes` as **pending**; the live record keeps its **last approved value**, and the screen shows a "change pending" marker next to it.
2. A reviewer approves → a database function writes the new value into the record and marks it Verified; or rejects → nothing changes.
3. **Pricing, possession and inventory always need approval.** For other fields too, by default (simplest and safest) — can be relaxed later.
4. Customer-facing views and exports show **only Verified, in-date** values; anything else is labelled Pending Verification / Outdated / Not Available / Not Applicable. Missing is never shown as 0.

### Roles (enforced in the database with Row Level Security, not just hidden on screen)
| Role | Can |
|---|---|
| Super Admin (existing super admins) | everything |
| Project Admin | manage assigned projects, propose any change, approve for them |
| Sales Head | view all incl. internal, **approve** |
| Project Manager | propose changes for assigned projects |
| Sales Executive / Pre-Sales | view approved information (customer-facing + internal sales guidance) |
| Post-Sales | view approved information and documents |

Menu access = module `reckoner`; the role comes from `rk.roles` (managed in the Admin screen).

### Screens
1. **Project Directory** — cards (name, location, category, status, stage, possession, configurations, last updated, verification badge + completeness %), search box and filters.
2. **Project Profile** — the same 8 tabs for every project, all from the database: Overview · Configurations · Pricing (component-wise breakdown with an automatic total where enough is approved) · Inventory (filters, last update time, Excel import/export) · Amenities · Location · Sales Info (customer-facing vs internal clearly split) · Documents. Copy buttons on key values.
3. **Comparison** — pick 2–4 projects; values straight from the database; missing / unverified flagged; export (PDF / Excel).
4. **Pending Verifications** — reviewers' queue: old vs new, approve / reject with remarks; overdue list.
5. **Admin** — projects, configurations, pricing, units (incl. bulk upload), amenities, landmarks, documents, roles and assignments, audit history.

### Migration from the workbook
- I'll prepare a **migration sheet** (Excel) mapping every cell to a Reckoner field, with a column "classification" (customer-facing / internal / junk) and "issue" (conflict, duplicate, unclear).
- After your team approves it, it's imported with every record set to **Pending Verification** and **source = sheet + cell**. Nothing is merged, corrected or invented; the original workbook is kept as a document on each project.
- **Questions I'll flag** (not decide): Palazo vs Palazzo; New Project vs Ananta; Ananta 4 BHK price (1.20 Cr vs 1.26–1.36 Cr); Diamond's metro distance; Gurukul's "Do not pitch" rate (→ internal); the stray cells.

### Inventory and Farvision
Farvision already tells JAIN-E which units are booked. Proposed: the Inventory tab shows Farvision-booked units as **Booked (from Farvision, <date>)** and never as Available; units Farvision doesn't know stay as entered and verified in Reckoner. *Needs your OK.*

---

## 3. Build order
| Step | What | Notes |
|---|---|---|
| 1 | Schema, roles, approval functions, audit log | database part runs after 20:00 IST |
| 2 | Directory + Profile (all 8 tabs, read) | uses whatever data exists; empty states everywhere |
| 3 | Editing via the Admin screen → pending changes → Pending Verifications queue | |
| 4 | Workbook migration sheet → your approval → import as Pending | |
| 5 | Search, Comparison + export | |
| 6 | Project PDF, price calculator, change notifications, completeness | |

Each step is usable on localhost before the next. Nothing is pushed until you say "push".

---

## 4. Decisions needed from you
1. **Who reviews/approves?** (names for Sales Head / Project Admin roles)
2. **Internal information:** should Sales Executives and Pre-Sales see internal sales guidance (e.g. "do not pitch base rate") — or only customer-facing?
3. **Farvision link for inventory** (above): yes / no.
4. **Palazo / Palazzo and New Project / Ananta:** same projects?
