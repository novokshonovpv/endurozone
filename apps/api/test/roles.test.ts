import { before, after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.ts";
import { openDatabase, type Database } from "../src/database.ts";
import type { Moderators, Session } from "@enduro/contracts";
type Client = Session & { cookie: string };
let app: FastifyInstance,
  db: Database,
  dir: string,
  first: Client,
  second: Client,
  member: Client;
const origin = "http://localhost:5173",
  password = "roles-only-password-2026",
  reason = "Synthetic reason for a role change";
function request(
  method: "GET" | "POST",
  url: string,
  c?: Client,
  payload?: object,
  csrf = true,
) {
  return app.inject({
    method,
    url,
    payload,
    headers: {
      origin,
      "x-enduro-client": "web",
      ...(c
        ? { cookie: c.cookie, ...(csrf ? { "x-csrf-token": c.csrfToken } : {}) }
        : {}),
    },
  });
}
async function client(handle: string) {
  const r = await request("POST", "/api/auth/register", undefined, {
    email: `${handle}@example.test`,
    password,
    handle,
    displayName: `Райдер ${handle}`,
    city: "Смоленск",
    level: "amateur",
  });
  assert.equal(r.statusCode, 201, r.body);
  return {
    ...r.json<Session>(),
    cookie: String(r.headers["set-cookie"]).split(";")[0],
  };
}
const change = (c: Client, handle: string, role: string, why = reason) =>
  request("POST", "/api/moderation/roles", c, { handle, role, reason: why });
const roleOf = async (c: Client) =>
  (await db.query("SELECT role FROM users WHERE id=$1", [c.user.id]))[0].role;
describe("Moderator roles on the site", () => {
  before(async () => {
    dir = await mkdtemp(join(tmpdir(), "enduro-roles-"));
    db = await openDatabase({
      url: process.env.TEST_DATABASE_URL,
      dataDir: dir,
    });
    app = await buildApp({ db, rateMax: 1000 });
    first = await client("roles_first");
    second = await client("roles_second");
    member = await client("roles_member");
    // The first moderator comes from the server CLI, as in production.
    await db.query("UPDATE users SET role='moderator' WHERE id=$1", [
      first.user.id,
    ]);
  });
  after(async () => {
    await app.close();
    await db.query("DELETE FROM users WHERE id=ANY($1::uuid[])", [
      [first.user.id, second.user.id, member.user.id],
    ]);
    await db.close();
    assert.ok(dir.startsWith(join(tmpdir(), "enduro-roles-")));
    await rm(dir, { recursive: true, force: true });
  });
  it("lets only moderators list and change roles, with CSRF and a reason", async () => {
    assert.equal(
      (await request("GET", "/api/moderation/moderators")).statusCode,
      401,
    );
    assert.equal(
      (await request("GET", "/api/moderation/moderators", member)).statusCode,
      403,
    );
    assert.equal(
      (await change(member, member.user.handle, "moderator")).statusCode,
      403,
    );
    assert.equal(
      (
        await request(
          "POST",
          "/api/moderation/roles",
          first,
          { handle: second.user.handle, role: "moderator", reason },
          false,
        )
      ).statusCode,
      403,
    );
    for (const body of [
      { handle: second.user.handle, role: "admin", reason },
      { handle: second.user.handle, role: "moderator", reason: "short" },
      { handle: "Bad Handle", role: "moderator", reason },
      { handle: second.user.handle, role: "moderator", reason, extra: 1 },
    ])
      assert.equal(
        (await request("POST", "/api/moderation/roles", first, body))
          .statusCode,
        400,
      );
    assert.equal(
      (await change(first, "nobody_here", "moderator")).statusCode,
      404,
    );
    const list = await request("GET", "/api/moderation/moderators", first);
    assert.deepEqual(
      list.json<Moderators>().items.map((p) => p.handle),
      [first.user.handle],
    );
    assert.ok(!list.body.includes("@example.test"));
  });
  it("grants and revokes with an audit entry and a notice to the rider", async () => {
    const granted = await change(first, second.user.handle, "moderator");
    assert.equal(granted.statusCode, 200, granted.body);
    assert.deepEqual(granted.json(), {
      handle: second.user.handle,
      role: "moderator",
    });
    assert.equal(await roleOf(second), "moderator");
    assert.equal(
      (await change(first, second.user.handle, "moderator")).statusCode,
      200,
      "repeating is a no-op",
    );
    const audit = await db.query(
      "SELECT actor_id,action,reason FROM moderation_actions WHERE target_type='user' AND target_id=$1",
      [second.user.id],
    );
    assert.deepEqual(audit, [
      { actor_id: first.user.id, action: "grant_moderator", reason },
    ]);
    const [notice] = await db.query(
      "SELECT message,path FROM notifications WHERE user_id=$1",
      [second.user.id],
    );
    assert.deepEqual(notice, {
      message: "Вам выдана роль модератора",
      path: "moderation",
    });
    const revoked = await change(second, first.user.handle, "member");
    assert.equal(revoked.statusCode, 200, revoked.body);
    assert.equal(await roleOf(first), "member");
    assert.equal(
      (await request("GET", "/api/moderation/moderators", first)).statusCode,
      403,
      "the session sees the new role immediately",
    );
  });
  it("never removes the last moderator, even concurrently", async () => {
    const last = await change(second, second.user.handle, "member");
    assert.equal(last.statusCode, 409);
    assert.equal(last.json().error.code, "LAST_MODERATOR");
    assert.equal(await roleOf(second), "moderator");
    await change(second, first.user.handle, "moderator");
    const both = await Promise.all([
      change(first, second.user.handle, "member"),
      change(second, first.user.handle, "member"),
    ]);
    const codes = both.map((r) => r.statusCode).sort();
    assert.ok(codes.includes(200), codes.join(","));
    const [left] = await db.query(
      "SELECT count(*) n FROM users WHERE role='moderator' AND id=ANY($1::uuid[])",
      [[first.user.id, second.user.id]],
    );
    assert.equal(Number(left.n), 1);
  });
  it("deletes role audit entries about a rider together with the account", async () => {
    const mods = await db.query(
      "SELECT handle FROM users WHERE role='moderator' AND id=ANY($1::uuid[])",
      [[first.user.id, second.user.id]],
    );
    const actor = mods[0].handle === first.user.handle ? first : second;
    assert.equal(
      (await change(actor, member.user.handle, "moderator")).statusCode,
      200,
    );
    assert.equal(
      (await change(actor, member.user.handle, "member")).statusCode,
      200,
    );
    const removed = await request("POST", "/api/me/delete", member, {
      password,
      confirmation: "УДАЛИТЬ АККАУНТ",
    });
    assert.equal(removed.statusCode, 204, removed.body);
    const [left] = await db.query(
      "SELECT count(*) n FROM moderation_actions WHERE target_type='user' AND target_id=$1",
      [member.user.id],
    );
    assert.equal(Number(left.n), 0);
  });
});
