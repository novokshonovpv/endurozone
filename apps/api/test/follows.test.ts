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
  FollowSummary,
  FollowedRider,
} from "@enduro/contracts";
type Client = Session & { cookie: string };
let app: FastifyInstance,
  db: Database,
  dir: string,
  reader: Client,
  author: Client,
  quiet: Client,
  stranger: Client;
const password = "follows-only-password-2026",
  origin = "http://localhost:5173";
function request(
  method: "GET" | "POST" | "PUT" | "DELETE",
  url: string,
  c?: Client,
  payload?: object,
  csrf = true,
) {
  return app.inject({
    method,
    url,
    payload,
    headers: {
      origin,
      "x-enduro-client": "web",
      ...(c
        ? { cookie: c.cookie, ...(csrf ? { "x-csrf-token": c.csrfToken } : {}) }
        : {}),
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
async function bikeOf(c: Client) {
  const r = await request("POST", "/api/me/bikes", c, {
    make: "Demo",
    model: "Follow 250",
    year: 2024,
    modification: "",
    engine: "",
    hours: 0,
    notes: "",
  });
  assert.equal(r.statusCode, 201, r.body);
  return r.json<Bike>();
}
async function post(
  c: Client,
  bike: Bike,
  title: string,
  visibility = "public",
  kind = "ride",
) {
  const r = await request("POST", "/api/posts", c, {
    bikeId: bike.id,
    title,
    body: "Synthetic story for follow and favorite tests.",
    kind,
    visibility,
  });
  assert.equal(r.statusCode, 201, r.body);
  return r.json<Post>();
}
const summaryOf = async (handle: string, c?: Client) =>
  (
    await request("GET", `/api/profiles/${handle}/follow-summary`, c)
  ).json<FollowSummary>();
const unreadFollowNotices = async (c: Client) =>
  (
    await db.query(
      "SELECT message FROM notifications WHERE user_id=$1 AND path='following' AND read_at IS NULL",
      [c.user.id],
    )
  ).length;
describe("Follows, following feed and private favorites", () => {
  before(async () => {
    dir = await mkdtemp(join(tmpdir(), "enduro-follows-"));
    db = await openDatabase({
      url: process.env.TEST_DATABASE_URL,
      dataDir: dir,
    });
    app = await buildApp({ db, rateMax: 1000 });
    reader = await client("follows_reader", "Читатель подписок", "Смоленск");
    author = await client("follows_author", "Автор подписок", "Сочи");
    quiet = await client("follows_quiet", "Тихий райдер", "Смоленск");
    stranger = await client("follows_stranger", "Незнакомец", "Сочи");
  });
  after(async () => {
    await app.close();
    const ids = [reader, author, quiet, stranger].map((c) => c.user.id);
    await db.query("DELETE FROM posts WHERE author_id=ANY($1::uuid[])", [ids]);
    await db.query("DELETE FROM users WHERE id=ANY($1::uuid[])", [ids]);
    await db.close();
    assert.ok(dir.startsWith(join(tmpdir(), "enduro-follows-")));
    await rm(dir, { recursive: true, force: true });
  });
  it("follows idempotently, refuses self/unknown/guest/missing CSRF and shows only public counts", async () => {
    const url = `/api/me/following/${author.user.handle}`;
    assert.equal((await request("PUT", url)).statusCode, 401);
    assert.equal(
      (await request("PUT", url, reader, undefined, false)).statusCode,
      403,
    );
    const self = await request(
      "PUT",
      `/api/me/following/${reader.user.handle}`,
      reader,
    );
    assert.equal(self.statusCode, 400);
    assert.equal(self.json().error.code, "FOLLOW_SELF");
    assert.equal(
      (await request("PUT", "/api/me/following/not_registered", reader))
        .statusCode,
      404,
    );
    const first = await request("PUT", url, reader);
    assert.equal(first.statusCode, 200, first.body);
    assert.deepEqual(first.json(), {
      followerCount: 1,
      followingCount: 0,
      viewerFollows: true,
    });
    const again = await Promise.all([
      request("PUT", url, reader),
      request("PUT", url, reader),
    ]);
    for (const r of again) assert.equal(r.statusCode, 200, r.body);
    const [rows] = await db.query(
      "SELECT count(*) n FROM follows WHERE follower_id=$1",
      [reader.user.id],
    );
    assert.equal(Number(rows.n), 1);
    assert.deepEqual(await summaryOf(author.user.handle), {
      followerCount: 1,
      followingCount: 0,
      viewerFollows: false,
    });
    assert.equal(
      (await summaryOf(author.user.handle, stranger)).viewerFollows,
      false,
    );
    assert.deepEqual(await summaryOf(reader.user.handle, reader), {
      followerCount: 0,
      followingCount: 1,
      viewerFollows: false,
    });
    const guest = await request(
      "GET",
      `/api/profiles/${author.user.handle}/follow-summary`,
    );
    assert.ok(!guest.body.includes(reader.user.handle));
    assert.equal(
      (await request("GET", "/api/profiles/not_registered/follow-summary"))
        .statusCode,
      404,
    );
  });
  it("keeps follower and following lists private to their owner", async () => {
    for (const path of ["following", "followers"])
      assert.equal((await request("GET", `/api/me/${path}`)).statusCode, 401);
    const mine = await request("GET", "/api/me/following", reader);
    assert.equal(mine.statusCode, 200, mine.body);
    const page = mine.json<Page<FollowedRider>>();
    assert.deepEqual(
      page.items.map((x) => x.handle),
      [author.user.handle],
    );
    assert.ok(page.items[0].followedAt);
    assert.ok(!mine.body.includes("@example.test"));
    const theirs = await request("GET", "/api/me/followers", author);
    assert.deepEqual(
      theirs.json<Page<FollowedRider>>().items.map((x) => x.handle),
      [reader.user.handle],
    );
    assert.deepEqual((await request("GET", "/api/me/followers", stranger)).json(), {
      items: [],
      nextOffset: null,
    });
    assert.equal(
      (await request("GET", "/api/me/following?limit=31", reader)).statusCode,
      400,
    );
  });
  it("notifies the followed rider once per unread notice, without naming the follower", async () => {
    assert.equal(await unreadFollowNotices(author), 1);
    const url = `/api/me/following/${author.user.handle}`;
    for (let i = 0; i < 3; i++) {
      assert.equal((await request("DELETE", url, reader)).statusCode, 200);
      assert.equal((await request("PUT", url, reader)).statusCode, 200);
    }
    assert.equal(
      (await request("PUT", url, stranger)).json().followerCount,
      2,
    );
    assert.equal(await unreadFollowNotices(author), 1);
    const list = await request("GET", "/api/me/notifications", author);
    assert.ok(list.body.includes("У вас новый подписчик"));
    for (const c of [reader, stranger]) {
      assert.ok(!list.body.includes(c.user.handle));
      assert.ok(!list.body.includes(c.user.displayName));
    }
    await db.query(
      "UPDATE notifications SET read_at=now() WHERE user_id=$1 AND path='following'",
      [author.user.id],
    );
    assert.equal(
      (await request("DELETE", url, stranger)).json().viewerFollows,
      false,
    );
    assert.equal(
      (await request("DELETE", url, stranger)).statusCode,
      200,
      "unfollow is idempotent",
    );
    await request("PUT", url, stranger);
    assert.equal(await unreadFollowNotices(author), 1);
    await request("DELETE", url, stranger);
  });
  it("builds a following feed from visible public posts only, with filters and pagination", async () => {
    const authorBike = await bikeOf(author),
      quietBike = await bikeOf(quiet),
      readerBike = await bikeOf(reader);
    assert.equal((await request("GET", "/api/me/feed")).statusCode, 401);
    assert.deepEqual((await request("GET", "/api/me/feed", stranger)).json(), {
      items: [],
      nextOffset: null,
    });
    const open = await post(author, authorBike, "Followed open ride");
    await post(author, authorBike, "FOLLOWED PRIVATE", "private");
    const hidden = await post(author, authorBike, "FOLLOWED HIDDEN");
    await db.query("UPDATE posts SET hidden=true WHERE id=$1", [hidden.id]);
    const service = await post(
      author,
      authorBike,
      "Followed service",
      "public",
      "maintenance",
    );
    await post(quiet, quietBike, "UNFOLLOWED STORY");
    await post(reader, readerBike, "OWN STORY");
    const r = await request("GET", "/api/me/feed", reader);
    assert.equal(r.statusCode, 200, r.body);
    assert.deepEqual(
      r.json<Page<Post>>().items.map((p) => p.id),
      [service.id, open.id],
    );
    for (const secret of [
      "FOLLOWED PRIVATE",
      "FOLLOWED HIDDEN",
      "UNFOLLOWED STORY",
      "OWN STORY",
    ])
      assert.ok(!r.body.includes(secret), secret);
    const filtered = await request(
      "GET",
      `/api/me/feed?kind=maintenance&city=${encodeURIComponent("Сочи")}`,
      reader,
    );
    assert.deepEqual(
      filtered.json<Page<Post>>().items.map((p) => p.id),
      [service.id],
    );
    const first = (await request("GET", "/api/me/feed?limit=1", reader)).json();
    assert.equal(first.nextOffset, 1);
    const last = (
      await request("GET", "/api/me/feed?limit=1&offset=1", reader)
    ).json();
    assert.equal(last.nextOffset, null);
    assert.equal(last.items[0].id, open.id);
    await request("DELETE", `/api/me/following/${author.user.handle}`, reader);
    assert.equal(
      (await request("GET", "/api/me/feed", reader)).json().items.length,
      0,
    );
    await request("PUT", `/api/me/following/${author.user.handle}`, reader);
  });
  it("saves favorites privately and never reveals a saved post after it becomes private or hidden", async () => {
    const bike = await bikeOf(stranger);
    const a = await post(author, (await bikeOf(author)), "Favorite A");
    const b = await post(stranger, bike, "Favorite B");
    const closed = await post(stranger, bike, "CLOSED FROM START", "private");
    const own = await post(reader, await bikeOf(reader), "Own private", "private");
    const fav = (id: string) => `/api/me/favorites/${id}`;
    assert.equal((await request("PUT", fav(a.id))).statusCode, 401);
    assert.equal((await request("GET", "/api/me/favorites")).statusCode, 401);
    assert.equal(
      (await request("PUT", fav(a.id), reader, undefined, false)).statusCode,
      403,
    );
    for (const id of [closed.id, randomUUID()])
      assert.equal((await request("PUT", fav(id), reader)).statusCode, 404);
    for (const id of [a.id, b.id, a.id, own.id])
      assert.equal((await request("PUT", fav(id), reader)).statusCode, 204);
    const list = await request("GET", "/api/me/favorites", reader);
    assert.equal(list.statusCode, 200, list.body);
    assert.deepEqual(
      list.json<Page<Post>>().items.map((p) => p.id),
      [own.id, b.id, a.id],
    );
    assert.deepEqual(
      (await request("GET", "/api/me/favorites", author)).json().items,
      [],
    );
    assert.deepEqual((await request("GET", fav(a.id), reader)).json(), {
      favorited: true,
    });
    assert.deepEqual((await request("GET", fav(a.id), author)).json(), {
      favorited: false,
    });
    await db.query("UPDATE posts SET visibility='private' WHERE id=$1", [
      b.id,
    ]);
    await db.query("UPDATE posts SET hidden=true WHERE id=$1", [a.id]);
    const after = await request("GET", "/api/me/favorites", reader);
    assert.deepEqual(
      after.json<Page<Post>>().items.map((p) => p.id),
      [own.id],
    );
    assert.ok(!after.body.includes("Favorite A"));
    assert.ok(!after.body.includes("Favorite B"));
    for (const id of [a.id, b.id]) {
      assert.deepEqual((await request("GET", fav(id), reader)).json(), {
        favorited: false,
      });
      assert.equal((await request("PUT", fav(id), reader)).statusCode, 404);
    }
    await db.query("UPDATE posts SET visibility='public' WHERE id=$1", [
      b.id,
    ]);
    assert.deepEqual(
      (await request("GET", "/api/me/favorites", reader))
        .json<Page<Post>>()
        .items.map((p) => p.id),
      [own.id, b.id],
    );
    assert.equal((await request("DELETE", fav(a.id), reader)).statusCode, 204);
    assert.equal((await request("DELETE", fav(a.id), reader)).statusCode, 204);
    const [left] = await db.query(
      "SELECT count(*) n FROM favorites WHERE user_id=$1 AND post_id=$2",
      [reader.user.id, a.id],
    );
    assert.equal(Number(left.n), 0);
    await db.query("UPDATE posts SET hidden=false WHERE id=$1", [a.id]);
  });
  it("enforces per-account limits for follows and favorites", async () => {
    const extra = await client("follows_bulk", "Массовый райдер", "Сочи");
    const bike = await bikeOf(extra);
    await db.query(
      "INSERT INTO users(id,email,password_hash,handle,display_name,city,level) SELECT gen_random_uuid(),'bulk'||i||'@example.test','x','follows_bulk_'||i,'Bulk','Сочи','amateur' FROM generate_series(1,1000) i",
    );
    await db.query(
      "INSERT INTO follows(follower_id,followee_id) SELECT $1,id FROM users WHERE handle LIKE 'follows!_bulk!_%' ESCAPE '!'",
      [extra.user.id],
    );
    const over = await request(
      "PUT",
      `/api/me/following/${author.user.handle}`,
      extra,
    );
    assert.equal(over.statusCode, 409, over.body);
    assert.equal(over.json().error.code, "FOLLOW_LIMIT");
    assert.equal((await summaryOf(author.user.handle, extra)).viewerFollows, false);
    await db.query(
      "INSERT INTO posts(id,author_id,bike_id,title,body,kind,visibility) SELECT gen_random_uuid(),$1,$2,'Bulk '||i,'Synthetic bulk body','ride','public' FROM generate_series(1,1000) i",
      [extra.user.id, bike.id],
    );
    await db.query(
      "INSERT INTO favorites(user_id,post_id) SELECT $1,id FROM posts WHERE author_id=$1",
      [extra.user.id],
    );
    const a = (await request("GET", "/api/me/feed", reader)).json<Page<Post>>()
      .items[0];
    const full = await request("PUT", `/api/me/favorites/${a.id}`, extra);
    assert.equal(full.statusCode, 409, full.body);
    assert.equal(full.json().error.code, "FAVORITE_LIMIT");
    await db.query("DELETE FROM posts WHERE author_id=$1", [extra.user.id]);
    await db.query(
      "DELETE FROM users WHERE handle LIKE 'follows!_bulk%' ESCAPE '!'",
    );
  });
  it("exports own relations and removes them with either account", async () => {
    const exported = await request("POST", "/api/me/export", reader, {
      password,
    });
    assert.equal(exported.statusCode, 200, exported.body);
    const data = exported.json();
    assert.deepEqual(
      data.following.map((x: { handle: string }) => x.handle),
      [author.user.handle],
    );
    assert.ok(data.favorites.length >= 2);
    assert.deepEqual(data.followers, []);
    assert.ok(!exported.body.includes(author.user.email));
    const authorExport = (
      await request("POST", "/api/me/export", author, { password })
    ).json();
    assert.deepEqual(
      authorExport.followers.map((x: { handle: string }) => x.handle),
      [reader.user.handle],
    );
    const removed = await request("POST", "/api/me/delete", author, {
      password,
      confirmation: "УДАЛИТЬ АККАУНТ",
    });
    assert.equal(removed.statusCode, 204, removed.body);
    assert.deepEqual(await summaryOf(reader.user.handle, reader), {
      followerCount: 0,
      followingCount: 0,
      viewerFollows: false,
    });
    const favorites = (
      await request("GET", "/api/me/favorites", reader)
    ).json<Page<Post>>();
    assert.ok(favorites.items.every((p) => p.author.id !== author.user.id));
    const [orphans] = await db.query(
      "SELECT (SELECT count(*) FROM follows WHERE follower_id=$1 OR followee_id=$1)+(SELECT count(*) FROM favorites f JOIN posts p ON p.id=f.post_id WHERE p.author_id=$1) n",
      [author.user.id],
    );
    assert.equal(Number(orphans.n), 0);
  });
  it("requires a verified email for follow and favorite changes in pilot mode", async () => {
    const pilot = await buildApp({ db, requireVerifiedEmail: true });
    try {
      for (const url of [
        `/api/me/following/${quiet.user.handle}`,
        `/api/me/favorites/${randomUUID()}`,
      ]) {
        const r = await pilot.inject({
          method: "PUT",
          url,
          headers: {
            origin,
            "x-enduro-client": "web",
            cookie: stranger.cookie,
            "x-csrf-token": stranger.csrfToken,
          },
        });
        assert.equal(r.statusCode, 403, r.body);
        assert.equal(r.json().error.code, "EMAIL_UNVERIFIED");
      }
    } finally {
      await pilot.close();
    }
  });
});
