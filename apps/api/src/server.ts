import { createMechanicResponder } from "./mechanic.ts";
import { buildApp } from "./app.ts";
import { openDatabase } from "./database.ts";
import { fileURLToPath } from "node:url";
import { existsSync, mkdirSync } from "node:fs";
import { createMailSender, deliverMail } from "./mail.ts";

const envPath = fileURLToPath(new URL("../../../.env", import.meta.url));
if (existsSync(envPath)) process.loadEnvFile(envPath);
const origin = process.env.WEB_ORIGIN ?? "http://localhost:5173";
const sender = createMailSender(
  process.env,
  fileURLToPath(new URL("../../../.data/mail", import.meta.url)),
);
if (
  process.env.NODE_ENV === "production" &&
  (!process.env.DATABASE_URL ||
    process.env.COOKIE_SECURE !== "true" ||
    !origin.startsWith("https://") ||
    process.env.REQUIRE_VERIFIED_EMAIL !== "true")
) {
  throw new Error(
    "Production requires DATABASE_URL, COOKIE_SECURE=true, REQUIRE_VERIFIED_EMAIL=true and an HTTPS WEB_ORIGIN.",
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
  mechanicResponder: createMechanicResponder(process.env),
  origin,
  secureCookie: process.env.COOKIE_SECURE === "true",
  logger: true,
  requireVerifiedEmail: process.env.REQUIRE_VERIFIED_EMAIL === "true",
  webRoot: existsSync(webRoot) ? webRoot : undefined,
});
let closing = false;
let inFlight: Promise<unknown> | undefined;
const poll = () => {
  if (closing || inFlight) return;
  inFlight = deliverMail(db, sender)
    .catch(() => app.log.error("Mail queue processing failed"))
    .finally(() => {
      inFlight = undefined;
    });
};
const timer = setInterval(poll, 3000);
timer.unref();
poll();
app.addHook("onClose", async () => {
  closing = true;
  clearInterval(timer);
  await inFlight;
  await db.close();
});
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.once(signal, async () => {
    await app.close();
    process.exit(0);
  });
await app.listen({
  port: Number(process.env.PORT ?? 3001),
  host: process.env.HOST ?? "127.0.0.1",
});
