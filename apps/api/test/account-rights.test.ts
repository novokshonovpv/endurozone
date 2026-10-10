import { before, after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FastifyInstance, InjectOptions } from "fastify";
import type { Session } from "@enduro/contracts";
import { buildApp } from "../src/app.ts";
import { openDatabase, type Database } from "../src/database.ts";
type Client = Session & { cookie: string };
let app: FastifyInstance,
  db: Database,
  dir: string,
  owner: Client,
  other: Client,
  mod: Client;
let ownerTrack: string,
  otherTrack: string,
  ownerRide: string,
  otherRide: string,
  reportId: string;
const password = "rights-test-long-password-2026";
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
    password,
    displayName: handle,
    city: "Смоленск",
    level: "amateur",
  });
  assert.equal(r.statusCode, 201, r.body);
  return { ...r.json(), cookie: String(r.headers["set-cookie"]).split(";")[0] };
}
async function track(c: Client) {
  const id = randomUUID();
  await db.query(
    "INSERT INTO tracks(id,author_id,title,description,city,access_notes,difficulty,original_gpx,geometry,distance_m,trim_m,point_count,status) VALUES ($1,$2,'Synthetic test track','No real riding','Смоленск','No permission','easy','OWN ORIGINAL GPX','{\"type\":\"MultiLineString\",\"coordinates\":[]}',1000,300,2,'published')",
    [id, c.user.id],
  );
  return id;
}
async function ride(c: Client, trackId: string) {
  const r = await req("POST", "/api/rides", c, {
    trackId,
    title: "Synthetic ride only",
    description: "No real event or gathering",
    meetingNotes: c === other ? "OTHER PRIVATE MEETING" : "OWN PRIVATE MEETING",
    startsAt: new Date(Date.now() + 86400000).toISOString(),
    timezone: "Europe/Moscow",
    capacity: 4,
  });
  assert.equal(r.statusCode, 201, r.body);
  return r.json().id;
}
describe("Event moderation and account data rights", () => {
  before(async () => {
    dir = await mkdtemp(join(tmpdir(), "enduro-rights-"));
    db = await openDatabase({
      url: process.env.TEST_DATABASE_URL,
      dataDir: dir,
    });
    app = await buildApp({ db });
    await app.ready();
    owner = await register("rights_owner");
    other = await register("rights_other");
    mod = await register("rights_mod");
    await db.query("UPDATE users SET role='moderator' WHERE id=$1", [
      mod.user.id,
    ]);
    ownerTrack = await track(owner);
    otherTrack = await track(other);
    ownerRide = await ride(owner, otherTrack);
    otherRide = await ride(other, ownerTrack);
    await req("POST", `/api/rides/${ownerRide}/join`, other);
    await req(
      "POST",
      `/api/rides/${ownerRide}/members/${other.user.id}/decision`,
      owner,
      { action: "accept" },
    );
  });
  after(async () => {
    await app.close();
    await db.close();
    assert.ok(dir.startsWith(join(tmpdir(), "enduro-rights-")));
    await rm(dir, { recursive: true, force: true });
  });
  it("accepts one event report without revealing the private meeting to the moderator", async () => {
    const r = await req("POST", "/api/reports", other, {
      targetType: "ride",
      targetId: ownerRide,
      reason: "unsafe",
      details: "Synthetic moderation report only",
    });
    assert.equal(r.statusCode, 201, r.body);
    reportId = r.json().id;
    assert.equal(
      (
        await req("POST", "/api/reports", other, {
          targetType: "ride",
          targetId: ownerRide,
          reason: "unsafe",
          details: "Synthetic moderation report only",
        })
      ).statusCode,
      409,
    );
    assert.equal(
      (await req("GET", `/api/rides/${ownerRide}`, mod)).statusCode,
      200,
    );
    assert.equal(
      (await req("GET", `/api/rides/${ownerRide}/meeting`, mod)).statusCode,
      404,
    );
  });
  it("hides an event atomically and revokes participant meeting/join access while retaining organizer access", async () => {
    assert.equal(
      (
        await req(
          "POST",
          `/api/moderation/reports/${reportId}/decision`,
          other,
          { action: "hide", reason: "Test moderator decision" },
        )
      ).statusCode,
      403,
    );
    assert.equal(
      (
        await req("POST", `/api/moderation/reports/${reportId}/decision`, mod, {
          action: "hide",
          reason: "Test moderator decision",
        })
      ).statusCode,
      200,
    );
    assert.equal(
      (await req("GET", `/api/rides/${ownerRide}`, other)).statusCode,
      404,
    );
    assert.equal(
      (await req("GET", `/api/rides/${ownerRide}/meeting`, other)).statusCode,
      404,
    );
    assert.equal(
      (await req("POST", `/api/rides/${ownerRide}/join`, other)).statusCode,
      409,
    );
    assert.equal(
      (await req("GET", `/api/rides/${ownerRide}`, owner)).json().hidden,
      true,
    );
    assert.equal(
      (await req("GET", `/api/rides/${ownerRide}/meeting`, owner)).statusCode,
      200,
    );
    assert.equal(
      (await req("GET", `/api/rides/${ownerRide}`, mod)).statusCode,
      200,
    );
    const visible = (await req("GET", "/api/rides")).json().items;
    assert.ok(!visible.some((r: { id: string }) => r.id === ownerRide));
    assert.ok(
      (await req("GET", "/api/me/notifications", other))
        .json()
        .items.some((n: { message: string }) => n.message.includes("скрыта")),
    );
  });
  it("requires current password and CSRF for export, then exports only own data and no credentials", async () => {
    assert.equal(
      (await req("POST", "/api/me/export", owner, { password: "wrong" }))
        .statusCode,
      403,
    );
    assert.equal(
      (
        await app.inject({
          method: "POST",
          url: "/api/me/export",
          headers: { cookie: owner.cookie, "x-enduro-client": "web" },
          payload: { password },
        })
      ).statusCode,
      403,
    );
    const r = await req("POST", "/api/me/export", owner, { password });
    assert.equal(r.statusCode, 200, r.body);
    const data = r.json();
    assert.equal(data.account.email, owner.user.email);
    assert.equal(data.tracks.length, 1);
    assert.equal(data.tracks[0].original_gpx, "OWN ORIGINAL GPX");
    assert.equal(data.organizedRides.length, 1);
    assert.ok(!r.body.includes("OTHER PRIVATE MEETING"));
    assert.ok(!/password_hash|csrf_token|token_hash|mail_outbox/.test(r.body));
    assert.ok(String(r.headers["content-disposition"]).includes("attachment"));
    assert.equal(r.headers["cache-control"], "no-store");
  });
  it("deletes an owner and dependent events without deleting other users or their independent content", async () => {
    const bike = randomUUID(),
      post = randomUUID();
    await db.query(
      "INSERT INTO bikes(id,owner_id,make,model,year) VALUES ($1,$2,'Test','Bike',2025)",
      [bike, owner.user.id],
    );
    await db.query(
      "INSERT INTO posts(id,author_id,bike_id,title,body,kind,visibility) VALUES ($1,$2,$3,'Test post','Private owner text','ride','private')",
      [post, owner.user.id, bike],
    );
    await db.query(
      "INSERT INTO moderation_actions(id,actor_id,target_type,target_id,action,reason) VALUES ($1,$2,'track',$3,'publish','Synthetic historic moderator decision')",
      [randomUUID(), owner.user.id, otherTrack],
    );
    assert.equal(
      (
        await req("POST", "/api/me/delete", owner, {
          password,
          confirmation: "wrong",
        })
      ).statusCode,
      400,
    );
    assert.equal(
      (
        await req("POST", "/api/me/delete", owner, {
          password: "wrong",
          confirmation: "УДАЛИТЬ АККАУНТ",
        })
      ).statusCode,
      403,
    );
    const r = await req("POST", "/api/me/delete", owner, {
      password,
      confirmation: "УДАЛИТЬ АККАУНТ",
    });
    assert.equal(r.statusCode, 204, r.body);
    assert.equal((await req("GET", "/api/me", owner)).statusCode, 401);
    assert.equal(
      (await req("GET", `/api/tracks/${ownerTrack}`)).statusCode,
      404,
    );
    assert.equal(
      (await req("GET", `/api/rides/${otherRide}`, other)).statusCode,
      404,
    );
    assert.equal(
      (await req("GET", `/api/tracks/${otherTrack}`)).statusCode,
      200,
    );
    assert.equal((await req("GET", "/api/me", other)).statusCode, 200);
    for (const [table, key] of [
      ["users", "id"],
      ["bikes", "owner_id"],
      ["posts", "author_id"],
      ["sessions", "user_id"],
      ["mail_outbox", "user_id"],
      ["account_tokens", "user_id"],
      ["notifications", "user_id"],
    ])
      assert.equal(
        (
          await db.query(`SELECT * FROM ${table} WHERE ${key}=$1`, [
            owner.user.id,
          ])
        ).length,
        0,
      );
    const [audit] = await db.query(
      "SELECT actor_id FROM moderation_actions WHERE target_id=$1",
      [otherTrack],
    );
    assert.equal(audit.actor_id, null);
    assert.equal(
      (await db.query("SELECT id FROM reports WHERE id=$1", [reportId])).length,
      0,
    );
    assert.ok(
      (await req("GET", "/api/me/notifications", other))
        .json()
        .items.some((n: { message: string }) => n.message.includes("удалена")),
    );
  });
});
