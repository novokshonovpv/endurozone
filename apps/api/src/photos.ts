import type { FastifyInstance, FastifyRequest } from "fastify";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import {
  schemas,
  responses,
  photoSchemas,
  photoResponses,
  type Photo,
} from "@enduro/contracts";
import type { Database, Queryable, Row } from "./database.ts";
const maxInput = 5 * 1024 * 1024;
const maxAccount = 50 * 1024 * 1024;
const publicPost = "p.visibility='public' AND NOT p.hidden";
const photoOf = (r: Row): Photo => ({
  id: r.id,
  url: `/api/photos/${r.id}/image`,
  width: r.width,
  height: r.height,
  createdAt: new Date(r.created_at).toISOString(),
});
export function photoRoutes(
  app: FastifyInstance,
  db: Database,
  guards: {
    requireWrite: (req: FastifyRequest) => { user: Row };
    notFound: () => Error;
    HttpError: new (status: number, code: string, message: string) => Error;
  },
) {
  const { requireWrite, notFound, HttpError } = guards;
  let processing = 0;
  const errors = {
    400: responses.error,
    401: responses.error,
    403: responses.error,
    404: responses.error,
    409: responses.error,
    413: responses.error,
    429: responses.error,
  };
  const metadata = "id,width,height,created_at";
  async function target(
    tx: Queryable,
    kind: "bikes" | "posts",
    id: string,
    user: string | null,
    write = false,
  ) {
    const owner = kind === "bikes" ? "owner_id" : "author_id";
    const readable =
      kind === "bikes"
        ? `EXISTS(SELECT 1 FROM posts p WHERE p.bike_id=t.id AND p.author_id=t.owner_id AND ${publicPost})`
        : "(t.visibility='public' AND NOT t.hidden)";
    const [row] = await tx.query(
      `SELECT t.id FROM ${kind} t WHERE t.id=$1 AND (t.${owner}=$2 ${write ? "" : `OR ${readable}`}) ${write ? "FOR UPDATE" : ""}`,
      [id, user],
    );
    if (!row) throw notFound();
  }
  for (const kind of ["bikes", "posts"] as const) {
    const column = kind === "bikes" ? "bike_id" : "post_id";
    app.get<{ Params: { id: string } }>(
      `/api/${kind}/:id/photos`,
      {
        schema: {
          tags: ["Photos"],
          params: schemas.id,
          response: { 200: photoResponses.photos, ...errors },
        },
      },
      async (req) => {
        await target(db, kind, req.params.id, req.authContext?.user.id ?? null);
        // Recheck visibility in the same query that returns the metadata.
        const owner = kind === "bikes" ? "owner_id" : "author_id";
        const readable =
          kind === "bikes"
            ? `EXISTS(SELECT 1 FROM posts p WHERE p.bike_id=t.id AND p.author_id=t.owner_id AND ${publicPost})`
            : "(t.visibility='public' AND NOT t.hidden)";
        const rows = await db.query(
          `SELECT f.id,f.width,f.height,f.created_at FROM photos f JOIN ${kind} t ON t.id=f.${column} WHERE t.id=$1 AND (t.${owner}=$2 OR ${readable}) ORDER BY f.created_at,f.id`,
          [req.params.id, req.authContext?.user.id ?? null],
        );
        return { items: rows.map(photoOf) };
      },
    );
    app.post<{ Params: { id: string }; Body: { data: string } }>(
      `/api/${kind}/:id/photos`,
      {
        bodyLimit: 7 * 1024 * 1024,
        config: { rateLimit: { max: 20, timeWindow: "1 minute" } },
        schema: {
          tags: ["Photos"],
          security: [{ cookieSession: [] }],
          params: schemas.id,
          body: photoSchemas.upload,
          response: { 201: photoResponses.photo, ...errors },
        },
      },
      async (req, reply) => {
        const user = requireWrite(req).user.id;
        await target(db, kind, req.params.id, user, true);
        const input = Buffer.from(req.body.data, "base64");
        if (input.toString("base64") !== req.body.data)
          throw new HttpError(
            400,
            "PHOTO_INVALID",
            "Не удалось прочитать файл фотографии.",
          );
        if (input.length > maxInput)
          throw new HttpError(
            413,
            "PHOTO_TOO_LARGE",
            "Фото должно быть не больше 5 МБ.",
          );
        const signature = input.subarray(0, 12);
        const supported =
          (signature[0] === 0xff &&
            signature[1] === 0xd8 &&
            signature[2] === 0xff) ||
          signature
            .subarray(0, 8)
            .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ||
          (signature.toString("ascii", 0, 4) === "RIFF" &&
            signature.toString("ascii", 8, 12) === "WEBP");
        if (!supported)
          throw new HttpError(
            400,
            "PHOTO_INVALID",
            "Выберите фотографию JPEG, PNG или WebP.",
          );
        if (processing >= 2)
          throw new HttpError(
            429,
            "PHOTO_BUSY",
            "Сейчас обрабатываются другие фото. Попробуйте ещё раз.",
          );
        let output: { data: Buffer; info: sharp.OutputInfo };
        processing++;
        try {
          const image = sharp(input, {
            limitInputPixels: 24_000_000,
            failOn: "warning",
          });
          const meta = await image.metadata();
          if (
            !["jpeg", "png", "webp"].includes(meta.format ?? "") ||
            (meta.pages ?? 1) > 1
          )
            throw new Error("Unsupported image");
          output = await image
            .rotate()
            .resize({
              width: 1600,
              height: 1600,
              fit: "inside",
              withoutEnlargement: true,
            })
            .flatten({ background: "#ffffff" })
            .jpeg({ quality: 82 })
            .toBuffer({ resolveWithObject: true });
          if (output.data.length > 2 * 1024 * 1024)
            throw new Error("Output too large");
        } catch {
          throw new HttpError(
            400,
            "PHOTO_INVALID",
            "Не удалось прочитать фото. Выберите обычный JPEG, PNG или WebP до 24 мегапикселей, без анимации.",
          );
        } finally {
          processing--;
        }
        const result = await db.transaction(async (tx) => {
          const [u] = await tx.query(
            "SELECT id FROM users WHERE id=$1 FOR UPDATE",
            [user],
          );
          if (!u) throw notFound();
          await target(tx, kind, req.params.id, user, true);
          const [count] = await tx.query(
            `SELECT count(*) n FROM photos WHERE ${column}=$1`,
            [req.params.id],
          );
          if (kind === "posts" && Number(count.n) >= 6)
            throw new HttpError(
              409,
              "PHOTO_LIMIT",
              "В записи может быть не больше 6 фотографий.",
            );
          if (kind === "bikes")
            await tx.query("DELETE FROM photos WHERE bike_id=$1", [
              req.params.id,
            ]);
          const [quota] = await tx.query(
            "SELECT count(*) n,COALESCE(sum(octet_length(image)),0) bytes FROM photos WHERE owner_id=$1",
            [user],
          );
          if (
            Number(quota.n) >= 100 ||
            Number(quota.bytes) + output.data.length > maxAccount
          )
            throw new HttpError(
              409,
              "PHOTO_QUOTA",
              "Лимит фото аккаунта достигнут: 100 фото или 50 МБ. Удалите ненужные изображения.",
            );
          const [row] = await tx.query(
            `INSERT INTO photos(id,owner_id,${column},image,width,height) VALUES($1,$2,$3,$4,$5,$6) RETURNING ${metadata}`,
            [
              randomUUID(),
              user,
              req.params.id,
              output.data,
              output.info.width,
              output.info.height,
            ],
          );
          return photoOf(row);
        });
        return reply.code(201).send(result);
      },
    );
  }
  app.get<{ Params: { id: string } }>(
    "/api/photos/:id/image",
    {
      schema: {
        tags: ["Photos"],
        params: schemas.id,
        response: { 200: { type: "string", format: "binary" }, ...errors },
      },
    },
    async (req, reply) => {
      const [r] = await db.query(
        `SELECT f.image FROM photos f LEFT JOIN posts p ON p.id=f.post_id LEFT JOIN bikes b ON b.id=f.bike_id WHERE f.id=$1 AND (f.owner_id=$2 OR (f.post_id IS NOT NULL AND ${publicPost}) OR (f.bike_id IS NOT NULL AND EXISTS(SELECT 1 FROM posts p WHERE p.bike_id=b.id AND p.author_id=b.owner_id AND ${publicPost})))`,
        [req.params.id, req.authContext?.user.id ?? null],
      );
      if (!r) throw notFound();
      return reply
        .type("image/jpeg")
        .header("Content-Disposition", 'inline; filename="photo.jpg"')
        .send(Buffer.from(r.image));
    },
  );
  app.delete<{ Params: { id: string } }>(
    "/api/photos/:id",
    {
      schema: {
        tags: ["Photos"],
        security: [{ cookieSession: [] }],
        params: schemas.id,
        response: { 204: { type: "null" }, ...errors },
      },
    },
    async (req, reply) => {
      const user = requireWrite(req).user.id;
      const rows = await db.query(
        "DELETE FROM photos WHERE id=$1 AND owner_id=$2 RETURNING id",
        [req.params.id, user],
      );
      if (!rows.length) throw notFound();
      return reply.code(204).send();
    },
  );
}
