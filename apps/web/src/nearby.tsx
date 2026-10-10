import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  cityCenters,
  defaultNearbyRadius,
  difficulties,
  nearbyRadii,
  type GeoPoint,
  type NearbyRadius,
  type NearbyResult,
  type Session,
} from "@enduro/contracts";
import { api } from "./api.ts";
import { Icon, ErrorBox, Loading } from "./ui.tsx";
import { MapCanvas } from "./map.tsx";
import { rideDate } from "./adventure.tsx";
// The browser never keeps or sends a centre more precise than about 1 km.
const coarse = (p: GeoPoint): GeoPoint => ({
  latitude: Math.round(p.latitude * 100) / 100,
  longitude: Math.round(p.longitude * 100) / 100,
});
const km = (n: number) =>
  `≈ ${n.toLocaleString("ru-RU", { maximumFractionDigits: 1 })} км`;
type Center = GeoPoint & { label: string };
export function Nearby({ session }: { session: Session | null }) {
  const home =
    session && cityCenters[session.user.city] ? session.user.city : "Смоленск";
  const [center, setCenter] = useState<Center>({
      ...cityCenters[home],
      label: home,
    }),
    [radius, setRadius] = useState<NearbyRadius>(defaultNearbyRadius),
    [choosing, setChoosing] = useState(false),
    [locating, setLocating] = useState(false),
    [result, setResult] = useState<NearbyResult | null>(null),
    [busy, setBusy] = useState(true),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [selected, setSelected] = useState(""),
    [retry, setRetry] = useState(0);
  const cards = useRef<Record<string, HTMLElement | null>>({});
  useEffect(() => {
    let alive = true;
    setBusy(true);
    setError("");
    const q = new URLSearchParams({
      latitude: String(center.latitude),
      longitude: String(center.longitude),
      radiusKm: String(radius),
    });
    api<NearbyResult>(`/nearby?${q}`)
      .then((r) => {
        if (alive) setResult(r);
      })
      .catch((e) => {
        if (alive) setError(e.message);
      })
      .finally(() => {
        if (alive) setBusy(false);
      });
    return () => {
      alive = false;
    };
  }, [center.latitude, center.longitude, radius, retry]);
  function locate() {
    setNotice("");
    if (!navigator.geolocation) {
      setNotice(
        "Браузер не определяет местоположение. Выберите город или точку на карте.",
      );
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (p) => {
        setLocating(false);
        setChoosing(false);
        setCenter({
          ...coarse({
            latitude: p.coords.latitude,
            longitude: p.coords.longitude,
          }),
          label: "Моё местоположение",
        });
      },
      (e) => {
        setLocating(false);
        setNotice(
          e.code === e.PERMISSION_DENIED
            ? "Доступ к местоположению не разрешён. Выберите город или точку на карте — поиск работает и так."
            : "Не удалось определить местоположение. Выберите город или точку на карте.",
        );
      },
      { timeout: 10000, maximumAge: 300000, enableHighAccuracy: false },
    );
  }
  const total = result
    ? result.locations.length + result.tracks.length + result.rides.length
    : 0;
  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">КУДА ПОЕХАТЬ</p>
          <h1>Рядом</h1>
          <p className="muted">
            Проверенные места, опубликованные треки и ближайшие покатушки в
            выбранном радиусе.
          </p>
        </div>
      </div>
      <section
        className="card nearby-controls"
        aria-label="Центр и радиус поиска"
      >
        <button className="button small" disabled={locating} onClick={locate}>
          <Icon name="route" size={16} />
          {locating ? "Определяем…" : "Моё местоположение"}
        </button>
        <label>
          Город
          <select
            value={cityCenters[center.label] ? center.label : ""}
            onChange={(e) => {
              if (!e.target.value) return;
              setChoosing(false);
              setNotice("");
              setCenter({
                ...cityCenters[e.target.value],
                label: e.target.value,
              });
            }}
          >
            {!cityCenters[center.label] && (
              <option value="">{center.label}</option>
            )}
            {Object.keys(cityCenters).map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </label>
        <label>
          Радиус
          <select
            value={radius}
            onChange={(e) => setRadius(Number(e.target.value) as NearbyRadius)}
          >
            {nearbyRadii.map((r) => (
              <option key={r} value={r}>
                {r} км
              </option>
            ))}
          </select>
        </label>
        <button
          className={`button small ${choosing ? "" : "outline"}`}
          aria-pressed={choosing}
          onClick={() => setChoosing(!choosing)}
        >
          {choosing ? "Нажмите на карту…" : "Точка на карте"}
        </button>
        <p className="nearby-privacy">
          <Icon name="lock" size={14} />
          Центр поиска округляется примерно до 1 км, используется только для
          этого запроса и нигде не сохраняется.
        </p>
      </section>
      {notice && <p className="card form-note">{notice}</p>}
      <div className="card map-card">
        <MapCanvas
          items={result?.locations ?? []}
          center={center}
          choosing={choosing}
          onPoint={(p) => {
            setChoosing(false);
            setNotice("");
            setCenter({ ...coarse(p), label: "Точка на карте" });
          }}
          onSelect={(id) => {
            setSelected(id);
            cards.current[id]?.scrollIntoView({
              behavior: "smooth",
              block: "center",
            });
          }}
        />
        <p className="map-caption">
          Центр: {center.label} · {radius} км. На карте отмечены места; треки и
          покатушки — в списке ниже.
        </p>
      </div>
      <ErrorBox message={error} />
      {error && (
        <button className="text-button" onClick={() => setRetry((x) => x + 1)}>
          Попробовать снова
        </button>
      )}
      {busy && !result ? (
        <Loading />
      ) : (
        result &&
        !error && (
          <div className={`nearby-results ${busy ? "is-busy" : ""}`}>
            {!total ? (
              <div className="card empty-state">
                <Icon name="mountain" size={32} />
                <h3>В радиусе {radius} км пока ничего нет</h3>
                <p>
                  Увеличьте радиус или выберите другой центр. Знаете хорошее
                  место? Предложите его на карте локаций.
                </p>
                <a className="button outline" href="#map">
                  Предложить место
                </a>
              </div>
            ) : (
              <>
                <NearbySection
                  title="Покатушки"
                  count={result.rides.length}
                  truncated={result.truncated.rides}
                  empty="Ближайших открытых покатушек в этом радиусе нет."
                >
                  {result.rides.map((r) => (
                    <a
                      className="card nearby-item"
                      href={`#ride/${r.id}`}
                      key={r.id}
                    >
                      <span className="nearby-distance">
                        {km(r.distanceKm)}
                      </span>
                      <strong>{r.title}</strong>
                      <small>
                        {rideDate(r)} · {r.trackTitle} · мест: {r.acceptedCount}
                        /{r.capacity}
                      </small>
                    </a>
                  ))}
                </NearbySection>
                <NearbySection
                  title="Места"
                  count={result.locations.length}
                  truncated={result.truncated.locations}
                  empty="Проверенных мест в этом радиусе пока нет."
                >
                  {result.locations.map((l) => (
                    <article
                      className={`card nearby-item ${selected === l.id ? "selected" : ""}`}
                      key={l.id}
                      ref={(el) => {
                        cards.current[l.id] = el;
                      }}
                    >
                      <span className="nearby-distance">
                        {km(l.distanceKm)}
                      </span>
                      <strong>{l.title}</strong>
                      <small>
                        {l.city} · {difficulties[l.difficulty]}
                      </small>
                      <p>{l.description}</p>
                      <p className="muted">Доступ: {l.accessNotes}</p>
                    </article>
                  ))}
                </NearbySection>
                <NearbySection
                  title="GPX-треки"
                  count={result.tracks.length}
                  truncated={result.truncated.tracks}
                  empty="Опубликованных треков в этом радиусе пока нет."
                >
                  {result.tracks.map((t) => (
                    <a
                      className="card nearby-item"
                      href={`#track/${t.id}`}
                      key={t.id}
                    >
                      <span className="nearby-distance">
                        {km(t.distanceKm)}
                      </span>
                      <strong>{t.title}</strong>
                      <small>
                        {t.city} · {difficulties[t.difficulty]} · длина{" "}
                        {(t.distanceM / 1000).toLocaleString("ru-RU", {
                          maximumFractionDigits: 1,
                        })}{" "}
                        км
                      </small>
                    </a>
                  ))}
                </NearbySection>
                <p className="muted nearby-note">
                  Расстояние по прямой. Для треков и покатушек — до ближайшей
                  точки публичной части трека; точка сбора в поиске не
                  используется.
                </p>
              </>
            )}
          </div>
        )
      )}
    </>
  );
}
function NearbySection({
  title,
  count,
  truncated,
  empty,
  children,
}: {
  title: string;
  count: number;
  truncated: boolean;
  empty: string;
  children: ReactNode;
}) {
  return (
    <section className="nearby-section">
      <div className="section-heading">
        <h2>
          {title} <span className="tag">{count}</span>
        </h2>
      </div>
      {count ? (
        <div className="nearby-list">{children}</div>
      ) : (
        <p className="muted">{empty}</p>
      )}
      {truncated && (
        <p className="form-note">
          Показаны ближайшие {count}. Остальные дальше от центра поиска.
        </p>
      )}
    </section>
  );
}
