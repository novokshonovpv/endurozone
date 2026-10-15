import type { FastifyInstance } from "fastify";
import {
  difficulties,
  locationKinds,
  postKinds,
  type LocationKind,
} from "@enduro/contracts";
import type { Database } from "./database.ts";
import { catalogModel, allModels } from "./models.ts";
// Share links. The site lives behind "#" routes, which messengers and search engines never
// send to the server, so a shared link points to /s/<type>/<id>: a tiny page with this
// object's title and description in Open Graph tags, which then opens the normal page.
// Only what a guest may see is described; anything else gets the generic site card.
type Card = {
  title: string;
  description: string;
  hash: string;
  image?: string;
};
const escape = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
const clip = (s: string, n = 180) => {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > n ? `${t.slice(0, n - 1).trimEnd()}…` : t;
};
const day = (v: Date | string) => {
  const d = typeof v === "string" ? new Date(`${v.slice(0, 10)}T12:00:00`) : v;
  return d.toLocaleDateString("ru-RU", { day: "numeric", month: "long" });
};
const uuid = /^[0-9a-f-]{36}$/i;
export const siteCard: Card = {
  title: "Enduro.Zone — твоя территория эндуро",
  description:
    "Места и трассы для эндуро, гонки и совместные покатушки, гараж и подбор запчастей. Россия и Беларусь.",
  hash: "feed",
};
export function pageHtml(origin: string, card: Card, path: string) {
  const url = `${origin}${path}`;
  const image = card.image ?? `${origin}/og.png`;
  const t = escape(card.title),
    d = escape(card.description),
    target = `/#${card.hash}`;
  return `<!doctype html>
<html lang="ru"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${t}</title>
<meta name="description" content="${d}">
<link rel="canonical" href="${escape(url)}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="Enduro.Zone">
<meta property="og:locale" content="ru_RU">
<meta property="og:title" content="${t}">
<meta property="og:description" content="${d}">
<meta property="og:url" content="${escape(url)}">
<meta property="og:image" content="${escape(image)}">
${card.image ? "" : '<meta property="og:image:width" content="1200">\n<meta property="og:image:height" content="630">\n'}<meta name="twitter:card" content="summary_large_image">
<meta http-equiv="refresh" content="0; url=${escape(target)}">
<script>location.replace(${JSON.stringify(target)})</script>
</head><body><h1>${t}</h1><p>${d}</p><p><a href="${escape(target)}">Открыть на Enduro.Zone</a></p></body></html>`;
}
export function shareRoutes(
  app: FastifyInstance,
  db: Database,
  origin: string,
) {
  const cards: Record<string, (id: string) => Promise<Card | null>> = {
    async place(id) {
      if (!uuid.test(id)) return null;
      const [l] = await db.query(
        "SELECT title,description,city,kind,difficulty FROM locations WHERE id=$1 AND status='published'",
        [id],
      );
      if (!l) return null;
      const kind = locationKinds[(l.kind ?? "spot") as LocationKind];
      const level =
        l.difficulty && difficulties[l.difficulty as keyof typeof difficulties];
      return {
        title: `${l.title} — ${l.city}`,
        description: clip(
          `${kind}${level ? ` · ${level}` : ""} · ${l.city}. ${l.description}`,
        ),
        hash: l.kind === "spot" ? "map" : "services",
      };
    },
    async track(id) {
      if (!uuid.test(id)) return null;
      const [t] = await db.query(
        "SELECT title,description,city,difficulty,distance_m FROM tracks WHERE id=$1 AND status='published'",
        [id],
      );
      if (!t) return null;
      const km = (t.distance_m / 1000).toLocaleString("ru-RU", {
        maximumFractionDigits: 1,
      });
      return {
        title: `${t.title} — GPX-трек, ${t.city}`,
        description: clip(
          `${km} км · ${difficulties[t.difficulty as keyof typeof difficulties]} · ${t.city}. ${t.description}`,
        ),
        hash: `track/${id}`,
      };
    },
    async ride(id) {
      if (!uuid.test(id)) return null;
      // Only open, public rides; the meeting point is never read.
      const [r] = await db.query(
        "SELECT r.title,r.description,r.starts_at,r.timezone,r.capacity,t.city,t.title AS track_title,1+(SELECT count(*) FROM ride_members m WHERE m.ride_id=r.id AND m.status='accepted') AS accepted FROM rides r JOIN tracks t ON t.id=r.track_id WHERE r.id=$1 AND r.status='open' AND NOT r.hidden AND t.status='published'",
        [id],
      );
      if (!r) return null;
      const when = new Date(r.starts_at).toLocaleString("ru-RU", {
        day: "numeric",
        month: "long",
        hour: "2-digit",
        minute: "2-digit",
        timeZone: r.timezone,
      });
      return {
        title: `Покатушка «${r.title}» — ${when}`,
        description: clip(
          `${r.city} · трек «${r.track_title}» · участников ${r.accepted} из ${r.capacity}. ${r.description}`,
        ),
        hash: `ride/${id}`,
      };
    },
    async race(id) {
      if (!uuid.test(id)) return null;
      const [a] = await db.query(
        "SELECT title,starts_on,ends_on,region,place,discipline,status FROM event_announcements WHERE id=$1 AND NOT hidden",
        [id],
      );
      if (!a) return null;
      const dates = a.ends_on
        ? `${day(a.starts_on)} — ${day(a.ends_on)}`
        : day(a.starts_on);
      const state =
        a.status === "cancelled"
          ? "Отменено. "
          : a.status === "postponed"
            ? "Перенесено. "
            : "";
      return {
        title: `${a.title} — ${dates}`,
        description: clip(
          `${state}${[a.region, a.place, a.discipline].filter(Boolean).join(" · ")}. Анонс гонки на Enduro.Zone.`,
        ),
        hash: "events",
      };
    },
    async post(id) {
      if (!uuid.test(id)) return null;
      const [p] = await db.query(
        "SELECT p.title,p.body,p.kind,u.display_name FROM posts p JOIN users u ON u.id=p.author_id WHERE p.id=$1 AND p.visibility='public' AND NOT p.hidden",
        [id],
      );
      if (!p) return null;
      return {
        title: p.title,
        description: clip(
          `${postKinds[p.kind as keyof typeof postKinds]} · ${p.display_name}. ${p.body}`,
        ),
        hash: `post/${id}`,
      };
    },
    async model(slug) {
      const m = catalogModel(slug);
      if (!m) return null;
      const image = m.images.find((i) => i.startsWith("https://"));
      return {
        title: `${m.title} — характеристики и запчасти`,
        description: clip(
          m.description ||
            `${m.sectionLabel}${m.cc ? ` · ${m.cc} см³` : ""}. Карточка модели и подбор запчастей на Enduro.Zone.`,
        ),
        hash: `model/${slug}`,
        ...(image ? { image } : {}),
      };
    },
  };
  app.get<{ Params: { type: string; id: string } }>(
    "/s/:type/:id",
    { schema: { hide: true } },
    async (req, reply) => {
      const make = cards[req.params.type];
      const card = make ? await make(req.params.id) : null;
      reply
        .code(card ? 200 : 404)
        .type("text/html; charset=utf-8")
        .header("Cache-Control", "public, max-age=300");
      return pageHtml(origin, card ?? siteCard, req.url);
    },
  );
  // Search engines: every public object as a share page.
  app.get("/sitemap.xml", { schema: { hide: true } }, async (_req, reply) => {
    const [places, tracks, rides, races] = await Promise.all([
      db.query(
        "SELECT id,updated_at FROM locations WHERE status='published' ORDER BY updated_at DESC LIMIT 5000",
      ),
      db.query(
        "SELECT id,updated_at FROM tracks WHERE status='published' ORDER BY updated_at DESC LIMIT 5000",
      ),
      db.query(
        "SELECT r.id,r.created_at AS updated_at FROM rides r JOIN tracks t ON t.id=r.track_id WHERE r.status='open' AND NOT r.hidden AND t.status='published' AND r.starts_at>now() LIMIT 5000",
      ),
      db.query(
        "SELECT id,updated_at FROM event_announcements WHERE NOT hidden AND coalesce(ends_on,starts_on)>=current_date LIMIT 5000",
      ),
    ]);
    const url = (path: string, at?: Date | string) =>
      `<url><loc>${escape(origin + path)}</loc>${at ? `<lastmod>${new Date(at).toISOString().slice(0, 10)}</lastmod>` : ""}</url>`;
    const urls = [
      url("/"),
      ...places.map((r) => url(`/s/place/${r.id}`, r.updated_at)),
      ...tracks.map((r) => url(`/s/track/${r.id}`, r.updated_at)),
      ...rides.map((r) => url(`/s/ride/${r.id}`, r.updated_at)),
      ...races.map((r) => url(`/s/race/${r.id}`, r.updated_at)),
      ...allModels.map((m) => url(`/s/model/${m.slug}`)),
    ];
    reply.type("application/xml; charset=utf-8");
    return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls.join("")}</urlset>\n`;
  });
  app.get("/robots.txt", { schema: { hide: true } }, (_req, reply) => {
    reply.type("text/plain; charset=utf-8");
    return `User-agent: *\nDisallow: /api/\nAllow: /\nSitemap: ${origin}/sitemap.xml\n`;
  });
}
