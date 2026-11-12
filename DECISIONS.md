# Decisions

## Not finished, or not verified (read this first)

Everything on the list of screens and features is built and works on sample data. These things could **not be verified** tonight, because the build used no real Etsy credentials and had no access to Cloudflare's or Etsy's websites:

1. **Real Etsy answers.** The Etsy client, login and daily pull were tested against hand-written fake answers shaped like Etsy's v3 API (unit tests, plus one full run against a fake Etsy server: login, first pull, sample data replaced, Refresh now). Field names come from memory of Etsy's documentation. If a real answer differs, the first pull will say what failed in Settings > "Last update".
2. **Which fee lines Etsy's bill links to an order.** Per-sale fees use real bill lines when a line's `reference_id` equals the order or item number, and estimate the rest (tagged "estimated"). How Etsy really fills `reference_id` is unverified. The shop-wide fee total always comes straight from the bill when the bill has fee lines. If the bill is only partly pulled, that total is too low until the next pull.
3. **Ledger line names.** Lines are sorted into fee types by key words (for example `prolist` or "Etsy Ads" = probable ad fees). Etsy does not publish a fixed list. Unknown lines are shown on the Money screen under "Bill lines we could not sort" and are not counted.
4. **Discounts from shop sales.** Coupon discounts arrive in `discount_amt`. For a shop-wide sale (like the 70% off), it is unverified whether Etsy reports the item `price` before or after the sale. Revenue is safe either way: it uses the lower of Etsy's `subtotal` and `total_price - discount_amt`. "List price" is taken from the daily price history, so "discount %" is right from the first daily pull onward. For older orders it uses today's list price and is tagged "list price estimated".
5. **Etsy key header.** Etsy now expects `x-api-key: keystring:shared_secret`. The client sends that, and automatically retries once with the keystring alone if Etsy rejects the key format.
6. **Etsy Stats CSV format.** Etsy does not document it. The reader finds columns by name (Date plus any of Visits, Views, Orders, Revenue) and explains clearly what is missing. It may need a tweak once a real file is seen.
7. **Cloudflare dashboard wording and automatic database creation.** SETUP.md describes the Git-connected deploy from memory. The deploy tool in this repo (wrangler 4.160) creates the D1 database automatically when no `database_id` is given; SETUP.md has a manual fallback if that fails.
8. **Real iPhone.** Layout was tested in a Chromium browser at iPhone 15 size (393 x 852) in light and dark mode: no sideways scrolling, no console errors, touch targets 40px or taller. It was not tested on a physical iPhone or real Safari. Only widely supported browser features are used.
9. **Claude briefing.** Written with the official Anthropic SDK but never run (no key). It only runs in the daily background job and all errors are swallowed, so it cannot affect the dashboard.
10. **Fee defaults.** Transaction 6.5%, processing 3% + A$0.25, listing A$0.31 (US$0.20), GST on fees 10%. These are Etsy's usual Australian rates from memory, only used when the bill gives no figure. Check Etsy's fee page and adjust in Settings > Etsy fee rates.

## Changes from the original brief

- **No `npm run etsy:auth` script.** Replaced by `/auth/start` and `/auth/callback` inside the Worker, as asked in the change of plan. The refresh token is stored in D1 and renewed by the Worker.
- **No migration step.** The Worker creates its own tables (`CREATE TABLE IF NOT EXISTS`) and seeds sample data on first run, so a no-command-line deploy needs nothing extra. `npm run seed` still exists for local use.

## Structure

- `src/shared/` pure logic (money, dates, fees, metrics, status, suggestions, CSV). No I/O, fully unit tested.
- `src/server/` Cloudflare Worker (Hono): auth, Etsy client/login/sync, API, sample data, optional briefing.
- `src/client/` Preact + Chart.js app, built by Vite into `dist/`, served by the same Worker.
- `public/` manifest, icons, service worker.

## Choices, and why

