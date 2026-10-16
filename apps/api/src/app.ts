import Fastify, {
  type FastifyInstance,
  type FastifyReply,
  type FastifyRequest,
} from "fastify";
import cookie from "@fastify/cookie";
import rateLimit from "@fastify/rate-limit";
import swagger from "@fastify/swagger";
import staticFiles from "@fastify/static";
import { randomUUID, timingSafeEqual } from "node:crypto";
import {
  schemas,
  responses,
  type RegisterInput,
  type BikeInput,
  type PostInput,
  type Profile,
  type Page,
  type Post,
} from "@enduro/contracts";
import type { Database, Row } from "./database.ts";
import {
  cookieName,
  hashPassword,
  verifyPassword,
  hashToken,
  newSession,
  profileOf,
} from "./auth.ts";

import { pilotRoutes, pilotOutputs, queueAccountMail } from "./pilot.ts";
import { accountRightsRoutes } from "./account-rights.ts";
import { catalogRoutes } from "./catalog.ts";
import { garageRoutes } from "./garage.ts";
import { mechanicRoutes, type MechanicResponder } from "./mechanic.ts";
import { riderRoutes } from "./riders.ts";
import { followRoutes } from "./follows.ts";
import { photoRoutes } from "./photos.ts";
import { learningRoutes } from "./learning.ts";
import { GpxError } from "./gpx.ts";
import { adventureRoutes, adventureOutputs } from "./adventure.ts";
import { locationRoutes, locationOutputs } from "./locations.ts";
import { nearbyRoutes } from "./nearby.ts";
import { announcementRoutes } from "./announcements.ts";
import { shareRoutes } from "./share.ts";
import {
  announcementDraftRoutes,
  type FetchPage,
} from "./announcement-import.ts";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { rideChatRoutes } from "./ride-chat.ts";
import { feedbackRoutes } from "./feedback.ts";
import { onboardingRoutes } from "./onboarding.ts";
import { roleRoutes } from "./roles.ts";
import { blockRoutes, blockedBetween } from "./blocks.ts";
import { modelRoutes, catalogModel } from "./models.ts";
import { partRoutes } from "./parts.ts";
import { appVersion } from "./version.ts";

