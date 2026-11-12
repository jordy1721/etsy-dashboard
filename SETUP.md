# Setup: your morning checklist

No Mac needed. No command line. Nothing to install. You only need a web browser (phone or computer).

Time: about 30 minutes, plus waiting for Etsy to approve your developer app (that part is up to Etsy).

You can stop after Part 2 and already use the dashboard with **sample data**. Parts 3 to 5 switch it to your real shop.

> Honest note: I could not open Cloudflare's or Etsy's websites while building this, so a button may be named slightly differently from what is written here. The steps and the values to type are right. If a screen looks different, look for the closest matching words.

---

## Part 1. Put the app on Cloudflare (about 10 minutes)

1. Go to **https://dash.cloudflare.com/sign-up** and make a free account. Confirm your email.
2. In the left menu open **Workers & Pages** (it may sit under "Compute"). Tap **Create**.
3. Choose the option to **import / connect a Git repository**, and connect **GitHub**. GitHub asks which repositories Cloudflare may see. Choose **Only select repositories** and pick `jordy1721/etsy-dashboard`.
4. Back in Cloudflare, select the `etsy-dashboard` repository and fill in the form:

   | Field | What to type |
   |---|---|
   | Project name | `etsy-dashboard` (must be exactly this) |
   | Production branch | `main` if you merged the code there. Otherwise `claude/etsy-analytics-pwa-monnqt` |
   | Build command | `npm run build` |
   | Deploy command | `npx wrangler deploy` |
   | Root directory | leave empty |

5. Tap **Save and Deploy** (or **Create and deploy**).

**What you should see:** a build log that scrolls for 1 to 2 minutes and ends with a green success message and a web address like `https://etsy-dashboard.YOUR-NAME.workers.dev`. Copy that address. This is your dashboard URL.

**If it fails:**

- *"name in config does not match"*: the project name must be exactly `etsy-dashboard`.
- *A message about D1 or `database_id`*: Cloudflare normally creates the database by itself. If it did not:
  1. Left menu: **Storage & Databases > D1 SQL Database > Create**. Name it `etsy-dashboard`. Copy the **Database ID** it shows.
  2. On GitHub, open the file `wrangler.jsonc`, tap the pencil icon, and change the database line to:
     `"d1_databases": [{ "binding": "DB", "database_name": "etsy-dashboard", "database_id": "PASTE-THE-ID-HERE" }],`
  3. Tap **Commit changes**. Cloudflare rebuilds by itself.
- *Anything else*: open the build log, copy the red lines, and ask Claude what they mean.

## Part 2. Set your passcode (about 3 minutes)

The dashboard stays locked until you do this.

1. In Cloudflare open **Workers & Pages > etsy-dashboard > Settings > Variables and Secrets**.
2. Tap **Add**. Type: **Secret**. Name: `DASHBOARD_PASSCODE`. Value: a passcode only you know. Make it long (12 or more characters). It is not a PIN, so do not use something like `1234`.
3. Tap **Deploy** (or **Save and deploy**).

**What you should see:** open your dashboard URL. A screen asks for the passcode. Type it. The dashboard opens with a yellow **SAMPLE DATA** banner and numbers that look like your shop. They are invented.

**If it fails:**

- *The page says "Almost there... no passcode is set"*: the secret name must be exactly `DASHBOARD_PASSCODE`, and you must press Deploy after adding it.
- *"Too many wrong tries"*: wait 15 minutes. After 5 wrong passcodes the door locks for a while. That is on purpose.

## Part 3. Create your Etsy developer app (about 10 minutes, then waiting)

1. Sign in to Etsy, then go to **https://www.etsy.com/developers/register**.
2. Create a new app. Suggested answers:
   - Name: `My shop dashboard`
   - Description: `Private read-only dashboard for my own shop.`
   - Who will use it: just yourself. It is not commercial.
3. Where it asks for a **Callback URL** (also called "redirect URI"), add your dashboard URL followed by `/auth/callback`. Example:
   `https://etsy-dashboard.YOUR-NAME.workers.dev/auth/callback`
   It must match exactly: `https`, no extra spaces, no slash at the end.
4. Etsy shows a **Keystring** and a **Shared secret**. Keep that page open for Part 4.

