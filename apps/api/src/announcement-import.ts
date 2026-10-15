import type { FastifyInstance, FastifyRequest } from "fastify";
import { randomUUID } from "node:crypto";
import {
  announcementDraftResponses,
  announcementResponses,
  announcementSchemas,
  responses,
  schemas,
  type AnnouncementDraft,
  type AnnouncementInput,
} from "@enduro/contracts";
import type { Database, Row } from "./database.ts";
import { announcementOf } from "./announcements.ts";
// Race announcements from public Telegram channels (web preview t.me/s/<channel>) become
// drafts for moderators. Organisers' posts follow a steady pattern:
//   «17 октября 2026 – Название» / «Регион, место» / «Классы» …
// The parser fills what it recognises; the moderator checks and completes the rest.
const months: Record<string, number> = {
  января: 1,
  февраля: 2,
  марта: 3,
  апреля: 4,
  мая: 5,
  июня: 6,
  июля: 7,
  августа: 8,
  сентября: 9,
  октября: 10,
  ноября: 11,
  декабря: 12,
};
const monthNames = Object.keys(months).join("|");
const dash = "[-–—]";
const headline = new RegExp(
  `(\\d{1,2})(?:\\s+(${monthNames}))?(?:\\s*${dash}\\s*(\\d{1,2}))?\\s+(${monthNames})\\s+(\\d{4})\\s*${dash}\\s*(.+)`,
  "i",
);
const pad = (n: number) => String(n).padStart(2, "0");
const entities: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};
export const textOfHtml = (html: string) =>
  html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, e: string) =>
      e[0] === "#"
        ? String.fromCodePoint(
            e[1] === "x" || e[1] === "X"
              ? parseInt(e.slice(2), 16)
              : Number(e.slice(1)),
          )
        : (entities[e.toLowerCase()] ?? m),
    )
    .replace(/[ \t]+/g, " ")
    .split("\n")
    .map((l) => l.trim())
    .join("\n")
    .trim();
const discipline = (text: string) =>
  /хард[- ]?эндуро/i.test(text)
    ? "Хард-эндуро"
    : /экстрим[- ]?эндуро/i.test(text)
      ? "Экстрим-эндуро"
      : /кантри/i.test(text) && /эндуро/i.test(text)
        ? "Кантри-кросс, эндуро"
        : /суперкросс/i.test(text)
          ? "Суперкросс"
          : /мотокросс/i.test(text)
            ? "Мотокросс"
            : /эндуро/i.test(text)
              ? "Эндуро"
              : "";
