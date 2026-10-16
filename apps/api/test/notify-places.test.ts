import { before, after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FastifyInstance, InjectOptions } from "fastify";
import { buildApp } from "../src/app.ts";
import { openDatabase, type Database } from "../src/database.ts";
import { seedContent } from "../src/seed.ts";
import type { EnduroLocation, Session } from "@enduro/contracts";
type Client = Session & { cookie: string };
let app: FastifyInstance,
  db: Database,
  dir: string,
  author: Client,
  follower: Client,
  visitors: Client[],
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
    password: "notify-test-password-2026",
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
const inbox = async (c: Client) =>
  (
    await db.query(
      "SELECT message,path FROM notifications WHERE user_id=$1 ORDER BY created_at",
      [c.user.id],
    )
  ).map((n) => `${n.message} → ${n.path}`);
describe("Notifications about places and tracks", () => {
  before(async () => {
    dir = await mkdtemp(join(tmpdir(), "enduro-notify-"));
    db = await openDatabase({
      url: process.env.TEST_DATABASE_URL,
      dataDir: dir,
    });
    app = await buildApp({ db, rateMax: 1000 });
    author = await client("notify_author");
    follower = await client("notify_follower");
    mod = await client("notify_mod");
    visitors = [];
    for (const h of ["notify_v1", "notify_v2", "notify_v3"])
      visitors.push(await client(h));
    await db.query("UPDATE users SET role='moderator' WHERE id=$1", [
      mod.user.id,
    ]);
    await request("PUT", `/api/me/following/${author.user.handle}`, follower);
  });
  after(async () => {
    await app.close();
    await db.close();
    await rm(dir, { recursive: true, force: true });
  });
  it("tells followers about a newly published place once, with a link to its card", async () => {
    const created = await request("POST", "/api/locations", author, {
      title: "Synthetic notify place",
      description: "Synthetic description for tests.",
      city: "Смоленск",
      latitude: 54.8,
      longitude: 32.1,
      difficulty: "easy",
      accessNotes: "Synthetic terms for tests only.",
      publicationConsent: true,
    });
    const id = created.json<EnduroLocation>().id;
    const decide = (action: string, expectedStatus: string) =>
      request("POST", `/api/moderation/locations/${id}/decision`, mod, {
        action,
        reason,
        expectedStatus,
      });
    assert.equal((await decide("publish", "pending")).statusCode, 200);
    assert.deepEqual(await inbox(follower), [
      `Новое место от райдера из ваших подписок → map?place=${id}`,
    ]);
    // Edited and published again: followers are not told twice.
    await request("PATCH", `/api/locations/${id}`, author, {
      title: "Synthetic notify place, new terms",
      description: "Synthetic description for tests.",
      city: "Смоленск",
      latitude: 54.8,
      longitude: 32.1,
      difficulty: "easy",
      accessNotes: "Synthetic terms for tests only.",
      publicationConsent: true,
    });
    await decide("publish", "pending");
    assert.equal((await inbox(follower)).length, 1);
  });
  it("tells the author about marks without flooding, and when the place is checked", async () => {
    const [place] = await db.query(
      "SELECT id FROM locations WHERE author_id=$1",
      [author.user.id],
    );
    const before = (await inbox(author)).length;
    const [v1, v2, v3] = visitors;
    await request("PUT", `/api/locations/${place.id}/visit`, v1, {});
    // Unmarking and marking again while the notice is unread adds nothing.
    await request("DELETE", `/api/locations/${place.id}/visit`, v1);
    await request("PUT", `/api/locations/${place.id}/visit`, v1, {});
    await request("PUT", `/api/locations/${place.id}/visit`, v2, {});
    // A changed vote is not a new mark.
    await request("PUT", `/api/locations/${place.id}/visit`, v2, {
      difficulty: "hard",
    });
    await request("PUT", `/api/locations/${place.id}/visit`, v3, {});
    assert.deepEqual((await inbox(author)).slice(before), [
      `Райдер отметил, что был на вашем месте → map?place=${place.id}`,
      `Ваше место проверено райдерами: отметились трое → map?place=${place.id}`,
    ]);
  });
  it("sends nothing to the team account that authored the starter places", async () => {
    await seedContent(
      db,
      [
        {
          key: "notify-team",
          kind: "spot",
          title: "Synthetic team place",
          city: "Смоленск",
          latitude: 54.9,
          longitude: 32.3,
          description: "Synthetic description for tests.",
          accessNotes: "Synthetic terms for tests only.",
        },
      ],
      [],
    );
    const [p] = await db.query(
      "SELECT id,author_id FROM locations WHERE seed_key='notify-team'",
    );
    await request("PUT", `/api/locations/${p.id}/visit`, visitors[0], {});
    const [n] = await db.query(
      "SELECT count(*) AS n FROM notifications WHERE user_id=$1",
      [p.author_id],
    );
    assert.equal(Number(n.n), 0);
  });
  it("tells followers about a newly published GPX track", async () => {
    const gpx = `<?xml version="1.0"?><gpx version="1.1" creator="x" xmlns="http://www.topografix.com/GPX/1/1"><trk><trkseg>${Array.from({ length: 25 }, (_, i) => `<trkpt lon="32.1" lat="${54.7 + i * 0.002}"/>`).join("")}</trkseg></trk></gpx>`;
    const t = await request("POST", "/api/tracks", author, {
      title: "Synthetic notify track",
      description: "Synthetic track for notification tests",
      city: "Смоленск",
      accessNotes: "Synthetic access notes",
      difficulty: "easy",
      gpx,
      trimM: 100,
      publicationConsent: true,
    });
    assert.equal(t.statusCode, 201, t.body);
    const id = t.json().id;
    const r = await request(
      "POST",
      `/api/moderation/tracks/${id}/decision`,
      mod,
      { action: "publish", reason, expectedStatus: "pending" },
    );
    assert.equal(r.statusCode, 200, r.body);
    assert.ok(
      (await inbox(follower)).includes(
        `Новый GPX-трек от райдера из ваших подписок → track/${id}`,
      ),
    );
  });
});
