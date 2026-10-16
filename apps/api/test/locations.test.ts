import { before, after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import type { FastifyInstance, InjectOptions } from "fastify";
import type { Session } from "@enduro/contracts";
import { openDatabase, type Database } from "../src/database.ts";
import { buildApp } from "../src/app.ts";
type Client = Session & { cookie: string };
let db: Database,
  app: FastifyInstance,
  dir: string,
  author: Client,
  other: Client,
  mod: Client,
  locationId: string,
  postId: string,
  privateId: string;
const location = {
  title: "TEST location — not a real riding place",
  description: "Synthetic test location for access checks.",
  city: "Смоленск",
  latitude: 54.78,
  longitude: 32.04,
  difficulty: "medium",
  accessNotes: "Test permission only. No actual access permission.",
  publicationConsent: true,
};
const reason = "Synthetic moderation decision for test.";
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
      "x-enduro-client": "web",
      origin: "http://localhost:5173",
      ...(c ? { cookie: c.cookie, "x-csrf-token": c.csrfToken } : {}),
    },
    ...(payload === undefined ? {} : { payload: payload as object }),
  });
}
async function register(handle: string): Promise<Client> {
  const r = await req("POST", "/api/auth/register", undefined, {
    handle,
    email: `${handle}@example.test`,
    password: "location-test-only-long-password",
    displayName: handle,
    city: "Сочи",
    level: "amateur",
  });
  assert.equal(r.statusCode, 201, r.body);
  return { ...r.json(), cookie: String(r.headers["set-cookie"]).split(";")[0] };
}
async function createLocation() {
  const r = await req("POST", "/api/locations", author, location);
  assert.equal(r.statusCode, 201, r.body);
  return r.json().id as string;
}
const decision = (id: string, action = "publish", expectedStatus = "pending") =>
  req("POST", `/api/moderation/locations/${id}/decision`, mod, {
    action,
    reason,
    expectedStatus,
  });
