// Renders the link-preview picture apps/web/public/og.png (1200×630) in the site's olive
// and ochre palette. Usage from the repo root: node scripts/og-image.mjs
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
const require = createRequire(
  new URL("../apps/api/package.json", import.meta.url),
);
const sharp = require("sharp");
const font = "Segoe UI, Arial, sans-serif";
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#3a4124"/><stop offset="1" stop-color="#1f2414"/>
    </linearGradient>
    <radialGradient id="sun" cx="0.82" cy="0.18" r="0.55">
      <stop offset="0" stop-color="#e3b04b" stop-opacity="0.55"/><stop offset="1" stop-color="#e3b04b" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="mark" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#e9bd5c"/><stop offset="1" stop-color="#c9892b"/>
    </linearGradient>
  </defs>
  <rect width="1200" height="630" fill="url(#bg)"/>
  <rect width="1200" height="630" fill="url(#sun)"/>
  <path d="M0 520 L170 410 L270 470 L430 330 L560 440 L700 360 L820 450 L980 300 L1200 470 L1200 630 L0 630 Z" fill="#2a301b" opacity="0.9"/>
  <path d="M0 575 L220 480 L380 540 L560 455 L760 545 L930 470 L1200 560 L1200 630 L0 630 Z" fill="#171b0f"/>
  <path d="M120 600 C 320 560, 470 610, 640 570 S 980 540, 1110 590" fill="none" stroke="#e3b04b" stroke-width="5" stroke-linecap="round" stroke-dasharray="2 18" opacity="0.8"/>
  <rect x="96" y="96" width="112" height="112" rx="30" fill="url(#mark)"/>
  <text x="152" y="172" text-anchor="middle" font-family="${font}" font-weight="800" font-size="50" fill="#2f3520">EZ</text>
  <text x="96" y="318" font-family="${font}" font-weight="800" font-size="96" letter-spacing="-2" fill="#f4f1e4">ENDURO<tspan fill="#e3b04b">.ZONE</tspan></text>
  <text x="100" y="384" font-family="${font}" font-weight="600" font-size="38" fill="#dcdac4">Места, трассы, гонки и покатушки</text>
  <text x="100" y="436" font-family="${font}" font-weight="500" font-size="28" fill="#a7a684">Россия · Беларусь</text>
</svg>`;
const out = fileURLToPath(
  new URL("../apps/web/public/og.png", import.meta.url),
);
await sharp(Buffer.from(svg)).png({ compressionLevel: 9 }).toFile(out);
console.log("og.png written");
