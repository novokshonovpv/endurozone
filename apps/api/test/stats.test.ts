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
  Bike,
  EnduroLocation,
  MyStats,
  RiderStats,
  Session,
} from "@enduro/contracts";
type Client = Session & { cookie: string };
let app: FastifyInstance,
  db: Database,
  dir: string,
  author: Client,
  other: Client;
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
    password: "stats-test-password-2026",
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
const place = (title: string) => ({
  title,
  description: "Synthetic description for tests.",
  city: "Смоленск",
  latitude: 54.8,
  longitude: 32.1,
  difficulty: "easy",
  accessNotes: "Synthetic terms for tests only.",
  publicationConsent: true,
});
describe("Rider statistics", () => {
  before(async () => {
    dir = await mkdtemp(join(tmpdir(), "enduro-stats-"));
    db = await openDatabase({
      url: process.env.TEST_DATABASE_URL,
      dataDir: dir,
    });
    app = await buildApp({ db, rateMax: 1000 });
    author = await client("stats_author");
    other = await client("stats_other");
    const published = await request(
      "POST",
      "/api/locations",
      author,
      place("Synthetic published place"),
    );
    await db.query("UPDATE locations SET status='published' WHERE id=$1", [
      published.json<EnduroLocation>().id,
    ]);
    await request("POST", "/api/locations", author, place("Synthetic pending"));
    const bike = (
      await request("POST", "/api/me/bikes", author, {
        make: "Test",
        model: "Bike",
        year: 2025,
        modification: "",
        engine: "",
        hours: 0,
        notes: "",
      })
    ).json<Bike>();
    for (const visibility of ["public", "private"])
      await request("POST", "/api/posts", author, {
        bikeId: bike.id,
        title: "Synthetic stats post",
        body: "Synthetic post body for statistics tests.",
        kind: "ride",
        visibility,
      });
  });
  after(async () => {
    await app.close();
    await db.close();
    await rm(dir, { recursive: true, force: true });
  });
  it("counts only what anyone can already see", async () => {
    const s = (
      await request("GET", "/api/profiles/stats_author/stats")
    ).json<RiderStats>();
    assert.deepEqual(s, {
      placesAdded: 1,
      tracksPublished: 0,
      ridesOrganized: 0,
      postsPublic: 1,
    });
    assert.equal(
      (await request("GET", "/api/profiles/nobody_here/stats")).statusCode,
      404,
    );
  });
  it("shows the owner own marks and the places visited", async () => {
    await seedContent(
      db,
      [
        {
          key: "stats-team",
          kind: "rental",
          title: "Synthetic team rental",
          city: "Смоленск",
          latitude: 54.9,
          longitude: 32.2,
          description: "Synthetic description for tests.",
          accessNotes: "Synthetic terms for tests only.",
        },
      ],
      [],
    );
    const [p] = await db.query(
      "SELECT id FROM locations WHERE seed_key='stats-team'",
    );
    await request("PUT", `/api/locations/${p.id}/visit`, other, {});
    const mine = (await request("GET", "/api/me/stats", other)).json<MyStats>();
    assert.equal(mine.visits, 1);
    assert.equal(mine.visited[0].title, "Synthetic team rental");
    assert.equal(mine.visited[0].kind, "rental");
    // A place hidden later disappears from the list.
    await db.query("UPDATE locations SET status='hidden' WHERE id=$1", [p.id]);
    const after = (
      await request("GET", "/api/me/stats", other)
    ).json<MyStats>();
    assert.equal(after.visits, 0);
    assert.deepEqual(after.visited, []);
  });
  it("hides the counters from someone the rider blocked", async () => {
    await request("PUT", `/api/me/blocks/${other.user.handle}`, author);
    assert.equal(
      (await request("GET", "/api/profiles/stats_author/stats", other))
        .statusCode,
      404,
    );
    assert.equal(
      (await request("GET", "/api/profiles/stats_author/stats")).statusCode,
      200,
    );
  });
});
