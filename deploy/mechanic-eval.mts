// Runs the mechanic evaluation set against the configured provider and writes a grading report.
// Usage from the repo root (keys in the git-ignored .env.mechanic, see docs/runbooks/mechanic-providers.md):
//   npm run mechanic:eval -- --models      free: checks the OpenAI key and region, lists model ids
//   npm run mechanic:eval -- --limit 1     one paid question first
//   npm run mechanic:eval                  all 50 questions
// Each question is a paid provider request; participant quotas are not touched.
// Three failures in a row stop the run so a bad key or blocked region does not burn through the set.
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
if (process.argv.includes("--models")) {
  const key = process.env.OPENAI_API_KEY?.trim();
  if (!key) {
    console.error(
      "OPENAI_API_KEY не задан (файл .env.mechanic в корне проекта).",
    );
    process.exit(1);
  }
  const result = await fetch("https://api.openai.com/v1/models", {
    headers: { Authorization: `Bearer ${key}` },
    signal: AbortSignal.timeout(30_000),
  });
  const body = (await result.json().catch(() => ({}))) as {
    data?: { id: string }[];
    error?: { code?: string; message?: string };
  };
  if (!result.ok) {
    console.error(
      `OpenAI ответил HTTP ${result.status}: ${body.error?.code ?? ""} ${body.error?.message ?? ""}`.trim(),
    );
    process.exit(1);
  }
  console.log("Ключ работает. Доступные модели:");
  for (const id of (body.data ?? []).map((m) => m.id).sort())
    console.log(" ", id);
  process.exit(0);
}
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
let inRow = 0;
let asked = 0;
for (const c of cases.slice(0, limit)) {
  let answer: string;
  asked++;
  try {
    answer = await respond(c.question, c.bike);
    inRow = 0;
  } catch (e) {
    failed++;
    inRow++;
    answer = `[нет ответа: ${(e as Error).message}]`;
  }
  console.log(
    `${c.id} ${c.risk} — ${answer.startsWith("[нет") ? answer : "ok"}`,
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
  if (inRow >= 3) {
    console.error(
      "Три ошибки подряд — проверка остановлена. Проверьте ключ, модель и регион: npm run mechanic:eval -- --models",
    );
    break;
  }
  await new Promise((r) => setTimeout(r, 1500));
}
await writeFile(out, parts.join("\n"), "utf8");
console.log(`Вопросов: ${asked}, без ответа: ${failed}. Отчёт: ${out}`);
