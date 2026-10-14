import { before, after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FastifyInstance, InjectOptions } from "fastify";
import { buildApp } from "../src/app.ts";
import { openDatabase, type Database } from "../src/database.ts";
import type { EnduroLocation, NearbyResult, Session } from "@enduro/contracts";
type Client = Session & { cookie: string };
let app: FastifyInstance,
  db: Database,
  dir: string,
  author: Client,
  viewer: Client,
  mod: Client;
const origin = "http://localhost:5173";
const reason = "Synthetic moderation decision for tests.";
function request(
  method: InjectOptions["method"],
  url: string,
  c?: Client,
  payload?: object,
) {
  return app.inject({
    method,
    url,
    ...(payload ? { payload } : {}),
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
    password: "map-blocks-password-2026",
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
const place = (extra: object = {}) => ({
  title: "Synthetic place",
  description: "Synthetic description for tests only.",
  city: "Смоленск",
  latitude: 54.78,
  longitude: 32.04,
  difficulty: "easy",
  accessNotes: "Synthetic terms for tests only.",
  publicationConsent: true,
  ...extra,
});
async function propose(extra: object = {}) {
  const r = await request("POST", "/api/locations", author, place(extra));
  assert.equal(r.statusCode, 201, r.body);
  return r.json<EnduroLocation>().id;
}
const decide = (id: string, action: string, expectedStatus: string) =>
  request("POST", `/api/moderation/locations/${id}/decision`, mod, {
    action,
    reason,
    expectedStatus,
  });
const publicIds = async (c?: Client) =>
  (await request("GET", "/api/locations?limit=30", c))
    .json<{ items: EnduroLocation[] }>()
    .items.map((l) => l.id);
const nearbyIds = async (c?: Client) =>
  (
    await request(
      "GET",
      "/api/nearby?latitude=54.78&longitude=32.04&radiusKm=25",
      c,
    )
  )
    .json<NearbyResult>()
    .locations.map((l) => l.id);
describe("Blocking on the map and editing proposals", () => {
  before(async () => {
    dir = await mkdtemp(join(tmpdir(), "enduro-map-blocks-"));
    db = await openDatabase({
      url: process.env.TEST_DATABASE_URL,
      dataDir: dir,
    });
    app = await buildApp({ db, rateMax: 1000 });
    author = await client("mb_author");
    viewer = await client("mb_viewer");
    mod = await client("mb_mod");
    await db.query("UPDATE users SET role='moderator' WHERE id=$1", [
      mod.user.id,
    ]);
  });
  after(async () => {
    await app.close();
    await db.close();
    await rm(dir, { recursive: true, force: true });
  });
  it("hides places of a blocked rider from lists, cards and nearby, both ways", async () => {
    const id = await propose();
    assert.equal((await decide(id, "publish", "pending")).statusCode, 200);
    assert.ok((await publicIds(viewer)).includes(id));
    assert.ok((await nearbyIds(viewer)).includes(id));
    const block = await request(
      "PUT",
      `/api/me/blocks/${author.user.handle}`,
      viewer,
    );
    assert.equal(block.statusCode, 200, block.body);
    for (const c of [viewer]) {
      assert.ok(!(await publicIds(c)).includes(id));
      assert.ok(!(await nearbyIds(c)).includes(id));
      assert.equal(
        (await request("GET", `/api/locations/${id}`, c)).statusCode,
        404,
      );
    }
    // Guests, the author and moderators are not affected.
    assert.ok((await publicIds()).includes(id));
    assert.ok((await nearbyIds()).includes(id));
    assert.equal(
      (await request("GET", `/api/locations/${id}`, author)).statusCode,
      200,
    );
    assert.equal(
      (await request("GET", `/api/locations/${id}`, mod)).statusCode,
      200,
    );
    await request("DELETE", `/api/me/blocks/${author.user.handle}`, viewer);
    assert.ok((await publicIds(viewer)).includes(id));
  });
  it("lets the author fix and resubmit a proposal, but not revive a hidden one", async () => {
    const rejected = await propose({ title: "Rejected place" });
    assert.equal((await decide(rejected, "reject", "pending")).statusCode, 200);
    const fixed = await request(
      "PATCH",
      `/api/locations/${rejected}`,
      author,
      place({
        kind: "rental",
        title: "Fixed rental",
        difficulty: null,
        contacts: "Synthetic contact",
      }),
    );
    assert.equal(fixed.statusCode, 200, fixed.body);
    const f = fixed.json<EnduroLocation>();
    assert.equal(f.status, "pending");
    assert.equal(f.kind, "rental");
    assert.equal(f.difficulty, null);
    assert.equal(f.contacts, "Synthetic contact");
    // Someone else's proposal looks absent.
    assert.equal(
      (await request("PATCH", `/api/locations/${rejected}`, viewer, place()))
        .statusCode,
      404,
    );
    // Editing a published card sends it back to moderation and off the map.
    const published = await propose({ title: "Published place" });
    await decide(published, "publish", "pending");
    const edited = await request(
      "PATCH",
      `/api/locations/${published}`,
      author,
      place({ title: "Published place, new terms" }),
    );
    assert.equal(edited.json<EnduroLocation>().status, "pending");
    assert.ok(!(await publicIds()).includes(published));
    // A hidden place stays hidden.
    await decide(published, "publish", "pending");
    await decide(published, "hide", "published");
    const revived = await request(
      "PATCH",
      `/api/locations/${published}`,
      author,
      place(),
    );
    assert.equal(revived.statusCode, 409);
    // A spot without difficulty is still rejected on edit.
    assert.equal(
      (
        await request(
          "PATCH",
          `/api/locations/${rejected}`,
          author,
          place({ difficulty: null }),
        )
      ).statusCode,
      400,
    );
  });
});
