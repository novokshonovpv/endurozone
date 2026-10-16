import type { Database } from "./database.ts";
// «Покатушка уже скоро»: about a day before the start the organizer and accepted riders get
// one notice to check the meeting point and the weather. Each ride is reminded once; rides
// that are cancelled, hidden or on an unpublished track are skipped.
export async function sendRideReminders(db: Database) {
  return db.transaction(async (tx) => {
    const rides = await tx.query(
      "UPDATE rides r SET reminded_at=now() FROM tracks t WHERE t.id=r.track_id AND r.status='open' AND NOT r.hidden AND t.status='published' AND r.reminded_at IS NULL AND r.starts_at BETWEEN now()+interval '2 hours' AND now()+interval '30 hours' RETURNING r.id,r.organizer_id",
    );
    let sent = 0;
    for (const r of rides) {
      const added = await tx.query(
        "INSERT INTO notifications(id,user_id,message,path) SELECT gen_random_uuid(),u.user_id,'Покатушка уже скоро: проверьте точку сбора и прогноз погоды','ride/'||$1 FROM (SELECT $2::uuid AS user_id UNION SELECT m.user_id FROM ride_members m WHERE m.ride_id=$1 AND m.status='accepted') u RETURNING id",
        [r.id, r.organizer_id],
      );
      sent += added.length;
    }
    return { rides: rides.length, sent };
  });
}
