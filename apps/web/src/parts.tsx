import { useEffect, useState, type FormEvent } from "react";
import type {
  Bike,
  ModelBrand,
  ModelSummary,
  PartFit,
  PartNode,
  PartNodePage,
  PartNodeSummary,
  PartScope,
  PartsOverview,
  Session,
} from "@enduro/contracts";
import { api } from "./api.ts";
import { Avatar, ErrorBox, Icon, Loading } from "./ui.tsx";
import { NodeArt } from "./node-art.tsx";
import { engineText, loadBrands } from "./models.tsx";
// Parts selection: brand → model → motorcycle / engine → node. Routes:
// #parts, #parts/<slug>, #parts/<slug>/engine, #parts/<slug>/<moto|engine>/<node>
export function Parts({
  route,
  session,
}: {
  route: string;
  session: Session | null;
}) {
  const [, slug, scopeOrTab, node] = route.split("/");
  if (!slug) return <PartsHome session={session} />;
  if (node)
    return (
      <PartsNode
        key={route}
        slug={slug}
        scope={scopeOrTab as PartScope}
        node={node as PartNode}
        session={session}
      />
    );
  return (
    <PartsModel
      key={slug}
      slug={slug}
      tab={scopeOrTab === "engine" ? "engine" : "moto"}
    />
  );
}
function PartsHome({ session }: { session: Session | null }) {
  const [bikes, setBikes] = useState<Bike[]>([]),
    [brands, setBrands] = useState<ModelBrand[]>([]),
    [brand, setBrand] = useState(""),
    [q, setQ] = useState(""),
    [query, setQuery] = useState(""),
    [found, setFound] = useState<ModelSummary[] | null>(null),
    [error, setError] = useState("");
  useEffect(() => {
    loadBrands().then(setBrands, (e) => setError(e.message));
    if (session)
      api<{ items: Bike[] }>("/me/bikes").then(
        (r) => setBikes(r.items),
        () => {},
      );
  }, [session?.user.id]);
  useEffect(() => {
    const t = setTimeout(() => setQuery(q.trim()), 300);
    return () => clearTimeout(t);
  }, [q]);
  useEffect(() => {
    if (!brand && !query) {
      setFound(null);
      return;
    }
    let alive = true;
    api<{ items: ModelSummary[] }>(
      `/models?limit=60` +
        (brand ? `&brand=${encodeURIComponent(brand)}` : "") +
        (query ? `&q=${encodeURIComponent(query)}` : ""),
    ).then(
      (r) => alive && setFound(r.items),
      (e) => alive && setError(e.message),
    );
    return () => {
      alive = false;
    };
  }, [brand, query]);
  const linked = bikes.filter((b) => b.catalogSlug);
  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">СЕРВИС ENDURO.ZONE</p>
          <h1>Подбор запчастей</h1>
          <p className="muted">
            Выберите марку и модель: мотоцикл и двигатель разобраны по узлам —
            размеры из характеристик и то, что подошло другим владельцам.
          </p>
        </div>
      </div>
      <ErrorBox message={error} />
      {linked.length > 0 && (
        <section className="parts-mine">
          <h2>Мои мотоциклы</h2>
          <div className="parts-mine-list">
            {linked.map((b) => (
              <a
                key={b.id}
                className="card parts-mine-item"
                href={`#parts/${b.catalogSlug}`}
              >
                <Icon name="bike" size={26} />
                <span>
                  <strong>
                    {b.make} {b.model}
                  </strong>
                  <small>{b.year}</small>
                </span>
                <Icon name="arrow" size={16} />
              </a>
            ))}
          </div>
        </section>
      )}
      {session && bikes.length > linked.length && (
        <p className="form-note">
          {linked.length ? "Остальные мотоциклы" : "Ваши мотоциклы"} не
          привязаны к модели справочника — откройте мотоцикл в{" "}
          <a href="#garage">гараже</a> и выберите модель из подсказок, чтобы
          подбирать для него.
        </p>
      )}
      <section className="card parts-pick">
        <h2>Марка и модель</h2>
        <div className="models-filters">
          <select
            value={brand}
            onChange={(e) => setBrand(e.target.value)}
            aria-label="Марка"
          >
            <option value="">Выберите марку</option>
            {brands.map((b) => (
              <option key={b.brand} value={b.brand}>
                {b.brand} · {b.count}
              </option>
            ))}
          </select>
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Или найдите: BSE T5, KAYO K1…"
            aria-label="Поиск модели"
          />
        </div>
        {found && !found.length && (
          <p className="muted">Ничего не нашлось — попробуйте короче.</p>
        )}
        {found && found.length > 0 && (
          <div className="parts-models">
            {found.map((m) => (
              <a
                key={m.slug}
                className="parts-model-row"
                href={`#parts/${m.slug}`}
              >
                {m.image ? (
                  <img src={m.image} alt="" loading="lazy" />
                ) : (
                  <span className="parts-model-noimg">
                    <Icon name="bike" />
                  </span>
                )}
                <span>
                  <strong>
                    {m.brand} {m.model}
                  </strong>
                  <small>
                    {m.sectionLabel}
                    {engineText(m) ? ` · ${engineText(m)}` : ""}
                  </small>
                </span>
                <Icon name="arrow" size={16} />
              </a>
            ))}
          </div>
        )}
      </section>
    </>
  );
}
function NodeTile({
  slug,
  scope,
  n,
}: {
  slug: string;
  scope: PartScope;
  n: PartNodeSummary;
}) {
  return (
    <a className="card node-tile" href={`#parts/${slug}/${scope}/${n.id}`}>
      <NodeArt node={n.id} />
      <strong>{n.label}</strong>
      <span className="node-badges">
        {n.passport > 0 && <span className="tag">размеры · {n.passport}</span>}
        {n.items > 0 && <span className="tag">детали · {n.items}</span>}
        {n.fits > 0 && <span className="tag green">опыт · {n.fits}</span>}
      </span>
    </a>
  );
}
function PartsModel({ slug, tab }: { slug: string; tab: PartScope }) {
  const [o, setO] = useState<PartsOverview | null>(null),
    [error, setError] = useState("");
  useEffect(() => {
    let alive = true;
    api<PartsOverview>(`/parts/${slug}`).then(
      (x) => alive && setO(x),
      (e) => alive && setError(e.message),
    );
    return () => {
      alive = false;
    };
  }, [slug]);
  if (error)
    return (
      <>
        <a href="#parts" className="back-link">
          ← Подбор запчастей
        </a>
        <ErrorBox message={error} />
      </>
    );
  if (!o) return <Loading />;
  const nodes = tab === "engine" ? o.engineNodes : o.moto;
  return (
    <>
      <a href="#parts" className="back-link">
        ← Подбор запчастей
      </a>
      <section className="card parts-head">
        {o.model.image && <img src={o.model.image} alt="" />}
        <div>
          <p className="eyebrow">
            {o.model.brand} · {o.model.sectionLabel}
          </p>
          <h1>{o.model.model}</h1>
          <p className="muted">
            {engineText(o.model) || "Объём не указан"}
            {o.engine && <> · двигатель {o.engine.key}</>}
          </p>
          <a className="text-button" href={`#model/${o.model.slug}`}>
            Карточка модели →
          </a>
        </div>
      </section>
      <div className="scope-tabs parts-tabs" role="tablist" aria-label="Раздел">
        <a
          role="tab"
          aria-selected={tab === "moto"}
          className={tab === "moto" ? "active" : ""}
          href={`#parts/${slug}`}
        >
          Мотоцикл
        </a>
        <a
          role="tab"
          aria-selected={tab === "engine"}
          className={tab === "engine" ? "active" : ""}
          href={`#parts/${slug}/engine`}
        >
          Двигатель{o.engine ? ` ${o.engine.key}` : ""}
        </a>
      </div>
      {tab === "engine" && !o.engine ? (
        <div className="card empty-state">
          <Icon name="wrench" size={32} />
          <h3>Код двигателя не указан</h3>
          <p>
            В характеристиках модели нет кода двигателя, поэтому раздел
            двигателя пока недоступен. Узлы мотоцикла — на соседней вкладке.
          </p>
        </div>
      ) : (
        <>
          {tab === "engine" && o.engine && o.engine.models > 0 && (
            <p className="form-note">
              Двигатель {o.engine.key} стоит ещё на {o.engine.models} моделях
              справочника — опыт владельцев по двигателю общий.
            </p>
          )}
          <div className="node-grid">
            {nodes.map((n) => (
              <NodeTile key={n.id} slug={slug} scope={tab} n={n} />
            ))}
          </div>
        </>
      )}
      <p className="form-note models-source">
        Схемы узлов — условные рисунки Enduro.Zone. Размеры взяты из
        характеристик продавца (67МОТО) и могут отличаться для вашего экземпляра
        — сверяйте по старой детали.
      </p>
    </>
  );
}
function PartsNode({
  slug,
  scope,
  node,
  session,
}: {
  slug: string;
  scope: PartScope;
  node: PartNode;
  session: Session | null;
}) {
  const [page, setPage] = useState<PartNodePage | null>(null),
    [error, setError] = useState(""),
    [copied, setCopied] = useState(""),
    [busy, setBusy] = useState(false),
    [revision, setRevision] = useState(0);
  const path = `/parts/${slug}/${scope}/${node}`;
  useEffect(() => {
    let alive = true;
    api<PartNodePage>(path).then(
      (x) => alive && setPage(x),
      (e) => alive && setError(e.message),
    );
    return () => {
      alive = false;
    };
  }, [path, revision, session?.user.id]);
  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(text);
      setTimeout(() => setCopied(""), 1500);
    } catch {
      setCopied("");
    }
  }
  async function add(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const f = Object.fromEntries(new FormData(form));
    setBusy(true);
    setError("");
    try {
      await api(`${path}/fits`, {
        method: "POST",
        body: {
          name: String(f.name),
          partNumber: String(f.partNumber),
          comment: String(f.comment),
        },
      });
      form.reset();
      setRevision((x) => x + 1);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function vote(fit: PartFit) {
    setError("");
    try {
      await api(`/part-fits/${fit.id}/vote`, {
        method: fit.viewerVoted ? "DELETE" : "PUT",
      });
      setRevision((x) => x + 1);
    } catch (err) {
      setError((err as Error).message);
    }
  }
  async function remove(fit: PartFit) {
    if (!window.confirm("Удалить эту запись?")) return;
    try {
      await api(`/part-fits/${fit.id}`, { method: "DELETE" });
      setRevision((x) => x + 1);
    } catch (err) {
      setError((err as Error).message);
    }
  }
  const back = scope === "engine" ? `#parts/${slug}/engine` : `#parts/${slug}`;
  if (!page)
    return error ? (
      <>
        <a href={back} className="back-link">
          ← Все узлы
        </a>
        <ErrorBox message={error} />
      </>
    ) : (
      <Loading />
    );
  const moderator = session?.user.role === "moderator";
  return (
    <>
      <a href={back} className="back-link">
        ← Все узлы {scope === "engine" ? "двигателя" : "мотоцикла"}
      </a>
      <section className="card node-head">
        <NodeArt node={node} size={180} />
        <div>
          <p className="eyebrow">
            {scope === "engine"
              ? `ДВИГАТЕЛЬ ${page.engine?.key ?? ""}`
              : "МОТОЦИКЛ"}
          </p>
          <h1>{page.label}</h1>
          {page.passport.length > 0 ? (
            <dl className="passport">
              {page.passport.map((l) => (
                <div key={l.label}>
                  <dt>{l.label}</dt>
                  <dd>
                    {l.value}
                    <button
                      className="text-button"
                      onClick={() => copy(l.value)}
                      aria-label={`Скопировать: ${l.label}`}
                    >
                      {copied === l.value ? "Скопировано" : "Копировать"}
                    </button>
                  </dd>
                </div>
              ))}
            </dl>
          ) : (
            <p className="muted">
              В характеристиках модели нет размеров для этого узла.
            </p>
          )}
        </div>
      </section>
      <ErrorBox message={error} />
      <section className="card parts-table">
        <h2>Детали узла</h2>
        {page.items.length ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>№</th>
                  <th>Название</th>
                  <th>Артикул</th>
                  <th>Кол-во</th>
                </tr>
              </thead>
              <tbody>
                {page.items.map((i, n) => (
                  <tr key={n}>
                    <td>{i.position}</td>
                    <td>
                      {i.name}
                      {i.note && <small>{i.note}</small>}
                    </td>
                    <td>
                      {i.article && (
                        <button
                          className="text-button"
                          onClick={() => copy(i.article)}
                        >
                          {copied === i.article ? "Скопировано" : i.article}
                        </button>
                      )}
                    </td>
                    <td>{i.qty ?? ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="muted">
            Таблица деталей с артикулами появится, когда подключим каталог
            поставщика. Пока — размеры выше и опыт владельцев ниже.
          </p>
        )}
      </section>
      <section className="card parts-fits">
        <h2>Что подошло владельцам</h2>
        {!page.fits.length && (
          <p className="muted">
            Пока никто не поделился. Владельцы{" "}
            {scope === "engine"
              ? "мотоциклов с этим двигателем"
              : "этой модели"}{" "}
            могут записать деталь, которая подошла, — с артикулом и
            комментарием.
          </p>
        )}
        <ul className="fit-list">
          {page.fits.map((f) => (
            <li key={f.id} className="fit">
              <div className="fit-main">
                <strong>{f.name}</strong>
                {f.partNumber && (
                  <button
                    className="text-button fit-number"
                    onClick={() => copy(f.partNumber)}
                  >
                    {copied === f.partNumber ? "Скопировано" : f.partNumber}
                  </button>
                )}
                {f.comment && <p>{f.comment}</p>}
                <small className="fit-author">
                  <Avatar name={f.author.displayName} />
                  <a href={`#rider/${f.author.handle}`}>
                    {f.author.displayName}
                  </a>
                </small>
              </div>
              <div className="fit-side">
                <span className="fit-votes" title="Подошло владельцам">
                  <Icon name="check" size={16} /> {f.votes + 1}
                </span>
                {page.viewerOwns && !f.viewerIsAuthor && (
                  <button
                    className={`button small ${f.viewerVoted ? "" : "outline"}`}
                    onClick={() => vote(f)}
                    aria-pressed={f.viewerVoted}
                  >
                    {f.viewerVoted ? "Подошло и мне ✓" : "Подошло и мне"}
                  </button>
                )}
                {(f.viewerIsAuthor || moderator) && (
                  <button className="text-button" onClick={() => remove(f)}>
                    Удалить
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
        {page.viewerOwns ? (
          <form className="fit-form" onSubmit={add}>
            <h3>Поделиться: что подошло мне</h3>
            <div className="form-grid">
              <label>
                Деталь
                <input
                  name="name"
                  required
                  minLength={2}
                  maxLength={120}
                  placeholder="Например, свеча NGK CR7HSA"
                />
              </label>
              <label>
                Артикул
                <input
                  name="partNumber"
                  maxLength={80}
                  placeholder="Номер детали, если есть"
                />
              </label>
            </div>
            <label>
              Комментарий
              <textarea
                name="comment"
                rows={2}
                maxLength={500}
                placeholder="Встало без доработок, где брал, сколько отходило — без ссылок"
              />
            </label>
            <button className="button" disabled={busy}>
              {busy ? "Сохраняем…" : "Добавить"}
            </button>
          </form>
        ) : (
          <p className="form-note">
            {session ? (
              <>
                Добавлять и подтверждать могут владельцы
                {scope === "engine"
                  ? " мотоциклов с этим двигателем"
                  : " этой модели"}
                : привяжите свой мотоцикл к модели в{" "}
                <a href="#garage">гараже</a>.
              </>
            ) : (
              <>
                <a href="#login">Войдите</a>, чтобы делиться опытом по своему
                мотоциклу.
              </>
            )}
          </p>
        )}
      </section>
    </>
  );
}
