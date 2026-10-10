import type { Profile, LocationStatus } from "./index.ts";
export type Coordinate = [number, number];
export interface TrackGeometry {
  type: "MultiLineString";
  coordinates: Coordinate[][];
}
export interface TrackPreview {
  geometry: TrackGeometry;
  distanceM: number;
  pointCount: number;
  trimM: number;
}
export interface TrackInput {
  title: string;
  description: string;
  city: string;
  accessNotes: string;
  difficulty: "easy" | "medium" | "hard";
  gpx: string;
  trimM: number;
  publicationConsent: true;
}
export interface Track extends TrackPreview {
  id: string;
  title: string;
  description: string;
  city: string;
  accessNotes: string;
  difficulty: TrackInput["difficulty"];
  status: LocationStatus;
  author: Profile;
  createdAt: string;
  updatedAt: string;
}
export interface RideInput {
  trackId: string;
  title: string;
  description: string;
  meetingNotes: string;
  startsAt: string;
  timezone: string;
  capacity: number;
}
export interface Ride extends Omit<RideInput, "meetingNotes"> {
  id: string;
  organizer: Profile;
  city: string;
  trackTitle: string;
  status: "open" | "cancelled";
  acceptedCount: number;
  createdAt: string;
}
export interface RideMember {
  user: Profile;
  status: "pending" | "accepted" | "declined" | "left";
}
const text = (max: number, min = 0) => ({
  type: "string",
  maxLength: max,
  minLength: min,
});
const obj = (
  properties: Record<string, unknown>,
  required = Object.keys(properties),
) => ({ type: "object", additionalProperties: false, properties, required });
const uuid = { type: "string", format: "uuid" },
  time = { type: "string", format: "date-time" };
const difficulty = { type: "string", enum: ["easy", "medium", "hard"] };
const trim = { type: "integer", minimum: 100, maximum: 2000 };
export const rideTimezones = [
  "Europe/Kaliningrad",
  "Europe/Moscow",
  "Europe/Samara",
  "Asia/Yekaterinburg",
  "Asia/Omsk",
  "Asia/Krasnoyarsk",
  "Asia/Irkutsk",
  "Asia/Yakutsk",
  "Asia/Vladivostok",
  "Asia/Magadan",
  "Asia/Kamchatka",
];
const trackFields = {
  title: text(140, 3),
  description: text(3000, 10),
  city: text(80, 2),
  accessNotes: text(1500, 10),
  difficulty,
  gpx: text(400000, 20),
  trimM: trim,
  publicationConsent: { type: "boolean", const: true },
};
export const adventureSchemas = {
  preview: obj({ gpx: trackFields.gpx, trimM: trim }),
  track: obj(trackFields),
  ride: obj({
    trackId: uuid,
    title: text(140, 3),
    description: text(3000, 10),
    meetingNotes: text(2000, 10),
    startsAt: time,
    timezone: { type: "string", enum: rideTimezones },
    capacity: { type: "integer", minimum: 2, maximum: 50 },
  }),
  memberParams: obj({ id: uuid, userId: uuid }),
  memberDecision: obj({
    action: { type: "string", enum: ["accept", "decline"] },
  }),
};
const profile = obj({
  id: uuid,
  handle: text(24),
  displayName: text(60),
  city: text(80),
  level: { type: "string", enum: ["beginner", "amateur", "pro"] },
  bio: text(600),
});
const coordinate = {
  type: "array",
  items: { type: "number" },
  minItems: 2,
  maxItems: 2,
};
const geometry = obj({
  type: { type: "string", const: "MultiLineString" },
  coordinates: { type: "array", items: { type: "array", items: coordinate } },
});
const previewFields = {
  geometry,
  distanceM: { type: "number" },
  pointCount: { type: "integer" },
  trimM: trim,
};
const track = obj({
  ...previewFields,
  id: uuid,
  title: trackFields.title,
  description: trackFields.description,
  city: trackFields.city,
  accessNotes: trackFields.accessNotes,
  difficulty,
  status: {
    type: "string",
    enum: ["pending", "published", "rejected", "hidden"],
  },
  author: profile,
  createdAt: time,
  updatedAt: time,
});
const ride = obj({
  id: uuid,
  trackId: uuid,
  title: text(140),
  description: text(3000),
  startsAt: time,
  timezone: text(80),
  capacity: { type: "integer" },
  organizer: profile,
  city: text(80),
  trackTitle: text(140),
  status: { type: "string", enum: ["open", "cancelled"] },
  acceptedCount: { type: "integer" },
  createdAt: time,
});
const page = (item: unknown) =>
  obj({
    items: { type: "array", items: item },
    nextOffset: { anyOf: [{ type: "integer" }, { type: "null" }] },
  });
export const adventureResponses = {
  preview: obj(previewFields),
  track,
  tracks: page(track),
  original: obj({ gpx: text(400000) }),
  ride,
  rides: page(ride),
  membership: obj({
    status: {
      type: "string",
      enum: ["none", "organizer", "pending", "accepted", "declined", "left"],
    },
  }),
  meeting: obj({ meetingNotes: text(2000) }),
  members: obj({
    items: {
      type: "array",
      items: obj({
        user: profile,
        status: {
          type: "string",
          enum: ["pending", "accepted", "declined", "left"],
        },
      }),
    },
  }),
};

export const rideTimezoneNames: Record<string, string> = {
  "Europe/Kaliningrad": "Калининград",
  "Europe/Moscow": "Москва, Смоленск, Сочи",
  "Europe/Samara": "Самара",
  "Asia/Yekaterinburg": "Екатеринбург",
  "Asia/Omsk": "Омск",
  "Asia/Krasnoyarsk": "Красноярск",
  "Asia/Irkutsk": "Иркутск",
  "Asia/Yakutsk": "Якутск",
  "Asia/Vladivostok": "Владивосток",
  "Asia/Magadan": "Магадан",
  "Asia/Kamchatka": "Камчатка",
};
