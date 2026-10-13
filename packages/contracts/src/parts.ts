// Parts selection: a model's motorcycle and its engine split into nodes (like a parts manual).
// Node drawings are our own schematics; supplier part tables are imported separately (scripts/import-parts.mjs).
import type { Profile } from "./index.ts";
import { modelSummaryProperties, type ModelSummary } from "./models.ts";
export type PartScope = "moto" | "engine";
export const motoNodes = {
  bodywork: "Облицовка и пластик",
  frame: "Рама и защита",
  exhaust: "Выхлопная система",
  footpegs: "Подножки и подставка",
  controls: "Рычаги, тросы, педали",
  steering: "Рулевая колонка",
  handlebar: "Руль и тормоза",
  fork: "Передняя вилка",
  shock: "Задняя подвеска",
  swingarm: "Маятник, цепь, звёзды",
  wheel_front: "Переднее колесо",
  wheel_rear: "Заднее колесо",
  electrics: "Электрика и свет",
  tank_seat: "Бак и седло",
} as const;
export const engineNodes = {
  head: "Головка цилиндра и клапаны",
  cylinder: "Цилиндр и поршень",
  crank: "Коленвал и шатун",
  clutch: "Сцепление",
  gearbox: "Коробка передач",
  ignition: "Генератор и зажигание",
  starter: "Стартер и кикстартер",
  intake: "Карбюратор, впуск, фильтр",
  lube: "Смазка и масляный фильтр",
  cooling: "Охлаждение",
  covers: "Картер и крышки",
} as const;
export type MotoNode = keyof typeof motoNodes;
export type EngineNode = keyof typeof engineNodes;
export type PartNode = MotoNode | EngineNode;
export const nodeLabel = (scope: PartScope, node: string) =>
  scope === "moto"
    ? motoNodes[node as MotoNode]
    : engineNodes[node as EngineNode];
/** A size or code from the seller's specs: tyres, chain, plug… */
export interface PassportLine {
  label: string;
  value: string;
}
/** A supplier part from an imported table (empty until a catalogue is connected). */
export interface PartItem {
  position: string;
  name: string;
  article: string;
  qty: number | null;
  note: string;
}
export interface PartFitInput {
  name: string;
  partNumber: string;
  comment: string;
}
/** What fitted an owner's bike, confirmed by other owners. */
export interface PartFit extends PartFitInput {
  id: string;
  author: Profile;
  createdAt: string;
  votes: number;
  viewerVoted: boolean;
  viewerIsAuthor: boolean;
}
export interface PartNodeSummary {
  id: PartNode;
  label: string;
  passport: number;
  items: number;
  fits: number;
}
export interface PartEngine {
  key: string;
  label: string;
  /** Other models of the reference with the same engine. */
  models: number;
}
export interface PartsOverview {
  model: ModelSummary;
  engine: PartEngine | null;
  moto: PartNodeSummary[];
  engineNodes: PartNodeSummary[];
  viewerOwns: boolean;
}
export interface PartNodePage {
  scope: PartScope;
  node: PartNode;
  label: string;
  passport: PassportLine[];
  items: PartItem[];
  fits: PartFit[];
  viewerOwns: boolean;
  engine: PartEngine | null;
}
const obj = (
  properties: Record<string, unknown>,
  required = Object.keys(properties),
) => ({ type: "object", additionalProperties: false, properties, required });
const str = { type: "string" };
const scope = { type: "string", enum: ["moto", "engine"] };
const node = {
  type: "string",
  enum: [...Object.keys(motoNodes), ...Object.keys(engineNodes)],
};
const engine = {
  anyOf: [
    obj({ key: str, label: str, models: { type: "integer" } }),
    { type: "null" },
  ],
};
const nodeSummary = obj({
  id: node,
  label: str,
  passport: { type: "integer" },
  items: { type: "integer" },
  fits: { type: "integer" },
});
const fit = obj({
  id: { type: "string", format: "uuid" },
  name: str,
  partNumber: str,
  comment: str,
  author: obj({
    id: { type: "string", format: "uuid" },
    handle: str,
    displayName: str,
    city: str,
    level: str,
    bio: str,
  }),
  createdAt: { type: "string", format: "date-time" },
  votes: { type: "integer", minimum: 0 },
  viewerVoted: { type: "boolean" },
  viewerIsAuthor: { type: "boolean" },
});
export const partSchemas = {
  model: obj({ slug: { type: "string", pattern: "^[a-z0-9-]{1,120}$" } }),
  node: obj({
    slug: { type: "string", pattern: "^[a-z0-9-]{1,120}$" },
    scope,
    node,
  }),
  fit: obj({
    name: { type: "string", minLength: 2, maxLength: 120 },
    partNumber: { type: "string", maxLength: 80 },
    comment: { type: "string", maxLength: 500 },
  }),
  id: obj({ id: { type: "string", format: "uuid" } }),
};
export const partResponses = {
  overview: obj({
    model: obj(modelSummaryProperties),
    engine,
    moto: { type: "array", items: nodeSummary },
    engineNodes: { type: "array", items: nodeSummary },
    viewerOwns: { type: "boolean" },
  }),
  node: obj({
    scope,
    node,
    label: str,
    passport: { type: "array", items: obj({ label: str, value: str }) },
    items: {
      type: "array",
      items: obj({
        position: str,
        name: str,
        article: str,
        qty: { anyOf: [{ type: "number" }, { type: "null" }] },
        note: str,
      }),
    },
    fits: { type: "array", items: fit },
    viewerOwns: { type: "boolean" },
    engine,
  }),
  fit,
};
