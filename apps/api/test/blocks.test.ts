import { before, after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.ts";
import { openDatabase, type Database } from "../src/database.ts";
import type { Bike, Post, Session } from "@enduro/contracts";
type Client = Session & { cookie: string };
let app: FastifyInstance,
  db: Database,
  dir: string,
  alice: Client,
  bob: Client,
  carol: Client;
const origin = "http://localhost:5173",
  password = "blocks-only-password-2026";
function request(
  method: "GET" | "POST" | "PUT" | "DELETE",
  url: string,
  c?: Client,
  payload?: object,
) {
  return app.inject({
    method,
    url,
    payload,
    headers: {
      origin,
      "x-enduro-client": "web",
      ...(c ? { cookie: c.cookie, "x-csrf-token": c.csrfToken } : {}),
    },
  });
}
async function client(handle: string): Promise<Client> {
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
async function post(c: Client, title: string) {
  const b = await request("POST", "/api/me/bikes", c, {
    make: "Demo",
    model: "Block 250",
    year: 2024,
    modification: "",
    engine: "",
    hours: 0,
    notes: "",
  });
  assert.equal(b.statusCode, 201, b.body);
  const r = await request("POST", "/api/posts", c, {
    bikeId: b.json<Bike>().id,
    title,
    body: "Synthetic story for block tests only.",
    kind: "ride",
    visibility: "public",
  });
  assert.equal(r.statusCode, 201, r.body);
  return r.json<Post>();
}
async function ride(c: Client) {
  const track = randomUUID();
  await db.query(
    "INSERT INTO tracks(id,author_id,title,description,city,access_notes,difficulty,original_gpx,geometry,distance_m,trim_m,point_count,status) VALUES ($1,$2,'Synthetic block track','No real riding','Смоленск','No permission','easy','OWN ORIGINAL GPX','{\"type\":\"MultiLineString\",\"coordinates\":[]}',1000,300,2,'published')",
    [track, c.user.id],
  );
  const r = await request("POST", "/api/rides", c, {
    trackId: track,
    title: "Synthetic block ride",
    description: "No real event or gathering",
    meetingNotes: "SYNTHETIC MEETING",
    startsAt: new Date(Date.now() + 86400000).toISOString(),
    timezone: "Europe/Moscow",
    capacity: 6,
  });
  assert.equal(r.statusCode, 201, r.body);
  return r.json<{ id: string }>().id;
}
async function accepted(organizer: Client, rideId: string, member: Client) {
  assert.equal(
    (await request("POST", `/api/rides/${rideId}/join`, member)).statusCode,
    200,
  );
  const r = await request(
    "POST",
    `/api/rides/${rideId}/members/${member.user.id}/decision`,
    organizer,
    { action: "accept" },
  );
  assert.equal(r.statusCode, 200, r.body);
}
const block = (c: Client, handle: string) =>
  request("PUT", `/api/me/blocks/${handle}`, c);
const unblock = (c: Client, handle: string) =>
  request("DELETE", `/api/me/blocks/${handle}`, c);
const feedTitles = async (c?: Client) =>
  (await request("GET", "/api/feed?limit=30", c))
    .json<{ items: Post[] }>()
    .items.map((p) => p.title);
describe("Blocking riders", () => {
  before(async () => {
    dir = await mkdtemp(join(tmpdir(), "enduro-blocks-"));
    db = await openDatabase({
      url: process.env.TEST_DATABASE_URL,
      dataDir: dir,
    });
    app = await buildApp({ db, rateMax: 1000 });
    alice = await client("block_alice");
    bob = await client("block_bob");
    carol = await client("block_carol");
  });
  after(async () => {
    await app.close();
    await db.query("DELETE FROM users WHERE id=ANY($1::uuid[])", [
      [alice.user.id, bob.user.id, carol.user.id],
    ]);
    await db.close();
    await rm(dir, { recursive: true, force: true });
  });
  it("removes follows both ways, forbids following and is listed only for the blocker", async () => {
    await request("PUT", `/api/me/following/${bob.user.handle}`, alice);
    await request("PUT", `/api/me/following/${alice.user.handle}`, bob);
    assert.equal(
      (await request("PUT", `/api/me/blocks/${alice.user.handle}`, alice))
        .statusCode,
      400,
    );
    const r = await block(alice, bob.user.handle);
    assert.equal(r.statusCode, 200, r.body);
    assert.deepEqual(r.json(), { blocked: true });
    assert.deepEqual((await block(alice, bob.user.handle)).json(), {
      blocked: true,
    });
    const [n] = await db.query(
      "SELECT count(*) n FROM follows WHERE (follower_id=$1 AND followee_id=$2) OR (follower_id=$2 AND followee_id=$1)",
      [alice.user.id, bob.user.id],
    );
    assert.equal(Number(n.n), 0);
    for (const [who, target] of [
      [bob, alice],
      [alice, bob],
    ] as const) {
      const f = await request(
        "PUT",
        `/api/me/following/${target.user.handle}`,
        who,
      );
      assert.equal(f.statusCode, 403, f.body);
      assert.equal(f.json().error.code, "BLOCKED");
    }
    const list = (await request("GET", "/api/me/blocks", alice)).json();
    assert.deepEqual(
      list.items.map((x: { handle: string }) => x.handle),
      [bob.user.handle],
    );
    assert.equal(
      (await request("GET", "/api/me/blocks", bob)).json().items.length,
      0,
    );
    assert.deepEqual(
      (await request("GET", `/api/me/blocks/${alice.user.handle}`, bob)).json(),
      { blocked: false },
    );
    // The blocked person gets no notice about it.
    const notices = await db.query(
      "SELECT message FROM notifications WHERE user_id=$1 AND message ILIKE '%блок%'",
      [bob.user.id],
    );
    assert.equal(notices.length, 0);
    assert.deepEqual((await unblock(alice, bob.user.handle)).json(), {
      blocked: false,
    });
    assert.equal(
      (await request("PUT", `/api/me/following/${bob.user.handle}`, alice))
        .statusCode,
      200,
    );
  });
  it("hides profiles, posts and comments between the two, but not from guests or others", async () => {
    const own = await post(alice, "Alice block story");
    const theirs = await post(bob, "Bob block story");
    const third = await post(carol, "Carol block story");
    assert.equal(
      (
        await request("POST", `/api/posts/${third.id}/comments`, bob, {
          body: "Bob comment on Carol",
        })
      ).statusCode,
      201,
    );
    await block(alice, bob.user.handle);
    // Bob: Alice is gone.
    assert.equal(
      (await request("GET", `/api/profiles/${alice.user.handle}`, bob))
        .statusCode,
      404,
    );
    assert.equal(
      (await request("GET", `/api/posts/${own.id}`, bob)).statusCode,
      404,
    );
    assert.equal(
      (
        await request("POST", `/api/posts/${own.id}/comments`, bob, {
          body: "Should not land",
        })
      ).statusCode,
      404,
    );
    assert.ok(!(await feedTitles(bob)).includes("Alice block story"));
    // Alice still opens Bob's profile to unblock, but his posts and comments are hidden.
    assert.equal(
      (await request("GET", `/api/profiles/${bob.user.handle}`, alice))
        .statusCode,
      200,
    );
    assert.ok(!(await feedTitles(alice)).includes("Bob block story"));
    assert.equal(
      (await request("GET", `/api/posts/${theirs.id}`, alice)).statusCode,
      404,
    );
    assert.equal(
      (
        await request("GET", `/api/profiles/${bob.user.handle}/posts`, alice)
      ).json().items.length,
      0,
    );
    assert.equal(
      (
        await request("GET", `/api/profiles/${bob.user.handle}/bikes`, alice)
      ).json().items.length,
      0,
    );
    const comments = (
      await request("GET", `/api/posts/${third.id}/comments`, alice)
    ).json().items;
    assert.equal(comments.length, 0);
    assert.ok(
      !(await request("GET", "/api/riders?q=block_bob", alice)).json().items
        .length,
    );
    // Guests and third parties are unaffected.
    for (const viewer of [undefined, carol]) {
      const titles = await feedTitles(viewer);
      assert.ok(titles.includes("Alice block story"));
      assert.ok(titles.includes("Bob block story"));
      assert.equal(
        (await request("GET", `/api/posts/${third.id}/comments`, viewer)).json()
          .items.length,
        1,
      );
    }
    await unblock(alice, bob.user.handle);
    assert.ok((await feedTitles(alice)).includes("Bob block story"));
  });
  it("removes the other from own rides, forbids joining and hides chat messages in shared rides", async () => {
    const aliceRide = await ride(alice);
    await accepted(alice, aliceRide, bob);
    const bobRide = await ride(bob);
    await accepted(bob, bobRide, alice);
    const carolRide = await ride(carol);
    await accepted(carol, carolRide, alice);
    await accepted(carol, carolRide, bob);
    for (const [who, text] of [
      [alice, "Alice in Carol ride"],
      [bob, "Bob in Carol ride"],
    ] as const)
      assert.equal(
        (
          await request("POST", `/api/rides/${carolRide}/messages`, who, {
            body: text,
          })
        ).statusCode,
        201,
      );
    await block(alice, bob.user.handle);
    const status = async (rideId: string, c: Client) =>
      (
        await db.query(
          "SELECT status FROM ride_members WHERE ride_id=$1 AND user_id=$2",
          [rideId, c.user.id],
        )
      )[0].status;
    assert.equal(await status(aliceRide, bob), "declined");
    assert.equal(await status(bobRide, alice), "left");
    assert.equal(await status(carolRide, bob), "accepted");
    assert.equal(
      (await request("GET", `/api/rides/${aliceRide}`, bob)).statusCode,
      404,
    );
    assert.ok(
      !(await request("GET", "/api/rides?limit=30", bob))
        .json()
        .items.some((r: { id: string }) => r.id === aliceRide),
    );
    // Even after unblocking the old decision stays; a fresh request is blocked while the block lasts.
    const join = await request("POST", `/api/rides/${bobRide}/join`, alice);
    assert.equal(join.statusCode, 403, join.body);
    const bodies = async (c: Client) =>
      (await request("GET", `/api/rides/${carolRide}/messages`, c))
        .json()
        .items.map((m: { body: string }) => m.body);
    assert.deepEqual(await bodies(alice), ["Alice in Carol ride"]);
    assert.deepEqual(await bodies(bob), ["Bob in Carol ride"]);
    assert.equal((await bodies(carol)).length, 2);
    await unblock(alice, bob.user.handle);
  });
  it("exports own blocks and disappears with a deleted account", async () => {
    await block(alice, bob.user.handle);
    const exported = await request("POST", "/api/me/export", alice, {
      password,
    });
    assert.equal(exported.statusCode, 200, exported.body);
    assert.deepEqual(
      exported.json().blocked.map((b: { handle: string }) => b.handle),
      [bob.user.handle],
    );
    const theirs = await request("POST", "/api/me/export", bob, { password });
    assert.deepEqual(theirs.json().blocked, []);
    const temp = await client("block_temp");
    await block(temp, alice.user.handle);
    await db.query("DELETE FROM users WHERE id=$1", [temp.user.id]);
    const [left] = await db.query(
      "SELECT count(*) n FROM blocks WHERE blocker_id=$1 OR blocked_id=$1",
      [temp.user.id],
    );
    assert.equal(Number(left.n), 0);
    // Alice blocked Bob: Bob cannot open Alice, while Alice still opens Bob to unblock.
    assert.equal(
      (await request("GET", `/api/profiles/${bob.user.handle}`, alice))
        .statusCode,
      200,
    );
  });
});
