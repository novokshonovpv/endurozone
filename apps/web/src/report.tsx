import { useState, type FormEvent } from "react";
import { reportReasons } from "@enduro/contracts";
import { api } from "./api.ts";
import { ErrorBox, Modal } from "./ui.tsx";
// «Сообщить о проблеме»: a report to moderators. Kept apart from the map so pages with this
// button do not load the map code.
const errorOf = (e: unknown) => (e as Error).message;
export function ReportButton({
  targetType,
  targetId,
  notify,
}: {
  targetType: "post" | "location" | "track" | "ride" | "ride_message";
  targetId: string;
  notify: (message: string) => void;
}) {
  const [open, setOpen] = useState(false),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    setBusy(true);
    setError("");
    try {
      await api("/reports", {
        method: "POST",
        body: {
          targetType,
          targetId,
          reason: data.get("reason"),
          details: data.get("details"),
        },
      });
      setOpen(false);
      notify("Жалоба отправлена модератору.");
    } catch (e) {
      setError(errorOf(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <button
        className="text-button report-button"
        onClick={() => {
          setOpen(true);
          setError("");
        }}
      >
        Сообщить о проблеме
      </button>
      {open && (
        <Modal title="Сообщить о проблеме" close={() => setOpen(false)}>
          <form className="location-form" onSubmit={submit}>
            <ErrorBox message={error} />
            <label>
              Причина
              <select name="reason">
                {Object.entries(reportReasons).map(([v, t]) => (
                  <option key={v} value={v}>
                    {t}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Что произошло?
              <textarea
                name="details"
                rows={4}
                required
                minLength={10}
                maxLength={2000}
              />
            </label>
            <button className="button" disabled={busy}>
              {busy ? "Отправляем…" : "Отправить жалобу"}
            </button>
          </form>
        </Modal>
      )}
    </>
  );
}
