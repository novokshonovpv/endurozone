import { useEffect, useState, type FormEvent } from "react";
import {
  announcementStatuses,
  type Announcement,
  type AnnouncementDraft,
  type AnnouncementInput,
  type AnnouncementStatus,
  type Page,
  type Ride,
  type Session,
} from "@enduro/contracts";
import { api } from "./api.ts";
import { ErrorBox, Icon, Loading, Modal, ShareButton } from "./ui.tsx";
// Сообщество · Мероприятия: one calendar of race announcements (from organisers' public posts,
// published by moderators) and upcoming community rides, grouped by month.
type Item =
  | { type: "race"; day: string; race: Announcement }
  | { type: "ride"; day: string; ride: Ride };
const localDay = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const dateOf = (day: string) => new Date(`${day}T12:00:00`);
const month = (day: string) =>
  dateOf(day).toLocaleDateString("ru-RU", { month: "long", year: "numeric" });
const weekday = (day: string) =>
  dateOf(day).toLocaleDateString("ru-RU", { weekday: "short" });
const filters = [
  ["all", "Все"],
  ["race", "Гонки"],
  ["ride", "Покатушки"],
] as const;
export function Events({
  session,
  notify,
}: {
  session: Session | null;
  notify: (message: string) => void;
}) {
  const moderator = session?.user.role === "moderator";
  const [races, setRaces] = useState<Announcement[]>([]),
    [rides, setRides] = useState<Ride[]>([]),
    [next, setNext] = useState<number | null>(null),
    [busy, setBusy] = useState(true),
    [error, setError] = useState(""),
    [show, setShow] = useState<(typeof filters)[number][0]>("all"),
    [editor, setEditor] = useState<
      Announcement | AnnouncementDraft | "new" | null
    >(null),
    [drafts, setDrafts] = useState<AnnouncementDraft[]>([]),
    [checking, setChecking] = useState(false);
  const loadDrafts = async () => {
    if (!moderator) return;
    try {
      setDrafts(
        (
          await api<{ items: AnnouncementDraft[] }>(
            "/moderation/announcement-drafts",
          )
        ).items,
      );
    } catch (e) {
      setError((e as Error).message);
    }
  };
  useEffect(() => {
    void loadDrafts();
  }, [moderator]);
  const checkChannel = async () => {
    setChecking(true);
    setError("");
    try {
      const r = await api<{ checked: number; added: number }>(
        "/moderation/announcement-drafts/refresh",
        { method: "POST" },
      );
      notify(
        r.added
          ? `Новых черновиков: ${r.added}.`
          : "Новых анонсов в канале нет.",
      );
      await loadDrafts();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setChecking(false);
    }
  };
  const dismiss = async (d: AnnouncementDraft) => {
    try {
      await api(`/moderation/announcement-drafts/${d.id}/dismiss`, {
        method: "POST",
      });
      setDrafts((old) => old.filter((x) => x.id !== d.id));
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const loadRides = async (offset = 0) => {
    const p = await api<Page<Ride>>(`/rides?offset=${offset}`);
    setRides((old) => (offset ? [...old, ...p.items] : p.items));
    setNext(p.nextOffset);
  };
  const load = async () => {
    setBusy(true);
    setError("");
    try {
      const [a] = await Promise.all([
        api<Page<Announcement>>("/announcements?limit=50"),
        loadRides(),
      ]);
      setRaces(a.items);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => {
    void load();
  }, [session?.user.id]);
  const more = async () => {
    setBusy(true);
    try {
      await loadRides(next!);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const hide = async (a: Announcement) => {
    if (!window.confirm(`Скрыть анонс «${a.title}»?`)) return;
    try {
      await api(`/announcements/${a.id}`, { method: "DELETE" });
      setRaces((old) => old.filter((x) => x.id !== a.id));
      notify("Анонс скрыт.");
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const now = Date.now();
  const items: Item[] = [
    ...(show === "ride"
      ? []
      : races.map((race) => ({
          type: "race" as const,
          day: race.startsOn,
          race,
        }))),
    ...(show === "race"
      ? []
      : rides
          .filter(
            (r) => r.status === "open" && new Date(r.startsAt).getTime() > now,
          )
          .map((ride) => ({
            type: "ride" as const,
            day: localDay(new Date(ride.startsAt)),
            ride,
          }))),
  ].sort((a, b) => a.day.localeCompare(b.day));
  const groups = new Map<string, Item[]>();
  for (const i of items)
    groups.set(month(i.day), [...(groups.get(month(i.day)) ?? []), i]);
  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">АНОНСЫ</p>
          <h1>Мероприятия</h1>
          <p className="muted">
            Гонки и соревнования в России и Беларуси и выезды сообщества. Даты и
            регламент уточняйте по ссылке на источник.
          </p>
        </div>
        {moderator ? (
          <button className="button" onClick={() => setEditor("new")}>
            <Icon name="plus" size={17} />
            Добавить анонс
          </button>
        ) : (
          <a className="button" href={session ? "#tracks" : "#register"}>
            <Icon name="plus" size={17} />
            Собрать выезд
          </a>
        )}
      </div>
      {moderator && (
        <DraftQueue
          drafts={drafts}
          checking={checking}
          check={checkChannel}
          review={(d) => setEditor(d)}
          dismiss={dismiss}
        />
      )}
      <div className="chip-row" role="group" aria-label="Что показать">
        {filters.map(([value, label]) => (
          <button
            key={value}
            className={`chip ${show === value ? "active" : ""}`}
            aria-pressed={show === value}
            onClick={() => setShow(value)}
          >
            {label}
          </button>
        ))}
      </div>
      <ErrorBox message={error} />
      {busy && !races.length && !rides.length ? (
        <Loading />
      ) : !items.length && !error ? (
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
        [...groups].map(([title, list]) => (
          <section className="event-month" key={title}>
            <h2>{title}</h2>
            <div className="event-list">
              {list.map((i) =>
                i.type === "race" ? (
                  <RaceCard
                    key={i.race.id}
                    race={i.race}
                    moderator={moderator}
                    edit={() => setEditor(i.race)}
                    hide={() => hide(i.race)}
                  />
                ) : (
                  <RideCard key={i.ride.id} ride={i.ride} day={i.day} />
                ),
              )}
            </div>
          </section>
        ))
      )}
      {next !== null && show !== "race" && (
        <button
          className="button outline load-more"
          disabled={busy}
          onClick={more}
        >
          {busy ? "Загружаем…" : "Ещё покатушки"}
        </button>
      )}
      <p className="muted event-source">
        Анонсы гонок собраны из открытых публикаций организаторов, в том числе
        канала{" "}
        <a href="https://t.me/raceenduro" target="_blank" rel="noreferrer">
          «Гонки эндуро»
        </a>
        . Нашли ошибку — напишите через «Отзыв».
      </p>
      {editor && (
        <AnnouncementEditor
          race={editor === "new" || "postText" in editor ? undefined : editor}
          draft={editor !== "new" && "postText" in editor ? editor : undefined}
          close={() => setEditor(null)}
          done={(a) => {
            if (editor !== "new" && "postText" in editor)
              setDrafts((old) => old.filter((x) => x.id !== editor.id));
            setRaces((old) =>
              [...old.filter((x) => x.id !== a.id), a].sort((x, y) =>
                x.startsOn.localeCompare(y.startsOn),
              ),
            );
            setEditor(null);
            notify("Анонс сохранён.");
          }}
        />
      )}
    </>
  );
}
function DateBadge({ day, until }: { day: string; until?: string | null }) {
  const end = until && until !== day ? dateOf(until).getDate() : null;
  return (
    <span className="event-date">
      <strong>
        {dateOf(day).getDate()}
        {end !== null && <span className="event-until">–{end}</span>}
      </strong>
      <small>{weekday(day)}</small>
    </span>
  );
}
function RaceCard({
  race,
  moderator,
  edit,
  hide,
}: {
  race: Announcement;
  moderator: boolean;
  edit: () => void;
  hide: () => void;
}) {
  return (
    <article
      className={`card event-card race-card ${race.status === "cancelled" ? "is-cancelled" : ""}`}
    >
      <DateBadge day={race.startsOn} until={race.endsOn} />
      <span className="event-body">
        <span className="event-tags">
          <span className="tag kind-rental">Гонка</span>
          {race.status !== "scheduled" && (
            <span className="tag">{announcementStatuses[race.status]}</span>
          )}
        </span>
        <h3>{race.title}</h3>
        <p>
          {race.region}
          {race.place && ` · ${race.place}`}
          {race.discipline && ` · ${race.discipline}`}
        </p>
        {race.classes && <small>Классы: {race.classes}</small>}
        {race.note && <small className="event-note">{race.note}</small>}
        <span className="event-actions">
          <a href={race.sourceUrl} target="_blank" rel="noreferrer">
            Анонс и регистрация ↗
          </a>
          <ShareButton path={`race/${race.id}`} title={race.title} />
          {moderator && (
            <>
              <button className="text-button" onClick={edit}>
                Изменить
              </button>
              <button className="text-button danger-text" onClick={hide}>
                Скрыть
              </button>
            </>
          )}
        </span>
      </span>
    </article>
  );
}
function RideCard({ ride, day }: { ride: Ride; day: string }) {
  const d = new Date(ride.startsAt);
  return (
    <a className="card event-card" href={`#ride/${ride.id}`}>
      <DateBadge day={day} />
      <span className="event-body">
        <span className="event-tags">
          <span className="tag kind-guide">Покатушка</span>
        </span>
        <h3>{ride.title}</h3>
        <p>
          {ride.city} · {ride.trackTitle} ·{" "}
          {d.toLocaleTimeString("ru-RU", {
            hour: "2-digit",
            minute: "2-digit",
          })}
        </p>
        <small>
          {ride.acceptedCount} / {ride.capacity} участников ·{" "}
          {ride.organizer.displayName}
        </small>
      </span>
      <Icon name="arrow" size={18} />
    </a>
  );
}
function AnnouncementEditor({
  race,
  draft,
  close,
  done,
}: {
  race?: Announcement;
  /** A channel draft: its guess fills the form, saving publishes it. */
  draft?: AnnouncementDraft;
  close: () => void;
  done: (a: Announcement) => void;
}) {
  const initial: Partial<AnnouncementInput> | undefined = race ?? draft?.guess;
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const s = (k: string) => String(f.get(k) ?? "").trim();
    const body: AnnouncementInput = {
      title: s("title"),
      startsOn: s("startsOn"),
      endsOn: s("endsOn") || null,
      region: s("region"),
      place: s("place"),
      discipline: s("discipline"),
      classes: s("classes"),
      sourceUrl: s("sourceUrl"),
      status: s("status") as AnnouncementStatus,
      note: s("note"),
    };
    setBusy(true);
    setError("");
    try {
      done(
        await api<Announcement>(
          race
            ? `/announcements/${race.id}`
            : draft
              ? `/moderation/announcement-drafts/${draft.id}/publish`
              : "/announcements",
          { method: race ? "PATCH" : "POST", body },
        ),
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      title={
        race
          ? "Изменить анонс"
          : draft
            ? "Проверить и опубликовать"
            : "Новый анонс гонки"
      }
      close={close}
    >
      <form onSubmit={submit}>
        <ErrorBox message={error} />
        <label>
          Название
          <input
            name="title"
            required
            minLength={3}
            maxLength={140}
            defaultValue={initial?.title}
          />
        </label>
        <div className="form-grid">
          <label>
            Начало
            <input
              name="startsOn"
              type="date"
              required
              defaultValue={initial?.startsOn}
            />
          </label>
          <label>
            Окончание (если несколько дней)
            <input
              name="endsOn"
              type="date"
              defaultValue={initial?.endsOn ?? ""}
            />
          </label>
        </div>
        <div className="form-grid">
          <label>
            Регион
            <input
              name="region"
              required
              minLength={2}
              maxLength={120}
              defaultValue={initial?.region}
              placeholder="Смоленская область"
            />
          </label>
          <label>
            Место
            <input
              name="place"
              maxLength={160}
              defaultValue={initial?.place}
              placeholder="Населённый пункт или площадка"
            />
          </label>
        </div>
        <div className="form-grid">
          <label>
            Дисциплина
            <input
              name="discipline"
              maxLength={80}
              defaultValue={initial?.discipline}
              placeholder="Эндуро, хард-эндуро, кантри-кросс"
            />
          </label>
          <label>
            Статус
            <select name="status" defaultValue={initial?.status ?? "scheduled"}>
              {Object.entries(announcementStatuses).map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
          </label>
        </div>
        <label>
          Классы
          <input
            name="classes"
            maxLength={200}
            defaultValue={initial?.classes}
            placeholder="Золото, Серебро, Бронза"
          />
        </label>
        <label>
          Ссылка на анонс организатора
          <input
            name="sourceUrl"
            type="url"
            required
            pattern="https://.*"
            maxLength={300}
            defaultValue={initial?.sourceUrl}
            placeholder="https://t.me/…"
          />
        </label>
        <label>
          Примечание
          <input
            name="note"
            maxLength={300}
            defaultValue={initial?.note}
            placeholder="Например: перенесена с 24 октября"
          />
        </label>
        <button className="button" disabled={busy}>
          {busy ? "Сохраняем…" : "Сохранить"}
        </button>
      </form>
    </Modal>
  );
}

function DraftQueue({
  drafts,
  checking,
  check,
  review,
  dismiss,
}: {
  drafts: AnnouncementDraft[];
  checking: boolean;
  check: () => void;
  review: (d: AnnouncementDraft) => void;
  dismiss: (d: AnnouncementDraft) => void;
}) {
  return (
    <section className="card draft-queue">
      <div className="draft-head">
        <div>
          <h2>
            Черновики из канала <span className="tag">{drafts.length}</span>
          </h2>
          <p className="muted">
            Новые анонсы гонок — канал читается раз в 6 часов. Проверьте даты и
            место, затем опубликуйте. Видно только модераторам.
          </p>
        </div>
        <button
          className="button outline small"
          disabled={checking}
          onClick={check}
        >
          {checking ? "Проверяем…" : "Проверить канал"}
        </button>
      </div>
      {drafts.length ? (
        <ul className="draft-list">
          {drafts.map((d) => (
            <li key={d.id}>
              <div className="draft-text">
                <strong>{d.guess.title || "Без названия"}</strong>
                <small>
                  {d.guess.startsOn
                    ? `${dateOf(d.guess.startsOn).toLocaleDateString("ru-RU", { day: "numeric", month: "long" })}${d.guess.endsOn ? ` — ${dateOf(d.guess.endsOn).toLocaleDateString("ru-RU", { day: "numeric", month: "long" })}` : ""}`
                    : "дата не распознана"}
                  {" · "}
                  {d.guess.region || "регион не распознан"}
                  {d.guess.status === "cancelled" && " · отмена"}
                </small>
                <details>
                  <summary>Текст поста</summary>
                  <p className="plain-text">{d.postText}</p>
                </details>
              </div>
              <div className="draft-actions">
                <a href={d.sourceUrl} target="_blank" rel="noreferrer">
                  Пост ↗
                </a>
                <button className="button small" onClick={() => review(d)}>
                  Проверить и опубликовать
                </button>
                <button className="text-button" onClick={() => dismiss(d)}>
                  Не нужно
                </button>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted">Новых черновиков нет.</p>
      )}
    </section>
  );
}

/** Home page: the nearest races, a step away from the full calendar. */
export function UpcomingRaces() {
  const [races, setRaces] = useState<Announcement[] | null>(null);
  useEffect(() => {
    let alive = true;
    api<Page<Announcement>>("/announcements?limit=8")
      .then((p) => {
        if (alive)
          setRaces(p.items.filter((a) => a.status !== "cancelled").slice(0, 4));
      })
      .catch(() => {
        // The home page stays useful without this block.
        if (alive) setRaces([]);
      });
    return () => {
      alive = false;
    };
  }, []);
  if (!races?.length) return null;
  return (
    <section className="upcoming-races" aria-label="Ближайшие гонки">
      <div className="section-heading">
        <div>
          <p className="eyebrow">АНОНСЫ</p>
          <h2>Ближайшие гонки</h2>
        </div>
        <a className="button outline small" href="#events">
          Все мероприятия
          <Icon name="arrow" size={16} />
        </a>
      </div>
      <div className="upcoming-list">
        {races.map((r) => (
          <a className="card upcoming-race" href="#events" key={r.id}>
            <DateBadge day={r.startsOn} until={r.endsOn} />
            <span className="event-body">
              <h3>{r.title}</h3>
              <p>
                {r.region}
                {r.place && ` · ${r.place}`}
              </p>
              {r.status === "postponed" && (
                <small className="event-note">Перенесено</small>
              )}
            </span>
          </a>
        ))}
      </div>
    </section>
  );
}
