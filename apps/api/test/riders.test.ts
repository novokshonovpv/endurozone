import { before, after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.ts";
import { openDatabase, type Database } from "../src/database.ts";
import type {
  Session,
  Bike,
  Post,
  Page,
  Rider,
  PublicBike,
} from "@enduro/contracts";
type Client = Session & { cookie: string };
let app: FastifyInstance,
  db: Database,
  dir: string,
  author: Client,
  other: Client,
  silent: Client,
  bike: Bike,
  second: Bike,
  privateBike: Bike,
  otherBike: Bike;
const password = "riders-only-password-2026",
  origin = "http://localhost:5173";
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
async function client(handle: string, displayName: string, city: string) {
  const r = await request("POST", "/api/auth/register", undefined, {
    email: handle + "@example.test",
    password,
    handle,
    displayName,
    city,
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
    make: "Demo",
    model,
    year: 2024,
    modification: "Demo edition",
    engine: "PRIVATE ENGINE",
    hours: 55,
    notes: "PRIVATE GARAGE NOTE",
  });
  assert.equal(r.statusCode, 201, r.body);
  return r.json<Bike>();
}
function noSecrets(body: string) {
  for (const secret of [
    "PRIVATE GARAGE NOTE",
    "PRIVATE ENGINE",
    "PRIVATE POST",
    "HIDDEN POST",
    "password_hash",
    "email_verified_at",
    "csrfToken",
    "@example.test",
    "servicePlans",
    "serviceRecords",
    '"hours"',
    '"notes"',
  ])
    assert.ok(!body.includes(secret), secret);
}
describe("Public rider discovery, visible garage and journal", () => {
  before(async () => {
    dir = await mkdtemp(join(tmpdir(), "enduro-riders-"));
    db = await openDatabase({
      url: process.env.TEST_DATABASE_URL,
      dataDir: dir,
    });
    app = await buildApp({ db });
    author = await client(
      "riders_author",
      "Тест публичного автора",
      "Смоленск",
    );
    other = await client("riders_other", "Другой публичный автор", "Сочи");
    silent = await client("riders_silent", "Закрытый участник", "Смоленск");
    bike = await newBike(author, "Public A250");
    second = await newBike(author, "Public B300");
    privateBike = await newBike(author, "PRIVATE BIKE");
    otherBike = await newBike(other, "Other A250");
    const silentBike = await newBike(silent, "Silent Bike");
    const rows = [
      {
        u: author,
        b: bike,
        kind: "ride",
        visibility: "public",
        hidden: false,
        title: "First ride",
      },
      {
        u: author,
        b: bike,
        kind: "maintenance",
        visibility: "public",
        hidden: false,
        title: "Public maintenance",
      },
      {
        u: author,
        b: bike,
        kind: "maintenance",
        visibility: "private",
        hidden: false,
        title: "PRIVATE POST",
      },
      {
        u: author,
        b: privateBike,
        kind: "build",
        visibility: "private",
        hidden: false,
        title: "PRIVATE POST",
      },
      {
        u: author,
        b: privateBike,
        kind: "ride",
        visibility: "public",
        hidden: true,
        title: "HIDDEN POST",
      },
      {
        u: other,
        b: otherBike,
        kind: "ride",
        visibility: "public",
        hidden: false,
        title: "Other story",
      },
      {
        u: silent,
        b: silentBike,
        kind: "ride",
        visibility: "private",
        hidden: false,
        title: "PRIVATE POST",
      },
      ...Array.from({ length: 32 }, (_, i) => ({
        u: author,
        b: second,
        kind: "build",
        visibility: "public",
        hidden: false,
        title: `Public build ${i}`,
      })),
    ];
    for (const row of rows)
      await db.query(
        "INSERT INTO posts(id,author_id,bike_id,title,body,kind,visibility,hidden) VALUES($1,$2,$3,$4,$5,$6,$7,$8)",
        [
          randomUUID(),
          row.u.user.id,
          row.b.id,
          row.title,
          "Synthetic story for public-profile access tests.",
          row.kind,
          row.visibility,
          row.hidden,
        ],
      );
  });
  after(async () => {
    await app.close();
    const ids = [author.user.id, other.user.id, silent.user.id];
    await db.query("DELETE FROM posts WHERE author_id=ANY($1::uuid[])", [ids]);
    await db.query("DELETE FROM users WHERE id=ANY($1::uuid[])", [ids]);
    await db.close();
    assert.ok(dir.startsWith(join(tmpdir(), "enduro-riders-")));
    await rm(dir, { recursive: true, force: true });
  });
  it("discovers only authors of visible public posts with safe public counts", async () => {
    const r = await request("GET", "/api/riders?q=riders_");
    assert.equal(r.statusCode, 200, r.body);
    const page = r.json<Page<Rider>>();
    assert.equal(page.items.length, 2);
    assert.equal(page.nextOffset, null);
    const a = page.items.find((x) => x.handle === author.user.handle)!;
    assert.equal(a.publicPostCount, 34);
    assert.equal(a.publicBikeCount, 2);
    assert.ok(!page.items.some((x) => x.id === silent.user.id));
    noSecrets(r.body);
    const own = await request("GET", "/api/riders?q=riders_", author);
    assert.deepEqual(own.json(), page);
  });
  it("searches case-insensitively by name/handle and city, treating SQL wildcard text literally", async () => {
    const q = new URLSearchParams({ q: "ТЕСТ ПУБЛИЧНОГО", city: "смол" });
    const r = await request("GET", `/api/riders?${q}`);
    assert.equal(r.statusCode, 200, r.body);
    assert.deepEqual(
      r.json().items.map((x: Rider) => x.id),
      [author.user.id],
    );
    for (const q of ["%", "' OR 1=1 --", "riders_author%", "!riders"]) {
      const r = await request("GET", `/api/riders?q=${encodeURIComponent(q)}`);
      assert.equal(r.statusCode, 200);
      assert.equal(r.json().items.length, 0);
    }
    const p = await request("GET", "/api/riders?q=riders_&limit=1");
    assert.equal(p.json().nextOffset, 1);
    const next = await request("GET", "/api/riders?q=riders_&limit=1&offset=1");
    assert.equal(next.json().nextOffset, null);
    assert.notEqual(next.json().items[0].id, p.json().items[0].id);
    for (const url of [
      "/api/riders?limit=31",
      "/api/riders?offset=-1",
      "/api/riders?email=x",
      `/api/riders?q=${"a".repeat(81)}`,
    ])
      assert.equal((await request("GET", url)).statusCode, 400, url);
  });
  it("returns minimal published bikes to guests, owner and other riders", async () => {
    const url = `/api/profiles/${author.user.handle}/bikes`;
    const guest = await request("GET", url);
    assert.equal(guest.statusCode, 200, guest.body);
    const page = guest.json<Page<PublicBike>>();
    assert.deepEqual(
      new Set(page.items.map((x) => x.id)),
      new Set([bike.id, second.id]),
    );
    assert.deepEqual(
      page.items.map((x) => x.publicPostCount).sort((a, b) => a - b),
      [2, 32],
    );
    noSecrets(guest.body);
    assert.ok(!guest.body.includes(privateBike.id));
    for (const c of [author, other])
      assert.deepEqual((await request("GET", url, c)).json(), page);
    const first = (await request("GET", url + "?limit=1")).json();
    const last = (await request("GET", url + "?limit=1&offset=1")).json();
    assert.equal(first.nextOffset, 1);
    assert.equal(last.nextOffset, null);
    assert.notEqual(first.items[0].id, last.items[0].id);
  });
  it("filters the public journal before pagination and never reveals owner-private or hidden posts", async () => {
    const url = `/api/profiles/${author.user.handle}/posts`;
    const r = await request("GET", url);
    assert.equal(r.statusCode, 200, r.body);
    assert.equal(r.json().items.length, 12);
    assert.equal(r.json().nextOffset, 12);
    noSecrets(r.body);
    const filtered = await request(
      "GET",
      url + `?bikeId=${bike.id}&kind=maintenance`,
      author,
    );
    assert.equal(filtered.statusCode, 200, filtered.body);
    const page = filtered.json<Page<Post>>();
    assert.equal(page.items.length, 1);
    assert.equal(page.items[0].title, "Public maintenance");
    assert.equal(page.nextOffset, null);
    noSecrets(filtered.body);
    for (const c of [undefined, author, other]) {
      const r = await request("GET", url + `?bikeId=${second.id}&limit=30`, c);
      assert.equal(r.json().items.length, 30);
      noSecrets(r.body);
    }
    const tail = await request(
      "GET",
      url + `?bikeId=${second.id}&limit=30&offset=30`,
    );
    assert.equal(tail.json().items.length, 2);
    assert.equal(tail.json().nextOffset, null);
  });
  it("handles silent and missing profiles and refuses foreign/unpublished bike filters", async () => {
    for (const suffix of ["bikes", "posts"]) {
      assert.deepEqual(
        (
          await request("GET", `/api/profiles/${silent.user.handle}/${suffix}`)
        ).json(),
        { items: [], nextOffset: null },
      );
      assert.equal(
        (await request("GET", `/api/profiles/not_registered/${suffix}`))
          .statusCode,
        404,
      );
    }
    for (const id of [privateBike.id, otherBike.id, randomUUID()])
      assert.equal(
        (
          await request(
            "GET",
            `/api/profiles/${author.user.handle}/posts?bikeId=${id}`,
            author,
          )
        ).statusCode,
        404,
      );
    assert.equal(
      (
        await request(
          "GET",
          `/api/profiles/${author.user.handle}/posts?kind=secret`,
        )
      ).statusCode,
      400,
    );
  });
  it("removes public bikes and discovery entries as soon as all open posts are hidden or made private", async () => {
    await db.query(
      "UPDATE posts SET visibility='private' WHERE author_id=$1 AND bike_id=$2",
      [author.user.id, bike.id],
    );
    const b = (
      await request("GET", `/api/profiles/${author.user.handle}/bikes`, author)
    ).json<Page<PublicBike>>();
    assert.deepEqual(
      b.items.map((x) => x.id),
      [second.id],
    );
    assert.equal(
      (
        await request(
          "GET",
          `/api/profiles/${author.user.handle}/posts?bikeId=${bike.id}`,
          author,
        )
      ).statusCode,
      404,
    );
    await db.query(
      "UPDATE posts SET hidden=true WHERE author_id=$1 AND visibility='public'",
      [author.user.id],
    );
    assert.equal(
      (await request("GET", "/api/riders?q=riders_author", author)).json().items
        .length,
      0,
    );
    assert.equal(
      (
        await request(
          "GET",
          `/api/profiles/${author.user.handle}/bikes`,
          author,
        )
      ).json().items.length,
      0,
    );
    assert.equal(
      (
        await request(
          "GET",
          `/api/profiles/${author.user.handle}/posts`,
          author,
        )
      ).json().items.length,
      0,
    );
    assert.ok(
      (await request("GET", "/api/me/posts", author)).json().items.length > 0,
    );
  });
});
