import { before, after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.ts";
import { openDatabase, type Database } from "../src/database.ts";
import { notify } from "../src/pilot.ts";
import type { Session } from "@enduro/contracts";
type Client = Session & { cookie: string };
let app: FastifyInstance, db: Database, dir: string, me: Client, other: Client;
const origin = "http://localhost:5173";
function request(method: "GET" | "POST", url: string, c?: Client, csrf = true) {
  return app.inject({
    method,
    url,
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
  const r = await app.inject({
    method: "POST",
    url: "/api/auth/register",
    headers: { origin, "x-enduro-client": "web" },
    payload: {
      email: `${handle}@example.test`,
      password: "notifications-only-password-2026",
      handle,
      displayName: `Райдер ${handle}`,
      city: "Сочи",
      level: "amateur",
    },
  });
  assert.equal(r.statusCode, 201, r.body);
  return {
    ...r.json<Session>(),
    cookie: String(r.headers["set-cookie"]).split(";")[0],
  };
}
const unread = async (c: Client) =>
  (await request("GET", "/api/me/notifications?limit=1", c)).json().unreadCount;
describe("Mark all notifications read", () => {
  before(async () => {
    dir = await mkdtemp(join(tmpdir(), "enduro-notify-"));
    db = await openDatabase({
      url: process.env.TEST_DATABASE_URL,
      dataDir: dir,
    });
    app = await buildApp({ db, rateMax: 1000 });
    me = await client("nt_me");
    other = await client("nt_other");
    for (const c of [me, me, me, other])
      await notify(db, c.user.id, "Синтетическое уведомление", "feed");
  });
  after(async () => {
    await app.close();
    await db.query("DELETE FROM users WHERE id=ANY($1::uuid[])", [
      [me.user.id, other.user.id],
    ]);
    await db.close();
    assert.ok(dir.startsWith(join(tmpdir(), "enduro-notify-")));
    await rm(dir, { recursive: true, force: true });
  });
  it("marks only the caller's notifications and requires a session with CSRF", async () => {
    assert.equal(
      (await request("POST", "/api/me/notifications/read-all")).statusCode,
      401,
    );
    assert.equal(
      (await request("POST", "/api/me/notifications/read-all", me, false))
        .statusCode,
      403,
    );
    const [first] = (await request("GET", "/api/me/notifications", me)).json()
      .items;
    await request("POST", `/api/me/notifications/${first.id}/read`, me);
    const [before] = await db.query(
      "SELECT read_at FROM notifications WHERE id=$1",
      [first.id],
    );
    assert.equal(await unread(me), 2);
    const r = await request("POST", "/api/me/notifications/read-all", me);
    assert.equal(r.statusCode, 204, r.body);
    assert.equal(await unread(me), 0);
    assert.equal(await unread(other), 1);
    const [after] = await db.query(
      "SELECT read_at FROM notifications WHERE id=$1",
      [first.id],
    );
    assert.equal(
      new Date(after.read_at).getTime(),
      new Date(before.read_at).getTime(),
    );
    assert.equal(
      (await request("POST", "/api/me/notifications/read-all", me)).statusCode,
      204,
    );
  });
});