**Money**
- All amounts are whole cents. Etsy `{amount, divisor}` is converted with `round(amount x 100 / divisor)`; typed-in dollars are parsed as text, never as floating point.
- Revenue = item subtotal after discounts. Tax, VAT and shipping are shown separately as "not mine".
- Splitting an amount across lines uses largest-remainder rounding so no cent is lost.
- **Profit per sale = price paid - Etsy fees - an equal share of (ads + manual costs + bill fees not tied to one sale).** The share is all-time total divided by number of sales. This is simple and makes per-sale profits add up exactly to shop profit (there is a test for that), but it is an estimate: Etsy does not say which sale an ad caused.
- **Ads:** for each week, ad lines found in Etsy's bill win; the typed-in number is used only for weeks where the bill shows none. This avoids counting ads twice.
- Break-even price = lowest price that covers Etsy fees plus the current ads-and-costs share per sale.
- Only AUD is handled. Orders in another currency are shown unconverted with a warning note.
- Cancelled orders are ignored. Refund lines in the bill reduce shop profit but are not traced back to a single sale.

**Time**
- Days are counted in Australia/Sydney time.
- "This week" = the last 7 days including today; "last week" = the 7 days before. A rolling window gives a fair comparison on any weekday.
- Weekly typed-in numbers (ads, visits) are spread evenly over the 7 days of that week.
- Conversion = orders / visits only when visits cover the whole 7 days. Otherwise orders / listing views, tagged "estimated". If neither exists it says "missing data".
- Daily views = today's running total minus yesterday's. Days before the first snapshot show as missing, not zero.

**Etsy and limits**
- One pull is about 5 to 8 Etsy requests, one at a time, 250 ms apart. On 429 it waits (Retry-After, or 1s, 2s, 4s, 8s) and gives up after 4 tries.
- First pull reads all orders and the bill since the shop opened; later pulls re-read the last 14 days of orders and 3 days of bill to catch late changes. Caps per run (8 order pages, 4 bill months) keep it inside Cloudflare's free limits; a big backlog continues on the next run.
- The daily timer is 19:00 UTC (early morning in eastern Australia). "Refresh now" is limited to once per 10 minutes, enforced on the server.
- Listings that stop being active are kept but marked inactive, so old sales still make sense.
- **Privacy:** buyer names, emails and addresses are dropped before saving. Only the country is kept. Review text is not stored, only the rating.

**Security**
- No passcode set = everything locked (fails closed).
- Session cookie: HMAC-signed, HttpOnly, SameSite=Strict, 30 days, Secure on https. The signing key is derived from the passcode, so changing the passcode logs out every device and there is one less secret to manage.
- Wrong passcodes: 5 per 15 minutes per visitor address, 40 per 15 minutes overall.
- `/auth/callback` cannot require the cookie (a SameSite=Strict cookie is not sent when Etsy redirects back). It is protected by a random one-time `state` value that only a logged-in `/auth/start` can create, valid for 10 minutes.
- Posts from other websites are rejected (Origin check). Pages send no-frame and no-index headers. API answers are never cached.
- The service worker caches only the app's own files, never `/api/` data.
- The shop ID is in `wrangler.jsonc` because it is public, not a secret.

**Suggestions**
- Thresholds: under 20 views after 14 days = traffic problem; 50+ views with 0 sales = listing problem; under 13 tags; 2 or more tags made only of title words; average discount over 50%; no reviews after 5 sales (adjustable); profit under the minimum (default A$2.00); ads at 25% or more of revenue; 0 views after 2 days.
- "Product not in my shop": looks in descriptions for capitalised names ending in Bundle, Pack, Kit or Collection that match no active listing title. Simple on purpose; it can miss or over-flag.
- "Next steps" takes the top 3 by score but only one per topic, so it never says "raise the price" three times.
- Status labels: Working = 2% or more of views become sales; Needs a better listing = 50+ views with no sales, or under 1%; otherwise by views and age.

**Sample data**
- Matches the shop facts: 5 listings, 174 views, 11 sales at about 70% off, buyers US 3, IT 4, DE 1, RO 1, SE 1, ES 1. Placed relative to "today" (shop opened 28 days ago) so the weekly comparison always has data.
- Ad spend, costs, visits, tags and descriptions in the sample are invented to exercise every screen and rule (for example a description that mentions a "Mega Bundle").
- Real data replaces sample data at the first successful pull. Manual entries you typed yourself are kept.

