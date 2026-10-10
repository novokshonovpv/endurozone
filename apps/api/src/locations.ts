import type { FastifyInstance, FastifyRequest } from "fastify";
import { notify } from "./pilot.ts";
import { randomUUID } from "node:crypto";
import { schemas, responses, type LocationInput } from "@enduro/contracts";
import type { Database, Row } from "./database.ts";
import { profileOf } from "./auth.ts";

export const locationOutputs: Record<string, [number, unknown]> = {
  "GET /api/locations": [200, responses.locations],
  "GET /api/me/locations": [200, responses.locations],
  "GET /api/locations/:id": [200, responses.location],
  "POST /api/locations": [201, responses.location],
  "GET /api/locations/:id/decisions": [200, responses.audit],
  "GET /api/moderation/locations": [200, responses.locations],
  "POST /api/moderation/locations/:id/decision": [200, responses.location],
  "POST /api/reports": [201, responses.report],
  "GET /api/moderation/reports": [200, responses.reports],
  "POST /api/moderation/reports/:id/decision": [200, responses.report],
};
const iso = (v: Date | string) => new Date(v).toISOString();
const locationSelect = `SELECT l.*,u.handle,u.display_name,u.level,u.bio,u.city AS author_city FROM locations l JOIN users u ON u.id=l.author_id`;
const locationOf = (r: Row) => ({
  id: r.id,
  title: r.title,
  description: r.description,
  city: r.city,
  latitude: r.latitude,
  longitude: r.longitude,
  difficulty: r.difficulty,
  accessNotes: r.access_notes,
  status: r.status,
  createdAt: iso(r.created_at),
  updatedAt: iso(r.updated_at),
  author: profileOf({ ...r, id: r.author_id, city: r.author_city }),
});
const reportOf = (r: Row) => ({
  id: r.id,
  targetType: r.target_type,
  targetId: r.target_id,
  reason: r.reason,
  details: r.details,
  status: r.status,
  createdAt: iso(r.created_at),
});
type PageQuery = { limit?: number; offset?: number; city?: string };

