import type { FastifyInstance, FastifyRequest } from "fastify";
import type { Database, Row } from "./database.ts";
import { verifyPassword, cookieName } from "./auth.ts";
import { notify } from "./pilot.ts";
const password = { type: "string", minLength: 1, maxLength: 128 };
export const accountInputs = {
  export: {
    type: "object",
    additionalProperties: false,
    required: ["password"],
    properties: { password },
  },
  delete: {
    type: "object",
    additionalProperties: false,
    required: ["password", "confirmation"],
    properties: {
      password,
      confirmation: { type: "string", const: "УДАЛИТЬ АККАУНТ" },
    },
  },
};
export function accountRightsRoutes(
  app: FastifyInstance,
  db: Database,
  secure: boolean,
  guards: {
    requireWrite: (req: FastifyRequest) => { user: Row };
    HttpError: new (status: number, code: string, message: string) => Error;
  },
) {
  const { requireWrite, HttpError } = guards;
  const config = { rateLimit: { max: 5, timeWindow: "1 hour" } };
  const auth = { security: [{ cookieSession: [] }] };
  async function check(
    tx: Database | Parameters<Parameters<Database["transaction"]>[0]>[0],
    req: FastifyRequest,
    pw: string,
  ) {
    const id = requireWrite(req).user.id;
    const [u] = await tx.query("SELECT * FROM users WHERE id=$1 FOR UPDATE", [
      id,
    ]);
    if (!u || !(await verifyPassword(pw, u.password_hash)))
      throw new HttpError(
        403,
        "PASSWORD_INVALID",
        "Пароль не подтверждён. Проверьте его и попробуйте снова.",
      );
    return u;
  }
  app.post<{ Body: { password: string } }>(
    "/api/me/export",
    {
      schema: {
        ...auth,
        body: accountInputs.export,
        tags: ["Account"],
        response: {
          200: {
            type: "object",
            additionalProperties: true,
            description:
              "Own account data only; no credentials, sessions or other participants private data.",
          },
        },
      },
      config,
    },
    async (req, reply) => {
      const data = await db.transaction(async (tx) => {
        await tx.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ");
        const u = await check(tx, req, req.body.password);
        const [size] = await tx.query(
          "SELECT COALESCE(sum(octet_length(original_gpx)),0) bytes FROM tracks WHERE author_id=$1",
          [u.id],
        );
        if (Number(size.bytes) > 20 * 1024 * 1024)
          throw new HttpError(
            409,
            "EXPORT_TOO_LARGE",
            "Выгрузка превышает лимит текущей версии. Обратитесь к оператору за полной выгрузкой.",
          );
        const selections: Record<string, string> = {
          bikes: "SELECT * FROM bikes WHERE owner_id=$1",
          posts: "SELECT * FROM posts WHERE author_id=$1",
          comments: "SELECT * FROM comments WHERE author_id=$1",
          locations: "SELECT * FROM locations WHERE author_id=$1",
          tracks: "SELECT * FROM tracks WHERE author_id=$1",
          organizedRides: "SELECT * FROM rides WHERE organizer_id=$1",
          memberships:
            "SELECT ride_id,status,created_at FROM ride_members WHERE user_id=$1",
          reports:
            "SELECT id,target_type,target_id,reason,details,status,created_at FROM reports WHERE reporter_id=$1",
          notifications:
            "SELECT id,message,path,created_at,read_at FROM notifications WHERE user_id=$1",
          moderationAuthored:
            "SELECT target_type,target_id,action,reason,created_at FROM moderation_actions WHERE actor_id=$1",
        };
        const result: Record<string, unknown> = {
          formatVersion: 1,
          exportedAt: new Date().toISOString(),
          account: {
            id: u.id,
            email: u.email,
            handle: u.handle,
            displayName: u.display_name,
            city: u.city,
            level: u.level,
            bio: u.bio,
            emailVerified: Boolean(u.email_verified_at),
            createdAt: u.created_at,
          },
        };
        for (const [name, sql] of Object.entries(selections)) {
          const rows = await tx.query(sql + " LIMIT 2001", [u.id]);
          if (rows.length > 2000)
            throw new HttpError(
              409,
              "EXPORT_TOO_LARGE",
              "Для полной выгрузки большого аккаунта обратитесь к оператору.",
            );
          result[name] = rows;
        }
        if (Buffer.byteLength(JSON.stringify(result)) > 25 * 1024 * 1024)
          throw new HttpError(
            409,
            "EXPORT_TOO_LARGE",
            "Для полной выгрузки большого аккаунта обратитесь к оператору.",
          );
        return result;
      });
      reply.header(
        "Content-Disposition",
        'attachment; filename="enduro-zone-account.json"',
      );
      return data;
    },
  );
  app.post<{ Body: { password: string; confirmation: string } }>(
    "/api/me/delete",
    {
      schema: { ...auth, body: accountInputs.delete, tags: ["Account"] },
      config,
    },
    async (req, reply) => {
      await db.transaction(async (tx) => {
        const u = await check(tx, req, req.body.password);
        // Collect generic notices before cascades remove events and memberships.
        await tx.query(
          "SELECT id FROM tracks WHERE author_id=$1 ORDER BY id FOR UPDATE",
          [u.id],
        );
        await tx.query(
          "SELECT r.id FROM rides r JOIN tracks t ON t.id=r.track_id WHERE r.organizer_id=$1 OR t.author_id=$1 ORDER BY r.id FOR UPDATE OF r",
          [u.id],
        );
        const affected = await tx.query(
          "SELECT DISTINCT m.user_id FROM ride_members m JOIN rides r ON r.id=m.ride_id JOIN tracks t ON t.id=r.track_id WHERE (r.organizer_id=$1 OR t.author_id=$1) AND r.status='open' AND r.starts_at>now() AND m.status IN ('pending','accepted') AND m.user_id<>$1",
          [u.id],
        );
        const organizers = await tx.query(
          "SELECT DISTINCT organizer_id AS user_id FROM rides r JOIN tracks t ON t.id=r.track_id WHERE t.author_id=$1 AND organizer_id<>$1 AND r.status='open' AND r.starts_at>now()",
          [u.id],
        );
        for (const id of new Set(
          [...affected, ...organizers].map((r) => r.user_id),
        ))
          await notify(
            tx,
            id,
            "Связанная покатушка удалена вместе с аккаунтом или маршрутом автора",
            "rides",
          );
        // Reports/audit attached to removed objects must not keep descriptions of those objects.
        const targets = await tx.query(
          "SELECT id FROM posts WHERE author_id=$1 UNION SELECT id FROM tracks WHERE author_id=$1 UNION SELECT id FROM locations WHERE author_id=$1 UNION SELECT r.id FROM rides r JOIN tracks t ON t.id=r.track_id WHERE r.organizer_id=$1 OR t.author_id=$1",
          [u.id],
        );
        if (targets.length) {
          const ids = targets.map((r) => r.id);
          await tx.query(
            "DELETE FROM moderation_actions WHERE target_id IN (SELECT id FROM reports WHERE target_id=ANY($1::uuid[]) OR reporter_id=$2)",
            [ids, u.id],
          );
          await tx.query(
            "DELETE FROM reports WHERE target_id=ANY($1::uuid[])",
            [ids],
          );
          await tx.query(
            "DELETE FROM moderation_actions WHERE target_id=ANY($1::uuid[])",
            [ids],
          );
        }
        await tx.query(
          "DELETE FROM moderation_actions WHERE target_id IN (SELECT id FROM reports WHERE reporter_id=$1)",
          [u.id],
        );
        await tx.query("DELETE FROM posts WHERE author_id=$1", [u.id]);
        await tx.query("DELETE FROM users WHERE id=$1", [u.id]);
      });
      reply.clearCookie(cookieName, {
        path: "/",
        httpOnly: true,
        sameSite: "lax",
        secure,
      });
      return reply.code(204).send();
    },
  );
}
