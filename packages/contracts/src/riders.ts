import type { Profile, Bike } from "./index.ts";
export interface Rider extends Profile {
  publicPostCount: number;
  publicBikeCount: number;
}
export type PublicBike = Pick<
  Bike,
  "id" | "make" | "model" | "year" | "modification"
> & { publicPostCount: number };
const obj = (
  properties: Record<string, unknown>,
  required = Object.keys(properties),
) => ({ type: "object", additionalProperties: false, properties, required });
const text = { type: "string", maxLength: 80 };
const page = {
  limit: { type: "integer", minimum: 1, maximum: 30, default: 12 },
  offset: { type: "integer", minimum: 0, maximum: 10000, default: 0 },
};
const count = { type: "integer", minimum: 0 };
const pageOf = (items: unknown) =>
  obj({
    items: { type: "array", items },
    nextOffset: { type: ["integer", "null"], minimum: 0 },
  });
export const riderSchemas = {
  search: obj({ ...page, q: text, city: text }, []),
  bikes: obj(page, []),
  posts: obj(
    {
      ...page,
      bikeId: { type: "string", format: "uuid" },
      kind: { type: "string", enum: ["ride", "maintenance", "build"] },
    },
    [],
  ),
};
export const riderResponses = {
  riders: pageOf(
    obj({
      id: { type: "string", format: "uuid" },
      handle: { type: "string" },
      displayName: { type: "string" },
      city: text,
      level: { type: "string", enum: ["beginner", "amateur", "pro"] },
      bio: { type: "string" },
      publicPostCount: count,
      publicBikeCount: count,
    }),
  ),
  bikes: pageOf(
    obj({
      id: { type: "string", format: "uuid" },
      make: text,
      model: text,
      year: { type: "integer" },
      modification: { type: "string", maxLength: 120 },
      publicPostCount: count,
    }),
  ),
};
