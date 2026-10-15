import { before, after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FastifyInstance, InjectOptions } from "fastify";
import { buildApp } from "../src/app.ts";
import { openDatabase, type Database } from "../src/database.ts";
import {
  importAnnouncementDrafts,
  parseChannelPage,
} from "../src/announcement-import.ts";
import type {
  Announcement,
  AnnouncementDraft,
  Session,
} from "@enduro/contracts";
type Client = Session & { cookie: string };
let app: FastifyInstance, db: Database, dir: string, rider: Client, mod: Client;
const origin = "http://localhost:5173";
const year = new Date().getFullYear() + 1;
// Synthetic page in the shape of t.me/s/<channel>; no real channel content.
const post = (n: number, html: string) =>
  `<div class="tgme_widget_message_wrap js-widget_message_wrap"><div class="tgme_widget_message" data-post="testchannel/${n}"><div class="tgme_widget_message_text js-message_text" dir="auto">${html}</div></div></div>`;
const page = [
  post(
    1,
    `<b>17 октября ${year} – Синтетическая гонка<br/></b>Тестовая обл., д. Пример<br/><br/><b>Классы</b><br/>Золото<br/>Серебро<br/><br/><b>Взнос</b> – 1 р.`,
  ),
  post(
    2,
    `<b>31 октября-01 ноября ${year} – Двухдневная хард-эндуро гонка<br/></b>Республика Тест, п. Пример`,
  ),
  post(3, `Обсуждаем мотоциклы&#33; Никаких дат.`),
  post(
    4,
    `❗️ОТМЕНА❗️ 05 ноября ${year} – Отменённая гонка Республика Тест, район Пример`,
  ),
  post(
    5,
    `<b>10 октября 2020 – Прошедшая гонка<br/></b>Тестовая обл., г. Пример`,
  ),
].join("");
const fetchPage = async () => page;
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
    password: "drafts-test-password-2026",
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
describe("Race announcement drafts from public channels", () => {
  before(async () => {
    dir = await mkdtemp(join(tmpdir(), "enduro-drafts-"));
    db = await openDatabase({
      url: process.env.TEST_DATABASE_URL,
      dataDir: dir,
    });
    app = await buildApp({
      db,
      rateMax: 1000,
      announcementChannels: ["testchannel"],
      fetchChannelPage: fetchPage,
    });
    rider = await client("drafts_rider");
    mod = await client("drafts_mod");
    await db.query("UPDATE users SET role='moderator' WHERE id=$1", [
      mod.user.id,
    ]);
  });
  after(async () => {
    await app.close();
    await db.close();
    await rm(dir, { recursive: true, force: true });
  });
  it("recognises dated announcements, multi-day dates, classes and cancellations", () => {
    const posts = parseChannelPage(page);
    assert.equal(posts.length, 5);
    const [one, two, chat, cancelled] = posts;
    assert.deepEqual(
      {
        title: one.guess?.title,
        startsOn: one.guess?.startsOn,
        region: one.guess?.region,
        place: one.guess?.place,
        classes: one.guess?.classes,
        sourceUrl: one.sourceUrl,
      },
      {
        title: "Синтетическая гонка",
        startsOn: `${year}-10-17`,
        region: "Тестовая область",
        place: "д. Пример",
        classes: "Золото, Серебро",
        sourceUrl: "https://t.me/testchannel/1",
      },
    );
    assert.equal(two.guess?.startsOn, `${year}-10-31`);
    assert.equal(two.guess?.endsOn, `${year}-11-01`);
    assert.equal(two.guess?.discipline, "Хард-эндуро");
    assert.equal(chat.guess, null);
    assert.equal(cancelled.guess?.status, "cancelled");
    assert.equal(cancelled.guess?.title, "Отменённая гонка");
  });
  it("adds upcoming posts once and skips past ones and known announcements", async () => {
    assert.deepEqual(
      await importAnnouncementDrafts(db, ["testchannel"], fetchPage),
      {
        checked: 5,
        added: 3,
      },
    );
    assert.deepEqual(
      await importAnnouncementDrafts(db, ["testchannel"], fetchPage),
      {
        checked: 5,
        added: 0,
      },
    );
  });
  it("shows drafts to moderators only; publishing creates the announcement, dismissing hides the draft", async () => {
    assert.equal(
      (await request("GET", "/api/moderation/announcement-drafts", rider))
        .statusCode,
      403,
    );
    const drafts = (
      await request("GET", "/api/moderation/announcement-drafts", mod)
    ).json<{ items: AnnouncementDraft[] }>().items;
    assert.equal(drafts.length, 3);
    const first = drafts.find((d) => d.guess.title === "Синтетическая гонка")!;
    assert.ok(first.postText.includes("Золото"));
    const published = await request(
      "POST",
      `/api/moderation/announcement-drafts/${first.id}/publish`,
      mod,
      {
        title: "Синтетическая гонка",
        startsOn: first.guess.startsOn,
        region: "Тестовая область",
        place: "д. Пример",
        discipline: "Эндуро",
        classes: "Золото, Серебро",
        sourceUrl: first.sourceUrl,
      },
    );
    assert.equal(published.statusCode, 201, published.body);
    assert.equal(published.json<Announcement>().discipline, "Эндуро");
    assert.equal(
      (
        await request(
          "POST",
          `/api/moderation/announcement-drafts/${first.id}/publish`,
          mod,
          {
            title: "Again",
            startsOn: first.guess.startsOn,
            region: "Тест",
            sourceUrl: first.sourceUrl,
          },
        )
      ).statusCode,
      404,
    );
    const other = drafts.find((d) => d.id !== first.id)!;
    assert.equal(
      (
        await request(
          "POST",
          `/api/moderation/announcement-drafts/${other.id}/dismiss`,
          mod,
        )
      ).statusCode,
      204,
    );
    const left = (
      await request("GET", "/api/moderation/announcement-drafts", mod)
    ).json<{ items: AnnouncementDraft[] }>().items;
    assert.equal(left.length, 1);
    const list = (await request("GET", "/api/announcements")).json<{
      items: Announcement[];
    }>().items;
    assert.deepEqual(
      list.map((a) => a.title),
      ["Синтетическая гонка"],
    );
    // The refresh button reads the channel again; nothing new appears.
    const refresh = await request(
      "POST",
      "/api/moderation/announcement-drafts/refresh",
      mod,
    );
    assert.deepEqual(refresh.json(), { checked: 5, added: 0 });
  });
});
