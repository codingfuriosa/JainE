# Meta Ad Library Scraper — Apify Actor

Scrapes Meta's **public** Ad Library (creative only — Meta never exposes spend/reach for ordinary
commercial ads) and returns one dataset item per ad, in the exact shape JAIN-E's
`competitor-ads-sync` Supabase edge function already consumes.

## Input

```json
{
  "searchTerm": "Godrej Properties",
  "country": "IN",
  "activeStatus": "all",      // "all" | "active" | "inactive"
  "mediaType": "all",         // "all" | "image" | "video" | "meme" | "none"
  "resultsLimit": 20,
  "proxyConfiguration": { "useApifyProxy": true, "apifyProxyGroups": ["RESIDENTIAL"] }
}
```

The edge function sends `searchTerm`, `country`, `activeStatus`, and `resultsLimit` — those field
names match, so no changes to the edge function are needed for input.

## Output (one item per ad)

| Field | Type | Notes |
|---|---|---|
| `library_id` | string | Ad Library ID (primary key in `camp.competitor_ads`) |
| `is_active` | boolean | `false` if the card shows "Inactive" |
| `started_running_on` | string | e.g. `"Jul 25, 2026"` (edge parses with `new Date()`) |
| `platforms` | string[] | `FACEBOOK` / `INSTAGRAM` / `MESSENGER` / `AUDIENCE_NETWORK` / `OTHER` |
| `page_name` | string | Advertiser page name |
| `page_url` | string | Advertiser page URL (edge extracts numeric `page_id`) |
| `body_text` | string | Ad copy (edge stores as `ad_creative_bodies[0]`) |
| `cta_text` | string | e.g. "Learn More", "Book Now" |
| `redirect_url` | string | Landing-page URL (l.php `u=` decoded) |
| `extra_links` | string[] | Any additional outbound links |
| `media` | `{url,type}[]` | `type` is `"image"` or `"video"`; edge downloads the first 6 to S3 |
| `ad_snapshot_url` | string | `https://www.facebook.com/ads/library/?id=<library_id>` |

## Deploy to Apify

1. Install the CLI: `npm i -g apify-cli` and `apify login`.
2. From this folder: `apify push`.
   (Or zip this folder's **contents** and upload via the Apify Console → *Create new Actor → from source*.)
3. Apify builds the Docker image and gives the Actor an ID.

## Wire it into JAIN-E (one-time)

The `competitor-ads-sync` edge function has two dependencies:

1. **Secret `APIFY_API_TOKEN`** in Supabase (Settings → Edge Functions → Secrets) — your Apify API token.
2. **Actor ID constant** `APIFY_ACTOR_ID` (currently `cxHawTSMiZ3HjNh4p`). After `apify push`, if your
   new Actor has a **different** ID, update that constant in the edge function to the new ID and redeploy.
   (If you publish this over the existing Actor, the ID stays the same and nothing changes.)

That's it — the "Sync" buttons in the Competitor Ads module then call this Actor.

## Proxy & cost notes

- **Use RESIDENTIAL proxy.** Meta blocks most datacenter IPs; residential is far more reliable.
- The edge function has a **free-credit guard** — it skips syncing once the month's Apify usage nears
  the $5 free credit, so this never triggers surprise charges.
- Keep `resultsLimit` modest (20 is the module default) to keep each sync cheap and fast.

## Debugging after a Meta redesign

Meta's Ad Library uses obfuscated, frequently-changing class names, so this Actor is **text-anchored**
(it finds each ad by its "Library ID:" label, not by CSS classes) — the most durable approach. If Meta
changes its layout and fields start coming back empty, every run saves:

- `debug-screenshot.png` and `debug-page.html` in the run's **Key-value store**

Open those to see what changed, then adjust the heuristics in `src/main.js` (`extractAds`), which is
written to be easy to tweak.

## Run locally

```bash
npm install
npx playwright install chromium
apify run -p          # or: node src/main.js  (with an INPUT.json in ./storage/key_value_stores/default/)
```
