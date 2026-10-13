import { before, after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.ts";
import { openDatabase, type Database } from "../src/database.ts";
import { allModels } from "../src/models.ts";
import type {
  PartFit,
  PartNodePage,
  PartsOverview,
  Session,
} from "@enduro/contracts";
type Client = Session & { cookie: string };
let app: FastifyInstance,
  db: Database,
  dir: string,
  owner: Client,
  other: Client,
  stranger: Client;
const origin = "http://localhost:5173";
function request(
  method: "GET" | "POST" | "PUT" | "DELETE",
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
async function client(handle: string): Promise<Client> {
  const r = await request("POST", "/api/auth/register", undefined, {
    email: `${handle}@example.test`,
    password: "parts-only-password-2026",
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
const bike = (c: Client, catalogSlug: string) =>
  request("POST", "/api/me/bikes", c, {
    make: "Test",
    model: "Bike",
    year: 2025,
    modification: "",
    engine: "",
    hours: 0,
    notes: "",
    catalogSlug,
  });
const fit = (c: Client, path: string, name: string, extra = {}) =>
  request("POST", `/api/parts/${path}/fits`, c, {
    name,
    partNumber: "TEST-001",
    comment: "Synthetic fit for tests",
    ...extra,
  });
describe("Parts selection", () => {
  before(async () => {
    dir = await mkdtemp(join(tmpdir(), "enduro-parts-"));
    db = await openDatabase({
      url: process.env.TEST_DATABASE_URL,
      dataDir: dir,
    });
    app = await buildApp({ db, rateMax: 1000 });
    owner = await client("parts_owner");
    other = await client("parts_other");
    stranger = await client("parts_stranger");
  });
  after(async () => {
    await app.close();
    await db.query("DELETE FROM users WHERE id=ANY($1::uuid[])", [
      [owner.user.id, other.user.id, stranger.user.id],
    ]);
    await db.close();
    await rm(dir, { recursive: true, force: true });
  });
  it("splits a model into motorcycle and engine nodes with the passport on its nodes", async () => {
    const r = await request("GET", "/api/parts/bse-t5");
    assert.equal(r.statusCode, 200, r.body);
    const o = r.json<PartsOverview>();
    assert.equal(o.model.slug, "bse-t5");
    assert.equal(o.moto.length, 14);
    assert.equal(o.engine?.key, "TYX300");
    assert.equal(o.engineNodes.length, 11);
    assert.ok(o.moto.find((n) => n.id === "wheel_front")!.passport >= 1);
    const wheel = (
      await request("GET", "/api/parts/bse-t5/moto/wheel_front")
    ).json<PartNodePage>();
    assert.ok(
      wheel.passport.some(
        (l) => l.label === "Передняя шина" && l.value === "80/100-21",
      ),
    );
    assert.deepEqual(wheel.items, []);
    assert.equal(
      (await request("GET", "/api/parts/bse-t5/moto/head")).statusCode,
      404,
    );
    assert.equal(
      (await request("GET", "/api/parts/no-such-model")).statusCode,
      404,
    );
    // Brand schemes are links only: KAYO K1 250 MX goes to its kayo.ru page, BSE has none.
    assert.equal(o.official, null);
    const kayo = (
      await request("GET", "/api/parts/mototsikl-kayo-k1-250-mx-2118")
    ).json<PartsOverview>();
    assert.equal(kayo.official?.source, "KAYO");
    assert.equal(kayo.official?.url, "https://kayo.ru/schemes/68936/");
  });
  it("lets only owners of the model add and confirm, without links", async () => {
    const denied = await fit(stranger, "bse-t5/moto/wheel_front", "Шина");
    assert.equal(denied.statusCode, 403);
    assert.equal(denied.json().error.code, "OWNER_REQUIRED");
    assert.equal((await bike(owner, "bse-t5")).statusCode, 201);
    assert.equal((await bike(other, "bse-t5")).statusCode, 201);
    const spam = await fit(owner, "bse-t5/moto/wheel_front", "Шина", {
      comment: "Купите на https://example.test",
    });
    assert.equal(spam.statusCode, 400);
    const created = await fit(
      owner,
      "bse-t5/moto/wheel_front",
      "Покрышка 80/100-21",
    );
    assert.equal(created.statusCode, 201, created.body);
    const f = created.json<PartFit>();
    assert.equal(
      (await request("PUT", `/api/part-fits/${f.id}/vote`, owner)).statusCode,
      400,
    );
    assert.equal(
      (await request("PUT", `/api/part-fits/${f.id}/vote`, stranger))
        .statusCode,
      403,
    );
    assert.equal(
      (await request("PUT", `/api/part-fits/${f.id}/vote`, other)).statusCode,
      204,
    );
    const page = (
      await request("GET", "/api/parts/bse-t5/moto/wheel_front", other)
    ).json<PartNodePage>();
    assert.equal(page.viewerOwns, true);
    assert.equal(page.fits[0].votes, 1);
    assert.equal(page.fits[0].viewerVoted, true);
    const overview = (
      await request("GET", "/api/parts/bse-t5")
    ).json<PartsOverview>();
    assert.equal(overview.moto.find((n) => n.id === "wheel_front")!.fits, 1);
    assert.equal(
      (await request("DELETE", `/api/part-fits/${f.id}/vote`, other))
        .statusCode,
      204,
    );
    assert.equal(
      (await request("DELETE", `/api/part-fits/${f.id}`, other)).statusCode,
      404,
    );
    assert.equal(
      (await request("DELETE", `/api/part-fits/${f.id}`, owner)).statusCode,
      204,
    );
  });
  it("shares engine entries between models with the same engine", async () => {
    // Two different models of the reference with one engine code.
    const byKey = new Map<string, string>();
    let pair: [string, string] | null = null;
    for (const m of allModels) {
      const o = (
        await request("GET", `/api/parts/${m.slug}`)
      ).json<PartsOverview>();
      if (!o.engine) continue;
      const seen = byKey.get(o.engine.key);
      if (seen) {
        pair = [seen, m.slug];
        break;
      }
      byKey.set(o.engine.key, m.slug);
    }
    assert.ok(pair, "the reference has shared engines");
    const [a, b] = pair!;
    await bike(stranger, a);
    const created = await fit(stranger, `${a}/engine/lube`, "Фильтр масляный");
    assert.equal(created.statusCode, 201, created.body);
    const seenFromB = (
      await request("GET", `/api/parts/${b}/engine/lube`)
    ).json<PartNodePage>();
    assert.ok(seenFromB.fits.some((x) => x.name === "Фильтр масляный"));
    // A moderator removes an entry and leaves a journal line.
    await db.query("UPDATE users SET role='moderator' WHERE id=$1", [
      other.user.id,
    ]);
    const id = created.json<PartFit>().id;
    assert.equal(
      (await request("DELETE", `/api/part-fits/${id}`, other)).statusCode,
      204,
    );
    const [log] = await db.query(
      "SELECT action FROM moderation_actions WHERE target_type='part_fit' AND target_id=$1",
      [id],
    );
    assert.equal(log.action, "delete");
  });
});
