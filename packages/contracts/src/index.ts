export type Level = "beginner" | "amateur" | "pro";
export type Visibility = "public" | "private";
export type PostKind = "ride" | "maintenance" | "build" | "news";
/** What a point on the map is: a riding spot or a service around riding. */
export type LocationKind = "spot" | "rental" | "guide" | "school";
export const locationKinds: Record<LocationKind, string> = {
  spot: "Место для катания",
  rental: "Прокат",
  guide: "Гид",
  school: "Школа",
};
export interface Profile {
  id: string;
  handle: string;
  displayName: string;
  city: string;
  level: Level;
  bio: string;
}
export * from "./pilot.ts";
export * from "./catalog.ts";
export * from "./garage.ts";
export * from "./learning.ts";
export * from "./mechanic.ts";
export * from "./riders.ts";
export * from "./photos.ts";
export * from "./follows.ts";
export interface Session {
  user: Profile & {
    email: string;
    emailVerified: boolean;
    role: "member" | "moderator";
  };
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
  /** Model from the reference (67МОТО catalog); free-text bikes have none. */
  catalogSlug?: string | null;
}
export interface Bike extends BikeInput {
  id: string;
  createdAt: string;
  catalogSlug: string | null;
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
  hidden: boolean;
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
  // Published by moderators only; shown in Community → News.
  news: "Новость",
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
  bike: obj(
    {
      make: text(60, 1),
      model: text(80, 1),
      year: { type: "integer", minimum: 1970, maximum: 2100 },
      modification: text(120),
      engine: text(120),
      hours: { type: "number", minimum: 0, maximum: 100000 },
      notes: text(2000),
      catalogSlug: {
        anyOf: [
          { type: "string", pattern: "^[a-z0-9-]{1,120}$" },
          { type: "null" },
        ],
      },
    },
    ["make", "model", "year", "modification", "engine", "hours", "notes"],
  ),
  post: obj({
    bikeId: { type: "string", format: "uuid" },
    title: text(140, 3),
    body: text(10000, 10),
    kind: { type: "string", enum: Object.keys(postKinds) },
    visibility: { type: "string", enum: ["public", "private"] },
  }),
  location: obj(
    {
      kind: { type: "string", enum: Object.keys(locationKinds) },
      title: text(140, 3),
      description: text(3000, 10),
      city: text(80, 2),
      latitude: { type: "number", minimum: -90, maximum: 90 },
      longitude: { type: "number", minimum: -180, maximum: 180 },
      // Spots need a difficulty; rentals, guides and schools do not.
      difficulty: {
        anyOf: [
          { type: "string", enum: ["easy", "medium", "hard"] },
          { type: "null" },
        ],
      },
      accessNotes: text(1500, 10),
      contacts: text(300),
      publicationConsent: { type: "boolean", const: true },
    },
    [
      "title",
      "description",
      "city",
      "latitude",
      "longitude",
      "accessNotes",
      "publicationConsent",
    ],
  ),
  locationPage: obj(
    {
      limit: { type: "integer", minimum: 1, maximum: 30, default: 12 },
      offset: { type: "integer", minimum: 0, maximum: 10000, default: 0 },
      city: text(80),
      // "services" = rentals, guides and schools together (Маршруты · Прокаты и гиды).
      kind: {
        type: "string",
        enum: [...Object.keys(locationKinds), "services"],
      },
    },
    [],
  ),
  decision: obj({
    action: { type: "string", enum: ["publish", "reject", "hide"] },
    reason: text(1000, 10),
    expectedStatus: { type: "string", enum: ["pending", "published"] },
  }),
  report: obj({
    targetType: {
      type: "string",
      enum: ["post", "location", "track", "ride", "ride_message"],
    },
    targetId: { type: "string", format: "uuid" },
    reason: {
      type: "string",
      enum: ["spam", "unsafe", "access", "abuse", "other"],
    },
    details: text(2000, 10),
  }),
  resolveReport: obj({
    action: { type: "string", enum: ["dismiss", "hide"] },
    reason: text(1000, 10),
  }),
  comment: obj({ body: text(2000, 1) }),
  id: obj({ id: { type: "string", format: "uuid" } }),
  handle: obj({ handle: { ...text(24, 3), pattern: "^[a-z0-9_]+$" } }),
  myPosts: obj(
    {
      limit: { type: "integer", minimum: 1, maximum: 30, default: 12 },
      offset: { type: "integer", minimum: 0, maximum: 10000, default: 0 },
      bikeId: { type: "string", format: "uuid" },
      kind: { type: "string", enum: Object.keys(postKinds) },
    },
    [],
  ),
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
// Every response carries catalogSlug (null for free-text bikes).
const bikeResponse = obj({
  ...schemas.bike.properties,
  id: uuid,
  createdAt: timestamp,
  catalogVerified: { type: "boolean", const: false },
});
const postResponse = obj({
  hidden: { type: "boolean" },
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
const locationResponse = obj({
  id: uuid,
  author: profile,
  title: text(140),
  description: text(3000),
  city: text(80),
  latitude: { type: "number" },
  longitude: { type: "number" },
  kind: { type: "string", enum: ["spot", "rental", "guide", "school"] },
  difficulty: {
    anyOf: [
      { type: "string", enum: ["easy", "medium", "hard"] },
      { type: "null" },
    ],
  },
  // Riders' marks (0.28): how many were here and the difficulty they voted for.
  communityDifficulty: {
    anyOf: [
      { type: "string", enum: ["easy", "medium", "hard"] },
      { type: "null" },
    ],
  },
  visits: { type: "integer", minimum: 0 },
  accessNotes: text(1500),
  contacts: text(300),
  status: {
    type: "string",
    enum: ["pending", "published", "rejected", "hidden"],
  },
  createdAt: timestamp,
  updatedAt: timestamp,
});
const reportResponse = obj({
  id: uuid,
  targetType: {
    type: "string",
    enum: ["post", "location", "track", "ride", "ride_message"],
  },
  targetId: uuid,
  reason: text(20),
  details: text(2000),
  status: { type: "string", enum: ["open", "dismissed", "hidden"] },
  createdAt: timestamp,
});
export const responses = {
  location: locationResponse,
  locations: pageOf(locationResponse),
  report: reportResponse,
  reports: pageOf(reportResponse),
  audit: obj({
    items: {
      type: "array",
      items: obj({
        id: uuid,
        action: text(30),
        reason: text(1000),
        createdAt: timestamp,
      }),
    },
  }),
  profile,
  bike: bikeResponse,
  post: postResponse,
  comment: commentResponse,
  session: obj({
    user: obj({
      ...profileProperties,
      email: { ...text(254, 3), format: "email" },
      role: { type: "string", enum: ["member", "moderator"] },
      emailVerified: { type: "boolean" },
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

export type LocationStatus = "pending" | "published" | "rejected" | "hidden";
export interface LocationInput {
  kind?: LocationKind;
  title: string;
  description: string;
  city: string;
  latitude: number;
  longitude: number;
  difficulty?: "easy" | "medium" | "hard" | null;
  /** For spots: access rules; for rentals, guides and schools: terms and prices. */
  accessNotes: string;
  /** Phone, site or messenger of a rental, guide or school. */
  contacts?: string;
  publicationConsent: true;
}
export interface EnduroLocation
  extends Omit<
    LocationInput,
    "publicationConsent" | "kind" | "difficulty" | "contacts"
  > {
  kind: LocationKind;
  difficulty: "easy" | "medium" | "hard" | null;
  /** Most riders' vote once at least two voted; null otherwise. */
  communityDifficulty: "easy" | "medium" | "hard" | null;
  /** Riders who marked «Был здесь». */
  visits: number;
  contacts: string;
  id: string;
  author: Profile;
  status: LocationStatus;
  createdAt: string;
  updatedAt: string;
}
export interface Report {
  id: string;
  targetType: "post" | "location" | "track" | "ride" | "ride_message";
  targetId: string;
  reason: string;
  details: string;
  status: "open" | "dismissed" | "hidden";
  createdAt: string;
}
export interface ModerationAction {
  id: string;
  action: string;
  reason: string;
  createdAt: string;
}
export const difficulties = {
  easy: "Лёгкая",
  medium: "Средняя",
  hard: "Сложная",
};
export const locationStatuses: Record<LocationStatus, string> = {
  pending: "На проверке",
  published: "Опубликовано",
  rejected: "Отклонено",
  hidden: "Скрыто",
};
export const reportReasons = {
  spam: "Спам",
  unsafe: "Опасная информация",
  access: "Нет разрешения на доступ",
  abuse: "Оскорбления",
  other: "Другое",
};

export * from "./adventure.ts";
export * from "./nearby.ts";
export * from "./ride-chat.ts";
export * from "./feedback.ts";
export * from "./onboarding.ts";
export * from "./roles.ts";
export * from "./blocks.ts";
export * from "./models.ts";
export * from "./parts.ts";
export * from "./announcements.ts";
export * from "./visits.ts";
export * from "./place-import.ts";
