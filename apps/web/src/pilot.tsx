import { useState, useEffect, type FormEvent } from "react";
import type { Notification, Session } from "@enduro/contracts";
import { api } from "./api.ts";
import { ErrorBox, Icon, Loading } from "./ui.tsx";
import { go } from "./routing.ts";
export function Account({
  session,
  refresh,
}: {
  session: Session;
  refresh: (s: Session) => void;
}) {
  const [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false);
  async function request() {
    setBusy(true);
    setError("");
    try {
      const r = await api<{ message: string }>("/auth/email/request", {
        method: "POST",
      });
      setMessage(r.message);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function check() {
    setBusy(true);
    setError("");
    try {
      refresh(await api<Session>("/me"));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="card auth-card">
      <h1>Доступ к аккаунту</h1>
      <p>{session.user.email}</p>
      <ErrorBox message={error} />
      <p>
        {session.user.emailVerified
          ? "Email подтверждён"
          : "Email пока не подтверждён"}
      </p>
      {message && <p role="status">{message}</p>}
      {!session.user.emailVerified && (
        <>
          <button className="button" disabled={busy} onClick={request}>
            Отправить письмо подтверждения
          </button>
          <button className="text-button" disabled={busy} onClick={check}>
            Проверить подтверждение
          </button>
        </>
      )}
      <p>
        <a href="#forgot">Восстановить пароль</a>
      </p>
      <p className="muted">
        После сброса пароля все прежние сеансы завершаются. В локальной версии
        письма сохраняются на компьютере; инструкция есть в проекте.
      </p>
    </section>
  );
}
export function Recovery({
  route,
  refresh,
}: {
  route: string;
  refresh: (s: Session | null) => void;
}) {
  const purpose = route.startsWith("verify/")
    ? "verify"
    : route.startsWith("reset/")
      ? "reset"
      : "request";
  const token = purpose === "request" ? "" : (route.split("/")[1] ?? "");
  const [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const data = new FormData(e.currentTarget);
    if (
      purpose === "reset" &&
      data.get("password") !== data.get("confirmation")
    ) {
      setError("Пароли не совпадают.");
      setBusy(false);
      return;
    }
    try {
      const path =
        purpose === "request"
          ? "/auth/password/request"
          : purpose === "reset"
            ? "/auth/password/reset"
            : "/auth/email/verify";
      const body =
        purpose === "request"
          ? { email: data.get("email") }
          : purpose === "reset"
            ? { token, password: data.get("password") }
            : { token };
      const r = await api<{ message: string }>(path, { method: "POST", body });
      setMessage(r.message);
      if (purpose === "reset") refresh(null);
      if (purpose === "verify") {
        try {
          refresh(await api<Session>("/me"));
        } catch {}
      }
      if (purpose !== "request")
        window.history.replaceState(null, "", `#${purpose}-done`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="card auth-card">
      <h1>
        {purpose === "verify"
          ? "Подтвердить email"
          : purpose === "reset"
            ? "Новый пароль"
            : "Восстановить доступ"}
      </h1>
      <ErrorBox message={error} />
      {message ? (
        <>
          <p role="status">{message}</p>
          <a className="button" href="#login">
            Вернуться ко входу
          </a>
        </>
      ) : (
        <form onSubmit={submit}>
          {purpose === "request" && (
            <label>
              Email
              <input
                name="email"
                type="email"
                autoComplete="email"
                required
                maxLength={254}
              />
            </label>
          )}
          {purpose === "reset" && (
            <>
              <label>
                Новый пароль
                <input
                  name="password"
                  type="password"
                  autoComplete="new-password"
                  required
                  minLength={12}
                  maxLength={128}
                />
              </label>
              <label>
                Повторите пароль
                <input
                  name="confirmation"
                  type="password"
                  autoComplete="new-password"
                  required
                  minLength={12}
                  maxLength={128}
                />
              </label>
              <p>Не менее 12 символов. Прежние сеансы будут завершены.</p>
            </>
          )}
          {purpose === "verify" && (
            <p>
              Нажмите кнопку, чтобы подтвердить адрес. Простое открытие ссылки
              не меняет аккаунт.
            </p>
          )}
          <button className="button" disabled={busy}>
            {busy
              ? "Обрабатываем…"
              : purpose === "verify"
                ? "Подтвердить email"
                : purpose === "reset"
                  ? "Сохранить новый пароль"
                  : "Отправить ссылку"}
          </button>
          <p>
            <a href="#login">Вернуться ко входу</a>
          </p>
        </form>
      )}
    </section>
  );
}
export function Notifications() {
  const [items, setItems] = useState<Notification[]>([]),
    [next, setNext] = useState<number | null>(null),
    [unread, setUnread] = useState(0),
    [busy, setBusy] = useState(true),
    [error, setError] = useState("");
  async function load(offset = 0) {
    setBusy(true);
    setError("");
    try {
      const r = await api<{
        items: Notification[];
        nextOffset: number | null;
        unreadCount: number;
      }>(`/me/notifications?offset=${offset}&limit=20`);
      setItems((old) => (offset ? [...old, ...r.items] : r.items));
      setNext(r.nextOffset);
      setUnread(r.unreadCount);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    void load();
  }, []);
  async function read(n: Notification, follow = false) {
    setError("");
    try {
      await api(`/me/notifications/${n.id}/read`, { method: "POST" });
      setItems((old) =>
        old.map((i) =>
          i.id === n.id ? { ...i, readAt: new Date().toISOString() } : i,
        ),
      );
      const count = await api<{ unreadCount: number }>(
        "/me/notifications?limit=1",
      );
      setUnread(count.unreadCount);
      window.dispatchEvent(new Event("ez:notifications"));
      if (follow) go(n.path);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  return (
    <>
      <div className="section-heading">
        <div>
          <h1>Уведомления</h1>
          <p>Непрочитанных: {unread}</p>
        </div>
        <button className="text-button" disabled={busy} onClick={() => load()}>
          Обновить
        </button>
      </div>
      <ErrorBox message={error} />
      {busy && <Loading />}
      {!busy && !items.length && (
        <p>
          Пока нет уведомлений. Здесь появятся новые подписчики, заявки, решения
          и отмены покатушек.
        </p>
      )}
      <div className="notifications-list">
        {items.map((n) => (
          <article className="card notification-card" key={n.id}>
            <p>{!n.readAt && <span className="tag green">Новое</span>}</p>
            <h3>{n.message}</h3>
            <p className="muted">
              {new Date(n.createdAt).toLocaleString("ru-RU")}
            </p>
            <div className="notification-actions">
              <button className="text-button" onClick={() => read(n, true)}>
                Открыть
              </button>
              {!n.readAt && (
                <button className="text-button" onClick={() => read(n)}>
                  Прочитано
                </button>
              )}
            </div>
          </article>
        ))}
      </div>
      {next !== null && (
        <button className="button" disabled={busy} onClick={() => load(next)}>
          Ещё уведомления
        </button>
      )}
      <p className="muted">
        Сведения о сборе здесь не раскрываются. Уведомления появляются после
        обновления страницы или кнопки «Обновить».
      </p>
    </>
  );
}

// Header bell: unread count refreshed on navigation, on returning to the tab and once a minute.
export function NotificationBell({ route }: { route: string }) {
  const [unread, setUnread] = useState(0);
  useEffect(() => {
    let alive = true;
    const load = () =>
      api<{ unreadCount: number }>("/me/notifications?limit=1")
        .then((r) => {
          if (alive) setUnread(r.unreadCount);
        })
        .catch(() => {
          /* The bell stays quiet if the count is unavailable. */
        });
    load();
    const timer = setInterval(load, 60000);
    const onFocus = () => {
      if (document.visibilityState === "visible") load();
    };
    document.addEventListener("visibilitychange", onFocus);
    window.addEventListener("ez:notifications", load);
    return () => {
      alive = false;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onFocus);
      window.removeEventListener("ez:notifications", load);
    };
  }, [route]);
  const label = unread ? `Уведомления: ${unread} непрочитанных` : "Уведомления";
  return (
    <a
      href="#notifications"
      className={`bell-button ${route === "notifications" ? "active" : ""}`}
      aria-label={label}
      title={label}
    >
      <Icon name="bell" size={21} />
      {unread > 0 && (
        <span className="bell-badge" aria-hidden="true">
          {unread > 99 ? "99+" : unread}
        </span>
      )}
    </a>
  );
}
