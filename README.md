# Etsy shop dashboard

A private, phone-first dashboard for one Etsy shop. It shows revenue, sales, fees, ad spend, profit per sale, what is working, what is not, and what to do next. It runs free on Cloudflare and installs on an iPhone Home Screen.

- **To set it up:** read [SETUP.md](SETUP.md). No Mac, no command line.
- **Why things are built the way they are, and what is not verified:** read [DECISIONS.md](DECISIONS.md).

Until Etsy is connected the app shows invented **SAMPLE DATA** (with a banner saying so).

## What each folder does

| Folder / file | In simple terms |
|---|---|
| `src/shared/` | The brain. Pure maths and rules with no internet or database: money in cents, fees, profit per sale, listing status labels, the suggestion rules, the CSV reader. Used by both the server and the phone app. |
| `src/server/` | The server (a Cloudflare Worker). Checks the passcode, talks to Etsy, saves to the database, answers the app's requests, and runs the daily data pull. |
| `src/server/etsy/` | Everything about Etsy: the read-only API client, the "Connect Etsy" login, and the daily pull. |
| `src/client/` | The phone app you see: the seven screens, charts and styles. |
| `public/` | Files that make it feel like an app: Home Screen icons, the web manifest, and the service worker (fast loading). |
| `scripts/` | Small helper scripts for working on a computer: load sample data, draw the icons. |
| `test/` | Automatic checks for the money maths, VAT handling, discounts, every suggestion rule, the Etsy client and the login. |
| `wrangler.jsonc` | Cloudflare settings: the database, the daily timer, the shop number. No secrets. |
| `.env.example` | The **names** of the secrets the app needs. Placeholder values only. |

## The screens

1. **Today** - last 7 days vs the 7 days before: revenue, orders, net profit, spend, views, conversion, a trend chart, and the single most important thing to do next.
2. **Sales** - every sale with price paid, discount, fees, profit and country. Filter by date and listing.
3. **Listings** - views, favourites, sales, discount depth and one status label per listing.
4. **Money** - revenue, fees, ads, costs, net profit, break-even, profit per sale, probable ad fees.
5. **Fix** - the full ranked to-do list, each with the numbers behind it.
6. **Next** - the 3 most valuable actions this week (What to do / What to consider / What to expect).
7. **Gear icon** - manual entries (ad spend, visits, costs), minimum profit, Stats CSV upload, Etsy connection and refresh.

## Safety

- The passcode, Etsy keys and tokens are Cloudflare secrets or live in the database. None are in this repo or in browser code.
- Every page and API route needs the passcode (signed 30-day cookie, wrong tries are rate limited).
- The app can only **read** from Etsy. It asks for read-only permissions and only sends GET requests.
- No buyer names, emails or addresses are stored. Only the buyer's country.

## Working on it from a computer (optional)

You do not need this to use the app. If you ever want to run it locally (needs Node.js 22):

```bash
npm install
```

```bash
npm run dev
```

Then open http://localhost:8787. The local passcode is `letmein` (created in a git-ignored `.dev.vars` file, local testing only).

| Command | What it does |
|---|---|
| `npm run dev` | Builds the app and runs it locally with sample data |
| `npm run seed` | Resets the local database to fresh sample data |
| `npm test` | Runs the unit tests |
| `npm run check` | Type-check + lint + tests |
| `npm run deploy` | Build and deploy by hand (Cloudflare normally does this for you from GitHub) |
