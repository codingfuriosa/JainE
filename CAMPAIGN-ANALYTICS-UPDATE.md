# Campaign Analytics — what was added (31 July 2026)

> **Revision 2 (same day).** Best/Worst performer cards were **removed**. Trend and Ad Fatigue are
> now **their own full pages (tabs)** instead of cards. **Google Ads gained an Ads (ad-wise) page**,
> **Meta gained a Campaigns page with Active / Inactive filtering**, and the whole module was
> **redesigned** to a restrained, neutral look matching the sidebar. Details in section 7 below.


Everything below is **live and working**, not a placeholder. Each item says where to find it.
The page is at **Growth & Strategy → Campaign Analytics**, with the three source buttons at
the top: **Meta**, **Google Ads**, **Both**.

---

## 1. Google Ads "Budget" column (NEW — and it really works)

**The problem:** Google budgets were never being pulled from Google at all, so there was
nothing to show.

**What was done:** the Google sync now also asks Google Ads for each campaign's budget.
This was tested against your live account and returned real numbers, for example:

| Campaign | Budget |
|---|---|
| Dream World City \| Brand Search | ₹3,000 / day |
| Dream World City \| Location Search | ₹4,500 / day |
| New Project Near Airport – Location Search | ₹4,000 / day |
| Dream Diamond \| Competitor Search | ₹2,000 / day |

