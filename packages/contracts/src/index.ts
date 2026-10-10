export type Level = "beginner" | "amateur" | "pro";
export type Visibility = "public" | "private";
export type PostKind = "ride" | "maintenance" | "build";
export interface Profile {
  id: string;
  handle: string;
  displayName: string;
  city: string;
  level: Level;
  bio: string;
}
export interface Session {
  user: Profile & { email: string };
  csrfToken: string;
}
export interface BikeInput {
  make: string;
  model: string;
  year: number;
  modification: string;
  engine: string;
  hours: number;
  notes: string;
}
export interface Bike extends BikeInput {
  id: string;
  createdAt: string;
  catalogVerified: false;
}
export interface PostInput {
  bikeId: string;
  title: string;
  body: string;
  kind: PostKind;
  visibility: Visibility;
}
export interface Post extends PostInput {
  id: string;
  author: Profile;
  createdAt: string;
  updatedAt: string;
  commentCount: number;
  bike: Pick<Bike, "id" | "make" | "model" | "year" | "modification">;
}
export interface Comment {
  id: string;
  body: string;
  author: Profile;
  createdAt: string;
}
export interface Page<T> {
  items: T[];
  nextOffset: number | null;
}
export interface ApiError {
  error: { code: string; message: string; requestId: string };
}
export interface RegisterInput {
  email: string;
  password: string;
  handle: string;
  displayName: string;
  city: string;
  level: Level;
}
export const levels: Record<Level, string> = {
  beginner: "Начинающий",
  amateur: "Любитель",
  pro: "Профессионал",
};
export const postKinds: Record<PostKind, string> = {
  ride: "Покатушка",
  maintenance: "Обслуживание",
  build: "Доработка",
};
const text = (maxLength: number, minLength = 0) => ({
  type: "string",
  minLength,
  maxLength,
});
const obj = (
  properties: Record<string, unknown>,
  required = Object.keys(properties),
) => ({ type: "object", additionalProperties: false, properties, required });
export const schemas = {
  register: obj({
    email: { ...text(254, 3), format: "email" },
    password: text(128, 12),
    handle: { ...text(24, 3), pattern: "^[a-z0-9_]+$" },
    displayName: text(60, 2),
    city: text(80, 2),
    level: { type: "string", enum: Object.keys(levels) },
  }),
  login: obj({
    email: { ...text(254, 3), format: "email" },
    password: text(128, 1),
  }),
  profile: obj({
    displayName: text(60, 2),
    city: text(80, 2),
    level: { type: "string", enum: Object.keys(levels) },
    bio: text(600),
  }),
  bike: obj({
    make: text(60, 1),
    model: text(80, 1),
    year: { type: "integer", minimum: 1970, maximum: 2100 },
    modification: text(120),
    engine: text(120),
    hours: { type: "number", minimum: 0, maximum: 100000 },
    notes: text(2000),
  }),
  post: obj({
    bikeId: { type: "string", format: "uuid" },
    title: text(140, 3),
    body: text(10000, 10),
    kind: { type: "string", enum: Object.keys(postKinds) },
    visibility: { type: "string", enum: ["public", "private"] },
  }),
  comment: obj({ body: text(2000, 1) }),
  id: obj({ id: { type: "string", format: "uuid" } }),
  handle: obj({ handle: { ...text(24, 3), pattern: "^[a-z0-9_]+$" } }),
  page: obj(
    {
      limit: { type: "integer", minimum: 1, maximum: 30, default: 12 },
      offset: { type: "integer", minimum: 0, maximum: 10000, default: 0 },
      city: text(80),
      kind: { type: "string", enum: Object.keys(postKinds) },
    },
    [],
  ),
};

const uuid = { type: "string", format: "uuid" };
const timestamp = { type: "string", format: "date-time" };
const profileProperties = {
  id: uuid,
  handle: text(24, 3),
  displayName: text(60, 2),
  city: text(80, 2),
  level: { type: "string", enum: Object.keys(levels) },
  bio: text(600),
};
const profile = obj(profileProperties);
const bikeSummary = obj({
  id: uuid,
  make: text(60, 1),
  model: text(80, 1),
  year: { type: "integer" },
  modification: text(120),
});
const bikeResponse = obj({
  ...schemas.bike.properties,
  id: uuid,
  createdAt: timestamp,
  catalogVerified: { type: "boolean", const: false },
});
const postResponse = obj({
  ...schemas.post.properties,
  id: uuid,
  author: profile,
  bike: bikeSummary,
  createdAt: timestamp,
  updatedAt: timestamp,
  commentCount: { type: "integer", minimum: 0 },
});
const commentResponse = obj({
  id: uuid,
  body: text(2000, 1),
  author: profile,
  createdAt: timestamp,
});
const pageOf = (item: unknown) =>
  obj({
    items: { type: "array", items: item },
    nextOffset: { anyOf: [{ type: "integer", minimum: 0 }, { type: "null" }] },
  });
export const responses = {
  profile,
  bike: bikeResponse,
  post: postResponse,
  comment: commentResponse,
  session: obj({
    user: obj({
      ...profileProperties,
      email: { ...text(254, 3), format: "email" },
    }),
    csrfToken: text(100, 1),
  }),
  bikes: obj({ items: { type: "array", items: bikeResponse } }),
  posts: pageOf(postResponse),
  comments: pageOf(commentResponse),
  error: obj({
    error: obj({
      code: text(100, 1),
      message: text(1000, 1),
      requestId: text(100, 1),
    }),
  }),
};
