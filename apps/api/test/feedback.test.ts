import { before, after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.ts";
import { openDatabase, type Database } from "../src/database.ts";
import { appVersion } from "../src/version.ts";
import type {
  Feedback,
  ModeratedFeedback,
  Page,
  Session,
} from "@enduro/contracts";
type Client = Session & { cookie: string };
let app: FastifyInstance,
  db: Database,
  dir: string,
  rider: Client,
  other: Client,
  moderator: Client;
const password = "feedback-only-password-2026",
  origin = "http://localhost:5173";
const valid = {
  kind: "bug",
  body: "Кнопка заявки не реагирует",
  section: "ride",
  viewport: "390x844",
};
function request(
  method: "GET" | "POST",
  url: string,
  c?: Client,
  payload?: object,
  extra: Record<string, string> = {},
  target = app,
  remoteAddress = "127.0.0.1",
) {
  return target.inject({
    method,
    url,
    payload,
    remoteAddress,
    headers: {
      origin,
      "x-enduro-client": "web",
      ...(c ? { cookie: c.cookie, "x-csrf-token": c.csrfToken } : {}),
      ...extra,
    },
  });
}
async function client(handle: string) {
  const r = await request("POST", "/api/auth/register", undefined, {
    email: `${handle}@example.test`,
    password,
    handle,
    displayName: `Райдер ${handle}`,
    city: "Сочи",
    level: "amateur",
  });
  assert.equal(r.statusCode, 201, r.body);
  return {
    ...r.json<Session>(),
    cookie: String(r.headers["set-cookie"]).split(";")[0],
  };
}
const notices = async (c: Client) =>
  (
    await db.query(
      "SELECT message FROM notifications WHERE user_id=$1 AND path='feedback'",
      [c.user.id],
    )
  ).length;
describe("Pilot feedback", () => {
  before(async () => {
    dir = await mkdtemp(join(tmpdir(), "enduro-feedback-"));
    db = await openDatabase({
      url: process.env.TEST_DATABASE_URL,
      dataDir: dir,
    });
    app = await buildApp({ db, rateMax: 1000 });
    rider = await client("fb_rider");
    other = await client("fb_other");
    moderator = await client("fb_mod");
    await db.query("UPDATE users SET role='moderator' WHERE id=$1", [
      moderator.user.id,
    ]);
  });
  after(async () => {
    await app.close();
    await db.query("DELETE FROM users WHERE id=ANY($1::uuid[])", [
      [rider.user.id, other.user.id, moderator.user.id],
    ]);
    await db.close();
    assert.ok(dir.startsWith(join(tmpdir(), "enduro-feedback-")));
    await rm(dir, { recursive: true, force: true });
  });
  it("accepts feedback from signed-in riders with the section, screen, browser and version", async () => {
    assert.equal(
      (await request("POST", "/api/feedback", undefined, valid)).statusCode,
      401,
    );
    const noCsrf = await app.inject({
      method: "POST",
      url: "/api/feedback",
      payload: valid,
      headers: { origin, "x-enduro-client": "web", cookie: rider.cookie },
    });
    assert.equal(noCsrf.statusCode, 403);
    const r = await request("POST", "/api/feedback", rider, valid, {
      "user-agent": "TestPhone/1.0 " + "x".repeat(400),
    });
    assert.equal(r.statusCode, 201, r.body);
    const f = r.json<Feedback>();
    assert.equal(f.status, "new");
    assert.equal(f.section, "ride");
    assert.equal(f.viewport, "390x844");
    assert.equal(f.appVersion, appVersion);
    assert.ok(f.userAgent.startsWith("TestPhone/1.0"));
    assert.equal(f.userAgent.length, 300);
    assert.equal(f.reply, "");
  });
  it("rejects object ids, malformed metadata and unknown fields", async () => {
    for (const body of [
      { ...valid, kind: "praise" },
      { ...valid, section: `ride/${randomUUID()}` },
      { ...valid, section: "../admin" },
      { ...valid, section: "Ride" },
      { ...valid, viewport: "wide" },
      { ...valid, body: "   ok   " },
      { ...valid, body: "x".repeat(2001) },
      { ...valid, email: "someone@example.test" },
    ])
      assert.equal(
        (
          await request(
            "POST",
            "/api/feedback",
            rider,
            body,
            {},
            app,
            "10.0.0.2",
          )
        ).statusCode,
        400,
        JSON.stringify(body).slice(0, 80),
      );
  });
  it("lets an unverified rider report problems even in pilot mode", async () => {
    const pilot = await buildApp({ db, requireVerifiedEmail: true });
    try {
      const r = await request(
        "POST",
        "/api/feedback",
        other,
        {
          ...valid,
          kind: "confusing",
          section: "account",
          body: "Не приходит письмо подтверждения",
        },
        {},
        pilot,
      );
      assert.equal(r.statusCode, 201, r.body);
    } finally {
      await pilot.close();
    }
  });
  it("shows riders only their own feedback", async () => {
    assert.equal((await request("GET", "/api/me/feedback")).statusCode, 401);
    const mine = (await request("GET", "/api/me/feedback", rider)).json<
      Page<Feedback>
    >();
    assert.deepEqual(
      mine.items.map((f) => f.body),
      ["Кнопка заявки не реагирует"],
    );
    const theirs = (await request("GET", "/api/me/feedback", other)).json<
      Page<Feedback>
    >();
    assert.deepEqual(
      theirs.items.map((f) => f.section),
      ["account"],
    );
  });
  it("gives moderators the queue with public author profiles and status filters", async () => {
    for (const c of [rider, other])
      assert.equal(
        (await request("GET", "/api/moderation/feedback", c)).statusCode,
        403,
      );
    const r = await request("GET", "/api/moderation/feedback", moderator);
    assert.equal(r.statusCode, 200, r.body);
    const queue = r.json<Page<ModeratedFeedback>>();
    assert.equal(queue.items.length, 2);
    assert.deepEqual(
      new Set(queue.items.map((f) => f.author.handle)),
      new Set(["fb_rider", "fb_other"]),
    );
    assert.ok(!r.body.includes("@example.test"));
    assert.ok(!r.body.includes("password"));
    assert.equal(
      (
        await request(
          "GET",
          "/api/moderation/feedback?status=resolved",
          moderator,
        )
      ).json().items.length,
      0,
    );
    assert.equal(
      (
        await request(
          "GET",
          "/api/moderation/feedback?status=closed",
          moderator,
        )
      ).statusCode,
      400,
    );
  });
  it("notifies the author about a closing decision or a new answer only", async () => {
    const [f] = (await request("GET", "/api/me/feedback", rider)).json<
      Page<Feedback>
    >().items;
    const decide = (c: Client, status: string, reply = "", id = f.id) =>
      request("POST", `/api/moderation/feedback/${id}`, c, { status, reply });
    assert.equal((await decide(rider, "resolved")).statusCode, 403);
    assert.equal(
      (await decide(moderator, "resolved", "", randomUUID())).statusCode,
      404,
    );
    assert.equal((await decide(moderator, "in_progress")).statusCode, 200);
    assert.equal(await notices(rider), 0);
    const answered = await decide(
      moderator,
      "in_progress",
      "Воспроизвели, чиним",
    );
    assert.equal(answered.json<Feedback>().reply, "Воспроизвели, чиним");
    assert.equal(await notices(rider), 1);
    assert.equal(
      (await decide(moderator, "in_progress", "Воспроизвели, чиним"))
        .statusCode,
      200,
    );
    assert.equal(await notices(rider), 1);
    assert.equal(
      (await decide(moderator, "resolved", "Воспроизвели, чиним")).statusCode,
      200,
    );
    assert.equal(await notices(rider), 2);
    const [message] = await db.query(
      "SELECT message FROM notifications WHERE user_id=$1 AND path='feedback' LIMIT 1",
      [rider.user.id],
    );
    assert.equal(message.message, "Команда ответила на ваш отзыв о сайте");
    const seen = (await request("GET", "/api/me/feedback", rider)).json<
      Page<Feedback>
    >().items[0];
    assert.deepEqual(
      [seen.status, seen.reply],
      ["resolved", "Воспроизвели, чиним"],
    );
  });
  it("limits open feedback per rider; closed items do not count", async () => {
    const post = () =>
      request("POST", "/api/feedback", rider, valid, {}, app, "10.0.0.3");
    await db.query(
      "INSERT INTO feedback(id,author_id,kind,body,section,viewport,app_version) SELECT gen_random_uuid(),$1,'idea','Synthetic idea','feed','1x1','0' FROM generate_series(1,99)",
      [rider.user.id],
    );
    assert.equal((await post()).statusCode, 201);
    const full = await post();
    assert.equal(full.statusCode, 409);
    assert.equal(full.json().error.code, "FEEDBACK_LIMIT");
    await db.query(
      "UPDATE feedback SET status='wontfix' WHERE author_id=$1 AND body='Synthetic idea'",
      [rider.user.id],
    );
    assert.equal((await post()).statusCode, 201);
    const burst = [];
    for (let i = 0; i < 10; i++) burst.push((await post()).statusCode);
    assert.ok(burst.includes(429), "10 feedback posts per minute per address");
  });
  it("exports own feedback and deletes it with the account", async () => {
    const exported = await request("POST", "/api/me/export", other, {
      password,
    });
    assert.equal(exported.statusCode, 200, exported.body);
    assert.deepEqual(
      exported.json().feedback.map((f: { section: string }) => f.section),
      ["account"],
    );
    assert.ok(!exported.body.includes("Кнопка заявки"));
    const removed = await request("POST", "/api/me/delete", other, {
      password,
      confirmation: "УДАЛИТЬ АККАУНТ",
    });
    assert.equal(removed.statusCode, 204, removed.body);
    const [left] = await db.query(
      "SELECT count(*) n FROM feedback WHERE author_id=$1",
      [other.user.id],
    );
    assert.equal(Number(left.n), 0);
  });
});
