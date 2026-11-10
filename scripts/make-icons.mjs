// ---------------------------------------------------------------------------
// npm run icons
// Draws the app icon (a simple bar chart) and saves it in the sizes the
// iPhone and the web manifest need. The PNG files are already in the repo,
// so you only need this if you want to change the icon.
// Needs Playwright (a browser automation tool) to turn the drawing into PNGs.
// ---------------------------------------------------------------------------
import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");

/** The icon as an SVG drawing. `pad` leaves extra room for "maskable" icons that get cropped to a circle. */
function iconSvg(size, pad) {
  const inner = 100 - pad * 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 100 100">
  <rect width="100" height="100" fill="#1f5fbf"/>
  <g transform="translate(${pad} ${pad}) scale(${inner / 100})">
    <rect x="22" y="56" width="13" height="24" rx="4" fill="#ffffff" opacity="0.75"/>
    <rect x="43.5" y="40" width="13" height="40" rx="4" fill="#ffffff" opacity="0.9"/>
    <rect x="65" y="22" width="13" height="58" rx="4" fill="#ffffff"/>
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
