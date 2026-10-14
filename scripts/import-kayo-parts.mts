// Fills node part lists for KAYO models from the brand's schemes on kayo.ru.
// 67МОТО is a KAYO dealer and may use this data (owner's statement, 13.10.2026).
// Taken: position on the scheme, part name and quantity per node. Not taken: images, articles, prices.
// Usage from the repo root (needs the links from scripts/import-kayo-schemes.mjs):
//   node apps/api/node_modules/tsx/dist/cli.mjs scripts/import-kayo-parts.mts
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { engineKeyOf } from "../apps/api/src/parts.ts";

type Item = {
  scope: "moto" | "engine";
  key: string;
  node: string;
  position: string;
  name: string;
  article: string;
  qty: number | null;
  note: string;
  source: string;
};
const data = join(process.cwd(), "apps", "api", "data");
const { links } = JSON.parse(
  readFileSync(join(data, "external-schemes.json"), "utf8"),
) as { links: Record<string, { source: string; url: string; title: string }> };

// KAYO node → our node. Engine parts are spread over our engine nodes by their names.
const motoMap: Record<string, string> = {
  руль: "handlebar",
  "передняя тормозная система": "handlebar",
  "задняя тормозная система": "controls",
  "педаль тормоза": "controls",
  "педаль переключения": "controls",
  "передняя подвеска": "fork",
  траверсы: "steering",
  "переднее колесо": "wheel_front",
  "заднее колесо": "wheel_rear",
  рама: "frame",
  маятник: "swingarm",
  "задняя подвеска": "shock",
  подножки: "footpegs",
  "подножки водителя": "footpegs",
  глушитель: "exhaust",
  "выхлопная система": "exhaust",
  электрика: "electrics",
  фара: "electrics",
  "топливная система": "tank_seat",
  "топливный бак": "tank_seat",
  сиденье: "tank_seat",
  пластик: "bodywork",
  наклейки: "bodywork",
  // Older schemes name the same nodes differently.
  "тормоз передний": "handlebar",
  "передний тормоз": "handlebar",
  "рычаг тормоза": "handlebar",
  "тормозная система": "handlebar",
  "тормоз задний": "controls",
  "задний тормоз": "controls",
  "амортизаторы передние": "fork",
  траверса: "steering",
  "колесо переднее": "wheel_front",
  "колесо заднее": "wheel_rear",
  ступицы: "wheel_rear",
  "вспомогательные колеса": "wheel_rear",
  "подвеска задняя": "shock",
  "амортизатор задний": "shock",
  "задний амортизатор": "shock",
  "подножки, защита": "footpegs",
  сидение: "tank_seat",
  стропы: "frame",
  багажник: "frame",
  брызговик: "bodywork",
  "приборка, зеркала, поворотники": "electrics",
};
// Whole KAYO nodes that belong to our engine nodes.
const engineFixed: Record<string, string> = {
  "воздушный фильтр": "intake",
  карбюратор: "intake",
  "система охлаждения": "cooling",
};
const engineRules: [string, RegExp][] = [
  ["starter", /стартер|кикстарт|бендикс|обгонн/],
  [
    "head",
    /клапан|распредвал|головк|коромысл|толкател|натяжител|успокоител|цепь грм|звезда распред/,
  ],
  ["cylinder", /цилиндр|поршн|поршен|кольц|палец/],
  ["crank", /коленвал|колен\. вал|шатун|балансир/],
  ["clutch", /сцеплен|фрикцион|корзин/],
  [
    "gearbox",
    /передач|кпп|первичн|вторичн|шестерн|вилка переключ|барабан|вал переключ/,
  ],
  ["ignition", /генератор|статор|ротор|магнето|катушк|свеч|датчик|коммутатор/],
  ["intake", /карбюратор|впуск|дроссел|форсунк|инжектор|воздушн/],
  ["lube", /масл|щуп/],
  ["cooling", /помп|радиатор|охлажд|термостат|антифриз/],
];
const engineNode = (name: string) =>
  engineRules.find(([, rule]) => rule.test(name.toLowerCase()))?.[0] ??
  "covers";

