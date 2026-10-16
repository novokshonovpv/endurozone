import { useEffect, useState, type FormEvent } from "react";
import { api, RequestError, setSessionToken } from "./api.ts";
import {
  Icon,
  Avatar,
  ErrorBox,
  Loading,
  TrailScene,
  type IconName,
} from "./ui.tsx";
import { Feed, Garage, PostDetail } from "./community.tsx";
import {
  levels,
  type Session,
  type RegisterInput,
  type Profile,
} from "@enduro/contracts";
import { Tracks, TrackDetail, Rides, RideDetail } from "./adventure.tsx";
import { Locations, Moderation } from "./locations.tsx";
import { go } from "./routing.ts";
import {
  Account,
  Recovery,
  Notifications,
  NotificationBell,
} from "./pilot.tsx";
import { AccountData } from "./account-rights.tsx";
import { Shop } from "./shop.tsx";
import { Riders, RiderProfile } from "./riders.tsx";
import { Mechanic } from "./mechanic.tsx";
import { Learning } from "./learning.tsx";
import { Following, Favorites } from "./follows.tsx";
import { Nearby } from "./nearby.tsx";
import { SectionLinks, SectionTabs, tabOf } from "./sections.tsx";
import { Events } from "./events.tsx";
import { AddTrack } from "./add-track.tsx";
import { FeedbackButton, MyFeedback, PilotFeedback } from "./feedback.tsx";
import { TabBar } from "./tabbar.tsx";
import { Game } from "./game.tsx";
import { Models, ModelPage } from "./models.tsx";
import { Parts } from "./parts.tsx";

