// ---------------------------------------------------------------------------
// Small stand-alone pages the Worker sends itself:
// the passcode screen, the "Etsy connected" result page and a setup warning.
// (The real dashboard is the built app in ./dist.)
// ---------------------------------------------------------------------------

/** Make text safe to put inside HTML. */
export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch] ?? ch);
}

const HEAD = `<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#f4f3ef" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#121211" media="(prefers-color-scheme: dark)">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="default">
<meta name="apple-mobile-web-app-title" content="Shop">
<meta name="robots" content="noindex, nofollow">
<link rel="manifest" href="/manifest.webmanifest">
<link rel="apple-touch-icon" href="/icons/apple-touch-icon.png">
<link rel="icon" href="/icons/icon-192.png">
<style>
  :root { color-scheme: light dark; --bg:#f4f3ef; --card:#ffffff; --text:#141413; --muted:#5f5e5a; --line:#dddbd3; --accent:#1f5fbf; --bad:#b3261e; }
  @media (prefers-color-scheme: dark) { :root { --bg:#121211; --card:#1d1d1b; --text:#f0efec; --muted:#a9a79f; --line:#34332f; --accent:#6ea8f5; --bad:#f2867f; } }
  * { box-sizing: border-box; }
  html, body { height: 100%; }
  body { margin:0; background:var(--bg); color:var(--text); font: 17px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    display:flex; align-items:center; justify-content:center;
    padding: calc(20px + env(safe-area-inset-top)) calc(20px + env(safe-area-inset-right)) calc(20px + env(safe-area-inset-bottom)) calc(20px + env(safe-area-inset-left)); }
  main { width:100%; max-width:380px; background:var(--card); border:1px solid var(--line); border-radius:20px; padding:28px 22px; text-align:center; }
  img { width:72px; height:72px; border-radius:16px; }
  h1 { font-size:22px; margin:14px 0 4px; }
  p { color:var(--muted); margin:6px 0 18px; }
  input { width:100%; font-size:20px; padding:14px; border-radius:12px; border:1px solid var(--line); background:var(--bg); color:var(--text); text-align:center; }
  button, a.button { display:block; width:100%; margin-top:14px; font-size:18px; font-weight:600; padding:14px; min-height:52px; border-radius:12px; border:0;
    background:var(--accent); color:#fff; text-decoration:none; }
  @media (prefers-color-scheme: dark) { button, a.button { color:#0b1a30; } }
  button:disabled { opacity:.6; }
  .error { color:var(--bad); min-height:24px; margin:12px 0 0; font-weight:600; }
  code { background:var(--bg); padding:2px 6px; border-radius:6px; font-size:15px; }
</style>`;

/** The passcode screen. */
export function loginPage(): string {
  return `<!doctype html><html lang="en"><head><title>Shop dashboard</title>${HEAD}</head><body>
<main>
  <img src="/icons/icon-192.png" alt="">
  <h1>Shop dashboard</h1>
  <p>Enter your passcode to continue.</p>
  <form id="form">
    <input id="passcode" type="password" autocomplete="current-password" aria-label="Passcode" placeholder="Passcode" required autofocus>
    <button id="go" type="submit">Unlock</button>
    <div class="error" id="error" role="alert"></div>
  </form>
  <p style="margin:14px 0 0;font-size:14px">This device stays unlocked for 30 days.</p>
</main>
<script>
  var form = document.getElementById("form");
  var errorBox = document.getElementById("error");
  var button = document.getElementById("go");
  form.addEventListener("submit", function (event) {
    event.preventDefault();
    button.disabled = true;
    errorBox.textContent = "";
    fetch("/api/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ passcode: document.getElementById("passcode").value })
    }).then(function (res) {
      if (res.ok) { window.location.replace("/"); return; }
      return res.json().then(function (data) {
        errorBox.textContent = data.error || "That did not work. Try again.";
        button.disabled = false;
      });
    }).catch(function () {
      errorBox.textContent = "No connection. Try again.";
      button.disabled = false;
    });
  });
</script>
</body></html>`;
}

/** A simple message page with one button (used after the Etsy login, and for errors). */
export function messagePage(title: string, message: string, buttonLabel = "Open dashboard", buttonHref = "/"): string {
  return `<!doctype html><html lang="en"><head><title>${escapeHtml(title)}</title>${HEAD}</head><body>
<main>
  <img src="/icons/icon-192.png" alt="">
  <h1>${escapeHtml(title)}</h1>
  <p>${message}</p>
  <a class="button" href="${escapeHtml(buttonHref)}">${escapeHtml(buttonLabel)}</a>
</main>
</body></html>`;
}

/** Shown when the passcode secret has not been set yet. The dashboard stays locked. */
export function notConfiguredPage(): string {
  return messagePage(
    "Almost there",
    "The dashboard is locked because no passcode is set yet.<br><br>In Cloudflare, open this Worker, go to <b>Settings</b> &gt; <b>Variables and Secrets</b>, add a <b>Secret</b> named <code>DASHBOARD_PASSCODE</code>, then reload this page. SETUP.md has the steps.",
    "Reload",
    "/",
  );
}