export function locationRoutes(
  app: FastifyInstance,
  db: Database,
  guards: {
    requireAuth: (req: FastifyRequest) => { user: Row };
    requireWrite: (req: FastifyRequest) => { user: Row };
    HttpError: new (status: number, code: string, message: string) => Error;
    notFound: () => Error;
  },
) {
  const { requireAuth, requireWrite, HttpError, notFound } = guards;
  const member = { security: [{ cookieSession: [] }] };
  const moderator = (req: FastifyRequest, write = false) => {
    const auth = write ? requireWrite(req) : requireAuth(req);
    if (auth.user.role !== "moderator")
      throw new HttpError(
        403,
        "MODERATOR_REQUIRED",
        "Этот раздел доступен модератору.",
      );
    return auth;
  };
  const conflict = () =>
    new HttpError(
      409,
      "STATE_CHANGED",
      "Состояние изменилось. Обновите очередь и проверьте объект снова.",
    );
  async function list(where: string, params: unknown[], q: PageQuery) {
    const limit = q.limit ?? 12,
      offset = q.offset ?? 0;
    if (q.city) {
      params.push(q.city);
      where += ` AND l.city=$${params.length}`;
    }
    const rows = await db.query(
      `${locationSelect} WHERE ${where} ORDER BY l.created_at DESC,l.id DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, limit + 1, offset],
    );
    return {
      items: rows.slice(0, limit).map(locationOf),
      nextOffset: rows.length > limit ? offset + limit : null,
    };
  }
  async function get(id: string, req: FastifyRequest) {
    const [r] = await db.query(
      `${locationSelect} WHERE l.id=$1 AND (l.status='published' OR l.author_id=$2 OR $3)`,
      [
        id,
        req.authContext?.user.id ?? null,
        req.authContext?.user.role === "moderator",
      ],
    );
    if (!r) throw notFound();
    return locationOf(r);
  }
  app.get<{ Querystring: PageQuery }>(
    "/api/locations",
    { schema: { querystring: schemas.locationPage, tags: ["Locations"] } },
    (req) => list("l.status='published'", [], req.query),
  );
  app.get<{ Querystring: PageQuery }>(
    "/api/me/locations",
    {
      schema: {
        querystring: schemas.locationPage,
        ...member,
        tags: ["Locations"],
      },
    },
    (req) => list("l.author_id=$1", [requireAuth(req).user.id], req.query),
  );
  app.get<{ Querystring: PageQuery }>(
    "/api/moderation/locations",
    {
      schema: {
        querystring: schemas.locationPage,
        ...member,
        tags: ["Moderation"],
      },
    },
    (req) => {
      moderator(req);
      return list("l.status='pending'", [], req.query);
    },
  );
  app.get<{ Params: { id: string } }>(
    "/api/locations/:id",
    { schema: { params: schemas.id, tags: ["Locations"] } },
    (req) => get(req.params.id, req),
  );
  app.post<{ Body: LocationInput }>(
    "/api/locations",
    { schema: { body: schemas.location, ...member, tags: ["Locations"] } },
    async (req, reply) => {
      const auth = requireWrite(req),
        b = req.body;
      if (
        b.title.trim().length < 3 ||
        b.description.trim().length < 10 ||
        b.city.trim().length < 2 ||
        b.accessNotes.trim().length < 10
      )
        throw new HttpError(
          400,
          "VALIDATION_ERROR",
          "Заполните название, описание, город и условия доступа.",
        );
      const id = randomUUID();
      await db.query(
        "INSERT INTO locations(id,author_id,title,description,city,latitude,longitude,difficulty,access_notes) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)",
        [
          id,
          auth.user.id,
          b.title.trim(),
          b.description.trim(),
          b.city.trim(),
          b.latitude,
          b.longitude,
          b.difficulty,
          b.accessNotes.trim(),
        ],
      );
      reply.code(201);
      return get(id, req);
    },
  );
  app.get<{ Params: { id: string } }>(
    "/api/locations/:id/decisions",
    { schema: { params: schemas.id, ...member, tags: ["Moderation"] } },
    async (req) => {
      const auth = requireAuth(req);
      const [r] = await db.query(
        "SELECT id FROM locations WHERE id=$1 AND (author_id=$2 OR $3)",
        [req.params.id, auth.user.id, auth.user.role === "moderator"],
      );
      if (!r) throw notFound();
      const rows = await db.query(
        "SELECT id,action,reason,created_at FROM moderation_actions WHERE target_type='location' AND target_id=$1 ORDER BY created_at DESC,id DESC LIMIT 50",
        [req.params.id],
      );
      return {
        items: rows.map((r) => ({
          id: r.id,
          action: r.action,
          reason: r.reason,
          createdAt: iso(r.created_at),
        })),
      };
    },
  );
  app.post<{
    Params: { id: string };
    Body: {
      action: "publish" | "reject" | "hide";
      reason: string;
      expectedStatus: string;
    };
  }>(
    "/api/moderation/locations/:id/decision",
    {
      schema: {
        params: schemas.id,
        body: schemas.decision,
        ...member,
        tags: ["Moderation"],
      },
    },
    async (req) => {
      const auth = moderator(req, true),
        b = req.body;
      if (b.reason.trim().length < 10)
        throw new HttpError(
          400,
          "VALIDATION_ERROR",
          "Укажите причину решения от 10 символов.",
        );
      const expected = b.action === "hide" ? "published" : "pending";
      if (b.expectedStatus !== expected) throw conflict();
      await db.transaction(async (tx) => {
        const [r] = await tx.query(
          "UPDATE locations SET status=$2,updated_at=now() WHERE id=$1 AND status=$3 RETURNING id",
          [
            req.params.id,
            { publish: "published", reject: "rejected", hide: "hidden" }[
              b.action
            ],
            expected,
          ],
        );
        if (!r) throw conflict();
        const [owner] = await tx.query(
          "SELECT author_id FROM locations WHERE id=$1",
          [r.id],
        );
        await notify(
          tx,
          owner.author_id,
          "Результат проверки вашей локации обновлён",
          "map",
        );
        await tx.query(
          "INSERT INTO moderation_actions(id,actor_id,target_type,target_id,action,reason) VALUES ($1,$2,'location',$3,$4,$5)",
          [
            randomUUID(),
            auth.user.id,
            req.params.id,
            b.action,
            b.reason.trim(),
          ],
        );
      });
      return get(req.params.id, req);
    },
  );
  app.post<{
    Body: {
      targetType: "post" | "location" | "track";
      targetId: string;
      reason: string;
      details: string;
    };
  }>(
    "/api/reports",
    { schema: { body: schemas.report, ...member, tags: ["Moderation"] } },
    async (req, reply) => {
      const auth = requireWrite(req),
        b = req.body;
      if (b.details.trim().length < 10)
        throw new HttpError(
          400,
          "VALIDATION_ERROR",
          "Опишите проблему от 10 символов.",
        );
      // Lock the visible target until report creation completes; private objects cannot be probed.
      const result = await db.transaction(async (tx) => {
        const table =
          b.targetType === "post"
            ? "posts"
            : b.targetType === "track"
              ? "tracks"
              : "locations";
        const visible =
          b.targetType === "post"
            ? "visibility='public' AND NOT hidden"
            : "status='published'";
        const [target] = await tx.query(
          `SELECT id FROM ${table} WHERE id=$1 AND ${visible} FOR UPDATE`,
          [b.targetId],
        );
        if (!target) throw notFound();
        const [r] = await tx.query(
          "INSERT INTO reports(id,reporter_id,target_type,target_id,reason,details) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (reporter_id,target_type,target_id) WHERE status='open' DO NOTHING RETURNING *",
          [
            randomUUID(),
            auth.user.id,
            b.targetType,
            b.targetId,
            b.reason,
            b.details.trim(),
          ],
        );
        if (!r)
          throw new HttpError(
            409,
            "REPORT_EXISTS",
            "Вы уже отправили жалобу. Она ожидает проверки.",
          );
        return reportOf(r);
      });
      reply.code(201);
      return result;
    },
  );
  app.get<{ Querystring: PageQuery }>(
    "/api/moderation/reports",
    {
      schema: {
        querystring: schemas.locationPage,
        ...member,
        tags: ["Moderation"],
      },
    },
    async (req) => {
      moderator(req);
      const limit = req.query.limit ?? 12,
        offset = req.query.offset ?? 0;
      const rows = await db.query(
        "SELECT * FROM reports WHERE status='open' ORDER BY created_at,id LIMIT $1 OFFSET $2",
        [limit + 1, offset],
      );
      return {
        items: rows.slice(0, limit).map(reportOf),
        nextOffset: rows.length > limit ? offset + limit : null,
      };
    },
  );
  app.post<{
    Params: { id: string };
    Body: { action: "dismiss" | "hide"; reason: string };
  }>(
    "/api/moderation/reports/:id/decision",
    {
      schema: {
        params: schemas.id,
        body: schemas.resolveReport,
        ...member,
        tags: ["Moderation"],
      },
    },
    async (req) => {
      const auth = moderator(req, true),
        b = req.body;
      if (b.reason.trim().length < 10)
        throw new HttpError(
          400,
          "VALIDATION_ERROR",
          "Укажите причину решения от 10 символов.",
        );
      return db.transaction(async (tx) => {
        const [r] = await tx.query(
          "SELECT * FROM reports WHERE id=$1 FOR UPDATE",
          [req.params.id],
        );
        if (!r) throw notFound();
        if (r.status !== "open") throw conflict();
        if (b.action === "hide") {
          // The target may have been deleted or made private after the report. Never expose private content.
          const table =
            r.target_type === "post"
              ? "posts"
              : r.target_type === "track"
                ? "tracks"
                : "locations";
          const assignment =
            r.target_type === "post"
              ? "hidden=true,updated_at=now()"
              : "status='hidden',updated_at=now()";
          await tx.query(`UPDATE ${table} SET ${assignment} WHERE id=$1`, [
            r.target_id,
          ]);
          await tx.query(
            "INSERT INTO moderation_actions(id,actor_id,target_type,target_id,action,reason) VALUES ($1,$2,$3,$4,'hide',$5)",
            [
              randomUUID(),
              auth.user.id,
              r.target_type,
              r.target_id,
              b.reason.trim(),
            ],
          );
        }
        const [updated] = await tx.query(
          "UPDATE reports SET status=$2 WHERE id=$1 RETURNING *",
          [r.id, b.action === "hide" ? "hidden" : "dismissed"],
        );
        await tx.query(
          "INSERT INTO moderation_actions(id,actor_id,target_type,target_id,action,reason) VALUES ($1,$2,'report',$3,$4,$5)",
          [randomUUID(), auth.user.id, r.id, b.action, b.reason.trim()],
        );
        return reportOf(updated);
      });
    },
  );
}
