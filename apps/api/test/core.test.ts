import { before, after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildApp } from "../src/app.ts";
import { openDatabase, type Database } from "../src/database.ts";
import { hashToken } from "../src/auth.ts";
import type { FastifyInstance, InjectOptions } from "fastify";
import type { Session, Bike, Post } from "@enduro/contracts";

const origin = "http://localhost:5173";
const password = "test-only-long-password-27";
const bikeData = {
  make: "Test",
  model: "A250",
  year: 2024,
  modification: "Test edition",
  engine: "250 / 4T",
  hours: 12,
  notes: "PRIVATE BIKE NOTE",
};
type Client = Session & { cookie: string };
let app: FastifyInstance,
  db: Database,
  dir: string,
  alice: Client,
  bob: Client,
  bike: Bike,
  publicPost: Post,
  privatePost: Post;
function request(
  method: InjectOptions["method"],
  url: string,
  client?: Client,
  payload?: unknown,
  extra: Record<string, string> = {},
) {
  return app.inject({
    method,
    url,
    headers: {
      "x-enduro-client": "web",
      origin,
      ...(client
        ? { cookie: client.cookie, "x-csrf-token": client.csrfToken }
        : {}),
      ...extra,
    },
    ...(payload === undefined ? {} : { payload: payload as object }),
  });
}
async function register(
  handle: string,
  email = `${handle}@example.test`,
  city = "Смоленск",
): Promise<Client> {
  const response = await request("POST", "/api/auth/register", undefined, {
    handle,
    email,
    password,
    displayName: handle,
    city,
    level: "amateur",
  });
  assert.equal(response.statusCode, 201, response.body);
  const cookie = String(response.headers["set-cookie"]).split(";")[0];
  return { ...response.json<Session>(), cookie };
}
async function newPost(
  client: Client,
  b: Bike,
  visibility: "public" | "private" = "public",
  kind = "ride",
) {
  const response = await request("POST", "/api/posts", client, {
    bikeId: b.id,
    title: `Test ${visibility}`,
    body: "Test content for the enduro journal.",
    visibility,
    kind,
  });
  assert.equal(response.statusCode, 201, response.body);
  return response.json<Post>();
}
describe("Account → garage → journal with server-side access", () => {
  before(async () => {
    dir = await mkdtemp(join(tmpdir(), "enduro-test-"));
    db = await openDatabase({
      url: process.env.TEST_DATABASE_URL,
      dataDir: dir,
    });
    app = await buildApp({ db });
    await app.ready();
    alice = await register("alice", "ALICE@example.test");
    bob = await register("bob", undefined, "Сочи");
    const response = await request("POST", "/api/me/bikes", alice, bikeData);
    assert.equal(response.statusCode, 201, response.body);
    bike = response.json();
    publicPost = await newPost(alice, bike);
    privatePost = await newPost(alice, bike, "private");
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
        await restored.query("SELECT id FROM users WHERE id=$1", [
          alice.user.id,
        ])
      ).length,
      1,
      "Account survives database restart",
    );
    assert.equal(
      (
        await restored.query("SELECT id FROM posts WHERE id=$1", [
          privatePost.id,
        ])
      ).length,
      1,
      "Private journal survives restart",
    );
    await restored.close();
    const target = join(tmpdir(), "enduro-test-");
    assert.ok(
      dir.startsWith(target),
      "Only remove the exact generated test directory",
    );
    await rm(dir, { recursive: true, force: true });
  });
  it("requires a session for personal data and mutations", async () => {
    assert.equal((await request("GET", "/api/me")).statusCode, 401);
    assert.equal((await request("GET", "/api/me/bikes")).statusCode, 401);
    assert.equal(
      (await request("POST", "/api/me/bikes", undefined, bikeData)).statusCode,
      401,
    );
  });
  it("normalizes email and keeps password/session secrets out of public data", async () => {
    assert.equal(alice.user.email, "alice@example.test");
    const [user] = await db.query(
      "SELECT password_hash FROM users WHERE id=$1",
      [alice.user.id],
    );
    assert.ok(user.password_hash.startsWith("scrypt$"));
    assert.ok(!user.password_hash.includes(password));
    const [session] = await db.query(
      "SELECT token_hash FROM sessions WHERE user_id=$1",
      [alice.user.id],
    );
    assert.equal(session.token_hash, hashToken(alice.cookie.split("=")[1]));
    const response = await request("GET", "/api/profiles/alice");
    assert.equal(response.statusCode, 200);
    assert.ok(!response.body.includes("email"));
    assert.ok(!response.body.includes("password"));
    assert.ok(!response.body.includes("csrf"));
  });
  it("returns a conflict without creating a duplicate account", async () => {
    const response = await request("POST", "/api/auth/register", undefined, {
      handle: "alice",
      email: "other@example.test",
      password,
      displayName: "Another Alice",
      city: "Сочи",
      level: "amateur",
    });
    assert.equal(response.statusCode, 409);
    assert.equal(response.json().error.code, "ACCOUNT_EXISTS");
    assert.equal(
      (await db.query("SELECT id FROM users WHERE email='other@example.test'"))
        .length,
      0,
    );
  });
  it("rejects malformed, extra and oversized input", async () => {
    assert.equal(
      (
        await request("POST", "/api/me/bikes", alice, {
          ...bikeData,
          year: 1600,
        })
      ).statusCode,
      400,
    );
    assert.equal(
      (
        await request("POST", "/api/me/bikes", alice, {
          ...bikeData,
          ownerId: bob.user.id,
        })
      ).statusCode,
      400,
    );
    assert.equal(
      (
        await request("POST", "/api/posts", alice, {
          bikeId: bike.id,
          title: "abc",
          body: " ".repeat(15),
          kind: "ride",
          visibility: "public",
        })
      ).statusCode,
      400,
    );
    assert.equal(
      (
        await request("POST", "/api/me/bikes", alice, {
          ...bikeData,
          model: "x".repeat(70000),
        })
      ).statusCode,
      413,
    );
  });
  it("blocks missing CSRF tokens, forged origins and ordinary form submissions", async () => {
    assert.equal(
      (
        await request("POST", "/api/me/bikes", alice, bikeData, {
          "x-csrf-token": "",
        })
      ).statusCode,
      403,
    );
    assert.equal(
      (
        await request("POST", "/api/me/bikes", alice, bikeData, {
          origin: "https://attacker.example",
        })
      ).statusCode,
      403,
    );
    assert.equal(
      (
        await app.inject({
          method: "POST",
          url: "/api/auth/logout",
          headers: { cookie: alice.cookie },
        })
      ).statusCode,
      403,
    );
  });
  it("supports multiple bikes, editing and deletion without losing journal history", async () => {
    const b = (
      await request("POST", "/api/me/bikes", alice, {
        ...bikeData,
        model: "B300",
      })
    ).json<Bike>();
    const changed = await request("PATCH", `/api/me/bikes/${b.id}`, alice, {
      ...bikeData,
      model: "B300",
      hours: 25,
    });
    assert.equal(changed.statusCode, 200);
    assert.equal(changed.json().hours, 25);
    assert.equal(
      (await request("GET", "/api/me/bikes", alice)).json().items.length,
      2,
    );
    assert.equal(
      (await request("DELETE", `/api/me/bikes/${bike.id}`, alice)).statusCode,
      409,
    );
    assert.equal(
      (await request("DELETE", `/api/me/bikes/${b.id}`, alice)).statusCode,
      204,
    );
  });
  it("prevents another rider from changing bikes or writing to their journal", async () => {
    assert.equal(
      (await request("PATCH", `/api/me/bikes/${bike.id}`, bob, bikeData))
        .statusCode,
      404,
    );
    assert.equal(
      (await request("DELETE", `/api/me/bikes/${bike.id}`, bob)).statusCode,
      404,
    );
    assert.equal(
      (
        await request("POST", "/api/posts", bob, {
          bikeId: bike.id,
          title: "Forged entry",
          body: "Attacker attempts to write in someone else journal",
          kind: "ride",
          visibility: "public",
        })
      ).statusCode,
      404,
    );
    assert.equal(
      (await request("GET", "/api/me/bikes", bob)).json().items.length,
      0,
    );
  });
  it("protects private entries, including direct URLs and comments", async () => {
    assert.equal(
      (await request("GET", `/api/posts/${privatePost.id}`, alice)).statusCode,
      200,
    );
    assert.equal(
      (await request("GET", `/api/posts/${privatePost.id}`, bob)).statusCode,
      404,
    );
    assert.equal(
      (await request("GET", `/api/posts/${privatePost.id}`)).statusCode,
      404,
    );
    assert.equal(
      (await request("GET", `/api/posts/${privatePost.id}/comments`, bob))
        .statusCode,
      404,
    );
    assert.equal(
      (
        await request("POST", `/api/posts/${privatePost.id}/comments`, bob, {
          body: "Trying to read hidden content",
        })
      ).statusCode,
      404,
    );
    const feed = await request("GET", "/api/feed");
    assert.ok(!feed.body.includes(privatePost.id));
    assert.ok(!feed.body.includes("PRIVATE BIKE NOTE"));
    assert.ok(!feed.body.includes("email"));
  });
  it("filters and paginates the public feed without exposing closed entries", async () => {
    await newPost(alice, bike, "public", "maintenance");
    const response = await request("GET", "/api/feed?limit=1");
    assert.equal(response.json().items.length, 1);
    assert.equal(response.json().nextOffset, 1);
    assert.equal(
      (await request("GET", "/api/feed?city=%D0%A1%D0%BE%D1%87%D0%B8")).json()
        .items.length,
      0,
    );
    const filtered = (
      await request("GET", "/api/feed?kind=maintenance")
    ).json();
    assert.equal(filtered.items.length, 1);
    assert.equal(filtered.items[0].kind, "maintenance");
    assert.equal((await request("GET", "/api/feed?limit=999")).statusCode, 400);
  });
  it("allows a participant to comment but only the author can delete their comment", async () => {
    const c = await request(
      "POST",
      `/api/posts/${publicPost.id}/comments`,
      bob,
      { body: "What did you learn on that ride?" },
    );
    assert.equal(c.statusCode, 201);
    const id = c.json().id;
    const p = (await request("GET", `/api/posts/${publicPost.id}`)).json();
    assert.equal(p.commentCount, 1);
    assert.equal(
      (await request("DELETE", `/api/comments/${id}`, alice)).statusCode,
      404,
    );
    assert.equal(
      (await request("DELETE", `/api/comments/${id}`, bob)).statusCode,
      204,
    );
  });
  it("updates visibility on the server and protects modification/deletion", async () => {
    const p = await newPost(alice, bike);
    const body = {
      bikeId: bike.id,
      title: "Now private",
      body: "A previously public record is closed now.",
      kind: "ride",
      visibility: "private",
    };
    assert.equal(
      (await request("PATCH", `/api/posts/${p.id}`, bob, body)).statusCode,
      404,
    );
    assert.equal(
      (await request("PATCH", `/api/posts/${p.id}`, alice, body)).statusCode,
      200,
    );
    assert.equal(
      (await request("GET", `/api/posts/${p.id}`, bob)).statusCode,
      404,
    );
    assert.equal(
      (await request("DELETE", `/api/posts/${p.id}`, bob)).statusCode,
      404,
    );
    assert.equal(
      (await request("DELETE", `/api/posts/${p.id}`, alice)).statusCode,
      204,
    );
  });
  it("uses generic login errors and revokes rotated/logout sessions", async () => {
    const payload = { email: "alice@example.test", password: "wrong" };
    const wrong = await request("POST", "/api/auth/login", undefined, payload);
    const unknown = await request("POST", "/api/auth/login", undefined, {
      ...payload,
      email: "unknown@example.test",
    });
    assert.equal(wrong.statusCode, 401);
    assert.equal(unknown.json().error.message, wrong.json().error.message);
    const login = await request("POST", "/api/auth/login", alice, {
      email: "alice@example.test",
      password,
    });
    assert.equal(login.statusCode, 200);
    const rotated: Client = {
      ...login.json(),
      cookie: String(login.headers["set-cookie"]).split(";")[0],
    };
    assert.notEqual(rotated.cookie, alice.cookie);
    assert.equal((await request("GET", "/api/me", alice)).statusCode, 401);
    assert.equal(
      (await request("POST", "/api/auth/logout", rotated)).statusCode,
      204,
    );
    assert.equal((await request("GET", "/api/me", rotated)).statusCode, 401);
    assert.equal(login.headers["cache-control"], "no-store");
    assert.ok(String(login.headers["set-cookie"]).includes("HttpOnly"));
    assert.ok(String(login.headers["set-cookie"]).includes("SameSite=Lax"));
  });
  it("exposes versioned OpenAPI and limits bursts of requests", async () => {
    const response = await request("GET", "/api/openapi.json");
    assert.equal(response.statusCode, 200);
    assert.ok(response.json().paths["/api/me/bikes"]);
    const limited = await buildApp({ db, rateMax: 2 });
    await limited.ready();
    try {
      assert.equal((await limited.inject("/api/health")).statusCode, 200);
      assert.equal((await limited.inject("/api/health")).statusCode, 200);
      const blocked = await limited.inject("/api/health");
      assert.equal(blocked.statusCode, 429);
      assert.equal(blocked.json().error.code, "RATE_LIMITED");
    } finally {
      await limited.close();
    }
  });
  it("serves a built web client while preserving API errors", async () => {
    const webRoot = join(dir, "web-fixture");
    await mkdir(webRoot);
    await writeFile(
      join(webRoot, "index.html"),
      '<!doctype html><html lang="ru"><title>Enduro test build</title></html>',
    );
    const built = await buildApp({ db, webRoot });
    try {
      const response = await built.inject("/");
      assert.equal(response.statusCode, 200);
      assert.ok(response.body.includes("Enduro test build"));
      const fallback = await built.inject("/community");
      assert.equal(fallback.statusCode, 200);
      const missing = await built.inject("/api/missing");
      assert.equal(missing.statusCode, 404);
      assert.equal(missing.json().error.code, "NOT_FOUND");
    } finally {
      await built.close();
    }
  });
});
