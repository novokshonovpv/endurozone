import { useState, type FormEvent } from "react";
import { api } from "./api.ts";
import { ErrorBox } from "./ui.tsx";
export function AccountData({ deleted }: { deleted: () => void }) {
  const [mode, setMode] = useState<"export" | "delete" | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const form = e.currentTarget,
      data = new FormData(form);
    try {
      if (mode === "export") {
        const result = await api<unknown>("/me/export", {
          method: "POST",
          body: { password: data.get("password") },
        });
        const url = URL.createObjectURL(
          new Blob([JSON.stringify(result, null, 2)], {
            type: "application/json",
          }),
        );
        const a = document.createElement("a");
        a.href = url;
        a.download = "enduro-zone-account.json";
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        setMessage(
          "Выгрузка подготовлена. Файл содержит ваши личные данные и оригиналы GPX — храните его приватно.",
        );
        form.reset();
        setMode(null);
      } else {
        await api("/me/delete", {
          method: "POST",
          body: {
            password: data.get("password"),
            confirmation: data.get("confirmation"),
          },
        });
        deleted();
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="card notification-card">
      <h2>Мои данные</h2>
      <p>
        Выгрузите собственные записи, гараж, маршруты, покатушки и историю
        участия. Пароли, ссылки доступа и чужие приватные сведения в файл не
        включаются.
      </p>
      <div className="notification-actions">
        <button
          className="text-button"
          disabled={busy}
          onClick={() => {
            setMode("export");
            setError("");
          }}
        >
          Скачать мои данные
        </button>
        <button
          className="text-button danger-text"
          disabled={busy}
          onClick={() => {
            setMode("delete");
            setError("");
          }}
        >
          Удалить аккаунт
        </button>
      </div>
      <ErrorBox message={error} />
      {message && <p role="status">{message}</p>}
      {mode && (
        <form className="account-data-form" onSubmit={submit} key={mode}>
          <h3>
            {mode === "export"
              ? "Подтвердите выгрузку"
              : "Удаление без восстановления"}
          </h3>
          {mode === "delete" && (
            <>
              <p>
                Будут удалены профиль, гараж, записи и комментарии, локации,
                GPX-оригиналы, уведомления, заявки и все сеансы. Ваши покатушки
                и покатушки других организаторов на ваших треках тоже будут
                удалены. Участники получат уведомление.
              </p>
              <p>
                Независимые записи других авторов с упоминаниями о вас и
                обезличенный журнал ваших решений модератора сохраняются.
                Удаление относится к основной базе; резервные копии и локальные
                тестовые письма очищает оператор.
              </p>
              <label>
                Введите УДАЛИТЬ АККАУНТ
                <input
                  name="confirmation"
                  required
                  pattern="УДАЛИТЬ АККАУНТ"
                  autoComplete="off"
                />
              </label>
            </>
          )}
          <label>
            Текущий пароль
            <input
              name="password"
              type="password"
              autoComplete="current-password"
              required
              maxLength={128}
            />
          </label>
          <div className="notification-actions">
            <button
              className={`button ${mode === "delete" ? "danger" : ""}`}
              disabled={busy}
            >
              {busy
                ? "Обрабатываем…"
                : mode === "delete"
                  ? "Безвозвратно удалить мой аккаунт"
                  : "Подготовить файл"}
            </button>
            <button
              type="button"
              className="text-button"
              disabled={busy}
              onClick={() => setMode(null)}
            >
              Отмена
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
