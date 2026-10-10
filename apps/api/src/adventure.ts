import type { FastifyInstance, FastifyRequest } from "fastify";
import { notify } from "./pilot.ts";
import { randomUUID } from "node:crypto";
import {
  schemas,
  responses,
  adventureSchemas as input,
  adventureResponses as output,
  type TrackInput,
  type RideInput,
} from "@enduro/contracts";
import type { Database, Row } from "./database.ts";
import { profileOf } from "./auth.ts";
import { previewGpx, publicGpx } from "./gpx.ts";
export const adventureOutputs: Record<string, [number, unknown]> = {
  "POST /api/tracks/preview": [200, output.preview],
  "POST /api/tracks": [201, output.track],
  "GET /api/tracks": [200, output.tracks],
  "GET /api/me/tracks": [200, output.tracks],
  "GET /api/tracks/:id": [200, output.track],
  "GET /api/tracks/:id/original": [200, output.original],
  "GET /api/tracks/:id/decisions": [200, responses.audit],
  "GET /api/moderation/tracks": [200, output.tracks],
  "POST /api/moderation/tracks/:id/decision": [200, output.track],
  "GET /api/rides": [200, output.rides],
  "GET /api/me/rides": [200, output.rides],
  "POST /api/rides": [201, output.ride],
  "GET /api/rides/:id": [200, output.ride],
  "GET /api/rides/:id/membership": [200, output.membership],
  "POST /api/rides/:id/join": [200, output.membership],
  "POST /api/rides/:id/leave": [200, output.membership],
  "GET /api/rides/:id/meeting": [200, output.meeting],
  "GET /api/rides/:id/members": [200, output.members],
  "POST /api/rides/:id/members/:userId/decision": [200, output.membership],
  "POST /api/rides/:id/cancel": [200, output.ride],
};
const iso = (v: Date | string) => new Date(v).toISOString();
const trackSelect = `SELECT t.*,u.handle,u.display_name,u.level,u.bio,u.city AS author_city FROM tracks t JOIN users u ON t.author_id=u.id`;
const trackOf = (r: Row) => ({
  id: r.id,
  title: r.title,
  description: r.description,
  city: r.city,
  accessNotes: r.access_notes,
  difficulty: r.difficulty,
  status: r.status,
  geometry: r.geometry,
  distanceM: r.distance_m,
  pointCount: r.point_count,
  trimM: r.trim_m,
  createdAt: iso(r.created_at),
  updatedAt: iso(r.updated_at),
  author: profileOf({ ...r, id: r.author_id, city: r.author_city }),
});
const rideSelect = `SELECT r.id,r.organizer_id,r.track_id,r.title,r.description,r.starts_at,r.timezone,r.capacity,r.status,r.created_at,t.city,t.title AS track_title,t.status AS track_status,u.handle,u.display_name,u.level,u.bio,u.city AS organizer_city,1+(SELECT count(*) FROM ride_members m WHERE m.ride_id=r.id AND m.status='accepted') AS accepted_count FROM rides r JOIN tracks t ON t.id=r.track_id JOIN users u ON u.id=r.organizer_id`;
const rideOf = (r: Row) => ({
  id: r.id,
  trackId: r.track_id,
  title: r.title,
  description: r.description,
  startsAt: iso(r.starts_at),
  timezone: r.timezone,
  capacity: r.capacity,
  status: r.status,
  city: r.city,
  trackTitle: r.track_title,
  createdAt: iso(r.created_at),
  acceptedCount: Number(r.accepted_count),
  organizer: profileOf({ ...r, id: r.organizer_id, city: r.organizer_city }),
});
type Query = { limit?: number; offset?: number; city?: string };
type Id = { id: string };
export function adventureRoutes(
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
  const authSchema = { security: [{ cookieSession: [] }] };
  const conflict = (message = "Состояние изменилось. Обновите страницу.") =>
    new HttpError(409, "STATE_CHANGED", message);
  const moderator = (req: FastifyRequest, write = false) => {
    const a = write ? requireWrite(req) : requireAuth(req);
    if (a.user.role !== "moderator")
      throw new HttpError(
        403,
        "MODERATOR_REQUIRED",
        "Доступно только модератору.",
      );
    return a;
  };
  const valid = (strings: string[]) => {
    if (strings.some((s) => s.trim().length < 3))
      throw new HttpError(
        400,
        "VALIDATION_ERROR",
        "Заполните обязательные поля.",
      );
  };
  async function track(id: string, req: FastifyRequest) {
    const [r] = await db.query(
      `${trackSelect} WHERE t.id=$1 AND (t.status='published' OR t.author_id=$2 OR $3)`,
      [
        id,
        req.authContext?.user.id ?? null,
        req.authContext?.user.role === "moderator",
      ],
    );
    if (!r) throw notFound();
    return trackOf(r);
  }
  async function tracks(where: string, params: unknown[], q: Query) {
    const limit = q.limit ?? 12,
      offset = q.offset ?? 0;
    if (q.city) {
      params.push(q.city);
      where += ` AND t.city=$${params.length}`;
    }
    const rows = await db.query(
      `${trackSelect} WHERE ${where} ORDER BY t.created_at DESC,t.id DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, limit + 1, offset],
    );
    return {
      items: rows.slice(0, limit).map(trackOf),
      nextOffset: rows.length > limit ? offset + limit : null,
    };
  }
  app.post<{ Body: { gpx: string; trimM: number } }>(
    "/api/tracks/preview",
    {
      bodyLimit: 512 * 1024,
      schema: { body: input.preview, ...authSchema, tags: ["Tracks"] },
      config: { rateLimit: { max: 10, timeWindow: "1 minute" } },
    },
    (req) => {
      requireWrite(req);
      return previewGpx(req.body.gpx, req.body.trimM);
    },
  );
  app.post<{ Body: TrackInput }>(
    "/api/tracks",
    {
      bodyLimit: 512 * 1024,
      schema: { body: input.track, ...authSchema, tags: ["Tracks"] },
      config: { rateLimit: { max: 10, timeWindow: "1 minute" } },
    },
    async (req, reply) => {
      const a = requireWrite(req),
        b = req.body;
      valid([b.title, b.description, b.accessNotes]);
      if (b.city.trim().length < 2)
        throw new HttpError(400, "VALIDATION_ERROR", "Укажите город.");
      if (b.description.trim().length < 10 || b.accessNotes.trim().length < 10)
        throw new HttpError(
          400,
          "VALIDATION_ERROR",
          "Описание и условия доступа — от 10 символов.",
        );
      const preview = previewGpx(b.gpx, b.trimM),
        id = randomUUID();
      await db.query(
        "INSERT INTO tracks(id,author_id,title,description,city,access_notes,difficulty,original_gpx,geometry,distance_m,trim_m,point_count) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)",
        [
          id,
          a.user.id,
          b.title.trim(),
          b.description.trim(),
          b.city.trim(),
          b.accessNotes.trim(),
          b.difficulty,
          b.gpx,
          JSON.stringify(preview.geometry),
          preview.distanceM,
          preview.trimM,
          preview.pointCount,
        ],
      );
      reply.code(201);
      return track(id, req);
    },
  );
  app.get<{ Querystring: Query }>(
    "/api/tracks",
    { schema: { querystring: schemas.locationPage, tags: ["Tracks"] } },
    (req) => tracks("t.status='published'", [], req.query),
  );
  app.get<{ Querystring: Query }>(
    "/api/me/tracks",
    {
      schema: {
        querystring: schemas.locationPage,
        ...authSchema,
        tags: ["Tracks"],
      },
    },
    (req) => tracks("t.author_id=$1", [requireAuth(req).user.id], req.query),
  );
  app.get<{ Querystring: Query }>(
    "/api/moderation/tracks",
    {
      schema: {
        querystring: schemas.locationPage,
        ...authSchema,
        tags: ["Moderation"],
      },
    },
    (req) => {
      moderator(req);
      return tracks("t.status='pending'", [], req.query);
    },
  );
  app.get<{ Params: Id }>(
    "/api/tracks/:id",
    { schema: { params: schemas.id, tags: ["Tracks"] } },
    (req) => track(req.params.id, req),
  );
  app.get<{ Params: Id }>(
    "/api/tracks/:id/original",
    { schema: { params: schemas.id, ...authSchema, tags: ["Tracks"] } },
    async (req) => {
      const a = requireAuth(req);
      const [r] = await db.query(
        "SELECT original_gpx FROM tracks WHERE id=$1 AND author_id=$2",
        [req.params.id, a.user.id],
      );
      if (!r) throw notFound();
      return { gpx: r.original_gpx };
    },
  );
  app.get<{ Params: Id }>(
    "/api/tracks/:id/gpx",
    { schema: { params: schemas.id, tags: ["Tracks"] } },
    async (req, reply) => {
      const t = await track(req.params.id, req);
      return reply
        .type("application/gpx+xml")
        .header(
          "Content-Disposition",
          `attachment; filename="enduro-track-${t.id}.gpx"`,
        )
        .send(publicGpx(t.geometry));
    },
  );
  app.get<{ Params: Id }>(
    "/api/tracks/:id/decisions",
    { schema: { params: schemas.id, ...authSchema, tags: ["Moderation"] } },
    async (req) => {
      const a = requireAuth(req);
      const [r] = await db.query(
        "SELECT id FROM tracks WHERE id=$1 AND (author_id=$2 OR $3)",
        [req.params.id, a.user.id, a.user.role === "moderator"],
      );
      if (!r) throw notFound();
      const rows = await db.query(
        "SELECT id,action,reason,created_at FROM moderation_actions WHERE target_type='track' AND target_id=$1 ORDER BY created_at DESC,id DESC LIMIT 50",
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
    Params: Id;
    Body: {
      action: "publish" | "reject" | "hide";
      reason: string;
      expectedStatus: string;
    };
  }>(
    "/api/moderation/tracks/:id/decision",
    {
      schema: {
        params: schemas.id,
        body: schemas.decision,
        ...authSchema,
        tags: ["Moderation"],
      },
    },
    async (req) => {
      const a = moderator(req, true),
        b = req.body,
        expected = b.action === "hide" ? "published" : "pending";
      if (b.reason.trim().length < 10)
        throw new HttpError(
          400,
          "VALIDATION_ERROR",
          "Причина — от 10 символов.",
        );
      if (b.expectedStatus !== expected) throw conflict();
      await db.transaction(async (tx) => {
        const [r] = await tx.query(
          "UPDATE tracks SET status=$2,updated_at=now() WHERE id=$1 AND status=$3 RETURNING id",
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
          "SELECT author_id FROM tracks WHERE id=$1",
          [r.id],
        );
        await notify(
          tx,
          owner.author_id,
          "Результат проверки вашего GPX-трека обновлён",
          `track/${r.id}`,
        );
        await tx.query(
          "INSERT INTO moderation_actions(id,actor_id,target_type,target_id,action,reason) VALUES ($1,$2,'track',$3,$4,$5)",
          [randomUUID(), a.user.id, r.id, b.action, b.reason.trim()],
        );
      });
      return track(req.params.id, req);
    },
  );
  async function ride(id: string, req: FastifyRequest) {
    const [r] = await db.query(
      `${rideSelect} WHERE r.id=$1 AND (t.status='published' OR r.organizer_id=$2)`,
      [id, req.authContext?.user.id ?? null],
    );
    if (!r) throw notFound();
    return rideOf(r);
  }
  async function rides(where: string, params: unknown[], q: Query) {
    const limit = q.limit ?? 12,
      offset = q.offset ?? 0;
    if (q.city) {
      params.push(q.city);
      where += ` AND t.city=$${params.length}`;
    }
    const rows = await db.query(
      `${rideSelect} WHERE ${where} ORDER BY r.starts_at,r.id LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, limit + 1, offset],
    );
    return {
      items: rows.slice(0, limit).map(rideOf),
      nextOffset: rows.length > limit ? offset + limit : null,
    };
  }
  app.get<{ Querystring: Query }>(
    "/api/rides",
    { schema: { querystring: schemas.locationPage, tags: ["Rides"] } },
    (req) =>
      rides(
        "r.status='open' AND r.starts_at>now() AND t.status='published'",
        [],
        req.query,
      ),
  );
  app.get<{ Querystring: Query }>(
    "/api/me/rides",
    {
      schema: {
        querystring: schemas.locationPage,
        ...authSchema,
        tags: ["Rides"],
      },
    },
    (req) =>
      rides(
        "(r.organizer_id=$1 OR EXISTS(SELECT 1 FROM ride_members m WHERE m.ride_id=r.id AND m.user_id=$1 AND m.status IN ('pending','accepted')))",
        [requireAuth(req).user.id],
        req.query,
      ),
  );
  app.get<{ Params: Id }>(
    "/api/rides/:id",
    { schema: { params: schemas.id, tags: ["Rides"] } },
    (req) => ride(req.params.id, req),
  );
  app.post<{ Body: RideInput }>(
    "/api/rides",
    { schema: { body: input.ride, ...authSchema, tags: ["Rides"] } },
    async (req, reply) => {
      const a = requireWrite(req),
        b = req.body;
      valid([b.title, b.description, b.meetingNotes]);
      const starts = Date.parse(b.startsAt);
      if (
        !Number.isFinite(starts) ||
        starts < Date.now() + 15 * 60000 ||
        starts > Date.now() + 366 * 86400000 ||
        !/(Z|[+-]\d\d:\d\d)$/.test(b.startsAt)
      )
        throw new HttpError(
          400,
          "VALIDATION_ERROR",
          "Начало: от 15 минут до года вперёд, дата с часовым поясом.",
        );
      if (b.description.trim().length < 10 || b.meetingNotes.trim().length < 10)
        throw new HttpError(
          400,
          "VALIDATION_ERROR",
          "Описание и точка сбора — от 10 символов.",
        );
      const id = randomUUID();
      await db.transaction(async (tx) => {
        const [t] = await tx.query(
          "SELECT id FROM tracks WHERE id=$1 AND status='published' FOR UPDATE",
          [b.trackId],
        );
        if (!t) throw notFound();
        await tx.query(
          "INSERT INTO rides(id,organizer_id,track_id,title,description,meeting_notes,starts_at,timezone,capacity) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)",
          [
            id,
            a.user.id,
            b.trackId,
            b.title.trim(),
            b.description.trim(),
            b.meetingNotes.trim(),
            new Date(starts).toISOString(),
            b.timezone,
            b.capacity,
          ],
        );
      });
      reply.code(201);
      return ride(id, req);
    },
  );
  // Every operation affecting membership locks the same ride row before checking capacity.
  async function lockedRide(
    tx: Parameters<Parameters<Database["transaction"]>[0]>[0],
    id: string,
  ) {
    const [r] = await tx.query(
      "SELECT r.*,t.status AS track_status FROM rides r JOIN tracks t ON t.id=r.track_id WHERE r.id=$1 FOR UPDATE OF r,t",
      [id],
    );
    if (!r) throw notFound();
    return r;
  }
  const open = (r: Row) => {
    if (
      r.status !== "open" ||
      r.track_status !== "published" ||
      new Date(r.starts_at).getTime() <= Date.now()
    )
      throw conflict("Покатушка завершена, отменена или маршрут скрыт.");
  };
  app.get<{ Params: Id }>(
    "/api/rides/:id/membership",
    { schema: { params: schemas.id, ...authSchema, tags: ["Rides"] } },
    async (req) => {
      const a = requireAuth(req),
        r = await ride(req.params.id, req);
      if (r.organizer.id === a.user.id) return { status: "organizer" };
      const [m] = await db.query(
        "SELECT status FROM ride_members WHERE ride_id=$1 AND user_id=$2",
        [r.id, a.user.id],
      );
      return { status: m?.status ?? "none" };
    },
  );
  app.post<{ Params: Id }>(
    "/api/rides/:id/join",
    { schema: { params: schemas.id, ...authSchema, tags: ["Rides"] } },
    async (req) => {
      const a = requireWrite(req);
      return db.transaction(async (tx) => {
        const r = await lockedRide(tx, req.params.id);
        open(r);
        if (r.organizer_id === a.user.id) return { status: "organizer" };
        const [existing] = await tx.query(
          "SELECT status FROM ride_members WHERE ride_id=$1 AND user_id=$2",
          [r.id, a.user.id],
        );
        if (existing?.status === "accepted" || existing?.status === "pending")
          return { status: existing.status };
        if (existing?.status === "declined")
          throw conflict("Организатор отклонил заявку.");
        const [n] = await tx.query(
          "SELECT count(*) AS n FROM ride_members WHERE ride_id=$1 AND status IN ('pending','accepted')",
          [r.id],
        );
        if (Number(n.n) >= 100) throw conflict("Очередь заявок заполнена.");
        const [m] = await tx.query(
          "INSERT INTO ride_members(ride_id,user_id,status) VALUES ($1,$2,'pending') ON CONFLICT(ride_id,user_id) DO UPDATE SET status='pending',created_at=now() RETURNING status",
          [r.id, a.user.id],
        );
        await notify(
          tx,
          r.organizer_id,
          "Новая заявка на вашу покатушку",
          `ride/${r.id}`,
        );
        return m;
      });
    },
  );
  app.post<{ Params: Id }>(
    "/api/rides/:id/leave",
    { schema: { params: schemas.id, ...authSchema, tags: ["Rides"] } },
    async (req) => {
      const a = requireWrite(req);
      return db.transaction(async (tx) => {
        const r = await lockedRide(tx, req.params.id);
        if (r.organizer_id === a.user.id)
          throw conflict("Организатор может отменить покатушку.");
        const [m] = await tx.query(
          "UPDATE ride_members SET status='left' WHERE ride_id=$1 AND user_id=$2 RETURNING status",
          [r.id, a.user.id],
        );
        return { status: m?.status ?? "none" };
      });
    },
  );
  app.get<{ Params: Id }>(
    "/api/rides/:id/meeting",
    { schema: { params: schemas.id, ...authSchema, tags: ["Rides"] } },
    async (req) => {
      const a = requireAuth(req);
      const [r] = await db.query(
        "SELECT r.meeting_notes FROM rides r JOIN tracks t ON t.id=r.track_id WHERE r.id=$1 AND (r.organizer_id=$2 OR (r.status='open' AND r.starts_at>now() AND t.status='published' AND EXISTS(SELECT 1 FROM ride_members m WHERE m.ride_id=r.id AND m.user_id=$2 AND m.status='accepted')))",
        [req.params.id, a.user.id],
      );
      if (!r) throw notFound();
      return { meetingNotes: r.meeting_notes };
    },
  );
  app.get<{ Params: Id }>(
    "/api/rides/:id/members",
    { schema: { params: schemas.id, ...authSchema, tags: ["Rides"] } },
    async (req) => {
      const a = requireAuth(req);
      const [r] = await db.query(
        "SELECT id FROM rides WHERE id=$1 AND organizer_id=$2",
        [req.params.id, a.user.id],
      );
      if (!r) throw notFound();
      const rows = await db.query(
        "SELECT u.id,u.handle,u.display_name,u.city,u.level,u.bio,m.status FROM ride_members m JOIN users u ON u.id=m.user_id WHERE m.ride_id=$1 ORDER BY CASE m.status WHEN 'pending' THEN 0 WHEN 'accepted' THEN 1 ELSE 2 END,m.created_at,u.id LIMIT 100",
        [r.id],
      );
      return {
        items: rows.map((r) => ({ user: profileOf(r), status: r.status })),
      };
    },
  );
  app.post<{
    Params: Id & { userId: string };
    Body: { action: "accept" | "decline" };
  }>(
    "/api/rides/:id/members/:userId/decision",
    {
      schema: {
        params: input.memberParams,
        body: input.memberDecision,
        ...authSchema,
        tags: ["Rides"],
      },
    },
    async (req) => {
      const a = requireWrite(req);
      return db.transaction(async (tx) => {
        const r = await lockedRide(tx, req.params.id);
        if (r.organizer_id !== a.user.id) throw notFound();
        open(r);
        const [m] = await tx.query(
          "SELECT status FROM ride_members WHERE ride_id=$1 AND user_id=$2",
          [r.id, req.params.userId],
        );
        if (!m) throw notFound();
        const desired = req.body.action === "accept" ? "accepted" : "declined";
        if (m.status === desired) return { status: desired };
        if (m.status !== "pending") throw conflict();
        if (desired === "accepted") {
          const [n] = await tx.query(
            "SELECT count(*) AS n FROM ride_members WHERE ride_id=$1 AND status='accepted'",
            [r.id],
          );
          if (Number(n.n) + 1 >= r.capacity)
            throw new HttpError(
              409,
              "RIDE_FULL",
              "Все места заняты. Организатор входит в лимит.",
            );
        }
        await tx.query(
          "UPDATE ride_members SET status=$3 WHERE ride_id=$1 AND user_id=$2",
          [r.id, req.params.userId, desired],
        );
        await notify(
          tx,
          req.params.userId,
          desired === "accepted"
            ? "Ваша заявка на покатушку подтверждена"
            : "Ваша заявка на покатушку отклонена",
          `ride/${r.id}`,
        );
        return { status: desired };
      });
    },
  );
  app.post<{ Params: Id }>(
    "/api/rides/:id/cancel",
    { schema: { params: schemas.id, ...authSchema, tags: ["Rides"] } },
    async (req) => {
      const a = requireWrite(req);
      await db.transaction(async (tx) => {
        const r = await lockedRide(tx, req.params.id);
        if (r.organizer_id !== a.user.id) throw notFound();
        if (r.status === "cancelled") return;
        const members = await tx.query(
          "SELECT user_id FROM ride_members WHERE ride_id=$1 AND status IN ('pending','accepted')",
          [r.id],
        );
        for (const member of members)
          await notify(
            tx,
            member.user_id,
            "Покатушка отменена организатором",
            `ride/${r.id}`,
          );
        await tx.query("UPDATE rides SET status='cancelled' WHERE id=$1", [
          r.id,
        ]);
      });
      return ride(req.params.id, req);
    },
  );
}
