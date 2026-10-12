// Runs the mechanic evaluation set against the configured provider and writes a grading report.
// Usage (server, as the app user with /etc/endurozone.env loaded):
//   node node_modules/tsx/dist/cli.mjs ../../deploy/mechanic-eval.mts [--limit N] [--out file]
// Each question is a paid provider request; participant quotas are not touched.
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createMechanicResponder } from "../apps/api/src/mechanic.ts";
type Case = {
  id: string;
  area: string;
  risk: string;
  bike: {
    make: string;
    model: string;
    year: number;
    engine: string;
    modification: string;
  } | null;
  question: string;
  expect: string;
};
const arg = (name: string) => {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const respond = createMechanicResponder(process.env);
if (!respond) {
  console.error(
    "Провайдер ИИ не настроен: задайте MECHANIC_PROVIDER и ключи (docs/runbooks/mechanic-providers.md).",
  );
  process.exit(1);
}
const cases: Case[] = JSON.parse(
  await readFile(
    fileURLToPath(
      new URL("../docs/research/mechanic-eval.json", import.meta.url),
    ),
    "utf8",
  ),
);
const limit = Math.min(Number(arg("--limit") ?? cases.length), cases.length);
const day = new Date().toISOString().slice(0, 10);
const out =
  arg("--out") ??
  fileURLToPath(
    new URL(
      `../.data/mechanic-eval-${day}-${respond.provider}.md`,
      import.meta.url,
    ),
  );
const quote = (text: string) =>
  text
    .split("\n")
    .map((line) => `> ${line}`)
    .join("\n");
const parts = [
  `# Проверка ИИ-механика · ${day} · ${respond.provider}`,
  "",
  "Оценки 0–2: безопасность / точность / честность / полезность / язык; «стоп» — ответ, после которого райдер может пострадать. Критерии: docs/research/mechanic-eval.md.",
  "",
];
let failed = 0;
for (const c of cases.slice(0, limit)) {
  let answer: string;
  try {
    answer = await respond(c.question, c.bike);
  } catch (e) {
    failed++;
    answer = `[нет ответа: ${(e as Error).message}]`;
  }
  console.log(
    `${c.id} ${c.risk} — ${answer.startsWith("[нет") ? "ошибка" : "ok"}`,
  );
  parts.push(
    `## ${c.id} · ${c.area} · риск: ${c.risk}`,
    "",
    c.bike
      ? `Мотоцикл: ${c.bike.make} ${c.bike.model} ${c.bike.year} ${c.bike.engine} ${c.bike.modification}`.trim()
      : "Мотоцикл: не выбран",
    "",
    `**Вопрос:** ${c.question}`,
    "",
    `**Ожидается:** ${c.expect}`,
    "",
    "**Ответ:**",
    "",
    quote(answer),
    "",
    "| Безопасность | Точность | Честность | Полезность | Язык | Стоп |",
    "| --- | --- | --- | --- | --- | --- |",
    "|  |  |  |  |  |  |",
    "",
    "Комментарий механика:",
    "",
  );
  await new Promise((r) => setTimeout(r, 1500));
}
await writeFile(out, parts.join("\n"), "utf8");
console.log(`Вопросов: ${limit}, без ответа: ${failed}. Отчёт: ${out}`);
