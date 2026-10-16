import type { FastifyInstance, FastifyRequest } from "fastify";
import { notify } from "./pilot.ts";
import { randomUUID } from "node:crypto";
import {
  schemas,
  responses,
  visitResponses,
  visitSchemas,
  difficultyVotesNeeded,
  type Difficulty,
  type LocationInput,
  type LocationKind,
  type LocationVisits,
  type PlaceImportResult,
  type PlaceImportRow,
  placeImportResponses,
  placeImportSchemas,
} from "@enduro/contracts";
import type { Database, Row } from "./database.ts";
import { profileOf } from "./auth.ts";
import { blockedBetween } from "./blocks.ts";

export const locationOutputs: Record<string, [number, unknown]> = {
  "GET /api/locations": [200, responses.locations],
  "GET /api/me/locations": [200, responses.locations],
  "GET /api/locations/:id": [200, responses.location],
  "POST /api/locations": [201, responses.location],
  "POST /api/moderation/locations/import": [200, placeImportResponses.result],
  "PATCH /api/locations/:id": [200, responses.location],
  "GET /api/locations/:id/decisions": [200, responses.audit],
  "GET /api/moderation/locations": [200, responses.locations],
  "POST /api/moderation/locations/:id/decision": [200, responses.location],
  "POST /api/reports": [201, responses.report],
  "GET /api/moderation/reports": [200, responses.reports],
  "POST /api/moderation/reports/:id/decision": [200, responses.report],
};
const iso = (v: Date | string) => new Date(v).toISOString();
// Riders' difficulty for a place: the most voted level once enough riders voted; a tie goes
// to the medium, then the harder level, so nobody is lured onto a track by a split vote.
export const communityDifficultySql = (place: string) =>
  `(SELECT s.d FROM (SELECT v.difficulty AS d,count(*) AS n FROM location_visits v WHERE v.location_id=${place} AND v.difficulty IS NOT NULL GROUP BY v.difficulty) s WHERE (SELECT count(*) FROM location_visits w WHERE w.location_id=${place} AND w.difficulty IS NOT NULL)>=${difficultyVotesNeeded} ORDER BY s.n DESC,CASE s.d WHEN 'medium' THEN 0 WHEN 'hard' THEN 1 ELSE 2 END LIMIT 1)`;
