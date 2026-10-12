import type { Profile } from "./index.ts";
export type Role = "member" | "moderator";
export interface RoleChange {
  handle: string;
  role: Role;
  reason: string;
}
export interface Moderators {
  items: Profile[];
}
const obj = (
  properties: Record<string, unknown>,
  required = Object.keys(properties),
) => ({ type: "object", additionalProperties: false, properties, required });
const text = (max: number, min = 0) => ({
  type: "string",
  maxLength: max,
  minLength: min,
});
const handle = { ...text(24, 3), pattern: "^[a-z0-9_]+$" };
const role = { type: "string", enum: ["member", "moderator"] };
const profile = obj({
  id: { type: "string", format: "uuid" },
  handle: text(24),
  displayName: text(60),
  city: text(80),
  level: { type: "string", enum: ["beginner", "amateur", "pro"] },
  bio: text(600),
});
export const roleSchemas = {
  change: obj({ handle, role, reason: text(500, 10) }),
};
export const roleResponses = {
  moderators: obj({ items: { type: "array", items: profile } }),
  changed: obj({ handle, role }),
};
