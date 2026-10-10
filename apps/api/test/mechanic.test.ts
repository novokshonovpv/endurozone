import { before, after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.ts";
import { openDatabase, type Database } from "../src/database.ts";
import { createMechanicResponder } from "../src/mechanic.ts";
import type { Session, MechanicConsultation } from "@enduro/contracts";
type Client = Session & { cookie: string };
const origin = "http://localhost:5173",
  password = "mechanic-test-password-2026";
let app: FastifyInstance,
  offline: FastifyInstance,
  db: Database,
  dir: string,
  owner: Client,
  other: Client,
  bikeId: string,
  otherBikeId: string,
  answerId: string;
let fail = false,
  hold: Promise<void> | null = null,
  calls = 0,
  received: MechanicConsultation["bike"];
function request(
  method: "GET" | "POST" | "DELETE",
  url: string,
  c?: Client,
  payload?: object,
  headers = {},
) {
  return app.inject({
    method,
    url,
    payload,
    headers: {
      origin,
      "x-enduro-client": "web",
      ...(c ? { cookie: c.cookie, "x-csrf-token": c.csrfToken } : {}),
      ...headers,
    },
  });
}
async function client(handle: string) {
  const r = await request("POST", "/api/auth/register", undefined, {
    email: handle + "@example.test",
    password,
    handle,
    displayName: handle,
    city: "Смоленск",
    level: "beginner",
  });
  assert.equal(r.statusCode, 201, r.body);
  return {
    ...r.json<Session>(),
    cookie: String(r.headers["set-cookie"]).split(";")[0],
  };
}
const ask = (bikeId: string | null = null) => ({
  question: "Появился шум на холодном моторе, с чего начать проверку?",
  bikeId,
  consent: true,
});
describe("Private AI consultations and server-only provider", () => {
  before(async () => {
    dir = await mkdtemp(join(tmpdir(), "enduro-mechanic-"));
    db = await openDatabase({
      url: process.env.TEST_DATABASE_URL,
      dataDir: dir,
    });
    app = await buildApp({
      db,
      mechanicResponder: async (_, bike) => {
        calls++;
        received = bike;
        if (hold) await hold;
        if (fail) throw new Error("SECRET PROVIDER ERROR");
        return "Тестовый ответ провайдера, не реальная диагностика.";
      },
    });
    offline = await buildApp({ db });
    owner = await client("mechanic_owner");
    other = await client("mechanic_other");
    for (const [c, key] of [
      [owner, "owner"],
      [other, "other"],
    ] as const) {
      const r = await request("POST", "/api/me/bikes", c, {
        make: "Demo",
        model: "A250",
        year: 2024,
        engine: "250 / 4T",
        modification: "Standard",
        hours: 0,
        notes: "PRIVATE GARAGE NOTE",
      });
      assert.equal(r.statusCode, 201, r.body);
      if (key === "owner") bikeId = r.json().id;
      else otherBikeId = r.json().id;
    }
  });
  after(async () => {
    await app.close();
    await offline.close();
    await db.query("DELETE FROM users WHERE id IN ($1,$2)", [
      owner.user.id,
      other.user.id,
    ]);
    await db.close();
    assert.ok(dir.startsWith(join(tmpdir(), "enduro-mechanic-")));
    await rm(dir, { recursive: true, force: true });
  });
  it("discloses availability and requires auth, CSRF, consent and own bike", async () => {
    assert.equal(
      (await request("GET", "/api/mechanic")).json().available,
      true,
    );
    assert.equal(
      (await offline.inject("/api/mechanic")).json().available,
      false,
    );
    assert.equal((await request("GET", "/api/me/mechanic")).statusCode, 401);
    assert.equal(
      (await request("POST", "/api/me/mechanic", undefined, ask())).statusCode,
      401,
    );
    assert.equal(
      (
        await request("POST", "/api/me/mechanic", owner, ask(), {
          "x-csrf-token": "wrong",
        })
      ).statusCode,
      403,
    );
    assert.equal(
      (
        await request("POST", "/api/me/mechanic", owner, ask(), {
          origin: "https://evil.example",
        })
      ).statusCode,
      403,
    );
    assert.equal(
      (
        await request("POST", "/api/me/mechanic", owner, {
          ...ask(),
          consent: false,
        })
      ).statusCode,
      400,
    );
    assert.equal(
      (
        await request("POST", "/api/me/mechanic", owner, {
          ...ask(),
          userId: other.user.id,
        })
      ).statusCode,
      400,
    );
    assert.equal(
      (await request("POST", "/api/me/mechanic", owner, ask(otherBikeId)))
        .statusCode,
      404,
    );
    assert.equal(calls, 0);
    const r = await offline.inject({
      method: "POST",
      url: "/api/me/mechanic",
      payload: ask(),
      headers: {
        origin,
        "x-enduro-client": "web",
        cookie: owner.cookie,
        "x-csrf-token": owner.csrfToken,
      },
    });
    assert.equal(r.statusCode, 503);
    assert.equal(
      Number(
        (
          await db.query(
            "SELECT count(*) n FROM mechanic_consultations WHERE user_id=$1",
            [owner.user.id],
          )
        )[0].n,
      ),
      0,
    );
  });
  it("stores only own exchanges and passes minimal bike snapshot", async () => {
    const r = await request("POST", "/api/me/mechanic", owner, ask(bikeId));
    assert.equal(r.statusCode, 201, r.body);
    const item = r.json<MechanicConsultation>();
    answerId = item.id;
    assert.equal(item.status, "answered");
    assert.deepEqual(Object.keys(received!).sort(), [
      "engine",
      "make",
      "model",
      "modification",
      "year",
    ]);
    assert.ok(!r.body.includes("PRIVATE GARAGE NOTE"));
    assert.equal(
      (await request("GET", "/api/me/mechanic", other)).json().total,
      0,
    );
    assert.equal(
      (await request("DELETE", `/api/me/mechanic/${answerId}`, other))
        .statusCode,
      404,
    );
  });
  it("sanitizes failures and blocks concurrent provider calls without holding database transaction", async () => {
    let release!: () => void;
    hold = new Promise((resolve) => {
      release = resolve;
    });
    const starting = calls;
    const first = request("POST", "/api/me/mechanic", owner, ask());
    const pending = Promise.resolve(first);
    for (let i = 0; i < 100 && calls === starting; i++)
      await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal(calls, starting + 1);
    const second = await request("POST", "/api/me/mechanic", owner, ask());
    assert.equal(second.statusCode, 409, second.body);
    release();
    hold = null;
    assert.equal((await pending).statusCode, 201);
    fail = true;
    const failed = await request("POST", "/api/me/mechanic", owner, ask());
    fail = false;
    assert.equal(failed.statusCode, 503);
    assert.ok(!failed.body.includes("SECRET"));
    assert.ok(
      (await request("GET", "/api/me/mechanic", owner))
        .json()
        .items.some((x: MechanicConsultation) => x.status === "failed"),
    );
  });
  it("keeps daily quota after history deletion, rejects exhausted quota and expires crashed pending requests", async () => {
    await db.query(
      "INSERT INTO mechanic_usage(user_id,day,attempts) VALUES($1,(now() AT TIME ZONE 'UTC')::date,10) ON CONFLICT(user_id,day) DO UPDATE SET attempts=10",
      [owner.user.id],
    );
    assert.equal(
      (await request("DELETE", `/api/me/mechanic/${answerId}`, owner))
        .statusCode,
      204,
    );
    const starting = calls;
    assert.equal(
      (await request("POST", "/api/me/mechanic", owner, ask())).statusCode,
      429,
    );
    assert.equal(calls, starting);
    await db.query("UPDATE mechanic_usage SET attempts=0 WHERE user_id=$1", [
      owner.user.id,
    ]);
    await db.query(
      "INSERT INTO mechanic_consultations(id,user_id,question,status,created_at) VALUES('aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa',$1,'Crashed test request','pending',now()-interval '3 minutes')",
      [owner.user.id],
    );
    assert.equal(
      (await request("POST", "/api/me/mechanic", owner, ask())).statusCode,
      201,
    );
    assert.equal(
      (
        await db.query(
          "SELECT status FROM mechanic_consultations WHERE id='aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa'",
        )
      )[0].status,
      "failed",
    );
  });
  it("paginates private history and caps it before spending a provider request", async () => {
    await db.query(
      "INSERT INTO mechanic_consultations(id,user_id,question,status) SELECT md5($1::text || g::text)::uuid,$1::uuid,'Synthetic history page','failed' FROM generate_series(1,100) g",
      [owner.user.id],
    );
    const page = await request("GET", "/api/me/mechanic?offset=10", owner);
    assert.equal(page.statusCode, 200, page.body);
    assert.equal(page.json().items.length, 10);
    assert.ok(page.json().total >= 100);
    assert.equal(
      (await request("GET", "/api/me/mechanic?offset=-1", owner)).statusCode,
      400,
    );
    const starting = calls;
    const full = await request("POST", "/api/me/mechanic", owner, ask());
    assert.equal(full.statusCode, 409, full.body);
    assert.equal(full.json().error.code, "HISTORY_FULL");
    assert.equal(calls, starting);
    await db.query(
      "DELETE FROM mechanic_consultations WHERE user_id=$1 AND question='Synthetic history page'",
      [owner.user.id],
    );
    const verified = await buildApp({
      db,
      requireVerifiedEmail: true,
      mechanicResponder: async () => "unused",
    });
    try {
      const r = await verified.inject({
        method: "POST",
        url: "/api/me/mechanic",
        payload: ask(),
        headers: {
          origin,
          "x-enduro-client": "web",
          cookie: owner.cookie,
          "x-csrf-token": owner.csrfToken,
        },
      });
      assert.equal(r.statusCode, 403, r.body);
    } finally {
      await verified.close();
    }
  });
  it("exports only own history and deletes it with account while keeping others", async () => {
    assert.equal(
      (await request("POST", "/api/me/mechanic", other, ask())).statusCode,
      201,
    );
    const r = await request("POST", "/api/me/export", owner, { password });
    assert.equal(r.statusCode, 200, r.body);
    assert.ok(r.json().mechanicConsultations.length);
    assert.equal(r.json().mechanicUsage.length, 1);
    assert.ok(!r.body.includes(other.user.email));
    const deleted = await request("POST", "/api/me/delete", owner, {
      password,
      confirmation: "УДАЛИТЬ АККАУНТ",
    });
    assert.equal(deleted.statusCode, 204, deleted.body);
    assert.equal(
      Number(
        (
          await db.query(
            "SELECT count(*) n FROM mechanic_consultations WHERE user_id=$1",
            [owner.user.id],
          )
        )[0].n,
      ),
      0,
    );
    assert.equal(
      Number(
        (
          await db.query(
            "SELECT count(*) n FROM mechanic_usage WHERE user_id=$1",
            [owner.user.id],
          )
        )[0].n,
      ),
      0,
    );
    assert.equal(
      (await request("GET", "/api/me/mechanic", other)).json().total,
      1,
    );
  });
});
it("uses Responses API without stored state or personal account data and rejects partial/provider failures", async () => {
  assert.equal(createMechanicResponder({}), undefined);
  assert.equal(createMechanicResponder({ OPENAI_API_KEY: "fake" }), undefined);
  let body: Record<string, any> = {};
  const fake = (async (url, options) => {
    assert.equal(url, "https://api.openai.com/v1/responses");
    body = JSON.parse(options!.body as string);
    return new Response(
      JSON.stringify({
        status: "completed",
        output: [
          {
            type: "message",
            content: [{ type: "output_text", text: "Mock answer" }],
          },
        ],
      }),
      { status: 200 },
    );
  }) as typeof fetch;
  const responder = createMechanicResponder(
    { OPENAI_API_KEY: "test-only-key", OPENAI_MODEL: "configured-model" },
    fake,
  )!;
  assert.equal(await responder("Question", null), "Mock answer");
  assert.equal(body.store, false);
  assert.equal(body.model, "configured-model");
  assert.equal(body.max_output_tokens, 1200);
  assert.equal(body.input[0].role, "user");
  assert.deepEqual(JSON.parse(body.input[0].content), {
    question: "Question",
    bike: null,
  });
  for (const response of [
    new Response("secret", { status: 401 }),
    new Response(JSON.stringify({ status: "incomplete", output: [] }), {
      status: 200,
    }),
    new Response(JSON.stringify({ status: "completed", output: [] }), {
      status: 200,
    }),
  ]) {
    const respond = createMechanicResponder(
      { OPENAI_API_KEY: "fake", OPENAI_MODEL: "fake" },
      (async () => response) as typeof fetch,
    )!;
    await assert.rejects(respond("question", null));
  }
});
