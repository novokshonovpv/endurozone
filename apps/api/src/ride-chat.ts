import type { FastifyInstance, FastifyRequest } from "fastify";
import { randomUUID } from "node:crypto";
import {
  rideChatSchemas,
  rideChatResponses,
  rideMessageLimit,
  responses,
  schemas,
  type RideChat,
  type RideMessage,
} from "@enduro/contracts";
import type { Database, Queryable, Row } from "./database.ts";
import { profileOf } from "./auth.ts";
// $2 is the reader. Same audience as the meeting point, except that the chat stays readable
// after the start and after cancellation; a ride hidden by moderation stays with its organizer.
const accepted =
  "EXISTS(SELECT 1 FROM ride_members m WHERE m.ride_id=r.id AND m.user_id=$2 AND m.status='accepted')";
const readable = `(r.organizer_id=$2 OR (NOT r.hidden AND t.status='published' AND ${accepted}))`;
const writable = `(r.status='open' AND NOT r.hidden AND t.status='published' AND (r.organizer_id=$2 OR ${accepted}))`;
const messageOf = (r: Row): RideMessage => ({
  id: r.id,
  author: profileOf({ ...r, id: r.author_id }),
  // Hidden text is withheld from everyone, including the organizer who hid it.
  body: r.hidden_by ? "" : r.body,
  hiddenBy: r.hidden_by ?? null,
  createdAt: new Date(r.created_at).toISOString(),
});
const messageSelect =
  "SELECT msg.id,msg.author_id,msg.body,msg.hidden_by,msg.created_at,u.handle,u.display_name,u.city,u.level,u.bio FROM ride_messages msg JOIN users u ON u.id=msg.author_id";
