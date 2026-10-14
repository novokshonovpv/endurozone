import type { FastifyInstance, FastifyRequest } from "fastify";
import { randomUUID } from "node:crypto";
import {
  announcementResponses,
  announcementSchemas,
  responses,
  schemas,
  type Announcement,
  type AnnouncementInput,
} from "@enduro/contracts";
import type { Database, Row } from "./database.ts";
// Race and event announcements: everyone reads upcoming ones, moderators publish, edit and hide.
const day = (v: Date | string | null) =>
  v === null
    ? null
    : typeof v === "string"
      ? v.slice(0, 10)
      : // DATE columns come back as local-midnight Dates; keep the calendar day.
        `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, "0")}-${String(v.getDate()).padStart(2, "0")}`;
export const announcementOf = (r: Row): Announcement => ({
  id: r.id,
  title: r.title,
  startsOn: day(r.starts_on)!,
  endsOn: day(r.ends_on),
  region: r.region,
  place: r.place,
  discipline: r.discipline,
  classes: r.classes,
  sourceUrl: r.source_url,
  status: r.status,
  note: r.note,
});
export function announcementRoutes(
  app: FastifyInstance,
  db: Database,
  guards: {
    requireWrite: (req: FastifyRequest) => { user: Row };
    notFound: () => Error;
    HttpError: new (status: number, code: string, message: string) => Error;
  },
) {
  const { requireWrite, notFound, HttpError } = guards;
  const tags = ["Announcements"],
    security = [{ cookieSession: [] }];
  const errors = {
    400: responses.error,
    401: responses.error,
    403: responses.error,
    404: responses.error,
  };
  const moderator = (req: FastifyRequest) => {
    const auth = requireWrite(req);
    if (auth.user.role !== "moderator")
      throw new HttpError(
        403,
        "MODERATOR_REQUIRED",
        "Анонсы публикуют модераторы.",
      );
    return auth;
  };
  const values = (b: AnnouncementInput) => {
    if (b.endsOn && b.endsOn < b.startsOn)
      throw new HttpError(
        400,
        "VALIDATION_ERROR",
        "Дата окончания раньше даты начала.",
      );
    if (b.title.trim().length < 3 || b.region.trim().length < 2)
      throw new HttpError(
        400,
        "VALIDATION_ERROR",
        "Укажите название и регион.",
      );
    return [
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
    ];
  };
  app.get<{ Querystring: { limit?: number; offset?: number } }>(
    "/api/announcements",
    {
      schema: {
        tags,
        querystring: announcementSchemas.page,
        response: { 200: announcementResponses.page, ...errors },
      },
    },
    async (req) => {
      const { limit = 30, offset = 0 } = req.query;
      // Upcoming and still running: a two-day race stays listed on its second day.
      const rows = await db.query(
        "SELECT * FROM event_announcements WHERE NOT hidden AND coalesce(ends_on,starts_on)>=current_date ORDER BY starts_on,title,id LIMIT $1 OFFSET $2",
        [limit + 1, offset],
      );
      return {
        items: rows.slice(0, limit).map(announcementOf),
        nextOffset: rows.length > limit ? offset + limit : null,
      };
    },
  );
  app.post<{ Body: AnnouncementInput }>(
    "/api/announcements",
    {
      schema: {
        tags,
        security,
        body: announcementSchemas.input,
        response: { 201: announcementResponses.one, ...errors },
      },
    },
    async (req, reply) => {
      const auth = moderator(req);
      const [r] = await db.query(
        "INSERT INTO event_announcements(id,title,starts_on,ends_on,region,place,discipline,classes,source_url,status,note,author_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *",
        [randomUUID(), ...values(req.body), auth.user.id],
      );
      reply.code(201);
      return announcementOf(r);
    },
  );
  app.patch<{ Params: { id: string }; Body: AnnouncementInput }>(
    "/api/announcements/:id",
    {
      schema: {
        tags,
        security,
        params: schemas.id,
        body: announcementSchemas.input,
        response: { 200: announcementResponses.one, ...errors },
      },
    },
    async (req) => {
      moderator(req);
      const [r] = await db.query(
        "UPDATE event_announcements SET title=$2,starts_on=$3,ends_on=$4,region=$5,place=$6,discipline=$7,classes=$8,source_url=$9,status=$10,note=$11,updated_at=now() WHERE id=$1 AND NOT hidden RETURNING *",
        [req.params.id, ...values(req.body)],
      );
      if (!r) throw notFound();
      return announcementOf(r);
    },
  );
  // Hidden, not deleted: the starter seed never brings a removed announcement back.
  app.delete<{ Params: { id: string } }>(
    "/api/announcements/:id",
    {
      schema: {
        tags,
        security,
        params: schemas.id,
        response: { 204: { type: "null" }, ...errors },
      },
    },
    async (req, reply) => {
      moderator(req);
      const [r] = await db.query(
        "UPDATE event_announcements SET hidden=true,updated_at=now() WHERE id=$1 AND NOT hidden RETURNING id",
        [req.params.id],
      );
      if (!r) throw notFound();
      reply.code(204);
    },
  );
}
