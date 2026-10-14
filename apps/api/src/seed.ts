import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import type { AnnouncementInput, LocationKind } from "@enduro/contracts";
import type { Database } from "./database.ts";
// Starter content from open sources (OpenStreetMap venues, public race announcements).
// Each item has a stable key and is inserted once: edits and hiding by moderators stay.
export type SeedPlace = {
  key: string;
  kind: LocationKind;
  title: string;
  city: string;
  latitude: number;
  longitude: number;
  description: string;
  accessNotes: string;
  contacts?: string;
};
export type SeedAnnouncement = AnnouncementInput & { key: string };
const load = <T>(name: string): T[] =>
  JSON.parse(readFileSync(new URL(`../data/${name}`, import.meta.url), "utf8"));
// The author of starter content. It cannot sign in: the stored hash never matches.
export const teamHandle = "endurozone";
export async function seedContent(
  db: Database,
  places = load<SeedPlace>("seed-places.json"),
  announcements = load<SeedAnnouncement>("seed-announcements.json"),
) {
  return db.transaction(async (tx) => {
    await tx.query(
      "INSERT INTO users(id,email,password_hash,handle,display_name,city,level,bio) VALUES ($1,'team@enduro-zone.invalid','scrypt$disabled$',$2,'Команда Enduro.Zone','Смоленск','pro',$3) ON CONFLICT (handle) DO NOTHING",
      [
        randomUUID(),
        teamHandle,
        "Стартовые места из открытых данных и анонсы гонок. Нашли неточность — нажмите «Пожаловаться» на карточке.",
      ],
    );
    const [team] = await tx.query("SELECT id FROM users WHERE handle=$1", [
      teamHandle,
    ]);
    let addedPlaces = 0,
      addedAnnouncements = 0;
    for (const p of places) {
      const r = await tx.query(
        "INSERT INTO locations(id,author_id,title,description,city,latitude,longitude,difficulty,access_notes,kind,contacts,status,seed_key) VALUES ($1,$2,$3,$4,$5,$6,$7,NULL,$8,$9,$10,'published',$11) ON CONFLICT (seed_key) DO NOTHING RETURNING id",
        [
          randomUUID(),
          team.id,
          p.title,
          p.description,
          p.city,
          p.latitude,
          p.longitude,
          p.accessNotes,
          p.kind,
          p.contacts ?? "",
          p.key,
        ],
      );
      addedPlaces += r.length;
    }
    for (const a of announcements) {
      const r = await tx.query(
        "INSERT INTO event_announcements(id,title,starts_on,ends_on,region,place,discipline,classes,source_url,status,note,author_id,seed_key) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) ON CONFLICT (seed_key) DO NOTHING RETURNING id",
        [
          randomUUID(),
          a.title,
          a.startsOn,
          a.endsOn ?? null,
          a.region,
          a.place ?? "",
          a.discipline ?? "",
          a.classes ?? "",
          a.sourceUrl,
          a.status ?? "scheduled",
          a.note ?? "",
          team.id,
          a.key,
        ],
      );
      addedAnnouncements += r.length;
    }
    return { addedPlaces, addedAnnouncements };
  });
}
