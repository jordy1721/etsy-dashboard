// ---------------------------------------------------------------------------
// SERVICE WORKER (makes the app open fast, like a real app)
// It keeps a copy of the app's own files (the "shell"): HTML, JS, CSS, icons.
// It NEVER stores your shop data: anything under /api/ always goes to the
// network, and so do the login pages.
// ---------------------------------------------------------------------------
const CACHE = "shell-v1";

self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) => Promise.all(names.filter((n) => n !== CACHE).map((n) => caches.delete(n))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  // Private or login-related: do not touch.
  if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/auth/") || url.pathname === "/login") return;

  // Opening the app: try the network first so you always get the newest
  // version, and fall back to the saved copy when the connection is bad.
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          // Only keep a real page (not a redirect to the login screen).
          if (response.ok && response.type === "basic" && !response.redirected) {
            const copy = response.clone();
            caches.open(CACHE).then((cache) => cache.put("/", copy));
          }
          return response;
        })
        .catch(() => caches.match("/").then((cached) => cached || Response.error())),
    );
    return;
  }

  // Built files have a unique name per version, so a saved copy is always right.
  if (url.pathname.startsWith("/assets/") || url.pathname.startsWith("/icons/")) {
    event.respondWith(
      caches.match(request).then(
        (cached) =>
          cached ||
          fetch(request).then((response) => {
            if (response.ok && response.type === "basic") {
              const copy = response.clone();
              caches.open(CACHE).then((cache) => cache.put(request, copy));
            }
            return response;
          }),
      ),
    );
  }
});
