export interface MechanicConsultation {
  id: string;
  question: string;
  answer: string | null;
  bike: {
    make: string;
    model: string;
    year: number;
    engine: string;
    modification: string;
  } | null;
  status: "pending" | "answered" | "failed";
  createdAt: string;
}
export interface MechanicHistory {
  items: MechanicConsultation[];
  total: number;
}
export type MechanicProvider = "openai" | "yandex" | "gigachat";
// Shown to riders in the consent text: the company that receives the question.
export const mechanicProviders: Record<MechanicProvider, string> = {
  openai: "OpenAI",
  yandex: "YandexGPT (Яндекс)",
  gigachat: "GigaChat (Сбер)",
};
export interface MechanicStatus {
  available: boolean;
  dailyLimit: number;
  provider: MechanicProvider | null;
}
const obj = (properties: Record<string, unknown>) => ({
  type: "object",
  additionalProperties: false,
  properties,
  required: Object.keys(properties),
});
const text = { type: "string" };
const consultation = obj({
  id: { type: "string", format: "uuid" },
  question: text,
  answer: { type: ["string", "null"] },
  bike: {
    anyOf: [
      { type: "null" },
      obj({
        make: text,
        model: text,
        year: { type: "integer" },
        engine: text,
        modification: text,
      }),
    ],
  },
  status: { type: "string", enum: ["pending", "answered", "failed"] },
  createdAt: { type: "string", format: "date-time" },
});
export const mechanicSchemas = {
  ask: obj({
    question: { type: "string", minLength: 10, maxLength: 2000 },
    bikeId: { type: ["string", "null"], format: "uuid" },
    consent: { type: "boolean", const: true },
  }),
  page: {
    type: "object",
    additionalProperties: false,
    properties: {
      offset: { type: "integer", minimum: 0, maximum: 1000, default: 0 },
    },
  },
};
export const mechanicResponses = {
  consultation,
  history: obj({
    items: { type: "array", items: consultation },
    total: { type: "integer" },
  }),
  status: obj({
    available: { type: "boolean" },
    dailyLimit: { type: "integer" },
    provider: {
      anyOf: [
        { type: "string", enum: ["openai", "yandex", "gigachat"] },
        { type: "null" },
      ],
    },
  }),
};
