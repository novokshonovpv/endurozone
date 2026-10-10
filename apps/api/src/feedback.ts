import type { FastifyInstance, FastifyRequest } from "fastify";
import { randomUUID } from "node:crypto";
import {
  feedbackSchemas,
  feedbackResponses,
  feedbackOpenLimit,
  responses,
  schemas,
  type Feedback,
  type FeedbackInput,
  type FeedbackStatus,
} from "@enduro/contracts";
import type { Database, Row } from "./database.ts";
import { profileOf } from "./auth.ts";
import { notify } from "./pilot.ts";
import { appVersion } from "./version.ts";
const feedbackOf = (r: Row): Feedback => ({
  id: r.id,
  kind: r.kind,
  body: r.body,
  section: r.section,
  viewport: r.viewport,
  userAgent: r.user_agent,
  appVersion: r.app_version,
  status: r.status,
  reply: r.reply,
  createdAt: new Date(r.created_at).toISOString(),
  updatedAt: new Date(r.updated_at).toISOString(),
});
export function feedbackRoutes(
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
  const tags = ["Feedback"],
    security = [{ cookieSession: [] }];
  const errors = {
    400: responses.error,
    401: responses.error,
    403: responses.error,
    404: responses.error,
    409: responses.error,
    429: responses.error,
  };
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
  // Not gated by email verification: a participant must be able to report a broken verification.
  app.post<{ Body: FeedbackInput }>(
    "/api/feedback",
    {
      config: { rateLimit: { max: 10, timeWindow: "1 minute" } },
      schema: {
        tags,
        security,
        body: feedbackSchemas.create,
        response: { 201: feedbackResponses.feedback, ...errors },
      },
    },
    async (req, reply) => {
      const me = requireWrite(req).user.id,
        b = req.body,
        body = b.body.trim();
      if (body.length < 5)
        throw new HttpError(
          400,
          "VALIDATION_ERROR",
          "Опишите, что произошло, хотя бы в нескольких словах.",
        );
      const agent = String(req.headers["user-agent"] ?? "").slice(0, 300);
      const [r] = await db.query(
        `INSERT INTO feedback(id,author_id,kind,body,section,viewport,user_agent,app_version) SELECT $1::uuid,$2::uuid,$3,$4,$5,$6,$7,$8 WHERE (SELECT count(*) FROM feedback WHERE author_id=$2::uuid AND status IN ('new','in_progress'))<$9 RETURNING *`,
        [
          randomUUID(),
          me,
          b.kind,
          body,
          b.section,
          b.viewport,
          agent,
          appVersion,
          feedbackOpenLimit,
        ],
      );
      if (!r)
        throw new HttpError(
          409,
          "FEEDBACK_LIMIT",
          `У вас уже ${feedbackOpenLimit} открытых отзывов. Дождитесь ответа по ним.`,
        );
      reply.code(201);
      return feedbackOf(r);
    },
  );
  app.get<{ Querystring: { limit?: number; offset?: number } }>(
    "/api/me/feedback",
    {
      schema: {
        tags,
        security,
        querystring: feedbackSchemas.page,
        response: { 200: feedbackResponses.mine, ...errors },
      },
    },
    async (req) => {
      const me = requireAuth(req).user.id,
        { limit = 20, offset = 0 } = req.query;
      const rows = await db.query(
        "SELECT * FROM feedback WHERE author_id=$1 ORDER BY created_at DESC,id DESC LIMIT $2 OFFSET $3",
        [me, limit + 1, offset],
      );
      return {
        items: rows.slice(0, limit).map(feedbackOf),
        nextOffset: rows.length > limit ? offset + limit : null,
      };
    },
  );
  app.get<{
    Querystring: { limit?: number; offset?: number; status?: FeedbackStatus };
  }>(
    "/api/moderation/feedback",
    {
      schema: {
        tags: ["Moderation"],
        security,
        querystring: feedbackSchemas.moderationPage,
        response: { 200: feedbackResponses.moderated, ...errors },
      },
    },
    async (req) => {
      moderator(req);
      const { limit = 20, offset = 0, status } = req.query;
      const rows = await db.query(
        `SELECT f.*,u.handle,u.display_name,u.city,u.level,u.bio FROM feedback f JOIN users u ON u.id=f.author_id WHERE ($1::text IS NULL OR f.status=$1) ORDER BY f.created_at DESC,f.id DESC LIMIT $2 OFFSET $3`,
        [status ?? null, limit + 1, offset],
      );
      return {
        items: rows.slice(0, limit).map((r) => ({
          ...feedbackOf(r),
          author: profileOf({ ...r, id: r.author_id }),
        })),
        nextOffset: rows.length > limit ? offset + limit : null,
      };
    },
  );
  app.post<{
    Params: { id: string };
    Body: { status: FeedbackStatus; reply: string };
  }>(
    "/api/moderation/feedback/:id",
    {
      schema: {
        tags: ["Moderation"],
        security,
        params: schemas.id,
        body: feedbackSchemas.decision,
        response: { 200: feedbackResponses.feedback, ...errors },
      },
    },
    async (req) => {
      moderator(req, true);
      const reply = req.body.reply.trim();
      return db.transaction(async (tx) => {
        const [old] = await tx.query(
          "SELECT status,reply FROM feedback WHERE id=$1 FOR UPDATE",
          [req.params.id],
        );
        if (!old) throw notFound();
        const [r] = await tx.query(
          "UPDATE feedback SET status=$2,reply=$3,updated_at=now() WHERE id=$1 RETURNING *",
          [req.params.id, req.body.status, reply],
        );
        // The author hears about a closing decision or a new answer, not every intermediate edit.
        const closed =
          old.status !== r.status &&
          (r.status === "resolved" || r.status === "wontfix");
        if (closed || (reply && reply !== old.reply))
          await notify(
            tx,
            r.author_id,
            "Команда ответила на ваш отзыв о сайте",
            "feedback",
          );
        return feedbackOf(r);
      });
    },
  );
}
