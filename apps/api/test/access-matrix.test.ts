import { before, after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FastifyInstance, InjectOptions } from "fastify";
import { buildApp } from "../src/app.ts";
import { openDatabase, type Database } from "../src/database.ts";
import type { Session } from "@enduro/contracts";
// A safety net over the whole API, built from its own OpenAPI document: no moderator
// operation succeeds for a rider or a guest, and no signed-in operation succeeds for a guest.
type Client = Session & { cookie: string };
let app: FastifyInstance, db: Database, dir: string, rider: Client;
type Operation = { method: string; url: string; secured: boolean };
let operations: Operation[] = [];
const origin = "http://localhost:5173";
const dummy = "00000000-0000-4000-8000-000000000000";
// Path parameters get harmless values that pass schema checks.
const fill = (path: string) =>
  path
    .replace("{handle}", "nobody_here")
    .replace("{slug}", "no-such-model")
    .replace("{scope}", "moto")
    .replace("{node}", "frame")
    .replace("{lessonId}", "no-such-lesson")
    .replace(/\{[^}]+\}/g, dummy);
function request(op: Operation, c?: Client) {
  return app.inject({
    method: op.method as InjectOptions["method"],
    url: fill(op.url),
    ...(["GET", "DELETE"].includes(op.method) ? {} : { payload: {} }),
    headers: {
      origin,
      "x-enduro-client": "web",
      ...(c ? { cookie: c.cookie, "x-csrf-token": c.csrfToken } : {}),
    },
  });
}
describe("Access matrix over every API operation", () => {
  before(async () => {
    dir = await mkdtemp(join(tmpdir(), "enduro-access-"));
    db = await openDatabase({
      url: process.env.TEST_DATABASE_URL,
      dataDir: dir,
    });
    app = await buildApp({ db, rateMax: 100000 });
    const doc = (await app.inject("/api/openapi.json")).json<{
      paths: Record<string, Record<string, { security?: unknown[] }>>;
    }>();
    operations = Object.entries(doc.paths).flatMap(([url, ops]) =>
      Object.entries(ops).map(([method, o]) => ({
        method: method.toUpperCase(),
        url,
        secured: Boolean(o.security?.length),
      })),
    );
    const r = await app.inject({
      method: "POST",
      url: "/api/auth/register",
      headers: { origin, "x-enduro-client": "web" },
      payload: {
        email: "access_rider@example.test",
        password: "access-matrix-password-2026",
        handle: "access_rider",
        displayName: "Access rider",
        city: "Смоленск",
        level: "amateur",
      },
    });
    assert.equal(r.statusCode, 201, r.body);
    rider = {
      ...r.json<Session>(),
      cookie: String(r.headers["set-cookie"]).split(";")[0],
    };
  });
  after(async () => {
    await app.close();
    await db.close();
    await rm(dir, { recursive: true, force: true });
  });
  it("covers the whole API", () => {
    assert.ok(operations.length > 120, String(operations.length));
  });
  it("refuses every moderator operation to riders and guests", async () => {
    const moderation = operations.filter(
      (o) =>
        o.url.startsWith("/api/moderation/") ||
        (o.url.startsWith("/api/announcements") && o.method !== "GET"),
    );
    assert.ok(moderation.length >= 15);
    for (const op of moderation)
      for (const who of [rider, undefined]) {
        const r = await request(op, who);
        assert.ok(
          r.statusCode >= 400,
          `${op.method} ${op.url} as ${who ? "rider" : "guest"} → ${r.statusCode}`,
        );
        // Signed-in read operations are refused by role, not by a missing body.
        if (who && op.method === "GET")
          assert.equal(r.statusCode, 403, `${op.method} ${op.url}`);
      }
  });
  it("refuses every signed-in operation to a guest", async () => {
    // Logging in and asking for a reset link are open by design.
    const open = new Set(["POST /api/auth/logout"]);
    for (const op of operations.filter((o) => o.secured)) {
      if (open.has(`${op.method} ${op.url}`)) continue;
      const r = await request(op);
      assert.ok(
        r.statusCode >= 400,
        `${op.method} ${op.url} as guest → ${r.statusCode}`,
      );
      if (op.method === "GET")
        assert.equal(r.statusCode, 401, `${op.method} ${op.url}`);
    }
  });
  it("forbids framing by other sites and keeps location to our own pages", async () => {
    const r = await app.inject("/api/health");
    assert.equal(r.headers["x-frame-options"], "SAMEORIGIN");
    assert.equal(
      r.headers["content-security-policy"],
      "frame-ancestors 'self'",
    );
    assert.match(
      String(r.headers["permissions-policy"]),
      /geolocation=\(self\)/,
    );
  });
});
