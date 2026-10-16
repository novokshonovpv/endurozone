import { useEffect, useRef } from "react";
import { Icon, type IconName } from "./ui.tsx";
// Four blocks, the same on the web and on a phone (owner's structure of 14.10.2026):
// Сообщество, Маршруты, Игра, Гараж. Each block has its own tabs; old addresses stay valid.
type Tab = { path: string; label: string; also?: string[] };
export type Section = {
  id: "community" | "routes" | "game" | "garage";
  label: string;
  icon: IconName;
  home: string;
  tabs: Tab[];
};
export const sections: Section[] = [
  {
    id: "community",
    label: "Сообщество",
    icon: "users",
    home: "feed",
    tabs: [
      { path: "feed", label: "Лента", also: ["post/"] },
      { path: "news", label: "Новости" },
      { path: "events", label: "Мероприятия" },
      { path: "riders", label: "Райдеры", also: ["rider/"] },
    ],
  },
  {
    id: "routes",
    label: "Маршруты",
    icon: "route",
    home: "nearby",
    tabs: [
      { path: "nearby", label: "Карта" },
      { path: "map", label: "Места" },
      { path: "services", label: "Прокаты и гиды" },
      { path: "tracks", label: "Треки", also: ["track/", "add-track"] },
      { path: "rides", label: "Покатушки", also: ["ride/"] },
      { path: "learning", label: "Обучение", also: ["learning/"] },
    ],
  },
  { id: "game", label: "Игра", icon: "game", home: "game", tabs: [] },
  {
    id: "garage",
    label: "Гараж",
    icon: "bike",
    home: "garage",
    tabs: [
      { path: "garage", label: "Мои мотоциклы" },
      { path: "service", label: "Обслуживание" },
      { path: "parts", label: "Запчасти", also: ["parts/"] },
      { path: "mechanic", label: "ИИ-механик" },
      { path: "models", label: "Модели", also: ["model/"] },
      { path: "shop", label: "Магазин", also: ["shop/"] },
    ],
  },
];
const tabMatches = (t: Tab, route: string) =>
  route === t.path || (t.also ?? []).some((p) => route.startsWith(p));
export const tabOf = (route: string) => {
  for (const s of sections)
    for (const t of s.tabs)
      if (tabMatches(t, route)) return { section: s, tab: t };
  return null;
};
export const sectionOf = (route: string) =>
  route === "game"
    ? sections.find((s) => s.id === "game")!
    : (tabOf(route)?.section ?? null);
/** Segmented control of the current block; on a phone it scrolls the active tab into view. */
export function SectionTabs({ route }: { route: string }) {
  const found = tabOf(route);
  const bar = useRef<HTMLElement>(null);
  useEffect(() => {
    const el = bar.current?.querySelector<HTMLElement>("a.active");
    if (el && bar.current)
      bar.current.scrollLeft =
        el.offsetLeft - (bar.current.clientWidth - el.offsetWidth) / 2;
  }, [found?.tab.path]);
  if (!found || found.section.tabs.length < 2) return null;
  return (
    <nav className="section-tabs" aria-label={found.section.label} ref={bar}>
      {found.section.tabs.map((t) => {
        const on = t === found.tab;
        return (
          <a
            key={t.path}
            href={`#${t.path}`}
            className={on ? "active" : ""}
            aria-current={on ? "page" : undefined}
          >
            {t.label}
          </a>
        );
      })}
    </nav>
  );
}
/** The block buttons: the phone's bottom bar and the sidebar share them. */
export function SectionLinks({
  route,
  className,
  iconSize = 22,
}: {
  route: string;
  className: string;
  iconSize?: number;
}) {
  const current = sectionOf(route);
  return (
    <>
      {sections.map((s) => {
        const on = current?.id === s.id;
        return (
          <a
            key={s.id}
            href={`#${s.home}`}
            className={`${className} ${on ? "active" : ""}`}
            aria-current={on ? "page" : undefined}
          >
            <Icon name={s.icon} size={iconSize} />
            <span>{s.label}</span>
          </a>
        );
      })}
    </>
  );
}
