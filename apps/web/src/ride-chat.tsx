import { useEffect, useState, type FormEvent } from "react";
import type { RideChat as Chat, RideMessage, Session } from "@enduro/contracts";
import { api } from "./api.ts";
import { Avatar, ErrorBox, Icon, Loading } from "./ui.tsx";
import { ReportButton } from "./report.tsx";
const when = (value: string) =>
  new Intl.DateTimeFormat("ru-RU", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
// Shown to the organizer and accepted riders only; the server enforces the same rule.
export function RideChat({
  rideId,
  session,
  notify,
}: {
  rideId: string;
  session: Session;
  notify: (message: string) => void;
}) {
  // Newest first from the API; rendered oldest to newest.
  const [messages, setMessages] = useState<RideMessage[]>([]),
    [next, setNext] = useState<number | null>(null),
    [canWrite, setCanWrite] = useState(false),
    [canModerate, setCanModerate] = useState(false),
    [busy, setBusy] = useState(true),
    [sending, setSending] = useState(false),
    [error, setError] = useState(""),
    [revision, setRevision] = useState(0);
  useEffect(() => {
    let alive = true;
    setBusy(true);
    setError("");
    api<Chat>(`/rides/${rideId}/messages?limit=30`)
      .then((c) => {
        if (!alive) return;
        setMessages(c.items);
        setNext(c.nextOffset);
        setCanWrite(c.canWrite);
        setCanModerate(c.canModerate);
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
  }, [rideId, revision]);
  async function earlier() {
    if (next === null) return;
    setBusy(true);
    try {
      const c = await api<Chat>(
        `/rides/${rideId}/messages?limit=30&offset=${next}`,
      );
      setMessages((old) => [...old, ...c.items]);
      setNext(c.nextOffset);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function send(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    setSending(true);
    setError("");
    try {
      await api(`/rides/${rideId}/messages`, {
        method: "POST",
        body: { body: String(new FormData(form).get("body") ?? "") },
      });
      form.reset();
      setRevision((x) => x + 1);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSending(false);
    }
  }
  async function act(m: RideMessage, kind: "delete" | "hide") {
    setError("");
    try {
      await api(
        kind === "delete"
          ? `/ride-messages/${m.id}`
          : `/ride-messages/${m.id}/hide`,
        { method: kind === "delete" ? "DELETE" : "POST" },
      );
      notify(kind === "delete" ? "Сообщение удалено." : "Сообщение скрыто.");
      setRevision((x) => x + 1);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  return (
    <section className="card location-editor ride-chat">
      <div className="section-heading">
        <h2>Чат участников</h2>
        <button
          className="text-button"
          disabled={busy}
          onClick={() => setRevision((x) => x + 1)}
        >
          Обновить
        </button>
      </div>
      <p className="muted">
        Видят только организатор и подтверждённые участники. Новые сообщения
        появляются после обновления.
      </p>
      <ErrorBox message={error} />
      {next !== null && (
        <button className="text-button" disabled={busy} onClick={earlier}>
          Более ранние сообщения
        </button>
      )}
      {busy && !messages.length ? (
        <Loading />
      ) : !messages.length ? (
        <p className="muted">Сообщений пока нет. Начните разговор.</p>
      ) : (
        <ol className="chat-list">
          {[...messages].reverse().map((m) => {
            const mine = m.author.id === session.user.id;
            return (
              <li className={`chat-message ${mine ? "mine" : ""}`} key={m.id}>
                <Avatar name={m.author.displayName} />
                <div>
                  <p className="chat-meta">
                    <a
                      className="author-link"
                      href={`#rider/${m.author.handle}`}
                    >
                      <strong>{m.author.displayName}</strong>
                    </a>{" "}
                    <small>{when(m.createdAt)}</small>
                  </p>
                  {m.hiddenBy ? (
                    <p className="muted chat-hidden">
                      Сообщение скрыто{" "}
                      {m.hiddenBy === "moderator"
                        ? "модератором"
                        : "организатором"}
                    </p>
                  ) : (
                    <p className="plain-text">{m.body}</p>
                  )}
                  <div className="chat-actions">
                    {mine && (
                      <button
                        className="text-button danger-text"
                        onClick={() => act(m, "delete")}
                      >
                        Удалить
                      </button>
                    )}
                    {canModerate && !mine && !m.hiddenBy && (
                      <button
                        className="text-button"
                        onClick={() => act(m, "hide")}
                      >
                        Скрыть
                      </button>
                    )}
                    {!mine && !m.hiddenBy && (
                      <ReportButton
                        targetType="ride_message"
                        targetId={m.id}
                        notify={notify}
                      />
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ol>
      )}
      {canWrite ? (
        <form className="comment-form" onSubmit={send}>
          <label>
            <span className="sr-only">Сообщение участникам</span>
            <textarea
              name="body"
              rows={3}
              required
              maxLength={2000}
              placeholder="Время, экипировка, кто кого подвезёт"
            />
          </label>
          <button className="button small" disabled={sending}>
            {sending ? "Отправляем…" : "Отправить"}
            <Icon name="arrow" size={16} />
          </button>
        </form>
      ) : (
        !busy && (
          <p className="form-note">
            Покатушка отменена или скрыта — чат доступен только для чтения.
          </p>
        )
      )}
    </section>
  );
}
