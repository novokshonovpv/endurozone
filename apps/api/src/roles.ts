import type { FastifyInstance, FastifyRequest } from "fastify";
import { randomUUID } from "node:crypto";
import {
  roleSchemas,
  roleResponses,
  responses,
  type RoleChange,
} from "@enduro/contracts";
import type { Database, Row } from "./database.ts";
import { profileOf } from "./auth.ts";
import { notify } from "./pilot.ts";
// Moderators manage moderator roles on the site; the first one is still granted by the server CLI.
export function roleRoutes(
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
  const tags = ["Moderation"],
    security = [{ cookieSession: [] }];
  const errors = {
    400: responses.error,
    401: responses.error,
    403: responses.error,
    404: responses.error,
    409: responses.error,
  };
  const moderator = (auth: { user: Row }) => {
    if (auth.user.role !== "moderator")
      throw new HttpError(
        403,
        "MODERATOR_REQUIRED",
        "Этот раздел доступен модератору.",
      );
    return auth;
  };
  app.get(
    "/api/moderation/moderators",
    {
      schema: {
        tags,
        security,
        response: { 200: roleResponses.moderators, ...errors },
      },
    },
    async (req) => {
      moderator(requireAuth(req));
      const rows = await db.query(
        "SELECT id,handle,display_name,city,level,bio FROM users WHERE role='moderator' ORDER BY lower(display_name),id",
      );
      return { items: rows.map(profileOf) };
    },
  );
  app.post<{ Body: RoleChange }>(
    "/api/moderation/roles",
    {
      config: { rateLimit: { max: 20, timeWindow: "1 minute" } },
      schema: {
        tags,
        security,
        body: roleSchemas.change,
        response: { 200: roleResponses.changed, ...errors },
      },
    },
    async (req) => {
      const actor = moderator(requireWrite(req)).user;
      const reason = req.body.reason.trim();
      if (reason.length < 10)
        throw new HttpError(
          400,
          "VALIDATION_ERROR",
          "Укажите причину от 10 символов.",
        );
      return db.transaction(async (tx) => {
        // Lock every moderator first, then the target, in one order: two moderators
        // revoking each other at once cannot leave the site without moderators.
        const mods = await tx.query(
          "SELECT id FROM users WHERE role='moderator' ORDER BY id FOR UPDATE",
        );
        if (!mods.some((m) => m.id === actor.id))
          throw new HttpError(
            403,
            "MODERATOR_REQUIRED",
            "Этот раздел доступен модератору.",
          );
        const [target] = await tx.query(
          "SELECT id,handle,role FROM users WHERE handle=$1 FOR UPDATE",
          [req.body.handle],
        );
        if (!target) throw notFound();
        if (target.role === req.body.role)
          return { handle: target.handle, role: target.role };
        if (req.body.role === "member" && mods.length <= 1)
          throw new HttpError(
            409,
            "LAST_MODERATOR",
            "Это последний модератор. Сначала назначьте другого.",
          );
        await tx.query("UPDATE users SET role=$2 WHERE id=$1", [
          target.id,
          req.body.role,
        ]);
        await tx.query(
          "INSERT INTO moderation_actions(id,actor_id,target_type,target_id,action,reason) VALUES ($1,$2,'user',$3,$4,$5)",
          [
            randomUUID(),
            actor.id,
            target.id,
            req.body.role === "moderator"
              ? "grant_moderator"
              : "revoke_moderator",
            reason,
          ],
        );
        if (target.id !== actor.id)
          await notify(
            tx,
            target.id,
            req.body.role === "moderator"
              ? "Вам выдана роль модератора"
              : "Роль модератора снята",
            req.body.role === "moderator" ? "moderation" : "feed",
          );
        return { handle: target.handle, role: req.body.role };
      });
    },
  );
}
