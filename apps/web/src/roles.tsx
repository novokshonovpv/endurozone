import { useEffect, useState, type FormEvent } from "react";
import type { Moderators, Role } from "@enduro/contracts";
import { api } from "./api.ts";
import { Avatar, ErrorBox, Icon } from "./ui.tsx";
// Moderators grant and revoke the role by exact handle; the server keeps at least one.
export function ModeratorRoles({
  notify,
  selfId,
}: {
  notify: (message: string) => void;
  selfId: string;
}) {
  const [items, setItems] = useState<Moderators["items"]>([]),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [revision, setRevision] = useState(0);
  useEffect(() => {
    let alive = true;
    api<Moderators>("/moderation/moderators")
      .then((r) => {
        if (alive) setItems(r.items);
      })
      .catch((e) => {
        if (alive) setError(e.message);
      });
    return () => {
      alive = false;
    };
  }, [revision]);
  async function change(handle: string, role: Role, reason: string) {
    setBusy(true);
    setError("");
    try {
      await api("/moderation/roles", {
        method: "POST",
        body: { handle, role, reason },
      });
      notify(
        role === "moderator"
          ? `@${handle} теперь модератор.`
          : `Роль модератора у @${handle} снята.`,
      );
      setRevision((x) => x + 1);
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  }
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget,
      f = new FormData(form);
    const ok = await change(
      String(f.get("handle") ?? "")
        .trim()
        .replace(/^@/, "")
        .toLowerCase(),
      "moderator",
      String(f.get("reason") ?? ""),
    );
    if (ok) form.reset();
  }
  return (
    <section className="card moderator-roles">
      <h2>
        <Icon name="user" /> Модераторы
      </h2>
      <p className="muted">
        Модератор проверяет места и треки, разбирает жалобы и отзывы пилота.
        Последнего модератора снять нельзя.
      </p>
      <ErrorBox message={error} />
      <ul className="moderator-list">
        {items.map((m) => (
          <li key={m.id}>
            <Avatar name={m.displayName} />
            <span>
              <a className="author-link" href={`#rider/${m.handle}`}>
                <strong>{m.displayName}</strong>
              </a>
              <small>@{m.handle}</small>
            </span>
            {items.length > 1 && (
              <button
                className="text-button danger-text"
                disabled={busy}
                onClick={() => {
                  const reason = window.prompt(
                    `Почему снимаете роль у @${m.handle}? (от 10 символов)`,
                  );
                  if (reason) void change(m.handle, "member", reason);
                }}
              >
                {m.id === selfId ? "Отказаться от роли" : "Снять роль"}
              </button>
            )}
          </li>
        ))}
      </ul>
      <form className="decision-form" onSubmit={submit}>
        <label>
          Ник участника
          <input
            name="handle"
            required
            minLength={3}
            maxLength={25}
            placeholder="rider_smolensk"
            autoCapitalize="none"
          />
        </label>
        <label>
          Причина
          <input
            name="reason"
            required
            minLength={10}
            maxLength={500}
            placeholder="Помогает проверять места в Сочи"
          />
        </label>
        <button className="button small" disabled={busy}>
          Назначить модератором
        </button>
      </form>
    </section>
  );
}
