import { buildApp } from "./app.ts";
import { openDatabase } from "./database.ts";
import { fileURLToPath } from "node:url";
import { existsSync, mkdirSync } from "node:fs";

const envPath = fileURLToPath(new URL("../../../.env", import.meta.url));
if (existsSync(envPath)) process.loadEnvFile(envPath);
const origin = process.env.WEB_ORIGIN ?? "http://localhost:5173";
if (
  process.env.NODE_ENV === "production" &&
  (!process.env.DATABASE_URL ||
    process.env.COOKIE_SECURE !== "true" ||
    !origin.startsWith("https://"))
) {
  throw new Error(
    "Production requires DATABASE_URL, COOKIE_SECURE=true and an HTTPS WEB_ORIGIN.",
  );
}
const dataDir = fileURLToPath(
  new URL("../../../.data/postgres", import.meta.url),
);
if (!process.env.DATABASE_URL) mkdirSync(dataDir, { recursive: true });
const db = await openDatabase({ url: process.env.DATABASE_URL, dataDir });
const webRoot = fileURLToPath(new URL("../../web/dist", import.meta.url));
const app = await buildApp({
  db,
  origin,
  secureCookie: process.env.COOKIE_SECURE === "true",
  logger: true,
  webRoot: existsSync(webRoot) ? webRoot : undefined,
});
app.addHook("onClose", async () => db.close());
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.once(signal, async () => {
    await app.close();
    process.exit(0);
  });
await app.listen({
  port: Number(process.env.PORT ?? 3001),
  host: process.env.HOST ?? "127.0.0.1",
});
