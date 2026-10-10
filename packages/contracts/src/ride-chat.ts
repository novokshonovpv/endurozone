import type { Profile } from "./index.ts";
export interface RideMessage {
  id: string;
  author: Profile;
  body: string;
  hiddenBy: "organizer" | "moderator" | null;
  createdAt: string;
}
export interface RideChat {
  items: RideMessage[];
  nextOffset: number | null;
  canWrite: boolean;
  canModerate: boolean;
}
export const rideMessageLimit = 5000;
const obj = (
  properties: Record<string, unknown>,
  required = Object.keys(properties),
) => ({ type: "object", additionalProperties: false, properties, required });
const text = (max: number, min = 0) => ({
  type: "string",
  maxLength: max,
  minLength: min,
});
const uuid = { type: "string", format: "uuid" };
const profile = obj({
  id: uuid,
  handle: text(24),
  displayName: text(60),
  city: text(80),
  level: { type: "string", enum: ["beginner", "amateur", "pro"] },
  bio: text(600),
});
const message = obj({
  id: uuid,
  author: profile,
  body: text(2000),
  hiddenBy: {
    anyOf: [
      { type: "string", enum: ["organizer", "moderator"] },
      { type: "null" },
    ],
  },
  createdAt: { type: "string", format: "date-time" },
});
export const rideChatSchemas = {
  message: obj({ body: text(2000, 1) }),
  page: obj(
    {
      limit: { type: "integer", minimum: 1, maximum: 50, default: 30 },
      offset: { type: "integer", minimum: 0, maximum: 10000, default: 0 },
    },
    [],
  ),
};
export const rideChatResponses = {
  message,
  chat: obj({
    items: { type: "array", items: message },
    nextOffset: { anyOf: [{ type: "integer", minimum: 0 }, { type: "null" }] },
    canWrite: { type: "boolean" },
    canModerate: { type: "boolean" },
  }),
  reported: obj({
    id: uuid,
    author: profile,
    body: text(2000),
    hiddenBy: message.properties.hiddenBy,
    createdAt: { type: "string", format: "date-time" },
  }),
};
