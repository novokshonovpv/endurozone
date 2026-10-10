import { Icon, type IconName } from "./ui.tsx";
// Places, GPX tracks and rides are one rider journey: where to go and with whom.
// The old addresses (#map, #tracks, #rides, #nearby) stay valid as tabs of this section.
const tabs: { path: string; label: string; icon: IconName; hint: string }[] = [
  { path: "nearby", label: "Рядом", icon: "mountain", hint: "всё поблизости" },
  { path: "map", label: "Места", icon: "route", hint: "где кататься" },
  { path: "tracks", label: "Треки", icon: "route", hint: "GPX-маршруты" },
  { path: "rides", label: "Покатушки", icon: "user", hint: "с кем ехать" },
];
const parent = (route: string) =>
  route.startsWith("track/")
    ? "tracks"
    : route.startsWith("ride/")
      ? "rides"
      : route;
export const isExplore = (route: string) =>
  tabs.some((t) => t.path === parent(route));
export const exploreLabel = (route: string) =>
  tabs.find((t) => t.path === parent(route))?.label ?? "";
export function ExploreTabs({ route }: { route: string }) {
  const current = parent(route);
  return (
    <nav className="explore-tabs" aria-label="Карта и выезды">
      {tabs.map((t) => (
        <a
          key={t.path}
          href={`#${t.path}`}
          className={current === t.path ? "active" : ""}
          aria-current={current === t.path ? "page" : undefined}
        >
          <Icon name={t.icon} size={18} />
          <span>
            {t.label}
            <small>{t.hint}</small>
          </span>
        </a>
      ))}
    </nav>
  );
}
