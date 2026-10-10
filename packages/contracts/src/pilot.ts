export interface Notification {
  id: string;
  message: string;
  path: string;
  createdAt: string;
  readAt: string | null;
}
const text = (minLength: number, maxLength: number) => ({
  type: "string",
  minLength,
  maxLength,
});
const obj = (
  properties: Record<string, unknown>,
  required = Object.keys(properties),
) => ({ type: "object", additionalProperties: false, properties, required });
const token = text(43, 43);
export const pilotSchemas = {
  email: obj({ email: { ...text(5, 254), format: "email" } }),
  token: obj({ token }),
  reset: obj({ token, password: text(12, 128) }),
  page: obj(
    {
      offset: { type: "integer", minimum: 0, maximum: 100000 },
      limit: { type: "integer", minimum: 1, maximum: 50 },
    },
    [],
  ),
};
export const pilotResponses = {
  message: obj({ message: text(1, 300) }),
  notifications: obj({
    items: {
      type: "array",
      items: obj({
        id: { type: "string", format: "uuid" },
        message: text(1, 500),
        path: text(1, 100),
        createdAt: { type: "string", format: "date-time" },
        readAt: {
          anyOf: [{ type: "string", format: "date-time" }, { type: "null" }],
        },
      }),
    },
    nextOffset: { anyOf: [{ type: "integer" }, { type: "null" }] },
    unreadCount: { type: "integer", minimum: 0 },
  }),
};
