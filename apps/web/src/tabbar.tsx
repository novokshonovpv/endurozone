import { Icon, type IconName } from "./ui.tsx";
import { isExplore } from "./explore.tsx";
// Phone navigation, like social apps: four main sections at the thumb.
// Everything else stays in the top "Меню" sheet. Hidden above 760px (CSS).
const tabs: {
  path: string;
  label: string;
  icon: IconName;
  active: (route: string) => boolean;
}[] = [
  {
    path: "feed",
    label: "Главная",
    icon: "feed",
    active: (r) => r === "feed" || r.startsWith("post/"),
  },
  {
    path: "rides",
    label: "Покатушки",
    icon: "route",
    active: (r) => isExplore(r),
  },
  {
    path: "mechanic",
    label: "ИИ-механик",
    icon: "wrench",
    active: (r) => r === "mechanic",
  },
  {
    path: "garage",
    label: "Гараж",
    icon: "bike",
    active: (r) => r === "garage",
  },
];
export function TabBar({ route }: { route: string }) {
  return (
    <nav className="tab-bar" aria-label="Главное меню">
      {tabs.map((t) => {
        const on = t.active(route);
        return (
          <a
            key={t.path}
            href={`#${t.path}`}
            className={on ? "active" : ""}
            aria-current={on ? "page" : undefined}
          >
            <Icon name={t.icon} size={22} />
            <span>{t.label}</span>
          </a>
        );
      })}
    </nav>
  );
}