describe("Locations, reports and explicit moderator access", () => {
  before(async () => {
    dir = await mkdtemp(join(tmpdir(), "enduro-locations-"));
    db = await openDatabase({
      url: process.env.TEST_DATABASE_URL,
      dataDir: dir,
    });
    app = await buildApp({ db });
    await app.ready();
    author = await register("loc_author");
    other = await register("loc_other");
    mod = await register("loc_moderator");
    await db.query("UPDATE users SET role='moderator' WHERE id=$1", [
      mod.user.id,
    ]);
    locationId = await createLocation();
    const b = await req("POST", "/api/me/bikes", author, {
      make: "Test",
      model: "Test",
      year: 2024,
      modification: "",
      engine: "",
      hours: 0,
      notes: "",
    });
    for (const visibility of ["public", "private"]) {
      const r = await req("POST", "/api/posts", author, {
        bikeId: b.json().id,
        title: "Synthetic moderation test",
        body: "This is synthetic content for access testing only.",
        kind: "ride",
        visibility,
      });
      assert.equal(r.statusCode, 201, r.body);
      if (visibility === "public") postId = r.json().id;
      else privateId = r.json().id;
    }
  });
  after(async () => {
    await app.close();
    await db.close();
    const restored = await openDatabase({
      url: process.env.TEST_DATABASE_URL,
      dataDir: dir,
    });
    assert.equal(
      (
        await restored.query("SELECT status FROM locations WHERE id=$1", [
          locationId,
        ])
      )[0].status,
      "hidden",
    );
    assert.equal(
      (
        await restored.query(
          "SELECT version FROM schema_migrations ORDER BY version",
        )
      ).length,
      21,
    );
    await restored.close();
    assert.ok(dir.startsWith(join(tmpdir(), "enduro-locations-")));
    await rm(dir, { recursive: true, force: true });
  });
  it("does not grant moderator rights during registration or profile edits", async () => {
    assert.equal(author.user.role, "member");
    assert.equal(
      (await req("GET", "/api/moderation/locations")).statusCode,
      401,
    );
    assert.equal(
      (await req("GET", "/api/moderation/locations", author)).statusCode,
      403,
    );
    assert.equal(
      (
        await req("PATCH", "/api/me", author, {
          displayName: "loc_author",
          city: "Сочи",
          level: "amateur",
          bio: "",
          role: "moderator",
        })
      ).statusCode,
      400,
    );
    assert.equal(
      (
        await req(
          "POST",
          `/api/moderation/locations/${locationId}/decision`,
          author,
          { action: "publish", reason, expectedStatus: "pending" },
        )
      ).statusCode,
      403,
    );
    assert.equal(
      (await req("GET", "/api/me", mod)).json().user.role,
      "moderator",
    );
    assert.equal(
      (await req("GET", "/api/profiles/loc_moderator")).json().role,
      undefined,
    );
  });
  it("keeps pending locations private and validates coordinates and consent", async () => {
    assert.equal(
      (await req("GET", `/api/locations/${locationId}`)).statusCode,
      404,
    );
    assert.equal(
      (await req("GET", `/api/locations/${locationId}`, other)).statusCode,
      404,
    );
    assert.equal(
      (await req("GET", `/api/locations/${locationId}`, author)).json().status,
      "pending",
    );
    assert.equal(
      (await req("GET", "/api/locations"))
        .json()
        .items.some((l: any) => l.id === locationId),
      false,
    );
    assert.equal(
      (await req("GET", "/api/moderation/locations", mod))
        .json()
        .items.some((l: any) => l.id === locationId),
      true,
    );
    for (const override of [
      { latitude: 91 },
      { longitude: -181 },
      { publicationConsent: false },
      { status: "published" },
      { title: "   " },
    ])
      assert.equal(
        (
          await req("POST", "/api/locations", author, {
            ...location,
            ...override,
          })
        ).statusCode,
        400,
      );
    assert.equal(
      (await req("POST", "/api/locations", undefined, location)).statusCode,
      401,
    );
  });
  it("publishes once, atomically records reasons and rejects stale decisions", async () => {
    assert.equal((await decision(locationId)).statusCode, 200);
    assert.equal((await decision(locationId, "reject")).statusCode, 409);
    const publicView = (
      await req("GET", `/api/locations/${locationId}`)
    ).json();
    assert.equal(publicView.status, "published");
    assert.equal(publicView.author.email, undefined);
    assert.equal(
      (await req("GET", "/api/locations?city=%D0%A1%D0%BE%D1%87%D0%B8"))
        .json()
        .items.some((l: any) => l.id === locationId),
      false,
    );
    assert.equal(
      (await req("GET", `/api/locations/${locationId}/decisions`, other))
        .statusCode,
      404,
    );
    const audit = (
      await req("GET", `/api/locations/${locationId}/decisions`, author)
    ).json();
    assert.equal(audit.items.length, 1);
    assert.equal(audit.items[0].reason, reason);
    assert.equal(
      (
        await req(
          "POST",
          `/api/moderation/locations/${locationId}/decision`,
          mod,
          { action: "hide", reason: "   ", expectedStatus: "published" },
        )
      ).statusCode,
      400,
    );
  });
  it("rejects a location and keeps its decision visible only to the author and moderator", async () => {
    const id = await createLocation();
    assert.equal((await decision(id, "reject")).json().status, "rejected");
    assert.equal((await req("GET", `/api/locations/${id}`)).statusCode, 404);
    assert.equal(
      (await req("GET", `/api/locations/${id}/decisions`, author)).json()
        .items[0].action,
      "reject",
    );
    assert.equal((await decision(id)).statusCode, 409);
  });
  it("accepts one open report per reporter and never reveals private or missing targets", async () => {
    const base = {
      targetType: "post",
      targetId: postId,
      reason: "spam",
      details: reason,
    };
    assert.equal(
      (await req("POST", "/api/reports", undefined, base)).statusCode,
      401,
    );
    for (const targetId of [privateId, randomUUID()])
      assert.equal(
        (await req("POST", "/api/reports", other, { ...base, targetId }))
          .statusCode,
        404,
      );
    assert.equal(
      (await req("POST", "/api/reports", other, base)).statusCode,
      201,
    );
    assert.equal(
      (await req("POST", "/api/reports", other, base)).statusCode,
      409,
    );
    assert.equal(
      (await req("GET", "/api/moderation/reports", author)).statusCode,
      403,
    );
  });
  it("hides a reported post, blocks public reads/comments and prevents editing from un-hiding it", async () => {
    const queue = (await req("GET", "/api/moderation/reports", mod)).json();
    const report = queue.items.find((r: any) => r.targetId === postId);
    assert.ok(report);
    assert.equal(report.reporter_id, undefined);
    assert.equal(
      (
        await req(
          "POST",
          `/api/moderation/reports/${report.id}/decision`,
          mod,
          { action: "hide", reason },
        )
      ).statusCode,
      200,
    );
    assert.equal(
      (await req("GET", `/api/posts/${postId}`, other)).statusCode,
      404,
    );
    assert.equal(
      (await req("GET", `/api/posts/${postId}/comments`, other)).statusCode,
      404,
    );
    assert.equal(
      (
        await req("POST", `/api/posts/${postId}/comments`, author, {
          body: "Cannot comment after hide",
        })
      ).statusCode,
      404,
    );
    const p = (await req("GET", `/api/posts/${postId}`, author)).json();
    assert.equal(p.hidden, true);
    assert.equal(
      (
        await req("PATCH", `/api/posts/${postId}`, author, {
          bikeId: p.bikeId,
          title: p.title,
          body: p.body,
          kind: p.kind,
          visibility: "public",
        })
      ).json().hidden,
      true,
    );
    assert.equal(
      (await req("GET", "/api/feed"))
        .json()
        .items.some((p: any) => p.id === postId),
      false,
    );
    assert.equal(
      (
        await req(
          "POST",
          `/api/moderation/reports/${report.id}/decision`,
          mod,
          { action: "dismiss", reason },
        )
      ).statusCode,
      409,
    );
  });
  it("dismisses reports without hiding the location, then handles concurrent location decisions", async () => {
    const r = await req("POST", "/api/reports", other, {
      targetType: "location",
      targetId: locationId,
      reason: "access",
      details: reason,
    });
    assert.equal(r.statusCode, 201, r.body);
    assert.equal(
      (
        await req(
          "POST",
          `/api/moderation/reports/${r.json().id}/decision`,
          mod,
          { action: "dismiss", reason },
        )
      ).statusCode,
      200,
    );
    assert.equal(
      (await req("GET", `/api/locations/${locationId}`)).statusCode,
      200,
    );
    const results = await Promise.all([
      decision(locationId, "hide", "published"),
      decision(locationId, "hide", "published"),
    ]);
    assert.deepEqual(results.map((r) => r.statusCode).sort(), [200, 409]);
    assert.equal(
      (await req("GET", `/api/locations/${locationId}`)).statusCode,
      404,
    );
    assert.equal(
      (await req("GET", `/api/locations/${locationId}`, author)).json().status,
      "hidden",
    );
  });
  it("requires CSRF for moderation and revokes access on the next request", async () => {
    const r = await app.inject({
      method: "POST",
      url: `/api/moderation/locations/${locationId}/decision`,
      headers: { cookie: mod.cookie, "x-enduro-client": "web" },
      payload: { action: "publish", reason, expectedStatus: "pending" },
    });
    assert.equal(r.statusCode, 403);
    await db.query("UPDATE users SET role='member' WHERE id=$1", [mod.user.id]);
    assert.equal(
      (await req("GET", "/api/moderation/reports", mod)).statusCode,
      403,
    );
  });
});
