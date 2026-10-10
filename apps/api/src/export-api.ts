import { mkdir, writeFile } from "node:fs/promises";
import { openDatabase } from "./database.ts";
import { buildApp } from "./app.ts";
const db = await openDatabase();
const app = await buildApp({ db });
try {
  await app.ready();
  await mkdir(new URL("../../../docs/api/", import.meta.url), {
    recursive: true,
  });
  await writeFile(
    new URL("../../../docs/api/openapi.json", import.meta.url),
    JSON.stringify(app.swagger(), null, 2) + "\n",
  );
  console.log("OpenAPI exported to docs/api/openapi.json");
} finally {
  await app.close();
  await db.close();
}
