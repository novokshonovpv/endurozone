import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  type Bike,
  type BikeInput,
  type ModelBrand,
  type ModelDetail,
  type ModelSummary,
  type Comment,
  type Page,
  type Post,
  type PostInput,
  type PostKind,
  type Session,
  postKinds,
  levels,
  cityCenters,
} from "@enduro/contracts";
import { api } from "./api.ts";
import {
  Icon,
  Avatar,
  Modal,
  ErrorBox,
  Loading,
  TrailScene,
  formatDate,
} from "./ui.tsx";
import { ReportButton } from "./locations.tsx";
import { go } from "./routing.ts";
import { GarageJournal, BikeServicePanel } from "./garage.tsx";
import { Photos } from "./photos.tsx";
import { FavoriteButton } from "./follows.tsx";
import { FirstSteps } from "./onboarding.tsx";
import {
  CatalogBadge,
  engineText,
  loadBrandModels,
  loadBrands,
} from "./models.tsx";

const noteError = (e: unknown) => (e as Error).message;
export function PostCard({ post }: { post: Post }) {
  return (
    <article className="card post-card">
      <div className={`post-stripe ${post.kind}`} />
      <div className="post-card-inner">
        <div className="author-row">
          <Avatar name={post.author.displayName} />
          <div>
            <a className="author-link" href={`#rider/${post.author.handle}`}>
              <strong>{post.author.displayName}</strong>
            </a>
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
        <Photos kind="posts" id={post.id} compact label={post.title} />
        <div className="post-card-bottom">
          <span className="bike-label">
            <Icon name="bike" size={18} />
            {post.visibility === "public" && !post.hidden ? (
              <a href={`#rider/${post.author.handle}?bike=${post.bike.id}`}>
                {post.bike.make} {post.bike.model} · {post.bike.year}
              </a>
            ) : (
              <>
                {post.bike.make} {post.bike.model} · {post.bike.year}
              </>
            )}
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
// One feed, three views: the community stream, project news (Сообщество) and the
// maintenance and build blogs of the Garage block.
const feedModes = {
  all: {
    eyebrow: "ОПЫТ СООБЩЕСТВА",
    title: "Бортжурналы райдеров",
    kinds: Object.keys(postKinds) as PostKind[],
    start: "",
  },
  news: {
    eyebrow: "ЧТО НОВОГО",
    title: "Новости",
    kinds: ["news"] as PostKind[],
    start: "news",
  },
  service: {
    eyebrow: "БЛОГИ ОБ ОБСЛУЖИВАНИИ",
    title: "Обслуживание и доработки",
    kinds: ["maintenance", "build"] as PostKind[],
    start: "maintenance",
  },
};
export function Feed({
  session,
  mode = "all",
}: {
  session: Session | null;
  mode?: keyof typeof feedModes;
}) {
  const view = feedModes[mode];
  const [posts, setPosts] = useState<Post[]>([]),
    [next, setNext] = useState<number | null>(null),
    [busy, setBusy] = useState(true),
    [error, setError] = useState(""),
    [city, setCity] = useState(""),
    [kind, setKind] = useState(view.start),
    [scope, setScope] = useState<"all" | "following">("all");
  const [retry, setRetry] = useState(0);
  const following = Boolean(session) && scope === "following";
  const source = following ? "/me/feed" : "/feed";
  useEffect(() => {
    let alive = true;
    setBusy(true);
    setError("");
    setPosts([]);
    setNext(null);
    const query = new URLSearchParams({ limit: "12" });
    if (city) query.set("city", city);
    if (kind) query.set("kind", kind);
    api<Page<Post>>(`${source}?${query}`)
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
  }, [city, kind, source, retry]);
  const more = async () => {
    setBusy(true);
    setError("");
    const query = new URLSearchParams({ limit: "12", offset: String(next) });
    if (city) query.set("city", city);
    if (kind) query.set("kind", kind);
    try {
      const p = await api<Page<Post>>(`${source}?${query}`);
      setPosts((old) => [...old, ...p.items]);
      setNext(p.nextOffset);
    } catch (e) {
      setError(noteError(e));
    } finally {
      setBusy(false);
    }
  };
  const cities = [
    ...new Set([
      ...Object.keys(cityCenters),
      ...(session ? [session.user.city] : []),
    ]),
  ];
  const canWrite = mode !== "news" || session?.user.role === "moderator";
  return (
    <>
      {mode === "all" && (
        <section className="hero">
          <TrailScene />
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
            <a
              className="button accent"
              href={session ? "#garage" : "#register"}
            >
              {session ? "Открыть мой гараж" : "Начать свою историю"}
              <Icon name="arrow" />
            </a>
          </div>
          <div className="hero-label">
            <Icon name="mountain" size={30} />
            <span>
              ENDURO.ZONE<small>ТВОЯ ТЕРРИТОРИЯ</small>
            </span>
          </div>
        </section>
      )}
      <div className="feed-layout">
        <section className="feed-main">
          {session && mode === "all" && (
            <FirstSteps key={session.user.id} current="feed" />
          )}
          <div className="section-heading">
            <div>
              <p className="eyebrow">{view.eyebrow}</p>
              <h2>{view.title}</h2>
            </div>
            {canWrite && (
              <a
                className="button outline small"
                href={session ? "#garage" : "#register"}
              >
                <Icon name="plus" size={17} />
                {mode === "news" ? "Опубликовать новость" : "Написать запись"}
              </a>
            )}
          </div>
          {session && mode !== "news" && (
            <div className="scope-tabs" role="tablist" aria-label="Лента">
              {(
                [
                  ["all", "Все райдеры"],
                  ["following", "Мои подписки"],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={value}
                  role="tab"
                  aria-selected={scope === value}
                  className={scope === value ? "active" : ""}
                  onClick={() => setScope(value)}
                >
                  {label}
                </button>
              ))}
            </div>
          )}
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
            {view.kinds.length > 1 && (
              <label>
                <span className="sr-only">Тип записи</span>
                <select value={kind} onChange={(e) => setKind(e.target.value)}>
                  {mode === "all" && <option value="">Все записи</option>}
                  {view.kinds.map((v) => (
                    <option key={v} value={v}>
                      {postKinds[v]}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <span className="filter-note">
              {following ? "Открытые записи подписок" : "Публичные записи"}
            </span>
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
          ) : !posts.length && !error && following ? (
            <div className="card empty-state">
              <span className="feature-icon">
                <Icon name="user" size={30} />
              </span>
              <h3>
                {city || kind
                  ? "Здесь пока нет записей"
                  : "В ленте подписок пока пусто"}
              </h3>
              <p>
                {city || kind
                  ? "Попробуйте другой город или тип записи."
                  : "Подпишитесь на райдеров — здесь появятся их открытые записи. Закрытые и скрытые записи сюда не попадают."}
              </p>
              <a href="#riders" className="button outline">
                Найти райдеров
                <Icon name="arrow" size={17} />
              </a>
            </div>
          ) : !posts.length && !error ? (
            <div className="card empty-state">
              <span className="feature-icon">
                <Icon name="book" size={30} />
              </span>
              <h3>
                {mode === "news"
                  ? "Новостей пока нет"
                  : city || kind !== view.start
                    ? "Здесь пока нет записей"
                    : "Сообщество начинается с вас"}
              </h3>
              <p>
                {mode === "news"
                  ? "Здесь команда проекта и модераторы рассказывают о новых разделах, событиях и партнёрах."
                  : city || kind !== view.start
                    ? "Попробуйте другой город или тип записи."
                    : mode === "service"
                      ? "Расскажите, как меняли масло, обслуживали вилку или дорабатывали мотоцикл, — опыт пригодится другим."
                      : "Опубликуйте первую покатушку, обслуживание или доработку. Здесь появятся истории участников."}
              </p>
              {canWrite && (
                <a
                  href={session ? "#garage" : "#register"}
                  className="button outline"
                >
                  {session ? "Написать в гараже" : "Создать аккаунт"}
                  <Icon name="arrow" size={17} />
                </a>
              )}
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
  addModel,
}: {
  session: Session;
  notify: (s: string) => void;
  /** From a model card: «Добавить в мой гараж» opens the form prefilled. */
  addModel?: string;
}) {
  const [bikes, setBikes] = useState<Bike[]>([]),
    [active, setActive] = useState(""),
    [busy, setBusy] = useState(true),
    [error, setError] = useState(""),
    [revision, setRevision] = useState(0);
  const [bikeEditor, setBikeEditor] = useState<Bike | "new" | null>(null),
    [initialModel, setInitialModel] = useState<ModelSummary>(),
    [postEditor, setPostEditor] = useState(false);
  useEffect(() => {
    if (!addModel) return;
    let alive = true;
    api<ModelDetail>(`/models/${addModel}`)
      .then(({ images, description: _d, specs: _s, url: _u, ...m }) => {
        if (!alive) return;
        setInitialModel({ ...m, image: images[0] ?? null });
        setBikeEditor("new");
        // Back to plain #garage: a reload does not reopen the form, a repeat click does.
        go("garage");
      })
      .catch((e) => alive && setError(noteError(e)));
    return () => {
      alive = false;
    };
  }, [addModel]);
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
            Мотоциклы, обслуживание и всё, что было между выездами.{" "}
            <a href="#models">Справочник моделей →</a>
          </p>
        </div>
        <button className="button" onClick={() => setBikeEditor("new")}>
          <Icon name="plus" />
          Добавить мотоцикл
        </button>
      </div>
      <a className="card garage-mechanic" href="#mechanic">
        <Icon name="wrench" size={26} />
        <span>
          <strong>ИИ-механик</strong>
          <small>
            Спросите о неисправности, ТО или настройке своего мотоцикла.
          </small>
        </span>
        <Icon name="arrow" />
      </a>
      {!busy && (
        <FirstSteps key={`${bikes.length}/${revision}`} current="garage" />
      )}
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
                {currentBike.catalogSlug && (
                  <CatalogBadge
                    key={currentBike.catalogSlug}
                    slug={currentBike.catalogSlug}
                  />
                )}
                <Photos
                  key={currentBike.id}
                  kind="bikes"
                  id={currentBike.id}
                  editable
                  label={`${currentBike.make} ${currentBike.model}`}
                />
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
                {!currentBike.catalogSlug && (
                  <p className="form-note">
                    Привяжите мотоцикл к модели справочника (кнопка
                    «Редактировать»), чтобы подбирать запчасти по узлам и
                    делиться тем, что подошло.
                  </p>
                )}
                <div className="garage-quick-actions">
                  <a
                    className="button outline"
                    href={
                      currentBike.catalogSlug
                        ? `#parts/${currentBike.catalogSlug}`
                        : "#parts"
                    }
                  >
                    <Icon name="gear" />
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
          initial={bikeEditor === "new" ? initialModel : undefined}
          close={() => {
            setBikeEditor(null);
            setInitialModel(undefined);
          }}
          done={() => {
            setBikeEditor(null);
            setInitialModel(undefined);
            setRevision((x) => x + 1);
            notify("Гараж обновлён.");
          }}
        />
      )}
      {postEditor && (
        <PostEditor
          bikes={bikes}
          active={active}
          moderator={session.user.role === "moderator"}
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
  initial,
  close,
  done,
}: {
  bike?: Bike;
  initial?: ModelSummary;
  close: () => void;
  done: () => void;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [confirmDelete, setConfirmDelete] = useState(false);
  // Brand and model come from the reference when they match; free text stays allowed.
  const [make, setMake] = useState(bike?.make ?? initial?.brand ?? ""),
    [model, setModel] = useState(bike?.model ?? initial?.model ?? ""),
    [slug, setSlug] = useState<string | null>(
      bike?.catalogSlug ?? initial?.slug ?? null,
    ),
    [brands, setBrands] = useState<ModelBrand[]>([]),
    [options, setOptions] = useState<ModelSummary[]>(initial ? [initial] : []);
  const engineRef = useRef<HTMLInputElement>(null),
    yearRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    loadBrands().then(setBrands, () => {});
  }, []);
  useEffect(() => {
    const b = brands.find(
      (x) => x.brand.toLowerCase() === make.trim().toLowerCase(),
    );
    if (!b) return;
    let alive = true;
    loadBrandModels(b.brand).then(
      (list) => {
        if (alive) setOptions(list);
      },
      () => {},
    );
    return () => {
      alive = false;
    };
  }, [make, brands]);
  // The same model name in several years: the year tells them apart.
  const names = new Map<string, number>();
  for (const o of options)
    names.set(
      o.model.toLowerCase(),
      (names.get(o.model.toLowerCase()) ?? 0) + 1,
    );
  const label = (o: ModelSummary) =>
    (names.get(o.model.toLowerCase()) ?? 0) > 1
      ? `${o.model} (${o.year ?? o.title})`
      : o.model;
  const linked = options.find((o) => o.slug === slug) ?? null;
  function link(o: ModelSummary) {
    setSlug(o.slug);
    setMake(o.brand);
    setModel(label(o));
    if (engineRef.current && !engineRef.current.value)
      engineRef.current.value = engineText(o);
    if (!bike && o.year && yearRef.current)
      yearRef.current.value = String(o.year);
  }
  function typeModel(value: string) {
    setModel(value);
    const o = options.find(
      (x) => label(x).toLowerCase() === value.trim().toLowerCase(),
    );
    if (o) link(o);
    else setSlug(null);
  }
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    const fields = Object.fromEntries(new FormData(event.currentTarget));
    const body = {
      ...fields,
      year: Number(fields.year),
      hours: Number(fields.hours),
      catalogSlug: fields.catalogSlug ? String(fields.catalogSlug) : null,
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
              value={make}
              onChange={(e) => {
                setMake(e.target.value);
                setSlug(null);
              }}
              list="bike-brands"
              autoComplete="off"
              placeholder="Например, BSE"
            />
            <datalist id="bike-brands">
              {brands.map((b) => (
                <option key={b.brand} value={b.brand} />
              ))}
            </datalist>
          </label>
          <label>
            Модель
            <input
              name="model"
              required
              maxLength={80}
              value={model}
              onChange={(e) => typeModel(e.target.value)}
              list="bike-models"
              autoComplete="off"
              placeholder="Например, T5"
            />
            <datalist id="bike-models">
              {options.map((o) => (
                <option key={o.slug} value={label(o)}>
                  {o.title}
                </option>
              ))}
            </datalist>
          </label>
        </div>
        <input type="hidden" name="catalogSlug" value={slug ?? ""} />
        {linked ? (
          <div className="catalog-pick">
            {linked.image && <img src={linked.image} alt="" />}
            <span>
              <small>Модель из справочника 67МОТО</small>
              <strong>{linked.title}</strong>
              {engineText(linked) && <small>{engineText(linked)}</small>}
            </span>
            <button
              type="button"
              className="text-button"
              onClick={() => setSlug(null)}
            >
              Не та модель
            </button>
          </div>
        ) : (
          options.length > 0 &&
          brands.some(
            (b) => b.brand.toLowerCase() === make.trim().toLowerCase(),
          ) && (
            <p className="form-note">
              Выберите модель из подсказок — справочник знает {options.length}{" "}
              моделей {make.trim()}. Можно ввести и свою.
            </p>
          )
        )}
        <div className="form-grid">
          <label>
            Год выпуска
            <input
              ref={yearRef}
              name="year"
              type="number"
              min={1970}
              max={2100}
              required
              defaultValue={
                bike?.year ?? initial?.year ?? new Date().getFullYear()
              }
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
            ref={engineRef}
            name="engine"
            maxLength={120}
            defaultValue={bike?.engine ?? (initial ? engineText(initial) : "")}
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
  moderator,
}: {
  bikes: Bike[];
  active?: string;
  post?: Post;
  close: () => void;
  done: (p: Post) => void;
  /** News are published by moderators only (the API checks it too). */
  moderator: boolean;
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
              {Object.entries(postKinds)
                .filter(([v]) => v !== "news" || moderator || post?.kind === v)
                .map(([v, l]) => (
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
          После сохранения записи можно добавить до 6 фотографий на её странице.
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
                  <a
                    className="author-link"
                    href={`#rider/${post.author.handle}`}
                  >
                    <strong>{post.author.displayName}</strong>
                  </a>
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
              <Photos
                key={post.id}
                kind="posts"
                id={post.id}
                editable={session?.user.id === post.author.id}
                label={post.title}
                revision={revision}
              />
              {post.hidden && (
                <div className="callout">
                  Запись скрыта модератором. Изменение текста не возвращает её в
                  ленту.
                </div>
              )}
              {session && (
                <FavoriteButton
                  key={post.id + session.user.id}
                  postId={post.id}
                  notify={notify}
                />
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
                      <a
                        className="author-link"
                        href={`#rider/${c.author.handle}`}
                      >
                        <strong>{c.author.displayName}</strong>
                      </a>
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
          moderator={session?.user.role === "moderator"}
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
