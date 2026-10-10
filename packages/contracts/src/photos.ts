export interface Photo {
  id: string;
  url: string;
  width: number;
  height: number;
  createdAt: string;
}
const photo = {
  type: "object",
  additionalProperties: false,
  required: ["id", "url", "width", "height", "createdAt"],
  properties: {
    id: { type: "string", format: "uuid" },
    url: { type: "string", maxLength: 100 },
    width: { type: "integer", minimum: 1, maximum: 1600 },
    height: { type: "integer", minimum: 1, maximum: 1600 },
    createdAt: { type: "string", format: "date-time" },
  },
};
export const photoSchemas = {
  upload: {
    type: "object",
    additionalProperties: false,
    required: ["data"],
    properties: { data: { type: "string", minLength: 4, maxLength: 6990508 } },
  },
};
export const photoResponses = {
  photo,
  photos: {
    type: "object",
    additionalProperties: false,
    required: ["items"],
    properties: { items: { type: "array", maxItems: 6, items: photo } },
  },
};
