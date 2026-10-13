import { useEffect, useState } from "react";
import type {
  ModelBrand,
  ModelDetail,
  ModelSection,
  ModelSummary,
} from "@enduro/contracts";
import { api } from "./api.ts";
import { ErrorBox, Icon, Loading } from "./ui.tsx";
// Motorcycle models from the owner's 67МОТО catalog: a reference for the garage, not a shop.
type Page = { items: ModelSummary[]; total: number; nextOffset: number | null };
const sections: [ModelSection | "", string][] = [
  ["", "Все"],
  ["enduro", "Эндуро"],
  ["pit", "Питбайки"],
  ["road", "Дорожные"],
  ["electro", "Электро"],
  ["mini", "Минибайки"],
];
let brandCache: Promise<ModelBrand[]> | null = null;
export function loadBrands() {
  brandCache ??= api<{ items: ModelBrand[] }>("/models/brands")
    .then((r) => r.items)
    .catch((e) => {
      brandCache = null;
      throw e;
    });
  return brandCache;
}
const brandModels = new Map<string, Promise<ModelSummary[]>>();
export function loadBrandModels(brand: string) {
  const key = brand.toLowerCase();
  if (!brandModels.has(key))
    brandModels.set(
      key,
      api<Page>(`/models?brand=${encodeURIComponent(brand)}&limit=200`).then(
        (r) => r.items,
      ),
    );
  return brandModels.get(key)!;
}
export const engineText = (m: Pick<ModelSummary, "cc" | "hp">) =>
  [m.cc ? `${m.cc} см³` : "", m.hp ? `${m.hp} л.с.` : ""]
    .filter(Boolean)
    .join(" · ");
