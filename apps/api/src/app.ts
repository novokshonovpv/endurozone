import Fastify, { type FastifyInstance, type FastifyRequest } from "fastify";
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

import { GpxError } from "./gpx.ts";
import { adventureRoutes, adventureOutputs } from "./adventure.ts";
import { locationRoutes, locationOutputs } from "./locations.ts";

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
const bikeOf = (r: Row) => ({
  id: r.id,
  make: r.make,
  model: r.model,
  year: r.year,
  modification: r.modification,
  engine: r.engine,
  hours: Number(r.hours),
  notes: r.notes,
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
        }
      : false,
    bodyLimit: 64 * 1024,
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
        version: "0.5.0",
        description:
          "Аккаунт, гараж, бортжурнал, локации и модерация. Для cookie-сессии запросить /api/me и передать csrfToken в X-CSRF-Token при изменении данных. Все изменения требуют X-Enduro-Client: web. Вход для внутреннего тестирования без проверки email.",
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
      .header("Referrer-Policy", "strict-origin-when-cross-origin");
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
    if (status === 413) message = "Запрос слишком большой. Сократите текст.";
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
  const protectedSchema = { security: [{ cookieSession: [] }] };
  const authRate = { rateLimit: { max: 10, timeWindow: "1 minute" } };
  // Fake credentials perform the same expensive derivation on unknown-email login.
  const dummyHash = await hashPassword(randomUUID());

  app.get("/api/health", { schema: { tags: ["System"] } }, () => ({
    ok: true,
    version: "0.5.0",
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
          const csrfToken = await newSession(
            tx,
            reply,
            id,
            options.secureCookie ?? false,
          );
          reply.code(201);
          return {
            user: { ...profileOf(r), email: r.email, role: r.role },
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
      const [r] = await db.query("SELECT * FROM users WHERE email=$1", [
        clean(req.body.email).toLowerCase(),
      ]);
      const valid = await verifyPassword(
        req.body.password,
        r?.password_hash ?? dummyHash,
      );
      if (!r || !valid)
        throw new HttpError(401, "LOGIN_FAILED", "Неверный email или пароль.");
      // Rotate the currently presented session instead of accepting a pre-login identifier.
      if (req.authContext)
        await db.query("DELETE FROM sessions WHERE token_hash=$1", [
          req.authContext.tokenHash,
        ]);
      const csrfToken = await newSession(
        db,
        reply,
        r.id,
        options.secureCookie ?? false,
      );
      return {
        user: { ...profileOf(r), email: r.email, role: r.role },
        csrfToken,
      };
    },
  );
  app.post(
    "/api/auth/logout",
    { schema: { ...protectedSchema, tags: ["Auth"] } },
    async (req, reply) => {
      const auth = requireWrite(req);
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
      const auth = requireWrite(req);
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
        user: { ...profileOf(r), email: r.email, role: r.role },
        csrfToken: auth.csrfToken,
      };
    },
  );
  app.get<{ Params: { handle: string } }>(
    "/api/profiles/:handle",
    { schema: { params: schemas.handle, tags: ["Profile"] } },
    async (req) => {
      const [r] = await db.query(
        "SELECT id,handle,display_name,city,level,bio FROM users WHERE handle=$1",
        [req.params.handle],
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
      const auth = requireWrite(req);
      const b = req.body;
      nonblank([b.make, b.model]);
      const [r] = await db.query(
        "INSERT INTO bikes(id,owner_id,make,model,year,modification,engine,hours,notes) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *",
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
      const auth = requireWrite(req),
        b = req.body;
      nonblank([b.make, b.model]);
      const [r] = await db.query(
        "UPDATE bikes SET make=$3,model=$4,year=$5,modification=$6,engine=$7,hours=$8,notes=$9 WHERE id=$1 AND owner_id=$2 RETURNING *",
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
      const auth = requireWrite(req);
      try {
        const rows = await db.query(
          "DELETE FROM bikes WHERE id=$1 AND owner_id=$2 RETURNING id",
          [req.params.id, auth.user.id],
        );
        if (!rows.length) throw notFound();
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
  ): Promise<Page<Post>> {
    const rows = await db.query(
      `${postSelect} WHERE ${where} ORDER BY p.created_at DESC,p.id DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, limit + 1, offset],
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
      `${postSelect} WHERE p.id=$1 AND ((p.visibility='public' AND NOT p.hidden) OR p.author_id=$2)`,
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
      return listPosts(parts.join(" AND "), params, limit, offset);
    },
  );
  app.get<{ Querystring: PageQuery }>(
    "/api/me/posts",
    {
      schema: {
        querystring: schemas.page,
        ...protectedSchema,
        tags: ["Journal"],
      },
    },
    async (req) =>
      listPosts(
        "p.author_id=$1",
        [requireAuth(req).user.id],
        req.query.limit,
        req.query.offset,
      ),
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
      const auth = requireWrite(req),
        b = req.body;
      nonblank([b.title, b.body]);
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
      const auth = requireWrite(req),
        b = req.body;
      nonblank([b.title, b.body]);
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
        [req.params.id, requireWrite(req).user.id],
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
        "SELECT c.*,u.handle,u.display_name,u.city,u.level,u.bio FROM comments c JOIN users u ON c.author_id=u.id JOIN posts p ON c.post_id=p.id WHERE c.post_id=$1 AND ((p.visibility='public' AND NOT p.hidden) OR p.author_id=$4) ORDER BY c.created_at,c.id LIMIT $2 OFFSET $3",
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
      const auth = requireWrite(req);
      nonblank([req.body.body]);
      // Access and insertion share one SQL statement, including a concurrent privacy change.
      const [r] = await db.query(
        "INSERT INTO comments(id,post_id,author_id,body) SELECT $1,p.id,$3,$4 FROM posts p WHERE p.id=$2 AND NOT p.hidden AND (p.visibility='public' OR p.author_id=$3) RETURNING *",
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
      const auth = requireWrite(req);
      const rows = await db.query(
        "DELETE FROM comments WHERE id=$1 AND author_id=$2 RETURNING id",
        [req.params.id, auth.user.id],
      );
      if (!rows.length) throw notFound();
      return reply.code(204).send();
    },
  );
  adventureRoutes(app, db, { requireAuth, requireWrite, HttpError, notFound });
  locationRoutes(app, db, { requireAuth, requireWrite, HttpError, notFound });
  if (options.webRoot)
    await app.register(staticFiles, { root: options.webRoot });
  app.setNotFoundHandler((req, reply) => {
    if (options.webRoot && req.method === "GET" && !req.url.startsWith("/api/"))
      return reply.sendFile("index.html");
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
