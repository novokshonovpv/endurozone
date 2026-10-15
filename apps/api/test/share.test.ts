import { before, after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.ts";
import { openDatabase, type Database } from "../src/database.ts";
import { seedContent } from "../src/seed.ts";
let app: FastifyInstance,
  db: Database,
  dir: string,
  place: string,
  hidden: string;
const origin = "https://enduro.example.test";
const meta = (html: string, property: string) =>
  new RegExp(`<meta property="${property}" content="([^"]*)"`).exec(html)?.[1];
describe("Share links with previews for messengers and search", () => {
  before(async () => {
    dir = await mkdtemp(join(tmpdir(), "enduro-share-"));
    db = await openDatabase({
      url: process.env.TEST_DATABASE_URL,
      dataDir: dir,
    });
    const webRoot = join(dir, "web");
    await mkdir(webRoot);
    await writeFile(
      join(webRoot, "index.html"),
      '<!doctype html><meta property="og:image" content="__SITE_ORIGIN__/og.png"><title>Synthetic</title>',
    );
    app = await buildApp({ db, origin, webRoot });
    const base = {
      kind: "spot" as const,
      city: "Смоленск",
      latitude: 54.8,
      longitude: 32.1,
      description: 'Synthetic <b>place</b> & "quotes" for tests.',
      accessNotes: "Synthetic terms for tests only.",
    };
    await seedContent(
      db,
      [
        { ...base, key: "share-1", title: "Synthetic shared place" },
        { ...base, key: "share-2", title: "Synthetic hidden place" },
      ],
      [],
    );
    const rows = await db.query(
      "SELECT id,title FROM locations WHERE seed_key LIKE 'share-%'",
    );
    place = rows.find((r) => r.title === "Synthetic shared place")!.id;
    hidden = rows.find((r) => r.title === "Synthetic hidden place")!.id;
    await db.query("UPDATE locations SET status='hidden' WHERE id=$1", [
      hidden,
    ]);
  });
  after(async () => {
    await app.close();
    await db.close();
    await rm(dir, { recursive: true, force: true });
  });
  it("describes a public place and sends people on to the page itself", async () => {
    const r = await app.inject(`/s/place/${place}`);
    assert.equal(r.statusCode, 200);
    assert.match(r.headers["content-type"] as string, /text\/html/);
    assert.equal(meta(r.body, "og:title"), "Synthetic shared place — Смоленск");
    // Text from riders is escaped, never injected as markup.
    assert.ok(
      meta(r.body, "og:description")!.includes(
        "&lt;b&gt;place&lt;/b&gt; &amp; &quot;quotes&quot;",
      ),
    );
    assert.equal(meta(r.body, "og:image"), `${origin}/og.png`);
    assert.equal(meta(r.body, "og:url"), `${origin}/s/place/${place}`);
    assert.ok(r.body.includes('url=/#map"'));
  });
  it("gives hidden, missing and unknown objects only the generic site card", async () => {
    for (const url of [
      `/s/place/${hidden}`,
      "/s/place/00000000-0000-0000-0000-000000000000",
      "/s/place/not-a-uuid",
      "/s/unknown/1",
      "/s/model/no-such-model",
    ]) {
      const r = await app.inject(url);
      assert.equal(r.statusCode, 404, url);
      assert.equal(
        meta(r.body, "og:title"),
        "Enduro.Zone — твоя территория эндуро",
      );
      assert.ok(!r.body.includes("hidden place"));
    }
  });
  it("lists public pages in the sitemap and points robots to it", async () => {
    const map = await app.inject("/sitemap.xml");
    assert.ok(map.body.includes(`${origin}/s/place/${place}`));
    assert.ok(!map.body.includes(hidden));
    assert.ok(map.body.includes(`${origin}/s/model/`));
    const robots = await app.inject("/robots.txt");
    assert.ok(robots.body.includes(`Sitemap: ${origin}/sitemap.xml`));
  });
  it("serves the site page with this deployment's address in its preview tags", async () => {
    const r = await app.inject("/");
    assert.equal(r.statusCode, 200);
    assert.ok(r.body.includes(`content="${origin}/og.png"`));
    assert.ok(!r.body.includes("__SITE_ORIGIN__"));
  });
});
