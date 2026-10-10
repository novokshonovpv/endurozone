import { openDatabase } from "./database.ts";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
const envPath = fileURLToPath(new URL("../../../.env", import.meta.url));
if (existsSync(envPath)) process.loadEnvFile(envPath);
const [action, handle] = process.argv.slice(2);
if (
  !["grant", "revoke"].includes(action ?? "") ||
  !handle ||
  !/^[a-z0-9_]{3,24}$/.test(handle)
)
  throw new Error(
    "Usage: pnpm moderator grant|revoke exact_handle (stop local API first)",
  );
const db = await openDatabase({
  url: process.env.DATABASE_URL,
  dataDir: fileURLToPath(new URL("../../../.data/postgres", import.meta.url)),
});
try {
  const rows = await db.query(
    "UPDATE users SET role=$1 WHERE handle=$2 RETURNING handle,role",
    [action === "grant" ? "moderator" : "member", handle],
  );
  if (!rows.length) throw new Error("Account not found; no role changed.");
  console.log(`${rows[0].handle}: ${rows[0].role}`);
} finally {
  await db.close();
}