**Where you see it**
- **Google Ads → By account** → new **Daily Budget** column (total of that account's active campaigns)
- **Google Ads → Campaigns** → new **Daily Budget** column per campaign
- **Google Ads → Overview** → new **Daily Budget** KPI card
- **Both → By source** → Daily Budget for Meta, Google and the combined total

**Bonus — budget pacing.** Under each budget figure you also see **"x% used"**, i.e. how much of
that budget the spend has already eaten. If it goes over 100% the number turns **red**.

---

## 2. "Trend" everywhere (Meta, Google AND Both)

Every important number now carries a small coloured arrow showing whether it went **up or down
compared with the same length of time immediately before it**.

Examples of what it compares:

| You are viewing | It compares against |
|---|---|
| Today | Yesterday |
| Yesterday | The day before |
| Last 7 days | The 7 days before those |
| Last 14 days | The 14 days before those |
| Last month | The month before that |
| Last year | The year before that |
| A custom range (e.g. 10 days) | The 10 days immediately before it |

**Green = good, red = bad — and it understands cost.** Spend going up is red-ish for cost control;
but for **Cost per Lead / Cost per Conversion**, going *down* is shown as **green** (good), because
cheaper is better. Hovering any arrow explains it in words.

If there is genuinely no earlier data to compare with, it shows a plain **"—"** instead of a fake 0%.

**Where you see it**
- All three tabs: on the **KPI cards** at the top
- **Meta → By Project**: Spend trend, Leads trend, Cost/Lead trend
- **Meta → Ads**: per-ad Spend trend
- **Google → By account** and **→ Campaigns**: Spend trend and Cost/Conversion trend
- **Both → By source**: trend on Spend, Results, Cost/Result and CTR
- Also inside the pop-up windows when you click a project or an ad

---

## 3. ~~Best & Worst performers~~ — REMOVED in revision 2

These cards were taken out as requested. Their job (spotting what is doing well and what is
wasting money) is now done better by the **Trend** page, which shows every project/account moving
up or down side by side. See section 7.

---

## 4. Ad Fatigue — yes, Meta's API does support this

**Answer to your question: yes for Meta, partly for Google.**

- **Meta** provides a real **"frequency"** figure — the average number of times *each person* saw
  your ad. That is the proper fatigue signal, and it is now stored and shown per project and per ad.
- **Google Ads** does **not** publish per-person frequency for Search campaigns. So for Google the
  fatigue reading is based on **CTR falling while spend continues** — which is the honest available
  proxy, not a made-up number.

**How it is graded**

| Badge | Meaning |
|---|---|
| 🟢 **Fresh** | Nothing to worry about |
| 🟠 **Watch** | Being seen ~3× per person, or CTR slipping — keep an eye on it |
| 🔴 **High** | Seen 4×+ per person **and** CTR clearly falling → **refresh the creative** |

Hovering the badge tells you exactly why (e.g. *"Seen 4.3x per person · CTR down 38% — refresh the
creative"*).

**Where you see it**
- **Meta → Overview**: an **Ad Fatigue** KPI card showing the average times seen per person
- **Meta → By Project**: a Fatigue column per project
- **Meta → Ads**: a Fatigue column per individual ad (this is where you decide which creative to swap)
- **Google → By account** and **→ Campaigns**: Fatigue column (CTR-decline based)
- **Both → By source**: Fatigue for Meta, Google and combined

---

## 5. Automatic alerts — email **and** in-app notification

A watchdog now runs **every day at 9:00 AM** and compares **yesterday against the day before**
(complete days, so the numbers are settled and trustworthy).

**What it watches for**

| Alert | Triggers when | Severity |
|---|---|---|
| **Spend spike** | Spend jumped 50%+ **and** at least ₹2,000 more than the day before | 🔴 Critical |
| **Spending with no results** | Spent ₹3,000+ and got **zero** leads/conversions | 🔴 Critical |
| **Cost per lead / conversion spike** | Cost per result up 60%+ and above ₹500 | 🟠 High |
| **Ad fatigue** | Seen 3×+ per person **and** CTR down 20%+ (Meta) | 🟠 High |
| **Over daily budget** | A Google campaign spent more than 130% of its daily budget | 🟠 High |
| **Creative/keyword fatigue** | CTR fell 20%+ while spend continued (Google) | 🔵 Medium |

**What happens when one fires**
1. An **email** goes out — branded like your other JAIN-E emails, colour-coded by severity, with a
   button straight to Campaign Analytics.
2. A **notification appears in the bell** inside the app. Clicking it opens Campaign Analytics.
3. It is recorded so the **same alert can never be sent twice in one day** (no spam).

**It was tested against your real accounts and correctly found 5 genuine issues**, including:
- 🔴 Google · Dream Exotica — spend jumped **901%** (₹269 → ₹2,697)
- 🟠 Google · Dream Exotica — "Brand Search" spent ₹2,697 against a ₹1,500/day budget
- 🟠 Meta · Dream Eco City — cost per lead up **131%** (₹1,096 → ₹2,536)
- 🟠 Meta · Dream Valley — cost per lead up **96%** (₹495 → ₹970)
- 🟠 Google · Dream Valley Siliguri — cost per conversion up **85%**

**Who gets the emails:** by default `digitalmarketing@thejaingroup.com`. To send to more people,
add a Supabase secret named **`CAMPAIGN_ALERT_EMAILS`** with comma-separated addresses.

---

## 7. Revision 2 — proper pages, ad-wise data, and a grown-up design

### 7.1 New tab layout

| Source | Tabs |
|---|---|
| **Meta** | Overview · **Campaigns** · By Project · Ads · **Trend** · **Ad Fatigue** |
| **Google Ads** | Overview · Accounts · Campaigns · **Ads** · **Trend** · **Ad Fatigue** |
| **Both** | Overview · Sources · **Trend** · **Ad Fatigue** |

### 7.2 Trend — now a full page

Two stacked panels:

1. **Period comparison** — a clean table of *Metric · Previous · Current · Change*, covering Spend,
   Leads/Conversions, Cost per result, Clicks and CTR, each with a small proportional bar so the size
   of the move is visible at a glance.
2. **Breakdown** — every project (Meta) or account (Google) with **previous → current → change** for
   both spend and results, plus cost-per-result and its movement. Sorted by spend.

### 7.3 Ad Fatigue — now a full page

- A strip of three counters at the top: **Need refresh · Watching · Healthy**.
- Then a table sorted **worst first**, with: times seen per person, **CTR before**, **CTR now**, the
  % change, spend, the verdict, and a plain-English **"What to do"** column
  (e.g. *"Refresh the creative — swap images/headlines"*).
- Meta lists **individual ads** (so you know exactly which creative to swap); if ad data isn't loaded
  it falls back to campaigns. Google lists individual ads too, using CTR decline.

### 7.4 Google Ads — Ad-wise page (NEW)

Google ad-level data is now pulled from the API (`ad_group_ad`) into two new tables. Because Google
often leaves responsive ads unnamed, the ad is labelled from its **actual headlines**, which reads
naturally — verified live on your account, e.g.:

- *"Dream World City in Joka / Starts ₹29L in Joka Kolkata"* — Brand KW — ₹14,460, 176 clicks, 9.8 conv
- *"Flats in Joka Kolkata / EMI From ₹19,565"* — Joka — ₹14,690, 167 clicks, 8.0 conv

Each row shows account · campaign · ad group underneath, plus spend, trend, conversions,
cost/conversion, clicks, CTR and fatigue. Ad data is only fetched when you actually open the Ads or
Fatigue tab, so the other tabs stay fast.

### 7.5 Meta — Campaigns page with Active / Inactive (NEW)

A campaign-wise table with an **All / Active / Inactive** filter (each button shows its count).
Columns: campaign (with project + objective beneath), status, budget with "% used", spend, trend,
leads, cost per lead with movement, CTR and fatigue. The same filter was added to Google's Campaigns
and Ads pages.

### 7.6 Redesign — quieter and more grown-up

The old look used eight different bright colours, coloured left bars, coloured icon badges and
candy-coloured pills. That has been replaced with a restrained system that matches the sidebar:

| Element | Before | Now |
|---|---|---|
| KPI cards | 8 bright accent colours + coloured icon circles + drop shadow | white card, hairline border, **no** accent bar, muted grey icon, no shadow |
| Numbers | 24px heavy | 23px, weight 650, tight letter-spacing, **tabular figures** so columns line up |
| Trend / fatigue | filled coloured pills | plain text, muted green / muted red only |
| Tables | generic | 10px uppercase letter-spaced headers, hairline rows, right-aligned numerals, soft hover |
| Panels | — | titled panels with a small uppercase overline and a date chip |
| Active filter | — | near-black `#111318`, echoing the sidebar |

Verified by reading the **computed styles** in a real browser: accent bars `display:none`, pill
backgrounds transparent, card shadows `none`, and **no horizontal page overflow**.

### 7.7 Revision 2 verification

- `nexus-core.js` parsed by a real JavaScript engine → **no syntax errors**.
- **Trend maths unit-tested** with known inputs: 55,000 → 62,000 = **+13%**, 33 → 30 = **−9%**,
  cost/lead 1,666 → 2,066 = **+24%**, CTR 1.80% → 1.42% = **−22%** — all correct.
- **Fatigue page tested**: correctly counted 1 Need-refresh / 1 Watching / 1 Healthy and sorted
  worst-first, with the right advice on each row.
- **Google ad-level API call tested live** — real ads, spend and conversions returned.
- New tables/columns confirmed created in the database.

---

## 6. Interface polish

- A **legend line** under the KPIs on every tab explaining what "Trend" and "Fatigue" mean, so
  nobody has to guess.
- Trend and fatigue badges are compact rounded pills that don't make table rows taller.
- Everything reflows properly on mobile (the KPI grid drops to 2 columns, tables scroll sideways
  rather than squashing).
- Budget cells show the amount, "/day", and the "% used" line underneath.

---

## How it was verified (not assumed)

- **Google budget** — called the live Google Ads API and confirmed real rupee budgets came back.
- **Alerts** — ran in a safe "detect but don't send" mode against your real Meta and Google
  accounts; it found 5 true problems (listed above).
- **Both edited files** were parsed by a real JavaScript engine → **no syntax errors**.
- **The trend maths was unit-tested**: all seven date ranges (today, yesterday, 7d, 14d, last
  month, last year, custom) produce the correct comparison window, and the up/down/cost-aware
  colouring behaves correctly.
- **Two real bugs were found by those tests and fixed**: ads seen 3× per person were being marked
  "Fresh" (now "Watch"), and with only a few projects the same project could appear in *both* the
  Best and Worst list (now impossible).

---

## Technical notes (for reference)

**Database**
- `camp.g_campaigns` → added `budget_amount`, `budget_type`
- `camp.campaign_insights` → added `frequency`
- `camp.ad_insights` → added `frequency`
- `camp.alert_log` → new table, stops duplicate alerts

**Backend (Supabase functions)**
- `google-ads-live` → now pulls `campaign_budget.amount_micros`
- `campaign-analytics-live` → now stores Meta `frequency` per campaign and per ad
- `campaign-alerts` → **new**; the watchdog. `?dry=1` detects without sending anything
- Scheduled job `campaign-alerts-daily` → runs at 03:30 UTC (9:00 AM IST)

**Frontend (`nexus-core.js`)**
- New shared helpers: `cmpPrevRange`, `cmpPrevKey`, `cmpSyncPrev`, `cmpTrend`, `cmpFatigue`,
  `cmpBestWorst`, `cmpRunAlerts`, plus `CMP_EXTRA_CSS`
- All three views (Meta / Google / Both) now also load the previous period to compare against

**One thing worth knowing:** because comparison needs the earlier period too, each view now asks
for two windows instead of one. Results are cached for 5 minutes server-side, so normal use stays
fast; only the very first load of a new date range is slower.
