// Meta Ad Library Scraper (Apify Actor)
// -------------------------------------
// Drives a real Chromium browser (Playwright) against Meta's PUBLIC Ad Library search page and
// returns one dataset item per ad, in the exact shape JAIN-E's `competitor-ads-sync` edge function
// consumes:
//   { library_id, is_active, started_running_on, platforms[], page_name, page_url,
//     body_text, cta_text, redirect_url, extra_links[], media[{url,type}], ad_snapshot_url }
//
// Input: { searchTerm, country="IN", activeStatus="all"|"active"|"inactive",
//          mediaType="all", resultsLimit=20, proxyConfiguration }
//
// NOTE ON FRAGILITY: Meta's Ad Library is a React SPA with obfuscated/randomised class names, so
// this scraper is *text-anchored* (it finds each ad by its "Library ID:" label and walks up to the
// tightest containing card) rather than relying on CSS classes — the most durable approach. Even so,
// Meta changes its DOM periodically; the body_text / platform / CTA heuristics below may need light
// tuning after a Meta redesign. Every run saves `debug-screenshot.png` and `debug-page.html` to the
// run's key-value store to make that tuning easy.

import { Actor } from 'apify';
import { PlaywrightCrawler } from 'crawlee';

await Actor.init();

const input = (await Actor.getInput()) || {};
const searchTerm = String(input.searchTerm || '').trim();
const country = String(input.country || 'IN').trim().toUpperCase();
const activeStatus = ['all', 'active', 'inactive'].includes(input.activeStatus) ? input.activeStatus : 'all';
const mediaType = ['all', 'image', 'video', 'meme', 'none'].includes(input.mediaType) ? input.mediaType : 'all';
const resultsLimit = Math.min(Math.max(Number(input.resultsLimit) || 20, 1), 200);

if (!searchTerm) {
    await Actor.fail('Input "searchTerm" is required.');
}

const proxyConfiguration = await Actor.createProxyConfiguration(
    input.proxyConfiguration || { useApifyProxy: true, apifyProxyGroups: ['RESIDENTIAL'] },
);

const startUrl = 'https://www.facebook.com/ads/library/?'
    + 'active_status=' + encodeURIComponent(activeStatus)
    + '&ad_type=all'
    + '&country=' + encodeURIComponent(country)
    + '&media_type=' + encodeURIComponent(mediaType)
    + '&q=' + encodeURIComponent(searchTerm)
    + '&search_type=keyword_unordered';

// ---- dismiss Meta's cookie banner / login popovers so the results are reachable ----
async function dismissDialogs(page, log) {
    const labels = [
        'Decline optional cookies', 'Only allow essential cookies', 'Allow all cookies',
        'Close', 'Not now', 'Not Now',
    ];
    for (const t of labels) {
        try {
            const btn = page.getByRole('button', { name: new RegExp('^\\s*' + t + '\\s*$', 'i') }).first();
            if (await btn.isVisible({ timeout: 1200 })) {
                await btn.click({ timeout: 2000 });
                await page.waitForTimeout(400);
            }
        } catch (_e) { /* ignore */ }
    }
    try { await page.keyboard.press('Escape'); } catch (_e) { /* ignore */ }
}

// ---- infinite-scroll until we have enough cards (or growth stalls) ----
async function autoScroll(page, target, log) {
    let stable = 0;
    let last = 0;
    for (let i = 0; i < 40; i++) {
        const count = await page.evaluate(() => (document.body.innerText.match(/Library ID/gi) || []).length);
        if (count >= target) { log.info(`Loaded ${count} cards (target ${target}).`); break; }
        if (count === last) { stable++; } else { stable = 0; }
        if (stable >= 3) { log.info(`Card count stalled at ${count} — stopping scroll.`); break; }
        last = count;
        await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
        await page.waitForTimeout(2200);
    }
}