interface AuthContext {
  user: Row;
  csrfToken: string;
  tokenHash: string;
}
declare module "fastify" {
  interface FastifyRequest {
    authContext: AuthContext | null;
  }
}
class HttpError extends Error {
  constructor(
    public statusCode: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}
const notFound = () =>
  new HttpError(404, "NOT_FOUND", "Объект не найден или недоступен.");
const date = (value: Date | string) => new Date(value).toISOString();
// A bike may point at a model of the reference; unknown slugs are rejected.
const catalogSlug = (slug?: string | null) => {
  if (slug == null) return null;
  if (!catalogModel(slug))
    throw new HttpError(
      400,
      "CATALOG_UNKNOWN",
      "Такой модели нет в справочнике.",
    );
  return slug;
};
const bikeOf = (r: Row) => ({
  id: r.id,
  make: r.make,
  model: r.model,
  year: r.year,
  modification: r.modification,
  engine: r.engine,
  hours: Number(r.hours),
  notes: r.notes,
  catalogSlug: r.catalog_slug ?? null,
  createdAt: date(r.created_at),
  catalogVerified: false as const,
});
const postOf = (r: Row): Post => ({
  id: r.id,
  bikeId: r.bike_id,
  title: r.title,
  body: r.body,
  kind: r.kind,
  visibility: r.visibility,
  hidden: r.hidden,
  author: {
    id: r.author_id,
    handle: r.handle,
    displayName: r.display_name,
    city: r.city,
    level: r.level,
    bio: r.bio,
  },
  bike: {
    id: r.bike_id,
    make: r.make,
    model: r.model,
    year: r.year,
    modification: r.modification,
  },
  createdAt: date(r.created_at),
  updatedAt: date(r.updated_at),
  commentCount: Number(r.comment_count),
});
const postSelect = `SELECT p.*, u.handle,u.display_name,u.city,u.level,u.bio,b.make,b.model,b.year,b.modification,
  (SELECT count(*) FROM comments c WHERE c.post_id=p.id) comment_count
  FROM posts p JOIN users u ON p.author_id=u.id JOIN bikes b ON p.bike_id=b.id`;
const requireAuth = (req: FastifyRequest) => {
  if (!req.authContext)
    throw new HttpError(401, "AUTH_REQUIRED", "Войдите в аккаунт.");
  return req.authContext;
};
const safeEqual = (a: string, b: string) => {
  const left = Buffer.from(a),
    right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
};
const requireWrite = (req: FastifyRequest) => {
  const auth = requireAuth(req);
  if (
    typeof req.headers["x-csrf-token"] !== "string" ||
    !safeEqual(req.headers["x-csrf-token"], auth.csrfToken)
  )
    throw new HttpError(
      403,
      "CSRF_INVALID",
      "Сессия изменилась. Обновите страницу.",
    );
  return auth;
};
// Search centres are location data: logs keep the path of /api/nearby, never its query.
export const logRequest = (req: FastifyRequest) => ({
  method: req.method,
  url: req.url.startsWith("/api/nearby") ? "/api/nearby" : req.url,
  host: req.host,
  remoteAddress: req.ip,
});
const clean = (value: string) => value.trim();
const nonblank = (values: string[]) => {
  if (values.some((v) => !v.trim()))
    throw new HttpError(
      400,
      "VALIDATION_ERROR",
      "Заполните обязательные поля.",
    );
};

export async function buildApp(options: {
  db: Database;
  origin?: string;
  secureCookie?: boolean;
  logger?: boolean;
  rateMax?: number;
  webRoot?: string;
  /** Public Telegram channels read for race announcement drafts. */
  announcementChannels?: string[];
  /** Replaces the network fetch of a channel page (tests). */
  fetchChannelPage?: FetchPage;
  requireVerifiedEmail?: boolean;
  mechanicResponder?: MechanicResponder;
  // Only behind a local reverse proxy: client IPs for rate limits come from X-Forwarded-For.
  trustProxy?: boolean;
}): Promise<FastifyInstance> {
  const { db } = options;
  const origin = options.origin ?? "http://localhost:5173";
  const trustedOrigins = new Set([origin]);
  if (
    !options.secureCookie &&
    /^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(origin)
  ) {
    trustedOrigins.add(
      origin.includes("localhost")
        ? origin.replace("localhost", "127.0.0.1")
        : origin.replace("127.0.0.1", "localhost"),
    );
  }
  const app = Fastify({
    logger: options.logger
      ? {
          redact: [
            "req.headers.cookie",
            "req.headers.authorization",
            "req.headers.x-csrf-token",
          ],
          serializers: { req: logRequest },
        }
      : false,
    bodyLimit: 64 * 1024,
    trustProxy: options.trustProxy ? "127.0.0.1" : false,
    ajv: { customOptions: { removeAdditional: false, allErrors: false } },
  });
  app.decorateRequest("authContext", null);
  await app.register(cookie);
  await app.register(rateLimit, {
    max: options.rateMax ?? 200,
    timeWindow: "1 minute",
  });
  await app.register(swagger, {
    openapi: {
      info: {
        title: "Enduro.Zone API",
        version: appVersion,
        description:
          "Аккаунт, гараж, бортжурнал, локации и модерация. Для cookie-сессии запросить /api/me и передать csrfToken в X-CSRF-Token при изменении данных. Все изменения требуют X-Enduro-Client: web. Подтверждение email, восстановление доступа и личные уведомления. Проверка email перед публикацией включается REQUIRE_VERIFIED_EMAIL=true.",
      },
      components: {
        securitySchemes: {
          cookieSession: { type: "apiKey", in: "cookie", name: cookieName },
        },
      },
    },
  });
  const output: Record<string, [number, unknown]> = {
    ...locationOutputs,
    ...adventureOutputs,
    ...pilotOutputs,
    "POST /api/auth/register": [201, responses.session],
    "POST /api/auth/login": [200, responses.session],
    "GET /api/me": [200, responses.session],
    "PATCH /api/me": [200, responses.session],
    "GET /api/profiles/:handle": [200, responses.profile],
    "GET /api/me/bikes": [200, responses.bikes],
    "POST /api/me/bikes": [201, responses.bike],
    "PATCH /api/me/bikes/:id": [200, responses.bike],
    "GET /api/feed": [200, responses.posts],
    "GET /api/me/posts": [200, responses.posts],
    "GET /api/posts/:id": [200, responses.post],
    "POST /api/posts": [201, responses.post],
    "PATCH /api/posts/:id": [200, responses.post],
    "GET /api/posts/:id/comments": [200, responses.comments],
    "POST /api/posts/:id/comments": [201, responses.comment],
  };
  app.addHook("onRoute", (route) => {
    const response = output[`${route.method} ${route.url}`];
    if (response) {
      route.schema = {
        ...route.schema,
        response: {
          [response[0]]: response[1],
          400: responses.error,
          401: responses.error,
          403: responses.error,
          404: responses.error,
          409: responses.error,
          429: responses.error,
          500: responses.error,
        },
      };
    }
  });
  app.addHook("onRequest", async (req, reply) => {
    reply
      .header("X-Content-Type-Options", "nosniff")
      .header("Referrer-Policy", "strict-origin-when-cross-origin")
      // Other sites must not frame our pages (clickjacking); our own pages and the app may.
      .header("X-Frame-Options", "SAMEORIGIN")
      .header("Content-Security-Policy", "frame-ancestors 'self'")
      // Location only for our own pages; camera and microphone are not used at all.
      .header(
        "Permissions-Policy",
        "geolocation=(self), camera=(), microphone=()",
      );
    // Behind HTTPS browsers keep to HTTPS for half a year.
    if (options.secureCookie)
      reply.header("Strict-Transport-Security", "max-age=15552000");
    if (req.url.startsWith("/api/")) reply.header("Cache-Control", "no-store");
    if (!["GET", "HEAD", "OPTIONS"].includes(req.method)) {
      if (req.headers.origin && !trustedOrigins.has(req.headers.origin))
        throw new HttpError(
          403,
          "ORIGIN_INVALID",
          "Этот источник запроса не разрешён.",
        );
      if (req.headers["x-enduro-client"] !== "web")
        throw new HttpError(
          403,
          "CLIENT_HEADER_REQUIRED",
          "Отсутствует заголовок клиента.",
        );
    }
    const token = req.cookies[cookieName];
    if (token) {
      const tokenHash = hashToken(token);
      const [r] = await db.query(
        "SELECT u.*,s.csrf_token FROM sessions s JOIN users u ON s.user_id=u.id WHERE s.token_hash=$1 AND s.expires_at>now()",
        [tokenHash],
      );
      if (r) req.authContext = { user: r, csrfToken: r.csrf_token, tokenHash };
    }
  });
  app.setErrorHandler((error, req, reply) => {
    const e = error as Error & {
      statusCode?: number;
      code?: string;
      validation?: unknown;
    };
    const status = e.validation
      ? 400
      : e.statusCode && e.statusCode >= 400 && e.statusCode < 600
        ? e.statusCode
        : 500;
    let code = e.validation ? "VALIDATION_ERROR" : (e.code ?? "INTERNAL_ERROR");
    let message = e.validation
      ? "Проверьте заполнение полей и длину текста."
      : e.message;
    if (
      status === 400 &&
      !(e instanceof HttpError) &&
      !(e instanceof GpxError) &&
      !e.validation
    )
      message = "Не удалось прочитать запрос. Проверьте заполнение полей.";
    if (status === 413)
      message = req.url.endsWith("/photos")
        ? "Файл слишком большой. Выберите фото до 5 МБ."
        : "Запрос слишком большой. Сократите текст.";
    if (status >= 500) {
      req.log.error({ err: error }, "Request failed");
      code = "INTERNAL_ERROR";
      message = "Не удалось выполнить запрос. Попробуйте позже.";
    }
    if (status === 429) {
      code = "RATE_LIMITED";
      message = "Слишком много запросов. Подождите минуту.";
    }
    reply.code(status).send({ error: { code, message, requestId: req.id } });
  });
  const verifiedWrite = (req: FastifyRequest) => {
    const auth = requireWrite(req);
    if (
      options.requireVerifiedEmail &&
      !auth.user.email_verified_at &&
      !req.url.startsWith("/api/auth/") &&
      !req.url.startsWith("/api/me/notifications")
    )
      throw new HttpError(
        403,
        "EMAIL_UNVERIFIED",
        "Подтвердите email в разделе аккаунта.",
      );
    return auth;
  };
  pilotRoutes(app, db, origin, { requireAuth, requireWrite, HttpError });
  accountRightsRoutes(app, db, options.secureCookie ?? false, {
    requireWrite,
    HttpError,
  });
  const protectedSchema = { security: [{ cookieSession: [] }] };
  const authRate = { rateLimit: { max: 10, timeWindow: "1 minute" } };
  // Fake credentials perform the same expensive derivation on unknown-email login.
  const dummyHash = await hashPassword(randomUUID());

  app.get("/api/health", { schema: { tags: ["System"] } }, () => ({
    ok: true,
    version: appVersion,
  }));
  app.get("/api/openapi.json", { schema: { hide: true } }, () => app.swagger());
  app.post<{ Body: RegisterInput }>(
    "/api/auth/register",
    { schema: { body: schemas.register, tags: ["Auth"] }, config: authRate },
    async (req, reply) => {
      const b = req.body;
      nonblank([b.displayName, b.city]);
      const email = clean(b.email).toLowerCase();
      const id = randomUUID();
      const passwordHash = await hashPassword(b.password);
      try {
        return await db.transaction(async (tx) => {
          const [r] = await tx.query(
            "INSERT INTO users(id,email,password_hash,handle,display_name,city,level) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *",
            [
              id,
              email,
              passwordHash,
              b.handle,
              clean(b.displayName),
              clean(b.city),
              b.level,
            ],
          );
          await queueAccountMail(tx, r, "verify", origin);
          const csrfToken = await newSession(
            tx,
            reply,
            id,
            options.secureCookie ?? false,
          );
          reply.code(201);
          return {
            user: {
              ...profileOf(r),
              email: r.email,
              role: r.role,
              emailVerified: Boolean(r.email_verified_at),
            },
            csrfToken,
          };
        });
      } catch (e) {
        if ((e as { code?: string }).code === "23505")
          throw new HttpError(
            409,
            "ACCOUNT_EXISTS",
            "Email или ник уже занят. Выберите другой или войдите.",
          );
        throw e;
      }
    },
  );
  app.post<{ Body: { email: string; password: string } }>(
    "/api/auth/login",
    { schema: { body: schemas.login, tags: ["Auth"] }, config: authRate },
    async (req, reply) => {
      return db.transaction(async (tx) => {
        const [r] = await tx.query(
          "SELECT * FROM users WHERE email=$1 FOR UPDATE",
          [clean(req.body.email).toLowerCase()],
        );
        const valid = await verifyPassword(
          req.body.password,
          r?.password_hash ?? dummyHash,
        );
        if (!r || !valid)
          throw new HttpError(
            401,
            "LOGIN_FAILED",
            "Неверный email или пароль.",
          );
        // Rotate the currently presented session instead of accepting a pre-login identifier.
        if (req.authContext)
          await tx.query("DELETE FROM sessions WHERE token_hash=$1", [
            req.authContext.tokenHash,
          ]);
        const csrfToken = await newSession(
          tx,
          reply,
          r.id,
          options.secureCookie ?? false,
        );
        return {
          user: {
            ...profileOf(r),
            email: r.email,
            role: r.role,
            emailVerified: Boolean(r.email_verified_at),
          },
          csrfToken,
        };
      });
    },
  );
  app.post(
    "/api/auth/logout",
    { schema: { ...protectedSchema, tags: ["Auth"] } },
    async (req, reply) => {
      const auth = verifiedWrite(req);
      await db.query("DELETE FROM sessions WHERE token_hash=$1", [
        auth.tokenHash,
      ]);
      reply.clearCookie(cookieName, {
        path: "/",
        httpOnly: true,
        sameSite: "lax",
        secure: options.secureCookie ?? false,
      });
      return reply.code(204).send();
    },
  );
  app.get(
    "/api/me",
    { schema: { ...protectedSchema, tags: ["Profile"] } },
    (req) => {
      const auth = requireAuth(req);
      return {
        user: {
          ...profileOf(auth.user),
          email: auth.user.email,
          role: auth.user.role,
          emailVerified: Boolean(auth.user.email_verified_at),
        },
        csrfToken: auth.csrfToken,
      };
    },
  );
  app.patch<{ Body: Pick<Profile, "displayName" | "city" | "level" | "bio"> }>(
    "/api/me",
    {
      schema: { body: schemas.profile, ...protectedSchema, tags: ["Profile"] },
    },
    async (req) => {
      const auth = verifiedWrite(req);
      nonblank([req.body.displayName, req.body.city]);
      const b = req.body;
      const [r] = await db.query(
        "UPDATE users SET display_name=$2,city=$3,level=$4,bio=$5 WHERE id=$1 RETURNING *",
        [
          auth.user.id,
          clean(b.displayName),
          clean(b.city),
          b.level,
          clean(b.bio),
        ],
      );
      return {
        user: {
          ...profileOf(r),
          email: r.email,
          role: r.role,
          emailVerified: Boolean(r.email_verified_at),
        },
        csrfToken: auth.csrfToken,
      };
    },
  );
  app.get<{ Params: { handle: string } }>(
    "/api/profiles/:handle",
    { schema: { params: schemas.handle, tags: ["Profile"] } },
    async (req) => {
      // Someone who blocked the viewer looks absent to them; the blocker still sees the profile to unblock.
      const [r] = await db.query(
        "SELECT id,handle,display_name,city,level,bio FROM users u WHERE handle=$1 AND NOT EXISTS(SELECT 1 FROM blocks b WHERE b.blocker_id=u.id AND b.blocked_id=$2::uuid)",
        [req.params.handle, req.authContext?.user.id ?? null],
      );
      if (!r) throw notFound();
      return profileOf(r);
    },
  );
  app.get(
    "/api/me/bikes",
    { schema: { ...protectedSchema, tags: ["Garage"] } },
    async (req) => {
      const auth = requireAuth(req);
      return {
        items: (
          await db.query(
            "SELECT * FROM bikes WHERE owner_id=$1 ORDER BY created_at,id",
            [auth.user.id],
          )
        ).map(bikeOf),
      };
    },
  );
  app.post<{ Body: BikeInput }>(
    "/api/me/bikes",
    { schema: { body: schemas.bike, ...protectedSchema, tags: ["Garage"] } },
    async (req, reply) => {
      const auth = verifiedWrite(req);
      const b = req.body;
      nonblank([b.make, b.model]);
      const [r] = await db.query(
        "INSERT INTO bikes(id,owner_id,make,model,year,modification,engine,hours,notes,catalog_slug) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *",
        [
          randomUUID(),
          auth.user.id,
          clean(b.make),
          clean(b.model),
          b.year,
          clean(b.modification),
          clean(b.engine),
          b.hours,
          clean(b.notes),
          catalogSlug(b.catalogSlug),
        ],
      );
      reply.code(201);
      return bikeOf(r);
    },
  );
  app.patch<{ Params: { id: string }; Body: BikeInput }>(
    "/api/me/bikes/:id",
    {
      schema: {
        params: schemas.id,
        body: schemas.bike,
        ...protectedSchema,
        tags: ["Garage"],
      },
    },
    async (req) => {
      const auth = verifiedWrite(req),
        b = req.body;
      nonblank([b.make, b.model]);
      const [r] = await db.query(
        "UPDATE bikes SET make=$3,model=$4,year=$5,modification=$6,engine=$7,hours=$8,notes=$9,catalog_slug=CASE WHEN $11 THEN $10 ELSE catalog_slug END WHERE id=$1 AND owner_id=$2 RETURNING *",
        [
          req.params.id,
          auth.user.id,
          clean(b.make),
          clean(b.model),
          b.year,
          clean(b.modification),
          clean(b.engine),
          b.hours,
          clean(b.notes),
          catalogSlug(b.catalogSlug),
          // Older clients that do not send the field keep the stored link.
          b.catalogSlug !== undefined,
        ],
      );
      if (!r) throw notFound();
      return bikeOf(r);
    },
  );
  app.delete<{ Params: { id: string } }>(
    "/api/me/bikes/:id",
    { schema: { params: schemas.id, ...protectedSchema, tags: ["Garage"] } },
    async (req, reply) => {
      const auth = verifiedWrite(req);
      try {
        await db.transaction(async (tx) => {
          const [owned] = await tx.query(
            "SELECT id FROM bikes WHERE id=$1 AND owner_id=$2 FOR UPDATE",
            [req.params.id, auth.user.id],
          );
          if (!owned) throw notFound();
          const [service] = await tx.query(
            "SELECT id FROM bike_service_plans WHERE bike_id=$1 LIMIT 1",
            [req.params.id],
          );
          if (service)
            throw new HttpError(
              409,
              "BIKE_HAS_SERVICE",
              "У мотоцикла есть план или история ТО. Он сохраняется в гараже, чтобы не потерять эти данные.",
            );
          await tx.query("DELETE FROM bikes WHERE id=$1 AND owner_id=$2", [
            req.params.id,
            auth.user.id,
          ]);
        });
        return reply.code(204).send();
      } catch (e) {
        if ((e as { code?: string }).code === "23503")
          throw new HttpError(
            409,
            "BIKE_HAS_POSTS",
            "У мотоцикла есть записи. Сначала удалите их.",
          );
        throw e;
      }
    },
  );
  async function listPosts(
    where: string,
    params: unknown[],
    limit = 12,
    offset = 0,
    shape: { join?: string; order?: string; viewer?: string | null } = {},
  ): Promise<Page<Post>> {
    const all = [...params];
    // A signed-in viewer never gets posts of someone in a block with them.
    if (shape.viewer) {
      all.push(shape.viewer);
      where = `(${where}) AND NOT ${blockedBetween(`$${all.length}::uuid`, "p.author_id")}`;
    }
    const rows = await db.query(
      `${postSelect} ${shape.join ?? ""} WHERE ${where} ORDER BY ${shape.order ?? "p.created_at DESC,p.id DESC"} LIMIT $${all.length + 1} OFFSET $${all.length + 2}`,
      [...all, limit + 1, offset],
    );
    return {
      items: rows.slice(0, limit).map(postOf),
      nextOffset: rows.length > limit ? offset + limit : null,
    };
  }
  async function accessiblePost(
    id: string,
    req: FastifyRequest,
  ): Promise<Post> {
    const [r] = await db.query(
      `${postSelect} WHERE p.id=$1 AND ((p.visibility='public' AND NOT p.hidden) OR p.author_id=$2) AND (p.author_id=$2 OR NOT ${blockedBetween("$2::uuid", "p.author_id")})`,
      [id, req.authContext?.user.id ?? null],
    );
    if (!r) throw notFound();
    return postOf(r);
  }
  type PageQuery = {
    limit?: number;
    offset?: number;
    city?: string;
    kind?: string;
    bikeId?: string;
  };
  app.get<{ Querystring: PageQuery }>(
    "/api/feed",
    { schema: { querystring: schemas.page, tags: ["Journal"] } },
    async (req) => {
      const { limit, offset, city, kind } = req.query;
      const parts = ["p.visibility='public' AND NOT p.hidden"];
      const params: unknown[] = [];
      if (city) {
        params.push(city);
        parts.push(`u.city=$${params.length}`);
      }
      if (kind) {
        params.push(kind);
        parts.push(`p.kind=$${params.length}`);
      }
      return listPosts(parts.join(" AND "), params, limit, offset, {
        viewer: req.authContext?.user.id ?? null,
      });
    },
  );
  app.get<{ Querystring: PageQuery }>(
    "/api/me/posts",
    {
      schema: {
        querystring: schemas.myPosts,
        ...protectedSchema,
        tags: ["Journal"],
      },
    },
    async (req) => {
      const params: unknown[] = [requireAuth(req).user.id];
      const parts = ["p.author_id=$1"];
      if (req.query.bikeId) {
        params.push(req.query.bikeId);
        parts.push(`p.bike_id=$${params.length}`);
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
  app.get<{ Params: { id: string } }>(
    "/api/posts/:id",
    { schema: { params: schemas.id, tags: ["Journal"] } },
    (req) => accessiblePost(req.params.id, req),
  );
  app.post<{ Body: PostInput }>(
    "/api/posts",
    { schema: { body: schemas.post, ...protectedSchema, tags: ["Journal"] } },
    async (req, reply) => {
      const auth = verifiedWrite(req),
        b = req.body;
      nonblank([b.title, b.body]);
      // News in Community are published by moderators only.
      if (b.kind === "news" && auth.user.role !== "moderator")
        throw new HttpError(
          403,
          "MODERATOR_REQUIRED",
          "Новости публикуют модераторы.",
        );
      if (clean(b.title).length < 3 || clean(b.body).length < 10)
        throw new HttpError(
          400,
          "VALIDATION_ERROR",
          "Название от 3 символов, текст от 10.",
        );
      const id = randomUUID();
      const rows = await db.query(
        "INSERT INTO posts(id,author_id,bike_id,title,body,kind,visibility) SELECT $1,$2,b.id,$4,$5,$6,$7 FROM bikes b WHERE b.id=$3 AND b.owner_id=$2 RETURNING id",
        [
          id,
          auth.user.id,
          b.bikeId,
          clean(b.title),
          clean(b.body),
          b.kind,
          b.visibility,
        ],
      );
      if (!rows.length) throw notFound();
      reply.code(201);
      return accessiblePost(id, req);
    },
  );
  app.patch<{ Params: { id: string }; Body: PostInput }>(
    "/api/posts/:id",
    {
      schema: {
        params: schemas.id,
        body: schemas.post,
        ...protectedSchema,
        tags: ["Journal"],
      },
    },
    async (req) => {
      const auth = verifiedWrite(req),
        b = req.body;
      nonblank([b.title, b.body]);
      // News in Community are published by moderators only.
      if (b.kind === "news" && auth.user.role !== "moderator")
        throw new HttpError(
          403,
          "MODERATOR_REQUIRED",
          "Новости публикуют модераторы.",
        );
      if (clean(b.title).length < 3 || clean(b.body).length < 10)
        throw new HttpError(
          400,
          "VALIDATION_ERROR",
          "Название от 3 символов, текст от 10.",
        );
      const rows = await db.query(
        "UPDATE posts SET bike_id=$3,title=$4,body=$5,kind=$6,visibility=$7,updated_at=now() WHERE id=$1 AND author_id=$2 AND EXISTS(SELECT 1 FROM bikes b WHERE b.id=$3 AND b.owner_id=$2) RETURNING id",
        [
          req.params.id,
          auth.user.id,
          b.bikeId,
          clean(b.title),
          clean(b.body),
          b.kind,
          b.visibility,
        ],
      );
      if (!rows.length) throw notFound();
      return accessiblePost(req.params.id, req);
    },
  );
  app.delete<{ Params: { id: string } }>(
    "/api/posts/:id",
    { schema: { params: schemas.id, ...protectedSchema, tags: ["Journal"] } },
    async (req, reply) => {
      const rows = await db.query(
        "DELETE FROM posts WHERE id=$1 AND author_id=$2 RETURNING id",
        [req.params.id, verifiedWrite(req).user.id],
      );
      if (!rows.length) throw notFound();
      return reply.code(204).send();
    },
  );
  app.get<{ Params: { id: string }; Querystring: PageQuery }>(
    "/api/posts/:id/comments",
    {
      schema: {
        params: schemas.id,
        querystring: schemas.page,
        tags: ["Comments"],
      },
    },
    async (req) => {
      await accessiblePost(req.params.id, req);
      const limit = req.query.limit ?? 12,
        offset = req.query.offset ?? 0;
      const rows = await db.query(
        `SELECT c.*,u.handle,u.display_name,u.city,u.level,u.bio FROM comments c JOIN users u ON c.author_id=u.id JOIN posts p ON c.post_id=p.id WHERE c.post_id=$1 AND ((p.visibility='public' AND NOT p.hidden) OR p.author_id=$4) AND NOT ${blockedBetween("$4::uuid", "c.author_id")} ORDER BY c.created_at,c.id LIMIT $2 OFFSET $3`,
        [req.params.id, limit + 1, offset, req.authContext?.user.id ?? null],
      );
      return {
        items: rows.slice(0, limit).map((r) => ({
          id: r.id,
          body: r.body,
          author: { ...profileOf({ ...r, id: r.author_id }) },
          createdAt: date(r.created_at),
        })),
        nextOffset: rows.length > limit ? offset + limit : null,
      };
    },
  );
  app.post<{ Params: { id: string }; Body: { body: string } }>(
    "/api/posts/:id/comments",
    {
      schema: {
        params: schemas.id,
        body: schemas.comment,
        ...protectedSchema,
        tags: ["Comments"],
      },
    },
    async (req, reply) => {
      const auth = verifiedWrite(req);
      nonblank([req.body.body]);
      // Access and insertion share one SQL statement, including a concurrent privacy change.
      const [r] = await db.query(
        `INSERT INTO comments(id,post_id,author_id,body) SELECT $1,p.id,$3,$4 FROM posts p WHERE p.id=$2 AND NOT p.hidden AND (p.visibility='public' OR p.author_id=$3) AND NOT ${blockedBetween("$3::uuid", "p.author_id")} RETURNING *`,
        [randomUUID(), req.params.id, auth.user.id, clean(req.body.body)],
      );
      if (!r) throw notFound();
      reply.code(201);
      return {
        id: r.id,
        body: r.body,
        author: profileOf(auth.user),
        createdAt: date(r.created_at),
      };
    },
  );
  app.delete<{ Params: { id: string } }>(
    "/api/comments/:id",
    { schema: { params: schemas.id, ...protectedSchema, tags: ["Comments"] } },
    async (req, reply) => {
      const auth = verifiedWrite(req);
      const rows = await db.query(
        "DELETE FROM comments WHERE id=$1 AND author_id=$2 RETURNING id",
        [req.params.id, auth.user.id],
      );
      if (!rows.length) throw notFound();
      return reply.code(204).send();
    },
  );
  mechanicRoutes(app, db, options.mechanicResponder, {
    requireAuth,
    requireWrite: verifiedWrite,
    notFound,
    HttpError,
  });
  riderRoutes(app, db, { listPosts, notFound });
  followRoutes(app, db, {
    requireAuth,
    requireWrite: verifiedWrite,
    listPosts,
    notFound,
    HttpError,
  });
  photoRoutes(app, db, { requireWrite: verifiedWrite, notFound, HttpError });
  catalogRoutes(app);
  modelRoutes(app, { notFound });
  partRoutes(app, db, { requireWrite: verifiedWrite, notFound, HttpError });
  learningRoutes(app, db, { requireAuth, requireWrite, notFound, HttpError });
  garageRoutes(app, db, {
    requireAuth,
    requireWrite: verifiedWrite,
    HttpError,
    notFound,
  });
  adventureRoutes(app, db, {
    requireAuth,
    requireWrite: verifiedWrite,
    HttpError,
    notFound,
  });
  locationRoutes(app, db, {
    requireAuth,
    requireWrite: verifiedWrite,
    HttpError,
    notFound,
  });
  nearbyRoutes(app, db);
  feedbackRoutes(app, db, { requireAuth, requireWrite, notFound, HttpError });
  onboardingRoutes(app, db, { requireAuth, requireWrite, HttpError });
  roleRoutes(app, db, { requireAuth, requireWrite, notFound, HttpError });
  rideChatRoutes(app, db, {
    requireAuth,
    requireWrite: verifiedWrite,
    notFound,
    HttpError,
  });
  blockRoutes(app, db, {
    requireAuth,
    requireWrite: verifiedWrite,
    notFound,
    HttpError,
  });
  announcementRoutes(app, db, {
    requireWrite: verifiedWrite,
    notFound,
    HttpError,
  });
  announcementDraftRoutes(
    app,
    db,
    options.announcementChannels ?? ["raceenduro"],
    { requireAuth, requireWrite: verifiedWrite, notFound, HttpError },
    options.fetchChannelPage,
  );
  shareRoutes(app, db, origin);
  // The page is served with this deployment's address in its preview tags (og:url, og:image).
  let indexHtml: string | undefined;
  const sendIndex = (webRoot: string, reply: FastifyReply) => {
    indexHtml ??= readFileSync(join(webRoot, "index.html"), "utf8").replaceAll(
      "__SITE_ORIGIN__",
      origin,
    );
    return reply
      .type("text/html; charset=utf-8")
      .header("Cache-Control", "no-cache")
      .send(indexHtml);
  };
  if (options.webRoot) {
    const webRoot = options.webRoot;
    app.get("/", { schema: { hide: true } }, (_req, reply) =>
      sendIndex(webRoot, reply),
    );
    await app.register(staticFiles, { root: webRoot, index: false });
  }
  app.setNotFoundHandler((req, reply) => {
    if (options.webRoot && req.method === "GET" && !req.url.startsWith("/api/"))
      return sendIndex(options.webRoot, reply);
    return reply.code(404).send({
      error: {
        code: "NOT_FOUND",
        message: "Адрес не найден.",
        requestId: req.id,
      },
    });
  });
  return app;
}