// Reports and audit entries about a removed message must not outlive it.
export async function forgetMessageReports(tx: Queryable, ids: string[]) {
  if (!ids.length) return;
  await tx.query(
    "DELETE FROM moderation_actions WHERE target_id IN (SELECT id FROM reports WHERE target_type='ride_message' AND target_id=ANY($1::uuid[]))",
    [ids],
  );
  await tx.query(
    "DELETE FROM reports WHERE target_type='ride_message' AND target_id=ANY($1::uuid[])",
    [ids],
  );
  await tx.query(
    "DELETE FROM moderation_actions WHERE target_type='ride_message' AND target_id=ANY($1::uuid[])",
    [ids],
  );
}
export function rideChatRoutes(
  app: FastifyInstance,
  db: Database,
  guards: {
    requireAuth: (req: FastifyRequest) => { user: Row };
    requireWrite: (req: FastifyRequest) => { user: Row };
    notFound: () => Error;
    HttpError: new (status: number, code: string, message: string) => Error;
  },
) {
  const { requireAuth, requireWrite, notFound, HttpError } = guards;
  const tags = ["Ride chat"],
    security = [{ cookieSession: [] }];
  const errors = {
    400: responses.error,
    401: responses.error,
    403: responses.error,
    404: responses.error,
    409: responses.error,
    429: responses.error,
  };
  app.get<{
    Params: { id: string };
    Querystring: { limit?: number; offset?: number };
  }>(
    "/api/rides/:id/messages",
    {
      schema: {
        tags,
        security,
        params: schemas.id,
        querystring: rideChatSchemas.page,
        response: { 200: rideChatResponses.chat, ...errors },
      },
    },
    async (req): Promise<RideChat> => {
      const me = requireAuth(req).user.id,
        { limit = 30, offset = 0 } = req.query;
      const [r] = await db.query(
        `SELECT r.organizer_id,${writable} AS can_write FROM rides r JOIN tracks t ON t.id=r.track_id WHERE r.id=$1 AND ${readable}`,
        [req.params.id, me],
      );
      if (!r) throw notFound();
      // Access is rechecked in the same statement that returns messages.
      const rows = await db.query(
        `${messageSelect} JOIN rides r ON r.id=msg.ride_id JOIN tracks t ON t.id=r.track_id WHERE msg.ride_id=$1 AND ${readable} ORDER BY msg.created_at DESC,msg.id DESC LIMIT $3 OFFSET $4`,
        [req.params.id, me, limit + 1, offset],
      );
      return {
        items: rows.slice(0, limit).map(messageOf),
        nextOffset: rows.length > limit ? offset + limit : null,
        canWrite: Boolean(r.can_write),
        canModerate: r.organizer_id === me,
      };
    },
  );
  app.post<{ Params: { id: string }; Body: { body: string } }>(
    "/api/rides/:id/messages",
    {
      config: { rateLimit: { max: 30, timeWindow: "1 minute" } },
      schema: {
        tags,
        security,
        params: schemas.id,
        body: rideChatSchemas.message,
        response: { 201: rideChatResponses.message, ...errors },
      },
    },
    async (req, reply) => {
      const me = requireWrite(req).user.id,
        body = req.body.body.trim();
      if (!body)
        throw new HttpError(400, "VALIDATION_ERROR", "Напишите сообщение.");
      // Access, open state and the per-ride cap are checked by the inserting statement itself.
      const [created] = await db.query(
        `INSERT INTO ride_messages(id,ride_id,author_id,body) SELECT $3,r.id,$2,$4 FROM rides r JOIN tracks t ON t.id=r.track_id WHERE r.id=$1 AND ${writable} AND (SELECT count(*) FROM ride_messages WHERE ride_id=r.id)<$5 RETURNING id`,
        [req.params.id, me, randomUUID(), body, rideMessageLimit],
      );
      if (!created) {
        const [r] = await db.query(
          `SELECT ${writable} AS can_write FROM rides r JOIN tracks t ON t.id=r.track_id WHERE r.id=$1 AND ${readable}`,
          [req.params.id, me],
        );
        if (!r) throw notFound();
        throw r.can_write
          ? new HttpError(
              409,
              "CHAT_FULL",
              `В чате уже ${rideMessageLimit} сообщений. Новые не принимаются.`,
            )
          : new HttpError(
              409,
              "CHAT_READ_ONLY",
              "Покатушка отменена или скрыта: чат доступен только для чтения.",
            );
      }
      const [row] = await db.query(`${messageSelect} WHERE msg.id=$1`, [
        created.id,
      ]);
      reply.code(201);
      return messageOf(row);
    },
  );
  app.delete<{ Params: { id: string } }>(
    "/api/ride-messages/:id",
    { schema: { tags, security, params: schemas.id } },
    async (req, reply) => {
      const me = requireWrite(req).user.id;
      await db.transaction(async (tx) => {
        const [r] = await tx.query(
          "DELETE FROM ride_messages WHERE id=$1 AND author_id=$2 RETURNING id",
          [req.params.id, me],
        );
        if (!r) throw notFound();
        await forgetMessageReports(tx, [r.id]);
      });
      return reply.code(204).send();
    },
  );
  app.post<{ Params: { id: string } }>(
    "/api/ride-messages/:id/hide",
    { schema: { tags, security, params: schemas.id } },
    async (req, reply) => {
      const me = requireWrite(req).user.id;
      const [r] = await db.query(
        "UPDATE ride_messages msg SET hidden_by=COALESCE(msg.hidden_by,'organizer') FROM rides r WHERE msg.id=$1 AND r.id=msg.ride_id AND r.organizer_id=$2 RETURNING msg.id",
        [req.params.id, me],
      );
      if (!r) throw notFound();
      return reply.code(204).send();
    },
  );
  app.get<{ Params: { id: string } }>(
    "/api/moderation/ride-messages/:id",
    {
      schema: {
        tags: ["Moderation"],
        security,
        params: schemas.id,
        response: { 200: rideChatResponses.reported, ...errors },
      },
    },
    async (req) => {
      const auth = requireAuth(req);
      if (auth.user.role !== "moderator")
        throw new HttpError(
          403,
          "MODERATOR_REQUIRED",
          "Этот раздел доступен модератору.",
        );
      // Only reported messages: moderators cannot browse ride chats or meeting details.
      const [r] = await db.query(
        `${messageSelect} WHERE msg.id=$1 AND EXISTS(SELECT 1 FROM reports p WHERE p.target_type='ride_message' AND p.target_id=msg.id)`,
        [req.params.id],
      );
      if (!r) throw notFound();
      return { ...messageOf(r), body: r.body };
    },
  );
}
