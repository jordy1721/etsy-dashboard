// ---------------------------------------------------------------------------
// npm run icons
// Draws the app icon (a brush circle with a small chart) and saves it in the sizes the
// iPhone and the web manifest need. The PNG files are already in the repo,
// so you only need this if you want to change the icon.
// Needs Playwright (a browser automation tool) to turn the drawing into PNGs.
// ---------------------------------------------------------------------------
import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");

/**
 * The icon as an SVG drawing: a brush-stroke circle on parchment, matching the app's theme.
 * `pad` leaves extra room for "maskable" icons that get cropped to a circle.
 */
function iconSvg(size, pad) {
  const inner = 100 - pad * 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 100 100">
  <rect width="100" height="100" fill="#f3e9dc"/>
  <g transform="translate(${pad} ${pad}) scale(${inner / 100})" fill="none" stroke-linecap="round">
    <path d="M70 22C51 10 25 19 19 43 13 67 31 86 52 85 73 84 87 65 83 45 81 35 75 28 66 23" stroke="#2b211b" stroke-width="8"/>
    <path d="M68 23C54 16 33 22 26 41" stroke="#2b211b" stroke-width="3" opacity="0.4"/>
    <g fill="#964f2a" stroke="none">
      <rect x="38" y="52" width="6" height="14" rx="3"/>
      <rect x="48" y="44" width="6" height="22" rx="3"/>
      <rect x="58" y="36" width="6" height="30" rx="3"/>
    </g>
  </g>
</svg>`;
}

const files = [
  { name: "apple-touch-icon.png", size: 180, pad: 0 },
  { name: "icon-192.png", size: 192, pad: 0 },
  { name: "icon-512.png", size: 512, pad: 0 },
  { name: "icon-maskable-512.png", size: 512, pad: 12 },
];

mkdirSync("public/icons", { recursive: true });
const browser = await chromium.launch();
for (const file of files) {
  const page = await browser.newPage({ viewport: { width: file.size, height: file.size }, deviceScaleFactor: 1 });
  await page.setContent(`<style>html,body{margin:0}svg{display:block}</style>${iconSvg(file.size, file.pad)}`);
  await page.screenshot({ path: `public/icons/${file.name}` });
  await page.close();
  console.log(`Wrote public/icons/${file.name}`);
}
await browser.close();