**Look and layout (redesign)**
- Theme: ink-wash on parchment, taken from the reference image: warm paper colours, serif type (the fonts already on iPhone and computers, nothing downloaded), soft translucent cards, dark umber buttons.
- The background (mountains, cherry blossom branch, pagoda) is drawn in code as SVG in `src/client/Scenery.tsx`. The reference image itself is not used or copied, so there are no image files and no licence question.
- Device detection is in `src/client/device.ts`. An iPhone always gets the phone layout (one column, bottom tab bar, safe-area padding). Any other screen 900px or wider gets the desktop layout (sidebar, big heading, cards side by side). Resizing a desktop window switches live.
- Dark mode follows the device until the moon button is tapped; the choice is remembered on that device.
- Chart colour is a warm umber that passes the colour-blind-safety validator in light and dark. The small trend lines in the desktop tiles show a 7-day running total and are decoration only; they are hidden on the phone where there is no room.
- The reference shows a world map and product photos. Those are left out: Etsy listing photos would need another API call per listing, and a map adds weight for 6 countries. "Sales by region" and "Top listings" use share bars instead.
- The Home Screen icon changed to match. An icon already on a Home Screen keeps the old picture until it is removed and added again.
- Checked in a Chromium browser at iPhone 15 size and at 1440 and 1000px wide, light and dark: no sideways scrolling, no console errors. Still not tested on a physical iPhone.

**Ads screen**
- Laid out like Etsy's own Ads page: date range, six headline numbers (Views, Clicks, Orders, Revenue, Spend, ROAS) that double as the chart selector, a chart over time, and a sortable table of advertised listings.
- Etsy's API has no ad statistics, so views, clicks, orders and revenue are typed in per week (whole shop, and optionally per listing). Nothing is invented: anything not typed in shows "not typed in", not zero.
- Etsy's page shows days; this one works in weeks (Monday to Sunday), because typing numbers in daily is not realistic.
- Spend follows the same rule as the Money screen: Etsy's bill wins for a week that has ad lines on it; typed spend is used for other weeks. The form says so when the bill overrides what was typed.
- Added beyond Etsy's page: "Profit after ads" (ad sales minus Etsy's average fee share minus ad spend), the break-even ROAS, and a result label per listing (Earning / Losing money / Not enough clicks yet, judged only from 30 clicks). All estimates.
- It cannot switch ads on or off or change the budget. The app stays read-only.
- Ad spend moved from the Settings screen to the Ads screen so it is typed in one place only. Saving visits no longer touches ad spend, and the other way round.
- Four new to-do rules: ads losing money over the last 4 weeks (needs A$5+ spend), an advertised listing with 30+ clicks and no orders, a click rate under 1% on 300+ ad views, and ad spend with no results typed in.
- Not verified: the exact names and layout of the numbers on Etsy's Ads page (written from memory), and whether Etsy counts "revenue" there before or after discounts. Type in whatever Etsy shows.
- **Etsy Ads CSV upload** (on the Ads screen): finds columns by name (Views or Impressions, Clicks, Orders, Revenue or Sales, Spend or Cost, Date, Listing), skips lines above the header and "Total" rows, and adds days up into weeks. A file with no dates goes into the one week chosen next to the upload button. Listings are matched by listing ID, or by title. Ratio columns (click rate, ROAS, cost per click) are ignored and recalculated. **Not verified against a real Etsy Ads file**: the format is not documented and no real file was available. If a file is refused, the error lists the columns it found.
- An Etsy Ads file dropped into the Stats upload box in Settings is recognised and sent to the Ads import instead.
- Spend from a CSV counts as "typed in": Etsy's bill still wins for a week where the bill shows ad charges.
- A site still showing sample data is re-seeded once so the sample ad numbers appear.

**Small things**
- The Listings and Fix screens only consider active listings.
- Chart colour was checked with a colour-blind-safety validator; charts are single-series bars with tap-to-see values.
- Local development creates `.dev.vars` with the passcode `letmein`. It is git-ignored and never used in production.
