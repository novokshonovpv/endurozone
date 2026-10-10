import { before, after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FastifyInstance, InjectOptions } from "fastify";
import { buildApp } from "../src/app.ts";
import { openDatabase, type Database } from "../src/database.ts";
import type {
  Session,
  LearningCatalog,
  LearningProgress,
  LessonProgress,
} from "@enduro/contracts";
type Client = Session & { cookie: string };
let app: FastifyInstance,
  db: Database,
  dir: string,
  owner: Client,
  other: Client;
const password = "learning-only-long-password-2026",
  origin = "http://localhost:5173",
  progressUrl = "/api/me/learning/prepare-ride/progress";
function request(
  method: InjectOptions["method"],
  url: string,
  c?: Client,
  payload?: unknown,
  headers: Record<string, string> = {},
) {
  return app.inject({
    method,
    url,
    ...(payload === undefined ? {} : { payload: payload as object }),
    headers: {
      origin,
      "x-enduro-client": "web",
      ...(c ? { cookie: c.cookie, "x-csrf-token": c.csrfToken } : {}),
      ...headers,
    },
  });
}
async function client(handle: string) {
  const r = await request("POST", "/api/auth/register", undefined, {
    email: handle + "@example.test",
    password,
    handle,
    displayName: handle,
    city: "Смоленск",
    level: "beginner",
  });
  assert.equal(r.statusCode, 201, r.body);
  return {
    ...r.json<Session>(),
    cookie: String(r.headers["set-cookie"]).split(";")[0],
  };
}
describe("Public lessons and private versioned reading progress", () => {
  before(async () => {
    dir = await mkdtemp(join(tmpdir(), "enduro-learning-"));
    db = await openDatabase({
      url: process.env.TEST_DATABASE_URL,
      dataDir: dir,
    });
    app = await buildApp({ db, requireVerifiedEmail: true });
    owner = await client("learning_owner");
    other = await client("learning_other");
  });
  after(async () => {
    await app.close();
    await db.query("DELETE FROM users WHERE id IN ($1,$2)", [
      owner.user.id,
      other.user.id,
    ]);
    await db.close();
    assert.ok(dir.startsWith(join(tmpdir(), "enduro-learning-")));
    await rm(dir, { recursive: true, force: true });
  });
  it("serves full lessons and source links to guests without private progress", async () => {
    const r = await request("GET", "/api/learning");
    assert.equal(r.statusCode, 200, r.body);
    const c = r.json<LearningCatalog>();
    assert.equal(c.lessons.length, 3);
    assert.equal(c.level, "beginner");
    assert.equal(new Set(c.lessons.map((l) => l.id)).size, 3);
    assert.ok(
      c.lessons.every((l) => l.sections.length === 3 && l.version === 1),
    );
    assert.ok(
      c.lessons
        .flatMap((l) => l.sources)
        .every((s) => s.url.startsWith("https://msf-usa.org/")),
    );
    assert.ok(!r.body.includes(owner.user.email));
    assert.ok(!r.body.includes("readAt"));
  });
  it("protects personal reads and writes with session, CSRF and origin, allowing private progress before email verification", async () => {
    assert.equal((await request("GET", "/api/me/learning")).statusCode, 401);
    assert.equal(
      (
        await request("POST", progressUrl, undefined, {
          read: true,
          version: 1,
        })
      ).statusCode,
      401,
    );
    assert.equal(
      (
        await request(
          "POST",
          progressUrl,
          owner,
          { read: true, version: 1 },
          { "x-csrf-token": "wrong" },
        )
      ).statusCode,
      403,
    );
    assert.equal(
      (
        await request(
          "POST",
          progressUrl,
          owner,
          { read: true, version: 1 },
          { origin: "https://untrusted.example" },
        )
      ).statusCode,
      403,
    );
    assert.equal(
      (
        await request("POST", progressUrl, owner, {
          read: true,
          version: 1,
          userId: other.user.id,
        })
      ).statusCode,
      400,
    );
    assert.equal(owner.user.emailVerified, false);
    const r = await request("POST", progressUrl, owner, {
      read: true,
      version: 1,
    });
    assert.equal(r.statusCode, 200, r.body);
    assert.ok(r.json<LessonProgress>().readAt);
    assert.deepEqual(
      (await request("GET", "/api/me/learning", other)).json<LearningProgress>()
        .items,
      [],
    );
  });
  it("keeps one progress record and its first reading timestamp under duplicate and concurrent requests", async () => {
    const initial = (
      await request("GET", "/api/me/learning", owner)
    ).json<LearningProgress>().items[0];
    const results = await Promise.all([
      request("POST", progressUrl, owner, { read: true, version: 1 }),
      request("POST", progressUrl, owner, { read: true, version: 1 }),
    ]);
    assert.ok(
      results.every(
        (r) =>
          r.statusCode === 200 &&
          r.json<LessonProgress>().readAt === initial.readAt,
      ),
    );
    assert.equal(
      (
        await db.query("SELECT * FROM learning_progress WHERE user_id=$1", [
          owner.user.id,
        ])
      ).length,
      1,
    );
  });
  it("reverses the reading mark, rejects unknown/stale lessons, and ignores older versions in current progress", async () => {
    const r = await request("POST", progressUrl, owner, {
      read: false,
      version: 1,
    });
    assert.equal(r.statusCode, 200, r.body);
    assert.equal(r.json<LessonProgress>().readAt, null);
    assert.equal(
      (await request("POST", progressUrl, owner, { read: true, version: 2 }))
        .statusCode,
      409,
    );
    assert.equal(
      (
        await request(
          "POST",
          "/api/me/learning/unknown-lesson/progress",
          owner,
          { read: true, version: 1 },
        )
      ).statusCode,
      404,
    );
    assert.equal(
      (await request("POST", progressUrl, owner, { read: true })).statusCode,
      400,
    );
    await db.query(
      "INSERT INTO learning_progress(user_id,lesson_id,version,read_at) VALUES($1,'garage-history',99,now())",
      [owner.user.id],
    );
    const p = (
      await request("GET", "/api/me/learning", owner)
    ).json<LearningProgress>();
    assert.equal(p.items.length, 1);
    assert.equal(p.items[0].readAt, null);
  });
  it("exports only own learning history and cascades it on account deletion without changing other learners", async () => {
    assert.equal(
      (await request("POST", progressUrl, other, { read: true, version: 1 }))
        .statusCode,
      200,
    );
    const exportResponse = await request("POST", "/api/me/export", owner, {
      password,
    });
    assert.equal(exportResponse.statusCode, 200, exportResponse.body);
    const history = exportResponse.json().learningProgress;
    assert.equal(history.length, 2);
    assert.ok(history.some((p: { version: number }) => p.version === 99));
    assert.ok(!exportResponse.body.includes(other.user.email));
    const deleted = await request("POST", "/api/me/delete", owner, {
      password,
      confirmation: "УДАЛИТЬ АККАУНТ",
    });
    assert.equal(deleted.statusCode, 204, deleted.body);
    assert.equal(
      (
        await db.query("SELECT * FROM learning_progress WHERE user_id=$1", [
          owner.user.id,
        ])
      ).length,
      0,
    );
    const p = (
      await request("GET", "/api/me/learning", other)
    ).json<LearningProgress>();
    assert.equal(p.items.length, 1);
    assert.ok(p.items[0].readAt);
  });
});
