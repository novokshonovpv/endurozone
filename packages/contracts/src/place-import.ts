// Moderators upload many places at once from a spreadsheet (CSV). Every row is checked on the
// server with the same rules as the «Предложить место» form; bad rows are reported, not fatal.
export const placeImportLimit = 200;
export interface PlaceImportRow {
  kind?: string;
  title?: string;
  city?: string;
  latitude?: number | null;
  longitude?: number | null;
  difficulty?: string;
  description?: string;
  accessNotes?: string;
  contacts?: string;
}
export interface PlaceImportResult {
  added: number;
  skipped: { row: number; title: string; reason: string }[];
}
// Column names accepted in the first line of the file (Russian or English).
export const placeImportColumns: Record<keyof PlaceImportRow, string[]> = {
  kind: ["тип", "kind"],
  title: ["название", "title"],
  city: ["город", "city"],
  latitude: ["широта", "latitude", "lat"],
  longitude: ["долгота", "longitude", "lon", "lng"],
  difficulty: ["сложность", "difficulty"],
  description: ["описание", "description"],
  accessNotes: ["условия", "условия доступа", "accessnotes", "access"],
  contacts: ["контакты", "contacts"],
};
const text = (maxLength: number) => ({ type: "string", maxLength });
// null first: with type coercion an empty cell would otherwise turn into 0 (a point at 0,0).
const coordinate = { anyOf: [{ type: "null" }, { type: "number" }] };
export const placeImportSchemas = {
  body: {
    type: "object",
    additionalProperties: false,
    required: ["items"],
    properties: {
      items: {
        type: "array",
        minItems: 1,
        maxItems: placeImportLimit,
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            kind: text(40),
            title: text(400),
            city: text(200),
            latitude: coordinate,
            longitude: coordinate,
            difficulty: text(40),
            description: text(4000),
            accessNotes: text(2000),
            contacts: text(400),
          },
        },
      },
    },
  },
};
export const placeImportResponses = {
  result: {
    type: "object",
    additionalProperties: false,
    required: ["added", "skipped"],
    properties: {
      added: { type: "integer", minimum: 0 },
      skipped: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["row", "title", "reason"],
          properties: {
            row: { type: "integer" },
            title: { type: "string" },
            reason: { type: "string" },
          },
        },
      },
    },
  },
};
