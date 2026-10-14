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
