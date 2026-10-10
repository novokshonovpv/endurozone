import { before, after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.ts";
import { openDatabase, type Database } from "../src/database.ts";
import type { RideChat, RideMessage, Session, Track } from "@enduro/contracts";
type Client = Session & { cookie: string };
let app: FastifyInstance,
  db: Database,
  dir: string,
  organizer: Client,
  member: Client,
  pending: Client,
  leaver: Client,
  stranger: Client,
  moderator: Client,
  follower: Client,
  track: Track,
  rideId: string;
const password = "ride-chat-only-password-2026",
  origin = "http://localhost:5173";
const xml = (points: [number, number][]) =>
  `<?xml version="1.0" encoding="UTF-8"?><gpx version="1.1" creator="x" xmlns="http://www.topografix.com/GPX/1/1"><trk><trkseg>${points.map(([lon, lat]) => `<trkpt lon="${lon}" lat="${lat}"/>`).join("")}</trkseg></trk></gpx>`;
function request(
  method: "GET" | "POST" | "PUT" | "DELETE",
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
async function newRide(title: string) {
  const r = await request("POST", "/api/rides", organizer, {
    trackId: track.id,
    title,
    description: "Synthetic ride for chat tests",
    meetingNotes: "SECRET MEETING POINT behind the garage",
    startsAt: new Date(Date.now() + 3 * 86400000).toISOString(),
    timezone: "Europe/Moscow",
    capacity: 10,
  });
  assert.equal(r.statusCode, 201, r.body);
  return r.json<{ id: string }>().id;
}
async function accept(ride: string, c: Client) {
  assert.equal(
    (await request("POST", `/api/rides/${ride}/join`, c)).statusCode,
    200,
  );
  const r = await request(
    "POST",
    `/api/rides/${ride}/members/${c.user.id}/decision`,
    organizer,
    { action: "accept" },
  );
  assert.equal(r.statusCode, 200, r.body);
}
const chat = (ride: string, c?: Client, query = "") =>
  request("GET", `/api/rides/${ride}/messages${query}`, c);
const say = (ride: string, c: Client, body: string) =>
  request("POST", `/api/rides/${ride}/messages`, c, { body });
describe("Ride chat, message moderation and follower notices", () => {
  before(async () => {
    dir = await mkdtemp(join(tmpdir(), "enduro-chat-"));
    db = await openDatabase({
      url: process.env.TEST_DATABASE_URL,
      dataDir: dir,
    });
    app = await buildApp({ db, rateMax: 1000 });
    [organizer, member, pending, leaver, stranger, moderator, follower] =
      await Promise.all(
        [
          "chat_org",
          "chat_member",
          "chat_pending",
          "chat_leaver",
          "chat_stranger",
          "chat_mod",
          "chat_follower",
        ].map(client),
      );
    await db.query("UPDATE users SET role='moderator' WHERE id=$1", [
      moderator.user.id,
    ]);
    assert.equal(
      (
        await request(
          "PUT",
          `/api/me/following/${organizer.user.handle}`,
          follower,
        )
      ).statusCode,
      200,
    );
    await db.query("DELETE FROM notifications WHERE user_id=$1", [
      organizer.user.id,
    ]);
    const t = await request("POST", "/api/tracks", organizer, {
      title: "Chat track",
      description: "Synthetic track for chat tests",
      city: "Смоленск",
      accessNotes: "Synthetic access notes",
      difficulty: "easy",
      gpx: xml(Array.from({ length: 25 }, (_, i) => [32.1, 54.7 + i * 0.002])),
      trimM: 100,
      publicationConsent: true,
    });
    assert.equal(t.statusCode, 201, t.body);
    track = t.json<Track>();
    await db.query("UPDATE tracks SET status='published' WHERE id=$1", [
      track.id,
    ]);
    rideId = await newRide("Chat ride");
    await accept(rideId, member);
    assert.equal(
      (await request("POST", `/api/rides/${rideId}/join`, pending)).statusCode,
      200,
    );
    await request("POST", `/api/rides/${rideId}/join`, leaver);
    await request("POST", `/api/rides/${rideId}/leave`, leaver);
  });
  after(async () => {
    await app.close();
    const ids = [
      organizer,
      member,
      pending,
      leaver,
      stranger,
      moderator,
      follower,
    ].map((c) => c.user.id);
    await db.query("DELETE FROM users WHERE id=ANY($1::uuid[])", [ids]);
    await db.close();
    assert.ok(dir.startsWith(join(tmpdir(), "enduro-chat-")));
    await rm(dir, { recursive: true, force: true });
  });
  it("notifies each follower once per new ride without names or ride text", async () => {
    const rows = await db.query(
      "SELECT message,path FROM notifications WHERE user_id=$1 AND path LIKE 'ride/%'",
      [follower.user.id],
    );
    assert.deepEqual(rows, [
      {
        message: "Новая покатушка от райдера из ваших подписок",
        path: `ride/${rideId}`,
      },
    ]);
    for (const c of [member, pending, stranger]) {
      const [n] = await db.query(
        "SELECT count(*) n FROM notifications WHERE user_id=$1 AND message LIKE 'Новая покатушка от%'",
        [c.user.id],
      );
      assert.equal(Number(n.n), 0);
    }
  });
  it("lets only the organizer and accepted riders read and write", async () => {
    assert.equal((await chat(rideId)).statusCode, 401);
    for (const c of [stranger, pending, leaver, moderator, follower])
      assert.equal((await chat(rideId, c)).statusCode, 404, c.user.handle);
    for (const c of [pending, stranger])
      assert.equal((await say(rideId, c, "let me in")).statusCode, 404);
    const own = await chat(rideId, organizer);
    assert.equal(own.statusCode, 200, own.body);
    assert.deepEqual(
      { ...own.json<RideChat>(), items: [] },
      { items: [], nextOffset: null, canWrite: true, canModerate: true },
    );
    assert.equal(
      (await chat(rideId, member)).json<RideChat>().canModerate,
      false,
    );
    assert.equal(
      (
        await request(
          "POST",
          `/api/rides/${rideId}/messages`,
          member,
          { body: "x" },
          false,
        )
      ).statusCode,
      403,
    );
    for (const body of ["   ", "x".repeat(2001)])
      assert.equal((await say(rideId, member, body)).statusCode, 400);
    const first = await say(rideId, member, "  Беру запасную камеру  ");
    assert.equal(first.statusCode, 201, first.body);
    assert.equal(first.json<RideMessage>().body, "Беру запасную камеру");
    assert.equal(
      (await say(rideId, organizer, "Отлично, ждём")).statusCode,
      201,
    );
    const page = (await chat(rideId, member, "?limit=1")).json<RideChat>();
    assert.deepEqual(
      page.items.map((m) => m.body),
      ["Отлично, ждём"],
    );
    assert.equal(page.nextOffset, 1);
    const all = await chat(rideId, member);
    assert.equal(all.json<RideChat>().items.length, 2);
    assert.ok(!all.body.includes("SECRET MEETING"));
    assert.ok(!all.body.includes("@example.test"));
  });
  it("lets authors delete and the organizer hide messages", async () => {
    const mine = (await say(rideId, member, "Опечатка")).json<RideMessage>();
    const organizers = (await chat(rideId, member))
      .json<RideChat>()
      .items.find((m) => m.author.id === organizer.user.id)!;
    assert.equal(
      (await request("DELETE", `/api/ride-messages/${organizers.id}`, member))
        .statusCode,
      404,
    );
    assert.equal(
      (
        await request(
          "POST",
          `/api/ride-messages/${organizers.id}/hide`,
          member,
        )
      ).statusCode,
      404,
    );
    assert.equal(
      (await request("DELETE", `/api/ride-messages/${mine.id}`, member))
        .statusCode,
      204,
    );
    const rude = (
      await say(rideId, member, "RUDE MESSAGE")
    ).json<RideMessage>();
    for (let i = 0; i < 2; i++)
      assert.equal(
        (await request("POST", `/api/ride-messages/${rude.id}/hide`, organizer))
          .statusCode,
        204,
      );
    for (const c of [member, organizer]) {
      const r = await chat(rideId, c);
      assert.ok(!r.body.includes("RUDE MESSAGE"));
      assert.ok(!r.body.includes("Опечатка"));
      const hidden = r.json<RideChat>().items.find((m) => m.id === rude.id)!;
      assert.deepEqual([hidden.body, hidden.hiddenBy], ["", "organizer"]);
    }
  });
  it("shows a moderator only the reported message and lets them hide it", async () => {
    const target = (
      await say(rideId, organizer, "REPORTED TEXT")
    ).json<RideMessage>();
    const other = (
      await say(rideId, organizer, "UNREPORTED TEXT")
    ).json<RideMessage>();
    const report = (c: Client, id: string) =>
      request("POST", "/api/reports", c, {
        targetType: "ride_message",
        targetId: id,
        reason: "abuse",
        details: "Synthetic complaint about a message",
      });
    for (const c of [stranger, pending, moderator])
      assert.equal((await report(c, target.id)).statusCode, 404, c.user.handle);
    const filed = await report(member, target.id);
    assert.equal(filed.statusCode, 201, filed.body);
    assert.equal(
      (
        await request(
          "GET",
          `/api/moderation/ride-messages/${target.id}`,
          member,
        )
      ).statusCode,
      403,
    );
    assert.equal(
      (
        await request(
          "GET",
          `/api/moderation/ride-messages/${other.id}`,
          moderator,
        )
      ).statusCode,
      404,
    );
    const seen = await request(
      "GET",
      `/api/moderation/ride-messages/${target.id}`,
      moderator,
    );
    assert.equal(seen.statusCode, 200, seen.body);
    assert.equal(seen.json().body, "REPORTED TEXT");
    for (const secret of ["SECRET MEETING", "UNREPORTED", "Беру запасную"])
      assert.ok(!seen.body.includes(secret), secret);
    const decision = await request(
      "POST",
      `/api/moderation/reports/${filed.json().id}/decision`,
      moderator,
      { action: "hide", reason: "Synthetic moderation reason" },
    );
    assert.equal(decision.statusCode, 200, decision.body);
    const hidden = (await chat(rideId, member))
      .json<RideChat>()
      .items.find((m) => m.id === target.id)!;
    assert.deepEqual([hidden.body, hidden.hiddenBy], ["", "moderator"]);
    assert.equal((await report(member, target.id)).statusCode, 404);
  });
  it("keeps the chat writable after the start, read-only after cancellation and private after hiding", async () => {
    await db.query(
      "UPDATE rides SET starts_at=now()-interval '2 days' WHERE id=$1",
      [rideId],
    );
    assert.equal(
      (await say(rideId, member, "Спасибо за выезд!")).statusCode,
      201,
    );
    assert.equal((await chat(rideId, member)).json<RideChat>().canWrite, true);
    const second = await newRide("Second ride");
    await accept(second, member);
    assert.equal((await say(second, member, "До встречи")).statusCode, 201);
    assert.equal(
      (await request("POST", `/api/rides/${second}/cancel`, organizer))
        .statusCode,
      200,
    );
    for (const c of [member, organizer]) {
      const r = (await chat(second, c)).json<RideChat>();
      assert.equal(r.canWrite, false);
      assert.equal(r.items.length, 1);
      const blocked = await say(second, c, "ещё");
      assert.equal(blocked.statusCode, 409);
      assert.equal(blocked.json().error.code, "CHAT_READ_ONLY");
    }
    await db.query("UPDATE rides SET hidden=true WHERE id=$1", [second]);
    assert.equal((await chat(second, member)).statusCode, 404);
    assert.equal(
      (await chat(second, organizer)).json<RideChat>().items.length,
      1,
    );
    const third = await newRide("Third ride");
    await accept(third, leaver);
    assert.equal((await chat(third, leaver)).statusCode, 200);
    await request("POST", `/api/rides/${third}/leave`, leaver);
    assert.equal((await chat(third, leaver)).statusCode, 404);
  });
  it("caps a ride chat at the message limit", async () => {
    const full = await newRide("Full ride");
    await db.query(
      "INSERT INTO ride_messages(id,ride_id,author_id,body) SELECT gen_random_uuid(),$1,$2,'bulk' FROM generate_series(1,5000)",
      [full, organizer.user.id],
    );
    const r = await say(full, organizer, "one more");
    assert.equal(r.statusCode, 409);
    assert.equal(r.json().error.code, "CHAT_FULL");
    await db.query("DELETE FROM rides WHERE id=$1", [full]);
  });
  it("exports own messages only and removes them with their reports on account deletion", async () => {
    const exported = await request("POST", "/api/me/export", member, {
      password,
    });
    assert.equal(exported.statusCode, 200, exported.body);
    const messages: { body: string }[] = exported.json().rideMessages;
    assert.ok(messages.length >= 3);
    assert.ok(!exported.body.includes("Отлично, ждём"));
    assert.ok(!exported.body.includes("SECRET MEETING"));
    const target = (
      await say(rideId, member, "WILL BE REPORTED")
    ).json<RideMessage>();
    const filed = await request("POST", "/api/reports", organizer, {
      targetType: "ride_message",
      targetId: target.id,
      reason: "spam",
      details: "Synthetic complaint before deletion",
    });
    assert.equal(filed.statusCode, 201, filed.body);
    const removed = await request("POST", "/api/me/delete", member, {
      password,
      confirmation: "УДАЛИТЬ АККАУНТ",
    });
    assert.equal(removed.statusCode, 204, removed.body);
    const [left] = await db.query(
      "SELECT (SELECT count(*) FROM ride_messages WHERE author_id=$1)+(SELECT count(*) FROM reports WHERE target_type='ride_message' AND target_id=$2) n",
      [member.user.id, target.id],
    );
    assert.equal(Number(left.n), 0);
    assert.ok(
      (await chat(rideId, organizer))
        .json<RideChat>()
        .items.every((m) => m.author.id !== member.user.id),
    );
  });
});
