import { before, after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.ts";
import { openDatabase, type Database } from "../src/database.ts";
import type {
  ActivationSummary,
  Bike,
  Onboarding,
  Post,
  Session,
} from "@enduro/contracts";
type Client = Session & { cookie: string };
let app: FastifyInstance,
  db: Database,
  dir: string,
  newbie: Client,
  author: Client,
  joiner: Client,
  synthetic: Client,
  moderator: Client,
  authorPost: Post;
const password = "onboarding-only-password-2026",
  origin = "http://localhost:5173";
function request(
  method: "GET" | "POST" | "PUT",
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
// Pilot participants use a non-reserved domain; @example.test marks synthetic accounts.
async function client(handle: string, domain = "pilot.test") {
  const r = await request("POST", "/api/auth/register", undefined, {
    email: `${handle}@${domain}`,
    password,
    handle,
    displayName: `Райдер ${handle}`,
    city: "Смоленск",
    level: "beginner",
  });
  assert.equal(r.statusCode, 201, r.body);
  return {
    ...r.json<Session>(),
    cookie: String(r.headers["set-cookie"]).split(";")[0],
  };
}
async function bikeOf(c: Client) {
  const r = await request("POST", "/api/me/bikes", c, {
    make: "Demo",
    model: "Start 125",
    year: 2022,
    modification: "",
    engine: "",
    hours: 0,
    notes: "",
  });
  assert.equal(r.statusCode, 201, r.body);
  return r.json<Bike>();
}
async function postOf(c: Client, bike: Bike) {
  const r = await request("POST", "/api/posts", c, {
    bikeId: bike.id,
    title: "Первая запись",
    body: "Синтетическая запись для проверки первых шагов.",
    kind: "ride",
    visibility: "public",
  });
  assert.equal(r.statusCode, 201, r.body);
  return r.json<Post>();
}
const steps = async (c: Client) => {
  const r = await request("GET", "/api/me/onboarding", c);
  assert.equal(r.statusCode, 200, r.body);
  const o = r.json<Onboarding>();
  return Object.fromEntries(o.steps.map((s) => [s.id, s.done]));
};
describe("First steps and pilot activation", () => {
  before(async () => {
    dir = await mkdtemp(join(tmpdir(), "enduro-onboarding-"));
    db = await openDatabase({
      url: process.env.TEST_DATABASE_URL,
      dataDir: dir,
    });
    app = await buildApp({ db, rateMax: 1000 });
    newbie = await client("ob_newbie");
    author = await client("ob_author");
    joiner = await client("ob_joiner");
    synthetic = await client("ob_demo", "example.test");
    moderator = await client("ob_mod");
    await db.query("UPDATE users SET role='moderator' WHERE id=$1", [
      moderator.user.id,
    ]);
    authorPost = await postOf(author, await bikeOf(author));
  });
  after(async () => {
    await app.close();
    const ids = [newbie, author, joiner, synthetic, moderator].map(
      (c) => c.user.id,
    );
    await db.query("DELETE FROM rides WHERE organizer_id=ANY($1::uuid[])", [
      ids,
    ]);
    await db.query("DELETE FROM posts WHERE author_id=ANY($1::uuid[])", [ids]);
    await db.query("DELETE FROM users WHERE id=ANY($1::uuid[])", [ids]);
    await db.close();
    assert.ok(dir.startsWith(join(tmpdir(), "enduro-onboarding-")));
    await rm(dir, { recursive: true, force: true });
  });
  it("derives each first step from saved actions, ignoring actions on own content", async () => {
    assert.equal((await request("GET", "/api/me/onboarding")).statusCode, 401);
    const fresh = (
      await request("GET", "/api/me/onboarding", newbie)
    ).json<Onboarding>();
    assert.deepEqual(fresh, {
      steps: [
        { id: "bike", done: false },
        { id: "post", done: false },
        { id: "follow", done: false },
        { id: "social", done: false },
      ],
      complete: false,
      dismissed: false,
    });
    const own = await postOf(newbie, await bikeOf(newbie));
    assert.deepEqual(await steps(newbie), {
      bike: true,
      post: true,
      follow: false,
      social: false,
    });
    await request("POST", `/api/posts/${own.id}/comments`, newbie, {
      body: "сам себе",
    });
    await request("PUT", `/api/me/favorites/${own.id}`, newbie);
    assert.equal(
      (await steps(newbie)).social,
      false,
      "own content is not social",
    );
    await request("PUT", `/api/me/following/${author.user.handle}`, newbie);
    assert.equal((await steps(newbie)).follow, true);
    const c = await request(
      "POST",
      `/api/posts/${authorPost.id}/comments`,
      newbie,
      {
        body: "Отличный выезд!",
      },
    );
    assert.equal(c.statusCode, 201, c.body);
    const done = (
      await request("GET", "/api/me/onboarding", newbie)
    ).json<Onboarding>();
    assert.equal(done.complete, true);
  });
  it("counts a ride application or saving someone else's post as social", async () => {
    assert.equal((await steps(joiner)).social, false);
    await request("PUT", `/api/me/favorites/${authorPost.id}`, joiner);
    assert.equal((await steps(joiner)).social, true);
    await db.query("DELETE FROM favorites WHERE user_id=$1", [joiner.user.id]);
    const gpx = `<?xml version="1.0"?><gpx version="1.1" creator="x" xmlns="http://www.topografix.com/GPX/1/1"><trk><trkseg>${Array.from({ length: 25 }, (_, i) => `<trkpt lon="32.1" lat="${54.7 + i * 0.002}"/>`).join("")}</trkseg></trk></gpx>`;
    const t = await request("POST", "/api/tracks", author, {
      title: "Onboarding track",
      description: "Synthetic track for onboarding",
      city: "Смоленск",
      accessNotes: "Synthetic access notes",
      difficulty: "easy",
      gpx,
      trimM: 100,
      publicationConsent: true,
    });
    await db.query("UPDATE tracks SET status='published' WHERE id=$1", [
      t.json().id,
    ]);
    const ride = await request("POST", "/api/rides", author, {
      trackId: t.json().id,
      title: "Onboarding ride",
      description: "Synthetic ride for onboarding",
      meetingNotes: "Synthetic meeting notes",
      startsAt: new Date(Date.now() + 86400000 * 2).toISOString(),
      timezone: "Europe/Moscow",
      capacity: 4,
    });
    assert.equal(ride.statusCode, 201, ride.body);
    await request("POST", `/api/rides/${ride.json().id}/join`, joiner);
    assert.equal((await steps(joiner)).social, true);
  });
  it("lets riders hide and restore the checklist", async () => {
    assert.equal(
      (
        await request(
          "PUT",
          "/api/me/onboarding",
          joiner,
          { dismissed: true },
          false,
        )
      ).statusCode,
      403,
    );
    for (const body of [
      {},
      { dismissed: "yes" },
      { dismissed: true, extra: 1 },
    ])
      assert.equal(
        (await request("PUT", "/api/me/onboarding", joiner, body)).statusCode,
        400,
      );
    const hidden = await request("PUT", "/api/me/onboarding", joiner, {
      dismissed: true,
    });
    assert.equal(hidden.json<Onboarding>().dismissed, true);
    assert.equal(
      (
        await request("PUT", "/api/me/onboarding", joiner, { dismissed: false })
      ).json<Onboarding>().dismissed,
      false,
    );
  });
  it("gives moderators aggregate activation and return counts without moderators or synthetic accounts", async () => {
    await bikeOf(synthetic);
    for (const c of [newbie, author])
      assert.equal(
        (await request("GET", "/api/moderation/activation", c)).statusCode,
        403,
      );
    await db.query(
      "UPDATE users SET created_at=now()-interval '10 days' WHERE id=ANY($1::uuid[])",
      [[newbie.user.id, joiner.user.id]],
    );
    const r = await request("GET", "/api/moderation/activation", moderator);
    assert.equal(r.statusCode, 200, r.body);
    assert.deepEqual(r.json<ActivationSummary>(), {
      participants: 3,
      bike: 2,
      post: 2,
      follow: 1,
      // The author organized a ride: that is a social step too.
      social: 3,
      activated: 1,
      eligibleForReturn: 2,
      returned: 2,
      excludedModerators: 1,
      excludedSynthetic: 1,
    });
    for (const c of [newbie, author, joiner])
      assert.ok(!r.body.includes(c.user.handle));
    // The joiner's only action now happened at registration time: not a return.
    await db.query(
      "UPDATE ride_members SET created_at=now()-interval '10 days' WHERE user_id=$1",
      [joiner.user.id],
    );
    assert.equal(
      (
        await request("GET", "/api/moderation/activation", moderator)
      ).json<ActivationSummary>().returned,
      1,
    );
  });
});
