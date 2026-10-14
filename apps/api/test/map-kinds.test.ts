import { before, after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.ts";
import { openDatabase, type Database } from "../src/database.ts";
import type { Bike, EnduroLocation, Post, Session } from "@enduro/contracts";
type Client = Session & { cookie: string };
let app: FastifyInstance, db: Database, dir: string, rider: Client, mod: Client;
const origin = "http://localhost:5173";
function request(
  method: "GET" | "POST",
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
    password: "map-kinds-password-2026",
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
const place = (extra: object) => ({
  title: "Synthetic place",
  description: "Synthetic description for tests only.",
  city: "Смоленск",
  latitude: 54.78,
  longitude: 32.04,
  accessNotes: "Synthetic terms for tests only.",
  publicationConsent: true,
  ...extra,
});
describe("Rentals, guides and news", () => {
  before(async () => {
    dir = await mkdtemp(join(tmpdir(), "enduro-kinds-"));
    db = await openDatabase({
      url: process.env.TEST_DATABASE_URL,
      dataDir: dir,
    });
    app = await buildApp({ db, rateMax: 1000 });
    rider = await client("kinds_rider");
    mod = await client("kinds_mod");
    await db.query("UPDATE users SET role='moderator' WHERE id=$1", [
      mod.user.id,
    ]);
  });
  after(async () => {
    await app.close();
    await db.query("DELETE FROM users WHERE id=ANY($1::uuid[])", [
      [rider.user.id, mod.user.id],
    ]);
    await db.close();
    await rm(dir, { recursive: true, force: true });
  });
  it("adds rentals and guides without difficulty, but a spot still needs one", async () => {
    const rental = await request(
      "POST",
      "/api/locations",
      rider,
      place({
        kind: "rental",
        title: "Synthetic rental",
        contacts: "+7 000 000-00-00",
      }),
    );
    assert.equal(rental.statusCode, 201, rental.body);
    const r = rental.json<EnduroLocation>();
    assert.equal(r.kind, "rental");
    assert.equal(r.difficulty, null);
    assert.equal(r.contacts, "+7 000 000-00-00");
    // Difficulty sent for a rental is dropped.
    const guide = await request(
      "POST",
      "/api/locations",
      rider,
      place({ kind: "guide", title: "Synthetic guide", difficulty: "hard" }),
    );
    assert.equal(guide.json<EnduroLocation>().difficulty, null);
    const spot = await request("POST", "/api/locations", rider, place({}));
    assert.equal(spot.statusCode, 400);
    const oldClient = await request(
      "POST",
      "/api/locations",
      rider,
      place({ difficulty: "easy" }),
    );
    assert.equal(oldClient.json<EnduroLocation>().kind, "spot");
    const rentals = (
      await request("GET", "/api/me/locations?kind=rental", rider)
    ).json<{ items: EnduroLocation[] }>();
    assert.deepEqual(
      rentals.items.map((x) => x.title),
      ["Synthetic rental"],
    );
    const services = (
      await request("GET", "/api/me/locations?kind=services", rider)
    ).json<{ items: EnduroLocation[] }>();
    assert.deepEqual(services.items.map((x) => x.kind).sort(), [
      "guide",
      "rental",
    ]);
  });
  it("lets only moderators publish news, shown by the news filter", async () => {
    const bike = (
      await request("POST", "/api/me/bikes", mod, {
        make: "Test",
        model: "Bike",
        year: 2025,
        modification: "",
        engine: "",
        hours: 0,
        notes: "",
      })
    ).json<Bike>();
    const riderBike = (
      await request("POST", "/api/me/bikes", rider, {
        make: "Test",
        model: "Bike",
        year: 2025,
        modification: "",
        engine: "",
        hours: 0,
        notes: "",
      })
    ).json<Bike>();
    const news = {
      title: "Synthetic news",
      body: "Synthetic news body for tests only.",
      kind: "news",
      visibility: "public",
    };
    const denied = await request("POST", "/api/posts", rider, {
      ...news,
      bikeId: riderBike.id,
    });
    assert.equal(denied.statusCode, 403);
    const ok = await request("POST", "/api/posts", mod, {
      ...news,
      bikeId: bike.id,
    });
    assert.equal(ok.statusCode, 201, ok.body);
    const feed = (await request("GET", "/api/feed?kind=news")).json<{
      items: Post[];
    }>();
    assert.deepEqual(
      feed.items.map((p) => p.title),
      ["Synthetic news"],
    );
  });
});
