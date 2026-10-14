import type { Profile, EnduroLocation } from "./index.ts";
import { adventureResponses, type Coordinate, type Ride } from "./adventure.ts";
export const nearbyRadii = [25, 50, 100, 200] as const;
export type NearbyRadius = (typeof nearbyRadii)[number];
export const defaultNearbyRadius: NearbyRadius = 100;
export const nearbyLimit = 30;
export interface GeoPoint {
  latitude: number;
  longitude: number;
}
// Approximate city centres for choosing a search centre without geolocation.
export const cityCenters: Record<string, GeoPoint> = {
  Смоленск: { latitude: 54.782, longitude: 32.045 },
  Сочи: { latitude: 43.585, longitude: 39.724 },
  Москва: { latitude: 55.756, longitude: 37.617 },
  "Санкт-Петербург": { latitude: 59.939, longitude: 30.316 },
  Брянск: { latitude: 53.243, longitude: 34.364 },
  Калуга: { latitude: 54.514, longitude: 36.262 },
  Тверь: { latitude: 56.859, longitude: 35.912 },
  Воронеж: { latitude: 51.661, longitude: 39.2 },
  Краснодар: { latitude: 45.035, longitude: 38.975 },
  Туапсе: { latitude: 44.098, longitude: 39.074 },
  Новороссийск: { latitude: 44.723, longitude: 37.769 },
  Майкоп: { latitude: 44.609, longitude: 40.106 },
  "Ростов-на-Дону": { latitude: 47.222, longitude: 39.72 },
  "Нижний Новгород": { latitude: 56.327, longitude: 44.006 },
  Казань: { latitude: 55.796, longitude: 49.106 },
  Самара: { latitude: 53.195, longitude: 50.1 },
  Пермь: { latitude: 58.01, longitude: 56.229 },
  Екатеринбург: { latitude: 56.838, longitude: 60.597 },
  Новосибирск: { latitude: 55.03, longitude: 82.92 },
  // Belarus: the map and routes cover it on a par with Russia.
  Минск: { latitude: 53.902, longitude: 27.562 },
  Витебск: { latitude: 55.184, longitude: 30.202 },
  Орша: { latitude: 54.509, longitude: 30.426 },
  Могилёв: { latitude: 53.894, longitude: 30.331 },
  Гомель: { latitude: 52.424, longitude: 31.014 },
  Мозырь: { latitude: 52.049, longitude: 29.245 },
  Гродно: { latitude: 53.669, longitude: 23.813 },
  Брест: { latitude: 52.098, longitude: 23.734 },
};
export interface NearbyLocation extends EnduroLocation {
  distanceKm: number;
}
export interface NearbyTrack {
  id: string;
  title: string;
  city: string;
  difficulty: "easy" | "medium" | "hard";
  distanceM: number;
  author: Profile;
  distanceKm: number;
  anchor: Coordinate;
}
export interface NearbyRide extends Ride {
  distanceKm: number;
  anchor: Coordinate;
}
export interface NearbyResult {
  center: GeoPoint;
  radiusKm: NearbyRadius;
  locations: NearbyLocation[];
  tracks: NearbyTrack[];
  rides: NearbyRide[];
  truncated: { locations: boolean; tracks: boolean; rides: boolean };
}
const obj = (
  properties: Record<string, unknown>,
  required = Object.keys(properties),
) => ({ type: "object", additionalProperties: false, properties, required });
const text = (max: number, min = 0) => ({
  type: "string",
  maxLength: max,
  minLength: min,
});
const uuid = { type: "string", format: "uuid" },
  time = { type: "string", format: "date-time" },
  difficulty = { type: "string", enum: ["easy", "medium", "hard"] },
  distance = { type: "number", minimum: 0 },
  coordinate = {
    type: "array",
    items: { type: "number" },
    minItems: 2,
    maxItems: 2,
  };
const profile = obj({
  id: uuid,
  handle: text(24),
  displayName: text(60),
  city: text(80),
  level: { type: "string", enum: ["beginner", "amateur", "pro"] },
  bio: text(600),
});
const center = obj({
  latitude: { type: "number", minimum: -85, maximum: 85 },
  longitude: { type: "number", minimum: -180, maximum: 180 },
});
export const nearbySchemas = {
  query: obj(
    {
      ...center.properties,
      radiusKm: {
        type: "integer",
        enum: [...nearbyRadii],
        default: defaultNearbyRadius,
      },
    },
    ["latitude", "longitude"],
  ),
};
export const nearbyResponses = {
  result: obj({
    center,
    radiusKm: { type: "integer", enum: [...nearbyRadii] },
    locations: {
      type: "array",
      maxItems: nearbyLimit,
      items: obj({
        id: uuid,
        author: profile,
        title: text(140),
        description: text(3000),
        city: text(80),
        latitude: { type: "number" },
        longitude: { type: "number" },
        difficulty,
        accessNotes: text(1500),
        status: { type: "string", const: "published" },
        createdAt: time,
        updatedAt: time,
        distanceKm: distance,
      }),
    },
    tracks: {
      type: "array",
      maxItems: nearbyLimit,
      items: obj({
        id: uuid,
        title: text(140),
        city: text(80),
        difficulty,
        distanceM: distance,
        author: profile,
        distanceKm: distance,
        anchor: coordinate,
      }),
    },
    rides: {
      type: "array",
      maxItems: nearbyLimit,
      items: obj({
        ...adventureResponses.ride.properties,
        distanceKm: distance,
        anchor: coordinate,
      }),
    },
    truncated: obj({
      locations: { type: "boolean" },
      tracks: { type: "boolean" },
      rides: { type: "boolean" },
    }),
  }),
};
