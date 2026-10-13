// Builds supplier part tables for the parts selection (apps/api/data/parts.json) from CSV files.
// Only data we have the right to use: a supplier's permission or our own tables.
// Usage from the repo root: node scripts/import-parts.mjs <folder-with-csv> [out.json]
// CSV (UTF-8, comma or semicolon, header row as in docs/parts-template.csv):
//   scope    moto | engine
//   key      model slug for moto (see /api/models), engine code for engine (e.g. 172FMM-3A)
//   node     moto: bodywork frame exhaust footpegs controls steering handlebar fork shock swingarm
//                  wheel_front wheel_rear electrics tank_seat
//            engine: head cylinder crank clutch gearbox ignition starter intake lube cooling covers
//   position, name, article, qty, note
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const nodes = {
  moto: "bodywork frame exhaust footpegs controls steering handlebar fork shock swingarm wheel_front wheel_rear electrics tank_seat".split(
    " ",
  ),
  engine:
    "head cylinder crank clutch gearbox ignition starter intake lube cooling covers".split(
      " ",
    ),
};
const dir = process.argv[2];
if (!dir) {
  console.error("Укажите папку с CSV: node scripts/import-parts.mjs <папка>");
  process.exit(1);
}
// Quoted fields with the separator or quotes inside are supported.
function parse(text, sep) {
  const rows = [];
  let row = [],
    cell = "",
    quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === sep) {
      row.push(cell);
      cell = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += c;
  }
  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((r) => r.some((x) => x.trim()));
}
const items = [];
const problems = [];
for (const file of readdirSync(dir).filter((f) =>
  f.toLowerCase().endsWith(".csv"),
)) {
  const text = readFileSync(join(dir, file), "utf8").replace(/^﻿/, "");
  const sep =
    (text.split("\n")[0].match(/;/g) ?? []).length >
    (text.split("\n")[0].match(/,/g) ?? []).length
      ? ";"
      : ",";
  const [head, ...rows] = parse(text, sep);
  const col = Object.fromEntries(
    head.map((h, i) => [h.trim().toLowerCase(), i]),
  );
  for (const need of ["scope", "key", "node", "name"])
    if (!(need in col)) problems.push(`${file}: нет колонки ${need}`);
  rows.forEach((r, n) => {
    const get = (k) => (k in col ? (r[col[k]] ?? "").trim() : "");
    const scope = get("scope"),
      node = get("node");
    if (!nodes[scope]?.includes(node)) {
      problems.push(`${file}:${n + 2}: неизвестный узел ${scope}/${node}`);
      return;
    }
    const qty = Number(get("qty").replace(",", "."));
    items.push({
      scope,
      key:
        scope === "engine"
          ? get("key")
              .toUpperCase()
              .replace(/^ZS(?=\d)/, "")
          : get("key"),
      node,
      position: get("position"),
      name: get("name"),
      article: get("article"),
      qty: Number.isFinite(qty) && get("qty") ? qty : null,
      note: get("note"),
    });
  });
}
for (const p of problems) console.warn(p);
// Optional second argument: where to write (default apps/api/data/parts.json).
const out =
  process.argv[3] ?? join(process.cwd(), "apps", "api", "data", "parts.json");
writeFileSync(
  out,
  JSON.stringify({ importedAt: new Date().toISOString(), items }) + "\n",
);
console.log(`parts: ${items.length}, problems: ${problems.length} → ${out}`);
