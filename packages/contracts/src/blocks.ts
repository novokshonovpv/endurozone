import type { Profile } from "./index.ts";
export interface BlockState {
  blocked: boolean;
}
export interface BlockedRider extends Profile {
  blockedAt: string;
}
export const blockLimit = 1000;
const obj = (
  properties: Record<string, unknown>,
  required = Object.keys(properties),
) => ({ type: "object", additionalProperties: false, properties, required });
export const blockSchemas = {
  page: obj(
    {
      limit: { type: "integer", minimum: 1, maximum: 30, default: 12 },
      offset: { type: "integer", minimum: 0, maximum: 10000, default: 0 },
    },
    [],
  ),
};
export const blockResponses = {
  state: obj({ blocked: { type: "boolean" } }),
  riders: obj({
    items: {
      type: "array",
      items: obj({
        id: { type: "string", format: "uuid" },
        handle: { type: "string", minLength: 3, maxLength: 24 },
        displayName: { type: "string", minLength: 2, maxLength: 60 },
        city: { type: "string", minLength: 2, maxLength: 80 },
        level: { type: "string", enum: ["beginner", "amateur", "pro"] },
        bio: { type: "string", maxLength: 600 },
        blockedAt: { type: "string", format: "date-time" },
      }),
    },
    nextOffset: { anyOf: [{ type: "integer", minimum: 0 }, { type: "null" }] },
  }),
};
