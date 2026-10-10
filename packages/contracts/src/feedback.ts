import type { Profile } from "./index.ts";
export type FeedbackKind = "bug" | "confusing" | "idea";
export type FeedbackStatus = "new" | "in_progress" | "resolved" | "wontfix";
export const feedbackKinds: Record<FeedbackKind, string> = {
  bug: "Что-то сломалось",
  confusing: "Непонятно, что делать",
  idea: "Идея или пожелание",
};
export const feedbackStatuses: Record<FeedbackStatus, string> = {
  new: "Новый",
  in_progress: "В работе",
  resolved: "Решено",
  wontfix: "Не будем делать",
};
export interface FeedbackInput {
  kind: FeedbackKind;
  body: string;
  section: string;
  viewport: string;
}
export interface Feedback {
  id: string;
  kind: FeedbackKind;
  body: string;
  section: string;
  viewport: string;
  userAgent: string;
  appVersion: string;
  status: FeedbackStatus;
  reply: string;
  createdAt: string;
  updatedAt: string;
}
export interface ModeratedFeedback extends Feedback {
  author: Profile;
}
export const feedbackOpenLimit = 100;
const obj = (
  properties: Record<string, unknown>,
  required = Object.keys(properties),
) => ({ type: "object", additionalProperties: false, properties, required });
const text = (max: number, min = 0) => ({
  type: "string",
  maxLength: max,
  minLength: min,
});
const kind = { type: "string", enum: Object.keys(feedbackKinds) };
const status = { type: "string", enum: Object.keys(feedbackStatuses) };
const page = {
  limit: { type: "integer", minimum: 1, maximum: 50, default: 20 },
  offset: { type: "integer", minimum: 0, maximum: 10000, default: 0 },
};
// Only the first route segment (e.g. "ride"), never an object id from the address.
const section = { type: "string", pattern: "^[a-z][a-z-]{0,29}$" };
const fields = {
  id: { type: "string", format: "uuid" },
  kind,
  body: text(2000),
  section: text(30),
  viewport: text(20),
  userAgent: text(300),
  appVersion: text(20),
  status,
  reply: text(1000),
  createdAt: { type: "string", format: "date-time" },
  updatedAt: { type: "string", format: "date-time" },
};
const profile = obj({
  id: { type: "string", format: "uuid" },
  handle: text(24),
  displayName: text(60),
  city: text(80),
  level: { type: "string", enum: ["beginner", "amateur", "pro"] },
  bio: text(600),
});
const pageOf = (item: unknown) =>
  obj({
    items: { type: "array", items: item },
    nextOffset: { anyOf: [{ type: "integer", minimum: 0 }, { type: "null" }] },
  });
export const feedbackSchemas = {
  create: obj({
    kind,
    body: text(2000, 5),
    section,
    viewport: { type: "string", pattern: "^[0-9]{2,5}x[0-9]{2,5}$" },
  }),
  page: obj(page, []),
  moderationPage: obj({ ...page, status }, []),
  decision: obj({ status, reply: text(1000) }),
};
export const feedbackResponses = {
  feedback: obj(fields),
  mine: pageOf(obj(fields)),
  moderated: pageOf(obj({ ...fields, author: profile })),
};
