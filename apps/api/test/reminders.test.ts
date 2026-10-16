import { before, after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FastifyInstance, InjectOptions } from "fastify";
import { buildApp } from "../src/app.ts";
import { openDatabase, type Database } from "../src/database.ts";
import { sendRideReminders } from "../src/reminders.ts";
import type { Session } from "@enduro/contracts";
type Client = Session & { cookie: string };
let app: FastifyInstance,
  db: Database,
  dir: string,
  organizer: Client,
  rider: Client,
  pending: Client,
  trackId: string;
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
    password: "reminder-test-password-2026",
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
async function ride(hoursAhead: number) {
  const r = await request("POST", "/api/rides", organizer, {
    trackId,
    title: `Synthetic ride in ${hoursAhead} h`,
    description: "Synthetic ride for reminder tests",
    meetingNotes: "Synthetic meeting notes",
    startsAt: new Date(Date.now() + hoursAhead * 3600_000).toISOString(),
    timezone: "Europe/Moscow",
    capacity: 4,
  });
  assert.equal(r.statusCode, 201, r.body);
  return r.json().id as string;
}
const reminders = async (c: Client) =>
  (
    await db.query(
      "SELECT path FROM notifications WHERE user_id=$1 AND message LIKE 'Покатушка уже скоро%'",
      [c.user.id],
    )
  ).map((n) => n.path);
describe("Ride reminders", () => {
  before(async () => {
    dir = await mkdtemp(join(tmpdir(), "enduro-reminders-"));
    db = await openDatabase({
      url: process.env.TEST_DATABASE_URL,
      dataDir: dir,
    });
    app = await buildApp({ db, rateMax: 1000 });
    organizer = await client("remind_org");
    rider = await client("remind_rider");
    pending = await client("remind_pending");
    const gpx = `<?xml version="1.0"?><gpx version="1.1" creator="x" xmlns="http://www.topografix.com/GPX/1/1"><trk><trkseg>${Array.from({ length: 25 }, (_, i) => `<trkpt lon="32.1" lat="${54.7 + i * 0.002}"/>`).join("")}</trkseg></trk></gpx>`;
    const t = await request("POST", "/api/tracks", organizer, {
      title: "Synthetic reminder track",
      description: "Synthetic track for reminder tests",
      city: "Смоленск",
      accessNotes: "Synthetic access notes",
      difficulty: "easy",
      gpx,
      trimM: 100,
      publicationConsent: true,
    });
    trackId = t.json().id;
    await db.query("UPDATE tracks SET status='published' WHERE id=$1", [
      trackId,
    ]);
  });
  after(async () => {
    await app.close();
    await db.close();
    await rm(dir, { recursive: true, force: true });
  });
  it("reminds the organizer and accepted riders once, about a day ahead", async () => {
    const soon = await ride(20);
    const later = await ride(72);
    const cancelled = await ride(10);
    await request("POST", `/api/rides/${soon}/join`, rider);
    await request(
      "POST",
      `/api/rides/${soon}/members/${rider.user.id}/decision`,
      organizer,
      { action: "accept" },
    );
    await request("POST", `/api/rides/${soon}/join`, pending);
    await request("POST", `/api/rides/${cancelled}/cancel`, organizer);
    assert.deepEqual(await sendRideReminders(db), { rides: 1, sent: 2 });
    assert.deepEqual(await reminders(organizer), [`ride/${soon}`]);
    assert.deepEqual(await reminders(rider), [`ride/${soon}`]);
    // A pending application is not a confirmed place.
    assert.deepEqual(await reminders(pending), []);
    // Once only.
    assert.deepEqual(await sendRideReminders(db), { rides: 0, sent: 0 });
    void later;
  });
});
