import { useEffect, useState, type FormEvent } from "react";
import {
  levels,
  postKinds,
  type Rider,
  type Profile,
  type PublicBike,
  type Page,
  type Post,
  type Session,
} from "@enduro/contracts";
import { api } from "./api.ts";
import { Icon, Avatar, ErrorBox, Loading } from "./ui.tsx";
import { PostCard } from "./community.tsx";
const counted = (n: number, words: [string, string, string]) =>
  `${n} ${words[n % 100 >= 11 && n % 100 <= 14 ? 2 : n % 10 === 1 ? 0 : n % 10 >= 2 && n % 10 <= 4 ? 1 : 2]}`;
const postCount = (n: number) =>
  counted(n, ["открытая запись", "открытые записи", "открытых записей"]);
export function Riders() {
  const [page, setPage] = useState<Page<Rider>>({
      items: [],
      nextOffset: null,
    }),
    [busy, setBusy] = useState(true),
    [error, setError] = useState(""),
    [query, setQuery] = useState({ q: "", city: "" }),
    [offset, setOffset] = useState(0),
    [retry, setRetry] = useState(0);
  useEffect(() => {
    let alive = true;
    setBusy(true);
    setError("");
    const params = new URLSearchParams({
      ...query,
      limit: "12",
      offset: String(offset),
    });
    api<Page<Rider>>(`/riders?${params}`)
      .then((p) => {
        if (alive) setPage(p);
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
  }, [query, offset, retry]);
  function search(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setOffset(0);
    setQuery({
      q: String(f.get("q") ?? "").trim(),
      city: String(f.get("city") ?? "").trim(),
    });
  }
  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">ТВОИ ЛЮДИ И ИХ ИСТОРИИ</p>
          <h1>Райдеры сообщества</h1>
          <p className="muted">
            Знакомьтесь с авторами открытых бортжурналов. Город в профиле указан
            самим участником.
          </p>
        </div>
      </div>
      <form className="card rider-search" onSubmit={search}>
        <label>
          Имя или ник
          <input
            name="q"
            maxLength={80}
            placeholder="Кого ищем?"
            disabled={busy}
          />
        </label>
        <label>
          Город
          <input
            name="city"
            maxLength={80}
            placeholder="Например, Смоленск"
            disabled={busy}
          />
        </label>
        <button className="button" disabled={busy}>
          Найти райдеров
        </button>
      </form>
      <ErrorBox message={error} />
      {error && (
        <button className="text-button" onClick={() => setRetry((x) => x + 1)}>
          Попробовать снова
        </button>
      )}
      {busy ? (
        <Loading />
      ) : !error && !page.items.length ? (
        <div className="card empty-state">
          <Icon name="user" size={32} />
          <h2>Райдеры пока не найдены</h2>
          <p>
            Попробуйте другое имя или город. В списке появляются участники с
            открытыми записями.
          </p>
        </div>
      ) : (
        !error && (
          <div className="rider-grid">
            {page.items.map((r) => (
              <article className="card rider-card" key={r.id}>
                <div className="author-row">
                  <Avatar name={r.displayName} />
                  <div>
                    <h2>
                      <a href={`#rider/${r.handle}`}>{r.displayName}</a>
                    </h2>
                    <small>
                      @{r.handle} · {r.city}
                    </small>
                  </div>
                </div>
                <span className="tag">{levels[r.level]}</span>
                {r.bio && <p className="rider-bio">{r.bio}</p>}
                <div className="rider-counts">
                  <span>
                    {counted(r.publicBikeCount, [
                      "мотоцикл",
                      "мотоцикла",
                      "мотоциклов",
                    ])}
                  </span>
                  <span>{postCount(r.publicPostCount)}</span>
                </div>
                <a className="button outline small" href={`#rider/${r.handle}`}>
                  Гараж и бортжурнал <Icon name="arrow" size={16} />
                </a>
              </article>
            ))}
          </div>
        )
      )}
      {!error && (offset > 0 || page.nextOffset !== null) && (
        <div className="button-row rider-pagination">
          <button
            className="button outline"
            disabled={busy || offset === 0}
            onClick={() => setOffset((x) => Math.max(0, x - 12))}
          >
            Предыдущие
          </button>
          <button
            className="button outline"
            disabled={busy || page.nextOffset === null}
            onClick={() => setOffset(page.nextOffset!)}
          >
            Следующие
          </button>
        </div>
      )}
    </>
  );
}
export function RiderProfile({
  handle,
  session,
  requestedBike,
}: {
  handle: string;
  session: Session | null;
  requestedBike: string;
}) {
  const [profile, setProfile] = useState<Profile | null>(null),
    [bikes, setBikes] = useState<PublicBike[]>([]),
    [next, setNext] = useState<number | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(true),
    [retry, setRetry] = useState(0);
  useEffect(() => {
    let alive = true;
    setBusy(true);
    setError("");
    Promise.all([
      api<Profile>(`/profiles/${handle}`),
      api<Page<PublicBike>>(`/profiles/${handle}/bikes?limit=12`),
    ])
      .then(([p, b]) => {
        if (alive) {
          setProfile(p);
          setBikes(b.items);
          setNext(b.nextOffset);
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
  }, [handle, retry]);
  async function moreBikes() {
    if (next === null) return;
    setBusy(true);
    setError("");
    try {
      const p = await api<Page<PublicBike>>(
        `/profiles/${handle}/bikes?limit=12&offset=${next}`,
      );
      setBikes((old) => [...old, ...p.items]);
      setNext(p.nextOffset);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <a href="#riders" className="back-link">
        ← Все райдеры
      </a>
      <ErrorBox message={error} />
      {error && (
        <button className="text-button" onClick={() => setRetry((x) => x + 1)}>
          Попробовать снова
        </button>
      )}
      {busy && !profile ? (
        <Loading />
      ) : (
        !error &&
        profile && (
          <>
            <section className="card rider-profile">
              <Avatar name={profile.displayName} />
              <div>
                <p className="eyebrow">РАЙДЕР СООБЩЕСТВА · @{profile.handle}</p>
                <h1>{profile.displayName}</h1>
                <p className="muted">
                  {profile.city} · {levels[profile.level]}
                </p>
                {profile.bio && <p className="rider-bio">{profile.bio}</p>}
              </div>
              {session?.user.id === profile.id && (
                <a className="button outline small" href="#profile">
                  Редактировать профиль
                </a>
              )}
            </section>
            <section className="rider-public-garage">
              <div className="section-heading">
                <h2>Публичный гараж</h2>
                {session?.user.id === profile.id && (
                  <a href="#garage">Мой полный гараж →</a>
                )}
              </div>
              <p className="muted">
                Здесь только техника из открытых записей. Личные заметки,
                моточасы и история ТО доступны владельцу.
              </p>
              {!bikes.length ? (
                <div className="card empty-state">
                  <Icon name="bike" size={32} />
                  <h3>Публичных мотоциклов пока нет</h3>
                  <p>
                    Мотоцикл появится здесь после открытой записи в его
                    бортжурнале.
                  </p>
                </div>
              ) : (
                <div className="rider-bike-grid">
                  {bikes.map((b) => (
                    <article
                      className={`card rider-bike ${requestedBike === b.id ? "selected" : ""}`}
                      key={b.id}
                    >
                      <Icon name="bike" size={28} />
                      <h3>
                        {b.make} {b.model}
                      </h3>
                      <p className="muted">
                        {b.year}
                        {b.modification ? ` · ${b.modification}` : ""}
                      </p>
                      <small>{postCount(b.publicPostCount)}</small>
                      <a
                        className="button outline small"
                        href={`#rider/${handle}?bike=${b.id}`}
                      >
                        Читать бортжурнал
                      </a>
                    </article>
                  ))}
                </div>
              )}
              {next !== null && (
                <button
                  className="button outline rider-pagination"
                  disabled={busy}
                  onClick={moreBikes}
                >
                  {busy ? "Загружаем…" : "Ещё мотоциклы"}
                </button>
              )}
            </section>
            <PublicJournal
              key={`${handle}/${requestedBike}`}
              handle={handle}
              bikes={bikes}
              requestedBike={requestedBike}
            />
          </>
        )
      )}
    </>
  );
}
function PublicJournal({
  handle,
  bikes,
  requestedBike,
}: {
  handle: string;
  bikes: PublicBike[];
  requestedBike: string;
}) {
  const [posts, setPosts] = useState<Post[]>([]),
    [next, setNext] = useState<number | null>(null),
    [kind, setKind] = useState(""),
    [busy, setBusy] = useState(true),
    [error, setError] = useState(""),
    [retry, setRetry] = useState(0);
  const params = () => {
    const q = new URLSearchParams({ limit: "12" });
    if (kind) q.set("kind", kind);
    if (requestedBike) q.set("bikeId", requestedBike);
    return q;
  };
  useEffect(() => {
    let alive = true;
    setBusy(true);
    setError("");
    setPosts([]);
    setNext(null);
    api<Page<Post>>(`/profiles/${handle}/posts?${params()}`)
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
  }, [handle, kind, requestedBike, retry]);
  async function more() {
    if (next === null) return;
    setBusy(true);
    setError("");
    try {
      const q = params();
      q.set("offset", String(next));
      const p = await api<Page<Post>>(`/profiles/${handle}/posts?${q}`);
      setPosts((old) => [...old, ...p.items]);
      setNext(p.nextOffset);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="rider-journal">
      <div className="section-heading">
        <h2>Открытый бортжурнал</h2>
        {requestedBike && <a href={`#rider/${handle}`}>Все мотоциклы →</a>}
      </div>
      <div className="filter-bar">
        <label>
          Мотоцикл в бортжурнале
          <select
            value={requestedBike}
            disabled={busy}
            onChange={(e) => {
              window.location.hash = `rider/${handle}${e.target.value ? `?bike=${e.target.value}` : ""}`;
            }}
          >
            <option value="">Все публичные мотоциклы</option>
            {requestedBike && !bikes.some((b) => b.id === requestedBike) && (
              <option value={requestedBike}>Выбранный мотоцикл</option>
            )}
            {bikes.map((b) => (
              <option value={b.id} key={b.id}>
                {b.make} {b.model} · {b.year}
              </option>
            ))}
          </select>
        </label>
        <label>
          Тип открытых записей
          <select
            value={kind}
            disabled={busy}
            onChange={(e) => setKind(e.target.value)}
          >
            <option value="">Все записи</option>
            {Object.entries(postKinds).map(([v, l]) => (
              <option value={v} key={v}>
                {l}
              </option>
            ))}
          </select>
        </label>
      </div>
      <ErrorBox message={error} />
      {error && (
        <button className="text-button" onClick={() => setRetry((x) => x + 1)}>
          Повторить загрузку
        </button>
      )}
      {busy && !posts.length ? (
        <Loading />
      ) : !error && !posts.length ? (
        <div className="card empty-state">
          <h3>Открытых записей пока нет</h3>
          <p>Попробуйте другой фильтр или загляните позже.</p>
        </div>
      ) : (
        posts.map((p) => <PostCard key={p.id} post={p} />)
      )}
      {next !== null && (
        <button
          className="button outline rider-pagination"
          disabled={busy}
          onClick={more}
        >
          {busy ? "Загружаем…" : "Ещё записи"}
        </button>
      )}
    </section>
  );
}
