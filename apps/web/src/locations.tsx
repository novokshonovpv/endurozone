import { useEffect, useRef, useState, type FormEvent } from "react";
import type { Map as GLMap, Marker as GLMarker } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import {
  difficulties,
  locationStatuses,
  reportReasons,
  type EnduroLocation,
  type LocationInput,
  type Page,
  type Session,
  type Report,
  type ModerationAction,
} from "@enduro/contracts";
import { api } from "./api.ts";
import { ErrorBox, Loading, Modal, Icon } from "./ui.tsx";

type Point = { latitude: number; longitude: number };
const cities = {
  Смоленск: { latitude: 54.782, longitude: 32.045 },
  Сочи: { latitude: 43.585, longitude: 39.724 },
};
type Props = { session: Session | null; notify: (message: string) => void };
const errorOf = (e: unknown) => (e as Error).message;

function MapCanvas({
  items,
  center,
  choosing,
  onPoint,
  onSelect,
}: {
  items: EnduroLocation[];
  center: Point;
  choosing: boolean;
  onPoint: (point: Point) => void;
  onSelect: (id: string) => void;
}) {
  const container = useRef<HTMLDivElement>(null),
    map = useRef<GLMap | null>(null),
    markers = useRef<GLMarker[]>([]);
  const actions = useRef({ choosing, onPoint, onSelect });
  actions.current = { choosing, onPoint, onSelect };
  const [error, setError] = useState("");
  useEffect(() => {
    let alive = true;
    import("maplibre-gl")
      .then((gl) => {
        if (!alive || !container.current) return;
        try {
          const instance = new gl.Map({
            container: container.current,
            center: [center.longitude, center.latitude],
            zoom: 9,
            style: {
              version: 8,
              sources: {
                osm: {
                  type: "raster",
                  tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
                  tileSize: 256,
                  maxzoom: 19,
                  attribution:
                    '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a>',
                },
              },
              layers: [{ id: "osm", type: "raster", source: "osm" }],
            },
          });
          map.current = instance;
          instance.addControl(
            new gl.NavigationControl({ showCompass: false }),
            "top-right",
          );
          instance.on("click", (e) => {
            if (actions.current.choosing)
              actions.current.onPoint({
                latitude: Number(e.lngLat.lat.toFixed(6)),
                longitude: Number(e.lngLat.lng.toFixed(6)),
              });
          });
          instance.on("error", () => {
            if (alive)
              setError(
                "Подложка карты недоступна. Список локаций и ввод координат продолжают работать.",
              );
          });
          instance.on("load", () => {
            if (alive) setError("");
          });
          // Initial markers are rendered by the separate effect after the library becomes ready.
          setReady(true);
        } catch {
          setError(
            "Карта не поддерживается этим браузером. Используйте список и ввод координат.",
          );
        }
      })
      .catch(() => {
        if (alive)
          setError("Не удалось загрузить карту. Используйте список локаций.");
      });
    return () => {
      alive = false;
      markers.current.forEach((m) => m.remove());
      map.current?.remove();
      map.current = null;
    };
  }, []);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    map.current?.flyTo({
      center: [center.longitude, center.latitude],
      zoom: 9,
    });
  }, [center]);
  useEffect(() => {
    let alive = true;
    import("maplibre-gl").then((gl) => {
      if (!alive || !map.current) return;
      markers.current.forEach((m) => m.remove());
      markers.current = items
        .filter((l) => l.status === "published")
        .map((l) => {
          const button = document.createElement("button");
          button.className = "location-pin";
          button.type = "button";
          button.textContent = "EZ";
          button.setAttribute("aria-label", l.title);
          button.addEventListener("click", (e) => {
            e.stopPropagation();
            actions.current.onSelect(l.id);
          });
          return new gl.Marker({ element: button })
            .setLngLat([l.longitude, l.latitude])
            .addTo(map.current!);
        });
    });
    return () => {
      alive = false;
    };
  }, [items, ready]);
  return (
    <>
      <div
        ref={container}
        className={`enduro-map maplibregl-map ${choosing ? "choosing" : ""}`}
        aria-label="Карта эндуро-локаций"
      />
      <ErrorBox message={error} />
    </>
  );
}

