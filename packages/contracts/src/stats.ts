import type { Difficulty } from "./visits.ts";
import type { LocationKind } from "./index.ts";
// A rider's contributions. Public counters show only what anyone can already see; marks
// «Был здесь» and joined rides are personal and shown to the owner only.
export interface RiderStats {
  placesAdded: number;
  tracksPublished: number;
  ridesOrganized: number;
  postsPublic: number;
}
export interface VisitedPlace {
  id: string;
  title: string;
  city: string;
  kind: LocationKind;
  difficulty: Difficulty | null;
  markedAt: string;
}
export interface MyStats extends RiderStats {
  visits: number;
  ridesJoined: number;
  visited: VisitedPlace[];
}
const obj = (
  properties: Record<string, unknown>,
  required = Object.keys(properties),
) => ({ type: "object", additionalProperties: false, properties, required });
const count = { type: "integer", minimum: 0 };
const publicCounts = {
  placesAdded: count,
  tracksPublished: count,
  ridesOrganized: count,
  postsPublic: count,
};
export const statsResponses = {
  rider: obj(publicCounts),
  mine: obj({
    ...publicCounts,
    visits: count,
    ridesJoined: count,
    visited: {
      type: "array",
      items: obj({
        id: { type: "string", format: "uuid" },
        title: { type: "string" },
        city: { type: "string" },
        kind: { type: "string", enum: ["spot", "rental", "guide", "school"] },
        difficulty: {
          anyOf: [
            { type: "null" },
            { type: "string", enum: ["easy", "medium", "hard"] },
          ],
        },
        markedAt: { type: "string", format: "date-time" },
      }),
    },
  }),
};
