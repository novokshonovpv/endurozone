import type { Profile } from "./index.ts";
export interface FollowSummary {
  followerCount: number;
  followingCount: number;
  viewerFollows: boolean;
}
export interface FollowedRider extends Profile {
  followedAt: string;
}
export interface FavoriteState {
  favorited: boolean;
}
export const followLimit = 1000;
export const favoriteLimit = 1000;
const obj = (
  properties: Record<string, unknown>,
  required = Object.keys(properties),
) => ({ type: "object", additionalProperties: false, properties, required });
const count = { type: "integer", minimum: 0 };
const page = {
  limit: { type: "integer", minimum: 1, maximum: 30, default: 12 },
  offset: { type: "integer", minimum: 0, maximum: 10000, default: 0 },
};
export const followSchemas = {
  page: obj(page, []),
};
export const followResponses = {
  summary: obj({
    followerCount: count,
    followingCount: count,
    viewerFollows: { type: "boolean" },
  }),
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
        followedAt: { type: "string", format: "date-time" },
      }),
    },
    nextOffset: { anyOf: [{ type: "integer", minimum: 0 }, { type: "null" }] },
  }),
  favorite: obj({ favorited: { type: "boolean" } }),
};
