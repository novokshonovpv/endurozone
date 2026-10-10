import { randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import {
  schemas,
  responses,
  serviceSchemas,
  serviceResponses,
  type ServicePlanInput,
  type CompleteServiceInput,
} from "@enduro/contracts";
import type { Database, Queryable, Row } from "./database.ts";
const planOf = (r: Row) => ({
  id: r.id,
  bikeId: r.bike_id,
  title: r.title,
  intervalHours: Number(r.interval_hours),
  dueHours: Number(r.due_hours),
  notes: r.notes,
  version: r.version,
  active: r.active,
  lastHours: r.last_hours === null ? null : Number(r.last_hours),
});
const recordOf = (r: Row) => ({
  id: r.id,
  planId: r.plan_id,
  title: r.title,
  performedOn:
    r.performed_on instanceof Date
      ? r.performed_on.toISOString().slice(0, 10)
      : String(r.performed_on).slice(0, 10),
  hours: Number(r.hours),
  costRub: Number(r.cost_rub),
  notes: r.notes,
  createdAt: new Date(r.created_at).toISOString(),
});
export function garageRoutes(
  app: FastifyInstance,
  db: Database,
  guards: {
    requireAuth: (r: FastifyRequest) => { user: Row };
    requireWrite: (r: FastifyRequest) => { user: Row };
    HttpError: new (status: number, code: string, message: string) => Error;
    notFound: () => Error;
  },
) {
  const { requireAuth, requireWrite, HttpError, notFound } = guards;
  const base = "/api/me/bikes/:id/service";
  const schema = (
    input: Record<string, unknown>,
    code: number,
    out: unknown,
  ) => ({
    ...input,
    security: [{ cookieSession: [] }],
    tags: ["Garage service"],
    response: {
      [code]: out,
      400: responses.error,
      401: responses.error,
      403: responses.error,
      404: responses.error,
      409: responses.error,
    },
  });
  async function bike(tx: Queryable, id: string, userId: string, lock = false) {
    const [r] = await tx.query(
      `SELECT id,hours FROM bikes WHERE id=$1 AND owner_id=$2${lock ? " FOR UPDATE" : ""}`,
      [id, userId],
    );
    if (!r) throw notFound();
    return r;
  }
  async function plan(
    tx: Queryable,
    bikeId: string,
    id: string,
    version: number,
    expectedActive = true,
  ) {
    const [r] = await tx.query(
      "SELECT * FROM bike_service_plans WHERE id=$1 AND bike_id=$2 FOR UPDATE",
      [id, bikeId],
    );
    if (!r) throw notFound();
    if (r.active !== expectedActive || r.version !== version)
      throw new HttpError(
        409,
        "SERVICE_CHANGED",
        "План обслуживания изменился. Обновите гараж и попробуйте снова.",
      );
    return r;
  }
  app.get<{ Params: { id: string }; Querystring: { offset?: number } }>(
    base,
    {
      schema: schema(
        {
          params: schemas.id,
          querystring: {
            type: "object",
            additionalProperties: false,
            properties: {
              offset: {
                type: "integer",
                minimum: 0,
                maximum: 100000,
                default: 0,
              },
            },
          },
        },
        200,
        serviceResponses.page,
      ),
    },
    async (req) => {
      const user = requireAuth(req).user;
      return db.transaction(async (tx) => {
        await bike(tx, req.params.id, user.id);
        const plans = await tx.query(
          "SELECT * FROM bike_service_plans WHERE bike_id=$1 ORDER BY due_hours,id",
          [req.params.id],
        );
        const rows = await tx.query(
          "SELECT r.*,r.performed_on::text AS performed_on FROM bike_service_records r JOIN bike_service_plans p ON p.id=r.plan_id WHERE p.bike_id=$1 ORDER BY r.performed_on DESC,r.created_at DESC,r.id DESC LIMIT 21 OFFSET $2",
          [req.params.id, req.query.offset ?? 0],
        );
        return {
          plans: plans.map(planOf),
          records: rows.slice(0, 20).map(recordOf),
          nextOffset: rows.length > 20 ? (req.query.offset ?? 0) + 20 : null,
        };
      });
    },
  );
  app.post<{ Params: { id: string }; Body: ServicePlanInput }>(
    base + "/plans",
    {
      schema: schema(
        { params: schemas.id, body: serviceSchemas.plan },
        201,
        serviceResponses.plan,
      ),
    },
    async (req, reply) => {
      const user = requireWrite(req).user,
        b = req.body;
      if (!b.title.trim())
        throw new HttpError(400, "TITLE_REQUIRED", "Укажите название работы.");
      const result = await db.transaction(async (tx) => {
        await bike(tx, req.params.id, user.id, true);
        const [count] = await tx.query(
          "SELECT count(*) n FROM bike_service_plans WHERE bike_id=$1",
          [req.params.id],
        );
        if (Number(count.n) >= 50)
          throw new HttpError(
            409,
            "PLAN_LIMIT",
            "В одном мотоцикле может быть до 50 работ, включая архив.",
          );
        const [r] = await tx.query(
          "INSERT INTO bike_service_plans(id,bike_id,title,interval_hours,due_hours,notes) VALUES($1,$2,$3,$4,$5,$6) RETURNING *",
          [
            randomUUID(),
            req.params.id,
            b.title.trim(),
            b.intervalHours,
            b.dueHours,
            b.notes.trim(),
          ],
        );
        return planOf(r);
      });
      return reply.code(201).send(result);
    },
  );
  app.post<{
    Params: { id: string; planId: string };
    Body: CompleteServiceInput;
  }>(
    base + "/plans/:planId/complete",
    {
      schema: schema(
        { params: serviceSchemas.ids, body: serviceSchemas.complete },
        201,
        serviceResponses.record,
      ),
    },
    async (req, reply) => {
      const user = requireWrite(req).user,
        b = req.body;
      const parsed = new Date(b.performedOn + "T00:00:00Z");
      if (
        !Number.isFinite(parsed.getTime()) ||
        parsed.toISOString().slice(0, 10) !== b.performedOn ||
        b.performedOn > new Date().toISOString().slice(0, 10)
      )
        throw new HttpError(
          400,
          "SERVICE_DATE_INVALID",
          "Укажите существующую дату, не позднее сегодняшнего дня (UTC).",
        );
      const result = await db.transaction(async (tx) => {
        await bike(tx, req.params.id, user.id, true);
        const p = await plan(tx, req.params.id, req.params.planId, b.version);
        const [latest] = await tx.query(
          "SELECT performed_on::text AS performed_on FROM bike_service_records WHERE plan_id=$1 ORDER BY performed_on DESC LIMIT 1",
          [p.id],
        );
        const latestDate = latest
          ? latest.performed_on instanceof Date
            ? latest.performed_on.toISOString().slice(0, 10)
            : String(latest.performed_on).slice(0, 10)
          : null;
        if (
          (p.last_hours !== null && b.hours < Number(p.last_hours)) ||
          (latestDate && b.performedOn < latestDate)
        )
          throw new HttpError(
            409,
            "SERVICE_HISTORY_ORDER",
            "Моточасы и дата не могут быть раньше предыдущего обслуживания этой работы.",
          );
        const due = Number((b.hours + Number(p.interval_hours)).toFixed(2));
        if (due > 100000)
          throw new HttpError(
            400,
            "SERVICE_HOURS_LIMIT",
            "Следующий срок выходит за допустимый диапазон моточасов.",
          );
        const [r] = await tx.query(
          "INSERT INTO bike_service_records(id,plan_id,title,performed_on,hours,cost_rub,notes) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id,plan_id,title,performed_on::text AS performed_on,hours,cost_rub,notes,created_at",
          [
            randomUUID(),
            p.id,
            p.title,
            b.performedOn,
            b.hours,
            b.costRub,
            b.notes.trim(),
          ],
        );
        await tx.query(
          "UPDATE bike_service_plans SET due_hours=$2,last_hours=$3,version=version+1 WHERE id=$1",
          [p.id, due, b.hours],
        );
        await tx.query(
          "UPDATE bikes SET hours=GREATEST(hours,$2) WHERE id=$1",
          [req.params.id, b.hours],
        );
        return recordOf(r);
      });
      return reply.code(201).send(result);
    },
  );
  for (const [action, active] of [
    ["archive", false],
    ["restore", true],
  ] as const)
    app.post<{
      Params: { id: string; planId: string };
      Body: { version: number };
    }>(
      base + `/plans/:planId/${action}`,
      {
        schema: schema(
          { params: serviceSchemas.ids, body: serviceSchemas.version },
          200,
          serviceResponses.plan,
        ),
      },
      async (req) => {
        const user = requireWrite(req).user;
        return db.transaction(async (tx) => {
          await bike(tx, req.params.id, user.id, true);
          const p = await plan(
            tx,
            req.params.id,
            req.params.planId,
            req.body.version,
            !active,
          );
          const [r] = await tx.query(
            "UPDATE bike_service_plans SET active=$2,version=version+1 WHERE id=$1 RETURNING *",
            [p.id, active],
          );
          return planOf(r);
        });
      },
    );
}
