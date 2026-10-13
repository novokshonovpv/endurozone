import type { FastifyInstance } from "fastify";
import { readFileSync } from "node:fs";
import {
  modelResponses,
  modelSchemas,
  responses,
  type ModelDetail,
  type ModelSection,
  type ModelSummary,
} from "@enduro/contracts";
// The model reference is static data imported from the owner's 67МОТО catalog
// (scripts/import-67moto-models.mjs); it is read once and kept in memory.
const file = JSON.parse(
  readFileSync(new URL("../data/models.json", import.meta.url), "utf8"),
) as { source: string; models: ModelDetail[] };
const models = file.models;
const bySlug = new Map(models.map((m) => [m.slug, m]));
const brands = [...new Set(models.map((m) => m.brand))]
  .sort((a, b) => a.localeCompare(b, "ru"))
  .map((brand) => ({
    brand,
    count: models.filter((m) => m.brand === brand).length,
  }));
export const catalogModel = (slug: string) => bySlug.get(slug);
const summaryOf = ({
  images,
  description: _d,
  specs: _s,
  url: _u,
  ...rest
}: ModelDetail): ModelSummary => ({ ...rest, image: images[0] ?? null });
const norm = (s: string) => s.toLowerCase().replace(/ё/g, "е").trim();
export function modelRoutes(
  app: FastifyInstance,
  guards: { notFound: () => Error },
) {
  const tags = ["Models"];
  app.get(
    "/api/models/brands",
    {
      schema: {
        tags,
        response: { 200: modelResponses.brands },
      },
    },
    () => ({ source: file.source, items: brands }),
  );
  app.get<{
    Querystring: {
      brand?: string;
      q?: string;
      section?: ModelSection;
      limit?: number;
      offset?: number;
    };
  }>(
    "/api/models",
    {
      schema: {
        tags,
        querystring: modelSchemas.search,
        response: { 200: modelResponses.models, 400: responses.error },
      },
    },
    (req) => {
      const { brand, q, section, limit = 24, offset = 0 } = req.query;
      const words = norm(q ?? "")
        .split(/\s+/)
        .filter(Boolean);
      const found = models.filter(
        (m) =>
          (!brand || norm(m.brand) === norm(brand)) &&
          (!section || m.section === section) &&
          words.every((w) => norm(`${m.brand} ${m.title}`).includes(w)),
      );
      return {
        items: found.slice(offset, offset + limit).map(summaryOf),
        total: found.length,
        nextOffset: offset + limit < found.length ? offset + limit : null,
      };
    },
  );
  app.get<{ Params: { slug: string } }>(
    "/api/models/:slug",
    {
      schema: {
        tags,
        params: modelSchemas.slug,
        response: {
          200: modelResponses.model,
          400: responses.error,
          404: responses.error,
        },
      },
    },
    (req) => {
      const m = bySlug.get(req.params.slug);
      if (!m) throw guards.notFound();
      return m;
    },
  );
}