const cache = new Map<string, string>();
async function page(url: string) {
  if (!cache.has(url)) {
    // Polite: one request at a time with a pause.
    await new Promise((r) => setTimeout(r, 350));
    // A dropped connection is retried a few times with a growing pause.
    for (let attempt = 1; ; attempt++) {
      try {
        const res = await fetch(url, {
          headers: { "user-agent": "EnduroZone parts import (67moto dealer)" },
          signal: AbortSignal.timeout(30_000),
        });
        if (!res.ok) throw new Error(`${res.status} ${url}`);
        cache.set(url, await res.text());
        break;
      } catch (e) {
        if (attempt >= 4) throw e;
        console.warn(`retry ${attempt}: ${url}`);
        await new Promise((r) => setTimeout(r, 2000 * attempt));
      }
    }
  }
  return cache.get(url)!;
}
const text = (s: string) =>
  s
    .replace(/<[^>]+>/g, " ")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/&#0?39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
// "Кронштейн траверсы нижний KAYO +K1MX,T2MX(2022-)" → name + applicability note.
function split(raw: string) {
  const at = raw.search(/\sKAYO\b/i);
  return at > 0
    ? {
        name: raw.slice(0, at).trim(),
        note: raw
          .slice(at)
          .replace(/^\s*KAYO\s*/i, "")
          .trim(),
      }
    : { name: raw, note: "" };
}
const items: Item[] = [];
const unmapped = new Map<string, number>();
const seen = new Set<string>();
let models = 0,
  noEngine = 0;
for (const [slug, link] of Object.entries(links)) {
  if (link.source !== "KAYO") continue;
  const html = await page(link.url);
  const base = new URL(link.url).pathname;
  const nodes = new Map<string, string>();
  for (const m of html.matchAll(
    new RegExp(`href="(${base}\\d+/)"[^>]*>\\s*([^<]{2,80})<`, "g"),
  ))
    if (m[2].trim()) nodes.set(m[1], m[2].trim());
  const engineKey = engineKeyOf(slug);
  models++;
  for (const [path, title] of nodes) {
    const t = title.toLowerCase();
    const isEngine = t === "двигатель" || t in engineFixed;
    if (!isEngine && !motoMap[t]) {
      unmapped.set(title, (unmapped.get(title) ?? 0) + 1);
      continue;
    }
    if (isEngine && !engineKey) {
      noEngine++;
      continue;
    }
    const nodeHtml = await page(new URL(path, link.url).toString());
    for (const chunk of nodeHtml.split('class="detailed__item"').slice(1)) {
      const position = text(
        /detailed__item-num">([^<]*)</.exec(chunk)?.[1] ?? "",
      );
      const raw = text(
        /class="detailed__link">([\s\S]*?)<\/a>/.exec(chunk)?.[1] ?? "",
      );
      const qtyRaw = /detailed__count">[\s\S]*?<\/span>\s*([\d.,]+)/.exec(
        chunk,
      )?.[1];
      if (!raw) continue;
      const { name, note } = split(raw);
      const scope = isEngine ? "engine" : "moto";
      const key = isEngine ? engineKey! : slug;
      const node = isEngine ? (engineFixed[t] ?? engineNode(name)) : motoMap[t];
      // Engines shared by several models get each part once.
      const id = `${scope}|${key}|${node}|${position}|${name}`;
      if (seen.has(id)) continue;
      seen.add(id);
      items.push({
        scope,
        key,
        node,
        position,
        name,
        article: "",
        qty: qtyRaw ? Number(qtyRaw.replace(",", ".")) : null,
        note,
        source: "KAYO",
      });
    }
  }
  console.log(`${slug}: ${nodes.size} узлов`);
}
const out = join(data, "parts.json");
const kept = existsSync(out)
  ? (JSON.parse(readFileSync(out, "utf8")).items as Item[]).filter(
      (i) => i.source !== "KAYO",
    )
  : [];
writeFileSync(
  out,
  JSON.stringify({
    importedAt: new Date().toISOString(),
    items: [...kept, ...items],
  }) + "\n",
);
const byNode = new Map<string, number>();
for (const i of items)
  byNode.set(
    `${i.scope}/${i.node}`,
    (byNode.get(`${i.scope}/${i.node}`) ?? 0) + 1,
  );
console.log(
  `models: ${models}, parts: ${items.length}, engine lists skipped (no engine code): ${noEngine}`,
);
console.log("by node:", Object.fromEntries([...byNode].sort()));
console.log("KAYO nodes not in our structure:", Object.fromEntries(unmapped));
