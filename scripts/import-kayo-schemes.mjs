// Links our KAYO models to the official parts schemes on kayo.ru (apps/api/data/external-schemes.json).
// Only the scheme page address and its title are kept: kayo.ru allows using its content only with
// written consent, so diagrams and part tables stay there and riders open them on the brand's site.
// A link is added only for an exact name match (ignoring the year and "кроссовый"), never a guess.
// Usage from the repo root: node scripts/import-kayo-schemes.mjs
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const html = await (await fetch("https://kayo.ru/schemes/")).text();
const schemes = new Map();
for (const m of html.matchAll(
  /href="\/schemes\/(\d+)\/"[^>]*>\s*([^<]{3,160})</g,
))
  if (m[2].trim()) schemes.set(m[1], m[2].trim());
const norm = (s) =>
  s
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/к(?=\d)/g, "k") // Cyrillic К in "К125EM"
    .replace(/\((19|20)\d\d\)/g, " ")
    .replace(
      /(^|\s)(мотоцикл|кроссовый|питбайк|детский|квадроцикл|kayo)(?=\s|$)/g,
      " ",
    )
    .replace(/\s+/g, " ")
    .trim();
const byName = new Map();
for (const [id, title] of schemes) byName.set(norm(title), { id, title });

const modelsFile = join(process.cwd(), "apps", "api", "data", "models.json");
const { models } = JSON.parse(readFileSync(modelsFile, "utf8"));
const out = join(process.cwd(), "apps", "api", "data", "external-schemes.json");
const links = existsSync(out)
  ? JSON.parse(readFileSync(out, "utf8")).links
  : {};
for (const [slug, link] of Object.entries(links))
  if (link.source === "KAYO") delete links[slug];
let matched = 0;
for (const m of models.filter((x) => x.brand.toUpperCase() === "KAYO")) {
  const hit = byName.get(norm(m.title));
  if (!hit) continue;
  links[m.slug] = {
    source: "KAYO",
    title: hit.title,
    url: `https://kayo.ru/schemes/${hit.id}/`,
  };
  matched++;
}
writeFileSync(
  out,
  JSON.stringify({ updatedAt: new Date().toISOString(), links }, null, 1) +
    "\n",
);
console.log(`kayo.ru schemes: ${schemes.size}, linked models: ${matched}`);
