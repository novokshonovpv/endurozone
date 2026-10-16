import { useEffect, useState } from "react";
import {
  difficulties,
  verifiedVisits,
  type Difficulty,
  type EnduroLocation,
  type LocationVisits,
  type Session,
} from "@enduro/contracts";
import { api } from "./api.ts";
import { Icon } from "./ui.tsx";
// «Был здесь» on a place card: riders confirm the place exists and vote for its difficulty.
const plural = (n: number) =>
  n % 10 === 1 && n % 100 !== 11
    ? "райдер"
    : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20)
      ? "райдера"
      : "райдеров";
export function VisitPanel({
  place,
  session,
  changed,
}: {
  place: EnduroLocation;
  session: Session | null;
  /** The list updates its tag and counter after a mark. */
  changed: (summary: LocationVisits) => void;
}) {
  const [s, setS] = useState<LocationVisits | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  useEffect(() => {
    let alive = true;
    setS(null);
    setError("");
    api<LocationVisits>(`/locations/${place.id}/visits`)
      .then((v) => {
        if (alive) setS(v);
      })
      .catch((e) => {
        if (alive) setError((e as Error).message);
      });
    return () => {
      alive = false;
    };
  }, [place.id, session?.user.id]);
  const send = async (method: "PUT" | "DELETE", difficulty?: Difficulty) => {
    setBusy(true);
    setError("");
    try {
      const v = await api<LocationVisits>(`/locations/${place.id}/visit`, {
        method,
        ...(method === "PUT" ? { body: difficulty ? { difficulty } : {} } : {}),
      });
      setS(v);
      changed(v);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  if (!s) return error ? <p className="muted">{error}</p> : null;
  const own = session?.user.id === place.author.id;
  const spot = place.kind === "spot";
  return (
    <section className="visit-panel">
      <h3>
        Отметки райдеров
        {s.visits >= verifiedVisits && (
          <span className="tag green">
            <Icon name="check" size={13} /> Проверено райдерами
          </span>
        )}
      </h3>
      <p className="muted">
        {s.visits
          ? `Здесь были ${s.visits} ${plural(s.visits)}.`
          : "Пока никто не отметил, что был здесь."}
        {spot &&
          (s.communityDifficulty
            ? ` Сложность по оценкам: ${difficulties[s.communityDifficulty].toLowerCase()}.`
            : s.visits
              ? " Сложность появится, когда её оценят двое."
              : "")}
      </p>
      {error && <p className="error-text">{error}</p>}
      {!session ? (
        <a className="text-button" href="#login">
          Войдите, чтобы отметить, что были здесь
        </a>
      ) : own ? (
        <p className="muted">Это ваше место — отметки ставят другие райдеры.</p>
      ) : s.mine.visited ? (
        <>
          {spot && (
            <div
              className="chip-row visit-votes"
              role="group"
              aria-label="Ваша оценка сложности"
            >
              {(Object.keys(difficulties) as Difficulty[]).map((d) => (
                <button
                  key={d}
                  className={`chip ${s.mine.difficulty === d ? "active" : ""}`}
                  aria-pressed={s.mine.difficulty === d}
                  disabled={busy}
                  onClick={() => send("PUT", d)}
                >
                  {difficulties[d]} · {s.votes[d]}
                </button>
              ))}
            </div>
          )}
          <button
            className="text-button"
            disabled={busy}
            onClick={() => send("DELETE")}
          >
            Убрать мою отметку
          </button>
        </>
      ) : (
        <button
          className="button outline small"
          disabled={busy}
          onClick={() => send("PUT")}
        >
          <Icon name="check" size={16} />Я был здесь
        </button>
      )}
    </section>
  );
}
