// Motorcycle model reference imported from the 67МОТО catalog (scripts/import-67moto-models.mjs).
export type ModelSection = "enduro" | "pit" | "road" | "electro" | "mini";
export interface ModelSummary {
  slug: string;
  brand: string;
  model: string;
  title: string;
  section: ModelSection;
  sectionLabel: string;
  year: number | null;
  cc: number | null;
  hp: number | null;
  image: string | null;
}
export interface ModelDetail extends Omit<ModelSummary, "image"> {
  images: string[];
  description: string;
  specs: [string, string][];
  url: string;
}
export interface ModelBrand {
  brand: string;
  count: number;
}
const obj = (
  properties: Record<string, unknown>,
  required = Object.keys(properties),
) => ({ type: "object", additionalProperties: false, properties, required });
const str = { type: "string" };
const nullable = (t: object) => ({ anyOf: [t, { type: "null" }] });
export const modelSlug = { type: "string", pattern: "^[a-z0-9-]{1,120}$" };
const summary = {
  slug: str,
  brand: str,
  model: str,
  title: str,
  section: {
    type: "string",
    enum: ["enduro", "pit", "road", "electro", "mini"],
  },
  sectionLabel: str,
  year: nullable({ type: "integer" }),
  cc: nullable({ type: "number" }),
  hp: nullable({ type: "number" }),
};
export const modelSchemas = {
  search: obj(
    {
      brand: { type: "string", maxLength: 60 },
      q: { type: "string", maxLength: 80 },
      section: summary.section,
      // Up to 200: the bike form loads one brand at once.
      limit: { type: "integer", minimum: 1, maximum: 200, default: 24 },
      offset: { type: "integer", minimum: 0, maximum: 5000, default: 0 },
    },
    [],
  ),
  slug: obj({ slug: modelSlug }),
};
export const modelResponses = {
  brands: obj({
    source: str,
    items: {
      type: "array",
      items: obj({ brand: str, count: { type: "integer" } }),
    },
  }),
  models: obj({
    items: {
      type: "array",
      items: obj({ ...summary, image: nullable(str) }),
    },
    total: { type: "integer" },
    nextOffset: nullable({ type: "integer" }),
  }),
  model: obj({
    ...summary,
    images: { type: "array", items: str },
    description: str,
    specs: {
      type: "array",
      items: { type: "array", items: str, minItems: 2, maxItems: 2 },
    },
    url: str,
  }),
};
