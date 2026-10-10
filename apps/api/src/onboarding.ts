import type { FastifyInstance, FastifyRequest } from "fastify";
import {
  onboardingSchemas,
  onboardingResponses,
  onboardingSteps,
  responses,
  type ActivationSummary,
  type Onboarding,
  type OnboardingStepId,
} from "@enduro/contracts";
import type { Database, Row } from "./database.ts";
// Progress is derived from what the rider has actually saved; page views and clicks are not tracked.
const flags = `
  EXISTS(SELECT 1 FROM bikes b WHERE b.owner_id=u.id) AS bike,
  EXISTS(SELECT 1 FROM posts p WHERE p.author_id=u.id) AS post,
  EXISTS(SELECT 1 FROM follows f WHERE f.follower_id=u.id) AS follow,
  (EXISTS(SELECT 1 FROM comments c JOIN posts p ON p.id=c.post_id WHERE c.author_id=u.id AND p.author_id<>u.id)
    OR EXISTS(SELECT 1 FROM favorites f JOIN posts p ON p.id=f.post_id WHERE f.user_id=u.id AND p.author_id<>u.id)
    OR EXISTS(SELECT 1 FROM ride_members m WHERE m.user_id=u.id)
    OR EXISTS(SELECT 1 FROM rides r WHERE r.organizer_id=u.id)) AS social`;
// A useful action a week or more after registration counts as a return; visits alone do not.
const returned = `(
  EXISTS(SELECT 1 FROM bikes x WHERE x.owner_id=u.id AND x.created_at>=u.created_at+interval '7 days')
  OR EXISTS(SELECT 1 FROM posts x WHERE x.author_id=u.id AND x.created_at>=u.created_at+interval '7 days')
  OR EXISTS(SELECT 1 FROM comments x WHERE x.author_id=u.id AND x.created_at>=u.created_at+interval '7 days')
  OR EXISTS(SELECT 1 FROM favorites x WHERE x.user_id=u.id AND x.created_at>=u.created_at+interval '7 days')
  OR EXISTS(SELECT 1 FROM follows x WHERE x.follower_id=u.id AND x.created_at>=u.created_at+interval '7 days')
  OR EXISTS(SELECT 1 FROM ride_members x WHERE x.user_id=u.id AND x.created_at>=u.created_at+interval '7 days')
  OR EXISTS(SELECT 1 FROM ride_messages x WHERE x.author_id=u.id AND x.created_at>=u.created_at+interval '7 days'))`;
// Synthetic and test accounts use the reserved example.test domain throughout the project.
const synthetic = "u.email LIKE '%@example.test'";
export function onboardingRoutes(
  app: FastifyInstance,
  db: Database,
  guards: {
    requireAuth: (req: FastifyRequest) => { user: Row };
    requireWrite: (req: FastifyRequest) => { user: Row };
    HttpError: new (status: number, code: string, message: string) => Error;
  },
) {
  const { requireAuth, requireWrite, HttpError } = guards;
  const security = [{ cookieSession: [] }];
  const errors = {
    400: responses.error,
    401: responses.error,
    403: responses.error,
  };
  async function progress(id: string): Promise<Onboarding> {
    const [r] = await db.query(
      `SELECT ${flags}, u.onboarding_dismissed_at FROM users u WHERE u.id=$1`,
      [id],
    );
    const steps = (Object.keys(onboardingSteps) as OnboardingStepId[]).map(
      (step) => ({ id: step, done: Boolean(r[step]) }),
    );
    return {
      steps,
      complete: steps.every((s) => s.done),
      dismissed: Boolean(r.onboarding_dismissed_at),
    };
  }
  app.get(
    "/api/me/onboarding",
    {
      schema: {
        tags: ["Onboarding"],
        security,
        response: { 200: onboardingResponses.onboarding, ...errors },
      },
    },
    (req) => progress(requireAuth(req).user.id),
  );
  // Hiding the checklist is a display preference; it does not require a verified email.
  app.put<{ Body: { dismissed: boolean } }>(
    "/api/me/onboarding",
    {
      schema: {
        tags: ["Onboarding"],
        security,
        body: onboardingSchemas.update,
        response: { 200: onboardingResponses.onboarding, ...errors },
      },
    },
    async (req) => {
      const id = requireWrite(req).user.id;
      await db.query(
        "UPDATE users SET onboarding_dismissed_at=CASE WHEN $2 THEN COALESCE(onboarding_dismissed_at,now()) END WHERE id=$1",
        [id, req.body.dismissed],
      );
      return progress(id);
    },
  );
  app.get(
    "/api/moderation/activation",
    {
      schema: {
        tags: ["Moderation"],
        security,
        response: { 200: onboardingResponses.activation, ...errors },
      },
    },
    async (req): Promise<ActivationSummary> => {
      if (requireAuth(req).user.role !== "moderator")
        throw new HttpError(
          403,
          "MODERATOR_REQUIRED",
          "Этот раздел доступен модератору.",
        );
      // Aggregate numbers only: no per-rider list leaves the database.
      const [r] = await db.query(
        `WITH p AS (
           SELECT ${flags},
             u.created_at<=now()-interval '7 days' AS eligible,
             ${returned} AS returned
           FROM users u WHERE u.role<>'moderator' AND NOT (${synthetic})
         )
         SELECT count(*) participants,
           count(*) FILTER (WHERE bike) bike,
           count(*) FILTER (WHERE post) post,
           count(*) FILTER (WHERE follow) follow,
           count(*) FILTER (WHERE social) social,
           count(*) FILTER (WHERE bike AND post AND follow AND social) activated,
           count(*) FILTER (WHERE eligible) eligible,
           count(*) FILTER (WHERE eligible AND returned) returned,
           (SELECT count(*) FROM users u WHERE u.role='moderator') moderators,
           (SELECT count(*) FROM users u WHERE u.role<>'moderator' AND ${synthetic}) synthetic
         FROM p`,
      );
      return {
        participants: Number(r.participants),
        bike: Number(r.bike),
        post: Number(r.post),
        follow: Number(r.follow),
        social: Number(r.social),
        activated: Number(r.activated),
        eligibleForReturn: Number(r.eligible),
        returned: Number(r.returned),
        excludedModerators: Number(r.moderators),
        excludedSynthetic: Number(r.synthetic),
      };
    },
  );
}
