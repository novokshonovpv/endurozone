import { useEffect, useState, type FormEvent } from "react";
import {
  type Track,
  type TrackPreview,
  type TrackInput,
  type Ride,
  type RideMember,
  type RideInput,
  type Page,
  type Session,
  type ModerationAction,
  rideTimezones,
  rideTimezoneNames,
  difficulties,
  locationStatuses,
} from "@enduro/contracts";
import { api } from "./api.ts";
import { ErrorBox, Loading, Modal, Icon, ShareButton } from "./ui.tsx";
import { MapCanvas } from "./map.tsx";
import { ReportButton } from "./report.tsx";
import { Weather } from "./weather.tsx";
import { go } from "./routing.ts";
import { RideChat } from "./ride-chat.tsx";
type Props = { session: Session | null; notify: (text: string) => void };
const emptyLocations: never[] = [];
const message = (e: unknown) => (e as Error).message;
const km = (m: number) =>
  (m / 1000).toLocaleString("ru-RU", { maximumFractionDigits: 1 }) + " км";
const stateNames: Record<string, string> = {
  none: "Вы ещё не подали заявку",
  organizer: "Вы организатор",
  pending: "Заявка на рассмотрении",
  accepted: "Участие подтверждено",
  declined: "Заявка отклонена",
  left: "Вы вышли из покатушки",
};
export const rideDate = (r: Ride) =>
  new Intl.DateTimeFormat("ru-RU", {
    timeZone: r.timezone,
    day: "numeric",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(r.startsAt));
function TrackMap({ preview }: { preview: TrackPreview }) {
  const first = preview.geometry.coordinates[0]?.[0] ?? [32.045, 54.782];
  return (
    <div className="card map-card">
      <MapCanvas
        items={emptyLocations}
        center={{ latitude: first[1], longitude: first[0] }}
        choosing={false}
        onPoint={() => {}}
        onSelect={() => {}}
        geometry={preview.geometry}
      />
      <p className="map-caption">
        Публичная версия · {km(preview.distanceM)} · {preview.pointCount} точек.
        Начало и конец каждого сегмента скрыты в радиусе {preview.trimM} м.
        Разрывы не соединяются.
      </p>
    </div>
  );
}
export function Tracks({
  session,
  notify,
  upload = false,
}: Props & {
  /** #tracks?upload=1 opens the GPX form at once. */ upload?: boolean;
}) {
  const [page, setPage] = useState<Page<Track>>({
      items: [],
      nextOffset: null,
    }),
    [mine, setMine] = useState(false),
    [city, setCity] = useState(""),
    [editor, setEditor] = useState(upload && Boolean(session)),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(true);
  async function load(offset = 0) {
    setBusy(true);
    try {
      const p = await api<Page<Track>>(
        `${mine ? "/me/tracks" : "/tracks"}?limit=12&offset=${offset}${city ? `&city=${encodeURIComponent(city)}` : ""}`,
      );
      setPage((v) => ({
        ...p,
        items: offset ? [...v.items, ...p.items] : p.items,
      }));
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    let alive = true;
    setBusy(true);
    setError("");
    api<Page<Track>>(
      `${mine ? "/me/tracks" : "/tracks"}?limit=12${city ? `&city=${encodeURIComponent(city)}` : ""}`,
    )
      .then((p) => {
        if (alive) setPage(p);
      })
      .catch((e) => {
        if (alive) setError(message(e));
      })
      .finally(() => {
        if (alive) setBusy(false);
      });
    return () => {
      alive = false;
    };
  }, [mine, city, session?.user.id]);
  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">МАРШРУТЫ СООБЩЕСТВА</p>
          <h1>Треки эндуро</h1>
          <p className="muted">
            Сохраните маршрут, проверьте публичную версию и поделитесь после
            модерации.
          </p>
          <a className="text-button" href="#add-track">
            Как записать и добавить свою трассу →
          </a>
        </div>
        {session ? (
          <button className="button" onClick={() => setEditor(!editor)}>
            <Icon name="plus" />
            Загрузить GPX
          </button>
        ) : (
          <a className="button" href="#login">
            Войти и загрузить трек
          </a>
        )}
      </div>
      <div className="map-toolbar">
        <label>
          Город
          <input
            value={city}
            onChange={(e) => setCity(e.target.value)}
            placeholder="Все города"
            maxLength={80}
          />
        </label>
        {session && (
          <button
            className="button outline small"
            onClick={() => setMine(!mine)}
          >
            {mine ? "Опубликованные треки" : "Мои треки"}
          </button>
        )}
      </div>
      <ErrorBox message={error} />
      {editor && session && (
        <TrackUpload
          session={session}
          notify={notify}
          close={() => setEditor(false)}
        />
      )}
      <h2>{mine ? "Мои треки" : "Опубликованные маршруты"}</h2>
      {busy && !page.items.length ? (
        <Loading />
      ) : !page.items.length ? (
        <div className="card location-editor">
          <h3>Первые маршруты ещё впереди</h3>
          <p className="muted">
            Загрузите GPX 1.1 с понятными условиями доступа. После проверки он
            появится здесь.
          </p>
        </div>
      ) : (
        page.items.map((t) => (
          <a className="card location-row" href={`#track/${t.id}`} key={t.id}>
            <span className="tag">{locationStatuses[t.status]}</span>
            <h3>{t.title}</h3>
            <p>
              {t.city} · {difficulties[t.difficulty]} · {km(t.distanceM)}
            </p>
            <small>{t.author.displayName}</small>
          </a>
        ))
      )}
      {page.nextOffset !== null && (
        <button
          className="button outline"
          disabled={busy}
          onClick={() => load(page.nextOffset!)}
        >
          Ещё треки
        </button>
      )}
    </>
  );
}
function TrackUpload({
  session,
  notify,
  close,
}: {
  session: Session;
  notify: Props["notify"];
  close: () => void;
}) {
  const [gpx, setGpx] = useState(""),
    [trimM, setTrim] = useState(300),
    [preview, setPreview] = useState<TrackPreview | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [reading, setReading] = useState(false);
  async function previewFile() {
    setBusy(true);
    setError("");
    try {
      if (!gpx) throw new Error("Выберите GPX-файл.");
      setPreview(
        await api<TrackPreview>("/tracks/preview", {
          method: "POST",
          body: { gpx, trimM },
        }),
      );
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!preview) {
      setError("Сначала проверьте публичную версию на карте.");
      return;
    }
    const f = new FormData(e.currentTarget);
    const b: TrackInput = {
      title: String(f.get("title")),
      description: String(f.get("description")),
      city: String(f.get("city")),
      accessNotes: String(f.get("accessNotes")),
      difficulty: f.get("difficulty") as TrackInput["difficulty"],
      publicationConsent: true,
      gpx,
      trimM,
    };
    setBusy(true);
    setError("");
    try {
      const t = await api<Track>("/tracks", { method: "POST", body: b });
      notify("Трек отправлен на проверку. Оригинал доступен только вам.");
      go(`track/${t.id}`);
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="card location-editor">
      <h2>Загрузить маршрут</h2>
      <p className="muted">
        GPX 1.1, до 400 КБ и 5000 точек. Оригинал сохраняется приватно. В
        публичную версию попадает только очищенная линия маршрута.
      </p>
      <ErrorBox message={error} />
      <form className="location-form" onSubmit={submit}>
        <label>
          GPX-файл
          <input
            type="file"
            accept=".gpx,application/gpx+xml"
            disabled={reading || busy}
            onChange={async (e) => {
              const file = e.target.files?.[0];
              setPreview(null);
              setGpx("");
              setError("");
              if (!file) return;
              if (file.size > 400000) {
                setError("Файл должен быть не больше 400 КБ.");
                return;
              }
              setReading(true);
              try {
                setGpx(await file.text());
              } catch {
                setError("Не удалось прочитать файл.");
              } finally {
                setReading(false);
              }
            }}
          />
        </label>
        <label>
          Радиус скрытия начала и конца, м
          <input
            type="number"
            value={trimM}
            min={100}
            max={2000}
            step={100}
            onChange={(e) => {
              setTrim(Number(e.target.value));
              setPreview(null);
            }}
          />
        </label>
        <button
          className="button outline"
          type="button"
          disabled={busy || reading}
          onClick={previewFile}
        >
          {busy ? "Обрабатываем…" : "Проверить публичную версию"}
        </button>
        {preview && (
          <>
            <TrackMap preview={preview} />
            <p className="muted">
              Проверьте карту: скрытие краёв не гарантирует анонимность
              маршрута. Если оставшаяся линия раскрывает частное место,
              подготовьте другой GPX.
            </p>
          </>
        )}
        <label>
          Название маршрута
          <input name="title" minLength={3} maxLength={140} required />
        </label>
        <div className="location-fields">
          <label>
            Город
            <input
              name="city"
              defaultValue={session.user.city}
              minLength={2}
              maxLength={80}
              required
            />
          </label>
          <label>
            Сложность
            <select name="difficulty">
              {Object.entries(difficulties).map(([v, t]) => (
                <option key={v} value={v}>
                  {t}
                </option>
              ))}
            </select>
          </label>
        </div>
        <label>
          Описание
          <textarea
            name="description"
            rows={3}
            minLength={10}
            maxLength={3000}
            required
          />
        </label>
        <label>
          Условия доступа
          <textarea
            name="accessNotes"
            rows={3}
            minLength={10}
            maxLength={1500}
            required
          />
        </label>
        <label className="consent">
          <input type="checkbox" required />Я проверил публичную версию и
          согласен на публикацию очищенного маршрута после модерации.
        </label>
        <div className="location-actions">
          <button className="button" disabled={busy || reading || !preview}>
            Отправить трек на проверку
          </button>
          <button type="button" className="text-button" onClick={close}>
            Отмена
          </button>
        </div>
      </form>
    </section>
  );
}
export function TrackDetail({ id, session, notify }: Props & { id: string }) {
  const [track, setTrack] = useState<Track | null>(null),
    [error, setError] = useState(""),
    [decisions, setDecisions] = useState<ModerationAction[]>([]),
    [busy, setBusy] = useState(true),
    [creating, setCreating] = useState(false);
  useEffect(() => {
    let alive = true;
    setBusy(true);
    setError("");
    setDecisions([]);
    api<Track>(`/tracks/${id}`)
      .then(async (t) => {
        if (!alive) return;
        setTrack(t);
        if (
          session &&
          (session.user.id === t.author.id || session.user.role === "moderator")
        ) {
          const p = await api<{ items: ModerationAction[] }>(
            `/tracks/${id}/decisions`,
          );
          if (alive) setDecisions(p.items);
        }
      })
      .catch((e) => {
        if (alive) {
          setError(message(e));
          setTrack(null);
        }
      })
      .finally(() => {
        if (alive) setBusy(false);
      });
    return () => {
      alive = false;
    };
  }, [id, session?.user.id]);
  async function downloadOriginal() {
    try {
      const p = await api<{ gpx: string }>(`/tracks/${id}/original`);
      const url = URL.createObjectURL(
        new Blob([p.gpx], { type: "application/gpx+xml" }),
      );
      const a = document.createElement("a");
      a.href = url;
      a.download = `private-original-${id}.gpx`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
      setError(message(e));
    }
  }
  return (
    <>
      <a className="text-button" href="#tracks">
        ← Все треки
      </a>
      <ErrorBox message={error} />
      {busy ? (
        <Loading />
      ) : (
        track && (
          <>
            <div className="page-heading">
              <div>
                <p className="eyebrow">
                  {track.city} · {difficulties[track.difficulty]}
                </p>
                <h1>{track.title}</h1>
                <span className="tag">{locationStatuses[track.status]}</span>
                {track.status === "published" && (
                  <ShareButton path={`track/${track.id}`} title={track.title} />
                )}
              </div>
              {session && track.status === "published" && (
                <button
                  className="button"
                  onClick={() => setCreating(!creating)}
                >
                  Организовать покатушку
                </button>
              )}
            </div>
            <TrackMap preview={track} />
            <article className="card location-editor">
              <h2>О маршруте</h2>
              <p className="plain-text">{track.description}</p>
              <h3>Условия доступа</h3>
              <p className="plain-text">{track.accessNotes}</p>
              <p className="muted">
                Автор: {track.author.displayName}. Проверка публикации не
                заменяет разрешение на въезд.
              </p>
              <div className="location-actions">
                <a
                  className="button outline small"
                  href={`/api/tracks/${id}/gpx`}
                  download
                >
                  Скачать публичный GPX
                </a>
                {session?.user.id === track.author.id && (
                  <button className="text-button" onClick={downloadOriginal}>
                    Скачать мой приватный оригинал
                  </button>
                )}
              </div>
              {session && track.status === "published" && (
                <ReportButton
                  targetType="track"
                  targetId={id}
                  notify={notify}
                />
              )}{" "}
              {!!decisions.length && (
                <>
                  <h3>Результат проверки</h3>
                  {decisions.map((d) => (
                    <p className="plain-text" key={d.id}>
                      {d.reason}
                    </p>
                  ))}
                </>
              )}
            </article>
            {creating && session && (
              <RideEditor track={track} notify={notify} />
            )}
          </>
        )
      )}
    </>
  );
}
export function TrackModeration({ notify }: { notify: Props["notify"] }) {
  const [page, setPage] = useState<Page<Track>>({
      items: [],
      nextOffset: null,
    }),
    [preview, setPreview] = useState<Track | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  async function load(offset = 0) {
    setBusy(true);
    try {
      const p = await api<Page<Track>>(
        `/moderation/tracks?limit=12&offset=${offset}`,
      );
      setPage((v) => ({
        ...p,
        items: offset ? [...v.items, ...p.items] : p.items,
      }));
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    void load();
  }, []);
  async function decide(e: FormEvent<HTMLFormElement>, id: string) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setBusy(true);
    setError("");
    try {
      await api(`/moderation/tracks/${id}/decision`, {
        method: "POST",
        body: {
          action: f.get("action"),
          reason: f.get("reason"),
          expectedStatus: "pending",
        },
      });
      notify("Решение по треку сохранено.");
      await load();
    } catch (e) {
      setError(message(e));
      setBusy(false);
    }
  }
  return (
    <>
      <h2>Треки на проверке</h2>
      <ErrorBox message={error} />
      {!busy && !page.items.length && <p className="muted">Очередь пуста.</p>}
      {page.items.map((t) => (
        <article className="card moderation-card" key={t.id}>
          <h3>{t.title}</h3>
          <p>
            {t.city} · {km(t.distanceM)} · {difficulties[t.difficulty]}
          </p>
          <p className="plain-text">{t.description}</p>
          <strong>Условия доступа</strong>
          <p className="plain-text">{t.accessNotes}</p>
          <button
            className="button outline small"
            onClick={() => setPreview(t)}
          >
            Проверить геометрию
          </button>
          <form className="decision-form" onSubmit={(e) => decide(e, t.id)}>
            <label>
              Решение по треку
              <select name="action">
                <option value="publish">Опубликовать</option>
                <option value="reject">Отклонить</option>
              </select>
            </label>
            <label>
              Причина решения по треку
              <textarea
                name="reason"
                required
                minLength={10}
                maxLength={1000}
              />
            </label>
            <button className="button small" disabled={busy}>
              Сохранить решение по треку
            </button>
          </form>
        </article>
      ))}
      {page.nextOffset !== null && (
        <button
          className="button outline"
          disabled={busy}
          onClick={() => load(page.nextOffset!)}
        >
          Ещё треки на проверке
        </button>
      )}
      {preview && (
        <Modal title={preview.title} close={() => setPreview(null)}>
          <TrackMap preview={preview} />
        </Modal>
      )}
    </>
  );
}
function RideEditor({
  track,
  notify,
}: {
  track: Track;
  notify: Props["notify"];
}) {
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setBusy(true);
    setError("");
    try {
      const b: RideInput = {
        trackId: track.id,
        title: String(f.get("title")),
        description: String(f.get("description")),
        meetingNotes: String(f.get("meetingNotes")),
        startsAt: new Date(String(f.get("date"))).toISOString(),
        timezone: String(f.get("timezone")),
        capacity: Number(f.get("capacity")),
      };
      const r = await api<Ride>("/rides", { method: "POST", body: b });
      notify("Покатушка создана. Подтверждайте заявки в её карточке.");
      go(`ride/${r.id}`);
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="card location-editor">
      <h2>Организовать покатушку</h2>
      <p className="muted">
        Маршрут: {track.title}. Организатор входит в лимит участников.
      </p>
      <ErrorBox message={error} />
      <form className="location-form" onSubmit={submit}>
        <label>
          Название покатушки
          <input name="title" required minLength={3} maxLength={140} />
        </label>
        <label>
          Описание и требования к участникам
          <textarea
            name="description"
            required
            minLength={10}
            maxLength={3000}
          />
        </label>
        <label>
          Дата и время на вашем устройстве
          <input name="date" type="datetime-local" required />
        </label>
        <p className="muted">
          Время будет сохранено как конкретный момент. Часовой пояс ниже задаёт
          отображение события; он не меняет введённое время устройства.
        </p>
        <div className="location-fields">
          <label>
            Часовой пояс события
            <select name="timezone" defaultValue="Europe/Moscow">
              {rideTimezones.map((z) => (
                <option key={z} value={z}>
                  {rideTimezoneNames[z]}
                </option>
              ))}
            </select>
          </label>
          <label>
            Всего участников, включая вас
            <input
              name="capacity"
              type="number"
              min={2}
              max={50}
              defaultValue={6}
              required
            />
          </label>
        </div>
        <label>
          Точка сбора и контакт для встречи
          <textarea
            name="meetingNotes"
            required
            minLength={10}
            maxLength={2000}
            rows={3}
          />
        </label>
        <p className="muted">
          Точка сбора видна вам и подтверждённым участникам. В публичное
          описание её не добавляйте.
        </p>
        <button className="button" disabled={busy}>
          {busy ? "Создаём…" : "Создать покатушку"}
        </button>
      </form>
    </section>
  );
}
export function Rides({ session }: Props) {
  const [page, setPage] = useState<Page<Ride>>({ items: [], nextOffset: null }),
    [mine, setMine] = useState(false),
    [city, setCity] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(true);
  async function load(offset = 0) {
    setBusy(true);
    try {
      const p = await api<Page<Ride>>(
        `${mine ? "/me/rides" : "/rides"}?offset=${offset}${city ? `&city=${encodeURIComponent(city)}` : ""}`,
      );
      setPage((v) => ({
        ...p,
        items: offset ? [...v.items, ...p.items] : p.items,
      }));
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    let alive = true;
    setBusy(true);
    setError("");
    api<Page<Ride>>(
      `${mine ? "/me/rides" : "/rides"}${city ? `?city=${encodeURIComponent(city)}` : ""}`,
    )
      .then((p) => {
        if (alive) setPage(p);
      })
      .catch((e) => {
        if (alive) setError(message(e));
      })
      .finally(() => {
        if (alive) setBusy(false);
      });
    return () => {
      alive = false;
    };
  }, [mine, city, session?.user.id]);
  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">ВЫЕЗЖАЕМ ВМЕСТЕ</p>
          <h1>Покатушки</h1>
          <p className="muted">Выберите маршрут и компанию по своему уровню.</p>
        </div>
        <a className="button" href="#tracks">
          Выбрать маршрут для выезда
        </a>
      </div>
      <div className="map-toolbar">
        <label>
          Город
          <input
            placeholder="Все города"
            maxLength={80}
            value={city}
            onChange={(e) => setCity(e.target.value)}
          />
        </label>
        {session && (
          <button
            className="button outline small"
            onClick={() => setMine(!mine)}
          >
            {mine ? "Предстоящие выезды" : "Мои покатушки"}
          </button>
        )}
      </div>
      <ErrorBox message={error} />
      {busy && !page.items.length ? (
        <Loading />
      ) : !page.items.length ? (
        <div className="card location-editor">
          <h3>Пока нет покатушек</h3>
          <p>Создайте выезд из карточки опубликованного трека.</p>
        </div>
      ) : (
        page.items.map((r) => (
          <a className="card location-row" href={`#ride/${r.id}`} key={r.id}>
            <span className="tag">
              {r.status === "cancelled" ? "Отменена" : rideDate(r)}
            </span>
            <h3>{r.title}</h3>
            <p>
              {r.city} · {r.trackTitle}
            </p>
            <small>
              {r.acceptedCount} / {r.capacity} участников ·{" "}
              {r.organizer.displayName}
            </small>
          </a>
        ))
      )}
      {page.nextOffset !== null && (
        <button
          disabled={busy}
          className="button outline"
          onClick={() => load(page.nextOffset!)}
        >
          Ещё покатушки
        </button>
      )}
    </>
  );
}
export function RideDetail({ id, session, notify }: Props & { id: string }) {
  const [ride, setRide] = useState<Ride | null>(null),
    [status, setStatus] = useState("none"),
    [members, setMembers] = useState<RideMember[]>([]),
    [meeting, setMeeting] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(true),
    [cancel, setCancel] = useState(false);
  async function load() {
    setBusy(true);
    setError("");
    setMeeting("");
    setMembers([]);
    try {
      const r = await api<Ride>(`/rides/${id}`);
      setRide(r);
      if (session) {
        const m = await api<{ status: string }>(`/rides/${id}/membership`);
        setStatus(m.status);
        if (m.status === "organizer") {
          const p = await api<{ items: RideMember[] }>(`/rides/${id}/members`);
          setMembers(p.items);
        }
        if (
          m.status === "organizer" ||
          (m.status === "accepted" &&
            r.status === "open" &&
            new Date(r.startsAt) > new Date())
        ) {
          try {
            setMeeting(
              (await api<{ meetingNotes: string }>(`/rides/${id}/meeting`))
                .meetingNotes,
            );
          } catch {
            /* Concurrent cancellation or route hiding removes access. */
          }
        }
      } else setStatus("none");
    } catch (e) {
      setError(message(e));
      setRide(null);
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    void load();
  }, [id, session?.user.id]);
  async function action(path: string, body?: unknown) {
    setBusy(true);
    try {
      await api(`/rides/${id}/${path}`, {
        method: "POST",
        ...(body ? { body } : {}),
      });
      notify("Изменения сохранены.");
      setCancel(false);
      await load();
    } catch (e) {
      setError(message(e));
      setBusy(false);
    }
  }
  const upcoming =
    ride?.status === "open" &&
    !ride.hidden &&
    new Date(ride.startsAt) > new Date();
  return (
    <>
      <a className="text-button" href="#rides">
        ← Все покатушки
      </a>
      <ErrorBox message={error} />
      {!ride && busy ? (
        <Loading />
      ) : (
        ride && (
          <>
            <div className="page-heading">
              <div>
                <p className="eyebrow">
                  {ride.city} · время: {rideTimezoneNames[ride.timezone]}
                </p>
                <h1>{ride.title}</h1>
                <span className="tag">
                  {ride.hidden
                    ? "Скрыта модератором"
                    : ride.status === "cancelled"
                      ? "Отменена"
                      : rideDate(ride)}
                </span>
                {!ride.hidden && ride.status === "open" && (
                  <ShareButton path={`ride/${ride.id}`} title={ride.title} />
                )}
              </div>
              <span className="tag green">
                {ride.acceptedCount} / {ride.capacity} участников
              </span>
            </div>
            <article className="card location-editor">
              <p className="plain-text">{ride.description}</p>
              <p>Организатор: {ride.organizer.displayName}</p>
              {session && !ride.hidden && ride.status === "open" && (
                <ReportButton
                  targetType="ride"
                  targetId={ride.id}
                  notify={notify}
                />
              )}
              <a href={`#track/${ride.trackId}`}>Маршрут: {ride.trackTitle}</a>
              {upcoming && <RideWeather ride={ride} />}
              <p className="muted">{stateNames[status]}</p>
              {meeting ? (
                <>
                  <h3>Точка сбора · только для участников</h3>
                  <p className="plain-text">{meeting}</p>
                </>
              ) : (
                <p className="muted">
                  Точка сбора доступна после подтверждения участия
                  организатором.
                </p>
              )}
              <div className="location-actions">
                {!session ? (
                  <a className="button" href="#login">
                    Войти для подачи заявки
                  </a>
                ) : upcoming && ["none", "left"].includes(status) ? (
                  <button
                    className="button"
                    disabled={busy}
                    onClick={() => action("join")}
                  >
                    Подать заявку
                  </button>
                ) : null}
                {session && ["pending", "accepted"].includes(status) && (
                  <button
                    className="button outline"
                    disabled={busy}
                    onClick={() => action("leave")}
                  >
                    Отказаться от участия
                  </button>
                )}
                {status === "organizer" && ride.status === "open" && (
                  <button
                    className="text-button danger-text"
                    onClick={() => setCancel(!cancel)}
                  >
                    Отменить покатушку
                  </button>
                )}
                {cancel && (
                  <button
                    className="button danger"
                    disabled={busy}
                    onClick={() => action("cancel")}
                  >
                    Подтвердить отмену покатушки
                  </button>
                )}
              </div>
            </article>
            {session && (status === "organizer" || status === "accepted") && (
              <RideChat
                key={ride.id + status}
                rideId={ride.id}
                session={session}
                notify={notify}
              />
            )}
            {status === "organizer" && (
              <section className="card location-editor">
                <h2>Заявки участников</h2>
                <p className="muted">
                  Заявка не занимает место. Место закрепляется при
                  подтверждении; вы тоже входите в лимит.
                </p>
                {!members.length ? (
                  <p>Заявок пока нет.</p>
                ) : (
                  members.map((m) => (
                    <div className="ride-member" key={m.user.id}>
                      <div>
                        <strong>{m.user.displayName}</strong>
                        <p className="muted">
                          {m.user.city} · {stateNames[m.status]}
                        </p>
                      </div>
                      {m.status === "pending" && upcoming && (
                        <div className="location-actions">
                          <button
                            className="button small"
                            disabled={busy}
                            onClick={() =>
                              action(`members/${m.user.id}/decision`, {
                                action: "accept",
                              })
                            }
                          >
                            Принять {m.user.displayName}
                          </button>
                          <button
                            className="text-button"
                            disabled={busy}
                            onClick={() =>
                              action(`members/${m.user.id}/decision`, {
                                action: "decline",
                              })
                            }
                          >
                            Отклонить {m.user.displayName}
                          </button>
                        </div>
                      )}
                    </div>
                  ))
                )}
              </section>
            )}
          </>
        )
      )}
    </>
  );
}

/** Forecast for the ride day at the start of its published track. */
function RideWeather({ ride }: { ride: Ride }) {
  const [start, setStart] = useState<[number, number] | null>(null);
  useEffect(() => {
    let alive = true;
    api<Track>(`/tracks/${ride.trackId}`)
      .then((t) => {
        const first = t.geometry.coordinates[0]?.[0];
        if (alive && first) setStart(first);
      })
      .catch(() => {
        // Without the track the ride page simply has no forecast.
      });
    return () => {
      alive = false;
    };
  }, [ride.trackId]);
  if (!start) return null;
  const d = new Date(ride.startsAt);
  const day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  return <Weather latitude={start[1]} longitude={start[0]} day={day} />;
}
