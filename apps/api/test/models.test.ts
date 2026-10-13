import { before, after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.ts";
import { openDatabase, type Database } from "../src/database.ts";
import type {
  Bike,
  ModelBrand,
  ModelDetail,
  ModelSummary,
  Session,
} from "@enduro/contracts";
type Client = Session & { cookie: string };
let app: FastifyInstance, db: Database, dir: string, rider: Client;
const origin = "http://localhost:5173";
function request(
  method: "GET" | "POST" | "PATCH",
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
const bike = {
  make: "BSE",
  model: "T5",
  year: 2025,
  modification: "",
  engine: "300 см³",
  hours: 0,
  notes: "",
};
describe("Motorcycle model reference", () => {
  before(async () => {
    dir = await mkdtemp(join(tmpdir(), "enduro-models-"));
    db = await openDatabase({
      url: process.env.TEST_DATABASE_URL,
      dataDir: dir,
    });
    app = await buildApp({ db, rateMax: 1000 });
    const r = await request("POST", "/api/auth/register", undefined, {
      email: "models_rider@example.test",
      password: "models-only-password-2026",
      handle: "models_rider",
      displayName: "Райдер справочника",
      city: "Смоленск",
      level: "amateur",
    });
    rider = {
      ...r.json<Session>(),
      cookie: String(r.headers["set-cookie"]).split(";")[0],
    };
  });
  after(async () => {
    await app.close();
    await db.query("DELETE FROM users WHERE id=$1", [rider.user.id]);
    await db.close();
    await rm(dir, { recursive: true, force: true });
  });
  it("lists brands and finds models by brand and words, without prices", async () => {
    const brands = (await request("GET", "/api/models/brands")).json<{
      source: string;
      items: ModelBrand[];
    }>();
    assert.equal(brands.source, "https://67moto.ru");
    assert.ok(brands.items.length > 20);
    assert.ok(brands.items.some((b) => b.brand === "BSE" && b.count > 0));
    const bse = (await request("GET", "/api/models?brand=bse&limit=60")).json<{
      items: ModelSummary[];
      total: number;
    }>();
    assert.ok(bse.total > 0);
    assert.ok(bse.items.every((m) => m.brand === "BSE"));
    assert.ok(!("price" in bse.items[0]));
    const t5 = (await request("GET", "/api/models?q=bse%20t5")).json<{
      items: ModelSummary[];
    }>();
    assert.ok(t5.items.some((m) => m.slug === "bse-t5"));
    const pit = (await request("GET", "/api/models?section=pit")).json<{
      items: ModelSummary[];
    }>();
    assert.ok(pit.items.every((m) => m.section === "pit"));
  });
  it("returns a model card with photos, plain description and specs", async () => {
    const r = await request("GET", "/api/models/bse-t5");
    assert.equal(r.statusCode, 200, r.body);
    const m = r.json<ModelDetail>();
    assert.equal(m.brand, "BSE");
    assert.ok(m.images[0].startsWith("https://67moto.ru/img/"));
    assert.ok(m.description.length > 0);
    assert.ok(!/<[a-z]/i.test(m.description));
    assert.ok(m.specs.length > 0);
    assert.equal(m.url, "https://67moto.ru/#p-bse-t5");
    assert.equal(
      (await request("GET", "/api/models/no-such-model")).statusCode,
      404,
    );
  });
  it("links a garage bike to a model, rejects unknown ones and keeps the link for older clients", async () => {
    const created = await request("POST", "/api/me/bikes", rider, {
      ...bike,
      catalogSlug: "bse-t5",
    });
    assert.equal(created.statusCode, 201, created.body);
    const b = created.json<Bike>();
    assert.equal(b.catalogSlug, "bse-t5");
    const bad = await request("POST", "/api/me/bikes", rider, {
      ...bike,
      catalogSlug: "no-such-model",
    });
    assert.equal(bad.statusCode, 400);
    assert.equal(bad.json().error.code, "CATALOG_UNKNOWN");
    const kept = await request("PATCH", `/api/me/bikes/${b.id}`, rider, {
      ...bike,
      hours: 12,
    });
    assert.equal(kept.json<Bike>().catalogSlug, "bse-t5");
    const cleared = await request("PATCH", `/api/me/bikes/${b.id}`, rider, {
      ...bike,
      catalogSlug: null,
    });
    assert.equal(cleared.json<Bike>().catalogSlug, null);
    const free = await request("POST", "/api/me/bikes", rider, bike);
    assert.equal(free.json<Bike>().catalogSlug, null);
  });
});
