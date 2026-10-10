import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import {
  type Bike,
  type Post,
  type Page,
  type BikeService,
  type ServicePlan,
  postKinds,
} from "@enduro/contracts";
import { api } from "./api.ts";
import { ErrorBox, Loading, Icon, Modal } from "./ui.tsx";
const amount = (n: number) =>
  new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 2 }).format(n);
export function GarageJournal({
  bikeId,
  write,
  renderPost,
}: {
  bikeId: string;
  write: () => void;
  renderPost: (p: Post) => ReactNode;
}) {
  const [kind, setKind] = useState("");
  const [posts, setPosts] = useState<Post[]>([]);
  const [next, setNext] = useState<number | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const url = (offset = 0) =>
    `/me/posts?${new URLSearchParams({ bikeId, limit: "12", offset: String(offset), ...(kind ? { kind } : {}) })}`;
  useEffect(() => {
    let alive = true;
    setPosts([]);
    setNext(null);
    setBusy(true);
    setError("");
    api<Page<Post>>(url())
      .then((p) => {
        if (alive) {
          setPosts(p.items);
          setNext(p.nextOffset);
        }
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
  }, [bikeId, kind, retry]);
  const more = async () => {
    if (next === null) return;
    setBusy(true);
    setError("");
    try {
      const p = await api<Page<Post>>(url(next));
      setPosts((old) => [...old, ...p.items]);
      setNext(p.nextOffset);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="garage-journal">
      <div className="section-heading journal-heading">
        <div>
          <p className="eyebrow">ИСТОРИЯ ВЫБРАННОГО МОТОЦИКЛА</p>
          <h2>Мой бортжурнал</h2>
        </div>
        <button className="button" onClick={write}>
          <Icon name="plus" />
          Написать запись
        </button>
      </div>
      <div className="garage-journal-filter">
        <label>
          Тип записей
          <select
            disabled={busy}
            value={kind}
            onChange={(e) => setKind(e.target.value)}
          >
            <option value="">Все записи</option>
            {Object.entries(postKinds).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <p className="muted">
          Публичные записи попадают в сообщество. Закрытые видны только вам.
          План и история ТО всегда личные.
        </p>
      </div>
      <ErrorBox message={error} />
      {error && (
        <button className="text-button" onClick={() => setRetry((x) => x + 1)}>
          Повторить загрузку бортжурнала
        </button>
      )}
      {busy && !posts.length ? (
        <Loading />
      ) : !posts.length && !error ? (
        <div className="card empty-state">
          <Icon name="book" size={30} />
          <h3>
            {kind
              ? "Записей этого типа пока нет"
              : "Первая запись — начало истории"}
          </h3>
          <p>Расскажите о мотоцикле, обслуживании или выезде.</p>
          <button className="button outline" onClick={write}>
            Написать запись
          </button>
        </div>
      ) : (
        <div className="post-list">{posts.map(renderPost)}</div>
      )}
      {next !== null && (
        <button
          className="button outline load-more"
          disabled={busy}
          onClick={more}
        >
          {busy ? "Загружаем…" : "Загрузить более ранние записи"}
        </button>
      )}
    </section>
  );
}
export function BikeServicePanel({
  bike,
  changed,
  notify,
}: {
  bike: Bike;
  changed: () => void;
  notify: (s: string) => void;
}) {
  const [data, setData] = useState<BikeService | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [retry, setRetry] = useState(0),
    [newPlan, setNewPlan] = useState(false),
    [complete, setComplete] = useState<ServicePlan | null>(null),
    [showArchived, setShowArchived] = useState(false);
  const base = `/me/bikes/${bike.id}/service`;
  useEffect(() => {
    let alive = true;
    setError("");
    api<BikeService>(base)
      .then((d) => {
        if (alive) setData(d);
      })
      .catch((e) => {
        if (alive) setError(e.message);
      });
    return () => {
      alive = false;
    };
  }, [bike.id, retry]);
  const refresh = () => {
    setRetry((x) => x + 1);
    changed();
  };
  const toggle = async (p: ServicePlan) => {
    setBusy(true);
    setError("");
    try {
      await api(`${base}/plans/${p.id}/${p.active ? "archive" : "restore"}`, {
        method: "POST",
        body: { version: p.version },
      });
      refresh();
      notify(
        p.active
          ? "Работа убрана в архив. История сохранена."
          : "Работа возвращена в план ТО.",
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const more = async () => {
    if (data?.nextOffset === null || !data) return;
    setBusy(true);
    setError("");
    try {
      const d = await api<BikeService>(`${base}?offset=${data.nextOffset}`);
      setData({ ...d, records: [...data.records, ...d.records] });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const plans = data?.plans.filter((p) => p.active) ?? [],
    archived = data?.plans.filter((p) => !p.active) ?? [];
  return (
    <section className="garage-service">
      <div className="section-heading journal-heading">
        <div>
          <p className="eyebrow">ТОЛЬКО ДЛЯ ВЛАДЕЛЬЦА</p>
          <h2>План обслуживания</h2>
        </div>
        <button className="button outline" onClick={() => setNewPlan(true)}>
          <Icon name="plus" />
          Добавить работу
        </button>
      </div>
      <p className="muted">
        Интервалы задаёте вы по регламенту своей техники. Сроки рассчитываются
        по моточасам в гараже; автоматических уведомлений пока нет.
      </p>
      <ErrorBox message={error} />
      {error && (
        <button className="text-button" onClick={() => setRetry((x) => x + 1)}>
          Обновить план ТО
        </button>
      )}
      {!data && !error ? (
        <Loading />
      ) : (
        data && (
          <>
            <div className="service-plan-grid">
              {plans.map((p) => {
                const remaining = Number((p.dueHours - bike.hours).toFixed(2));
                return (
                  <article className="card service-plan" key={p.id}>
                    <div className="service-plan-head">
                      <Icon name="wrench" />
                      <span
                        className={`tag ${remaining <= 0 ? "service-due" : "green"}`}
                      >
                        {remaining <= 0
                          ? "Пора обслужить"
                          : `Через ${amount(remaining)} ч`}
                      </span>
                    </div>
                    <h3>{p.title}</h3>
                    <p>
                      Следующее ТО: <strong>{amount(p.dueHours)} ч</strong> ·
                      интервал {amount(p.intervalHours)} ч
                    </p>
                    {p.notes && <p className="service-notes">{p.notes}</p>}
                    <div className="service-actions">
                      <button
                        className="button small"
                        disabled={busy}
                        onClick={() => setComplete(p)}
                      >
                        Отметить выполненным
                      </button>
                      <button
                        className="text-button"
                        disabled={busy}
                        onClick={() => toggle(p)}
                      >
                        В архив
                      </button>
                    </div>
                  </article>
                );
              })}
            </div>
            {!plans.length && (
              <div className="card empty-state">
                <Icon name="wrench" size={32} />
                <h3>Настройте обслуживание своей техники</h3>
                <p>
                  Например, добавьте замену масла, проверку фильтра или цепи.
                  Укажите свой интервал и ближайший срок в моточасах.
                </p>
              </div>
            )}
            {archived.length > 0 && (
              <div className="service-archive">
                <button
                  className="text-button"
                  aria-expanded={showArchived}
                  onClick={() => setShowArchived(!showArchived)}
                >
                  Архив работ ({archived.length})
                </button>
                {showArchived &&
                  archived.map((p) => (
                    <div className="card service-archive-row" key={p.id}>
                      <strong>{p.title}</strong>
                      <button
                        className="text-button"
                        disabled={busy}
                        onClick={() => toggle(p)}
                      >
                        Вернуть в план: {p.title}
                      </button>
                    </div>
                  ))}
              </div>
            )}
            <h3 className="service-history-title">История выполненных работ</h3>
            {!data.records.length ? (
              <p className="muted">
                Отметьте работу выполненной — здесь появятся дата, моточасы,
                расходы и ваши заметки.
              </p>
            ) : (
              <div className="service-history">
                {data.records.map((r) => (
                  <article className="card service-record" key={r.id}>
                    <div>
                      <span className="eyebrow">
                        {r.performedOn.split("-").reverse().join(".")} ·{" "}
                        {amount(r.hours)} ч
                      </span>
                      <h3>{r.title}</h3>
                      {r.notes && <p className="service-notes">{r.notes}</p>}
                    </div>
                    <strong>{amount(r.costRub)} ₽</strong>
                  </article>
                ))}
              </div>
            )}
            {data.nextOffset !== null && (
              <button className="button outline" disabled={busy} onClick={more}>
                Более раннее обслуживание
              </button>
            )}
          </>
        )
      )}
      {newPlan && (
        <ServiceForm
          bike={bike}
          close={() => setNewPlan(false)}
          done={() => {
            setNewPlan(false);
            refresh();
            notify("Работа добавлена в план ТО.");
          }}
        />
      )}
      {complete && (
        <ServiceForm
          bike={bike}
          plan={complete}
          close={() => setComplete(null)}
          done={() => {
            setComplete(null);
            refresh();
            notify("Обслуживание записано. Следующий срок пересчитан.");
          }}
        />
      )}
    </section>
  );
}
function ServiceForm({
  bike,
  plan,
  close,
  done,
}: {
  bike: Bike;
  plan?: ServicePlan;
  close: () => void;
  done: () => void;
}) {
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    const fields = Object.fromEntries(new FormData(event.currentTarget));
    const body = plan
      ? {
          version: plan.version,
          performedOn: fields.performedOn,
          hours: Number(fields.hours),
          costRub: Number(fields.costRub),
          notes: fields.notes,
        }
      : {
          title: fields.title,
          intervalHours: Number(fields.intervalHours),
          dueHours: Number(fields.dueHours),
          notes: fields.notes,
        };
    try {
      await api(
        `/me/bikes/${bike.id}/service/plans${plan ? `/${plan.id}/complete` : ""}`,
        { method: "POST", body },
      );
      done();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const today = new Date().toISOString().slice(0, 10);
  return (
    <Modal
      title={plan ? `Выполнено: ${plan.title}` : "Новая работа в плане ТО"}
      close={close}
    >
      <form onSubmit={submit}>
        <ErrorBox message={error} />
        {plan ? (
          <>
            <div className="form-grid">
              <label>
                Дата обслуживания (UTC)
                <input
                  name="performedOn"
                  type="date"
                  max={today}
                  required
                  defaultValue={today}
                />
              </label>
              <label>
                Моточасы при обслуживании
                <input
                  name="hours"
                  type="number"
                  min={plan.lastHours ?? 0}
                  max={100000 - plan.intervalHours}
                  step="0.01"
                  required
                  defaultValue={bike.hours}
                />
              </label>
            </div>
            <label>
              Расходы, ₽
              <input
                name="costRub"
                type="number"
                min={0}
                max={10000000}
                step="0.01"
                required
                defaultValue={0}
              />
            </label>
            <p className="form-note">
              Следующий срок = моточасы обслуживания +{" "}
              {amount(plan.intervalHours)} ч. Текущие моточасы мотоцикла
              увеличатся до указанного значения, если оно больше сохранённого.
            </p>
          </>
        ) : (
          <>
            <label>
              Название работы
              <input
                name="title"
                minLength={2}
                maxLength={120}
                required
                placeholder="Например, замена масла"
              />
            </label>
            <div className="form-grid">
              <label>
                Интервал, моточасы
                <input
                  name="intervalHours"
                  type="number"
                  min={0.01}
                  max={10000}
                  step="0.01"
                  required
                />
              </label>
              <label>
                Ближайшее ТО на моточасах
                <input
                  name="dueHours"
                  type="number"
                  min={0}
                  max={100000}
                  step="0.01"
                  required
                  defaultValue={bike.hours}
                />
              </label>
            </div>
            <p className="form-note">
              Укажите интервал по регламенту своей модели и условиям
              эксплуатации. Сайт не назначает его автоматически.
            </p>
          </>
        )}
        <label>
          {plan
            ? "Что сделали и какие детали использовали"
            : "Заметки к работе"}
          <textarea name="notes" maxLength={2000} rows={3} />
        </label>
        <p className="form-note">
          Эта информация видна только вам. Запись в сообществе создаётся
          отдельно.
        </p>
        <div className="button-row">
          <button className="button" disabled={busy}>
            {busy
              ? "Сохраняем…"
              : plan
                ? "Записать обслуживание"
                : "Сохранить работу"}
          </button>
          <button
            className="button outline"
            type="button"
            disabled={busy}
            onClick={close}
          >
            Отмена
          </button>
        </div>
      </form>
    </Modal>
  );
}
