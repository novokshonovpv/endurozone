import type { FastifyInstance, FastifyRequest } from "fastify";
import {
  blockLimit,
  blockResponses,
  blockSchemas,
  responses,
  schemas,
  type BlockState,
} from "@enduro/contracts";
import type { Database, Queryable, Row } from "./database.ts";
import { profileOf } from "./auth.ts";
// True when either user blocked the other; arguments are SQL expressions.
// A guest viewer passes NULL, which never matches, so guests see everything public.
export const blockedBetween = (a: string, b: string) =>
  `EXISTS(SELECT 1 FROM blocks bl WHERE (bl.blocker_id=${a} AND bl.blocked_id=${b}) OR (bl.blocker_id=${b} AND bl.blocked_id=${a}))`;
export async function isBlockedBetween(
  q: Queryable,
  a: string | null | undefined,
  b: string,
) {
  if (!a || a === b) return false;
  const [r] = await q.query(
    `SELECT ${blockedBetween("$1::uuid", "$2::uuid")} AS blocked`,
    [a, b],
  );
  return Boolean(r.blocked);
}
export function blockRoutes(
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
  const tags = ["Blocks"],
    security = [{ cookieSession: [] }];
  const errors = {
    400: responses.error,
    401: responses.error,
    403: responses.error,
    404: responses.error,
    409: responses.error,
    429: responses.error,
  };
  const config = { rateLimit: { max: 30, timeWindow: "1 minute" } };
  async function userByHandle(q: Queryable, handle: string) {
    const [u] = await q.query("SELECT id FROM users WHERE handle=$1", [handle]);
    if (!u) throw notFound();
    return u.id as string;
  }
  async function state(q: Queryable, me: string, target: string) {
    const [r] = await q.query(
      "SELECT 1 FROM blocks WHERE blocker_id=$1 AND blocked_id=$2",
      [me, target],
    );
    return { blocked: Boolean(r) } satisfies BlockState;
  }
  app.get<{ Querystring: { limit?: number; offset?: number } }>(
    "/api/me/blocks",
    {
      schema: {
        tags,
        security,
        querystring: blockSchemas.page,
        response: { 200: blockResponses.riders, ...errors },
      },
    },
    async (req) => {
      const me = requireAuth(req).user.id,
        { limit = 12, offset = 0 } = req.query;
      const rows = await db.query(
        "SELECT u.id,u.handle,u.display_name,u.city,u.level,u.bio,b.created_at FROM blocks b JOIN users u ON u.id=b.blocked_id WHERE b.blocker_id=$1 ORDER BY b.created_at DESC,u.id LIMIT $2 OFFSET $3",
        [me, limit + 1, offset],
      );
      return {
        items: rows.slice(0, limit).map((r) => ({
          ...profileOf(r),
          blockedAt: new Date(r.created_at).toISOString(),
        })),
        nextOffset: rows.length > limit ? offset + limit : null,
      };
    },
  );
  app.get<{ Params: { handle: string } }>(
    "/api/me/blocks/:handle",
    {
      schema: {
        tags,
        security,
        params: schemas.handle,
        response: { 200: blockResponses.state, ...errors },
      },
    },
    async (req) => {
      const me = requireAuth(req).user.id as string;
      return state(db, me, await userByHandle(db, req.params.handle));
    },
  );
  app.put<{ Params: { handle: string } }>(
    "/api/me/blocks/:handle",
    {
      config,
      schema: {
        tags,
        security,
        params: schemas.handle,
        response: { 200: blockResponses.state, ...errors },
      },
    },
    async (req) => {
      const me = requireWrite(req).user.id as string;
      return db.transaction(async (tx) => {
        const target = await userByHandle(tx, req.params.handle);
        if (target === me)
          throw new HttpError(
            400,
            "BLOCK_SELF",
            "Нельзя заблокировать собственный профиль.",
          );
        // Both rows in id order, as for follows: a mutual block at the same moment cannot deadlock.
        const locked = await tx.query(
          "SELECT id FROM users WHERE id=ANY($1::uuid[]) ORDER BY id FOR NO KEY UPDATE",
          [[me, target]],
        );
        if (locked.length < 2) throw notFound();
        const [added] = await tx.query(
          "INSERT INTO blocks(blocker_id,blocked_id) VALUES ($1,$2) ON CONFLICT DO NOTHING RETURNING created_at",
          [me, target],
        );
        if (!added) return { blocked: true };
        const [n] = await tx.query(
          "SELECT count(*) n FROM blocks WHERE blocker_id=$1",
          [me],
        );
        if (Number(n.n) > blockLimit)
          throw new HttpError(
            409,
            "BLOCK_LIMIT",
            `Можно заблокировать не более ${blockLimit} райдеров.`,
          );
        // No follows in either direction, and no shared rides of each other.
        // The blocked person is not notified.
        await tx.query(
          "DELETE FROM follows WHERE (follower_id=$1 AND followee_id=$2) OR (follower_id=$2 AND followee_id=$1)",
          [me, target],
        );
        await tx.query(
          "UPDATE ride_members m SET status='declined' FROM rides r WHERE r.id=m.ride_id AND r.organizer_id=$1 AND m.user_id=$2 AND m.status IN ('pending','accepted')",
          [me, target],
        );
        await tx.query(
          "UPDATE ride_members m SET status='left' FROM rides r WHERE r.id=m.ride_id AND r.organizer_id=$2 AND m.user_id=$1 AND m.status IN ('pending','accepted')",
          [me, target],
        );
        return { blocked: true };
      });
    },
  );
  app.delete<{ Params: { handle: string } }>(
    "/api/me/blocks/:handle",
    {
      config,
      schema: {
        tags,
        security,
        params: schemas.handle,
        response: { 200: blockResponses.state, ...errors },
      },
    },
    async (req) => {
      const me = requireWrite(req).user.id as string;
      const target = await userByHandle(db, req.params.handle);
      await db.query(
        "DELETE FROM blocks WHERE blocker_id=$1 AND blocked_id=$2",
        [me, target],
      );
      return state(db, me, target);
    },
  );
}