const regionOf = (line: string) => {
  const [region, ...rest] = line.split(/,\s*/);
  return {
    region: region
      .replace(/(^|\s)обл\.?$/i, "$1область")
      .replace(/^Респ\.?\s/i, "Республика ")
      .slice(0, 120),
    place: rest.join(", ").slice(0, 160),
  };
};
/** The parser's guess for one post, or null when the post is not a dated announcement. */
export function parsePost(
  text: string,
  sourceUrl: string,
): Partial<AnnouncementInput> | null {
  const lines = text.split("\n");
  const at = lines.findIndex((l) => headline.test(l));
  if (at < 0) return null;
  const [, d1, m1, d2, m2, y, rest] = headline.exec(lines[at])!;
  const year = Number(y),
    endMonth = months[m2.toLowerCase()],
    startMonth = m1 ? months[m1.toLowerCase()] : endMonth;
  const startYear = startMonth > endMonth ? year - 1 : year;
  const startsOn = `${startYear}-${pad(startMonth)}-${pad(Number(d1))}`;
  const endsOn = d2 ? `${year}-${pad(endMonth)}-${pad(Number(d2))}` : null;
  // A title may run into the region when the post has no line breaks (cancellation notices).
  const title = rest
    .split(
      /\s(?=Республика\s|[А-ЯЁ][а-яё-]+(?:ская|ский)\s(?:обл|край|район))/,
    )[0]
    .replace(/[.!]+$/, "")
    .trim()
    .slice(0, 140);
  const next = lines.slice(at + 1).find((l) => l.length > 0) ?? "";
  const looksLikePlace =
    next && !/^(Классы|Расписание|Взнос|Требования)/i.test(next);
  const classesAt = lines.findIndex((l) => /^Классы/i.test(l));
  const classes: string[] = [];
  if (classesAt >= 0) {
    const inline = lines[classesAt].replace(/^Классы\s*[:–-]?\s*/i, "");
    if (inline) classes.push(inline);
    for (const l of lines.slice(classesAt + 1)) {
      if (!l || /^(Расписание|Взнос|Требования)/i.test(l)) break;
      classes.push(l);
    }
  }
  return {
    title,
    startsOn,
    endsOn: endsOn && endsOn >= startsOn ? endsOn : null,
    ...(looksLikePlace ? regionOf(next) : { region: "", place: "" }),
    discipline: discipline(text),
    classes: classes.join(", ").slice(0, 200),
    sourceUrl,
    status: /ОТМЕНА/.test(text)
      ? "cancelled"
      : /ПЕРЕНОС/.test(text)
        ? "postponed"
        : "scheduled",
    note: "",
  };
}
/** Posts of a t.me/s/<channel> page: link, plain text and the parser's guess. */
export function parseChannelPage(html: string) {
  return html
    .split('class="tgme_widget_message_wrap')
    .slice(1)
    .map((block) => {
      const post = /data-post="([\w]+\/\d+)"/.exec(block)?.[1];
      const body =
        /<div class="tgme_widget_message_text[^>]*>([\s\S]*?)<\/div>/.exec(
          block,
        )?.[1];
      if (!post || !body) return null;
      const sourceUrl = `https://t.me/${post}`;
      const text = textOfHtml(body);
      return { sourceUrl, text, guess: parsePost(text, sourceUrl) };
    })
    .filter((p) => p !== null);
}
export type FetchPage = (channel: string) => Promise<string>;
export const fetchChannelPage: FetchPage = async (channel) => {
  const r = await fetch(`https://t.me/s/${encodeURIComponent(channel)}`, {
    headers: { "user-agent": "EnduroZone/1.0 (+race announcements digest)" },
    signal: AbortSignal.timeout(15000),
  });
  if (!r.ok) throw new Error(`t.me answered ${r.status}`);
  return r.text();
};
const localDay = (d = new Date()) =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
/** Adds new upcoming announcements as drafts; known posts and past races are skipped. */
export async function importAnnouncementDrafts(
  db: Database,
  channels: string[],
  fetchPage: FetchPage = fetchChannelPage,
  today = localDay(),
) {
  let checked = 0,
    added = 0;
  for (const channel of channels) {
    for (const post of parseChannelPage(await fetchPage(channel))) {
      checked++;
      const g = post.guess;
      if (!g?.startsOn || (g.endsOn ?? g.startsOn) < today) continue;
      const [known] = await db.query(
        "SELECT 1 FROM event_announcements WHERE source_url=$1 OR (lower(title)=lower($2) AND starts_on=$3) UNION ALL SELECT 1 FROM announcement_drafts WHERE source_url=$1 LIMIT 1",
        [post.sourceUrl, g.title, g.startsOn],
      );
      if (known) continue;
      const r = await db.query(
        "INSERT INTO announcement_drafts(id,source_url,post_text,guess) VALUES ($1,$2,$3,$4) ON CONFLICT (source_url) DO NOTHING RETURNING id",
        [
          randomUUID(),
          post.sourceUrl,
          post.text.slice(0, 1500),
          JSON.stringify(g),
        ],
      );
      added += r.length;
    }
  }
  return { checked, added };
}
const draftOf = (r: Row): AnnouncementDraft => ({
  id: r.id,
  sourceUrl: r.source_url,
  postText: r.post_text,
  guess: typeof r.guess === "string" ? JSON.parse(r.guess) : r.guess,
  createdAt: new Date(r.created_at).toISOString(),
});
export function announcementDraftRoutes(
  app: FastifyInstance,
  db: Database,
  channels: string[],
  guards: {
    requireAuth: (req: FastifyRequest) => { user: Row };
    requireWrite: (req: FastifyRequest) => { user: Row };
    notFound: () => Error;
    HttpError: new (status: number, code: string, message: string) => Error;
  },
  fetchPage: FetchPage = fetchChannelPage,
) {
  const { requireAuth, requireWrite, notFound, HttpError } = guards;
  const tags = ["Announcements"],
    security = [{ cookieSession: [] }];
  const errors = {
    400: responses.error,
    401: responses.error,
    403: responses.error,
    404: responses.error,
    502: responses.error,
  };
  const moderator = (req: FastifyRequest, write: boolean) => {
    const auth = write ? requireWrite(req) : requireAuth(req);
    if (auth.user.role !== "moderator")
      throw new HttpError(
        403,
        "MODERATOR_REQUIRED",
        "Черновики анонсов видят модераторы.",
      );
    return auth;
  };
  app.get(
    "/api/moderation/announcement-drafts",
    {
      schema: {
        tags,
        security,
        response: { 200: announcementDraftResponses.page, ...errors },
      },
    },
    async (req) => {
      moderator(req, false);
      // Races that already took place leave the queue on their own.
      const rows = await db.query(
        "SELECT * FROM announcement_drafts WHERE status='pending' AND coalesce(guess->>'endsOn',guess->>'startsOn')>=$1 ORDER BY guess->>'startsOn',created_at LIMIT 50",
        [localDay()],
      );
      return { items: rows.map(draftOf) };
    },
  );
  app.post(
    "/api/moderation/announcement-drafts/refresh",
    {
      config: { rateLimit: { max: 6, timeWindow: "1 minute" } },
      schema: {
        tags,
        security,
        response: { 200: announcementDraftResponses.refresh, ...errors },
      },
    },
    async (req) => {
      moderator(req, true);
      try {
        return await importAnnouncementDrafts(db, channels, fetchPage);
      } catch {
        throw new HttpError(
          502,
          "SOURCE_UNAVAILABLE",
          "Канал сейчас не отвечает. Попробуйте позже.",
        );
      }
    },
  );
  app.post<{ Params: { id: string }; Body: AnnouncementInput }>(
    "/api/moderation/announcement-drafts/:id/publish",
    {
      schema: {
        tags,
        security,
        params: schemas.id,
        body: announcementSchemas.input,
        response: { 201: announcementResponses.one, ...errors },
      },
    },
    async (req, reply) => {
      const auth = moderator(req, true),
        b = req.body;
      if (b.endsOn && b.endsOn < b.startsOn)
        throw new HttpError(
          400,
          "VALIDATION_ERROR",
          "Дата окончания раньше даты начала.",
        );
      const created = await db.transaction(async (tx) => {
        const [d] = await tx.query(
          "SELECT id FROM announcement_drafts WHERE id=$1 AND status='pending' FOR UPDATE",
          [req.params.id],
        );
        if (!d) throw notFound();
        const [a] = await tx.query(
          "INSERT INTO event_announcements(id,title,starts_on,ends_on,region,place,discipline,classes,source_url,status,note,author_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *",
          [
            randomUUID(),
            b.title.trim(),
            b.startsOn,
            b.endsOn ?? null,
            b.region.trim(),
            (b.place ?? "").trim(),
            (b.discipline ?? "").trim(),
            (b.classes ?? "").trim(),
            b.sourceUrl.trim(),
            b.status ?? "scheduled",
            (b.note ?? "").trim(),
            auth.user.id,
          ],
        );
        await tx.query(
          "UPDATE announcement_drafts SET status='published',announcement_id=$2,decided_by=$3,decided_at=now() WHERE id=$1",
          [d.id, a.id, auth.user.id],
        );
        return a;
      });
      reply.code(201);
      return announcementOf(created);
    },
  );
  app.post<{ Params: { id: string } }>(
    "/api/moderation/announcement-drafts/:id/dismiss",
    {
      schema: {
        tags,
        security,
        params: schemas.id,
        response: { 204: { type: "null" }, ...errors },
      },
    },
    async (req, reply) => {
      const auth = moderator(req, true);
      const [r] = await db.query(
        "UPDATE announcement_drafts SET status='dismissed',decided_by=$2,decided_at=now() WHERE id=$1 AND status='pending' RETURNING id",
        [req.params.id, auth.user.id],
      );
      if (!r) throw notFound();
      reply.code(204);
    },
  );
}
