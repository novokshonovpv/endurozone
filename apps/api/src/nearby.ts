import type { FastifyInstance } from "fastify";
import {
  nearbySchemas,
  nearbyResponses,
  nearbyLimit,
  defaultNearbyRadius,
  responses,
  type Coordinate,
  type NearbyRadius,
  type NearbyResult,
  type TrackGeometry,
} from "@enduro/contracts";
import type { Database } from "./database.ts";
import { profileOf } from "./auth.ts";
import { distance } from "./gpx.ts";
import { locationSelect, locationOf } from "./locations.ts";
import { rideSelect, rideOf } from "./adventure.ts";
import { blockedBetween } from "./blocks.ts";
// About 1 km: the search centre is never more precise than this, in memory or in responses.
export const coarse = (n: number) => Math.round(n * 100) / 100;
const km = (m: number) => Math.round(m / 100) / 10;
// Candidate cap before exact distances; documented pilot-scale limit.
const candidates = 1000;
function nearest(geometry: TrackGeometry, from: Coordinate) {
  let best = Infinity,
    anchor: Coordinate = geometry.coordinates[0][0];
  for (const segment of geometry.coordinates)
    for (const p of segment) {
      const d = distance(from, p);
      if (d < best) {
        best = d;
        anchor = p;
      }
    }
  return { meters: best, anchor };
}
export function nearbyRoutes(app: FastifyInstance, db: Database) {
  app.get<{
    Querystring: {
      latitude: number;
      longitude: number;
      radiusKm?: NearbyRadius;
    };
  }>(
    "/api/nearby",
    {
      config: { rateLimit: { max: 60, timeWindow: "1 minute" } },
      schema: {
        tags: ["Nearby"],
        querystring: nearbySchemas.query,
        response: {
          200: nearbyResponses.result,
          400: responses.error,
          429: responses.error,
        },
      },
    },
    async (req): Promise<NearbyResult> => {
      const latitude = coarse(req.query.latitude),
        longitude = coarse(req.query.longitude),
        radiusKm = req.query.radiusKm ?? defaultNearbyRadius,
        from: Coordinate = [longitude, latitude],
        // Places, tracks and rides of riders in a block with the viewer are left out.
        viewer = req.authContext?.user.id ?? null;
      const dLat = radiusKm / 111.2,
        dLng = Math.min(
          180,
          radiusKm /
            (111.2 * Math.max(0.01, Math.cos((latitude * Math.PI) / 180))),
        );
      const box = [
        latitude - dLat,
        latitude + dLat,
        longitude - dLng,
        longitude + dLng,
      ];
      // Exact great-circle distance in SQL; the bounding box only narrows the scan.
      const located = await db.query(
        `SELECT * FROM (SELECT x.*, 2*6371.0088*asin(least(1,sqrt(power(sin(radians(x.latitude-$5)/2),2)+cos(radians($5))*cos(radians(x.latitude))*power(sin(radians(x.longitude-$6)/2),2)))) AS distance_km FROM (${locationSelect} WHERE l.status='published' AND l.latitude BETWEEN $1 AND $2 AND l.longitude BETWEEN $3 AND $4 AND NOT ${blockedBetween("$9::uuid", "l.author_id")}) x) d WHERE d.distance_km<=$7 ORDER BY d.distance_km,d.id LIMIT $8`,
        [...box, latitude, longitude, radiusKm, nearbyLimit + 1, viewer],
      );
      const trackRows = await db.query(
        `SELECT t.id,t.title,t.city,t.difficulty,t.distance_m,t.geometry,t.author_id,u.handle,u.display_name,u.level,u.bio,u.city AS author_city FROM tracks t JOIN users u ON u.id=t.author_id WHERE t.status='published' AND t.max_lat>=$1 AND t.min_lat<=$2 AND t.max_lng>=$3 AND t.min_lng<=$4 AND NOT ${blockedBetween("$6::uuid", "t.author_id")} ORDER BY t.created_at DESC,t.id LIMIT $5`,
        [...box, candidates, viewer],
      );
      const near = new Map<string, { km: number; anchor: Coordinate }>();
      for (const t of trackRows) {
        const n = nearest(t.geometry, from);
        if (n.meters <= radiusKm * 1000)
          near.set(t.id, { km: km(n.meters), anchor: n.anchor });
      }
      const tracks = trackRows
        .filter((t) => near.has(t.id))
        .map((t) => ({
          id: t.id,
          title: t.title,
          city: t.city,
          difficulty: t.difficulty,
          distanceM: t.distance_m,
          author: profileOf({ ...t, id: t.author_id, city: t.author_city }),
          distanceKm: near.get(t.id)!.km,
          anchor: near.get(t.id)!.anchor,
        }))
        .sort(
          (a, b) => a.distanceKm - b.distanceKm || a.id.localeCompare(b.id),
        );
      // Rides are placed by their published track only; the private meeting point is never read.
      const rideRows = near.size
        ? await db.query(
            `${rideSelect} WHERE r.status='open' AND NOT r.hidden AND r.starts_at>now() AND t.status='published' AND r.track_id=ANY($1::uuid[]) AND NOT ${blockedBetween("$3::uuid", "r.organizer_id")} ORDER BY r.starts_at,r.id LIMIT $2`,
            [[...near.keys()], candidates, viewer],
          )
        : [];
      const rides = rideRows
        .map((r) => ({
          ...rideOf(r),
          distanceKm: near.get(r.track_id)!.km,
          anchor: near.get(r.track_id)!.anchor,
        }))
        .sort(
          (a, b) =>
            a.distanceKm - b.distanceKm ||
            a.startsAt.localeCompare(b.startsAt) ||
            a.id.localeCompare(b.id),
        );
      return {
        center: { latitude, longitude },
        radiusKm,
        locations: located.slice(0, nearbyLimit).map((r) => ({
          ...locationOf(r),
          distanceKm: Math.round(Number(r.distance_km) * 10) / 10,
        })),
        tracks: tracks.slice(0, nearbyLimit),
        rides: rides.slice(0, nearbyLimit),
        truncated: {
          locations: located.length > nearbyLimit,
          tracks: tracks.length > nearbyLimit || trackRows.length >= candidates,
          rides: rides.length > nearbyLimit || rideRows.length >= candidates,
        },
      };
    },
  );
}
