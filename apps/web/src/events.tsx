import { useEffect, useState } from "react";
import type { Page, Ride, Session } from "@enduro/contracts";
import { api } from "./api.ts";
import { ErrorBox, Icon, Loading } from "./ui.tsx";
// Сообщество · Мероприятия: announcements of upcoming open rides, grouped by month.
// The rides themselves live in Маршруты · Покатушки; this is the calendar view of them.
const month = (d: Date) =>
  d.toLocaleDateString("ru-RU", { month: "long", year: "numeric" });
export function Events({ session }: { session: Session | null }) {
  const [rides, setRides] = useState<Ride[]>([]),
    [next, setNext] = useState<number | null>(null),
    [busy, setBusy] = useState(true),
    [error, setError] = useState("");
  const load = async (offset = 0) => {
    setBusy(true);
    setError("");
    try {
      const p = await api<Page<Ride>>(`/rides?offset=${offset}`);
      setRides((old) => (offset ? [...old, ...p.items] : p.items));
      setNext(p.nextOffset);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => {
    void load();
  }, [session?.user.id]);
  const now = Date.now();
  const upcoming = rides.filter(
    (r) => r.status === "open" && new Date(r.startsAt).getTime() > now,
  );
  const groups = new Map<string, Ride[]>();
  for (const r of upcoming) {
    const key = month(new Date(r.startsAt));
    groups.set(key, [...(groups.get(key) ?? []), r]);
  }
  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">АНОНСЫ</p>
          <h1>Мероприятия</h1>
          <p className="muted">
            Ближайшие выезды сообщества во всех городах. Соревнования и слёты
            публикуются в новостях.
          </p>
        </div>
        <a className="button" href={session ? "#tracks" : "#register"}>
          <Icon name="plus" size={17} />
          Собрать выезд
        </a>
      </div>
      <ErrorBox message={error} />
      {busy && !rides.length ? (
        <Loading />
      ) : !upcoming.length && !error ? (
        <div className="card empty-state">
          <span className="feature-icon">
            <Icon name="route" size={30} />
          </span>
          <h3>Ближайших мероприятий пока нет</h3>
          <p>
            Выберите трек на карте и соберите компанию — анонс появится здесь.
          </p>
          <a className="button outline" href="#nearby">
            Открыть карту
            <Icon name="arrow" size={17} />
          </a>
        </div>
      ) : (
        [...groups].map(([title, items]) => (
          <section className="event-month" key={title}>
            <h2>{title}</h2>
            <div className="event-list">
              {items.map((r) => {
                const d = new Date(r.startsAt);
                return (
                  <a
                    className="card event-card"
                    href={`#ride/${r.id}`}
                    key={r.id}
                  >
                    <span className="event-date">
                      <strong>{d.getDate()}</strong>
                      <small>
                        {d.toLocaleDateString("ru-RU", { weekday: "short" })}
                      </small>
                    </span>
                    <span className="event-body">
                      <h3>{r.title}</h3>
                      <p>
                        {r.city} · {r.trackTitle} ·{" "}
                        {d.toLocaleTimeString("ru-RU", {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </p>
                      <small>
                        {r.acceptedCount} / {r.capacity} участников ·{" "}
                        {r.organizer.displayName}
                      </small>
                    </span>
                    <Icon name="arrow" size={18} />
                  </a>
                );
              })}
            </div>
          </section>
        ))
      )}
      {next !== null && (
        <button
          className="button outline load-more"
          disabled={busy}
          onClick={() => load(next)}
        >
          {busy ? "Загружаем…" : "Показать ещё"}
        </button>
      )}
    </>
  );
}
