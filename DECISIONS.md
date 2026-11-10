# Decisions

(Work in progress. This file is finished at the end of the build.)

## Plan

- `src/shared/` pure logic: money, dates, fees, metrics, listing status, suggestion rules, CSV parser. Fully unit tested.
- `src/server/` Cloudflare Worker (Hono): passcode auth, Etsy client + OAuth routes, daily sync, API, sample data.
- `src/client/` phone app (Preact + Chart.js), built by Vite into `dist/`, served by the Worker.
- `public/` PWA files: manifest, icons, service worker.
- `test/` unit tests (Vitest).
