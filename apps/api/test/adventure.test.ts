import { before, after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { FastifyInstance, InjectOptions } from "fastify";
import type { Session } from "@enduro/contracts";
import { openDatabase, type Database } from "../src/database.ts";
import { buildApp } from "../src/app.ts";
import { previewGpx, publicGpx, distance } from "../src/gpx.ts";
const points = Array.from(
  { length: 25 },
  (_, i) => [32, 54 + i * 0.002] as [number, number],
);
const xml = (segments: [number, number][][]) =>
  `<?xml version="1.0" encoding="UTF-8"?><gpx version="1.1" creator="PRIVATE_CREATOR" xmlns="http://www.topografix.com/GPX/1/1"><metadata><name>PRIVATE_FILENAME</name><author><email id="private" domain="example.test"/></author></metadata><trk>${segments.map((s) => `<trkseg>${s.map(([lon, lat]) => `<trkpt lon="${lon}" lat="${lat}"><time>2026-01-01T00:00:00Z</time><ele>150</ele></trkpt>`).join("")}</trkseg>`).join("")}</trk></gpx>`;
const gpx = xml([points]);
describe("GPX privacy and bounded XML parsing", () => {
  it("removes metadata, masks endpoint circles and preserves separate segments", () => {
    const input = [
      points,
      points.map(([x, y]) => [x + 0.2, y] as [number, number]),
    ];
    const p = previewGpx(xml(input), 300);
    assert.equal(p.geometry.coordinates.length, 2);
    const zones = input.flatMap((s) => [s[0], s.at(-1)!]);
    for (const s of p.geometry.coordinates)
      for (const c of s) assert.ok(zones.every((z) => distance(c, z) > 300));
    const exported = publicGpx(p.geometry);
    assert.ok(!/PRIVATE|<time>|<ele>|<metadata>|email/.test(exported));
    assert.ok(exported.includes('creator="Enduro.Zone"'));
    assert.ok(p.distanceM > 8000);
    assert.equal(p.pointCount, 42);
  });
  it("does not reveal the start when a route returns to it later", () => {
    const loop = [...points, ...points.slice().reverse(), ...points];
    const p = previewGpx(xml([loop]), 300);
    assert.ok(p.geometry.coordinates.length >= 3);
    for (const s of p.geometry.coordinates)
      for (const c of s)
        assert.ok(
          distance(c, points[0]) > 300 && distance(c, points.at(-1)!) > 300,
        );
  });
  it("rejects malformed XML, DTD/entities, unsupported data and bad coordinates", () => {
    for (const bad of [
      gpx.replace(
        "<gpx ",
        '<!DOCTYPE gpx [<!ENTITY x SYSTEM "file:///secret">]><gpx ',
      ),
      "<gpx>broken",
      '<gpx version="1.1"><trk/></gpx>',
      gpx.replace('lat="54"', 'lat="91"'),
      gpx.replace('lat="54"', 'lat="0x36"'),
      gpx.replace('lat="54"', 'lat=""'),
      gpx.replace("</trk>", "</wrong>"),
    ])
      assert.throws(() => previewGpx(bad, 300));
    assert.throws(
      () =>
        previewGpx(
          xml([
            [
              [32, 54],
              [32, 54.1],
            ],
          ]),
          300,
        ),
      /2 км/,
    );
    assert.throws(() => previewGpx(xml([points.slice(0, 3)]), 300), /50 м/);
  });
  it("does not draw a shortcut through a masked endpoint", () => {
    const source: [number, number][] = [
      [32, 54],
      [32.01, 54],
      [31.99, 54],
      [31.99, 54.01],
      [31.99, 54.02],
    ];
    const p = previewGpx(xml([source]), 300);
    assert.ok(p.geometry.coordinates.every((s) => !s.some((c) => c[0] > 32)));
    assert.equal(p.geometry.coordinates.length, 1);
  });
  it("limits file size, points, nesting and privacy radius", () => {
    assert.throws(() => previewGpx(gpx + " ".repeat(400000), 300), /400/);
    assert.throws(() => previewGpx(gpx, 0));
    assert.throws(
      () =>
        previewGpx(
          xml([
            Array.from({ length: 5001 }, (_, i) => [
              32,
              Number((54 + i * 0.00001).toFixed(5)),
            ]),
          ]).replace(/<time>.*?<\/time><ele>150<\/ele>/g, ""),
          300,
        ),
      /5000/,
    );
    assert.throws(
      () =>
        previewGpx(
          gpx.replace("<trk>", "<trk>" + "<extensions>".repeat(45)),
          300,
        ),
      /глубокая/,
    );
  });
});
type Client = Session & { cookie: string };
let app: FastifyInstance,
  db: Database,
  dir: string,
  org: Client,
  a: Client,
  b: Client,
  mod: Client,
  trackId: string,
  rideId: string;
const base = {
  title: "Synthetic GPX test track",
  city: "Смоленск",
  description: "Synthetic data only; this is not a real route.",
  accessNotes: "Test permission only. No riding is authorized.",
  difficulty: "easy",
  gpx,
  trimM: 300,
  publicationConsent: true,
};
function req(
  method: InjectOptions["method"],
  url: string,
  c?: Client,
  payload?: unknown,
) {
  return app.inject({
    method,
    url,
    headers: {
      origin: "http://localhost:5173",
      "x-enduro-client": "web",
      ...(c ? { cookie: c.cookie, "x-csrf-token": c.csrfToken } : {}),
    },
    ...(payload === undefined ? {} : { payload: payload as object }),
  });
}
async function register(handle: string): Promise<Client> {
  const r = await req("POST", "/api/auth/register", undefined, {
    handle,
    email: `${handle}@example.test`,
    password: "adventure-test-only-long-password",
    displayName: handle,
    city: "Сочи",
    level: "amateur",
  });
  assert.equal(r.statusCode, 201, r.body);
  return { ...r.json(), cookie: String(r.headers["set-cookie"]).split(";")[0] };
}
const createRide = (capacity = 2) =>
  req("POST", "/api/rides", org, {
    trackId,
    title: "Test ride, no real gathering",
    description: "Synthetic ride only, no actual event.",
    meetingNotes: "PRIVATE MEETING CONTACT AND POINT",
    startsAt: new Date(Date.now() + 86400000).toISOString(),
    timezone: "Europe/Moscow",
    capacity,
  });
describe("Tracks → moderation → ride membership and capacity", () => {
  before(async () => {
    dir = await mkdtemp(join(tmpdir(), "enduro-adventure-"));
    db = await openDatabase({
      url: process.env.TEST_DATABASE_URL,
      dataDir: dir,
    });
    app = await buildApp({ db });
    await app.ready();
    org = await register("adv_org");
    a = await register("adv_a");
    b = await register("adv_b");
    mod = await register("adv_mod");
    await db.query("UPDATE users SET role='moderator' WHERE id=$1", [
      mod.user.id,
    ]);
    const r = await req("POST", "/api/tracks", org, base);
    assert.equal(r.statusCode, 201, r.body);
    trackId = r.json().id;
  });
  after(async () => {
    await app.close();
    await db.close();
    const saved = await openDatabase({
      url: process.env.TEST_DATABASE_URL,
      dataDir: dir,
    });
    const [t] = await saved.query(
      "SELECT original_gpx,status FROM tracks WHERE id=$1",
      [trackId],
    );
    assert.equal(t.original_gpx, gpx);
    assert.equal(t.status, "hidden");
    assert.equal(
      (await saved.query("SELECT status FROM rides WHERE id=$1", [rideId]))[0]
        .status,
      "cancelled",
    );
    await saved.close();
    assert.ok(dir.startsWith(join(tmpdir(), "enduro-adventure-")));
    await rm(dir, { recursive: true, force: true });
  });
  it("requires a session/CSRF and does not accept caller-supplied geometry", async () => {
    assert.equal(
      (await req("POST", "/api/tracks/preview", undefined, { gpx, trimM: 300 }))
        .statusCode,
      401,
    );
    const bad = await app.inject({
      method: "POST",
      url: "/api/tracks/preview",
      headers: { cookie: org.cookie, "x-enduro-client": "web" },
      payload: { gpx, trimM: 300 },
    });
    assert.equal(bad.statusCode, 403);
    assert.equal(
      (await req("POST", "/api/tracks", org, { ...base, geometry: {} }))
        .statusCode,
      400,
    );
    const preview = await req("POST", "/api/tracks/preview", org, {
      gpx,
      trimM: 300,
    });
    assert.equal(preview.statusCode, 200);
    assert.ok(!preview.body.includes("PRIVATE"));
  });
  it("keeps pending tracks and original files inaccessible to strangers and moderators", async () => {
    assert.equal(
      (await req("GET", `/api/tracks/${trackId}`, a)).statusCode,
      404,
    );
    assert.equal(
      (await req("GET", `/api/tracks/${trackId}/gpx`)).statusCode,
      404,
    );
    for (const c of [a, mod])
      assert.equal(
        (await req("GET", `/api/tracks/${trackId}/original`, c)).statusCode,
        404,
      );
    assert.equal(
      (await req("GET", `/api/tracks/${trackId}/original`, org)).json().gpx,
      gpx,
    );
    assert.ok(
      !(await req("GET", `/api/tracks/${trackId}`, mod)).body.includes(
        "PRIVATE",
      ),
    );
    assert.equal((await createRide()).statusCode, 404);
  });
  it("publishes cleaned geometry once, exports GPX without private metadata, and creates a ride", async () => {
    const decision = {
      action: "publish",
      expectedStatus: "pending",
      reason: "Synthetic moderation decision, test only.",
    };
    assert.equal(
      (
        await req(
          "POST",
          `/api/moderation/tracks/${trackId}/decision`,
          org,
          decision,
        )
      ).statusCode,
      403,
    );
    assert.equal(
      (
        await req(
          "POST",
          `/api/moderation/tracks/${trackId}/decision`,
          mod,
          decision,
        )
      ).statusCode,
      200,
    );
    assert.equal(
      (
        await req(
          "POST",
          `/api/moderation/tracks/${trackId}/decision`,
          mod,
          decision,
        )
      ).statusCode,
      409,
    );
    const file = await req("GET", `/api/tracks/${trackId}/gpx`);
    assert.equal(file.statusCode, 200);
    assert.match(String(file.headers["content-type"]), /application\/gpx\+xml/);
    assert.ok(!file.body.includes("PRIVATE"));
    assert.ok(!file.body.includes("<time>"));
    const r = await createRide();
    assert.equal(r.statusCode, 201, r.body);
    rideId = r.json().id;
    assert.equal(r.json().acceptedCount, 1);
    assert.equal(r.json().meetingNotes, undefined);
    assert.equal(
      (await req("GET", `/api/rides/${rideId}`)).body.includes("PRIVATE"),
      false,
    );
  });
  it("validates event times, timezone, capacity and organizer-only operations", async () => {
    const fields = {
      trackId,
      title: base.title,
      description: base.description,
      meetingNotes: "Private meeting notes",
      startsAt: new Date(Date.now() + 86400000).toISOString(),
      timezone: "Europe/Moscow",
      capacity: 2,
    };
    for (const override of [
      { startsAt: new Date(0).toISOString() },
      { timezone: "Invalid/Zone" },
      { capacity: 1 },
      { capacity: 51 },
      { organizerId: a.user.id },
    ])
      assert.equal(
        (await req("POST", "/api/rides", org, { ...fields, ...override }))
          .statusCode,
        400,
      );
    assert.equal(
      (await req("GET", `/api/rides/${rideId}/members`, a)).statusCode,
      404,
    );
    assert.equal(
      (await req("POST", `/api/rides/${rideId}/cancel`, a)).statusCode,
      404,
    );
  });
  it("keeps meeting data private for guests and pending members; repeated join is idempotent", async () => {
    assert.equal(
      (await req("GET", `/api/rides/${rideId}/meeting`)).statusCode,
      401,
    );
    assert.equal(
      (await req("GET", `/api/rides/${rideId}/meeting`, a)).statusCode,
      404,
    );
    for (const c of [a, b, a])
      assert.equal(
        (await req("POST", `/api/rides/${rideId}/join`, c)).json().status,
        "pending",
      );
    assert.equal(
      (await req("GET", `/api/rides/${rideId}/meeting`, a)).statusCode,
      404,
    );
    assert.equal(
      (await req("GET", `/api/rides/${rideId}/members`, org)).json().items
        .length,
      2,
    );
    assert.equal(
      (await req("GET", `/api/rides/${rideId}`)).json().acceptedCount,
      1,
    );
  });
  it("does not overbook when two pending requests compete for the last place", async () => {
    const results = await Promise.all(
      [a, b].map((c) =>
        req("POST", `/api/rides/${rideId}/members/${c.user.id}/decision`, org, {
          action: "accept",
        }),
      ),
    );
    assert.deepEqual(results.map((r) => r.statusCode).sort(), [200, 409]);
    const winner = results[0].statusCode === 200 ? a : b,
      loser = winner === a ? b : a;
    assert.equal(
      (await req("GET", `/api/rides/${rideId}/meeting`, winner)).json()
        .meetingNotes,
      "PRIVATE MEETING CONTACT AND POINT",
    );
    assert.equal(
      (await req("GET", `/api/rides/${rideId}/meeting`, loser)).statusCode,
      404,
    );
    assert.equal(
      (
        await req(
          "POST",
          `/api/rides/${rideId}/members/${winner.user.id}/decision`,
          org,
          { action: "accept" },
        )
      ).statusCode,
      200,
    );
    assert.equal(
      (await req("POST", `/api/rides/${rideId}/leave`, winner)).json().status,
      "left",
    );
    assert.equal(
      (await req("GET", `/api/rides/${rideId}/meeting`, winner)).statusCode,
      404,
    );
    assert.equal(
      (
        await req(
          "POST",
          `/api/rides/${rideId}/members/${loser.user.id}/decision`,
          org,
          { action: "accept" },
        )
      ).statusCode,
      200,
    );
    assert.equal(
      (await req("GET", `/api/rides/${rideId}`)).json().acceptedCount,
      2,
    );
  });
  it("cancelled events disappear from upcoming list and revoke private meeting access", async () => {
    assert.equal(
      (await req("POST", `/api/rides/${rideId}/cancel`, org)).json().status,
      "cancelled",
    );
    for (const c of [a, b]) {
      assert.equal(
        (await req("GET", `/api/rides/${rideId}/meeting`, c)).statusCode,
        404,
      );
      assert.equal(
        (await req("POST", `/api/rides/${rideId}/join`, c)).statusCode,
        409,
      );
    }
    assert.equal(
      (await req("GET", "/api/rides"))
        .json()
        .items.some((r: any) => r.id === rideId),
      false,
    );
  });
  it("reports can hide a track, which also removes access to its upcoming rides", async () => {
    const r = await createRide(3);
    assert.equal(r.statusCode, 201);
    const nextId = r.json().id;
    const report = await req("POST", "/api/reports", a, {
      targetType: "track",
      targetId: trackId,
      reason: "access",
      details: "Synthetic report for hiding a test track.",
    });
    assert.equal(report.statusCode, 201, report.body);
    assert.equal(
      (
        await req(
          "POST",
          `/api/moderation/reports/${report.json().id}/decision`,
          mod,
          { action: "hide", reason: "Synthetic hiding decision for test." },
        )
      ).statusCode,
      200,
    );
    assert.equal((await req("GET", `/api/tracks/${trackId}`)).statusCode, 404);
    assert.equal(
      (await req("GET", `/api/tracks/${trackId}/gpx`, a)).statusCode,
      404,
    );
    assert.equal((await req("GET", `/api/rides/${nextId}`, a)).statusCode, 404);
    assert.equal(
      (await req("POST", `/api/rides/${nextId}/join`, b)).statusCode,
      409,
    );
  });
  it("creates private notifications for real ride and moderation decisions without meeting data", async () => {
    const organizer = (await req("GET", "/api/me/notifications", org)).json();
    assert.ok(
      organizer.items.some((n: { message: string }) =>
        n.message.includes("Новая заявка"),
      ),
    );
    assert.ok(
      organizer.items.some((n: { message: string }) =>
        n.message.includes("GPX"),
      ),
    );
    const participants = [
      ...(await req("GET", "/api/me/notifications", a)).json().items,
      ...(await req("GET", "/api/me/notifications", b)).json().items,
    ];
    assert.ok(participants.some((n) => n.message.includes("подтверждена")));
    assert.ok(participants.some((n) => n.message.includes("отменена")));
    assert.ok(
      !JSON.stringify([organizer, participants]).includes("PRIVATE MEETING"),
    );
    assert.equal(
      (await req("GET", "/api/me/notifications", mod)).json().items.length,
      0,
    );
  });
});
