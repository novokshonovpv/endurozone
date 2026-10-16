import { before, after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FastifyInstance, InjectOptions } from "fastify";
import { buildApp } from "../src/app.ts";
import { openDatabase, type Database } from "../src/database.ts";
import type {
  EnduroLocation,
  PlaceImportResult,
  Session,
} from "@enduro/contracts";
type Client = Session & { cookie: string };
let app: FastifyInstance, db: Database, dir: string, rider: Client, mod: Client;
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
    password: "import-test-password-2026",
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
const row = (extra: object) => ({
  kind: "место",
  title: "Synthetic imported quarry",
  city: "Смоленск",
  latitude: 54.7,
  longitude: 32.2,
  difficulty: "средняя",
  description: "Synthetic description for tests only.",
  accessNotes: "Synthetic access terms for tests only.",
  contacts: "",
  ...extra,
});
describe("Places from a spreadsheet (moderators)", () => {
  before(async () => {
    dir = await mkdtemp(join(tmpdir(), "enduro-import-"));
    db = await openDatabase({
      url: process.env.TEST_DATABASE_URL,
      dataDir: dir,
    });
    app = await buildApp({ db, rateMax: 1000 });
    rider = await client("import_rider");
    mod = await client("import_mod");
    await db.query("UPDATE users SET role='moderator' WHERE id=$1", [
      mod.user.id,
    ]);
  });
  after(async () => {
    await app.close();
    await db.close();
    await rm(dir, { recursive: true, force: true });
  });
  it("publishes good rows, reports bad ones with their line numbers", async () => {
    const items = [
      row({}),
      row({
        kind: "прокат",
        title: "Synthetic imported rental",
        difficulty: "",
        latitude: 54.71,
        contacts: "Synthetic contact",
      }),
      row({ title: "Synthetic duplicate in file" }),
      row({ title: "Synthetic duplicate in file" }),
      row({ title: "Synthetic no coordinates", latitude: null }),
      row({ title: "Synthetic bad kind", kind: "кафе" }),
      row({ title: "Synthetic bad level", difficulty: "космос" }),
      row({ title: "Synthetic no level", difficulty: "" }),
      row({ title: "Synthetic short", description: "short" }),
    ];
    assert.equal(
      (
        await request("POST", "/api/moderation/locations/import", rider, {
          items,
        })
      ).statusCode,
      403,
    );
    const r = await request("POST", "/api/moderation/locations/import", mod, {
      items,
    });
    assert.equal(r.statusCode, 200, r.body);
    const result = r.json<PlaceImportResult>();
    assert.equal(result.added, 3);
    assert.deepEqual(
      result.skipped.map((s) => s.row),
      [5, 6, 7, 8, 9, 10],
    );
    assert.match(result.skipped[0].reason, /Повтор/);
    const list = (await request("GET", "/api/locations?limit=30")).json<{
      items: EnduroLocation[];
    }>().items;
    const quarry = list.find((l) => l.title === "Synthetic imported quarry")!;
    assert.equal(quarry.difficulty, "medium");
    assert.equal(quarry.author.id, mod.user.id);
    const rental = list.find((l) => l.title === "Synthetic imported rental")!;
    assert.equal(rental.kind, "rental");
    assert.equal(rental.difficulty, null);
    const [log] = await db.query(
      "SELECT action,reason FROM moderation_actions WHERE target_id=$1",
      [quarry.id],
    );
    assert.equal(log.action, "publish");
  });
  it("skips places already on the map on a second upload", async () => {
    const r = await request("POST", "/api/moderation/locations/import", mod, {
      items: [row({})],
    });
    const result = r.json<PlaceImportResult>();
    assert.equal(result.added, 0);
    assert.match(result.skipped[0].reason, /уже есть/);
  });
});
