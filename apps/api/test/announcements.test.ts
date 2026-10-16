import { before, after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FastifyInstance, InjectOptions } from "fastify";
import { buildApp } from "../src/app.ts";
import { openDatabase, type Database } from "../src/database.ts";
import { seedContent, teamHandle } from "../src/seed.ts";
import type {
  Announcement,
  EnduroLocation,
  NearbyResult,
  Session,
} from "@enduro/contracts";
type Client = Session & { cookie: string };
let app: FastifyInstance, db: Database, dir: string, rider: Client, mod: Client;
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
    password: "announcements-password-2026",
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
const shift = (days: number) => {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const places = [
  {
    key: "test-place-1",
    kind: "spot" as const,
    title: "Synthetic seeded track",
    city: "Смоленск",
    latitude: 54.8,
    longitude: 32.1,
    description: "Synthetic seeded description for tests.",
    accessNotes: "Synthetic seeded terms for tests only.",
  },
];
const announcements = [
  {
    key: "test-race-past",
    title: "Synthetic past race",
    startsOn: shift(-3),
    region: "Test region",
    sourceUrl: "https://example.test/past",
  },
  {
    key: "test-race-running",
    title: "Synthetic two-day race",
    startsOn: shift(-1),
    endsOn: shift(0),
    region: "Test region",
    sourceUrl: "https://example.test/running",
  },
  {
    key: "test-race-next",
    title: "Synthetic next race",
    startsOn: shift(5),
    region: "Test region",
    sourceUrl: "https://example.test/next",
  },
];
const titles = async () =>
  (await request("GET", "/api/announcements"))
    .json<{ items: Announcement[] }>()
    .items.map((a) => a.title);
describe("Race announcements and starter content", () => {
  before(async () => {
    dir = await mkdtemp(join(tmpdir(), "enduro-announcements-"));
    db = await openDatabase({
      url: process.env.TEST_DATABASE_URL,
      dataDir: dir,
    });
    app = await buildApp({ db, rateMax: 1000 });
    rider = await client("ann_rider");
    mod = await client("ann_mod");
    await db.query("UPDATE users SET role='moderator' WHERE id=$1", [
      mod.user.id,
    ]);
  });
  after(async () => {
    await app.close();
    await db.close();
    await rm(dir, { recursive: true, force: true });
  });
  it("seeds places and announcements once, by the team account that cannot sign in", async () => {
    assert.deepEqual(await seedContent(db, places, announcements), {
      addedPlaces: 1,
      addedAnnouncements: 3,
    });
    assert.deepEqual(await seedContent(db, places, announcements), {
      addedPlaces: 0,
      addedAnnouncements: 0,
    });
    const list = (await request("GET", "/api/locations?kind=spot")).json<{
      items: EnduroLocation[];
    }>().items;
    const seeded = list.find((l) => l.title === "Synthetic seeded track");
    assert.ok(seeded);
    assert.equal(seeded.author.handle, teamHandle);
    assert.equal(seeded.difficulty, null);
    const nearby = (
      await request(
        "GET",
        "/api/nearby?latitude=54.78&longitude=32.04&radiusKm=25",
      )
    ).json<NearbyResult>();
    assert.ok(nearby.locations.some((l) => l.id === seeded.id));
    const login = await request("POST", "/api/auth/login", undefined, {
      email: "team@enduro-zone.invalid",
      password: "anything-at-all-123",
    });
    assert.equal(login.statusCode, 401);
  });
  it("lists only upcoming and running announcements, in date order", async () => {
    assert.deepEqual(await titles(), [
      "Synthetic two-day race",
      "Synthetic next race",
    ]);
  });
  it("lets only moderators publish, edit and hide; hidden ones are not re-seeded", async () => {
    const body = {
      title: "Synthetic moderator race",
      startsOn: shift(10),
      endsOn: shift(11),
      region: "Test region",
      place: "Test place",
      discipline: "Эндуро",
      classes: "Золото",
      sourceUrl: "https://example.test/moderator",
    };
    assert.equal(
      (await request("POST", "/api/announcements", rider, body)).statusCode,
      403,
    );
    assert.equal(
      (await request("POST", "/api/announcements", undefined, body)).statusCode,
      401,
    );
    assert.equal(
      (
        await request("POST", "/api/announcements", mod, {
          ...body,
          endsOn: shift(9),
        })
      ).statusCode,
      400,
    );
    const created = await request("POST", "/api/announcements", mod, body);
    assert.equal(created.statusCode, 201, created.body);
    const a = created.json<Announcement>();
    assert.equal(a.startsOn, body.startsOn);
    assert.equal(a.status, "scheduled");
    const edited = await request("PATCH", `/api/announcements/${a.id}`, mod, {
      ...body,
      status: "postponed",
      note: "Synthetic note",
    });
    assert.equal(edited.json<Announcement>().status, "postponed");
    const next = (await request("GET", "/api/announcements"))
      .json<{ items: Announcement[] }>()
      .items.find((x) => x.title === "Synthetic next race")!;
    assert.equal(
      (await request("DELETE", `/api/announcements/${next.id}`, rider))
        .statusCode,
      403,
    );
    assert.equal(
      (await request("DELETE", `/api/announcements/${next.id}`, mod))
        .statusCode,
      204,
    );
    await seedContent(db, places, announcements);
    assert.deepEqual(await titles(), [
      "Synthetic two-day race",
      "Synthetic moderator race",
    ]);
  });
  it("loads the real starter files: every place and announcement is valid", async () => {
    const r = await seedContent(db);
    assert.equal(r.addedPlaces, 29);
    assert.ok(r.addedAnnouncements >= 15);
    const page = (
      await request("GET", "/api/locations?limit=30&kind=spot")
    ).json<{ items: EnduroLocation[] }>();
    assert.ok(page.items.every((l) => l.latitude > 40 && l.longitude > 20));
  });
  it("accepts an announcement without an end date (empty field from the form)", async () => {
    const r = await request("POST", "/api/announcements", mod, {
      title: "Synthetic one-day race",
      startsOn: shift(20),
      endsOn: null,
      region: "Test region",
      sourceUrl: "https://example.test/one-day",
    });
    assert.equal(r.statusCode, 201, r.body);
    assert.equal(r.json<Announcement>().endsOn, null);
  });
});