// Personal pages: in the sidebar under «Моё» and in the phone «Меню» sheet.
const personal: { path: string; label: string; icon: IconName }[] = [
  { path: "following", label: "Подписки", icon: "user-heart" },
  { path: "saved", label: "Избранное", icon: "bookmark" },
  { path: "profile", label: "Мой профиль", icon: "user-circle" },
  { path: "account", label: "Доступ к аккаунту", icon: "lock" },
];
const details: [string, string][] = [
  ["rider/", "Страница райдера"],
  ["learning/", "Урок"],
  ["shop/", "Карточка товара"],
  ["post/", "Бортжурнал"],
  ["track/", "GPX-трек"],
  ["ride/", "Покатушка"],
  ["model/", "Модель"],
  ["parts/", "Подбор запчастей"],
  ["add-track", "Добавь свою трассу"],
];
const pages: Record<string, string> = {
  game: "Игра",
  roadmap: "Ход разработки",
  notifications: "Уведомления",
  moderation: "Модерация",
  "pilot-feedback": "Отзывы пилота",
  feedback: "Мои отзывы",
};
function crumb(route: string) {
  const found = tabOf(route);
  const detail = details.find(([p]) => route.startsWith(p))?.[1];
  if (found) return `${found.section.label} · ${detail ?? found.tab.label}`;
  return (
    pages[route] ??
    personal.find((n) => n.path === route)?.label ??
    "Добро пожаловать"
  );
}
function useRoute() {
  const [route, set] = useState(window.location.hash.slice(1) || "feed");
  useEffect(() => {
    const change = () => {
      set(window.location.hash.slice(1) || "feed");
      window.scrollTo(0, 0);
    };
    window.addEventListener("hashchange", change);
    return () => window.removeEventListener("hashchange", change);
  }, []);
  return route;
}
export default function App() {
  const rawRoute = useRoute();
  const route = rawRoute.split("?")[0];
  const shopBike =
    new URLSearchParams(rawRoute.split("?")[1] ?? "").get("bike") ?? "";
  const addModel =
    new URLSearchParams(rawRoute.split("?")[1] ?? "").get("model") ?? undefined;
  // #map?place=<id>: notifications and shared links open one place's card.
  const focusPlace =
    new URLSearchParams(rawRoute.split("?")[1] ?? "").get("place") ?? undefined;
  const [session, setSession] = useState<Session | null>(null),
    [ready, setReady] = useState(false),
    [connectionError, setConnectionError] = useState(""),
    [notice, setNotice] = useState(""),
    [menuOpen, setMenuOpen] = useState(false);
  // The phone menu sheet closes on any navigation.
  useEffect(() => setMenuOpen(false), [route]);
  const updateSession = (next: Session | null) => {
    setSessionToken(next);
    setSession(next);
  };
  useEffect(() => {
    let alive = true;
    api<Session>("/me")
      .then((s) => {
        if (alive) {
          setSessionToken(s);
          setSession(s);
        }
      })
      .catch((e) => {
        if (alive && !(e instanceof RequestError && e.status === 401))
          setConnectionError(e.message);
      })
      .finally(() => {
        if (alive) setReady(true);
      });
    return () => {
      alive = false;
    };
  }, []);
  useEffect(() => {
    if (notice) {
      const timer = setTimeout(() => setNotice(""), 5000);
      return () => clearTimeout(timer);
    }
  }, [notice]);
  const logout = async () => {
    try {
      await api("/auth/logout", { method: "POST" });
      updateSession(null);
      go("feed");
      setNotice("Вы вышли из аккаунта.");
    } catch (e) {
      setNotice((e as Error).message);
    }
  };
  return (
    <div className={`shell ${route === "game" ? "route-game" : ""}`}>
      <aside className={`sidebar ${menuOpen ? "menu-open" : ""}`}>
        <a className="brand" href="#feed" aria-label="Enduro.Zone, сообщество">
          <span className="brand-mark">
            EZ
            <span />
          </span>
          <span>
            ENDURO<span className="brand-zone">.ZONE</span>
            <small>ТВОЯ ТЕРРИТОРИЯ ЭНДУРО</small>
          </span>
        </a>
        <button
          className="menu-toggle"
          aria-expanded={menuOpen}
          aria-controls="all-sections"
          onClick={() => setMenuOpen((x) => !x)}
        >
          {menuOpen ? (
            <Icon name="close" size={18} />
          ) : (
            <span className="burger" />
          )}
          Меню
        </button>
        <nav aria-label="Основные разделы" className="block-nav">
          <SectionLinks route={route} className="nav-item" iconSize={20} />
        </nav>
        <div className="nav-caption">МОЁ</div>
        <nav aria-label="Личные разделы" id="all-sections">
          {personal.map((n) => (
            <a
              key={n.path}
              href={`#${n.path}`}
              className={`nav-item ${route === n.path ? "active" : ""}`}
            >
              <Icon name={n.icon} />
              {n.label}
            </a>
          ))}
          {session?.user.role === "moderator" && (
            <>
              <a
                className={`nav-item ${route === "moderation" ? "active" : ""}`}
                href="#moderation"
              >
                <Icon name="shield-check" />
                Модерация
              </a>
              <a
                className={`nav-item ${route === "pilot-feedback" ? "active" : ""}`}
                href="#pilot-feedback"
              >
                <Icon name="message" />
                Отзывы пилота
              </a>
            </>
          )}
        </nav>
        <a
          className={`nav-item roadmap-link ${route === "roadmap" ? "active" : ""}`}
          href="#roadmap"
        >
          <Icon name="mountain" />
          Ход разработки
        </a>
        <div className="sidebar-bottom">
          <span className="tiny-dot" />
          Первая рабочая версия
          <small>
            Твоя территория
            <br />
            Создаём вместе. Катаемся вместе.
          </small>
          <a
            href="https://github.com/novokshonovpv/endurozone"
            target="_blank"
            rel="noreferrer"
          >
            Исходники проекта ↗
          </a>
        </div>
      </aside>
      <div className="workspace">
        <header className="topbar">
          <span className="breadcrumb">{crumb(route)}</span>
          <div className="top-actions">
            <span className="version">
              <span className="tiny-dot" />
              Разработка · 0.29.3
            </span>
            {session ? (
              <>
                <NotificationBell route={route} />
                <a href="#profile" className="top-user">
                  <Avatar name={session.user.displayName} />
                  <span>{session.user.displayName}</span>
                </a>
                <button className="text-button" onClick={logout}>
                  Выйти
                </button>
              </>
            ) : (
              <>
                <a className="text-button" href="#login">
                  Войти
                </a>
                <a className="button small" href="#register">
                  Присоединиться
                  <Icon name="arrow" size={16} />
                </a>
              </>
            )}
          </div>
        </header>
        <main>
          <ErrorBox message={connectionError} />
          {session &&
            !session.user.emailVerified &&
            !route.startsWith("verify/") && (
              <p className="card form-note">
                Подтвердите email для участия в закрытом пилоте.{" "}
                <a href="#account">Доступ к аккаунту</a>
              </p>
            )}
          {ready && <SectionTabs route={route} />}
          {!ready ? (
            <Loading />
          ) : route === "login" || route === "register" ? (
            <AuthForm
              mode={route}
              done={(s) => {
                updateSession(s);
                go("garage");
                setNotice(
                  route === "register"
                    ? "Добро пожаловать! Добавьте свой мотоцикл."
                    : "Вы вошли в аккаунт.",
                );
              }}
            />
          ) : route === "forgot" ||
            route.startsWith("reset/") ||
            route.startsWith("verify/") ? (
            <Recovery key={route} route={route} refresh={updateSession} />
          ) : route === "reset-done" || route === "verify-done" ? (
            <section className="card">
              <h1>Готово</h1>
              <a href="#login">Вернуться ко входу</a>
            </section>
          ) : route === "account" ? (
            session ? (
              <>
                <Account
                  key={session.user.id}
                  session={session}
                  refresh={updateSession}
                />
                <AccountData
                  deleted={() => {
                    updateSession(null);
                    go("feed");
                    setNotice("Аккаунт и данные в основной базе удалены.");
                  }}
                />
              </>
            ) : (
              <JoinGate />
            )
          ) : route === "notifications" ? (
            session ? (
              <Notifications key={session.user.id} />
            ) : (
              <JoinGate />
            )
          ) : route === "feedback" ? (
            session ? (
              <MyFeedback key={session.user.id} />
            ) : (
              <JoinGate />
            )
          ) : route === "pilot-feedback" ? (
            session?.user.role === "moderator" ? (
              <PilotFeedback key={session.user.id} notify={setNotice} />
            ) : (
              <JoinGate />
            )
          ) : route === "following" ? (
            session ? (
              <Following key={session.user.id} notify={setNotice} />
            ) : (
              <JoinGate />
            )
          ) : route === "saved" ? (
            session ? (
              <Favorites key={session.user.id} />
            ) : (
              <JoinGate />
            )
          ) : route === "game" ? (
            <Game />
          ) : route === "garage" ? (
            session ? (
              <Garage
                key={session.user.id}
                session={session}
                notify={setNotice}
                addModel={addModel}
              />
            ) : (
              <JoinGate />
            )
          ) : route === "profile" ? (
            session ? (
              <ProfileForm
                session={session}
                done={(s) => {
                  updateSession(s);
                  setNotice("Профиль сохранён.");
                }}
              />
            ) : (
              <JoinGate />
            )
          ) : route.startsWith("post/") ? (
            <PostDetail
              id={route.slice(5)}
              session={session}
              notify={setNotice}
            />
          ) : route === "nearby" ? (
            <Nearby key={session?.user.id ?? "guest"} session={session} />
          ) : route === "map" || route === "services" ? (
            <Locations
              key={route}
              view={route === "map" ? "spots" : "services"}
              focus={focusPlace}
              session={session}
              notify={setNotice}
            />
          ) : route === "news" || route === "service" ? (
            <Feed
              key={route}
              session={session}
              mode={route === "news" ? "news" : "service"}
            />
          ) : route === "events" ? (
            <Events session={session} notify={setNotice} />
          ) : route === "tracks" ? (
            <Tracks
              key={session?.user.id}
              session={session}
              notify={setNotice}
              upload={
                new URLSearchParams(rawRoute.split("?")[1] ?? "").get(
                  "upload",
                ) === "1"
              }
            />
          ) : route === "add-track" ? (
            <AddTrack session={session} />
          ) : route.startsWith("track/") ? (
            <TrackDetail
              key={route + session?.user.id}
              id={route.slice(6)}
              session={session}
              notify={setNotice}
            />
          ) : route === "rides" ? (
            <Rides
              key={session?.user.id}
              session={session}
              notify={setNotice}
            />
          ) : route.startsWith("ride/") ? (
            <RideDetail
              key={route + session?.user.id}
              id={route.slice(5)}
              session={session}
              notify={setNotice}
            />
          ) : route === "shop" || route.startsWith("shop/") ? (
            <Shop
              key={session?.user.id ?? "guest"}
              session={session}
              productId={route.startsWith("shop/") ? route.slice(5) : undefined}
              requestedBike={shopBike}
            />
          ) : route === "learning" || route.startsWith("learning/") ? (
            <Learning
              key={session?.user.id ?? "guest"}
              session={session}
              lessonId={
                route.startsWith("learning/") ? route.slice(9) : undefined
              }
            />
          ) : route === "riders" ? (
            <Riders />
          ) : route.startsWith("rider/") ? (
            <RiderProfile
              key={route.slice(6)}
              handle={route.slice(6)}
              session={session}
              requestedBike={shopBike}
            />
          ) : route === "parts" || route.startsWith("parts/") ? (
            <Parts route={route} session={session} />
          ) : route === "models" ? (
            <Models />
          ) : route.startsWith("model/") ? (
            <ModelPage
              key={route.slice(6)}
              slug={route.slice(6)}
              signedIn={Boolean(session)}
            />
          ) : route === "mechanic" ? (
            <Mechanic key={session?.user.id ?? "guest"} session={session} />
          ) : route === "moderation" ? (
            <Moderation session={session} notify={setNotice} />
          ) : route === "roadmap" ? (
            <Roadmap />
          ) : (
            <Feed session={session} />
          )}
        </main>
        <footer>
          Enduro.Zone <span>Сообщество, гараж, маршруты и покатушки.</span>
          <a href="#roadmap">
            Что дальше <Icon name="arrow" size={15} />
          </a>
        </footer>
      </div>
      {session && <FeedbackButton route={route} notify={setNotice} />}
      <TabBar route={route} />
      {notice && (
        <div className="toast" role="status">
          {notice}
        </div>
      )}
    </div>
  );
}
function JoinGate() {
  return (
    <div className="join-gate card">
      <div className="feature-icon">
        <Icon name="bike" size={38} />
      </div>
      <p className="eyebrow">ТВОЯ ТЕРРИТОРИЯ</p>
      <h1>
        У каждого мотоцикла
        <br />
        есть своя история.
      </h1>
      <p className="muted">
        Создайте аккаунт, добавьте мотоцикл и ведите бортжурнал.
        <br />
        Публичные записи смогут читать другие райдеры.
      </p>
      <div className="button-row">
        <a className="button" href="#register">
          Создать аккаунт
          <Icon name="arrow" />
        </a>
        <a className="button outline" href="#login">
          Уже есть аккаунт
        </a>
      </div>
    </div>
  );
}
function AuthForm({
  mode,
  done,
}: {
  mode: string;
  done: (session: Session) => void;
}) {
  const registration = mode === "register";
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    setError("");
  }, [mode]);
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    const data = Object.fromEntries(new FormData(event.currentTarget));
    const body = registration
      ? (data as unknown as RegisterInput)
      : { email: data.email, password: data.password };
    try {
      done(
        await api<Session>(`/auth/${registration ? "register" : "login"}`, {
          method: "POST",
          body,
        }),
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="auth-layout">
      <div className="auth-story">
        <TrailScene />
        <p className="eyebrow light">МЕНЬШЕ ПЕРЕПИСОК. БОЛЬШЕ ЭНДУРО.</p>
        <h1>
          Здесь начинается
          <br />
          твоя история.
        </h1>
        <p>
          Мотоцикл, которому доверяешь.
          <br />
          Люди, с которыми хочется кататься.
          <br />
          Опыт, которым стоит поделиться.
        </p>
        <span className="story-note">
          <Icon name="mountain" />
          Enduro.Zone · Твоя территория
        </span>
      </div>
      <section className="auth-card card">
        <p className="eyebrow">ENDURO.ZONE</p>
        <h2>{registration ? "Стать частью сообщества" : "С возвращением"}</h2>
        <p className="muted">
          {registration
            ? "Начните со своего гаража и первой записи."
            : "Ваш гараж и бортжурнал уже ждут."}
        </p>
        <form onSubmit={submit} key={mode}>
          <ErrorBox message={error} />
          {registration && (
            <>
              <label>
                Имя или псевдоним
                <input
                  name="displayName"
                  autoComplete="nickname"
                  required
                  minLength={2}
                  maxLength={60}
                  placeholder="Как к вам обращаться"
                />
              </label>
              <label>
                Ник
                <input
                  name="handle"
                  autoCapitalize="none"
                  autoComplete="username"
                  required
                  pattern="[a-z0-9_]{3,24}"
                  minLength={3}
                  maxLength={24}
                  placeholder="enduro_rider"
                />
                <small>
                  Латинские строчные буквы, цифры и _, от 3 до 24 знаков.
                </small>
              </label>
              <div className="form-grid">
                <label>
                  Город
                  <input
                    name="city"
                    autoComplete="address-level2"
                    required
                    minLength={2}
                    maxLength={80}
                    placeholder="Смоленск"
                  />
                </label>
                <label>
                  Ваш уровень
                  <select name="level" defaultValue="amateur">
                    {Object.entries(levels).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            </>
          )}
          <label>
            Email
            <input
              name="email"
              type="email"
              autoComplete="email"
              autoCapitalize="none"
              required
              maxLength={254}
              placeholder="you@example.com"
            />
          </label>
          <label>
            Пароль
            <input
              name="password"
              type="password"
              autoComplete={registration ? "new-password" : "current-password"}
              required
              minLength={registration ? 12 : 1}
              maxLength={128}
            />
            {registration && (
              <small>
                Не менее 12 символов. Можно использовать длинную фразу.
              </small>
            )}
          </label>
          <p className="form-note">
            Версия для внутреннего тестирования. Используйте тестовые данные;
            письма локальной версии сохраняются на компьютере для проверки.
          </p>
          <button className="button full" disabled={busy}>
            {busy ? "Сохраняем…" : registration ? "Создать аккаунт" : "Войти"}
            <Icon name="arrow" />
          </button>
        </form>
        {!registration && (
          <p>
            <a href="#forgot">Забыли пароль?</a>
          </p>
        )}
        <p className="auth-switch">
          {registration ? "Уже с нами?" : "Ещё нет аккаунта?"}{" "}
          <a href={registration ? "#login" : "#register"}>
            {registration ? "Войти" : "Присоединиться"}
          </a>
        </p>
      </section>
    </div>
  );
}
function ProfileForm({
  session,
  done,
}: {
  session: Session;
  done: (s: Session) => void;
}) {
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      done(
        await api<Session>("/me", {
          method: "PATCH",
          body: Object.fromEntries(
            new FormData(e.currentTarget),
          ) as unknown as Profile,
        }),
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">ТВОИ ЛЮДИ УЗНАЮТ ТЕБЯ</p>
          <h1>Мой профиль</h1>
          <p className="muted">Город помогает найти местное сообщество.</p>
          <a
            href={`#rider/${session.user.handle}`}
            className="button outline small"
          >
            Посмотреть публичную страницу
          </a>
        </div>
      </div>
      <div className="profile-layout">
        <section className="card form-card">
          <form onSubmit={submit}>
            <ErrorBox message={error} />
            <label>
              Имя
              <input
                name="displayName"
                defaultValue={session.user.displayName}
                required
                minLength={2}
                maxLength={60}
              />
            </label>
            <div className="form-grid">
              <label>
                Город
                <input
                  name="city"
                  defaultValue={session.user.city}
                  required
                  minLength={2}
                  maxLength={80}
                />
              </label>
              <label>
                Уровень
                <select name="level" defaultValue={session.user.level}>
                  {Object.entries(levels).map(([v, l]) => (
                    <option value={v} key={v}>
                      {l}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <label>
              О себе
              <textarea
                name="bio"
                defaultValue={session.user.bio}
                rows={5}
                maxLength={600}
                placeholder="Что любите в эндуро, на чём катаетесь"
              />
            </label>
            <button className="button" disabled={busy}>
              {busy ? "Сохраняем…" : "Сохранить профиль"}
              <Icon name="check" />
            </button>
          </form>
        </section>
        <aside className="card profile-summary">
          <Avatar name={session.user.displayName} large />
          <h2>{session.user.displayName}</h2>
          <p className="muted">@{session.user.handle}</p>
          <span className="tag">
            {session.user.city} · {levels[session.user.level]}
          </span>
          <div className="privacy-note">
            <Icon name="lock" />
            <p>
              Email виден только вам. Точный адрес и геопозиция не публикуются.
            </p>
          </div>
          <p className="muted">{session.user.email}</p>
        </aside>
      </div>
    </>
  );
}
function Roadmap() {
  const stages = [
    {
      n: "01",
      title: "Рабочая основа",
      state: "Сейчас",
      body: "Регистрация и вход, подтверждение email, восстановление доступа, гараж, бортжурнал и публичные страницы райдеров. Фото, подписки на райдеров, лента подписок и личное избранное готовы.",
      tasks:
        "W01–W04: первая часть готова. Проверка основателями и интервью с райдерами.",
    },
    {
      n: "02",
      title: "Карта и совместные выезды",
      state: "В работе",
      body: "Локации, очищенные GPX-треки и модерация, выезды с заявками, лимитом участников и личными уведомлениями. Модерация событий, поиск рядом, чат участников и уведомления подписчикам о покатушках готовы; общий стенд отложен.",
      tasks: "W05–W09. Реальные разрешённые маршруты для Смоленска и Сочи.",
    },
    {
      n: "03",
      title: "Магазин, обучение и механик",
      state: "В работе",
      body: "Демо-магазин запчастей, экипировки и мотоциклов готов. Вводные уроки с личным прогрессом готовы. Раздел механика с личной историей готов к подключению ИИ. Дальше — реальные партнёры, подтверждённая совместимость, школы и ответы по проверенным руководствам.",
      tasks:
        "C01–C03, L01, A01–A02. Нужны данные и договорённости с партнёрами.",
    },
    {
      n: "04",
      title: "Торговля и приложения",
      state: "После пилота",
      body: "Заказы, оплата, доставка и возвраты. Приложения iOS и Android на общем API, GPS и разрешённые офлайн-карты.",
      tasks: "M01–M02, N01–N03. После проверки ядра и модели торговли.",
    },
  ];
  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">СТРОИМ ПОЭТАПНО</p>
          <h1>
            От первого гаража
            <br />
            до экосистемы.
          </h1>
          <p className="muted">
            Каждый этап заканчивается работающим сценарием.
          </p>
        </div>
        <a
          className="button outline"
          href="https://github.com/novokshonovpv/endurozone"
          target="_blank"
          rel="noreferrer"
        >
          Открыть репозиторий
          <Icon name="arrow" />
        </a>
      </div>
      <div className="roadmap-grid">
        {stages.map((s) => (
          <article className="card stage" key={s.n}>
            <div className="stage-top">
              <span className="stage-number">{s.n}</span>
              <span className={`tag ${s.n === "01" ? "green" : ""}`}>
                {s.state}
              </span>
            </div>
            <h2>{s.title}</h2>
            <p>{s.body}</p>
            <p className="stage-tasks">{s.tasks}</p>
          </article>
        ))}
      </div>
      <div className="callout">
        <Icon name="route" />
        <div>
          <strong>Одна команда в двух городах.</strong>
          <p>
            Вы — продукт, сайт и сообщество. Друг — сервер и будущие приложения.
            Код и задачи находятся в общем репозитории.
          </p>
        </div>
      </div>
    </>
  );
}