// ---- in-browser extraction (self-contained: only uses its params + page DOM) ----
function extractAds({ limit, country }) {
    const CTAS = ['Learn More', 'Shop Now', 'Book Now', 'Sign Up', 'Send Message', 'Send WhatsApp Message',
        'Contact Us', 'Get Offer', 'Apply Now', 'Download', 'Watch More', 'Get Quote', 'Subscribe',
        'See Menu', 'Call Now', 'Get Directions', 'Order Now', 'Play Game', 'Install Now', 'Use App',
        'Listen Now', 'Request Time', 'Buy Tickets', 'Get Showtimes', 'Follow Page', 'Open Link',
        'Enquire Now', 'Get quote', 'WhatsApp', 'Message Now'];

    function decodeLink(u) {
        try {
            if (u && /l\.(php|facebook)/.test(u)) {
                const m = u.match(/[?&]u=([^&]+)/);
                if (m) return decodeURIComponent(m[1]);
            }
        } catch (_e) { /* ignore */ }
        return u;
    }

    // Anchor on every "Library ID" text node, then climb to the tightest ancestor that still
    // contains exactly ONE "Library ID" (== one ad card).
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null);
    const anchors = [];
    let tn;
    while ((tn = walker.nextNode())) {
        if (/Library ID/i.test(tn.nodeValue || '') && tn.parentElement) anchors.push(tn.parentElement);
    }
    const seen = new Set();
    const cards = [];
    for (const el of anchors) {
        let node = el;
        while (node.parentElement) {
            const cnt = (node.parentElement.innerText.match(/Library ID/gi) || []).length;
            if (cnt > 1) break;
            node = node.parentElement;
        }
        if (!seen.has(node)) { seen.add(node); cards.push(node); }
    }

    const out = [];
    for (const card of cards) {
        const text = card.innerText || '';
        const idm = text.match(/Library ID[:\s]*([0-9]{5,})/i);
        if (!idm) continue;
        const library_id = idm[1];

        const is_active = /\bInactive\b/i.test(text) ? false : true;

        const startm = text.match(/Started running on\s+([A-Za-z]{3,9}\.?\s+\d{1,2},?\s+\d{4})/);
        const started_running_on = startm ? startm[1].replace(/\./g, '') : null;

        // advertiser page (name + url)
        let page_name = null, page_url = null;
        const pageA = Array.from(card.querySelectorAll('a[href]')).find((a) => {
            const h = a.href || '';
            const t = (a.innerText || '').trim();
            return /facebook\.com\//.test(h) && !/ads\/library/i.test(h) && t.length > 1 && t.length < 70;
        });
        if (pageA) { page_name = (pageA.innerText || '').trim(); page_url = pageA.href; }

        // media (images + videos actually on the card; skip small avatars/icons)
        const media = [];
        card.querySelectorAll('img').forEach((img) => {
            const r = img.getBoundingClientRect();
            const src = img.currentSrc || img.src || '';
            if (/^https?:/.test(src) && r.width >= 180 && r.height >= 120) media.push({ url: src, type: 'image' });
        });
        card.querySelectorAll('video').forEach((v) => {
            let src = v.currentSrc || v.src || '';
            if (!src) { const s = v.querySelector('source'); if (s) src = s.src || ''; }
            if (/^https?:/.test(src)) media.push({ url: src, type: 'video' });
            else if (v.poster && /^https?:/.test(v.poster)) media.push({ url: v.poster, type: 'image' });
        });
        const seenM = new Set();
        const mediaU = [];
        for (const m of media) { if (!seenM.has(m.url)) { seenM.add(m.url); mediaU.push(m); } }

        // CTA button
        let cta_text = null;
        const btns = Array.from(card.querySelectorAll('a,div[role="button"],span,div'));
        for (const b of btns) {
            const t = (b.innerText || '').trim();
            if (t && t.length <= 24 && CTAS.some((c) => c.toLowerCase() === t.toLowerCase())) { cta_text = t; break; }
        }

        // outbound (landing page) links
        const ext = [];
        card.querySelectorAll('a[href]').forEach((a) => {
            const h = decodeLink(a.href || '');
            if (/^https?:/.test(h) && !/facebook\.com|fbcdn\.net|instagram\.com|whatsapp\.com/i.test(h)) ext.push(h);
        });
        const extra_links = Array.from(new Set(ext));
        const redirect_url = extra_links[0] || null;

        // platforms (best-effort from aria-labels; 'OTHER' when Meta's sprite icons are unlabeled)
        const plats = new Set();
        card.querySelectorAll('[aria-label]').forEach((e) => {
            const al = (e.getAttribute('aria-label') || '').toLowerCase();
            if (al.includes('facebook')) plats.add('FACEBOOK');
            if (al.includes('instagram')) plats.add('INSTAGRAM');
            if (al.includes('messenger')) plats.add('MESSENGER');
            if (al.includes('audience network')) plats.add('AUDIENCE_NETWORK');
        });
        const platforms = plats.size ? Array.from(plats) : ['OTHER'];

        // body copy: drop metadata / chrome lines, keep the ad text
        const drop = [
            /^Sponsored$/i, /^Active$/i, /^Inactive$/i, /^Library ID/i, /^Started running on/i,
            /^Platforms?$/i, /^This ad has multiple versions/i, /^See ad details$/i, /^See summary details$/i,
            /^Open Drop-?down$/i, /^Facebook$/i, /^Instagram$/i, /^Messenger$/i, /^Audience Network$/i,
            /^\d{5,}$/, /^·\s*/,
        ];
        const lines = (text.split('\n').map((s) => s.trim()).filter(Boolean))
            .filter((l) => !drop.some((rx) => rx.test(l)))
            .filter((l) => l !== page_name && l !== cta_text && l !== country && l !== '· ' + country);
        const body_text = lines.join('\n').slice(0, 2000) || null;

        out.push({
            library_id, is_active, started_running_on, platforms,
            page_name, page_url, body_text, cta_text, redirect_url, extra_links,
            media: mediaU,
            ad_snapshot_url: 'https://www.facebook.com/ads/library/?id=' + library_id,
        });
        if (out.length >= limit) break;
    }
    return out;
}

