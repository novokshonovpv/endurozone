import type { FastifyInstance } from "fastify";
import {
  riderSchemas,
  riderResponses,
  responses,
  schemas,
  type Page,
  type Post,
} from "@enduro/contracts";
import type { Database } from "./database.ts";
import { profileOf } from "./auth.ts";
type Paging = { limit?: number; offset?: number };
const visible = "p.visibility='public' AND NOT p.hidden";
const contains = (value: string) =>
  `%${value.trim().replace(/[!%_]/g, (x) => "!" + x)}%`;
export function riderRoutes(
  app: FastifyInstance,
  db: Database,
  guards: {
    notFound: () => Error;
    listPosts: (
      where: string,
      params: unknown[],
      limit?: number,
      offset?: number,
    ) => Promise<Page<Post>>;
  },
) {
  const tags = ["Riders"];
  async function owner(handle: string) {
    const [u] = await db.query("SELECT id FROM users WHERE handle=$1", [
      handle,
    ]);
    if (!u) throw guards.notFound();
    return u;
  }
  app.get<{ Querystring: Paging & { q?: string; city?: string } }>(
    "/api/riders",
    {
      schema: {
        tags,
        querystring: riderSchemas.search,
        response: { 200: riderResponses.riders, 400: responses.error },
      },
    },
    async (req) => {
      const { limit = 12, offset = 0, q = "", city = "" } = req.query;
      const rows = await db.query(
        `SELECT u.id,u.handle,u.display_name,u.city,u.level,u.bio,count(p.id) AS public_post_count,count(DISTINCT p.bike_id) AS public_bike_count FROM users u JOIN posts p ON p.author_id=u.id WHERE ${visible} AND (u.display_name ILIKE $1 ESCAPE '!' OR u.handle ILIKE $1 ESCAPE '!') AND u.city ILIKE $2 ESCAPE '!' GROUP BY u.id ORDER BY lower(u.display_name),u.id LIMIT $3 OFFSET $4`,
        [contains(q), contains(city), limit + 1, offset],
      );
      return {
        items: rows
          .slice(0, limit)
          .map((r) => ({
            ...profileOf(r),
            publicPostCount: Number(r.public_post_count),
            publicBikeCount: Number(r.public_bike_count),
          })),
        nextOffset: rows.length > limit ? offset + limit : null,
      };
    },
  );
  app.get<{ Params: { handle: string }; Querystring: Paging }>(
    "/api/profiles/:handle/bikes",
    {
      schema: {
        tags,
        params: schemas.handle,
        querystring: riderSchemas.bikes,
        response: {
          200: riderResponses.bikes,
          400: responses.error,
          404: responses.error,
        },
      },
    },
    async (req) => {
      const u = await owner(req.params.handle),
        { limit = 12, offset = 0 } = req.query;
      const rows = await db.query(
        `SELECT b.id,b.make,b.model,b.year,b.modification,count(p.id) AS public_post_count FROM bikes b JOIN posts p ON p.bike_id=b.id AND p.author_id=b.owner_id WHERE b.owner_id=$1 AND ${visible} GROUP BY b.id ORDER BY b.created_at,b.id LIMIT $2 OFFSET $3`,
        [u.id, limit + 1, offset],
      );
      return {
        items: rows
          .slice(0, limit)
          .map((r) => ({
            id: r.id,
            make: r.make,
            model: r.model,
            year: r.year,
            modification: r.modification,
            publicPostCount: Number(r.public_post_count),
          })),
        nextOffset: rows.length > limit ? offset + limit : null,
      };
    },
  );
  app.get<{
    Params: { handle: string };
    Querystring: Paging & { bikeId?: string; kind?: string };
  }>(
    "/api/profiles/:handle/posts",
    {
      schema: {
        tags,
        params: schemas.handle,
        querystring: riderSchemas.posts,
        response: {
          200: responses.posts,
          400: responses.error,
          404: responses.error,
        },
      },
    },
    async (req) => {
      const u = await owner(req.params.handle),
        params: unknown[] = [u.id],
        parts = ["p.author_id=$1", visible];
      if (req.query.bikeId) {
        const [b] = await db.query(
          `SELECT b.id FROM bikes b WHERE b.id=$1 AND b.owner_id=$2 AND EXISTS(SELECT 1 FROM posts p WHERE p.bike_id=b.id AND p.author_id=$2 AND ${visible})`,
          [req.query.bikeId, u.id],
        );
        if (!b) throw guards.notFound();
        params.push(b.id);
        parts.push(`p.bike_id=$${params.length}`);
      }
      if (req.query.kind) {
        params.push(req.query.kind);
        parts.push(`p.kind=$${params.length}`);
      }
      return guards.listPosts(
        parts.join(" AND "),
        params,
        req.query.limit,
        req.query.offset,
      );
    },
  );
}
