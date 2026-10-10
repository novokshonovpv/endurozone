import { before, after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { buildApp, logRequest } from "../src/app.ts";
import { openDatabase, type Database } from "../src/database.ts";
import type { NearbyResult, Session, Track } from "@enduro/contracts";
type Client = Session & { cookie: string };
let app: FastifyInstance,
  db: Database,
  dir: string,
  author: Client,
  nearTrack: Track,
  openRide: string;
const origin = "http://localhost:5173";
const xml = (points: [number, number][]) =>
  `<?xml version="1.0" encoding="UTF-8"?><gpx version="1.1" creator="PRIVATE_CREATOR" xmlns="http://www.topografix.com/GPX/1/1"><trk><trkseg>${points.map(([lon, lat]) => `<trkpt lon="${lon}" lat="${lat}"><time>2026-01-01T00:00:00Z</time></trkpt>`).join("")}</trkseg></trk></gpx>`;
const line = (lon: number, lat: number) =>
  Array.from(
    { length: 25 },
    (_, i) => [lon, lat + i * 0.002] as [number, number],
  );
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
const near = async (query: string) => {
  const r = await request("GET", `/api/nearby?${query}`);
  assert.equal(r.statusCode, 200, r.body);
  return { body: r.body, data: r.json<NearbyResult>() };
};
async function location(
  title: string,
  latitude: number,
  longitude: number,
  status = "published",
) {
  await db.query(
    "INSERT INTO locations(id,author_id,title,description,city,latitude,longitude,difficulty,access_notes,status) VALUES ($1,$2,$3,'Synthetic place for radius tests','Смоленск',$4,$5,'easy','Synthetic access notes',$6)",
    [randomUUID(), author.user.id, title, latitude, longitude, status],
  );
}
async function track(title: string, points: [number, number][]) {
  const r = await request("POST", "/api/tracks", author, {
    title,
    description: "Synthetic track for radius tests",
    city: "Смоленск",
    accessNotes: "Synthetic access notes",
    difficulty: "medium",
    gpx: xml(points),
    trimM: 100,
    publicationConsent: true,
  });
  assert.equal(r.statusCode, 201, r.body);
  const t = r.json<Track>();
  await db.query("UPDATE tracks SET status='published' WHERE id=$1", [t.id]);
  return t;
}
async function ride(trackId: string, title: string) {
  const r = await request("POST", "/api/rides", author, {
    trackId,
    title,
    description: "Synthetic ride for radius tests",
    meetingNotes: "SECRET MEETING POINT near the garage",
    startsAt: new Date(Date.now() + 7 * 86400000).toISOString(),
    timezone: "Europe/Moscow",
    capacity: 5,
  });
  assert.equal(r.statusCode, 201, r.body);
  return r.json<{ id: string }>().id;
}
describe("Nearby places, tracks and rides", () => {
  before(async () => {
    dir = await mkdtemp(join(tmpdir(), "enduro-nearby-"));
    db = await openDatabase({
      url: process.env.TEST_DATABASE_URL,
      dataDir: dir,
    });
    app = await buildApp({ db, rateMax: 1000 });
    const r = await request("POST", "/api/auth/register", undefined, {
      email: "nearby_author@example.test",
      password: "nearby-only-password-2026",
      handle: "nearby_author",
      displayName: "Автор мест",
      city: "Смоленск",
      level: "amateur",
    });
    assert.equal(r.statusCode, 201, r.body);
    author = {
      ...r.json<Session>(),
      cookie: String(r.headers["set-cookie"]).split(";")[0],
    };
    await location("Near place", 54.8, 32.05);
    await location("Edge place", 55.3, 32.05);
    await location("PENDING PLACE", 54.79, 32.05, "pending");
    await location("HIDDEN PLACE", 54.79, 32.06, "hidden");
    await location("Sochi place", 43.6, 39.72);
    nearTrack = await track("Near track", line(32.1, 54.7));
    await track("Sochi track", line(39.7, 43.6));
    openRide = await ride(nearTrack.id, "Open ride");
    const cancelled = await ride(nearTrack.id, "CANCELLED RIDE");
    await db.query("UPDATE rides SET status='cancelled' WHERE id=$1", [
      cancelled,
    ]);
    const hidden = await ride(nearTrack.id, "HIDDEN RIDE");
    await db.query("UPDATE rides SET hidden=true WHERE id=$1", [hidden]);
    const past = await ride(nearTrack.id, "PAST RIDE");
    await db.query(
      "UPDATE rides SET starts_at=now()-interval '1 day' WHERE id=$1",
      [past],
    );
  });
  after(async () => {
    await app.close();
    await db.query("DELETE FROM rides WHERE organizer_id=$1", [author.user.id]);
    await db.query("DELETE FROM users WHERE id=$1", [author.user.id]);
    await db.close();
    assert.ok(dir.startsWith(join(tmpdir(), "enduro-nearby-")));
    await rm(dir, { recursive: true, force: true });
  });
  it("finds published places, tracks and upcoming rides by distance from a coarse centre", async () => {
    const { data, body } = await near("latitude=54.7812&longitude=32.0449");
    assert.deepEqual(data.center, { latitude: 54.78, longitude: 32.04 });
    assert.equal(data.radiusKm, 100);
    assert.deepEqual(
      data.locations.map((l) => l.title),
      ["Near place", "Edge place"],
    );
    assert.ok(data.locations[0].distanceKm < data.locations[1].distanceKm);
    assert.ok(
      data.locations[1].distanceKm > 50 && data.locations[1].distanceKm < 60,
    );
    assert.deepEqual(
      data.tracks.map((t) => t.title),
      ["Near track"],
    );
    assert.ok(data.tracks[0].distanceKm > 3 && data.tracks[0].distanceKm < 10);
    assert.deepEqual(
      data.rides.map((r) => r.id),
      [openRide],
    );
    assert.equal(data.rides[0].distanceKm, data.tracks[0].distanceKm);
    assert.deepEqual(data.truncated, {
      locations: false,
      tracks: false,
      rides: false,
    });
    for (const secret of [
      "PENDING PLACE",
      "HIDDEN PLACE",
      "Sochi",
      "CANCELLED RIDE",
      "HIDDEN RIDE",
      "PAST RIDE",
      "SECRET MEETING",
      "meetingNotes",
      "PRIVATE_CREATOR",
      "geometry",
      "@example.test",
    ])
      assert.ok(!body.includes(secret), secret);
  });
  it("anchors tracks and rides to a point of the public trimmed geometry, never the raw ends", async () => {
    const { data } = await near("latitude=54.78&longitude=32.04");
    const published = nearTrack.geometry.coordinates.flat();
    for (const anchor of [data.tracks[0].anchor, data.rides[0].anchor])
      assert.ok(
        published.some((p) => p[0] === anchor[0] && p[1] === anchor[1]),
        "anchor is a public point",
      );
    const rawEnd = line(32.1, 54.7).at(-1)!;
    assert.notDeepEqual(data.tracks[0].anchor, rawEnd);
  });
  it("applies the radius, rounds nearby centres identically and validates input", async () => {
    const small = (await near("latitude=54.78&longitude=32.04&radiusKm=25"))
      .data;
    assert.deepEqual(
      small.locations.map((l) => l.title),
      ["Near place"],
    );
    const a = (await near("latitude=54.7801&longitude=32.0412")).data,
      b = (await near("latitude=54.7849&longitude=32.0449")).data;
    assert.deepEqual(a, b);
    const sochi = (await near("latitude=43.59&longitude=39.72&radiusKm=25"))
      .data;
    assert.deepEqual(
      sochi.tracks.map((t) => t.title),
      ["Sochi track"],
    );
    assert.deepEqual(sochi.rides, []);
    for (const query of [
      "longitude=32",
      "latitude=54",
      "latitude=86&longitude=32",
      "latitude=54&longitude=181",
      "latitude=54&longitude=32&radiusKm=30",
      "latitude=54&longitude=32&city=x",
      "latitude=north&longitude=32",
    ])
      assert.equal(
        (await request("GET", `/api/nearby?${query}`)).statusCode,
        400,
        query,
      );
  });
  it("drops hidden tracks with their rides and reports truncation at the result limit", async () => {
    await db.query("UPDATE tracks SET status='hidden' WHERE id=$1", [
      nearTrack.id,
    ]);
    const hidden = (await near("latitude=54.78&longitude=32.04")).data;
    assert.deepEqual(hidden.tracks, []);
    assert.deepEqual(hidden.rides, []);
    await db.query("UPDATE tracks SET status='published' WHERE id=$1", [
      nearTrack.id,
    ]);
    for (let i = 0; i < 30; i++)
      await location(`Bulk ${i}`, 54.9 + i * 0.001, 32.05);
    const full = (await near("latitude=54.78&longitude=32.04")).data;
    assert.equal(full.locations.length, 30);
    assert.equal(full.truncated.locations, true);
    assert.equal(full.locations[0].title, "Near place");
  });
  it("backfills bounding boxes for tracks created before migration 011", async () => {
    await db.query(
      "UPDATE tracks SET min_lat=NULL,max_lat=NULL,min_lng=NULL,max_lng=NULL WHERE id=$1",
      [nearTrack.id],
    );
    assert.deepEqual(
      (await near("latitude=54.78&longitude=32.04")).data.tracks,
      [],
    );
    const migration = await readFile(
      new URL("../migrations/011-nearby.sql", import.meta.url),
      "utf8",
    );
    const backfill = migration
      .split(";")
      .find((s) => s.trim().startsWith("UPDATE tracks"))!;
    await db.query(backfill);
    const [box] = await db.query(
      "SELECT min_lat,max_lat,min_lng,max_lng FROM tracks WHERE id=$1",
      [nearTrack.id],
    );
    const points = nearTrack.geometry.coordinates.flat();
    assert.equal(box.min_lat, Math.min(...points.map((p) => p[1])));
    assert.equal(box.max_lng, Math.max(...points.map((p) => p[0])));
    assert.equal(
      (await near("latitude=54.78&longitude=32.04")).data.tracks.length,
      1,
    );
  });
  it("keeps search coordinates out of request logs", () => {
    const logged = logRequest({
      method: "GET",
      url: "/api/nearby?latitude=54.78&longitude=32.04&radiusKm=50",
      host: "localhost",
      ip: "127.0.0.1",
    } as FastifyRequest);
    assert.equal(logged.url, "/api/nearby");
    assert.ok(!JSON.stringify(logged).includes("54.78"));
    assert.equal(
      logRequest({ method: "GET", url: "/api/rides?city=x" } as FastifyRequest)
        .url,
      "/api/rides?city=x",
    );
  });
});
