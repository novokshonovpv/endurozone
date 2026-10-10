import { describe, it } from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import {
  demoCatalogBike,
  matchesFitment,
  demoFitmentMatches,
  type Catalog,
} from "@enduro/contracts";
import { catalogRoutes } from "../src/catalog.ts";
const fit = {
  make: "EZ",
  model: "Trail 250",
  fromYear: 2023,
  toYear: 2025,
  modification: "Standard",
  engine: "250 / 4T",
};
describe("Demo catalog and conservative fitment", () => {
  it("matches exact model, year, engine and modification, accepting harmless case/space differences", () => {
    assert.equal(matchesFitment(demoCatalogBike, fit), true);
    assert.equal(
      matchesFitment(
        { ...demoCatalogBike, make: " ez ", model: "Trail   250" },
        fit,
      ),
      true,
    );
    assert.equal(matchesFitment({ ...demoCatalogBike, year: 2023 }, fit), true);
    assert.equal(matchesFitment({ ...demoCatalogBike, year: 2025 }, fit), true);
  });
  it("never treats missing fields, another model/engine/year/edition or partial names as a match", () => {
    for (const bike of [
      { ...demoCatalogBike, model: "Trail 250 R" },
      { ...demoCatalogBike, make: "ZE" },
      { ...demoCatalogBike, engine: "250 / 2T" },
      { ...demoCatalogBike, modification: "Racing" },
      { ...demoCatalogBike, engine: "" },
      { ...demoCatalogBike, modification: "" },
      { ...demoCatalogBike, year: 2026 },
      { ...demoCatalogBike, year: 2022 },
      { ...demoCatalogBike, year: 2024.5 },
    ])
      assert.equal(matchesFitment(bike, fit), false);
  });
  it("exposes fictional read-only catalog to guests and never assigns bike fitment to gear", async () => {
    const app = Fastify();
    catalogRoutes(app);
    try {
      const response = await app.inject({ method: "GET", url: "/api/catalog" });
      assert.equal(response.statusCode, 200);
      const catalog = response.json<Catalog>();
      assert.equal(catalog.demo, true);
      assert.equal(
        new Set(catalog.items.map((x) => x.id)).size,
        catalog.items.length,
      );
      assert.deepEqual(
        new Set(catalog.items.map((x) => x.category)),
        new Set(["parts", "gear", "bikes"]),
      );
      assert.ok(
        catalog.items.every(
          (x) => x.demo === true && x.sku.startsWith("DEMO-") && x.priceRub > 0,
        ),
      );
      assert.equal(
        catalog.items.filter((x) => demoFitmentMatches(x, demoCatalogBike))
          .length,
        3,
      );
      assert.ok(catalog.items.every((x) => !demoFitmentMatches(x, null)));
      const helmet = catalog.items.find((x) => x.id === "ez-helmet")!;
      assert.equal(
        demoFitmentMatches({ ...helmet, fitments: [fit] }, demoCatalogBike),
        false,
      );
      assert.equal(
        (
          await app.inject({
            method: "POST",
            url: "/api/catalog",
            payload: { title: "Should not be accepted" },
          })
        ).statusCode,
        404,
      );
    } finally {
      await app.close();
    }
  });
});
