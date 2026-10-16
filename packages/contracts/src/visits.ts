// «Был здесь»: riders mark places they visited and may vote for a spot's difficulty.
// A place counts as checked by the community from three marks; a difficulty from two votes.
export type Difficulty = "easy" | "medium" | "hard";
export const verifiedVisits = 3;
export const difficultyVotesNeeded = 2;
export interface LocationVisits {
  visits: number;
  votes: Record<Difficulty, number>;
  communityDifficulty: Difficulty | null;
  mine: { visited: boolean; difficulty: Difficulty | null };
}
const obj = (
  properties: Record<string, unknown>,
  required = Object.keys(properties),
) => ({ type: "object", additionalProperties: false, properties, required });
const difficulty = { type: "string", enum: ["easy", "medium", "hard"] };
const count = { type: "integer", minimum: 0 };
export const visitSchemas = {
  mark: obj({ difficulty: { anyOf: [difficulty, { type: "null" }] } }, []),
};
export const visitResponses = {
  summary: obj({
    visits: count,
    votes: obj({ easy: count, medium: count, hard: count }),
    communityDifficulty: { anyOf: [difficulty, { type: "null" }] },
    mine: obj({
      visited: { type: "boolean" },
      difficulty: { anyOf: [difficulty, { type: "null" }] },
    }),
  }),
};
