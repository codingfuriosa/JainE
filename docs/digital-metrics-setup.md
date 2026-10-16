# Digital Metrics – what to set up in Google (one time)

JAIN-E → Growth & Strategy → **Our Brand** shows our YouTube, Google Maps, Search Console and
Google Analytics figures (tabs of the same names), and **Competitor Data** shows competitors' YouTube
and Google Maps where Google makes that public. JAIN-E reads
everything through Google's official, read-only APIs. These steps can only be done by someone who
is signed in to Google as an owner. Do them in this order. None of them needs a password typed into JAIN-E or into a chat.

You will use **Google Cloud Console** (https://console.cloud.google.com), with the project JAIN-E already
uses for Google sign-in (the one that holds JAIN-E's OAuth client for Calendar / Meet).

---

## 1. Switch on the APIs (5 minutes)

Cloud Console → top bar, check the right project is selected → **APIs & Services → Library**. Search
for each of these, open it, press **Enable**:

| API | What it gives us |
|---|---|
| YouTube Data API v3 | public subscriber / view / video counts, ours and competitors' |
| YouTube Analytics API | our channel's views, watch time, subscribers gained/lost, traffic sources |
| Google Search Console API | clicks, impressions, CTR and position for our websites |
| Google Analytics Data API | GA4 users, sessions, sources, landing pages, key events |
| Google Analytics Admin API | lets JAIN-E list which GA4 properties we have |
| Places API (New) | public Google Maps rating and review count, ours and competitors' |
| My Business Account Management API | lists our Business Profile accounts |
| My Business Business Information API | lists our Maps listings |
| Business Profile Performance API | our listings' search/maps views, calls, directions, website clicks, keywords |
| Google My Business API | our listings' reviews and our replies |

The four Business Profile APIs only show usage after step 4 is approved. Enable them anyway.

## 2. Make the consent screen "Internal" (avoids Google review and the 7-day sign-out)

Cloud Console → **APIs & Services → OAuth consent screen** (on the newer screens this is
**Google Auth Platform → Audience**).

* Set **User type = Internal**. Internal means only @thejaingroup.com Google accounts can connect.
  Google then does **not** review the app, and **sign-ins do not expire after 7 days**. Apps left on
  "External / Testing" lose their connection every 7 days.
* **If "Internal" is greyed out:** the Cloud project is not inside the thejaingroup.com Google
  Workspace organisation, usually because it was created from a personal Gmail account. A Workspace
  super-admin can move it: Cloud Console → **IAM & Admin → Settings → Migrate**, choose the
  thejaingroup.com organisation. If moving it is not possible, the fallback is: keep **External**, and
  press **Publish app** so its status is **In production** rather than Testing. That also stops
  the 7-day expiry, but Google will show an "unverified app" warning on the consent screen until the
  app is verified.
* Under **Data access / Scopes**, add these. Each is read-only, except business.manage, which is the only scope
  Google offers for Business Profile. JAIN-E uses it to read only.
  `…/auth/youtube.readonly`, `…/auth/yt-analytics.readonly`, `…/auth/webmasters.readonly`,
  `…/auth/analytics.readonly`, `…/auth/business.manage`

Nothing changes for the existing Calendar / Gmail connection. It uses the same OAuth client.

## 3. Create the API key for public data (competitors)

Cloud Console → **APIs & Services → Credentials → + Create credentials → API key**.

1. On the new key press **Edit** → **API restrictions → Restrict key** → tick **YouTube Data API v3**
   and **Places API (New)** → Save. (Application restrictions: leave "None". The key is used only
   from Supabase's servers, never from a browser.)
2. Copy the key. Do **not** paste it into chat or email.
3. Supabase dashboard → project *rkxsgtauigjrpcjkmccu* → **Edge Functions → Secrets → Add new
   secret**:
   * Name `YOUTUBE_API_KEY`, value: the key.
   * Name `GOOGLE_PLACES_API_KEY`, value: the same key, or a second key if you'd rather bill or limit Places separately.

**Cost.** YouTube Data API is free within 10,000 units a day. JAIN-E uses roughly 50 a day.
Places API is billed per call. A daily reading of 40 places is about 1,200 calls a month, which is
inside Google's monthly free usage for Place Details. Billing must be enabled on the project for
Places to work at all.

## 4. Ask Google for Business Profile API access (one-time form)

Google keeps the Business Profile APIs closed until it approves the Cloud project.

1. Find the project **number** (not the name): Cloud Console → **Dashboard → Project info →
   Project number**.
2. Open Google's form: https://developers.google.com/my-business/content/prereqs → **Request access
   to the API** (the "GBP API contact form"). Choose **Application for Basic API Access**.
3. Fill it in with:
   * a @thejaingroup.com email that is an **owner or manager** of our Business Profile listings,
   * the project number from step 1,
   * use case: "Internal reporting of our own Business Profile listings' performance and reviews
     in our company ERP; read-only."
4. Google replies by email, usually within a few days to two weeks. Approval shows as a quota of
   300 requests/minute on "My Business Account Management API" (APIs & Services → that API → Quotas).
   Until then the Google Maps tab shows only the public Places figures.

Tip: the account that connects in step 5 must itself be an owner/manager of the listings, or it will see none.

## 5. Connect in JAIN-E

JAIN-E → Our Brand → **Setup** → **Connect Google for Marketing**.

* Choose the **company account** that owns the YouTube channel, is an owner in Search Console,
  has at least Viewer on the GA4 properties, and manages the Maps listings. If YouTube asks you to
  choose between your personal profile and the **Jain Group brand account**, pick the **brand
  account**.
* Press **Find our sites, properties, listings and channels**. Switch off anything listed that
  isn't ours.
* Press **Pull now** on each row (or wait for the nightly pull at 02:30 IST). The first pull
  goes back about a year for YouTube, 18 months for Maps, 16 months for Search Console and 6 months for GA4.

If one account cannot see everything, connect a second account the same way. JAIN-E keeps both.

## What is NOT possible

Competitors' Search Console and Google Analytics are private to each competitor, and Google has no
way for anyone else to read them. For competitors, JAIN-E shows only what Google makes public:
YouTube counts and videos, and Maps ratings and reviews.

## Checked on 16 Oct 2026

GA4 **is installed** on thejaingroup.com. It is loaded through Google Tag Manager container
`GTM-TSVVQQR`, and the GA4 measurement ID inside it is `G-95JRH2F94T`. The project sites have
their own tags:

| Site | Tag Manager | GA4 ID(s) |
|---|---|---|
| dreamworldcity.co.in | GTM-5S6VH5Z3 | G-SGY08DCJCT |
| dreamecocity.com | GTM-5C2VT7B3, GTM-K2RHB95, GTM-KX6XTP8, GTM-MW5SB8D | G-3CE8KCC6K6, G-QNJYB89FRG, G-Z87S7FMBP8 |
| dreamone.co.in | GTM-5RH52BGK, GTM-WR4BL48 | G-6H3KF2YPJN, G-64LQJ5LBMC |
| dreamvalley.net.in | GTM-W42THJZ, GTM-WWNQLBSH | G-GN8PSKRVC9, G-NQ8FZF35RL |
| dreamgurukul.com | none found | – |
| dreamexotica.com | site did not respond | – |

Several sites load more than one Tag Manager container or GA4 ID, often left behind by different
agencies. That double-counts visits in whichever property receives both, so it is worth tidying.
