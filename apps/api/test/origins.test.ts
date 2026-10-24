import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.ts";
import { openDatabase, type Database } from "../src/database.ts";
// One site, several public addresses: each listed address may change data, others may not.
let app: FastifyInstance, db: Database, dir: string;
const register = (origin: string, handle: string) =>
  app.inject({
    method: "POST",
    url: "/api/auth/register",
    headers: { origin, "x-enduro-client": "web" },
    payload: {
      email: `${handle}@example.test`,
      password: "origins-test-password-2026",
      handle,
      displayName: `Райдер ${handle}`,
      city: "Смоленск",
      level: "amateur",
    },
  });
describe("Several public addresses of the site", () => {
  before(async () => {
    dir = await mkdtemp(join(tmpdir(), "enduro-origins-"));
    db = await openDatabase({
      url: process.env.TEST_DATABASE_URL,
      dataDir: dir,
    });
    app = await buildApp({
      db,
      origin: "https://enduro.example.test",
      extraOrigins: ["https://stand.example.test"],
      secureCookie: true,
    });
  });
  after(async () => {
    await app.close();
    await db.close();
    await rm(dir, { recursive: true, force: true });
  });
  it("accepts the main and the extra address, refuses any other", async () => {
    assert.equal(
      (await register("https://enduro.example.test", "origin_main")).statusCode,
      201,
    );
    assert.equal(
      (await register("https://stand.example.test", "origin_extra")).statusCode,
      201,
    );
    const other = await register("https://evil.example.test", "origin_evil");
    assert.equal(other.statusCode, 403);
    assert.equal(other.json().error.code, "ORIGIN_INVALID");
  });
});
