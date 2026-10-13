// Builds the motorcycle model reference (apps/api/data/models.json) from the 67МОТО catalog.
// 67moto.ru is the owner's own dealer site; photos stay there and are linked, not copied.
// Usage from the repo root: node scripts/import-67moto-models.mjs [path-to-67moto-repo]
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const src = process.argv[2] ?? join(process.cwd(), "..", "67moto");
const site = "https://67moto.ru";
// Motorcycles only: no ATVs, snowmobiles, scooters or gear.
const sections = {
  enduro: "Эндуро",
  pit: "Питбайк",
  road: "Дорожный",
  electro: "Электро",
  mini: "Минибайк",
};
const catalog = JSON.parse(
  readFileSync(join(src, "data", "catalog.json"), "utf8"),
);

const entities = {
  nbsp: " ",
  ndash: "–",
  mdash: "—",
  laquo: "«",
  raquo: "»",
  ldquo: "“",
  rdquo: "”",
  bdquo: "„",
  lsquo: "‘",
  rsquo: "’",
  hellip: "…",
  amp: "&",
  quot: '"',
  apos: "'",
  lt: "<",
  gt: ">",
  deg: "°",
  times: "×",
  plusmn: "±",
  sup2: "²",
  sup3: "³",
  middot: "·",
};
const decode = (s) =>
  s
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) =>
      String.fromCodePoint(parseInt(n, 16)),
    )
    .replace(/&([a-z0-9]+);/gi, (m, n) => entities[n.toLowerCase()] ?? m);
// HTML description → plain paragraphs (no markup reaches our pages).
function plain(html) {
  if (!html) return "";
  const text = decode(
    html
      .replace(/<(script|style)[\s\S]*?<\/\1>/gi, "")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(p|li|h\d|div|tr)>/gi, "\n")
      .replace(/<li[^>]*>/gi, "• ")
      .replace(/<[^>]+>/g, ""),
  );
  const paragraphs = text
    .split("\n")
    .map((l) => l.replace(/\s+/g, " ").trim())
    .filter(Boolean);
  let out = "";
  for (const p of paragraphs) {
    if ((out + "\n" + p).length > 3000) break;
    out += (out ? "\n" : "") + p;
  }
  return out;
}
const typeWords =
  /^(детский|детская|подростковый|взрослый)?\s*(электрический|дорожный|кроссовый|спортивный)?\s*(мотоцикл|питбайк|электромотоцикл|электропитбайк|минибайк|мопед|скутер|эндуро)\s+((кросс|кроссовый|дорожный|туристический|эндуро|мото)\s+)*/i;
function modelName(title, brand) {
  let m = title
    .replace(typeWords, "")
    .replace(/^(кросс|moto)\s+/i, "")
    .trim();
  const b = brand.toLowerCase().replace(/\s+/g, "");
  const first = m.split(/\s+/)[0].toLowerCase();
  if (first === b) m = m.slice(m.indexOf(" ") + 1);
  m = m
    .replace(/\s*\((19|20)\d\d\)\s*$/, "")
    .replace(/\s+(с\s+птс|без\s+птс|птс)\s*$/i, "")
    .trim();
  return m || title;
}
// "27 л.с." / "21,5 л.с. / 8500 об/мин" in the specs when the list has no power.
function hpFromSpecs(specs = []) {
  const row = specs.find(([k]) => /мощност/i.test(String(k)));
  const n = row && /(\d+(?:[.,]\d+)?)\s*л\.?\s*с/i.exec(String(row[1]));
  return n ? Number(n[1].replace(",", ".")) : null;
}

const models = [];
for (const p of catalog.products) {
  if (!sections[p.section] || /квадроцикл|игрушка/i.test(p.title)) continue;
  const file = join(src, "data", "p", `${p.slug}.json`);
  const d = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : {};
  const year = /\(((?:19|20)\d\d)\)/.exec(p.title)?.[1];
  const images = (d.images?.length ? d.images : p.img ? [p.img] : [])
    .slice(0, 6)
    .map((i) => `${site}/${i}`);
  // A few products have no brand in the list: the title starts with it.
  const brand =
    p.brand?.trim() || p.title.replace(typeWords, "").split(/\s+/)[0];
  models.push({
    slug: p.slug,
    brand,
    model: modelName(p.title, brand),
    title: p.title,
    section: p.section,
    sectionLabel: sections[p.section],
    year: year ? Number(year) : null,
    cc: Number(p.f?.cc ?? p.cc) || null,
    hp: Number(p.hp) || hpFromSpecs(d.specs),
    images,
    description: plain(d.description),
    specs: (d.specs ?? [])
      .filter(([k, v]) => k && v && String(v).length <= 200)
      .slice(0, 40)
      .map(([k, v]) => [decode(String(k)).trim(), decode(String(v)).trim()]),
    url: `${site}/#p-${p.slug}`,
  });
}
// One spelling per brand (the catalog has both FullCrew and FULLCREW): the most frequent wins.
const spellings = new Map();
for (const m of models) {
  const key = m.brand.toLowerCase();
  const counts = spellings.get(key) ?? new Map();
  counts.set(m.brand, (counts.get(m.brand) ?? 0) + 1);
  spellings.set(key, counts);
}
for (const m of models)
  m.brand = [...spellings.get(m.brand.toLowerCase())].sort(
    (a, b) => b[1] - a[1],
  )[0][0];
models.sort(
  (a, b) =>
    a.brand.localeCompare(b.brand, "ru") ||
    a.model.localeCompare(b.model, "ru"),
);
const out = join(process.cwd(), "apps", "api", "data");
mkdirSync(out, { recursive: true });
writeFileSync(
  join(out, "models.json"),
  JSON.stringify({
    source: site,
    importedFrom: catalog.updated ?? null,
    count: models.length,
    models,
  }) + "\n",
);
console.log(
  `models: ${models.length}, brands: ${new Set(models.map((m) => m.brand)).size}`,
);
