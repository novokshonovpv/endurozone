// Race and event announcements (Сообщество · Мероприятия). Facts only — name, dates, place,
// classes — and always a link to the original announcement.
export type AnnouncementStatus = "scheduled" | "postponed" | "cancelled";
export const announcementStatuses: Record<AnnouncementStatus, string> = {
  scheduled: "По плану",
  postponed: "Перенесено",
  cancelled: "Отменено",
};
export interface AnnouncementInput {
  title: string;
  startsOn: string;
  endsOn?: string | null;
  region: string;
  place?: string;
  discipline?: string;
  classes?: string;
  sourceUrl: string;
  status?: AnnouncementStatus;
  note?: string;
}
export interface Announcement {
  id: string;
  title: string;
  startsOn: string;
  endsOn: string | null;
  region: string;
  place: string;
  discipline: string;
  classes: string;
  sourceUrl: string;
  status: AnnouncementStatus;
  note: string;
}
const obj = (
  properties: Record<string, unknown>,
  required = Object.keys(properties),
) => ({ type: "object", additionalProperties: false, properties, required });
const text = (maxLength: number, minLength = 0) => ({
  type: "string",
  minLength,
  maxLength,
});
const day = { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" };
const status = { type: "string", enum: Object.keys(announcementStatuses) };
const fields = {
  title: text(140, 3),
  startsOn: day,
  endsOn: { anyOf: [day, { type: "null" }] },
  region: text(120, 2),
  place: text(160),
  discipline: text(80),
  classes: text(200),
  sourceUrl: { type: "string", pattern: "^https://", maxLength: 300 },
  status,
  note: text(300),
};
export const announcementSchemas = {
  input: obj(fields, ["title", "startsOn", "region", "sourceUrl"]),
  page: obj(
    {
      limit: { type: "integer", minimum: 1, maximum: 50, default: 30 },
      offset: { type: "integer", minimum: 0, maximum: 10000, default: 0 },
    },
    [],
  ),
};
const announcement = obj({
  id: { type: "string", format: "uuid" },
  ...fields,
  endsOn: { anyOf: [day, { type: "null" }] },
});
export const announcementResponses = {
  one: announcement,
  page: obj({
    items: { type: "array", items: announcement },
    nextOffset: { anyOf: [{ type: "integer", minimum: 0 }, { type: "null" }] },
  }),
};
// Drafts read from public channels: the parser's guess, checked by a moderator before publishing.
export interface AnnouncementDraft {
  id: string;
  sourceUrl: string;
  postText: string;
  guess: Partial<AnnouncementInput>;
  createdAt: string;
}
const draft = obj({
  id: { type: "string", format: "uuid" },
  sourceUrl: { type: "string" },
  postText: { type: "string" },
  guess: obj(
    {
      ...fields,
      title: { type: "string" },
      region: { type: "string" },
      sourceUrl: { type: "string" },
    },
    [],
  ),
  createdAt: { type: "string", format: "date-time" },
});
export const announcementDraftResponses = {
  page: obj({ items: { type: "array", items: draft } }),
  refresh: obj({
    checked: { type: "integer", minimum: 0 },
    added: { type: "integer", minimum: 0 },
  }),
};
