import { useEffect, useState, type ChangeEvent } from "react";
import type { Photo } from "@enduro/contracts";
import { api } from "./api.ts";
import { ErrorBox, Modal, Loading } from "./ui.tsx";
export function Photos({
  kind,
  id,
  editable = false,
  compact = false,
  label = "Фотография",
  revision = 0,
}: {
  kind: "bikes" | "posts";
  id: string;
  editable?: boolean;
  compact?: boolean;
  label?: string;
  revision?: number;
}) {
  const [items, setItems] = useState<Photo[]>([]),
    [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [retry, setRetry] = useState(0),
    [open, setOpen] = useState<Photo | null>(null),
    [removing, setRemoving] = useState<string | null>(null),
    [notice, setNotice] = useState("");
  const path = `/${kind}/${id}/photos`;
  useEffect(() => {
    let alive = true;
    setItems([]);
    setOpen(null);
    setRemoving(null);
    setError("");
    setLoading(true);
    api<{ items: Photo[] }>(path)
      .then((p) => {
        if (alive) setItems(p.items);
      })
      .catch((e) => {
        if (alive) setError(e.message);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [path, retry, revision]);
  async function upload(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setError("");
    setNotice("");
    if (file.size > 5 * 1024 * 1024) {
      setError("Выберите фото не больше 5 МБ.");
      return;
    }
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
      setError("Поддерживаются JPEG, PNG и WebP.");
      return;
    }
    setBusy(true);
    try {
      const data = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result).split(",")[1]);
        reader.onerror = () =>
          reject(new Error("Не удалось прочитать файл. Выберите его снова."));
        reader.readAsDataURL(file);
      });
      const photo = await api<Photo>(path, { method: "POST", body: { data } });
      setItems((old) => (kind === "bikes" ? [photo] : [...old, photo]));
      setOpen(null);
      setRemoving(null);
      setNotice(kind === "bikes" ? "Обложка сохранена." : "Фото добавлено.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function remove() {
    if (!removing) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await api(`/photos/${removing}`, { method: "DELETE" });
      setItems((old) => old.filter((p) => p.id !== removing));
      setOpen(null);
      setRemoving(null);
      setNotice("Фото удалено.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  if (compact)
    return items.length ? (
      <div className="photo-preview">
        <button
          type="button"
          aria-label={`Посмотреть: ${label}`}
          onClick={() => setOpen(items[0])}
        >
          <img src={items[0].url} alt={label} loading="lazy" />
        </button>
        {open && (
          <Modal title={label} close={() => setOpen(null)}>
            <img className="photo-expanded" src={open.url} alt={label} />
          </Modal>
        )}
      </div>
    ) : null;
  return (
    <section
      className={`photos-panel ${kind === "bikes" ? "bike-photos" : "post-photos"}`}
      aria-label={kind === "bikes" ? "Фото мотоцикла" : "Фотографии записи"}
    >
      {editable && (
        <div className="photo-heading">
          <h3>{kind === "bikes" ? "Фото мотоцикла" : "Фотографии записи"}</h3>
          <span className="muted">
            {items.length} / {kind === "bikes" ? 1 : 6}
          </span>
        </div>
      )}
      {loading && editable && <Loading />}
      <ErrorBox message={error} />
      {error && !loading && (
        <button
          className="text-button"
          disabled={busy}
          onClick={() => setRetry((x) => x + 1)}
        >
          Обновить фотографии
        </button>
      )}
      <div className="photo-grid">
        {items.map((p, index) => (
          <div className="photo-item" key={p.id}>
            <button
              type="button"
              className="photo-view"
              aria-label={`Посмотреть фото ${index + 1}`}
              onClick={() => setOpen(p)}
            >
              <img src={p.url} alt={`${label} ${index + 1}`} loading="lazy" />
            </button>
            {editable && (
              <button
                className="text-button danger-text"
                disabled={busy}
                onClick={() => setRemoving(p.id)}
              >
                Удалить фото {index + 1}
              </button>
            )}
          </div>
        ))}
      </div>
      {editable && (
        <>
          <label className="photo-upload">
            {busy
              ? "Сохраняем фото…"
              : kind === "bikes" && items.length
                ? "Заменить обложку"
                : "Добавить фото"}
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp"
              disabled={
                busy || loading || (kind === "posts" && items.length >= 6)
              }
              onChange={upload}
            />
          </label>
          <p className="form-note">
            JPEG, PNG или WebP до 5 МБ и 24 мегапикселей.{" "}
            {kind === "bikes"
              ? "Обложка станет публичной, когда у мотоцикла есть открытая запись. Замена удалит прежнюю обложку."
              : "Фото доступны тем же людям, что и запись."}{" "}
            Координаты съёмки удаляются при загрузке.
          </p>
          {removing && (
            <div className="delete-confirm">
              <p>Удалить выбранное фото без возможности восстановления?</p>
              <button
                type="button"
                className="button danger small"
                disabled={busy}
                onClick={remove}
              >
                Подтвердить удаление фото
              </button>
              <button
                type="button"
                className="text-button"
                disabled={busy}
                onClick={() => setRemoving(null)}
              >
                Отмена
              </button>
            </div>
          )}
          {notice && (
            <p role="status" className="form-note">
              {notice}
            </p>
          )}
        </>
      )}
      {open && (
        <Modal title={label} close={() => setOpen(null)}>
          <img className="photo-expanded" src={open.url} alt={label} />
        </Modal>
      )}
    </section>
  );
}
