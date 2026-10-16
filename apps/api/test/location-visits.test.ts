import { before, after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FastifyInstance, InjectOptions } from "fastify";
import { buildApp } from "../src/app.ts";
import { openDatabase, type Database } from "../src/database.ts";
import { seedContent } from "../src/seed.ts";
import type {
  EnduroLocation,
  LocationVisits,
  NearbyResult,
  Session,
} from "@enduro/contracts";
type Client = Session & { cookie: string };
let app: FastifyInstance,
  db: Database,
  dir: string,
  riders: Client[],
  spot: string,
  rental: string;
const origin = "http://localhost:5173";
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
    password: "visits-test-password-2026",
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
const mark = (id: string, c: Client, difficulty?: string | null) =>
  request("PUT", `/api/locations/${id}/visit`, c, { difficulty });
const base = {
  city: "Смоленск",
  latitude: 54.8,
  longitude: 32.1,
  description: "Synthetic description for tests.",
  accessNotes: "Synthetic terms for tests only.",
};
describe("«Был здесь» and riders' difficulty", () => {
  before(async () => {
    dir = await mkdtemp(join(tmpdir(), "enduro-visits-"));
    db = await openDatabase({
      url: process.env.TEST_DATABASE_URL,
      dataDir: dir,
    });
    app = await buildApp({ db, rateMax: 1000 });
    riders = [];
    for (const h of ["visit_a", "visit_b", "visit_c"])
      riders.push(await client(h));
    await seedContent(
      db,
      [
        { ...base, key: "v-spot", kind: "spot", title: "Synthetic visit spot" },
        {
          ...base,
          key: "v-rental",
          kind: "rental",
          title: "Synthetic visit rental",
          longitude: 32.11,
        },
      ],
      [],
    );
    const rows = await db.query(
      "SELECT id,seed_key FROM locations WHERE seed_key LIKE 'v-%'",
    );
    spot = rows.find((r) => r.seed_key === "v-spot")!.id;
    rental = rows.find((r) => r.seed_key === "v-rental")!.id;
  });
  after(async () => {
    await app.close();
    await db.close();
    await rm(dir, { recursive: true, force: true });
  });
  it("counts marks and settles the difficulty once two riders voted", async () => {
    const [a, b, c] = riders;
    let s = (await mark(spot, a, "hard")).json<LocationVisits>();
    assert.equal(s.visits, 1);
    assert.equal(s.communityDifficulty, null);
    assert.deepEqual(s.mine, { visited: true, difficulty: "hard" });
    s = (await mark(spot, b, "easy")).json<LocationVisits>();
    // A one-to-one split goes to the safer reading: not "easy".
    assert.equal(s.communityDifficulty, "hard");
    s = (await mark(spot, c, "easy")).json<LocationVisits>();
    assert.equal(s.communityDifficulty, "easy");
    assert.deepEqual(s.votes, { easy: 2, medium: 0, hard: 1 });
    // Changing a vote replaces it.
    s = (await mark(spot, c, "hard")).json<LocationVisits>();
    assert.equal(s.visits, 3);
    assert.equal(s.communityDifficulty, "hard");
    const place = (
      await request("GET", `/api/locations/${spot}`)
    ).json<EnduroLocation>();
    assert.equal(place.visits, 3);
    assert.equal(place.communityDifficulty, "hard");
    // Guests see the summary without a mark of their own.
    const guest = (
      await request("GET", `/api/locations/${spot}/visits`)
    ).json<LocationVisits>();
    assert.deepEqual(guest.mine, { visited: false, difficulty: null });
    // An empty value withdraws the vote but keeps the mark.
    const withdrawn = await mark(spot, c, null);
    assert.equal(withdrawn.statusCode, 200, withdrawn.body);
    assert.deepEqual(withdrawn.json<LocationVisits>().mine, {
      visited: true,
      difficulty: null,
    });
    s = (
      await request("DELETE", `/api/locations/${spot}/visit`, c)
    ).json<LocationVisits>();
    assert.equal(s.visits, 2);
    assert.equal(s.mine.visited, false);
  });
  it("keeps difficulty for spots only, refuses the author and hidden places", async () => {
    const [a] = riders;
    const s = (await mark(rental, a, "hard")).json<LocationVisits>();
    assert.equal(s.visits, 1);
    assert.equal(s.mine.difficulty, null);
    assert.equal((await mark(spot, a)).statusCode, 200);
    assert.equal(
      (await request("PUT", `/api/locations/${spot}/visit`, undefined, {}))
        .statusCode,
      401,
    );
    const own = await request("POST", "/api/locations", a, {
      ...base,
      title: "Synthetic own place",
      difficulty: "easy",
      publicationConsent: true,
    });
    const ownId = own.json<EnduroLocation>().id;
    // Not published yet: invisible for marks.
    assert.equal((await mark(ownId, riders[1])).statusCode, 404);
    await db.query("UPDATE locations SET status='published' WHERE id=$1", [
      ownId,
    ]);
    assert.equal((await mark(ownId, a)).statusCode, 409);
    await db.query("UPDATE locations SET status='hidden' WHERE id=$1", [
      rental,
    ]);
    assert.equal((await mark(rental, riders[1])).statusCode, 404);
  });
  it("returns kind, contacts, marks and riders' difficulty in nearby search", async () => {
    const r = (
      await request(
        "GET",
        "/api/nearby?latitude=54.8&longitude=32.1&radiusKm=25",
      )
    ).json<NearbyResult>();
    const s = r.locations.find((l) => l.id === spot)!;
    assert.equal(s.kind, "spot");
    assert.equal(s.difficulty, null);
    assert.equal(s.contacts, "");
    assert.equal(s.visits, 2);
    assert.equal(typeof s.communityDifficulty, "string");
  });
  it("includes own marks in the personal data export", async () => {
    const r = await request("POST", "/api/me/export", riders[0], {
      password: "visits-test-password-2026",
    });
    assert.equal(r.statusCode, 200, r.body);
    assert.ok(
      r
        .json()
        .locationVisits.some(
          (v: { location_id: string }) => v.location_id === spot,
        ),
    );
  });
});