const crawler = new PlaywrightCrawler({
    proxyConfiguration,
    maxRequestRetries: 2,
    navigationTimeoutSecs: 120,
    requestHandlerTimeoutSecs: 300,
    headless: true,
    launchContext: {
        launchOptions: { args: ['--disable-blink-features=AutomationControlled', '--lang=en-US'] },
    },
    async requestHandler({ page, log }) {
        log.info(`Opening Ad Library: ${startUrl}`);
        await page.waitForTimeout(1500);
        await dismissDialogs(page, log);

        // wait for either ad cards or an explicit "no results" state
        try {
            await page.waitForFunction(
                () => /Library ID/i.test(document.body.innerText) || /No ads? (match|found)|~?0 results/i.test(document.body.innerText),
                { timeout: 60000 },
            );
        } catch (_e) { log.warning('Timed out waiting for results to render.'); }

        await autoScroll(page, resultsLimit, log);

        // debug artifacts for tuning after any Meta redesign
        try { await Actor.setValue('debug-screenshot', await page.screenshot({ fullPage: false }), { contentType: 'image/png' }); } catch (_e) {}
        try { await Actor.setValue('debug-page', await page.content(), { contentType: 'text/html' }); } catch (_e) {}

        const ads = await page.evaluate(extractAds, { limit: resultsLimit, country });
        log.info(`Extracted ${ads.length} ad(s) for "${searchTerm}".`);
        for (const ad of ads.slice(0, resultsLimit)) await Actor.pushData(ad);
    },
    failedRequestHandler({ log }, err) {
        log.error(`Request failed: ${err?.message || err}`);
    },
});

await crawler.run([{ url: startUrl, userData: { label: 'SEARCH' } }]);
await Actor.exit();
