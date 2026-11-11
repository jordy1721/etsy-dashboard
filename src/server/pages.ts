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
<meta name="theme-color" content="#f3e9dc" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#1b1613" media="(prefers-color-scheme: dark)">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="default">
<meta name="apple-mobile-web-app-title" content="Shop">
<meta name="robots" content="noindex, nofollow">
<link rel="manifest" href="/manifest.webmanifest">
<link rel="apple-touch-icon" href="/icons/apple-touch-icon.png">
<link rel="icon" href="/icons/icon-192.png">
<style>
  /* Same ink-wash theme as the app: parchment, serif type, dark umber buttons. */
  :root { color-scheme: light dark; --bg:#f3e9dc; --bg2:#ecdfce; --card:#fbf4ea; --field:#fffcf7; --text:#2b211b; --muted:#76655a; --line:rgba(92,64,45,.18); --accent:#46312a; --on:#fbf3ea; --bad:#a23b28; }
  @media (prefers-color-scheme: dark) { :root { --bg:#1b1613; --bg2:#15110f; --card:#29211c; --field:#1b1613; --text:#f1e6da; --muted:#b3a294; --line:rgba(241,222,202,.16); --accent:#e8d2ba; --on:#2b211b; --bad:#f0988a; } }
  * { box-sizing: border-box; }
  html, body { height: 100%; }
  body { margin:0; background:linear-gradient(180deg,var(--bg),var(--bg2)); color:var(--text);
    font: 18px/1.5 "Iowan Old Style", "Palatino Linotype", Palatino, "Book Antiqua", Georgia, serif;
    display:flex; align-items:center; justify-content:center;
    padding: calc(20px + env(safe-area-inset-top)) calc(20px + env(safe-area-inset-right)) calc(20px + env(safe-area-inset-bottom)) calc(20px + env(safe-area-inset-left)); }
  main { width:100%; max-width:400px; background:var(--card); border:1px solid var(--line); border-radius:24px; padding:32px 24px; text-align:center;
    box-shadow: 0 8px 28px rgba(70,49,42,.08); }
  img { width:76px; height:76px; border-radius:18px; }
  h1 { font-size:28px; font-weight:600; letter-spacing:-.01em; margin:14px 0 4px; }
  p { color:var(--muted); margin:6px 0 18px; }
  input { width:100%; font:inherit; font-size:20px; padding:14px; border-radius:14px; border:1px solid var(--line); background:var(--field); color:var(--text); text-align:center; }
  button, a.button { display:block; width:100%; margin-top:14px; font:inherit; font-size:19px; font-weight:600; padding:13px; min-height:52px; border-radius:999px; border:0;
    background:var(--accent); color:var(--on); text-decoration:none; cursor:pointer; }
  button:disabled { opacity:.6; }
  .error { color:var(--bad); min-height:26px; margin:12px 0 0; font-weight:600; }
  code { background:var(--bg); padding:2px 6px; border-radius:6px; font: 15px ui-monospace, Menlo, monospace; }
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
