import type { FastifyInstance, FastifyRequest } from "fastify";
import {
  followSchemas,
  followResponses,
  followLimit,
  favoriteLimit,
  responses,
  schemas,
  type FollowSummary,
  type Page,
  type Post,
} from "@enduro/contracts";
import type { Database, Queryable, Row } from "./database.ts";
import { profileOf } from "./auth.ts";
import { notify } from "./pilot.ts";
type Paging = { limit?: number; offset?: number };
const visible = "p.visibility='public' AND NOT p.hidden";
// The owner keeps access to own private or hidden posts, as on the post page.
const readable = `((${visible}) OR p.author_id=$1)`;
export function followRoutes(
  app: FastifyInstance,
  db: Database,
  guards: {
    requireAuth: (req: FastifyRequest) => { user: Row };
    requireWrite: (req: FastifyRequest) => { user: Row };
    listPosts: (
      where: string,
      params: unknown[],
      limit?: number,
      offset?: number,
      shape?: { join?: string; order?: string },
    ) => Promise<Page<Post>>;
    notFound: () => Error;
    HttpError: new (status: number, code: string, message: string) => Error;
  },
) {
  const { requireAuth, requireWrite, listPosts, notFound, HttpError } = guards;
  const tags = ["Follows"];
  const security = [{ cookieSession: [] }];
  const errors = {
    400: responses.error,
    401: responses.error,
    403: responses.error,
    404: responses.error,
    409: responses.error,
    429: responses.error,
  };
  const config = { rateLimit: { max: 60, timeWindow: "1 minute" } };
  async function summary(
    q: Queryable,
    userId: string,
    viewerId: string | null,
  ): Promise<FollowSummary> {
    const [r] = await q.query(
      "SELECT (SELECT count(*) FROM follows WHERE followee_id=$1) followers,(SELECT count(*) FROM follows WHERE follower_id=$1) following,EXISTS(SELECT 1 FROM follows WHERE follower_id=$2 AND followee_id=$1) viewer",
      [userId, viewerId],
    );
    return {
      followerCount: Number(r.followers),
      followingCount: Number(r.following),
      viewerFollows: Boolean(r.viewer),
    };
  }
  async function userByHandle(q: Queryable, handle: string) {
    const [u] = await q.query("SELECT id FROM users WHERE handle=$1", [handle]);
    if (!u) throw notFound();
    return u.id as string;
  }
  // Both rows in id order: concurrent mutual follows cannot deadlock.
  async function lockUsers(q: Queryable, ids: string[]) {
    return q.query(
      "SELECT id FROM users WHERE id=ANY($1::uuid[]) ORDER BY id FOR NO KEY UPDATE",
      [ids],
    );
  }
  app.get<{ Params: { handle: string } }>(
    "/api/profiles/:handle/follow-summary",
    {
      schema: {
        tags,
        params: schemas.handle,
        response: { 200: followResponses.summary, ...errors },
      },
    },
    async (req) =>
      summary(
        db,
        await userByHandle(db, req.params.handle),
        req.authContext?.user.id ?? null,
      ),
  );
  app.put<{ Params: { handle: string } }>(
    "/api/me/following/:handle",
    {
      config,
      schema: {
        tags,
        security,
        params: schemas.handle,
        response: { 200: followResponses.summary, ...errors },
      },
    },
    async (req) => {
      const me = requireWrite(req).user.id as string;
      return db.transaction(async (tx) => {
        const target = await userByHandle(tx, req.params.handle);
        if (target === me)
          throw new HttpError(
            400,
            "FOLLOW_SELF",
            "Нельзя подписаться на собственный профиль.",
          );
        if ((await lockUsers(tx, [me, target])).length < 2) throw notFound();
        const [added] = await tx.query(
          "INSERT INTO follows(follower_id,followee_id) VALUES ($1,$2) ON CONFLICT DO NOTHING RETURNING created_at",
          [me, target],
        );
        if (added) {
          const [n] = await tx.query(
            "SELECT count(*) n FROM follows WHERE follower_id=$1",
            [me],
          );
          if (Number(n.n) > followLimit)
            throw new HttpError(
              409,
              "FOLLOW_LIMIT",
              `Можно подписаться не более чем на ${followLimit} райдеров. Отпишитесь от кого-нибудь.`,
            );
          // One unread notice at a time: repeated follow/unfollow cannot flood the inbox.
          const [unread] = await tx.query(
            "SELECT 1 FROM notifications WHERE user_id=$1 AND path='following' AND read_at IS NULL",
            [target],
          );
          if (!unread)
            await notify(tx, target, "У вас новый подписчик", "following");
        }
        return summary(tx, target, me);
      });
    },
  );
  app.delete<{ Params: { handle: string } }>(
    "/api/me/following/:handle",
    {
      config,
      schema: {
        tags,
        security,
        params: schemas.handle,
        response: { 200: followResponses.summary, ...errors },
      },
    },
    async (req) => {
      const me = requireWrite(req).user.id as string;
      const target = await userByHandle(db, req.params.handle);
      await db.query(
        "DELETE FROM follows WHERE follower_id=$1 AND followee_id=$2",
        [me, target],
      );
      return summary(db, target, me);
    },
  );
  for (const [direction, mine, theirs] of [
    ["following", "follower_id", "followee_id"],
    ["followers", "followee_id", "follower_id"],
  ] as const)
    app.get<{ Querystring: Paging }>(
      `/api/me/${direction}`,
      {
        schema: {
          tags,
          security,
          querystring: followSchemas.page,
          response: { 200: followResponses.riders, ...errors },
        },
      },
      async (req) => {
        const me = requireAuth(req).user.id,
          { limit = 12, offset = 0 } = req.query;
        const rows = await db.query(
          `SELECT u.id,u.handle,u.display_name,u.city,u.level,u.bio,f.created_at FROM follows f JOIN users u ON u.id=f.${theirs} WHERE f.${mine}=$1 ORDER BY f.created_at DESC,u.id LIMIT $2 OFFSET $3`,
          [me, limit + 1, offset],
        );
        return {
          items: rows.slice(0, limit).map((r) => ({
            ...profileOf(r),
            followedAt: new Date(r.created_at).toISOString(),
          })),
          nextOffset: rows.length > limit ? offset + limit : null,
        };
      },
    );
  app.get<{ Querystring: Paging & { city?: string; kind?: string } }>(
    "/api/me/feed",
    {
      schema: {
        tags,
        security,
        querystring: schemas.page,
        response: { 200: responses.posts, ...errors },
      },
    },
    async (req) => {
      const params: unknown[] = [requireAuth(req).user.id];
      const parts = [
        visible,
        "p.author_id IN (SELECT followee_id FROM follows WHERE follower_id=$1)",
      ];
      if (req.query.city) {
        params.push(req.query.city);
        parts.push(`u.city=$${params.length}`);
      }
      if (req.query.kind) {
        params.push(req.query.kind);
        parts.push(`p.kind=$${params.length}`);
      }
      return listPosts(
        parts.join(" AND "),
        params,
        req.query.limit,
        req.query.offset,
      );
    },
  );
  app.get<{ Querystring: Paging }>(
    "/api/me/favorites",
    {
      schema: {
        tags,
        security,
        querystring: followSchemas.page,
        response: { 200: responses.posts, ...errors },
      },
    },
    async (req) =>
      // Access is rechecked on every read: a saved post that became private or hidden disappears.
      listPosts(
        readable,
        [requireAuth(req).user.id],
        req.query.limit,
        req.query.offset,
        {
          join: "JOIN favorites f ON f.post_id=p.id AND f.user_id=$1",
          order: "f.created_at DESC,p.id DESC",
        },
      ),
  );
  app.get<{ Params: { id: string } }>(
    "/api/me/favorites/:id",
    {
      schema: {
        tags,
        security,
        params: schemas.id,
        response: { 200: followResponses.favorite, ...errors },
      },
    },
    async (req) => {
      const [r] = await db.query(
        `SELECT 1 FROM favorites f JOIN posts p ON p.id=f.post_id WHERE f.user_id=$1 AND f.post_id=$2 AND ${readable}`,
        [requireAuth(req).user.id, req.params.id],
      );
      return { favorited: Boolean(r) };
    },
  );
  app.put<{ Params: { id: string } }>(
    "/api/me/favorites/:id",
    { config, schema: { tags, security, params: schemas.id } },
    async (req, reply) => {
      const me = requireWrite(req).user.id as string;
      await db.transaction(async (tx) => {
        await lockUsers(tx, [me]);
        // Access check and insertion share one statement, like comments.
        const [added] = await tx.query(
          `INSERT INTO favorites(user_id,post_id) SELECT $1,p.id FROM posts p WHERE p.id=$2 AND ${readable} ON CONFLICT DO NOTHING RETURNING post_id`,
          [me, req.params.id],
        );
        if (!added) {
          const [kept] = await tx.query(
            `SELECT 1 FROM favorites f JOIN posts p ON p.id=f.post_id WHERE f.user_id=$1 AND f.post_id=$2 AND ${readable}`,
            [me, req.params.id],
          );
          if (!kept) throw notFound();
          return;
        }
        const [n] = await tx.query(
          "SELECT count(*) n FROM favorites WHERE user_id=$1",
          [me],
        );
        if (Number(n.n) > favoriteLimit)
          throw new HttpError(
            409,
            "FAVORITE_LIMIT",
            `В избранном можно хранить не более ${favoriteLimit} записей. Уберите ненужные.`,
          );
      });
      return reply.code(204).send();
    },
  );
  app.delete<{ Params: { id: string } }>(
    "/api/me/favorites/:id",
    { config, schema: { tags, security, params: schemas.id } },
    async (req, reply) => {
      // Always allowed, even after the post became unavailable.
      await db.query("DELETE FROM favorites WHERE user_id=$1 AND post_id=$2", [
        requireWrite(req).user.id,
        req.params.id,
      ]);
      return reply.code(204).send();
    },
  );
}