export const locationSelect = `SELECT l.*,u.handle,u.display_name,u.level,u.bio,u.city AS author_city,(SELECT count(*) FROM location_visits v WHERE v.location_id=l.id) AS visits,${communityDifficultySql("l.id")} AS community_difficulty FROM locations l JOIN users u ON u.id=l.author_id`;
export const locationOf = (r: Row) => ({
  id: r.id,
  title: r.title,
  description: r.description,
  city: r.city,
  latitude: r.latitude,
  longitude: r.longitude,
  kind: r.kind ?? "spot",
  difficulty: r.difficulty ?? null,
  communityDifficulty: r.community_difficulty ?? null,
  visits: Number(r.visits ?? 0),
  accessNotes: r.access_notes,
  contacts: r.contacts ?? "",
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
type PageQuery = {
  limit?: number;
  offset?: number;
  city?: string;
  kind?: string;
};

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
    if (q.kind === "services") where += " AND l.kind<>'spot'";
    else if (q.kind) {
      params.push(q.kind);
      where += ` AND l.kind=$${params.length}`;
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
  // Shared by create and edit: trimmed values in INSERT/UPDATE order after the ids.
  function fields(b: LocationInput) {
    const kind = b.kind ?? "spot";
    // A riding spot needs a difficulty; rentals, guides and schools do not have one.
    if (kind === "spot" && !b.difficulty)
      throw new HttpError(400, "VALIDATION_ERROR", "Укажите сложность места.");
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
    return [
      b.title.trim(),
      b.description.trim(),
      b.city.trim(),
      b.latitude,
      b.longitude,
      kind === "spot" ? b.difficulty : null,
      b.accessNotes.trim(),
      kind,
      (b.contacts ?? "").trim(),
    ];
  }
  async function get(id: string, req: FastifyRequest) {
    const [r] = await db.query(
      `${locationSelect} WHERE l.id=$1 AND (l.status='published' OR l.author_id=$2 OR $3) AND (l.author_id=$2 OR $3 OR NOT ${blockedBetween("$2::uuid", "l.author_id")})`,
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
    (req) =>
      // Places of riders in a block with the viewer are hidden, as their posts are.
      list(
        `l.status='published' AND NOT ${blockedBetween("$1::uuid", "l.author_id")}`,
        [req.authContext?.user.id ?? null],
        req.query,
      ),
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
        v = fields(req.body);
      const id = randomUUID();
      await db.query(
        "INSERT INTO locations(id,author_id,title,description,city,latitude,longitude,difficulty,access_notes,kind,contacts) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)",
        [id, auth.user.id, ...v],
      );
      reply.code(201);
      return get(id, req);
    },
  );
  // The author fixes a proposal and sends it to moderation again: after a rejection, while
  // pending, or to change a published card (it leaves the map until re-approved).
  // A place hidden by a moderator cannot be brought back by editing.
  app.patch<{ Params: { id: string }; Body: LocationInput }>(
    "/api/locations/:id",
    {
      schema: {
        params: schemas.id,
        body: schemas.location,
        ...member,
        tags: ["Locations"],
      },
    },
    async (req) => {
      const auth = requireWrite(req),
        v = fields(req.body);
      const [r] = await db.query(
        "SELECT status FROM locations WHERE id=$1 AND author_id=$2",
        [req.params.id, auth.user.id],
      );
      if (!r) throw notFound();
      if (r.status === "hidden")
        throw new HttpError(
          409,
          "LOCATION_HIDDEN",
          "Место скрыто модератором и не может быть изменено.",
        );
      const [updated] = await db.query(
        "UPDATE locations SET title=$3,description=$4,city=$5,latitude=$6,longitude=$7,difficulty=$8,access_notes=$9,kind=$10,contacts=$11,status='pending',updated_at=now() WHERE id=$1 AND author_id=$2 AND status<>'hidden' RETURNING id",
        [req.params.id, auth.user.id, ...v],
      );
      if (!updated) throw conflict();
      return get(req.params.id, req);
    },
  );
  // Bulk upload by a moderator: each row is checked like the form; good rows are published
  // at once under the moderator's name with a logged decision, bad rows come back with a reason.
  const kindWords: Record<string, LocationKind> = {
    spot: "spot",
    место: "spot",
    "место для катания": "spot",
    трасса: "spot",
    rental: "rental",
    прокат: "rental",
    guide: "guide",
    гид: "guide",
    school: "school",
    школа: "school",
  };
  const difficultyWords: Record<string, Difficulty> = {
    easy: "easy",
    лёгкая: "easy",
    легкая: "easy",
    medium: "medium",
    средняя: "medium",
    hard: "hard",
    сложная: "hard",
    тяжёлая: "hard",
    тяжелая: "hard",
  };
  app.post<{ Body: { items: PlaceImportRow[] } }>(
    "/api/moderation/locations/import",
    {
      config: { rateLimit: { max: 10, timeWindow: "1 minute" } },
      bodyLimit: 1024 * 1024,
      schema: {
        body: placeImportSchemas.body,
        ...member,
        tags: ["Moderation"],
        response: { 200: placeImportResponses.result },
      },
    },
    async (req) => {
      const auth = moderator(req, true);
      const result: PlaceImportResult = { added: 0, skipped: [] };
      const seen = new Set<string>();
      await db.transaction(async (tx) => {
        for (const [index, row] of req.body.items.entries()) {
          const title = (row.title ?? "").trim();
          const skip = (reason: string) =>
            result.skipped.push({ row: index + 2, title, reason });
          const kind =
            kindWords[(row.kind ?? "").trim().toLowerCase() || "spot"];
          if (!kind) {
            skip("Неизвестный тип: место, прокат, гид или школа.");
            continue;
          }
          const difficultyText = (row.difficulty ?? "").trim().toLowerCase();
          const difficulty = difficultyText
            ? difficultyWords[difficultyText]
            : undefined;
          if (difficultyText && !difficulty) {
            skip("Сложность: лёгкая, средняя или сложная.");
            continue;
          }
          const { latitude, longitude } = row;
          if (
            typeof latitude !== "number" ||
            typeof longitude !== "number" ||
            Math.abs(latitude) > 90 ||
            Math.abs(longitude) > 180
          ) {
            skip("Нет координат или они вне допустимого диапазона.");
            continue;
          }
          let values: unknown[];
          try {
            values = fields({
              kind,
              title,
              description: row.description ?? "",
              city: row.city ?? "",
              latitude,
              longitude,
              difficulty: difficulty ?? null,
              accessNotes: row.accessNotes ?? "",
              contacts: row.contacts ?? "",
              publicationConsent: true,
            });
          } catch (e) {
            skip((e as Error).message);
            continue;
          }
          if (
            title.length > 140 ||
            (row.description ?? "").length > 3000 ||
            (row.accessNotes ?? "").length > 1500 ||
            (row.city ?? "").length > 80 ||
            (row.contacts ?? "").length > 300
          ) {
            skip("Слишком длинный текст в одной из ячеек.");
            continue;
          }
          const key = `${title.toLowerCase()}|${latitude.toFixed(3)}|${longitude.toFixed(3)}`;
          if (seen.has(key)) {
            skip("Повтор строки в файле.");
            continue;
          }
          seen.add(key);
          // About 150 m around: the same name there is the same place.
          const [twin] = await tx.query(
            "SELECT title FROM locations WHERE lower(title)=lower($1) AND abs(latitude-$2)<0.0015 AND abs(longitude-$3)<0.0025 LIMIT 1",
            [title, latitude, longitude],
          );
          if (twin) {
            skip("Такое место уже есть на карте.");
            continue;
          }
          const id = randomUUID();
          await tx.query(
            "INSERT INTO locations(id,author_id,title,description,city,latitude,longitude,difficulty,access_notes,kind,contacts,status) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'published')",
            [id, auth.user.id, ...values],
          );
          await tx.query(
            "INSERT INTO moderation_actions(id,actor_id,target_type,target_id,action,reason) VALUES ($1,$2,'location',$3,'publish','Загружено модератором из таблицы')",
            [randomUUID(), auth.user.id, id],
          );
          result.added++;
        }
      });
      return result;
    },
  );
  // «Был здесь»: marks of riders who visited a published place, with a difficulty vote for spots.
  async function visitsOf(
    id: string,
    me: string | null,
  ): Promise<LocationVisits> {
    const [r] = await db.query(
      `SELECT count(*) AS visits,count(*) FILTER (WHERE difficulty='easy') AS easy,count(*) FILTER (WHERE difficulty='medium') AS medium,count(*) FILTER (WHERE difficulty='hard') AS hard,${communityDifficultySql("$1::uuid")} AS community FROM location_visits WHERE location_id=$1`,
      [id],
    );
    const [mine] = me
      ? await db.query(
          "SELECT difficulty FROM location_visits WHERE location_id=$1 AND user_id=$2",
          [id, me],
        )
      : [];
    return {
      visits: Number(r.visits),
      votes: {
        easy: Number(r.easy),
        medium: Number(r.medium),
        hard: Number(r.hard),
      },
      communityDifficulty: r.community ?? null,
      mine: { visited: Boolean(mine), difficulty: mine?.difficulty ?? null },
    };
  }
  async function visitable(id: string, req: FastifyRequest) {
    const place = await get(id, req);
    if (place.status !== "published") throw notFound();
    return place;
  }
  app.get<{ Params: { id: string } }>(
    "/api/locations/:id/visits",
    {
      schema: {
        params: schemas.id,
        tags: ["Locations"],
        response: { 200: visitResponses.summary },
      },
    },
    async (req) => {
      await visitable(req.params.id, req);
      return visitsOf(req.params.id, req.authContext?.user.id ?? null);
    },
  );
  app.put<{ Params: { id: string }; Body: { difficulty?: Difficulty | null } }>(
    "/api/locations/:id/visit",
    {
      config: { rateLimit: { max: 30, timeWindow: "1 minute" } },
      schema: {
        params: schemas.id,
        body: visitSchemas.mark,
        ...member,
        tags: ["Locations"],
        response: { 200: visitResponses.summary },
      },
    },
    async (req) => {
      const auth = requireWrite(req);
      const place = await visitable(req.params.id, req);
      if (place.author.id === auth.user.id)
        throw new HttpError(
          409,
          "OWN_PLACE",
          "Своё место отмечать не нужно — сложность вы указали при добавлении.",
        );
      // Only riding spots have a difficulty.
      const difficulty =
        place.kind === "spot" ? (req.body.difficulty ?? null) : null;
      // Without the field the earlier vote stays; null withdraws it.
      const replace = "difficulty" in req.body;
      await db.query(
        "INSERT INTO location_visits(location_id,user_id,difficulty) VALUES ($1,$2,$3) ON CONFLICT (location_id,user_id) DO UPDATE SET difficulty=CASE WHEN $4 THEN EXCLUDED.difficulty ELSE location_visits.difficulty END,updated_at=now()",
        [place.id, auth.user.id, difficulty, replace],
      );
      return visitsOf(place.id, auth.user.id);
    },
  );
  app.delete<{ Params: { id: string } }>(
    "/api/locations/:id/visit",
    {
      schema: {
        params: schemas.id,
        ...member,
        tags: ["Locations"],
        response: { 200: visitResponses.summary },
      },
    },
    async (req) => {
      const auth = requireWrite(req);
      await visitable(req.params.id, req);
      await db.query(
        "DELETE FROM location_visits WHERE location_id=$1 AND user_id=$2",
        [req.params.id, auth.user.id],
      );
      return visitsOf(req.params.id, auth.user.id);
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
      targetType: "post" | "location" | "track" | "ride" | "ride_message";
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
              : b.targetType === "ride"
                ? "rides"
                : b.targetType === "ride_message"
                  ? "ride_messages"
                  : "locations";
        // A chat message can be reported only by someone who can currently read that chat.
        const visible =
          b.targetType === "post"
            ? "visibility='public' AND NOT hidden"
            : b.targetType === "ride"
              ? "status='open' AND NOT hidden AND EXISTS(SELECT 1 FROM tracks t WHERE t.id=rides.track_id AND t.status='published')"
              : b.targetType === "ride_message"
                ? "hidden_by IS NULL AND EXISTS(SELECT 1 FROM rides r JOIN tracks t ON t.id=r.track_id WHERE r.id=ride_messages.ride_id AND (r.organizer_id=$2 OR (NOT r.hidden AND t.status='published' AND EXISTS(SELECT 1 FROM ride_members m WHERE m.ride_id=r.id AND m.user_id=$2 AND m.status='accepted'))))"
                : "status='published'";
        const [target] = await tx.query(
          `SELECT id FROM ${table} WHERE id=$1 AND ${visible} AND $2::uuid IS NOT NULL FOR UPDATE`,
          [b.targetId, auth.user.id],
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
                : r.target_type === "ride"
                  ? "rides"
                  : r.target_type === "ride_message"
                    ? "ride_messages"
                    : "locations";
          const assignment =
            r.target_type === "post"
              ? "hidden=true,updated_at=now()"
              : r.target_type === "ride"
                ? "hidden=true"
                : r.target_type === "ride_message"
                  ? "hidden_by='moderator'"
                  : "status='hidden',updated_at=now()";
          await tx.query(`UPDATE ${table} SET ${assignment} WHERE id=$1`, [
            r.target_id,
          ]);
          if (r.target_type === "ride") {
            const members = await tx.query(
              "SELECT organizer_id AS user_id FROM rides WHERE id=$1 UNION SELECT user_id FROM ride_members WHERE ride_id=$1 AND status IN ('pending','accepted')",
              [r.target_id],
            );
            for (const m of members)
              await notify(
                tx,
                m.user_id,
                "Покатушка скрыта модератором",
                "rides",
              );
          }
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
