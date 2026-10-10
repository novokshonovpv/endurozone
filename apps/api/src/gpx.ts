import { DOMParser, type Element } from "@xmldom/xmldom";
import type { Coordinate, TrackPreview } from "@enduro/contracts";
const R = 6371008.8,
  rad = (n: number) => (n * Math.PI) / 180;
export const distance = (a: Coordinate, b: Coordinate) => {
  const h =
    Math.sin(rad(b[1] - a[1]) / 2) ** 2 +
    Math.cos(rad(a[1])) *
      Math.cos(rad(b[1])) *
      Math.sin(rad(b[0] - a[0]) / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(Math.min(1, h)));
};
const bearing = (a: Coordinate, b: Coordinate) =>
  Math.atan2(
    Math.sin(rad(b[0] - a[0])) * Math.cos(rad(b[1])),
    Math.cos(rad(a[1])) * Math.sin(rad(b[1])) -
      Math.sin(rad(a[1])) * Math.cos(rad(b[1])) * Math.cos(rad(b[0] - a[0])),
  );
function arcDistance(p: Coordinate, a: Coordinate, b: Coordinate) {
  const length = distance(a, b) / R;
  if (length < 1e-12) return distance(p, a);
  const d = distance(a, p) / R,
    diff = bearing(a, p) - bearing(a, b);
  const along = Math.atan2(Math.sin(d) * Math.cos(diff), Math.cos(d));
  if (along <= 0) return distance(p, a);
  if (along >= length) return distance(p, b);
  return (
    Math.abs(
      Math.asin(Math.max(-1, Math.min(1, Math.sin(d) * Math.sin(diff)))),
    ) * R
  );
}
export class GpxError extends Error {
  statusCode = 400;
  code = "GPX_INVALID";
}
function fail(s: string): never {
  throw new GpxError(s);
}
const children = (e: Element, name: string) =>
  Array.from(e.childNodes).filter(
    (n): n is Element =>
      n.nodeType === 1 &&
      n.localName === name &&
      n.namespaceURI === e.namespaceURI,
  );
export function previewGpx(gpx: string, trimM: number): TrackPreview {
  if (Buffer.byteLength(gpx, "utf8") > 400000)
    fail("GPX должен быть не больше 400 КБ.");
  if (!Number.isInteger(trimM) || trimM < 100 || trimM > 2000)
    fail("Радиус скрытия: от 100 до 2000 метров.");
  if (/<!\s*(DOCTYPE|ENTITY)/i.test(gpx))
    fail("Объявления DTD и сущностей в GPX запрещены.");
  // Bound XML complexity before building a DOM. The XML parser remains the syntax authority.
  const tokens = gpx.match(/<[^>]*>/g) ?? [];
  if (tokens.length > 60000) fail("Слишком сложный GPX.");
  let depth = 0;
  for (const t of tokens) {
    if (/^<\//.test(t)) depth--;
    else if (!/^<[!?]/.test(t) && !/\/>$/.test(t)) depth++;
    if (depth > 40) fail("Слишком глубокая структура GPX.");
  }
  let root: Element;
  try {
    root = new DOMParser({
      onError: () => {
        throw new Error("Invalid XML");
      },
    }).parseFromString(gpx, "application/xml").documentElement!;
  } catch {
    fail("Не удалось прочитать GPX. Проверьте XML и кодировку UTF-8.");
  }
  if (
    root.localName !== "gpx" ||
    root.namespaceURI !== "http://www.topografix.com/GPX/1/1" ||
    root.getAttribute("version") !== "1.1"
  )
    fail("Поддерживается GPX 1.1 с треками trk / trkseg / trkpt.");
  const segments: Coordinate[][] = [];
  let count = 0;
  for (const trk of children(root, "trk"))
    for (const seg of children(trk, "trkseg")) {
      const points: Coordinate[] = [];
      for (const node of children(seg, "trkpt")) {
        const lat = node.getAttribute("lat"),
          lon = node.getAttribute("lon");
        const latitude = Number(lat),
          longitude = Number(lon);
        if (
          !lat?.trim() ||
          !lon?.trim() ||
          !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(lat.trim()) ||
          !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(lon.trim()) ||
          !Number.isFinite(latitude) ||
          !Number.isFinite(longitude) ||
          Math.abs(latitude) > 85 ||
          Math.abs(longitude) > 180
        )
          fail(
            "Некорректные координаты GPX (широта должна быть в пределах ±85°).",
          );
        if (++count > 5000)
          fail("В одном GPX допускается не более 5000 точек.");
        const p: Coordinate = [longitude, latitude];
        if (points.length && Math.abs(points.at(-1)![0] - p[0]) > 180)
          fail("Пересечение меридиана 180° пока не поддерживается.");
        if (points.length && distance(points.at(-1)!, p) > 2000)
          fail(
            "Между соседними точками больше 2 км. Разделите разрывы на отдельные сегменты.",
          );
        points.push(p);
      }
      if (points.length >= 2) segments.push(points);
      if (segments.length > 100)
        fail("В одном GPX допускается не более 100 сегментов.");
    }
  if (!segments.length) fail("В GPX нет трека с двумя или более точками.");
  // Mask all segment endpoints globally, including returns to the same start later in a loop.
  const zones = segments.flatMap((s) => [s[0], s.at(-1)!]);
  const radius = trimM + 2;
  const coordinates: Coordinate[][] = [];
  for (const segment of segments) {
    let run: Coordinate[] = [];
    const flush = () => {
      if (run.length >= 2) coordinates.push(run);
      run = [];
    };
    for (const p of segment) {
      if (zones.some((z) => distance(z, p) <= radius)) {
        flush();
        continue;
      }
      if (
        run.length &&
        zones.some((z) => arcDistance(z, run.at(-1)!, p) <= radius)
      )
        flush();
      run.push(p);
    }
    flush();
  }
  let distanceM = 0;
  for (const s of coordinates)
    for (let i = 1; i < s.length; i++) distanceM += distance(s[i - 1], s[i]);
  if (distanceM < 50)
    fail(
      "После скрытия начала и конца осталось меньше 50 м. Выберите другой трек или уменьшите радиус.",
    );
  if (distanceM > 500000)
    fail("Для первого этапа поддерживаются треки до 500 км.");
  return {
    geometry: { type: "MultiLineString", coordinates },
    distanceM: Math.round(distanceM),
    pointCount: coordinates.reduce((n, s) => n + s.length, 0),
    trimM,
  };
}
export function publicGpx(geometry: TrackPreview["geometry"]) {
  return `<?xml version="1.0" encoding="UTF-8"?><gpx version="1.1" creator="Enduro.Zone" xmlns="http://www.topografix.com/GPX/1/1"><trk>${geometry.coordinates.map((s) => `<trkseg>${s.map(([lon, lat]) => `<trkpt lat="${lat}" lon="${lon}"/>`).join("")}</trkseg>`).join("")}</trk></gpx>`;
}
