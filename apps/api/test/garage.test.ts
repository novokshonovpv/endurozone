import { before, after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { FastifyInstance, InjectOptions } from "fastify";
import { buildApp } from "../src/app.ts";
import { openDatabase, type Database } from "../src/database.ts";
import type {
  Session,
  Bike,
  ServicePlan,
  BikeService,
  ServiceRecord,
  Page,
  Post,
} from "@enduro/contracts";
type Client = Session & { cookie: string };
const password = "garage-only-long-password-2026",
  origin = "http://localhost:5173";
let app: FastifyInstance,
  db: Database,
  dir: string,
  owner: Client,
  other: Client,
  bike: Bike,
  secondBike: Bike,
  otherBike: Bike,
  plan: ServicePlan;
const request = (
  method: InjectOptions["method"],
  url: string,
  c?: Client,
  payload?: unknown,
  headers: Record<string, string> = {},
) =>
  app.inject({
    method,
    url,
    ...(payload === undefined ? {} : {payload:payload as object}),
    headers: {
      origin,
      "x-enduro-client": "web",
      ...(c ? { cookie: c.cookie, "x-csrf-token": c.csrfToken } : {}),
      ...headers,
    },
  });
const base = () => `/api/me/bikes/${bike.id}/service`;
async function client(handle: string) {
  const r = await request("POST", "/api/auth/register", undefined, {
    email: handle + "@example.test",
    password,
    handle,
    displayName: handle,
    city: "Смоленск",
    level: "amateur",
  });
  assert.equal(r.statusCode, 201, r.body);
  return {
    ...r.json<Session>(),
    cookie: String(r.headers["set-cookie"]).split(";")[0],
  };
}
async function newBike(c: Client, model: string) {
  const r = await request("POST", "/api/me/bikes", c, {
    make: "Synthetic",
    model,
    year: 2024,
    modification: "Test",
    engine: "250 / 4T",
    hours: 12,
    notes: "Private bike",
  });
  assert.equal(r.statusCode, 201, r.body);
  return r.json<Bike>();
}
describe("Private garage service, journal filtering and account lifecycle", () => {
  before(async () => {
    dir = await mkdtemp(join(tmpdir(), "enduro-garage-"));
    db = await openDatabase({
      url: process.env.TEST_DATABASE_URL,
      dataDir: dir,
    });
    app = await buildApp({ db });
    owner = await client("garage_owner");
    other = await client("garage_other");
    bike = await newBike(owner, "A250");
    secondBike = await newBike(owner, "B300");
    otherBike = await newBike(other, "C450");
  });
  after(async () => {
    await app.close();
    await db.query("DELETE FROM posts WHERE author_id IN ($1,$2)", [
      owner.user.id,
      other.user.id,
    ]);
    await db.query("DELETE FROM users WHERE id IN ($1,$2)", [
      owner.user.id,
      other.user.id,
    ]);
    await db.close();
    assert.ok(dir.startsWith(join(tmpdir(), "enduro-garage-")));
    await rm(dir, { recursive: true, force: true });
  });
  it("allows only the owner to read or create service plans and requires CSRF", async () => {
    assert.equal((await request("GET", base())).statusCode, 401);
    assert.equal((await request("GET", base(), other)).statusCode, 404);
    const body = {
      title: "Oil change synthetic",
      intervalHours: 10,
      dueHours: 10,
      notes: "OWNER PRIVATE PLAN",
    };
    assert.equal(
      (
        await request("POST", base() + "/plans", owner, body, {
          "x-csrf-token": "wrong",
        })
      ).statusCode,
      403,
    );
    assert.equal(
      (await request("POST", base() + "/plans", other, body)).statusCode,
      404,
    );
    for (const bad of [
      { ...body, intervalHours: 0 },
      { ...body, dueHours: -1 },
      { ...body, ownerId: other.user.id },
      { ...body, title: "  " },
    ])
      assert.equal(
        (await request("POST", base() + "/plans", owner, bad)).statusCode,
        400,
      );
    const r = await request("POST", base() + "/plans", owner, body);
    assert.equal(r.statusCode, 201, r.body);
    plan = r.json<ServicePlan>();
    assert.equal(plan.version, 0);
    assert.equal(plan.dueHours, 10);
    const o = await request(
      "POST",
      `/api/me/bikes/${otherBike.id}/service/plans`,
      other,
      { ...body, notes: "OTHER PRIVATE PLAN" },
    );
    assert.equal(o.statusCode, 201, o.body);
    const dashboard = (await request("GET", base(), owner)).json<BikeService>();
    assert.equal(dashboard.plans.length, 1);
    assert.ok(!JSON.stringify(dashboard).includes("OTHER PRIVATE"));
  });
  it("completes once under concurrent requests and updates next due hours and bike atomically", async () => {
    const payload = {
      version: 0,
      performedOn: "2026-01-10",
      hours: 20,
      costRub: 1234.5,
      notes: "OWNER PRIVATE HISTORY",
    };
    const url = base() + `/plans/${plan.id}/complete`;
    assert.equal((await request("POST", url, other, payload)).statusCode, 404);
    assert.equal(
      (
        await request("POST", url, owner, {
          ...payload,
          performedOn: "2026-02-30",
        })
      ).statusCode,
      400,
    );
    assert.equal(
      (
        await request("POST", url, owner, {
          ...payload,
          performedOn: "2100-01-01",
        })
      ).statusCode,
      400,
    );
    const results = await Promise.all([
      request("POST", url, owner, payload),
      request("POST", url, owner, payload),
    ]);
    assert.deepEqual(results.map((r) => r.statusCode).sort(), [201, 409]);
    const dashboard = (await request("GET", base(), owner)).json<BikeService>();
    assert.equal(dashboard.records.length, 1);
    assert.equal(dashboard.records[0].costRub, 1234.5);
    assert.equal(dashboard.records[0].performedOn, "2026-01-10");
    assert.equal(dashboard.plans[0].dueHours, 30);
    assert.equal(dashboard.plans[0].version, 1);
    const bikes = (await request("GET", "/api/me/bikes", owner)).json<{
      items: Bike[];
    }>();
    assert.equal(bikes.items.find((b) => b.id === bike.id)?.hours, 20);
    assert.equal(
      (await request("POST", url, owner, { ...payload, version: 1, hours: 19 }))
        .statusCode,
      409,
    );
    assert.equal(
      (
        await request("POST", url, owner, {
          ...payload,
          version: 1,
          performedOn: "2026-01-09",
        })
      ).statusCode,
      409,
    );
    assert.equal(
      (
        await request("POST", url, owner, {
          ...payload,
          version: 1,
          hours: 99995,
        })
      ).statusCode,
      400,
    );
    assert.equal(
      (await request("DELETE", `/api/me/bikes/${bike.id}`, owner)).statusCode,
      409,
    );
    assert.equal(
      (await request("GET", base(), owner)).json<BikeService>().records.length,
      1,
    );
  });
  it("archives and restores reminders without deleting history, rejecting stale versions", async () => {
    const url = base() + `/plans/${plan.id}`;
    assert.equal(
      (await request("POST", url + "/archive", owner, { version: 0 }))
        .statusCode,
      409,
    );
    const archived = await request("POST", url + "/archive", owner, {
      version: 1,
    });
    assert.equal(archived.statusCode, 200, archived.body);
    assert.equal(archived.json<ServicePlan>().active, false);
    assert.equal(
      (
        await request("POST", url + "/complete", owner, {
          version: 2,
          performedOn: "2026-01-11",
          hours: 25,
          costRub: 0,
          notes: "",
        })
      ).statusCode,
      409,
    );
    assert.equal(
      (await request("GET", base(), owner)).json<BikeService>().records.length,
      1,
    );
    assert.equal(
      (await request("POST", url + "/restore", other, { version: 2 }))
        .statusCode,
      404,
    );
    const restored = await request("POST", url + "/restore", owner, {
      version: 2,
    });
    assert.equal(restored.statusCode, 200, restored.body);
    assert.equal(restored.json<ServicePlan>().active, true);
    assert.equal(restored.json<ServicePlan>().version, 3);
  });
  it("filters selected-bike journal before pagination even if other bikes have many newer entries", async () => {
    for (let i = 0; i < 35; i++)
      await db.query(
        "INSERT INTO posts(id,author_id,bike_id,title,body,kind,visibility,created_at) VALUES($1,$2,$3,'Other bike entry','Synthetic post body','ride','private',now())",
        [randomUUID(), owner.user.id, secondBike.id],
      );
    for (const kind of ["ride", "maintenance"])
      await db.query(
        "INSERT INTO posts(id,author_id,bike_id,title,body,kind,visibility,created_at) VALUES($1,$2,$3,'Selected bike entry','Private selected bike body',$4,'private',now()-interval '1 day')",
        [randomUUID(), owner.user.id, bike.id, kind],
      );
    const page = (
      await request("GET", `/api/me/posts?bikeId=${bike.id}&limit=1`, owner)
    ).json<Page<Post>>();
    assert.equal(page.items.length, 1);
    assert.equal(page.items[0].bikeId, bike.id);
    assert.equal(page.nextOffset, 1);
    const next = (
      await request(
        "GET",
        `/api/me/posts?bikeId=${bike.id}&limit=1&offset=1`,
        owner,
      )
    ).json<Page<Post>>();
    assert.equal(next.items.length, 1);
    assert.notEqual(next.items[0].id, page.items[0].id);
    assert.equal(next.nextOffset, null);
    const filtered = (
      await request(
        "GET",
        `/api/me/posts?bikeId=${bike.id}&kind=maintenance`,
        owner,
      )
    ).json<Page<Post>>();
    assert.equal(filtered.items.length, 1);
    assert.equal(filtered.items[0].kind, "maintenance");
    assert.equal(
      (await request("GET", `/api/me/posts?bikeId=${bike.id}`, other)).json<
        Page<Post>
      >().items.length,
      0,
    );
  });
  it("paginates private service history and includes only own service data in export", async () => {
    for (let i = 0; i < 21; i++)
      await db.query(
        "INSERT INTO bike_service_records(id,plan_id,title,performed_on,hours,cost_rub,notes) VALUES($1,$2,'Synthetic old service','2025-01-01',5,0,'PAGINATION ONLY')",
        [randomUUID(), plan.id],
      );
    const page = (await request("GET", base(), owner)).json<BikeService>();
    assert.equal(page.records.length, 20);
    assert.equal(page.nextOffset, 20);
    const next = (
      await request("GET", base() + "?offset=20", owner)
    ).json<BikeService>();
    assert.equal(next.records.length, 2);
    assert.equal(next.nextOffset, null);
    assert.ok(
      next.records.every((r) => !page.records.some((p) => p.id === r.id)),
    );
    const r = await request("POST", "/api/me/export", owner, { password });
    assert.equal(r.statusCode, 200, r.body);
    const exportData = r.json();
    assert.equal(exportData.servicePlans.length, 1);
    assert.equal(exportData.serviceRecords.length, 22);
    assert.ok(!r.body.includes("OTHER PRIVATE PLAN"));
  });
  it("removes own service data with account deletion while preserving other garage data", async () => {
    const r = await request("POST", "/api/me/delete", owner, {
      password,
      confirmation: "УДАЛИТЬ АККАУНТ",
    });
    assert.equal(r.statusCode, 204, r.body);
    assert.equal(
      (
        await db.query("SELECT id FROM bike_service_plans WHERE id=$1", [
          plan.id,
        ])
      ).length,
      0,
    );
    assert.equal(
      (
        await db.query("SELECT id FROM bike_service_records WHERE plan_id=$1", [
          plan.id,
        ])
      ).length,
      0,
    );
    const otherData = (
      await request("GET", `/api/me/bikes/${otherBike.id}/service`, other)
    ).json<BikeService>();
    assert.equal(otherData.plans.length, 1);
    assert.equal(otherData.plans[0].notes, "OTHER PRIVATE PLAN");
  });
});
