import { useEffect, useState, type FormEvent } from "react";
import type {
  Bike,
  Page,
  Session,
  MechanicStatus,
  MechanicHistory,
  MechanicConsultation,
} from "@enduro/contracts";
import { api } from "./api.ts";
import { ErrorBox, Icon, Loading } from "./ui.tsx";
export function Mechanic({ session }: { session: Session | null }) {
  const [status, setStatus] = useState<MechanicStatus | null>(null),
    [bikes, setBikes] = useState<Bike[]>([]),
    [history, setHistory] = useState<MechanicHistory>({ items: [], total: 0 }),
    [bikeId, setBikeId] = useState(""),
    [question, setQuestion] = useState(""),
    [consent, setConsent] = useState(false),
    [deleteId, setDeleteId] = useState<string | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [ready, setReady] = useState(false),
    [retry, setRetry] = useState(0),
    [offset, setOffset] = useState(0);
  useEffect(() => {
    let alive = true;
    setReady(false);
    Promise.all([
      api<MechanicStatus>("/mechanic"),
      session ? api<Page<Bike>>("/me/bikes") : Promise.resolve({ items: [] }),
      session
        ? api<MechanicHistory>(`/me/mechanic?offset=${offset}`)
        : Promise.resolve({ items: [], total: 0 }),
    ])
      .then(([s, b, h]) => {
        if (alive) {
          setStatus(s);
          setBikes(b.items);
          setHistory(h);
          setReady(true);
        }
      })
      .catch((e) => {
        if (alive) setError(e.message);
      });
    return () => {
      alive = false;
    };
  }, [session?.user.id, offset, retry]);
  async function ask(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api<MechanicConsultation>("/me/mechanic", {
        method: "POST",
        body: { question: question.trim(), bikeId: bikeId || null, consent },
      });
      setQuestion("");
      setConsent(false);
      setOffset(0);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setRetry((x) => x + 1);
      setBusy(false);
    }
  }
  async function remove(id: string) {
    setBusy(true);
    setError("");
    try {
      await api(`/me/mechanic/${id}`, { method: "DELETE" });
      setDeleteId(null);
      setOffset(0);
      setRetry((x) => x + 1);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const selected = bikes.find((b) => b.id === bikeId);
  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">ПОМОЩЬ С ВАШЕЙ ТЕХНИКОЙ</p>
          <h1>Виртуальный механик</h1>
          <p className="muted">
            Опишите симптомы, чтобы разобраться в возможных причинах и
            подготовить вопросы мастеру.
          </p>
        </div>
      </div>
      <div className="mechanic-hero">
        <Icon name="wrench" />
        <div>
          <span className="tag">Личная консультация</span>
          <h2>Начните с наблюдений</h2>
          <p>
            Что изменилось, когда это происходит и какие работы уже выполнялись?
            Чем точнее описание, тем полезнее ответ.
          </p>
        </div>
      </div>
      {error && (
        <>
          <ErrorBox message={error} />
          <button
            className="button outline"
            onClick={() => {
              setError("");
              setRetry((x) => x + 1);
            }}
            disabled={busy}
          >
            Обновить раздел
          </button>
        </>
      )}
      {!status && !error && <Loading />}
      {status && !status.available && (
        <div className="panel mechanic-notice">
          <h2>Ответы ИИ пока не подключены</h2>
          <p>
            Раздел готов к подключению. После запуска здесь появятся ответы и
            личная история консультаций.
          </p>
          <a href="#garage">Пока можно проверить свой план ТО →</a>
        </div>
      )}
      {!session ? (
        <div className="panel mechanic-notice">
          <h2>Вопросы доступны участникам</h2>
          <p>
            Войдите, чтобы выбрать мотоцикл и хранить консультации в своём
            аккаунте.
          </p>
          <a className="button" href="#login">
            Войти в аккаунт
          </a>
        </div>
      ) : (
        <div className="mechanic-grid">
          <section className="panel">
            <h2>Задать вопрос</h2>
            <form onSubmit={ask} className="mechanic-form">
              <label>
                Мотоцикл
                <select
                  value={bikeId}
                  onChange={(e) => {
                    setBikeId(e.target.value);
                    setConsent(false);
                  }}
                  disabled={busy || !ready}
                >
                  <option value="">Без выбора мотоцикла</option>
                  {bikes.map((b) => (
                    <option value={b.id} key={b.id}>
                      {b.make} {b.model} · {b.year}
                    </option>
                  ))}
                </select>
              </label>
              <p className="muted">
                {selected
                  ? `${selected.make} ${selected.model}, ${selected.year} · ${selected.engine || "Двигатель не указан"} · ${selected.modification || "Исполнение не указано"}`
                  : "Укажите модель и год в вопросе, если мотоцикл ещё не добавлен в гараж."}
              </p>
              <label>
                Ваш вопрос
                <textarea
                  rows={7}
                  minLength={10}
                  maxLength={2000}
                  required
                  value={question}
                  onChange={(e) => setQuestion(e.target.value)}
                  disabled={busy}
                  placeholder="Например: на холодном двигателе появился необычный шум. Когда он начинается и какие детали недавно менялись…"
                />
              </label>
              <small className="muted">
                {question.length}/2000 · Не добавляйте телефон, адрес и другие
                личные данные.
              </small>
              <label className="mechanic-consent">
                <input
                  type="checkbox"
                  checked={consent}
                  onChange={(e) => setConsent(e.target.checked)}
                  disabled={busy || !status?.available}
                />{" "}
                <span>
                  Согласен передать в OpenAI текст вопроса и основные данные
                  выбранного мотоцикла: марку, модель, год, двигатель и
                  исполнение. История ТО и заметки гаража автоматически не
                  передаются.
                </span>
              </label>
              <button
                className="button"
                disabled={
                  busy ||
                  !ready ||
                  !status?.available ||
                  !consent ||
                  question.trim().length < 10
                }
              >
                {busy ? "Обрабатываем…" : "Отправить вопрос"}
              </button>
              <small className="muted">
                До {status?.dailyLimit ?? 10} запросов в день по UTC, включая
                неудачные попытки. Каждый вопрос рассматривается отдельно.
              </small>
            </form>
          </section>
          <aside className="panel mechanic-help">
            <h2>Что указать в вопросе</h2>
            <ol>
              <li>Модель, год и доработки.</li>
              <li>
                Симптомы и условия: холодный или прогретый двигатель, нагрузка,
                поверхность.
              </li>
              <li>Когда проблема появилась.</li>
              <li>Что уже проверяли и меняли.</li>
            </ol>
            <h3>Границы консультации</h3>
            <p>
              ИИ может ошибаться. Ответ содержит предположения и не заменяет
              осмотр. Точные настройки и регламент сверяйте с руководством своей
              модели.
            </p>
            <p>
              При проблемах с тормозами, рулевым управлением, утечке топлива или
              повреждении рамы прекратите эксплуатацию и обратитесь к
              специалисту.
            </p>
            <a href="#garage">Мой гараж →</a>
            <a href="#learning/garage-history">Как вести историю ТО →</a>
          </aside>
        </div>
      )}
      {session && (
        <section className="panel mechanic-history">
          <div className="section-heading">
            <h2>История консультаций</h2>
            <span className="muted">Только для вас · {history.total}</span>
          </div>
          {!ready && !error ? (
            <Loading />
          ) : ready && !history.items.length ? (
            <p className="muted">
              Здесь появятся ваши вопросы и ответы. Историю можно удалить или
              выгрузить вместе с данными аккаунта.
            </p>
          ) : (
            ready &&
            history.items.map((item) => (
              <article className="mechanic-entry" key={item.id}>
                <div className="section-heading">
                  <span className="tag">
                    {item.status === "answered"
                      ? "Ответ ИИ"
                      : item.status === "pending"
                        ? "Ожидает ответа"
                        : "Ответ не получен"}
                  </span>
                  <time>
                    {new Date(item.createdAt).toLocaleString("ru-RU")}
                  </time>
                </div>
                {item.bike && (
                  <p className="muted">
                    {item.bike.make} {item.bike.model} · {item.bike.year}
                  </p>
                )}
                <h3>{item.question}</h3>
                {item.answer ? (
                  <p className="mechanic-answer">{item.answer}</p>
                ) : (
                  <p className="muted">
                    {item.status === "pending"
                      ? "Обновите историю через некоторое время."
                      : "Можно задать вопрос заново позже."}
                  </p>
                )}
                <button
                  className="button outline"
                  disabled={busy}
                  onClick={() =>
                    deleteId === item.id
                      ? remove(item.id)
                      : setDeleteId(item.id)
                  }
                >
                  {deleteId === item.id
                    ? "Подтвердить удаление навсегда"
                    : "Удалить консультацию"}
                </button>
                {deleteId === item.id && (
                  <button
                    className="button outline"
                    disabled={busy}
                    onClick={() => setDeleteId(null)}
                  >
                    Отмена
                  </button>
                )}
              </article>
            ))
          )}
          {ready && history.total > 10 && (
            <div className="mechanic-pagination">
              <button
                className="button outline"
                disabled={busy || offset === 0}
                onClick={() => setOffset((x) => Math.max(0, x - 10))}
              >
                Новые вопросы
              </button>
              <button
                className="button outline"
                disabled={busy || offset + 10 >= history.total}
                onClick={() => setOffset((x) => x + 10)}
              >
                Ранее
              </button>
            </div>
          )}
        </section>
      )}
    </>
  );
}
