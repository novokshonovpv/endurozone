export type ProductCategory = "parts" | "gear" | "bikes";
export interface Fitment {
  make: string;
  model: string;
  fromYear: number;
  toYear: number;
  modification: string;
  engine: string;
}
export interface CatalogProduct {
  id: string;
  title: string;
  category: ProductCategory;
  section: string;
  sku: string;
  description: string;
  priceRub: number;
  specs: { name: string; value: string }[];
  fitments: Fitment[];
  demo: true;
}
export interface Catalog {
  demo: true;
  items: CatalogProduct[];
}
export const productCategories: Record<ProductCategory, string> = {
  parts: "Запчасти",
  gear: "Экипировка",
  bikes: "Мотоциклы",
};
export type FitmentBike = Pick<
  Fitment,
  "make" | "model" | "modification" | "engine"
> & { year: number };
export const demoCatalogBike: FitmentBike = {
  make: "EZ",
  model: "Trail 250",
  year: 2024,
  modification: "Standard",
  engine: "250 / 4T",
};
const normalize = (s: string) => s.trim().replace(/\s+/g, " ").toLowerCase();
// A partial model/name match must never become a recommendation.
export function matchesFitment(bike: FitmentBike, fit: Fitment): boolean {
  return (
    ["make", "model", "modification", "engine"].every((key) => {
      const field = key as "make" | "model" | "modification" | "engine";
      return (
        !!normalize(bike[field]) &&
        normalize(bike[field]) === normalize(fit[field])
      );
    }) &&
    Number.isInteger(bike.year) &&
    bike.year >= fit.fromYear &&
    bike.year <= fit.toYear
  );
}
export function demoFitmentMatches(
  product: CatalogProduct,
  bike: FitmentBike | null,
): boolean {
  return (
    product.category === "parts" &&
    !!bike &&
    product.fitments.some((fit) => matchesFitment(bike, fit))
  );
}
