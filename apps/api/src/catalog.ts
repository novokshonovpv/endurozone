import type { FastifyInstance } from "fastify";
import {
  demoCatalogBike,
  type CatalogProduct,
  type Fitment,
} from "@enduro/contracts";

const fit: Fitment = {
  make: demoCatalogBike.make,
  model: demoCatalogBike.model,
  modification: demoCatalogBike.modification,
  engine: demoCatalogBike.engine,
  fromYear: 2023,
  toYear: 2025,
};
// Fictional catalog for product-flow testing. No manufacturer fitment claims.
const items: CatalogProduct[] = [
  {
    id: "ez-filter",
    title: "Воздушный фильтр EZ",
    category: "parts",
    section: "Обслуживание",
    sku: "DEMO-AF-250",
    priceRub: 1800,
    description:
      "Демонстрационная деталь для сценария обслуживания. В карточке реального товара появятся размеры и данные производителя.",
    specs: [{ name: "Тип", value: "Поролоновый фильтр" }],
    fitments: [fit],
    demo: true,
  },
  {
    id: "ez-brakes",
    title: "Тормозные колодки EZ",
    category: "parts",
    section: "Тормоза",
    sku: "DEMO-BP-250",
    priceRub: 2400,
    description:
      "Пример карточки расходника. При подключении поставщика потребуется проверка суппорта, размеров и артикула.",
    specs: [{ name: "Комплект", value: "Передняя ось, демо" }],
    fitments: [fit],
    demo: true,
  },
  {
    id: "ez-skid",
    title: "Защита двигателя EZ",
    category: "parts",
    section: "Защита",
    sku: "DEMO-SG-250",
    priceRub: 6800,
    description:
      "Пример детали с привязкой к исполнению мотоцикла. Для настоящей защиты проверяются крепления и комплектация.",
    specs: [{ name: "Материал", value: "Алюминий, демо" }],
    fitments: [fit],
    demo: true,
  },
  {
    id: "ez-chain",
    title: "Комплект привода EZ",
    category: "parts",
    section: "Трансмиссия",
    sku: "DEMO-DR-300",
    priceRub: 9500,
    description:
      "Пример товара для другой модели. Он не попадает в подбор для Trail 250.",
    specs: [{ name: "Состав", value: "Цепь и звёзды, демо" }],
    fitments: [{ ...fit, model: "Trail 300", engine: "300 / 2T" }],
    demo: true,
  },
  {
    id: "ez-lever",
    title: "Рычаг сцепления EZ",
    category: "parts",
    section: "Управление",
    sku: "DEMO-LV-NEW",
    priceRub: 2200,
    description:
      "Пример товара без таблицы применимости. Совместимость требует проверки и не определяется по названию.",
    specs: [{ name: "Применимость", value: "Данные ещё не загружены" }],
    fitments: [],
    demo: true,
  },
  {
    id: "ez-helmet",
    title: "Эндуро-шлем EZ",
    category: "gear",
    section: "Шлемы",
    sku: "DEMO-HELMET",
    priceRub: 14900,
    description:
      "Демонстрационный образец экипировки. Перед продажей нужны данные о размерах, сертификации и наличии.",
    specs: [{ name: "Размеры", value: "S–XL, демонстрация" }],
    fitments: [],
    demo: true,
  },
  {
    id: "ez-boots",
    title: "Мотоботы EZ",
    category: "gear",
    section: "Мотоботы",
    sku: "DEMO-BOOTS",
    priceRub: 21900,
    description:
      "Пример витрины мотобот. Экипировка подбирается по размеру и посадке, независимо от модели мотоцикла.",
    specs: [{ name: "Размеры", value: "40–46, демонстрация" }],
    fitments: [],
    demo: true,
  },
  {
    id: "ez-goggles",
    title: "Маска EZ",
    category: "gear",
    section: "Маски",
    sku: "DEMO-GOGGLES",
    priceRub: 3900,
    description:
      "Демонстрационный образец маски. Совместимость со шлемом и параметры линзы будут в данных поставщика.",
    specs: [{ name: "Линза", value: "Прозрачная, демо" }],
    fitments: [],
    demo: true,
  },
  {
    id: "ez-bike",
    title: "EZ Trail 250",
    category: "bikes",
    section: "Эндуро",
    sku: "DEMO-BIKE-250",
    priceRub: 249000,
    description:
      "Вымышленный мотоцикл для проверки магазина. Бренд EZ и модель Trail 250 в этом каталоге используются только как примеры.",
    specs: [
      { name: "Двигатель", value: "250 / 4T, демо" },
      { name: "Исполнение", value: "Standard" },
      { name: "Год", value: "2024" },
    ],
    fitments: [],
    demo: true,
  },
];
const text = { type: "string" };
const object = (properties: Record<string, unknown>) => ({
  type: "object",
  additionalProperties: false,
  properties,
  required: Object.keys(properties),
});
const productSchema = object({
  id: text,
  title: text,
  category: { type: "string", enum: ["parts", "gear", "bikes"] },
  section: text,
  sku: text,
  description: text,
  priceRub: { type: "integer", minimum: 0 },
  demo: { type: "boolean", const: true },
  specs: { type: "array", items: object({ name: text, value: text }) },
  fitments: {
    type: "array",
    items: object({
      make: text,
      model: text,
      fromYear: { type: "integer" },
      toYear: { type: "integer" },
      modification: text,
      engine: text,
    }),
  },
});
export function catalogRoutes(app: FastifyInstance) {
  app.get(
    "/api/catalog",
    {
      schema: {
        tags: ["Catalog"],
        description:
          "Fictional demo catalog. Prices and fitments are not supplier data.",
        response: {
          200: {
            type: "object",
            required: ["demo", "items"],
            additionalProperties: false,
            properties: {
              demo: { type: "boolean", const: true },
              items: {
                type: "array",
                items: productSchema,
              },
            },
          },
        },
      },
    },
    async () => ({ demo: true, items }),
  );
}
