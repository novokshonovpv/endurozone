import { before, after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { FastifyInstance, InjectOptions } from "fastify";
import type { Session } from "@enduro/contracts";
import { buildApp } from "../src/app.ts";
import { openDatabase, type Database } from "../src/database.ts";
import { notify } from "../src/pilot.ts";
import { createMailSender, deliverMail } from "../src/mail.ts";
import { hashToken } from "../src/auth.ts";
type Client = Session & { cookie: string };
let db: Database, app: FastifyInstance, dir: string, a: Client, b: Client;
const password = "pilot-only-password-2026";
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
async function token(user: Client, purpose = "verify") {
  const [r] = await db.query(
    "SELECT body FROM mail_outbox WHERE user_id=$1 AND purpose=$2 AND sent_at IS NULL ORDER BY created_at DESC",
    [user.user.id, purpose],
  );
  const t = r?.body.match(/#(?:verify|reset)\/([\w-]{43})/)?.[1];
  assert.ok(t);
  return t as string;
}
describe("Pilot: single-use account links, mail queue and private notifications", () => {
  before(async () => {
    dir = await mkdtemp(join(tmpdir(), "enduro-pilot-"));
    db = await openDatabase({
      url: process.env.TEST_DATABASE_URL,
      dataDir: dir,
    });
    app = await buildApp({ db, requireVerifiedEmail: true });
    await app.ready();
    a = await register("pilot_a");
    b = await register("pilot_b");
  });
  after(async () => {
    await app.close();
    await db.close();
    assert.ok(dir.startsWith(join(tmpdir(), "enduro-pilot-")));
    await rm(dir, { recursive: true, force: true });
  });
  it("queues verification atomically, keeps secrets out of session/profile and gates unverified writes", async () => {
    assert.equal(a.user.emailVerified, false);
    const t = await token(a);
    assert.ok(!JSON.stringify(a).includes(t));
    const [stored] = await db.query(
      "SELECT token_hash FROM account_tokens WHERE user_id=$1",
      [a.user.id],
    );
    assert.equal(stored.token_hash, hashToken(t));
    assert.equal(
      (
        await req("POST", "/api/me/bikes", a, {
          make: "Test",
          model: "Bike",
          year: 2025,
          modification: "",
          engine: "",
          hours: 0,
          notes: "",
        })
      ).statusCode,
      403,
    );
    const publicProfile = (await req("GET", "/api/profiles/pilot_a")).body;
    assert.ok(!/emailVerified|email|token|password/.test(publicProfile));
    const repeat = await Promise.all([
      req("POST", "/api/auth/email/request", a),
      req("POST", "/api/auth/email/request", a),
    ]);
    assert.ok(
      repeat.every((r) => r.statusCode === 200 || r.statusCode === 202),
    );
    assert.equal(
      (
        await db.query("SELECT id FROM mail_outbox WHERE user_id=$1", [
          a.user.id,
        ])
      ).length,
      1,
    );
  });
  it("verifies only once under concurrent consumption and enables pilot participation", async () => {
    const t = await token(a);
    const results = await Promise.all([
      req("POST", "/api/auth/email/verify", undefined, { token: t }),
      req("POST", "/api/auth/email/verify", undefined, { token: t }),
    ]);
    assert.deepEqual(results.map((r) => r.statusCode).sort(), [200, 400]);
    assert.equal(
      (await req("GET", "/api/me", a)).json().user.emailVerified,
      true,
    );
    assert.equal(
      (
        await req("POST", "/api/auth/password/reset", undefined, {
          token: t,
          password,
        })
      ).statusCode,
      400,
    );
    assert.equal(
      (
        await req("POST", "/api/me/bikes", a, {
          make: "Test",
          model: "Bike",
          year: 2025,
          modification: "",
          engine: "",
          hours: 0,
          notes: "",
        })
      ).statusCode,
      201,
    );
  });
  it("uses generic recovery responses and suppresses repeated issuance", async () => {
    const known = await req("POST", "/api/auth/password/request", undefined, {
      email: "pilot_a@example.test",
    });
    const unknown = await req("POST", "/api/auth/password/request", undefined, {
      email: "missing@example.test",
    });
    assert.equal(known.statusCode, 202);
    assert.equal(known.body, unknown.body);
    await req("POST", "/api/auth/password/request", undefined, {
      email: "PILOT_A@example.test",
    });
    assert.equal(
      (
        await db.query(
          "SELECT id FROM mail_outbox WHERE user_id=$1 AND purpose='reset'",
          [a.user.id],
        )
      ).length,
      1,
    );
  });
  it("changes password once, revokes every session and rejects the old password", async () => {
    const t = await token(a, "reset");
    const next = "pilot-new-long-password-2026";
    const results = await Promise.all([
      req("POST", "/api/auth/password/reset", undefined, {
        token: t,
        password: next,
      }),
      req("POST", "/api/auth/password/reset", undefined, {
        token: t,
        password: next,
      }),
    ]);
    assert.deepEqual(results.map((r) => r.statusCode).sort(), [200, 400]);
    assert.equal((await req("GET", "/api/me", a)).statusCode, 401);
    assert.equal(
      (
        await req("POST", "/api/auth/login", undefined, {
          email: a.user.email,
          password,
        })
      ).statusCode,
      401,
    );
    const login = await req("POST", "/api/auth/login", undefined, {
      email: a.user.email,
      password: next,
    });
    assert.equal(login.statusCode, 200);
    a = {
      ...login.json(),
      cookie: String(login.headers["set-cookie"]).split(";")[0],
    };
  });
  it("expires links and invalidates superseded tokens, without automatically logging in", async () => {
    const old = await token(b);
    await db.query(
      "UPDATE mail_outbox SET created_at=now()-interval '2 minutes' WHERE user_id=$1",
      [b.user.id],
    );
    assert.equal(
      (await req("POST", "/api/auth/email/request", b)).statusCode,
      202,
    );
    const fresh = await token(b);
    assert.notEqual(old, fresh);
    assert.equal(
      (await req("POST", "/api/auth/email/verify", undefined, { token: old }))
        .statusCode,
      400,
    );
    await db.query(
      "UPDATE account_tokens SET expires_at=now()-interval '1 minute' WHERE user_id=$1",
      [b.user.id],
    );
    assert.equal(
      (await req("POST", "/api/auth/email/verify", undefined, { token: fresh }))
        .statusCode,
      400,
    );
    assert.equal(
      (await req("GET", "/api/me", b)).json().user.emailVerified,
      false,
    );
  });
  it("protects resend/read operations with CSRF and validates recovery requests", async () => {
    assert.equal(
      (
        await app.inject({
          method: "POST",
          url: "/api/auth/email/request",
          headers: { cookie: a.cookie, "x-enduro-client": "web" },
        })
      ).statusCode,
      403,
    );
    assert.equal(
      (
        await req("POST", "/api/auth/password/request", undefined, {
          email: "bad",
        })
      ).statusCode,
      400,
    );
    assert.equal(
      (
        await req("POST", "/api/auth/password/reset", undefined, {
          token: "x".repeat(43),
          password: "short",
        })
      ).statusCode,
      400,
    );
    assert.equal(
      (
        await app.inject({
          method: "POST",
          url: "/api/auth/email/verify",
          headers: {
            origin: "https://untrusted.example",
            "x-enduro-client": "web",
          },
          payload: { token: "x".repeat(43) },
        })
      ).statusCode,
      403,
    );
  });
  it("isolates notification lists, paginates and allows only the recipient to mark read", async () => {
    await db.transaction(async (tx) => {
      await notify(tx, a.user.id, "Заявка подтверждена", "rides");
      await notify(tx, a.user.id, "Покатушка отменена", "rides");
    });
    assert.equal((await req("GET", "/api/me/notifications")).statusCode, 401);
    const page = (await req("GET", "/api/me/notifications?limit=1", a)).json();
    assert.equal(page.items.length, 1);
    assert.equal(page.nextOffset, 1);
    assert.equal(page.unreadCount, 2);
    assert.equal(
      (await req("GET", "/api/me/notifications", b)).json().items.length,
      0,
    );
    const id = page.items[0].id;
    assert.equal(
      (await req("POST", `/api/me/notifications/${id}/read`, b)).statusCode,
      404,
    );
    assert.equal(
      (await req("POST", `/api/me/notifications/${id}/read`, a)).statusCode,
      204,
    );
    assert.equal(
      (await req("POST", `/api/me/notifications/${id}/read`, a)).statusCode,
      204,
    );
    assert.equal(
      (await req("GET", "/api/me/notifications", a)).json().unreadCount,
      1,
    );
  });
  it("delivers local mail once, clears raw links in the queue and retries failures without losing the message", async () => {
    // Use a fresh reset request to avoid expired/superseded verification messages.
    await req("POST", "/api/auth/password/request", undefined, {
      email: b.user.email,
    });
    await db.query(
      "UPDATE mail_outbox SET sent_at=now(),body='' WHERE purpose='verify'",
    );
    await deliverMail(db, async () => {
      throw new Error("synthetic transport failure");
    });
    const [pending] = await db.query(
      "SELECT * FROM mail_outbox WHERE sent_at IS NULL AND purpose='reset' AND user_id=$1",
      [b.user.id],
    );
    assert.equal(pending.attempts, 1);
    assert.ok(pending.body.includes("#reset/"));
    assert.ok(new Date(pending.next_attempt_at).getTime() > Date.now());
    await db.query("UPDATE mail_outbox SET next_attempt_at=now() WHERE id=$1", [
      pending.id,
    ]);
    await deliverMail(
      db,
      createMailSender({ MAIL_MODE: "file" }, join(dir, "mail")),
    );
    const [sent] = await db.query("SELECT * FROM mail_outbox WHERE id=$1", [
      pending.id,
    ]);
    assert.ok(sent.sent_at);
    assert.equal(sent.body, "");
    const content = await readFile(
      join(dir, "mail", `${pending.id}.txt`),
      "utf8",
    );
    assert.ok(content.includes("#reset/"));
    assert.equal(
      await deliverMail(db, async () => {
        assert.fail("must not redeliver");
      }),
      false,
    );
    assert.throws(() =>
      createMailSender({ NODE_ENV: "production", MAIL_MODE: "file" }, dir),
    );
    assert.throws(() => createMailSender({ MAIL_MODE: "smtp" }, dir));
  });
});
