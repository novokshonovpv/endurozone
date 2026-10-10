import { useEffect, useState, type FormEvent } from "react";
import {
  type Bike,
  type BikeInput,
  type Comment,
  type Page,
  type Post,
  type PostInput,
  type Session,
  postKinds,
  levels,
} from "@enduro/contracts";
import { api } from "./api.ts";
import {
  Icon,
  Avatar,
  Modal,
  ErrorBox,
  Loading,
  Contours,
  formatDate,
} from "./ui.tsx";
import { ReportButton } from "./locations.tsx";
import { go } from "./routing.ts";
import { GarageJournal, BikeServicePanel } from "./garage.tsx";

const noteError = (e: unknown) => (e as Error).message;
function PostCard({ post }: { post: Post }) {
  return (
    <article className="card post-card">
      <div className={`post-stripe ${post.kind}`} />
      <div className="post-card-inner">
        <div className="author-row">
          <Avatar name={post.author.displayName} />
          <div>
            <strong>{post.author.displayName}</strong>
            <small>
              {post.author.city} · {formatDate(post.createdAt)}
            </small>
          </div>
          <span className="tag">{postKinds[post.kind]}</span>
        </div>
        <a className="post-link" href={`#post/${post.id}`}>
          <h2>{post.title}</h2>
          <p className="post-excerpt">{post.body}</p>
        </a>
        <div className="post-card-bottom">
          <span className="bike-label">
            <Icon name="bike" size={18} />
            {post.bike.make} {post.bike.model} · {post.bike.year}
          </span>
          <a
            href={`#post/${post.id}`}
            className="comment-count"
            aria-label={`Открыть запись, комментариев: ${post.commentCount}`}
          >
            <Icon name="message" size={17} />
            {post.commentCount}
          </a>
          {post.visibility === "private" && (
            <span className="private-tag">
              <Icon name="lock" size={14} />
              Только мне
            </span>
          )}
        </div>
      </div>
    </article>
  );
}
export function Feed({ session }: { session: Session | null }) {
  const [posts, setPosts] = useState<Post[]>([]),
    [next, setNext] = useState<number | null>(null),
    [busy, setBusy] = useState(true),
    [error, setError] = useState(""),
    [city, setCity] = useState(""),
    [kind, setKind] = useState("");
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let alive = true;
    setBusy(true);
    setError("");
    const query = new URLSearchParams({ limit: "12" });
    if (city) query.set("city", city);
    if (kind) query.set("kind", kind);
    api<Page<Post>>(`/feed?${query}`)
      .then((p) => {
        if (alive) {
          setPosts(p.items);
          setNext(p.nextOffset);
        }
      })
      .catch((e) => {
        if (alive) setError(noteError(e));
      })
      .finally(() => {
        if (alive) setBusy(false);
      });
    return () => {
      alive = false;
    };
  }, [city, kind, retry]);
  const more = async () => {
    setBusy(true);
    setError("");
    const query = new URLSearchParams({ limit: "12", offset: String(next) });
    if (city) query.set("city", city);
    if (kind) query.set("kind", kind);
    try {
      const p = await api<Page<Post>>(`/feed?${query}`);
      setPosts((old) => [...old, ...p.items]);
      setNext(p.nextOffset);
    } catch (e) {
      setError(noteError(e));
    } finally {
      setBusy(false);
    }
  };
  const cities = [
    ...new Set(["Смоленск", "Сочи", ...(session ? [session.user.city] : [])]),
  ];
  return (
    <>
      <section className="hero">
        <Contours />
        <div className="hero-content">
          <p className="eyebrow light">
            <span className="hero-dash" />
            ДЛЯ ТЕХ, КТО ВЫБИРАЕТ СВОЙ ПУТЬ
          </p>
          <h1>
            Твой мотоцикл.
            <br />
            Твои люди.
            <br />
            <span>Твоя территория.</span>
          </h1>
          <p>
            Опыт из гаража и с трассы — в одном месте.
            <br />
            Рассказывай, чему научился. Находи тех, кто понимает.
          </p>
          <a className="button accent" href={session ? "#garage" : "#register"}>
            {session ? "Открыть мой гараж" : "Начать свою историю"}
            <Icon name="arrow" />
          </a>
        </div>
        <div className="hero-label">
          <Icon name="mountain" size={30} />
          <span>
            ENDURO.ZONE<small>СМОЛЕНСК × СОЧИ</small>
          </span>
        </div>
      </section>
      <div className="feed-layout">
        <section className="feed-main">
          <div className="section-heading">
            <div>
              <p className="eyebrow">ОПЫТ СООБЩЕСТВА</p>
              <h2>Бортжурналы райдеров</h2>
            </div>
            <a
              className="button outline small"
              href={session ? "#garage" : "#register"}
            >
              <Icon name="plus" size={17} />
              Написать запись
            </a>
          </div>
          <div className="filter-bar">
            <label>
              <span className="sr-only">Город в ленте</span>
              <select value={city} onChange={(e) => setCity(e.target.value)}>
                <option value="">Все города</option>
                {cities.map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
            </label>
            <label>
              <span className="sr-only">Тип записи</span>
              <select value={kind} onChange={(e) => setKind(e.target.value)}>
                <option value="">Все записи</option>
                {Object.entries(postKinds).map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </select>
            </label>
            <span className="filter-note">Публичные записи</span>
          </div>
          <ErrorBox message={error} />
          {error && (
            <button
              className="text-button"
              onClick={() => setRetry((x) => x + 1)}
            >
              Попробовать снова
            </button>
          )}
          {busy && !posts.length ? (
            <Loading />
          ) : !posts.length && !error ? (
            <div className="card empty-state">
              <span className="feature-icon">
                <Icon name="book" size={30} />
              </span>
              <h3>
                {city || kind
                  ? "Здесь пока нет записей"
                  : "Сообщество начинается с вас"}
              </h3>
              <p>
                {city || kind
                  ? "Попробуйте другой город или тип записи."
                  : "Опубликуйте первую покатушку, обслуживание или доработку. Здесь появятся истории участников."}
              </p>
              <a
                href={session ? "#garage" : "#register"}
                className="button outline"
              >
                {session ? "Написать в гараже" : "Создать аккаунт"}
                <Icon name="arrow" size={17} />
              </a>
            </div>
          ) : (
            <div className="post-list">
              {posts.map((p) => (
                <PostCard post={p} key={p.id} />
              ))}
            </div>
          )}
          {next !== null && (
            <button
              className="button outline load-more"
              onClick={more}
              disabled={busy}
            >
              {busy ? "Загружаем…" : "Показать ещё"}
            </button>
          )}
        </section>
        <aside className="feed-aside">
          {session ? (
            <section className="card mini-profile">
              <Avatar name={session.user.displayName} large />
              <h3>{session.user.displayName}</h3>
              <p className="muted">@{session.user.handle}</p>
              <span className="tag">
                {session.user.city} · {levels[session.user.level]}
              </span>
              <a className="button outline full" href="#garage">
                Мой гараж
                <Icon name="arrow" size={16} />
              </a>
            </section>
          ) : (
            <section className="card start-card">
              <Icon name="bike" size={32} />
              <h3>
                Мотоцикл — больше,
                <br />
                чем список деталей.
              </h3>
              <p>
                Сохраните историю обслуживания, доработок и выездов в своём
                гараже.
              </p>
              <a href="#register">
                Добавить свою историю
                <Icon name="arrow" size={17} />
              </a>
            </section>
          )}
          <section className="card next-card">
            <span className="tag green">Уже в проекте</span>
            <h3>
              От гаража
              <br />к маршрутам.
            </h3>
            <p>
              Находите локации, делитесь GPX-треками и собирайте участников на
              совместные покатушки.
            </p>
            <a href="#rides">
              Найти покатушку
              <Icon name="arrow" size={16} />
            </a>
          </section>
          <div className="community-note">
            <Icon name="mountain" size={24} />
            <p>
              Здесь ценят опыт,
              <br />
              взаимопомощь и хороший
              <br />
              день на мотоцикле.
            </p>
          </div>
        </aside>
      </div>
    </>
  );
}
export function Garage({
  session,
  notify,
}: {
  session: Session;
  notify: (s: string) => void;
}) {
  const [bikes, setBikes] = useState<Bike[]>([]),
    [active, setActive] = useState(""),
    [busy, setBusy] = useState(true),
    [error, setError] = useState(""),
    [revision, setRevision] = useState(0);
  const [bikeEditor, setBikeEditor] = useState<Bike | "new" | null>(null),
    [postEditor, setPostEditor] = useState(false);
  useEffect(() => {
    let alive = true;
    setBusy(true);
    setError("");
    api<{ items: Bike[] }>("/me/bikes")
      .then((b) => {
        if (alive) {
          setBikes(b.items);
          setActive((current) =>
            b.items.some((x) => x.id === current)
              ? current
              : (b.items[0]?.id ?? ""),
          );
        }
      })
      .catch((e) => {
        if (alive) setError(noteError(e));
      })
      .finally(() => {
        if (alive) setBusy(false);
      });
    return () => {
      alive = false;
    };
  }, [revision]);
  const currentBike = bikes.find((b) => b.id === active);
  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">
            {session.user.city.toUpperCase()} · ТВОЯ ИСТОРИЯ
          </p>
          <h1>Мой гараж</h1>
          <p className="muted">
            Мотоциклы, обслуживание и всё, что было между выездами.
          </p>
        </div>
        <button className="button" onClick={() => setBikeEditor("new")}>
          <Icon name="plus" />
          Добавить мотоцикл
        </button>
      </div>
      <ErrorBox message={error} />
      {error && (
        <button
          className="text-button"
          onClick={() => setRevision((x) => x + 1)}
        >
          Повторить загрузку
        </button>
      )}
      {busy && !bikes.length ? (
        <Loading />
      ) : !bikes.length && !error ? (
        <div className="card empty-garage">
          <div className="garage-art">
            <Icon name="bike" size={100} />
            <span>01</span>
          </div>
          <div>
            <p className="eyebrow">НАЧНЁМ С ГЛАВНОГО</p>
            <h2>
              Какая техника
              <br />в твоём гараже?
            </h2>
            <p className="muted">
              Добавьте мотоцикл. К нему можно привязать
              <br />
              историю обслуживания, доработки и покатушки.
            </p>
            <button className="button" onClick={() => setBikeEditor("new")}>
              Добавить первый мотоцикл
              <Icon name="plus" />
            </button>
          </div>
        </div>
      ) : (
        <>
          <div className="garage-layout">
            <section className="bike-picker">
              <div className="section-heading">
                <h2>Моя техника</h2>
                <span className="tag">{bikes.length}</span>
              </div>
              {bikes.map((b) => (
                <button
                  key={b.id}
                  className={`bike-tile ${active === b.id ? "selected" : ""}`}
                  onClick={() => setActive(b.id)}
                  aria-pressed={active === b.id}
                >
                  <span className="bike-tile-icon">
                    <Icon name="bike" size={31} />
                  </span>
                  <span>
                    <strong>
                      {b.make} {b.model}
                    </strong>
                    <small>
                      {b.year} · {b.modification || "Версия не указана"}
                    </small>
                  </span>
                  {active === b.id && <Icon name="check" size={18} />}
                </button>
              ))}
            </section>
            {currentBike && (
              <section className="card bike-detail">
                <div className="bike-detail-head">
                  <span className="tag green">В моём гараже</span>
                  <button
                    className="icon-button"
                    aria-label="Редактировать мотоцикл"
                    onClick={() => setBikeEditor(currentBike)}
                  >
                    <Icon name="edit" />
                  </button>
                </div>
                <div className="bike-detail-title">
                  <div>
                    <p className="eyebrow">{currentBike.make}</p>
                    <h2>{currentBike.model}</h2>
                    <p>
                      {currentBike.year} ·{" "}
                      {currentBike.modification || "Уточните модификацию"}
                    </p>
                  </div>
                  <div className="bike-illustration">
                    <Icon name="bike" size={94} />
                  </div>
                </div>
                <div className="bike-stats">
                  <div>
                    <small>МОТОЧАСЫ</small>
                    <strong>
                      {currentBike.hours}
                      <span> ч</span>
                    </strong>
                  </div>
                  <div>
                    <small>ДВИГАТЕЛЬ</small>
                    <strong className="engine-value">
                      {currentBike.engine || "Не указан"}
                    </strong>
                  </div>
                </div>
                {currentBike.notes && (
                  <p className="bike-notes">{currentBike.notes}</p>
                )}
                <p className="form-note">
                  Данные владельца. Для реального подбора запчастей понадобится
                  подтверждённая версия из справочника.
                </p>
                <div className="garage-quick-actions">
                  <a
                    className="button outline"
                    href={`#shop?bike=${currentBike.id}`}
                  >
                    <Icon name="shop" />
                    Подобрать запчасти
                  </a>
                  <button
                    className="button outline"
                    onClick={() => setPostEditor(true)}
                  >
                    <Icon name="book" />
                    Запись о мотоцикле
                  </button>
                </div>
              </section>
            )}
          </div>
          {currentBike && (
            <>
              <BikeServicePanel
                key={currentBike.id}
                bike={currentBike}
                changed={() => setRevision((x) => x + 1)}
                notify={notify}
              />
              <GarageJournal
                key={currentBike.id}
                bikeId={currentBike.id}
                write={() => setPostEditor(true)}
                renderPost={(p) => <PostCard key={p.id} post={p} />}
              />
            </>
          )}
        </>
      )}
      {bikeEditor && (
        <BikeEditor
          bike={bikeEditor === "new" ? undefined : bikeEditor}
          close={() => setBikeEditor(null)}
          done={() => {
            setBikeEditor(null);
            setRevision((x) => x + 1);
            notify("Гараж обновлён.");
          }}
        />
      )}
      {postEditor && (
        <PostEditor
          bikes={bikes}
          active={active}
          close={() => setPostEditor(false)}
          done={(p) => {
            setPostEditor(false);
            notify(
              p.visibility === "public"
                ? "Запись опубликована в сообществе."
                : "Закрытая запись сохранена.",
            );
            go(`post/${p.id}`);
          }}
        />
      )}
    </>
  );
}
function BikeEditor({
  bike,
  close,
  done,
}: {
  bike?: Bike;
  close: () => void;
  done: () => void;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [confirmDelete, setConfirmDelete] = useState(false);
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    const fields = Object.fromEntries(new FormData(event.currentTarget));
    const body = {
      ...fields,
      year: Number(fields.year),
      hours: Number(fields.hours),
    } as unknown as BikeInput;
    try {
      await api(`/me/bikes${bike ? `/${bike.id}` : ""}`, {
        method: bike ? "PATCH" : "POST",
        body,
      });
      done();
    } catch (e) {
      setError(noteError(e));
    } finally {
      setBusy(false);
    }
  };
  const remove = async () => {
    setBusy(true);
    setError("");
    try {
      await api(`/me/bikes/${bike!.id}`, { method: "DELETE" });
      done();
    } catch (e) {
      setError(noteError(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      title={bike ? "Редактировать мотоцикл" : "Добавить мотоцикл"}
      close={close}
    >
      <form onSubmit={submit}>
        <ErrorBox message={error} />
        <div className="form-grid">
          <label>
            Производитель
            <input
              name="make"
              required
              maxLength={60}
              defaultValue={bike?.make}
              placeholder="Например, KTM"
            />
          </label>
          <label>
            Модель
            <input
              name="model"
              required
              maxLength={80}
              defaultValue={bike?.model}
              placeholder="Например, 300 EXC"
            />
          </label>
        </div>
        <div className="form-grid">
          <label>
            Год выпуска
            <input
              name="year"
              type="number"
              min={1970}
              max={2100}
              required
              defaultValue={bike?.year ?? new Date().getFullYear()}
            />
          </label>
          <label>
            Моточасы
            <input
              name="hours"
              type="number"
              min={0}
              max={100000}
              step="0.1"
              required
              defaultValue={bike?.hours ?? 0}
            />
          </label>
        </div>
        <label>
          Модификация
          <input
            name="modification"
            maxLength={120}
            defaultValue={bike?.modification ?? ""}
            placeholder="Версия, комплектация, рынок"
          />
        </label>
        <label>
          Двигатель
          <input
            name="engine"
            maxLength={120}
            defaultValue={bike?.engine ?? ""}
            placeholder="Объём, 2Т / 4Т, код двигателя"
          />
        </label>
        <label>
          Изменения и заметки
          <textarea
            name="notes"
            rows={3}
            maxLength={2000}
            defaultValue={bike?.notes ?? ""}
            placeholder="Изменённые колёса, подвеска, важные особенности"
          />
        </label>
        <p className="form-note">
          Это описание владельца. Для подбора запчастей позже потребуется
          подтверждённая версия из справочника.
        </p>
        <div className="button-row">
          <button className="button" disabled={busy}>
            {busy ? "Сохраняем…" : "Сохранить мотоцикл"}
            <Icon name="check" />
          </button>
          <button
            type="button"
            className="button outline"
            onClick={close}
            disabled={busy}
          >
            Отмена
          </button>
        </div>
      </form>
      {bike && (
        <div className="danger-zone">
          {confirmDelete ? (
            <>
              <p>
                Удалить мотоцикл из гаража? Техника с бортжурналом или планом ТО
                защищена от удаления вместе с историей.
              </p>
              <button
                className="button danger small"
                onClick={remove}
                disabled={busy}
              >
                Подтвердить удаление
              </button>{" "}
              <button
                className="text-button"
                onClick={() => setConfirmDelete(false)}
              >
                Отмена
              </button>
            </>
          ) : (
            <button
              className="text-button danger-text"
              onClick={() => setConfirmDelete(true)}
            >
              Удалить мотоцикл
            </button>
          )}
        </div>
      )}
    </Modal>
  );
}
function PostEditor({
  bikes,
  active,
  post,
  close,
  done,
}: {
  bikes: Bike[];
  active?: string;
  post?: Post;
  close: () => void;
  done: (p: Post) => void;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    const body = Object.fromEntries(
      new FormData(event.currentTarget),
    ) as unknown as PostInput;
    try {
      done(
        await api<Post>(`/posts${post ? `/${post.id}` : ""}`, {
          method: post ? "PATCH" : "POST",
          body,
        }),
      );
    } catch (e) {
      setError(noteError(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      title={post ? "Редактировать запись" : "Новая запись в бортжурнале"}
      close={close}
    >
      <form onSubmit={submit}>
        <ErrorBox message={error} />
        <label>
          Мотоцикл
          <select
            name="bikeId"
            defaultValue={post?.bikeId ?? active ?? bikes[0]?.id}
            required
          >
            {bikes.map((b) => (
              <option key={b.id} value={b.id}>
                {b.make} {b.model} · {b.year}
              </option>
            ))}
          </select>
        </label>
        <div className="form-grid">
          <label>
            Тип записи
            <select name="kind" defaultValue={post?.kind ?? "ride"}>
              {Object.entries(postKinds).map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
          </label>
          <label>
            Кто видит
            <select
              name="visibility"
              defaultValue={post?.visibility ?? "public"}
            >
              <option value="public">Все участники и гости</option>
              <option value="private">Только я</option>
            </select>
          </label>
        </div>
        <label>
          Название
          <input
            name="title"
            defaultValue={post?.title}
            required
            minLength={3}
            maxLength={140}
            placeholder="О чём эта история?"
          />
        </label>
        <label>
          Текст
          <textarea
            name="body"
            defaultValue={post?.body}
            required
            minLength={10}
            maxLength={10000}
            rows={8}
            placeholder="Расскажите, что сделали, как прошло и чему научились…"
          />
        </label>
        <p className="form-note">
          Пока доступны текстовые записи. Фото появятся вместе с защищённым
          хранилищем.
        </p>
        <div className="button-row">
          <button className="button" disabled={busy}>
            {busy
              ? "Сохраняем…"
              : post
                ? "Сохранить изменения"
                : "Сохранить запись"}
            <Icon name="check" />
          </button>
          <button
            type="button"
            className="button outline"
            onClick={close}
            disabled={busy}
          >
            Отмена
          </button>
        </div>
      </form>
    </Modal>
  );
}
export function PostDetail({
  id,
  session,
  notify,
}: {
  id: string;
  session: Session | null;
  notify: (message: string) => void;
}) {
  const [post, setPost] = useState<Post | null>(null),
    [comments, setComments] = useState<Comment[]>([]),
    [next, setNext] = useState<number | null>(null),
    [busy, setBusy] = useState(true),
    [error, setError] = useState(""),
    [commentError, setCommentError] = useState(""),
    [revision, setRevision] = useState(0),
    [posting, setPosting] = useState(false),
    [bikes, setBikes] = useState<Bike[] | null>(null),
    [deleting, setDeleting] = useState(false);
  useEffect(() => {
    let alive = true;
    setBusy(true);
    setError("");
    setPost(null);
    setComments([]);
    setBikes(null);
    setDeleting(false);
    Promise.all([
      api<Post>(`/posts/${id}`),
      api<Page<Comment>>(`/posts/${id}/comments?limit=30`),
    ])
      .then(([p, c]) => {
        if (alive) {
          setPost(p);
          setComments(c.items);
          setNext(c.nextOffset);
        }
      })
      .catch((e) => {
        if (alive) setError(noteError(e));
      })
      .finally(() => {
        if (alive) setBusy(false);
      });
    return () => {
      alive = false;
    };
  }, [id, revision, session?.user.id]);
  const addComment = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    setPosting(true);
    setCommentError("");
    try {
      await api(`/posts/${id}/comments`, {
        method: "POST",
        body: Object.fromEntries(new FormData(form)),
      });
      form.reset();
      setRevision((x) => x + 1);
      notify("Комментарий добавлен.");
    } catch (e) {
      setCommentError(noteError(e));
    } finally {
      setPosting(false);
    }
  };
  const edit = async () => {
    setError("");
    try {
      const result = await api<{ items: Bike[] }>("/me/bikes");
      setBikes(result.items);
    } catch (e) {
      setError(noteError(e));
    }
  };
  const remove = async () => {
    setPosting(true);
    try {
      await api(`/posts/${id}`, { method: "DELETE" });
      go("garage");
      notify("Запись удалена.");
    } catch (e) {
      setError(noteError(e));
    } finally {
      setPosting(false);
    }
  };
  const removeComment = async (commentId: string) => {
    setCommentError("");
    try {
      await api(`/comments/${commentId}`, { method: "DELETE" });
      setRevision((x) => x + 1);
      notify("Комментарий удалён.");
    } catch (e) {
      setCommentError(noteError(e));
    }
  };
  const moreComments = async () => {
    setPosting(true);
    try {
      const c = await api<Page<Comment>>(
        `/posts/${id}/comments?limit=30&offset=${next}`,
      );
      setComments((old) => [...old, ...c.items]);
      setNext(c.nextOffset);
    } catch (e) {
      setCommentError(noteError(e));
    } finally {
      setPosting(false);
    }
  };
  return (
    <div className="article-wrap">
      <a className="back-link" href="#feed">
        ← В сообщество
      </a>
      <ErrorBox message={error} />
      {busy ? (
        <Loading />
      ) : (
        post && (
          <>
            <article className="card full-post">
              <div className="author-row">
                <Avatar name={post.author.displayName} />
                <div>
                  <strong>{post.author.displayName}</strong>
                  <small>
                    {post.author.city} · {formatDate(post.createdAt)}
                  </small>
                </div>
                <span className="tag">{postKinds[post.kind]}</span>
              </div>
              <h1>{post.title}</h1>
              <div className="article-bike">
                <Icon name="bike" />
                <span>
                  {post.bike.make} {post.bike.model} · {post.bike.year}
                  {post.bike.modification ? ` · ${post.bike.modification}` : ""}
                </span>
                {post.visibility === "private" && (
                  <span className="private-tag">
                    <Icon name="lock" size={14} />
                    Только мне
                  </span>
                )}
              </div>
              <div className="article-body">{post.body}</div>
              {post.hidden && (
                <div className="callout">
                  Запись скрыта модератором. Изменение текста не возвращает её в
                  ленту.
                </div>
              )}
              {session && post.visibility === "public" && !post.hidden && (
                <ReportButton
                  targetType="post"
                  targetId={post.id}
                  notify={notify}
                />
              )}
              {session?.user.id === post.author.id && (
                <div className="article-actions">
                  <button className="button outline small" onClick={edit}>
                    <Icon name="edit" size={16} />
                    Редактировать
                  </button>
                  <button
                    className="text-button danger-text"
                    onClick={() => setDeleting(!deleting)}
                  >
                    Удалить
                  </button>
                  {deleting && (
                    <div className="delete-confirm">
                      <p>Удалить запись и её комментарии?</p>
                      <button
                        className="button danger small"
                        disabled={posting}
                        onClick={remove}
                      >
                        Подтвердить удаление
                      </button>
                      <button
                        className="text-button"
                        onClick={() => setDeleting(false)}
                      >
                        Отмена
                      </button>
                    </div>
                  )}
                </div>
              )}
            </article>
            <section className="card comments">
              <h2>
                Комментарии <span>{post.commentCount}</span>
              </h2>
              <ErrorBox message={commentError} />
              {session && !post.hidden ? (
                <form className="comment-form" onSubmit={addComment}>
                  <label>
                    <span className="sr-only">Ваш комментарий</span>
                    <textarea
                      name="body"
                      rows={3}
                      required
                      maxLength={2000}
                      placeholder="Поделитесь опытом или задайте вопрос"
                    />
                  </label>
                  <button className="button small" disabled={posting}>
                    {posting ? "Отправляем…" : "Отправить комментарий"}
                    <Icon name="arrow" size={16} />
                  </button>
                </form>
              ) : (
                <p className="comment-login">
                  <a href="#login">Войдите</a>, чтобы оставить комментарий.
                </p>
              )}
              {comments.length ? (
                comments.map((c) => (
                  <div className="comment" key={c.id}>
                    <Avatar name={c.author.displayName} />
                    <div>
                      <strong>{c.author.displayName}</strong>
                      <small>{formatDate(c.createdAt)}</small>
                      <p>{c.body}</p>
                      {session?.user.id === c.author.id && (
                        <button
                          className="text-button danger-text"
                          onClick={() => removeComment(c.id)}
                        >
                          Удалить комментарий
                        </button>
                      )}
                    </div>
                  </div>
                ))
              ) : (
                <p className="muted">
                  Пока без комментариев. Начните разговор.
                </p>
              )}
              {next !== null && (
                <button
                  className="button outline small"
                  disabled={posting}
                  onClick={moreComments}
                >
                  Более ранние комментарии
                </button>
              )}
            </section>
          </>
        )
      )}
      {bikes && post && (
        <PostEditor
          bikes={bikes}
          post={post}
          close={() => setBikes(null)}
          done={() => {
            setBikes(null);
            setRevision((x) => x + 1);
            notify("Запись обновлена.");
          }}
        />
      )}
    </div>
  );
}
