import { useEffect, useState, type FormEvent } from "react";
import {
  feedbackKinds,
  feedbackStatuses,
  type Feedback,
  type FeedbackKind,
  type FeedbackStatus,
  type ModeratedFeedback,
  type Page,
} from "@enduro/contracts";
import { api } from "./api.ts";
import { ActivationCard } from "./onboarding.tsx";
import { ErrorBox, Icon, Loading, Modal, formatDate } from "./ui.tsx";
const sectionNames: Record<string, string> = {
  feed: "Сообщество",
  post: "Запись бортжурнала",
  riders: "Райдеры",
  rider: "Страница райдера",
  nearby: "Рядом",
  map: "Карта локаций",
  tracks: "GPX-треки",
  track: "GPX-трек",
  rides: "Покатушки",
  ride: "Покатушка",
  shop: "Магазин",
  mechanic: "ИИ-механик",
  learning: "Обучение",
  garage: "Мой гараж",
  following: "Подписки",
  saved: "Избранное",
  profile: "Мой профиль",
  account: "Доступ к аккаунту",
  notifications: "Уведомления",
  moderation: "Модерация",
  login: "Вход",
  register: "Регистрация",
  feedback: "Мои отзывы",
};
export const sectionName = (s: string) => sectionNames[s] ?? s;
// Only the first segment of the address: "ride/<id>" becomes "ride".
export const sectionOf = (route: string) => {
  const s = route.split(/[/?]/)[0].toLowerCase();
  return /^[a-z][a-z-]{0,29}$/.test(s) ? s : "feed";
};
export function FeedbackButton({
  route,
  notify,
}: {
  route: string;
  notify: (message: string) => void;
}) {
  const [open, setOpen] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const section = sectionOf(route);
  async function send(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setBusy(true);
    setError("");
    try {
      await api("/feedback", {
        method: "POST",
        body: {
          kind: f.get("kind") as FeedbackKind,
          body: String(f.get("body") ?? ""),
          section,
          viewport: `${Math.round(window.innerWidth)}x${Math.round(window.innerHeight)}`,
        },
      });
      setOpen(false);
      notify("Спасибо! Отзыв отправлен команде.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <button
        className="feedback-fab"
        onClick={() => {
          setError("");
          setOpen(true);
        }}
      >
        <Icon name="message" size={18} />
        <span>Отзыв</span>
      </button>
      {open && (
        <Modal title="Сообщить команде" close={() => setOpen(false)}>
          <form className="location-form" onSubmit={send}>
            <ErrorBox message={error} />
            <fieldset className="feedback-kinds">
              <legend>Что случилось?</legend>
              {Object.entries(feedbackKinds).map(([value, label], i) => (
                <label key={value}>
                  <input
                    type="radio"
                    name="kind"
                    value={value}
                    defaultChecked={i === 0}
                  />
                  {label}
                </label>
              ))}
            </fieldset>
            <label>
              Опишите своими словами
              <textarea
                name="body"
                rows={5}
                required
                minLength={5}
                maxLength={2000}
                placeholder="Что вы делали, что ожидали и что получилось"
              />
            </label>
            <p className="form-note">
              Автоматически приложим раздел «{sectionName(section)}», размер
              экрана, браузер и версию сайта. Не пишите пароли, адреса и чужие
              личные данные.
            </p>
            <div className="button-row">
              <button className="button" disabled={busy}>
                {busy ? "Отправляем…" : "Отправить"}
              </button>
              <a
                className="text-button"
                href="#feedback"
                onClick={() => setOpen(false)}
              >
                Мои отзывы
              </a>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}
function usePaged<T>(path: string) {
  const [items, setItems] = useState<T[]>([]),
    [next, setNext] = useState<number | null>(null),
    [busy, setBusy] = useState(true),
    [error, setError] = useState(""),
    [revision, setRevision] = useState(0);
  useEffect(() => {
    let alive = true;
    setBusy(true);
    setError("");
    api<Page<T>>(`${path}${path.includes("?") ? "&" : "?"}limit=20`)
      .then((p) => {
        if (!alive) return;
        setItems(p.items);
        setNext(p.nextOffset);
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
  }, [path, revision]);
  async function more() {
    if (next === null) return;
    setBusy(true);
    try {
      const p = await api<Page<T>>(
        `${path}${path.includes("?") ? "&" : "?"}limit=20&offset=${next}`,
      );
      setItems((old) => [...old, ...p.items]);
      setNext(p.nextOffset);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return {
    items,
    setItems,
    next,
    busy,
    error,
    more,
    reload: () => setRevision((x) => x + 1),
  };
}
function Meta({ f }: { f: Feedback }) {
  return (
    <p className="muted feedback-meta">
      {feedbackKinds[f.kind]} · {sectionName(f.section)} · экран {f.viewport} ·
      версия {f.appVersion} · {formatDate(f.createdAt)}
    </p>
  );
}
export function MyFeedback() {
  const page = usePaged<Feedback>("/me/feedback");
  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">ПИЛОТ</p>
          <h1>Мои отзывы</h1>
          <p className="muted">
            Видите только вы и модераторы проекта. Кнопка «Отзыв» есть на каждой
            странице.
          </p>
        </div>
      </div>
      <ErrorBox message={page.error} />
      {page.busy && !page.items.length ? (
        <Loading />
      ) : !page.items.length ? (
        <div className="card empty-state">
          <Icon name="message" size={32} />
          <h3>Отзывов пока нет</h3>
          <p>
            Если что-то сломалось или непонятно, нажмите «Отзыв» в правом нижнем
            углу — раздел и устройство приложатся сами.
          </p>
        </div>
      ) : (
        <div className="feedback-list">
          {page.items.map((f) => (
            <article className="card feedback-card" key={f.id}>
              <span className={`tag ${f.status === "resolved" ? "green" : ""}`}>
                {feedbackStatuses[f.status]}
              </span>
              <p className="plain-text">{f.body}</p>
              <Meta f={f} />
              {f.reply && (
                <blockquote className="feedback-reply">
                  <strong>Ответ команды</strong>
                  <p className="plain-text">{f.reply}</p>
                </blockquote>
              )}
            </article>
          ))}
        </div>
      )}
      {page.next !== null && (
        <button
          className="button outline"
          disabled={page.busy}
          onClick={page.more}
        >
          Показать ещё
        </button>
      )}
    </>
  );
}
export function PilotFeedback({ notify }: { notify: (s: string) => void }) {
  const [status, setStatus] = useState<FeedbackStatus | "">("new");
  const page = usePaged<ModeratedFeedback>(
    `/moderation/feedback${status ? `?status=${status}` : ""}`,
  );
  async function decide(e: FormEvent<HTMLFormElement>, f: ModeratedFeedback) {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    try {
      const updated = await api<Feedback>(`/moderation/feedback/${f.id}`, {
        method: "POST",
        body: {
          status: data.get("status") as FeedbackStatus,
          reply: String(data.get("reply") ?? ""),
        },
      });
      notify("Отзыв обновлён.");
      page.setItems((old) =>
        old
          .map((x) => (x.id === f.id ? { ...x, ...updated } : x))
          .filter((x) => !status || x.status === status),
      );
    } catch (e) {
      notify((e as Error).message);
    }
  }
  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">МОДЕРАЦИЯ</p>
          <h1>Отзывы пилота</h1>
          <p className="muted">
            Автор получает уведомление, когда отзыв закрыт или появился новый
            ответ.
          </p>
        </div>
      </div>
      <ActivationCard />
      <div className="scope-tabs" role="tablist" aria-label="Статус отзывов">
        {(
          [["", "Все"], ...Object.entries(feedbackStatuses)] as [
            string,
            string,
          ][]
        ).map(([value, label]) => (
          <button
            key={value || "all"}
            role="tab"
            aria-selected={status === value}
            className={status === value ? "active" : ""}
            onClick={() => setStatus(value as FeedbackStatus | "")}
          >
            {label}
          </button>
        ))}
      </div>
      <ErrorBox message={page.error} />
      {page.busy && !page.items.length ? (
        <Loading />
      ) : !page.items.length ? (
        <p className="muted">Здесь пока пусто.</p>
      ) : (
        <div className="feedback-list">
          {page.items.map((f) => (
            <article className="card feedback-card" key={f.id}>
              <p>
                <a className="author-link" href={`#rider/${f.author.handle}`}>
                  <strong>{f.author.displayName}</strong>
                </a>{" "}
                <small className="muted">@{f.author.handle}</small>{" "}
                <span className="tag">{feedbackStatuses[f.status]}</span>
              </p>
              <p className="plain-text">{f.body}</p>
              <Meta f={f} />
              <details>
                <summary>Браузер</summary>
                <p className="muted feedback-agent">
                  {f.userAgent || "не передан"}
                </p>
              </details>
              <form className="decision-form" onSubmit={(e) => decide(e, f)}>
                <label>
                  Статус
                  <select name="status" defaultValue={f.status}>
                    {Object.entries(feedbackStatuses).map(([v, l]) => (
                      <option key={v} value={v}>
                        {l}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Ответ автору (необязательно)
                  <textarea
                    name="reply"
                    rows={2}
                    maxLength={1000}
                    defaultValue={f.reply}
                  />
                </label>
                <button className="button small">Сохранить</button>
              </form>
            </article>
          ))}
        </div>
      )}
      {page.next !== null && (
        <button
          className="button outline"
          disabled={page.busy}
          onClick={page.more}
        >
          Показать ещё
        </button>
      )}
    </>
  );
}
