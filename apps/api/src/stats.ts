import type { FastifyInstance, FastifyRequest } from "fastify";
import {
  responses,
  schemas,
  statsResponses,
  type MyStats,
  type RiderStats,
} from "@enduro/contracts";
import type { Database, Queryable, Row } from "./database.ts";
// Rider statistics: public contributions for the profile page, plus the owner's own marks
// «Был здесь» and joined rides. Counts only what the public lists would show.
async function publicCounts(q: Queryable, userId: string): Promise<RiderStats> {
  const [r] = await q.query(
    `SELECT
      (SELECT count(*) FROM locations WHERE author_id=$1 AND status='published') AS places,
      (SELECT count(*) FROM tracks WHERE author_id=$1 AND status='published') AS tracks,
      (SELECT count(*) FROM rides r JOIN tracks t ON t.id=r.track_id WHERE r.organizer_id=$1 AND NOT r.hidden AND t.status='published') AS rides,
      (SELECT count(*) FROM posts WHERE author_id=$1 AND visibility='public' AND NOT hidden) AS posts`,
    [userId],
  );
  return {
    placesAdded: Number(r.places),
    tracksPublished: Number(r.tracks),
    ridesOrganized: Number(r.rides),
    postsPublic: Number(r.posts),
  };
}
export function statsRoutes(
  app: FastifyInstance,
  db: Database,
  guards: {
    requireAuth: (req: FastifyRequest) => { user: Row };
    notFound: () => Error;
  },
) {
  const { requireAuth, notFound } = guards;
  const tags = ["Riders"];
  const errors = { 401: responses.error, 404: responses.error };
  app.get<{ Params: { handle: string } }>(
    "/api/profiles/:handle/stats",
    {
      schema: {
        tags,
        params: schemas.handle,
        response: { 200: statsResponses.rider, ...errors },
      },
    },
    async (req) => {
      // Like the profile itself: someone who blocked the viewer looks absent to them.
      const [u] = await db.query(
        "SELECT u.id FROM users u WHERE u.handle=$1 AND NOT EXISTS(SELECT 1 FROM blocks b WHERE b.blocker_id=u.id AND b.blocked_id=$2::uuid)",
        [req.params.handle, req.authContext?.user.id ?? null],
      );
      if (!u) throw notFound();
      return publicCounts(db, u.id);
    },
  );
  app.get(
    "/api/me/stats",
    {
      schema: {
        tags,
        security: [{ cookieSession: [] }],
        response: { 200: statsResponses.mine, ...errors },
      },
    },
    async (req): Promise<MyStats> => {
      const me = requireAuth(req).user.id as string;
      const [r] = await db.query(
        `SELECT
          (SELECT count(*) FROM location_visits v JOIN locations l ON l.id=v.location_id WHERE v.user_id=$1 AND l.status='published') AS visits,
          (SELECT count(*) FROM ride_members m JOIN rides r ON r.id=m.ride_id WHERE m.user_id=$1 AND m.status='accepted' AND r.status<>'cancelled') AS joined`,
        [me],
      );
      const visited = await db.query(
        "SELECT l.id,l.title,l.city,l.kind,v.difficulty,v.created_at FROM location_visits v JOIN locations l ON l.id=v.location_id WHERE v.user_id=$1 AND l.status='published' ORDER BY v.created_at DESC,l.id LIMIT 100",
        [me],
      );
      return {
        ...(await publicCounts(db, me)),
        visits: Number(r.visits),
        ridesJoined: Number(r.joined),
        visited: visited.map((v) => ({
          id: v.id,
          title: v.title,
          city: v.city,
          kind: v.kind,
          difficulty: v.difficulty ?? null,
          markedAt: new Date(v.created_at).toISOString(),
        })),
      };
    },
  );
}
