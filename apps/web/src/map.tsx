import { useEffect, useRef, useState, type FormEvent } from "react";
import type { Map as GLMap, Marker as GLMarker } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";
import {
  locationKinds,
  reportReasons,
  type EnduroLocation,
  type LocationKind,
  type TrackGeometry,
} from "@enduro/contracts";
import { api } from "./api.ts";
import { ErrorBox, Modal } from "./ui.tsx";
type Point = { latitude: number; longitude: number };
export type MapPin = {
  id: string;
  kind: "track" | "ride";
  title: string;
  coordinate: [number, number];
};
type Props = { notify: (message: string) => void };
const errorOf = (e: unknown) => (e as Error).message;
const noPins: MapPin[] = [];
// One letter per kind: the marker colour (CSS) and this letter tell them apart.
const pinText: Record<LocationKind, string> = {
  spot: "М",
  rental: "₽",
  guide: "Г",
  school: "Ш",
};
export function MapCanvas({
  items,
  center,
  choosing,
  onPoint,
  onSelect,
  geometry,
  pins = noPins,
}: {
  items: EnduroLocation[];
  center: Point;
  choosing: boolean;
  onPoint: (point: Point) => void;
  onSelect: (id: string) => void;
  geometry?: TrackGeometry;
  pins?: MapPin[];
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
          gl.setWorkerUrl(workerUrl);
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
    if (geometry) return;
    map.current?.flyTo({
      center: [center.longitude, center.latitude],
      zoom: 9,
    });
  }, [center.latitude, center.longitude, ready, Boolean(geometry)]);
  useEffect(() => {
    let alive = true;
    import("maplibre-gl").then((gl) => {
      if (!alive || !map.current) return;
      markers.current.forEach((m) => m.remove());
      const marker = (
        id: string,
        label: string,
        text: string,
        className: string,
        at: [number, number],
      ) => {
        const button = document.createElement("button");
        button.className = className;
        button.type = "button";
        button.textContent = text;
        button.setAttribute("aria-label", label);
        button.addEventListener("click", (e) => {
          e.stopPropagation();
          actions.current.onSelect(id);
        });
        return new gl.Marker({ element: button })
          .setLngLat(at)
          .addTo(map.current!);
      };
      markers.current = [
        ...items
          .filter((l) => l.status === "published")
          .map((l) =>
            marker(
              l.id,
              `${locationKinds[l.kind ?? "spot"]}: ${l.title}`,
              pinText[l.kind ?? "spot"],
              `location-pin ${l.kind ?? "spot"}-pin`,
              [l.longitude, l.latitude],
            ),
          ),
        ...pins.map((p) =>
          marker(
            p.id,
            `${p.kind === "ride" ? "Покатушка" : "Трек"}: ${p.title}`,
            p.kind === "ride" ? "П" : "Т",
            `location-pin ${p.kind}-pin`,
            p.coordinate,
          ),
        ),
      ];
    });
    return () => {
      alive = false;
    };
  }, [items, pins, ready]);
  useEffect(() => {
    const m = map.current;
    if (!m || !geometry) return;
    const draw = () => {
      const source = m.getSource("track") as
        | import("maplibre-gl").GeoJSONSource
        | undefined;
      const data = { type: "Feature" as const, properties: {}, geometry };
      if (source) source.setData(data);
      else {
        m.addSource("track", { type: "geojson", data });
        m.addLayer({
          id: "track-line",
          type: "line",
          source: "track",
          paint: { "line-color": "#e77332", "line-width": 5 },
        });
      }
      const points = geometry.coordinates.flat();
      if (points.length)
        m.fitBounds(
          [
            [
              Math.min(...points.map((p) => p[0])),
              Math.min(...points.map((p) => p[1])),
            ],
            [
              Math.max(...points.map((p) => p[0])),
              Math.max(...points.map((p) => p[1])),
            ],
          ],
          { padding: 35, maxZoom: 14, duration: 0 },
        );
    };
    if (m.isStyleLoaded()) draw();
    else m.on("load", draw);
    return () => {
      m.off("load", draw);
    };
  }, [geometry, ready]);
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
  targetType: "post" | "location" | "track" | "ride" | "ride_message";
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
