import { SectionLinks } from "./sections.tsx";
// Phone navigation: the four blocks at the thumb, the same as the sidebar on the web.
// Account pages (profile, subscriptions, saved) stay in the top «Меню». Hidden above 760px (CSS).
export function TabBar({ route }: { route: string }) {
  return (
    <nav className="tab-bar" aria-label="Главное меню">
      <SectionLinks route={route} className="tab-link" />
    </nav>
  );
}
