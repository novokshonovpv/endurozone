import { useEffect, useState } from "react";
// Weather on place and ride cards: Open-Meteo (free, no key; data CC BY 4.0, attribution
// below). The browser asks for the forecast at the place's public coordinates; nothing about
// the rider is sent. Rain over the last three days hints at mud, which matters for enduro.
type Daily = {
  time: string[];
  weather_code: number[];
  temperature_2m_max: number[];
  temperature_2m_min: number[];
  precipitation_sum: number[];
  wind_speed_10m_max: number[];
};
const cache = new Map<string, Promise<Daily>>();
function forecast(latitude: number, longitude: number) {
  const key = `${latitude.toFixed(2)},${longitude.toFixed(2)}`;
  if (!cache.has(key)) {
    const q = new URLSearchParams({
      latitude: latitude.toFixed(3),
      longitude: longitude.toFixed(3),
      daily:
        "weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,wind_speed_10m_max",
      wind_speed_unit: "ms",
      timezone: "auto",
      past_days: "3",
      forecast_days: "16",
    });
    const request = fetch(`https://api.open-meteo.com/v1/forecast?${q}`)
      .then((r) => {
        if (!r.ok) throw new Error(String(r.status));
        return r.json();
      })
      .then((j: { daily: Daily }) => j.daily);
    request.catch(() => cache.delete(key));
    cache.set(key, request);
  }
  return cache.get(key)!;
}
const sky = (code: number) =>
  code === 0
    ? "ясно"
    : code <= 3
      ? "облачно"
      : code <= 48
        ? "туман"
        : code <= 57
          ? "морось"
          : code <= 67
            ? "дождь"
            : code <= 77
              ? "снег"
              : code <= 82
                ? "ливни"
                : code <= 86
                  ? "снегопад"
                  : "гроза";
const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const label = (day: string) =>
  day === today()
    ? "Сегодня"
    : new Date(`${day}T12:00:00`).toLocaleDateString("ru-RU", {
        weekday: "short",
        day: "numeric",
      });
const round = (n: number) => Math.round(n);
/** Four days from today, or from the ride day when it is within the forecast. */
export function Weather({
  latitude,
  longitude,
  day,
}: {
  latitude: number;
  longitude: number;
  day?: string;
}) {
  const [data, setData] = useState<Daily | null>(null),
    [failed, setFailed] = useState(false);
  useEffect(() => {
    let alive = true;
    setData(null);
    setFailed(false);
    forecast(latitude, longitude)
      .then((d) => {
        if (alive) setData(d);
      })
      .catch(() => {
        if (alive) setFailed(true);
      });
    return () => {
      alive = false;
    };
  }, [latitude, longitude]);
  if (failed || !data) return null;
  const start = data.time.indexOf(today());
  if (start < 0) return null;
  const focus = day ? data.time.indexOf(day) : -1;
  if (day && focus < 0) return null; // The ride is further away than the forecast.
  const from = focus >= 0 ? Math.max(start, focus - 1) : start;
  const days = data.time.slice(from, from + 4).map((t, i) => from + i);
  const rain3 = data.precipitation_sum
    .slice(Math.max(0, start - 3), start)
    .reduce((a, b) => a + (b ?? 0), 0);
  return (
    <section className="weather" aria-label="Погода">
      <h3>Погода</h3>
      <ul className="weather-days">
        {days.map((i) => (
          <li key={data.time[i]} className={i === focus ? "is-ride-day" : ""}>
            <span className="weather-day">
              {i === focus ? "День выезда" : label(data.time[i])}
            </span>
            <strong>
              {round(data.temperature_2m_max[i])}° /{" "}
              {round(data.temperature_2m_min[i])}°
            </strong>
            <small>
              {sky(data.weather_code[i])}
              {data.precipitation_sum[i] >= 0.5 &&
                ` · ${data.precipitation_sum[i].toFixed(1)} мм`}
            </small>
            <small>ветер до {round(data.wind_speed_10m_max[i])} м/с</small>
          </li>
        ))}
      </ul>
      <p className="weather-note">
        {rain3 >= 10
          ? `За три дня выпало ${round(rain3)} мм — скорее всего грязно.`
          : rain3 >= 3
            ? `За три дня выпало ${round(rain3)} мм — местами может быть грязно.`
            : "Последние три дня почти без осадков."}{" "}
        <a href="https://open-meteo.com/" target="_blank" rel="noreferrer">
          Данные Open-Meteo
        </a>
      </p>
    </section>
  );
}
