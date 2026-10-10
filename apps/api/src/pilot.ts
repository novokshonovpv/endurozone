import { randomBytes, randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import {
  pilotSchemas as input,
  pilotResponses as output,
  schemas,
} from "@enduro/contracts";
import { hashToken, hashPassword } from "./auth.ts";
import type { Database, Queryable, Row } from "./database.ts";

export async function notify(
  db: Queryable,
  userId: string,
  message: string,
  path: string,
) {
  await db.query(
    "INSERT INTO notifications(id,user_id,message,path) VALUES ($1,$2,$3,$4)",
    [randomUUID(), userId, message, path],
  );
}
// Caller locks the user row: cooldown and issuance stay consistent across concurrent requests.
export async function queueAccountMail(
  tx: Queryable,
  user: Row,
  purpose: "verify" | "reset",
  origin: string,
) {
  const [count] = await tx.query(
    "SELECT count(*) n FROM mail_outbox WHERE user_id=$1 AND purpose=$2 AND created_at>now()-interval '1 hour'",
    [user.id, purpose],
  );
  const recent = await tx.query(
    "SELECT id FROM mail_outbox WHERE user_id=$1 AND purpose=$2 AND created_at>now()-interval '1 minute'",
    [user.id, purpose],
  );
  if (recent.length || Number(count.n) >= 5) return;
  if (purpose === "verify" && user.email_verified_at) return;
  const raw = randomBytes(32).toString("base64url");
  await tx.query("DELETE FROM account_tokens WHERE user_id=$1 AND purpose=$2", [
    user.id,
    purpose,
  ]);
  // Superseded messages must not be delivered after a newer token has been issued.
  await tx.query(
    "UPDATE mail_outbox SET body='',sent_at=now() WHERE user_id=$1 AND purpose=$2 AND sent_at IS NULL",
    [user.id, purpose],
  );
  await tx.query(
    "INSERT INTO account_tokens(token_hash,user_id,purpose,expires_at) VALUES ($1,$2,$3,now()+($4 * interval '1 minute'))",
    [hashToken(raw), user.id, purpose, purpose === "reset" ? 30 : 1440],
  );
  const subject =
    purpose === "reset"
      ? "Восстановление доступа — Enduro.Zone"
      : "Подтвердите email — Enduro.Zone";
  const url = `${origin.replace(/\/$/, "")}/#${purpose}/${raw}`;
  const body = `${subject}\n\n${url}\n\nСсылка действует ${purpose === "reset" ? "30 минут" : "24 часа"} и используется один раз. Если вы не запрашивали письмо, проигнорируйте его. Не передавайте ссылку другим людям.`;
  await tx.query(
    "INSERT INTO mail_outbox(id,user_id,recipient,subject,body,purpose) VALUES ($1,$2,$3,$4,$5,$6)",
    [randomUUID(), user.id, user.email, subject, body, purpose],
  );
}
export const pilotOutputs: Record<string, [number, unknown]> = {
  "POST /api/auth/password/request": [202, output.message],
  "POST /api/auth/password/reset": [200, output.message],
  "POST /api/auth/email/request": [202, output.message],
  "POST /api/auth/email/verify": [200, output.message],
  "GET /api/me/notifications": [200, output.notifications],
};
export function pilotRoutes(
  app: FastifyInstance,
  db: Database,
  origin: string,
  guards: {
    requireAuth: (req: FastifyRequest) => { user: Row };
    requireWrite: (req: FastifyRequest) => { user: Row };
    HttpError: new (status: number, code: string, message: string) => Error;
  },
) {
  const { requireAuth, requireWrite, HttpError } = guards;
  const auth = { security: [{ cookieSession: [] }] };
  const config = { rateLimit: { max: 10, timeWindow: "1 minute" } };
  const accepted = {
    message:
      "Если запрос применим к аккаунту, письмо будет отправлено. Проверьте входящие и папку «Спам».",
  };
  app.post<{ Body: { email: string } }>(
    "/api/auth/password/request",
    { schema: { body: input.email, tags: ["Account"] }, config },
    async (req, reply) => {
      await db.transaction(async (tx) => {
        const [u] = await tx.query(
          "SELECT * FROM users WHERE email=$1 FOR UPDATE",
          [req.body.email.trim().toLowerCase()],
        );
        if (u) await queueAccountMail(tx, u, "reset", origin);
      });
      return reply.code(202).send(accepted);
    },
  );
  app.post(
    "/api/auth/email/request",
    { schema: { ...auth, tags: ["Account"] }, config },
    async (req, reply) => {
      const a = requireWrite(req);
      await db.transaction(async (tx) => {
        const [u] = await tx.query(
          "SELECT * FROM users WHERE id=$1 FOR UPDATE",
          [a.user.id],
        );
        await queueAccountMail(tx, u, "verify", origin);
      });
      return reply.code(202).send(accepted);
    },
  );
  async function consume(
    token: string,
    purpose: "verify" | "reset",
    passwordHash?: string,
  ) {
    await db.transaction(async (tx) => {
      // Same user-first lock order as issuance; simultaneous consumption succeeds only once.
      const [u] = await tx.query(
        "SELECT u.id FROM users u JOIN account_tokens t ON t.user_id=u.id WHERE t.token_hash=$1 AND t.purpose=$2 FOR UPDATE OF u",
        [hashToken(token), purpose],
      );
      if (!u)
        throw new HttpError(
          400,
          "TOKEN_INVALID",
          "Ссылка недействительна или истекла. Запросите новую.",
        );
      const [t] = await tx.query(
        "DELETE FROM account_tokens WHERE token_hash=$1 AND purpose=$2 AND expires_at>now() RETURNING user_id",
        [hashToken(token), purpose],
      );
      if (!t)
        throw new HttpError(
          400,
          "TOKEN_INVALID",
          "Ссылка недействительна или истекла. Запросите новую.",
        );
      if (purpose === "verify")
        await tx.query("UPDATE users SET email_verified_at=now() WHERE id=$1", [
          u.id,
        ]);
      else {
        await tx.query("UPDATE users SET password_hash=$2 WHERE id=$1", [
          u.id,
          passwordHash,
        ]);
        await tx.query("DELETE FROM sessions WHERE user_id=$1", [u.id]);
        await tx.query(
          "DELETE FROM account_tokens WHERE user_id=$1 AND purpose='reset'",
          [u.id],
        );
      }
      await tx.query(
        "UPDATE mail_outbox SET body='',sent_at=COALESCE(sent_at,now()) WHERE user_id=$1 AND purpose=$2",
        [u.id, purpose],
      );
    });
  }
  app.post<{ Body: { token: string } }>(
    "/api/auth/email/verify",
    { schema: { body: input.token, tags: ["Account"] }, config },
    async (req) => {
      await consume(req.body.token, "verify");
      return { message: "Email подтверждён. Можно вернуться в аккаунт." };
    },
  );
  app.post<{ Body: { token: string; password: string } }>(
    "/api/auth/password/reset",
    { schema: { body: input.reset, tags: ["Account"] }, config },
    async (req) => {
      await consume(
        req.body.token,
        "reset",
        await hashPassword(req.body.password),
      );
      return {
        message:
          "Пароль обновлён. Все прежние сеансы завершены. Войдите с новым паролем.",
      };
    },
  );
  app.get<{ Querystring: { offset?: number; limit?: number } }>(
    "/api/me/notifications",
    { schema: { ...auth, querystring: input.page, tags: ["Notifications"] } },
    async (req) => {
      const id = requireAuth(req).user.id,
        offset = req.query.offset ?? 0,
        limit = req.query.limit ?? 20;
      const rows = await db.query(
        "SELECT id,message,path,created_at,read_at FROM notifications WHERE user_id=$1 ORDER BY created_at DESC,id DESC LIMIT $2 OFFSET $3",
        [id, limit + 1, offset],
      );
      const [n] = await db.query(
        "SELECT count(*) n FROM notifications WHERE user_id=$1 AND read_at IS NULL",
        [id],
      );
      return {
        items: rows.slice(0, limit).map((r) => ({
          id: r.id,
          message: r.message,
          path: r.path,
          createdAt: new Date(r.created_at).toISOString(),
          readAt: r.read_at ? new Date(r.read_at).toISOString() : null,
        })),
        nextOffset: rows.length > limit ? offset + limit : null,
        unreadCount: Number(n.n),
      };
    },
  );
  app.post<{ Params: { id: string } }>(
    "/api/me/notifications/:id/read",
    { schema: { ...auth, params: schemas.id, tags: ["Notifications"] } },
    async (req, reply) => {
      const id = requireWrite(req).user.id;
      const rows = await db.query(
        "UPDATE notifications SET read_at=COALESCE(read_at,now()) WHERE id=$1 AND user_id=$2 RETURNING id",
        [req.params.id, id],
      );
      if (!rows.length)
        throw new HttpError(404, "NOT_FOUND", "Уведомление недоступно.");
      return reply.code(204).send();
    },
  );
  // Only the caller's own notifications; already read ones keep their original time.
  app.post(
    "/api/me/notifications/read-all",
    { schema: { ...auth, tags: ["Notifications"] } },
    async (req, reply) => {
      const id = requireWrite(req).user.id;
      await db.query(
        "UPDATE notifications SET read_at=now() WHERE user_id=$1 AND read_at IS NULL",
        [id],
      );
      return reply.code(204).send();
    },
  );
}