**What you should see:** your app listed at **https://www.etsy.com/developers/your-apps** with a keystring.

**Important:** Etsy reviews new apps. If the app says "Pending" or similar, the key will not work until Etsy approves it. This can take from minutes to days and is out of your hands. Keep using sample data until then.

**Never** paste the keystring or shared secret into GitHub, a chat, or any file in this project. They only go into Cloudflare, in the next step.

## Part 4. Give the keys to Cloudflare (about 3 minutes)

1. Cloudflare: **Workers & Pages > etsy-dashboard > Settings > Variables and Secrets**.
2. Add two more **Secrets**:

   | Name | Value |
   |---|---|
   | `ETSY_KEYSTRING` | the Keystring from Etsy |
   | `ETSY_SHARED_SECRET` | the Shared secret from Etsy |

3. Tap **Deploy**.

**What you should see:** in the dashboard, tap the gear icon (top right). The red "Etsy key not set yet" message is gone and there is a blue **Connect Etsy** button.

## Part 5. Connect your shop (about 2 minutes)

1. Open your dashboard URL **in Safari** and unlock it.
2. Tap the gear icon, then **Connect Etsy**.
3. Etsy asks if the app may *read* your shop, listings and transactions. Tap **Allow access** (or **Grant access**). The app only asks for read permissions. It cannot change your shop.
4. You land on a page that says **Etsy connected**. Tap **Open dashboard**.

**What you should see:** the yellow SAMPLE DATA banner is gone. The header shows your shop name and "Updated just now". From now on the data refreshes by itself once a day (about 6am Sydney time).

**If it fails:**

- *Etsy shows an error about `redirect_uri`*: the Callback URL in your Etsy app (Part 3, step 3) does not exactly match your dashboard URL + `/auth/callback`. Fix it on Etsy and try again.
- *"This login link is old..."*: you waited more than 10 minutes, or opened the link in a different browser. Start again from the gear icon.
- *"The login worked, but the first data pull failed"*: usually the Etsy app is still pending approval, or a key was pasted with a typo. Check Part 4, wait, then use **Refresh now** in Settings (once every 10 minutes).
- *Etsy says the API key is invalid*: re-check both secrets in Cloudflare for extra spaces. Add them again and Deploy.

## Part 6. Add it to your iPhone Home Screen (1 minute)

1. On your iPhone open the dashboard URL in **Safari** (not Chrome).
2. Tap the **Share** button (the square with an arrow pointing up).
3. Scroll down and tap **Add to Home Screen**, then **Add**.
4. Open the new **Shop** icon on your Home Screen and type your passcode once.

**What you should see:** the dashboard opens full screen with no Safari bars, like a normal app. It stays unlocked on that phone for 30 days.

Note: the Home Screen app keeps its own login, separate from Safari. Typing the passcode again there the first time is normal.

---

## Weekly habit (2 minutes)

Etsy does not share visits, traffic sources or ad spend through its API. Once a week:

1. On Etsy open **Shop Manager > Stats**. Note the visits (and where they came from).
2. In the dashboard tap the gear icon and type the visits under **Weekly numbers**.
3. If you run Etsy Ads, open **Marketing > Etsy Ads** on Etsy, set the dates to one week (Monday to Sunday), and either download the CSV and upload it on the dashboard's **Ads** screen, or copy the views, clicks, orders, revenue and spend in by hand. Adding the numbers per listing shows which ads earn and which lose money.

Numbers that depend on what you type show a small **estimated** tag. Numbers that cannot be shown say **missing data**. Nothing is made up.

## Optional: weekly Claude briefing

If you add one more secret named `ANTHROPIC_API_KEY` (from https://console.anthropic.com), the daily job writes a short plain-English summary once a week and shows it on the Today screen. It costs a few cents per briefing on your Anthropic account. Skip it if you like. Everything else works without it.

## Changing things later

- **New passcode:** change the `DASHBOARD_PASSCODE` secret and Deploy. Every device is logged out and needs the new one.
- **Updating the app:** any change pushed to the production branch on GitHub is rebuilt and deployed by Cloudflare automatically.
- **Disconnect Etsy:** gear icon > Disconnect Etsy. You can also remove the app at https://www.etsy.com/your/apps.
- **Lost your phone:** change `DASHBOARD_PASSCODE` straight away.
