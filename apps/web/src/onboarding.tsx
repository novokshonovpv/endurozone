import { useEffect, useState } from "react";
import {
  onboardingSteps,
  type ActivationSummary,
  type Onboarding,
} from "@enduro/contracts";
import { api } from "./api.ts";
import { ErrorBox, Icon } from "./ui.tsx";
// Shown until every step is done or the rider hides it; progress comes from saved data only.
export function FirstSteps({ current = "" }: { current?: string }) {
  const [state, setState] = useState<Onboarding | null>(null),
    [error, setError] = useState("");
  useEffect(() => {
    let alive = true;
    api<Onboarding>("/me/onboarding")
      .then((o) => {
        if (alive) setState(o);
      })
      .catch(() => {
        /* The checklist is optional; the page works without it. */
      });
    return () => {
      alive = false;
    };
  }, []);
  async function hide(dismissed: boolean) {
    setError("");
    try {
      setState(
        await api<Onboarding>("/me/onboarding", {
          method: "PUT",
          body: { dismissed },
        }),
      );
    } catch (e) {
      setError((e as Error).message);
    }
  }
  if (!state || state.complete || state.dismissed) return null;
  const done = state.steps.filter((s) => s.done).length;
  return (
    <section className="card first-steps" aria-label="Первые шаги">
      <div className="section-heading">
        <div>
          <p className="eyebrow">
            ПЕРВЫЕ ШАГИ · {done} из {state.steps.length}
          </p>
          <h2>Начните свою историю</h2>
        </div>
        <button className="text-button" onClick={() => hide(true)}>
          Скрыть
        </button>
      </div>
      <div
        className="first-steps-progress"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={state.steps.length}
        aria-valuenow={done}
      >
        <span style={{ width: `${(done / state.steps.length) * 100}%` }} />
      </div>
      <ol className="first-steps-list">
        {state.steps.map((s, i) => {
          const step = onboardingSteps[s.id];
          return (
            <li className={s.done ? "done" : ""} key={s.id}>
              <span className="first-steps-mark" aria-hidden="true">
                {s.done ? <Icon name="check" size={16} /> : i + 1}
              </span>
              <div>
                <strong>{step.title}</strong>
                <small>{s.done ? "Готово" : step.hint}</small>
              </div>
              {!s.done && step.path !== current && (
                <a className="button outline small" href={`#${step.path}`}>
                  {step.action}
                </a>
              )}
            </li>
          );
        })}
      </ol>
      <p className="muted first-steps-tip">
        Загляните и в <a href="#nearby">«Рядом»</a> — места, треки и покатушки
        поблизости.
      </p>
      <ErrorBox message={error} />
    </section>
  );
}
const percent = (n: number, of: number) =>
  of >= 5 ? ` (${Math.round((n / of) * 100)}%)` : "";
// Aggregate numbers only; for fewer than five participants percentages are not shown.
export function ActivationCard() {
  const [s, setS] = useState<ActivationSummary | null>(null),
    [error, setError] = useState("");
  useEffect(() => {
    api<ActivationSummary>("/moderation/activation")
      .then(setS)
      .catch((e) => setError(e.message));
  }, []);
  if (error) return <ErrorBox message={error} />;
  if (!s) return null;
  const rows: [string, number][] = [
    ["Добавили мотоцикл", s.bike],
    ["Написали запись", s.post],
    ["Подписались на райдера", s.follow],
    ["Сделали шаг к другим", s.social],
    ["Прошли все четыре шага", s.activated],
  ];
  return (
    <section className="card activation-card">
      <h2>Активация пилота</h2>
      <p className="muted">
        Участников: {s.participants}. Без модераторов ({s.excludedModerators}) и
        синтетических аккаунтов @example.test ({s.excludedSynthetic}).
      </p>
      <dl className="activation-grid">
        {rows.map(([label, n]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>
              {n}
              <small>{percent(n, s.participants)}</small>
            </dd>
          </div>
        ))}
        <div>
          <dt>Вернулись через неделю</dt>
          <dd>
            {s.returned} из {s.eligibleForReturn}
            <small>{percent(s.returned, s.eligibleForReturn)}</small>
          </dd>
        </div>
      </dl>
      <p className="form-note">
        Возврат — полезное действие через 7+ дней после регистрации, а не просто
        визит. Считается по сохранённым данным, без отслеживания страниц.
      </p>
    </section>
  );
}
