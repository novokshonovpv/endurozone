// Regenerates PNG icons for the web manifest and the Android app from apps/web/public/icon.svg.
// Usage from the repo root: node scripts/icons.mjs
import { createRequire } from "node:module";
import { mkdirSync, readFileSync } from "node:fs";
const require = createRequire(new URL("../apps/api/package.json", import.meta.url));
const sharp = require("sharp");
const svg = readFileSync(new URL("../apps/web/public/icon.svg", import.meta.url));
const out = (path) => new URL(`../${path}`, import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const targets = [
  ["apps/web/public/icon-192.png", 192],
  ["apps/web/public/icon-512.png", 512],
  ["apps/web/public/apple-touch-icon.png", 180],
  ...Object.entries({ mdpi: 48, hdpi: 72, xhdpi: 96, xxhdpi: 144, xxxhdpi: 192 }).map(
    ([density, size]) => [
      `apps/android/app/src/main/res/mipmap-${density}/ic_launcher.png`,
      size,
    ],
  ),
];
for (const [path, size] of targets) {
  const file = decodeURIComponent(out(path));
  mkdirSync(file.replace(/[\\/][^\\/]+$/, ""), { recursive: true });
  await sharp(svg, { density: 300 }).resize(size, size).png().toFile(file);
  console.log(size, path);
}