export function ReportButton({
  targetType,
  targetId,
  notify,
}: {
  targetType: "post" | "location";
  targetId: string;
  notify: Props["notify"];
}) {
  const [open, setOpen] = useState(false),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    setBusy(true);
    setError("");
    try {
      await api("/reports", {
        method: "POST",
        body: {
          targetType,
          targetId,
          reason: data.get("reason"),
          details: data.get("details"),
        },
      });
      setOpen(false);
      notify("Жалоба отправлена модератору.");
    } catch (e) {
      setError(errorOf(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <button
        className="text-button report-button"
        onClick={() => {
          setOpen(true);
          setError("");
        }}
      >
        Сообщить о проблеме
      </button>
      {open && (
        <Modal title="Сообщить о проблеме" close={() => setOpen(false)}>
          <form className="location-form" onSubmit={submit}>
            <ErrorBox message={error} />
            <label>
              Причина
              <select name="reason">
                {Object.entries(reportReasons).map(([v, t]) => (
                  <option key={v} value={v}>
                    {t}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Что произошло?
              <textarea
                name="details"
                rows={4}
                required
                minLength={10}
                maxLength={2000}
              />
            </label>
            <button className="button" disabled={busy}>
              {busy ? "Отправляем…" : "Отправить жалобу"}
            </button>
          </form>
        </Modal>
      )}
    </>
  );
}

export function Locations({ session, notify }: Props) {
  const [items, setItems] = useState<EnduroLocation[]>([]),
    [next, setNext] = useState<number | null>(null),
    [city, setCity] = useState(""),
    [mine, setMine] = useState(false),
    [busy, setBusy] = useState(true),
    [error, setError] = useState(""),
    [selected, setSelected] = useState<string | null>(null),
    [editor, setEditor] = useState(false),
    [saving, setSaving] = useState(false);
  const [center, setCenter] = useState<Point>(cities["Смоленск"]),
    [point, setPoint] = useState<Point | null>(null),
    [decisions, setDecisions] = useState<ModerationAction[]>([]);
  const detail = items.find((l) => l.id === selected);
  useEffect(() => {
    if (!session) setMine(false);
  }, [session]);
  async function load(offset = 0) {
    setBusy(true);
    setError("");
    try {
      const p = await api<Page<EnduroLocation>>(
        `${mine ? "/me/locations" : "/locations"}?limit=30&offset=${offset}${city ? `&city=${encodeURIComponent(city)}` : ""}`,
      );
      setItems((prev) => (offset ? [...prev, ...p.items] : p.items));
      setNext(p.nextOffset);
    } catch (e) {
      setError(errorOf(e));
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    let alive = true;
    setBusy(true);
    setError("");
    setSelected(null);
    api<Page<EnduroLocation>>(
      `${mine ? "/me/locations" : "/locations"}?limit=30${city ? `&city=${encodeURIComponent(city)}` : ""}`,
    )
      .then((p) => {
        if (alive) {
          setItems(p.items);
          setNext(p.nextOffset);
        }
      })
      .catch((e) => {
        if (alive) {
          setItems([]);
          setError(errorOf(e));
        }
      })
      .finally(() => {
        if (alive) setBusy(false);
      });
    return () => {
      alive = false;
    };
  }, [mine, city, session?.user.id]);
  useEffect(() => {
    let alive = true;
    setDecisions([]);
    if (
      detail &&
      (session?.user.id === detail.author.id ||
        session?.user.role === "moderator")
    )
      api<{ items: ModerationAction[] }>(`/locations/${detail.id}/decisions`)
        .then((p) => {
          if (alive) setDecisions(p.items);
        })
        .catch((e) => {
          if (alive) setError(errorOf(e));
        });
    return () => {
      alive = false;
    };
  }, [selected, session?.user.id]);
  function select(id: string) {
    setSelected(id);
    const l = items.find((l) => l.id === id);
    if (l) setCenter({ latitude: l.latitude, longitude: l.longitude });
  }
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const b: LocationInput = {
      title: String(f.get("title")),
      description: String(f.get("description")),
      city: String(f.get("city")),
      latitude: Number(f.get("latitude")),
      longitude: Number(f.get("longitude")),
      difficulty: f.get("difficulty") as LocationInput["difficulty"],
      accessNotes: String(f.get("accessNotes")),
      publicationConsent: true,
    };
    setSaving(true);
    setError("");
    try {
      await api("/locations", { method: "POST", body: b });
      setEditor(false);
      setPoint(null);
      setMine(true);
      setCity("");
      if (mine && !city) await load();
      notify(
        "Локация отправлена на проверку. До одобрения она видна только вам и модератору.",
      );
    } catch (e) {
      setError(errorOf(e));
    } finally {
      setSaving(false);
    }
  }
  function locate() {
    if (!navigator.geolocation) {
      setError("Браузер не поддерживает определение местоположения.");
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (p) => {
        setCenter({
          latitude: p.coords.latitude,
          longitude: p.coords.longitude,
        });
      },
      () =>
        setError(
          "Не удалось определить местоположение. Выберите город или переместите карту.",
        ),
      { timeout: 10000, maximumAge: 60000 },
    );
  }
  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">ТВОЯ ТЕРРИТОРИЯ</p>
          <h1>Где кататься?</h1>
          <p className="muted">
            Локации сообщества, условия доступа и уровень сложности.
          </p>
        </div>
        {session ? (
          <button
            className="button"
            onClick={() => {
              setEditor(!editor);
              setError("");
              setPoint(null);
            }}
          >
            <Icon name="plus" />
            Предложить локацию
          </button>
        ) : (
          <a className="button" href="#login">
            Войти и добавить место
          </a>
        )}
      </div>
      <div className="map-toolbar">
        <label>
          Город
          <select
            value={city}
            onChange={(e) => {
              setCity(e.target.value);
              if (e.target.value)
                setCenter(cities[e.target.value as keyof typeof cities]);
            }}
          >
            <option value="">Все города</option>
            <option>Смоленск</option>
            <option>Сочи</option>
          </select>
        </label>
        <button className="button outline small" onClick={locate}>
          Моя позиция
        </button>
        {session && (
          <button
            className="button outline small"
            aria-pressed={mine}
            onClick={() => setMine(!mine)}
          >
            {mine ? "Показать опубликованные" : "Мои предложения"}
          </button>
        )}
      </div>
      <ErrorBox message={error} />
      <div className="map-card card">
        <MapCanvas
          items={items}
          center={center}
          choosing={editor}
          onPoint={setPoint}
          onSelect={select}
        />
        <p className="map-caption">
          {editor
            ? "Нажмите на карту, чтобы выбрать точку, или введите координаты ниже."
            : "На карте показаны опубликованные места из текущего списка."}{" "}
          Проверка публикации не заменяет разрешение владельца территории.
        </p>
      </div>
      {editor && session && (
        <section className="card location-editor">
          <h2>Предложить место</h2>
          <p className="muted">
            Опишите условия въезда и источник разрешения. Не публикуйте частный
            адрес или место хранения мотоцикла.
          </p>
          <form className="location-form" onSubmit={submit}>
            <label>
              Название
              <input name="title" required minLength={3} maxLength={140} />
            </label>
            <div className="location-fields">
              <label>
                Город / ближайший населённый пункт
                <input
                  name="city"
                  defaultValue={city || session.user.city}
                  required
                  minLength={2}
                  maxLength={80}
                />
              </label>
              <label>
                Сложность
                <select name="difficulty">
                  {Object.entries(difficulties).map(([v, t]) => (
                    <option value={v} key={v}>
                      {t}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div
              className="location-fields"
              key={point ? `${point.latitude},${point.longitude}` : "manual"}
            >
              <label>
                Широта
                <input
                  name="latitude"
                  type="number"
                  step="any"
                  min={-90}
                  max={90}
                  required
                  defaultValue={point?.latitude}
                />
              </label>
              <label>
                Долгота
                <input
                  name="longitude"
                  type="number"
                  step="any"
                  min={-180}
                  max={180}
                  required
                  defaultValue={point?.longitude}
                />
              </label>
            </div>
            <label>
              Описание места
              <textarea
                name="description"
                rows={3}
                required
                minLength={10}
                maxLength={3000}
              />
            </label>
            <label>
              Условия доступа и разрешения
              <textarea
                name="accessNotes"
                rows={3}
                required
                minLength={10}
                maxLength={1500}
                placeholder="Кто разрешает въезд, когда можно кататься, какие ограничения действуют"
              />
            </label>
            <label className="consent">
              <input type="checkbox" required />Я согласен на публикацию этой
              точки и описания после проверки.
            </label>
            <div className="location-actions">
              <button className="button" disabled={saving}>
                {saving ? "Отправляем…" : "Отправить на проверку"}
              </button>
              <button
                className="text-button"
                type="button"
                onClick={() => setEditor(false)}
              >
                Отмена
              </button>
            </div>
          </form>
        </section>
      )}
      <div className="location-layout">
        <section>
          <h2>
            {mine ? "Мои предложения" : "Локации сообщества"}{" "}
            <span className="muted">{items.length}</span>
          </h2>
          {busy && !items.length ? (
            <Loading />
          ) : !items.length && !error ? (
            <div className="card empty-locations">
              <Icon name="mountain" size={36} />
              <h3>
                {mine
                  ? "Здесь появятся ваши предложения"
                  : "Первые места ещё впереди"}
              </h3>
              <p>
                Добавьте место с понятными условиями доступа. После проверки оно
                появится на карте.
              </p>
            </div>
          ) : (
            items.map((l) => (
              <button
                key={l.id}
                className={`card location-row ${selected === l.id ? "selected" : ""}`}
                onClick={() => select(l.id)}
              >
                <span className="tag">{difficulties[l.difficulty]}</span>
                <h3>{l.title}</h3>
                <p>{l.city}</p>
                <small>{locationStatuses[l.status]}</small>
              </button>
            ))
          )}
          {next !== null && (
            <button
              className="button outline"
              disabled={busy}
              onClick={() => load(next)}
            >
              Показать ещё
            </button>
          )}
        </section>
        <section className="card location-detail">
          {detail ? (
            <>
              <span className="tag green">
                {locationStatuses[detail.status]}
              </span>
              <h2>{detail.title}</h2>
              <p className="muted">
                {detail.city} · {difficulties[detail.difficulty]}
              </p>
              <p className="plain-text">{detail.description}</p>
              <h3>Условия доступа</h3>
              <p className="plain-text">{detail.accessNotes}</p>
              <p className="muted">
                {detail.latitude.toFixed(6)}, {detail.longitude.toFixed(6)} ·
                Автор: {detail.author.displayName}
              </p>
              {detail.status === "published" && session && (
                <ReportButton
                  targetType="location"
                  targetId={detail.id}
                  notify={notify}
                />
              )}
              <a
                className="text-button"
                href={`https://www.openstreetmap.org/?mlat=${detail.latitude}&mlon=${detail.longitude}#map=14/${detail.latitude}/${detail.longitude}`}
                target="_blank"
                rel="noreferrer"
              >
                Открыть в OpenStreetMap ↗
              </a>
              {decisions.length > 0 && (
                <>
                  <h3>Результат проверки</h3>
                  {decisions.map((d) => (
                    <p className="plain-text" key={d.id}>
                      {d.reason}
                    </p>
                  ))}
                </>
              )}
            </>
          ) : (
            <>
              <Icon name="route" size={32} />
              <h2>Выберите место</h2>
              <p className="muted">
                Откройте карточку в списке или нажмите на точку карты.
              </p>
            </>
          )}
        </section>
      </div>
    </>
  );
}

export function Moderation({ session, notify }: Props) {
  const [locations, setLocations] = useState<Page<EnduroLocation>>({
      items: [],
      nextOffset: null,
    }),
    [reports, setReports] = useState<Page<Report>>({
      items: [],
      nextOffset: null,
    }),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const allowed = session?.user.role === "moderator";
  async function load() {
    setBusy(true);
    setError("");
    try {
      const [l, r] = await Promise.all([
        api<Page<EnduroLocation>>("/moderation/locations?limit=30"),
        api<Page<Report>>("/moderation/reports?limit=30"),
      ]);
      setLocations(l);
      setReports(r);
    } catch (e) {
      setError(errorOf(e));
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    if (allowed) void load();
  }, [allowed]);
  async function more(kind: "locations" | "reports", offset: number) {
    setBusy(true);
    try {
      if (kind === "locations") {
        const p = await api<Page<EnduroLocation>>(
          `/moderation/locations?limit=30&offset=${offset}`,
        );
        setLocations((v) => ({ ...p, items: [...v.items, ...p.items] }));
      } else {
        const p = await api<Page<Report>>(
          `/moderation/reports?limit=30&offset=${offset}`,
        );
        setReports((v) => ({ ...p, items: [...v.items, ...p.items] }));
      }
    } catch (e) {
      setError(errorOf(e));
    } finally {
      setBusy(false);
    }
  }
  async function decide(
    e: FormEvent<HTMLFormElement>,
    kind: "locations" | "reports",
    id: string,
  ) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setBusy(true);
    setError("");
    try {
      await api(`/moderation/${kind}/${id}/decision`, {
        method: "POST",
        body: {
          action: f.get("action"),
          reason: f.get("reason"),
          ...(kind === "locations" ? { expectedStatus: "pending" } : {}),
        },
      });
      notify("Решение сохранено.");
      await load();
    } catch (e) {
      setError(errorOf(e));
      setBusy(false);
    }
  }
  if (!allowed)
    return (
      <div className="card location-editor">
        <h1>Модерация</h1>
        <p>Этот раздел доступен только назначенным модераторам.</p>
      </div>
    );
  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">ПРОВЕРКА СООБЩЕСТВА</p>
          <h1>Модерация</h1>
          <p className="muted">
            Каждое решение сохраняется с причиной и автором проверки.
          </p>
        </div>
        <button className="button outline" disabled={busy} onClick={load}>
          Обновить очередь
        </button>
      </div>
      <ErrorBox message={error} />
      {busy && <Loading />}
      <h2>Локации на проверке</h2>
      {!busy && !locations.items.length && (
        <p className="muted">Очередь пуста.</p>
      )}
      {locations.items.map((l) => (
        <article className="card moderation-card" key={l.id}>
          <span className="tag">
            {l.city} · {difficulties[l.difficulty]}
          </span>
          <h3>{l.title}</h3>
          <p className="plain-text">{l.description}</p>
          <strong>Условия доступа</strong>
          <p className="plain-text">{l.accessNotes}</p>
          <p className="muted">
            {l.latitude}, {l.longitude} · {l.author.displayName}
          </p>
          <a
            href={`https://www.openstreetmap.org/?mlat=${l.latitude}&mlon=${l.longitude}#map=14/${l.latitude}/${l.longitude}`}
            target="_blank"
            rel="noreferrer"
          >
            Проверить точку на карте ↗
          </a>
          <form
            className="decision-form"
            onSubmit={(e) => decide(e, "locations", l.id)}
          >
            <label>
              Решение
              <select name="action">
                <option value="publish">Опубликовать</option>
                <option value="reject">Отклонить</option>
              </select>
            </label>
            <label>
              Причина решения
              <textarea
                name="reason"
                required
                minLength={10}
                maxLength={1000}
              />
            </label>
            <button className="button small" disabled={busy}>
              Сохранить решение
            </button>
          </form>
        </article>
      ))}
      {locations.nextOffset !== null && (
        <button
          disabled={busy}
          className="button outline"
          onClick={() => more("locations", locations.nextOffset!)}
        >
          Ещё локации
        </button>
      )}
      <h2>Жалобы</h2>
      {!busy && !reports.items.length && (
        <p className="muted">Открытых жалоб нет.</p>
      )}
      {reports.items.map((r) => (
        <article className="card moderation-card" key={r.id}>
          <h3>
            {reportReasons[r.reason as keyof typeof reportReasons]} ·{" "}
            {r.targetType === "post" ? "Бортжурнал" : "Локация"}
          </h3>
          <p className="plain-text">{r.details}</p>
          {r.targetType === "post" ? (
            <a href={`#post/${r.targetId}`}>Открыть запись</a>
          ) : (
            <LocationReview id={r.targetId} />
          )}
          <form
            className="decision-form"
            onSubmit={(e) => decide(e, "reports", r.id)}
          >
            <label>
              Решение
              <select name="action">
                <option value="dismiss">Закрыть без скрытия</option>
                <option value="hide">Скрыть объект</option>
              </select>
            </label>
            <label>
              Причина решения
              <textarea
                name="reason"
                required
                minLength={10}
                maxLength={1000}
              />
            </label>
            <button className="button small" disabled={busy}>
              Сохранить решение
            </button>
          </form>
        </article>
      ))}
      {reports.nextOffset !== null && (
        <button
          disabled={busy}
          className="button outline"
          onClick={() => more("reports", reports.nextOffset!)}
        >
          Ещё жалобы
        </button>
      )}
    </>
  );
}
function LocationReview({ id }: { id: string }) {
  const [l, set] = useState<EnduroLocation | null>(null),
    [error, setError] = useState("");
  useEffect(() => {
    let alive = true;
    api<EnduroLocation>(`/locations/${id}`)
      .then((l) => {
        if (alive) set(l);
      })
      .catch((e) => {
        if (alive) setError(errorOf(e));
      });
    return () => {
      alive = false;
    };
  }, [id]);
  return (
    <>
      <ErrorBox message={error} />
      {l && (
        <>
          <strong>
            {l.title} · {locationStatuses[l.status]}
          </strong>
          <p className="plain-text">{l.description}</p>
          <p className="plain-text">{l.accessNotes}</p>
          <a
            href={`https://www.openstreetmap.org/?mlat=${l.latitude}&mlon=${l.longitude}#map=14/${l.latitude}/${l.longitude}`}
            target="_blank"
            rel="noreferrer"
          >
            Проверить точку ↗
          </a>
        </>
      )}
    </>
  );
}