export function Models() {
  const [brands, setBrands] = useState<ModelBrand[]>([]),
    [brand, setBrand] = useState(""),
    [section, setSection] = useState<ModelSection | "">(""),
    [q, setQ] = useState(""),
    [query, setQuery] = useState(""),
    [page, setPage] = useState<Page | null>(null),
    [busy, setBusy] = useState(true),
    [error, setError] = useState("");
  useEffect(() => {
    loadBrands().then(setBrands, (e) => setError(e.message));
  }, []);
  // A short pause after typing: no request per keystroke.
  useEffect(() => {
    const t = setTimeout(() => setQuery(q.trim()), 300);
    return () => clearTimeout(t);
  }, [q]);
  const path = (offset: number) =>
    `/models?limit=24&offset=${offset}` +
    (brand ? `&brand=${encodeURIComponent(brand)}` : "") +
    (section ? `&section=${section}` : "") +
    (query ? `&q=${encodeURIComponent(query)}` : "");
  useEffect(() => {
    let alive = true;
    setBusy(true);
    setError("");
    api<Page>(path(0))
      .then((p) => alive && setPage(p))
      .catch((e) => alive && setError(e.message))
      .finally(() => alive && setBusy(false));
    return () => {
      alive = false;
    };
  }, [brand, section, query]);
  async function more() {
    if (page?.nextOffset == null) return;
    setBusy(true);
    try {
      const next = await api<Page>(path(page.nextOffset));
      setPage({ ...next, items: [...page.items, ...next.items] });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">СПРАВОЧНИК · 67МОТО</p>
          <h1>Модели</h1>
          <p className="muted">
            Марки и модели с фото, описанием и характеристиками из каталога
            мотосалона 67МОТО. Выберите свою — и добавьте в гараж.
          </p>
        </div>
      </div>
      <div className="models-filters">
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Поиск: BSE T5, KAYO K1…"
          aria-label="Поиск модели"
        />
        <select
          value={brand}
          onChange={(e) => setBrand(e.target.value)}
          aria-label="Марка"
        >
          <option value="">Все марки</option>
          {brands.map((b) => (
            <option key={b.brand} value={b.brand}>
              {b.brand} · {b.count}
            </option>
          ))}
        </select>
      </div>
      <div
        className="scope-tabs models-sections"
        role="tablist"
        aria-label="Класс"
      >
        {sections.map(([value, label]) => (
          <button
            key={value || "all"}
            role="tab"
            aria-selected={section === value}
            className={section === value ? "active" : ""}
            onClick={() => setSection(value)}
          >
            {label}
          </button>
        ))}
      </div>
      <ErrorBox message={error} />
      {busy && !page ? (
        <Loading />
      ) : page && !page.items.length ? (
        <div className="card empty-state">
          <Icon name="bike" size={32} />
          <h3>Ничего не нашлось</h3>
          <p>Попробуйте другую марку или короче запрос.</p>
        </div>
      ) : (
        page && (
          <>
            <p className="muted models-count">Найдено: {page.total}</p>
            <div className="models-grid">
              {page.items.map((m) => (
                <a
                  className="card model-card"
                  key={m.slug}
                  href={`#model/${m.slug}`}
                >
                  <span className="model-photo">
                    {m.image ? (
                      <img src={m.image} alt="" loading="lazy" />
                    ) : (
                      <Icon name="bike" size={48} />
                    )}
                  </span>
                  <span className="model-text">
                    <small>
                      {m.brand} · {m.sectionLabel}
                    </small>
                    <strong>{m.model}</strong>
                    {engineText(m) && <small>{engineText(m)}</small>}
                  </span>
                </a>
              ))}
            </div>
            {page.nextOffset !== null && (
              <button
                className="button outline load-more"
                disabled={busy}
                onClick={more}
              >
                {busy ? "Загружаем…" : "Показать ещё"}
              </button>
            )}
          </>
        )
      )}
      <p className="form-note models-source">
        Данные и фото — каталог мотосалона{" "}
        <a href="https://67moto.ru/" target="_blank" rel="noreferrer">
          67МОТО
        </a>
        . Цены и наличие — на сайте салона.
      </p>
    </>
  );
}
export function ModelPage({
  slug,
  signedIn,
}: {
  slug: string;
  signedIn: boolean;
}) {
  const [m, setM] = useState<ModelDetail | null>(null),
    [photo, setPhoto] = useState(0),
    [error, setError] = useState("");
  useEffect(() => {
    let alive = true;
    setM(null);
    setPhoto(0);
    setError("");
    api<ModelDetail>(`/models/${slug}`)
      .then((x) => alive && setM(x))
      .catch((e) => alive && setError(e.message));
    return () => {
      alive = false;
    };
  }, [slug]);
  if (error)
    return (
      <>
        <a href="#models" className="back-link">
          ← Все модели
        </a>
        <ErrorBox message={error} />
      </>
    );
  if (!m) return <Loading />;
  return (
    <>
      <a href="#models" className="back-link">
        ← Все модели
      </a>
      <section className="card model-hero">
        <div className="model-gallery">
          <div className="model-main">
            {m.images[photo] ? (
              <img src={m.images[photo]} alt={m.title} />
            ) : (
              <Icon name="bike" size={90} />
            )}
          </div>
          {m.images.length > 1 && (
            <div className="model-thumbs">
              {m.images.map((src, i) => (
                <button
                  key={src}
                  className={i === photo ? "active" : ""}
                  onClick={() => setPhoto(i)}
                  aria-label={`Фото ${i + 1}`}
                >
                  <img src={src} alt="" loading="lazy" />
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="model-info">
          <p className="eyebrow">
            {m.brand} · {m.sectionLabel}
          </p>
          <h1>{m.model}</h1>
          {(engineText(m) || m.year) && (
            <p className="model-chips">
              {m.cc && <span className="tag">{m.cc} см³</span>}
              {m.hp && <span className="tag">{m.hp} л.с.</span>}
              {m.year && <span className="tag">{m.year}</span>}
            </p>
          )}
          <div className="button-row">
            {signedIn ? (
              <a className="button" href={`#garage?model=${m.slug}`}>
                <Icon name="plus" />
                Добавить в мой гараж
              </a>
            ) : (
              <a className="button" href="#register">
                Войти и добавить в гараж
              </a>
            )}
            <a className="button outline" href={`#parts/${m.slug}`}>
              <Icon name="gear" />
              Подбор запчастей
            </a>
            <a
              className="button outline"
              href={m.url}
              target="_blank"
              rel="noreferrer"
            >
              Цена и наличие в 67МОТО ↗
            </a>
          </div>
        </div>
      </section>
      {m.description && (
        <section className="card model-description">
          <h2>Описание</h2>
          {m.description.split("\n").map((p, i) => (
            <p key={i}>{p}</p>
          ))}
        </section>
      )}
      {m.specs.length > 0 && (
        <section className="card model-specs">
          <h2>Характеристики</h2>
          <dl>
            {m.specs.map(([k, v], i) => (
              <div key={i}>
                <dt>{k}</dt>
                <dd>{v}</dd>
              </div>
            ))}
          </dl>
        </section>
      )}
      <p className="form-note models-source">
        Описание и фото — каталог мотосалона 67МОТО; характеристики даны
        продавцом и могут отличаться для вашего экземпляра.
      </p>
    </>
  );
}
/** Garage bike linked to a model: photo and a link to the model card. */
export function CatalogBadge({ slug }: { slug: string }) {
  const [m, setM] = useState<ModelDetail | null>(null);
  useEffect(() => {
    let alive = true;
    api<ModelDetail>(`/models/${slug}`)
      .then((x) => alive && setM(x))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [slug]);
  if (!m) return null;
  return (
    <a className="catalog-badge" href={`#model/${slug}`}>
      {m.images[0] && <img src={m.images[0]} alt="" loading="lazy" />}
      <span>
        <small>Модель из справочника</small>
        <strong>
          {m.brand} {m.model}
        </strong>
      </span>
      <Icon name="arrow" size={16} />
    </a>
  );
}
