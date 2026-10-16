import { useEffect, useState } from "react";
import {
  difficulties,
  locationKinds,
  type MyStats,
  type RiderStats,
} from "@enduro/contracts";
import { api } from "./api.ts";
import { Icon, formatDate } from "./ui.tsx";
// Rider statistics: public contributions on the rider page, personal marks in «Мой профиль».
const counters = (s: RiderStats) => [
  ["Мест добавил", s.placesAdded],
  ["Треков", s.tracksPublished],
  ["Собрал покатушек", s.ridesOrganized],
  ["Записей", s.postsPublic],
];
function Counters({ items }: { items: (string | number)[][] }) {
  return (
    <dl className="stat-grid">
      {items.map(([label, value]) => (
        <div key={label}>
          <dt>{label}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}
/** Public counters under a rider's name; nothing is shown while all are zero. */
export function RiderCounters({ handle }: { handle: string }) {
  const [s, setS] = useState<RiderStats | null>(null);
  useEffect(() => {
    let alive = true;
    api<RiderStats>(`/profiles/${handle}/stats`)
      .then((r) => {
        if (alive) setS(r);
      })
      .catch(() => {
        // The profile page works without the counters.
      });
    return () => {
      alive = false;
    };
  }, [handle]);
  if (!s || !Object.values(s).some(Boolean)) return null;
  return <Counters items={counters(s)} />;
}
/** «Моя статистика»: everything above plus own marks and rides, with the visited places. */
export function MyStatsPanel() {
  const [s, setS] = useState<MyStats | null>(null),
    [error, setError] = useState("");
  useEffect(() => {
    let alive = true;
    api<MyStats>("/me/stats")
      .then((r) => {
        if (alive) setS(r);
      })
      .catch((e) => {
        if (alive) setError((e as Error).message);
      });
    return () => {
      alive = false;
    };
  }, []);
  if (error) return <p className="muted">{error}</p>;
  if (!s) return null;
  return (
    <section className="card my-stats">
      <h2>Моя статистика</h2>
      <Counters
        items={[
          ["Был на местах", s.visits],
          ["Ездил на покатушки", s.ridesJoined],
          ...counters(s),
        ]}
      />
      <h3>Где я был</h3>
      {s.visited.length ? (
        <ul className="visited-list">
          {s.visited.map((v) => (
            <li key={v.id}>
              <a
                href={`#${v.kind === "spot" ? "map" : "services"}?place=${v.id}`}
              >
                <strong>{v.title}</strong>
                <small>
                  {v.city} · {locationKinds[v.kind]}
                  {v.difficulty &&
                    ` · моя оценка: ${difficulties[v.difficulty].toLowerCase()}`}
                  {" · "}
                  {formatDate(v.markedAt)}
                </small>
              </a>
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted">
          Отмечайте «Я был здесь» на карточках мест — они соберутся в этот
          список. Его видите только вы.
        </p>
      )}
      <a className="text-button" href="#nearby">
        <Icon name="route" size={16} /> Найти места рядом
      </a>
    </section>
  );
}
