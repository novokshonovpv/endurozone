import { useEffect, useState } from "react";
import {
  levels,
  type BlockState,
  type BlockedRider,
  type FavoriteState,
  type FollowedRider,
  type FollowSummary,
  type Page,
  type Post,
  type Session,
} from "@enduro/contracts";
import { api } from "./api.ts";
import { Icon, Avatar, ErrorBox, Loading, formatDate } from "./ui.tsx";
import { PostCard } from "./community.tsx";
const counted = (n: number, words: [string, string, string]) =>
  `${n} ${words[n % 100 >= 11 && n % 100 <= 14 ? 2 : n % 10 === 1 ? 0 : n % 10 >= 2 && n % 10 <= 4 ? 1 : 2]}`;
export function FollowPanel({
  handle,
  profileId,
  session,
  onBlockChange,
}: {
  handle: string;
  profileId: string;
  session: Session | null;
  onBlockChange?: () => void;
}) {
  const [summary, setSummary] = useState<FollowSummary | null>(null),
    [blocked, setBlocked] = useState<boolean | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const own = session?.user.id === profileId;
  useEffect(() => {
    let alive = true;
    api<FollowSummary>(`/profiles/${handle}/follow-summary`)
      .then((s) => {
        if (alive) setSummary(s);
      })
      .catch((e) => {
        if (alive) setError(e.message);
      });
    if (session && !own)
      api<BlockState>(`/me/blocks/${handle}`)
        .then((s) => {
          if (alive) setBlocked(s.blocked);
        })
        .catch((e) => {
          if (alive) setError(e.message);
        });
    return () => {
      alive = false;
    };
  }, [handle, session?.user.id, own]);
  async function toggleBlock() {
    if (
      !blocked &&
      !window.confirm(
        `Заблокировать @${handle}? Вы перестанете видеть записи и комментарии друг друга, подписки между вами удалятся, а из ваших покатушек райдер будет исключён. Он не получит уведомления.`,
      )
    )
      return;
    setBusy(true);
    setError("");
    try {
      const s = await api<BlockState>(`/me/blocks/${handle}`, {
        method: blocked ? "DELETE" : "PUT",
      });
      setBlocked(s.blocked);
      setSummary(
        await api<FollowSummary>(`/profiles/${handle}/follow-summary`),
      );
      onBlockChange?.();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function toggle() {
    if (!summary) return;
    setBusy(true);
    setError("");
    try {
      setSummary(
        await api<FollowSummary>(`/me/following/${handle}`, {
          method: summary.viewerFollows ? "DELETE" : "PUT",
        }),
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="follow-panel">
      {summary && (
        <div className="rider-counts follow-counts">
          <span>
            {counted(summary.followerCount, [
              "подписчик",
              "подписчика",
              "подписчиков",
            ])}
          </span>
          <span>
            {counted(summary.followingCount, [
              "подписка",
              "подписки",
              "подписок",
            ])}
          </span>
        </div>
      )}
      {own ? (
        <a className="text-button" href="#following">
          Мои подписки и подписчики →
        </a>
      ) : session && blocked ? (
        <p className="block-note">
          Вы заблокировали этого райдера: вы не видите записи и комментарии друг
          друга, подписка и покатушки вместе недоступны.
        </p>
      ) : session ? (
        summary && (
          <button
            className={`button small ${summary.viewerFollows ? "outline" : ""}`}
            disabled={busy}
            aria-pressed={summary.viewerFollows}
            onClick={toggle}
          >
            {busy ? (
              "Сохраняем…"
            ) : summary.viewerFollows ? (
              <>
                <Icon name="check" size={16} />
                Вы подписаны · отписаться
              </>
            ) : (
              <>
                <Icon name="plus" size={16} />
                Подписаться
              </>
            )}
          </button>
        )
      ) : (
        <p className="muted follow-hint">
          <a href="#login">Войдите</a>, чтобы подписаться и видеть записи
          райдера в своей ленте.
        </p>
      )}
      {session && !own && blocked !== null && (
        <button
          className="text-button block-toggle"
          disabled={busy}
          onClick={toggleBlock}
        >
          {blocked ? "Разблокировать" : "Заблокировать"}
        </button>
      )}
      <ErrorBox message={error} />
    </div>
  );
}
export function FavoriteButton({
  postId,
  notify,
}: {
  postId: string;
  notify: (message: string) => void;
}) {
  const [saved, setSaved] = useState<boolean | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  useEffect(() => {
    let alive = true;
    api<FavoriteState>(`/me/favorites/${postId}`)
      .then((s) => {
        if (alive) setSaved(s.favorited);
      })
      .catch((e) => {
        if (alive) setError(e.message);
      });
    return () => {
      alive = false;
    };
  }, [postId]);
  async function toggle() {
    setBusy(true);
    setError("");
    try {
      await api(`/me/favorites/${postId}`, {
        method: saved ? "DELETE" : "PUT",
      });
      setSaved(!saved);
      notify(saved ? "Запись убрана из избранного." : "Запись в избранном.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  if (saved === null) return <ErrorBox message={error} />;
  return (
    <div className="favorite-action">
      <button
        className={`button small ${saved ? "" : "outline"}`}
        disabled={busy}
        aria-pressed={saved}
        onClick={toggle}
      >
        <Icon name={saved ? "check" : "book"} size={16} />
        {saved ? "В избранном" : "В избранное"}
      </button>
      <ErrorBox message={error} />
    </div>
  );
}
function usePage<T>(path: string) {
  const [items, setItems] = useState<T[]>([]),
    [next, setNext] = useState<number | null>(null),
    [busy, setBusy] = useState(true),
    [error, setError] = useState("");
  useEffect(() => {
    let alive = true;
    setBusy(true);
    setError("");
    setItems([]);
    setNext(null);
    api<Page<T>>(`${path}?limit=12`)
      .then((p) => {
        if (alive) {
          setItems(p.items);
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
  }, [path]);
  async function more() {
    if (next === null) return;
    setBusy(true);
    setError("");
    try {
      const p = await api<Page<T>>(`${path}?limit=12&offset=${next}`);
      setItems((old) => [...old, ...p.items]);
      setNext(p.nextOffset);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return { items, setItems, next, busy, error, more };
}
type PersonRow = Omit<FollowedRider, "followedAt"> &
  Partial<Pick<FollowedRider, "followedAt"> & Pick<BlockedRider, "blockedAt">>;
export function Following({ notify }: { notify: (s: string) => void }) {
  const [tab, setTab] = useState<"following" | "followers" | "blocked">(
    "following",
  );
  const page = usePage<PersonRow>(
      tab === "blocked" ? "/me/blocks" : `/me/${tab}`,
    ),
    [removing, setRemoving] = useState("");
  async function unfollow(r: PersonRow) {
    setRemoving(r.id);
    try {
      const unblocking = tab === "blocked";
      await api(`/me/${unblocking ? "blocks" : "following"}/${r.handle}`, {
        method: "DELETE",
      });
      page.setItems((old) => old.filter((x) => x.id !== r.id));
      notify(
        unblocking
          ? `${r.displayName} разблокирован.`
          : `Вы отписались от ${r.displayName}.`,
      );
    } catch (e) {
      notify((e as Error).message);
    } finally {
      setRemoving("");
    }
  }
  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">ТВОИ ЛЮДИ</p>
          <h1>Подписки</h1>
          <p className="muted">
            Списки видите только вы. Другим участникам показывается лишь
            количество.
          </p>
        </div>
        <a className="button outline" href="#riders">
          Найти райдеров
          <Icon name="arrow" />
        </a>
      </div>
      <div className="scope-tabs" role="tablist" aria-label="Списки подписок">
        {(
          [
            ["following", "Я подписан"],
            ["followers", "Мои подписчики"],
            ["blocked", "Заблокированные"],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            role="tab"
            aria-selected={tab === value}
            className={tab === value ? "active" : ""}
            onClick={() => setTab(value)}
          >
            {label}
          </button>
        ))}
      </div>
      <ErrorBox message={page.error} />
      {page.busy && !page.items.length ? (
        <Loading />
      ) : !page.error && !page.items.length ? (
        <div className="card empty-state">
          <Icon name="user" size={32} />
          <h3>
            {tab === "following"
              ? "Вы пока ни на кого не подписаны"
              : tab === "followers"
                ? "Подписчиков пока нет"
                : "Вы никого не блокировали"}
          </h3>
          <p>
            {tab === "following"
              ? "Откройте страницу райдера и нажмите «Подписаться» — его открытые записи появятся в ленте подписок."
              : tab === "followers"
                ? "Ведите открытый бортжурнал: райдеры смогут подписаться на вас со страницы профиля."
                : "Заблокировать райдера можно на странице его профиля. Список видите только вы."}
          </p>
          {tab === "following" && (
            <a className="button outline" href="#riders">
              Райдеры сообщества
            </a>
          )}
        </div>
      ) : (
        <div className="follow-list">
          {page.items.map((r) => (
            <article className="card follow-row" key={r.id}>
              <Avatar name={r.displayName} />
              <div>
                <a className="author-link" href={`#rider/${r.handle}`}>
                  <strong>{r.displayName}</strong>
                </a>
                <small>
                  @{r.handle} · {r.city} · {levels[r.level]}
                </small>
                <small>
                  {r.blockedAt
                    ? `Заблокирован ${formatDate(r.blockedAt)}`
                    : `Подписка с ${formatDate(r.followedAt!)}`}
                </small>
              </div>
              {tab !== "followers" && (
                <button
                  className="text-button"
                  disabled={removing === r.id}
                  onClick={() => unfollow(r)}
                >
                  {tab === "blocked" ? "Разблокировать" : "Отписаться"}
                </button>
              )}
            </article>
          ))}
        </div>
      )}
      {page.next !== null && (
        <button
          className="button outline rider-pagination"
          disabled={page.busy}
          onClick={page.more}
        >
          {page.busy ? "Загружаем…" : "Показать ещё"}
        </button>
      )}
    </>
  );
}
export function Favorites() {
  const page = usePage<Post>("/me/favorites");
  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">СОХРАНЁННЫЙ ОПЫТ</p>
          <h1>Избранное</h1>
          <p className="muted">
            Список видите только вы. Если автор закроет или удалит запись, она
            исчезнет и отсюда.
          </p>
        </div>
      </div>
      <ErrorBox message={page.error} />
      {page.busy && !page.items.length ? (
        <Loading />
      ) : !page.error && !page.items.length ? (
        <div className="card empty-state">
          <Icon name="book" size={32} />
          <h3>В избранном пока пусто</h3>
          <p>
            Сохраняйте полезные записи кнопкой «В избранное» на странице записи:
            регламенты, доработки, удачные маршруты.
          </p>
          <a className="button outline" href="#feed">
            Перейти в ленту
          </a>
        </div>
      ) : (
        <div className="post-list">
          {page.items.map((p) => (
            <PostCard post={p} key={p.id} />
          ))}
        </div>
      )}
      {page.next !== null && (
        <button
          className="button outline load-more"
          disabled={page.busy}
          onClick={page.more}
        >
          {page.busy ? "Загружаем…" : "Показать ещё"}
        </button>
      )}
    </>
  );
}
