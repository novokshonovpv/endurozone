import { before, after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { buildApp } from "../src/app.ts";
import { openDatabase, type Database } from "../src/database.ts";
import type { FastifyInstance } from "fastify";
import type { Session, Bike, Post, Photo } from "@enduro/contracts";
type Client = Session & { cookie: string };
let db: Database,
  app: FastifyInstance,
  owner: Client,
  stranger: Client,
  bike: Bike,
  post: Post,
  cover: Photo,
  attached: Photo;
let png: Buffer;
const password = "photos-only-password-2026";
function req(
  method: "GET" | "POST" | "PATCH" | "DELETE",
  url: string,
  client?: Client,
  payload?: object,
) {
  return app.inject({
    method,
    url,
    payload,
    headers: {
      origin: "http://localhost:5173",
      "x-enduro-client": "web",
      ...(client
        ? { cookie: client.cookie, "x-csrf-token": client.csrfToken }
        : {}),
    },
  });
}
async function client() {
  const handle = "p_" + randomUUID().slice(0, 8);
  const r = await req("POST", "/api/auth/register", undefined, {
    email: `${handle}@example.test`,
    password,
    handle,
    displayName: "Тест фото",
    city: "Смоленск",
    level: "amateur",
  });
  assert.equal(r.statusCode, 201, r.body);
  return {
    ...r.json<Session>(),
    cookie: String(r.headers["set-cookie"]).split(";")[0],
  };
}
const upload = (kind: "bikes" | "posts", id: string, c = owner, data = png) =>
  req("POST", `/api/${kind}/${id}/photos`, c, {
    data: data.toString("base64"),
  });
async function visibility(value: "public" | "private") {
  const r = await req("PATCH", `/api/posts/${post.id}`, owner, {
    bikeId: bike.id,
    title: post.title,
    body: post.body,
    kind: post.kind,
    visibility: value,
  });
  assert.equal(r.statusCode, 200, r.body);
}
describe("Photo processing, privacy, quotas and lifecycle", () => {
  before(async () => {
    db = await openDatabase({ url: process.env.TEST_DATABASE_URL });
    app = await buildApp({ db, rateMax: 1000 });
    owner = await client();
    stranger = await client();
    const b = await req("POST", "/api/me/bikes", owner, {
      make: "Demo",
      model: "Photo",
      year: 2024,
      modification: "Demo",
      engine: "",
      hours: 0,
      notes: "PRIVATE",
    });
    assert.equal(b.statusCode, 201, b.body);
    bike = b.json();
    const p = await req("POST", "/api/posts", owner, {
      bikeId: bike.id,
      title: "Тест фото",
      body: "Синтетическая запись для проверки фото.",
      kind: "build",
      visibility: "private",
    });
    assert.equal(p.statusCode, 201, p.body);
    post = p.json();
    png = await sharp({
      create: { width: 20, height: 10, channels: 3, background: "#448833" },
    })
      .png()
      .withMetadata({
        orientation: 6,
        exif: { IFD0: { Artist: "PRIVATE EXIF AUTHOR" } },
      })
      .toBuffer();
  });
  after(async () => {
    await db.query("DELETE FROM posts WHERE author_id=ANY($1::uuid[])", [
      [owner.user.id, stranger.user.id],
    ]);
    await db.query("DELETE FROM users WHERE id=ANY($1::uuid[])", [
      [owner.user.id, stranger.user.id],
    ]);
    await app.close();
    await db.close();
  });
  it("normalizes orientation, strips metadata and serves JPEG without caching", async () => {
    const c = await upload("bikes", bike.id);
    assert.equal(c.statusCode, 201, c.body);
    cover = c.json();
    const p = await upload("posts", post.id);
    assert.equal(p.statusCode, 201, p.body);
    attached = p.json();
    assert.deepEqual(Object.keys(cover).sort(), [
      "createdAt",
      "height",
      "id",
      "url",
      "width",
    ]);
    assert.equal(cover.width, 10);
    assert.equal(cover.height, 20);
    const image = await req("GET", cover.url, owner);
    assert.equal(image.statusCode, 200);
    assert.equal(image.headers["content-type"], "image/jpeg");
    assert.equal(image.headers["cache-control"], "no-store");
    const meta = await sharp(image.rawPayload).metadata();
    assert.equal(meta.format, "jpeg");
    assert.equal(meta.exif, undefined);
    assert.equal(meta.xmp, undefined);
    assert.equal(meta.icc, undefined);
    assert.equal(meta.orientation, undefined);
  });
  it("checks live visibility for direct image URLs, public cover and lists", async () => {
    for (const path of [
      cover.url,
      attached.url,
      `/api/bikes/${bike.id}/photos`,
      `/api/posts/${post.id}/photos`,
    ]) {
      assert.equal((await req("GET", path)).statusCode, 404);
      assert.equal((await req("GET", path, stranger)).statusCode, 404);
    }
    await visibility("public");
    for (const path of [
      cover.url,
      attached.url,
      `/api/bikes/${bike.id}/photos`,
      `/api/posts/${post.id}/photos`,
    ])
      assert.equal((await req("GET", path)).statusCode, 200);
    await db.query("UPDATE posts SET hidden=true WHERE id=$1", [post.id]);
    assert.equal((await req("GET", attached.url)).statusCode, 404);
    assert.equal((await req("GET", cover.url)).statusCode, 404);
    assert.equal((await req("GET", attached.url, owner)).statusCode, 200);
    await db.query("UPDATE posts SET hidden=false WHERE id=$1", [post.id]);
    await visibility("private");
    assert.equal((await req("GET", attached.url)).statusCode, 404);
  });
  it("requires ownership, CSRF and verified email when enabled", async () => {
    assert.equal((await upload("bikes", bike.id, stranger)).statusCode, 404);
    assert.equal(
      (await req("DELETE", `/api/photos/${attached.id}`, stranger)).statusCode,
      404,
    );
    assert.equal(
      (
        await req("POST", `/api/bikes/${bike.id}/photos`, undefined, {
          data: png.toString("base64"),
        })
      ).statusCode,
      401,
    );
    const csrf = await app.inject({
      method: "POST",
      url: `/api/bikes/${bike.id}/photos`,
      headers: { cookie: owner.cookie, "x-enduro-client": "web" },
      payload: { data: png.toString("base64") },
    });
    assert.equal(csrf.statusCode, 403);
    const gated = await buildApp({ db, requireVerifiedEmail: true });
    try {
      const r = await gated.inject({
        method: "POST",
        url: `/api/bikes/${bike.id}/photos`,
        headers: {
          cookie: owner.cookie,
          "x-enduro-client": "web",
          "x-csrf-token": owner.csrfToken,
        },
        payload: { data: png.toString("base64") },
      });
      assert.equal(r.statusCode, 403);
      assert.equal(r.json().error.code, "EMAIL_UNVERIFIED");
    } finally {
      await gated.close();
    }
  });
  it("rejects malformed, SVG, animated and excessive inputs; downsizes large images", async () => {
    for (const data of [
      Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'/ >"),
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
      await sharp({
        create: { width: 5, height: 5, channels: 3, background: "red" },
      })
        .gif()
        .toBuffer(),
    ])
      assert.equal(
        (await upload("bikes", bike.id, owner, data)).statusCode,
        400,
      );
    const bad = await req("POST", `/api/bikes/${bike.id}/photos`, owner, {
      data: "AAAA!!!!",
    });
    assert.equal(bad.statusCode, 400);
    const animated = await sharp(
      Buffer.concat([Buffer.alloc(300, 40), Buffer.alloc(300, 180)]),
      { raw: { width: 10, height: 20, channels: 3, pageHeight: 10 } },
    )
      .webp()
      .toBuffer();
    assert.equal((await sharp(animated).metadata()).pages, 2);
    assert.equal(
      (await upload("bikes", bike.id, owner, animated)).statusCode,
      400,
    );
    const pixels = await sharp({
      create: { width: 5000, height: 5000, channels: 3, background: "red" },
    })
      .jpeg()
      .toBuffer();
    assert.equal(
      (await upload("bikes", bike.id, owner, pixels)).statusCode,
      400,
    );
    const over = await upload(
      "bikes",
      bike.id,
      owner,
      Buffer.alloc(5 * 1024 * 1024 + 1),
    );
    assert.ok([400, 413].includes(over.statusCode));
    const large = await sharp({
      create: { width: 2000, height: 1000, channels: 3, background: "blue" },
    })
      .webp()
      .toBuffer();
    const resized = await upload("bikes", bike.id, owner, large);
    assert.equal(resized.statusCode, 201, resized.body);
    assert.equal(resized.json().width, 1600);
    assert.equal(resized.json().height, 800);
    assert.equal((await req("GET", cover.url, owner)).statusCode, 404);
    cover = resized.json();
  });
  it("caps six post images and preserves the old cover when account quota fails", async () => {
    for (let i = 0; i < 5; i++)
      assert.equal((await upload("posts", post.id)).statusCode, 201);
    assert.equal((await upload("posts", post.id)).statusCode, 409);
    const rows = await db.query(
      "INSERT INTO photos(id,owner_id,post_id,image,width,height) SELECT gen_random_uuid(),$1,$2,$3,1,1 FROM generate_series(1,100) RETURNING id",
      [owner.user.id, post.id, Buffer.from([1])],
    );
    try {
      const r = await upload("bikes", bike.id);
      assert.equal(r.statusCode, 409);
      assert.equal(r.json().error.code, "PHOTO_QUOTA");
      assert.equal((await req("GET", cover.url, owner)).statusCode, 200);
    } finally {
      await db.query("DELETE FROM photos WHERE id=ANY($1::uuid[])", [
        rows.map((r) => r.id),
      ]);
    }
  });
  it("serializes competing uploads for the final post slot", async () => {
    const p = await req("POST", "/api/posts", owner, {
      bikeId: bike.id,
      title: "Параллельная загрузка",
      body: "Синтетическая запись для проверки лимита.",
      kind: "build",
      visibility: "private",
    });
    assert.equal(p.statusCode, 201);
    const id = p.json().id;
    const jpeg = await sharp(png).jpeg().toBuffer();
    await db.query(
      "INSERT INTO photos(id,owner_id,post_id,image,width,height) SELECT gen_random_uuid(),$1,$2,$3,20,10 FROM generate_series(1,5)",
      [owner.user.id, id, jpeg],
    );
    const result = await Promise.all([
      upload("posts", id),
      upload("posts", id),
    ]);
    assert.deepEqual(result.map((r) => r.statusCode).sort(), [201, 409]);
    assert.equal(
      (await req("GET", `/api/posts/${id}/photos`, owner)).json().items.length,
      6,
    );
    await db.query("DELETE FROM posts WHERE id=$1", [id]);
  });
  it("exports only owned photo bytes and removes files with photos, posts and bikes", async () => {
    const exported = await req("POST", "/api/me/export", owner, { password });
    assert.equal(exported.statusCode, 200, exported.body);
    assert.ok(
      exported
        .json()
        .photos.some((p: any) => p.id === attached.id && p.jpeg_base64),
    );
    const otherExport = await req("POST", "/api/me/export", stranger, {
      password,
    });
    assert.equal(otherExport.statusCode, 200);
    assert.deepEqual(otherExport.json().photos, []);
    assert.equal(
      (await req("DELETE", `/api/photos/${attached.id}`, owner)).statusCode,
      204,
    );
    assert.equal((await req("GET", attached.url, owner)).statusCode, 404);
    await db.query("DELETE FROM posts WHERE id=$1", [post.id]);
    assert.deepEqual(
      await db.query("SELECT id FROM photos WHERE post_id=$1", [post.id]),
      [],
    );
    await db.query("DELETE FROM bikes WHERE id=$1", [bike.id]);
    assert.equal((await req("GET", cover.url, owner)).statusCode, 404);
  });
});
