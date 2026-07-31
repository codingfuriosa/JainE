# Campaign Analytics — what was added (31 July 2026)

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

## 3. Best & Worst performers

A pair of cards on the **Overview** tab of all three sources.

- **Best performers** (green) — the projects/accounts giving you the **cheapest cost per lead /
  conversion**, ranked 1-2-3.
- **Worst performers** (red) — money being wasted. It shows two kinds:
  1. anything that **spent money and produced zero results** (flagged with a **!**), listed first
     because that is the most urgent,
  2. then the **most expensive** cost-per-result ones.

Each line shows the amount spent and how many results it produced, so the comparison is obvious.
Nothing ever appears in both lists at once.

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
