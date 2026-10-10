export interface ServicePlanInput {
  title: string;
  intervalHours: number;
  dueHours: number;
  notes: string;
}
export interface ServicePlan extends ServicePlanInput {
  id: string;
  bikeId: string;
  version: number;
  active: boolean;
  lastHours: number | null;
}
export interface ServiceRecord {
  id: string;
  planId: string;
  title: string;
  performedOn: string;
  hours: number;
  costRub: number;
  notes: string;
  createdAt: string;
}
export interface BikeService {
  plans: ServicePlan[];
  records: ServiceRecord[];
  nextOffset: number | null;
}
export interface CompleteServiceInput {
  version: number;
  performedOn: string;
  hours: number;
  costRub: number;
  notes: string;
}
const text = (maxLength: number, minLength = 0) => ({
  type: "string",
  maxLength,
  minLength,
});
const num = { type: "number", minimum: 0, maximum: 100000, multipleOf: 0.01 };
const obj = (properties: Record<string, unknown>) => ({
  type: "object",
  additionalProperties: false,
  properties,
  required: Object.keys(properties),
});
const uuid = { type: "string", format: "uuid" };
export const serviceSchemas = {
  plan: obj({
    title: text(120, 2),
    intervalHours: {
      type: "number",
      minimum: 0.01,
      maximum: 10000,
      multipleOf: 0.01,
    },
    dueHours: num,
    notes: text(2000),
  }),
  complete: obj({
    version: { type: "integer", minimum: 0 },
    performedOn: { type: "string", format: "date" },
    hours: num,
    costRub: {
      type: "number",
      minimum: 0,
      maximum: 10000000,
      multipleOf: 0.01,
    },
    notes: text(2000),
  }),
  version: obj({ version: { type: "integer", minimum: 0 } }),
  ids: obj({ id: uuid, planId: uuid }),
};
const plan = obj({
  id: uuid,
  bikeId: uuid,
  title: text(120),
  intervalHours: num,
  dueHours: num,
  notes: text(2000),
  version: { type: "integer" },
  active: { type: "boolean" },
  lastHours: { type: ["number", "null"] },
});
const record = obj({
  id: uuid,
  planId: uuid,
  title: text(120),
  performedOn: { type: "string", format: "date" },
  hours: num,
  costRub: { type: "number" },
  notes: text(2000),
  createdAt: { type: "string", format: "date-time" },
});
export const serviceResponses = {
  plan,
  record,
  page: obj({
    plans: { type: "array", items: plan },
    records: { type: "array", items: record },
    nextOffset: { type: ["integer", "null"] },
  }),
};
