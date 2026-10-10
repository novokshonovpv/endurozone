import { useEffect, useState } from "react";
import {
  type Bike,
  type Session,
  type Catalog,
  type CatalogProduct,
  type ProductCategory,
  productCategories,
  demoCatalogBike,
  demoFitmentMatches,
} from "@enduro/contracts";
import { api } from "./api.ts";
import { Icon, ErrorBox, Loading } from "./ui.tsx";

const money = (n: number) =>
  new Intl.NumberFormat("ru-RU", {
    style: "currency",
    currency: "RUB",
    maximumFractionDigits: 0,
  }).format(n);
const productIcon = (category: ProductCategory) =>
  category === "parts" ? "wrench" : category === "bikes" ? "bike" : "shop";
export function Shop({
  session,
  productId,
}: {
  session: Session | null;
  productId?: string;
}) {
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [bikes, setBikes] = useState<Bike[]>([]);
  const [error, setError] = useState("");
  const [garageError, setGarageError] = useState("");
  const [retry, setRetry] = useState(0);
  const [category, setCategory] = useState<ProductCategory>("parts");
  const [query, setQuery] = useState("");
  const [section, setSection] = useState("");
  const [selectedBike, setSelectedBike] = useState("");
  const [matchingOnly, setMatchingOnly] = useState(false);
  const [sort, setSort] = useState("default");
  useEffect(() => {
    let alive = true;
    setError("");
    api<Catalog>("/catalog")
      .then((result) => {
        if (alive) setCatalog(result);
      })
      .catch((e) => {
        if (alive) setError(e.message);
      });
    return () => {
      alive = false;
    };
  }, [retry]);
  useEffect(() => {
    let alive = true;
    setBikes([]);
    setSelectedBike("");
    setMatchingOnly(false);
    setGarageError("");
    if (session)
      api<{ items: Bike[] }>("/me/bikes")
        .then((result) => {
          if (alive) setBikes(result.items);
        })
        .catch((e) => {
          if (alive) setGarageError(e.message);
        });
    return () => {
      alive = false;
    };
  }, [session?.user.id, retry]);
  const bike =
    selectedBike === "demo"
      ? demoCatalogBike
      : (bikes.find((b) => b.id === selectedBike) ?? null);
  const product = catalog?.items.find((p) => p.id === productId);
  const fitMessage = (p: CatalogProduct) =>
    p.category !== "parts"
      ? "Подбор по мотоциклу не применяется"
      : !bike
        ? "Выберите мотоцикл для сравнения"
        : demoFitmentMatches(p, bike)
          ? "Совпадает в демо-каталоге"
          : "Совместимость не подтверждена";
  const sections = [
    ...new Set(
      catalog?.items
        .filter((p) => p.category === category)
        .map((p) => p.section),
    ),
  ];
  const search = query.trim().toLocaleLowerCase("ru");
  const filtered = (catalog?.items ?? [])
    .filter(
      (p) =>
        p.category === category &&
        (!section || p.section === section) &&
        (!search ||
          `${p.title} ${p.sku} ${p.section}`
            .toLocaleLowerCase("ru")
            .includes(search)) &&
        (!matchingOnly || category !== "parts" || demoFitmentMatches(p, bike)),
    )
    .sort((a, b) =>
      sort === "price-up"
        ? a.priceRub - b.priceRub
        : sort === "price-down"
          ? b.priceRub - a.priceRub
          : 0,
    );
  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">ГАРАЖ → МАГАЗИН</p>
          <h1>Всё для следующего выезда.</h1>
          <p className="muted">
            Запчасти, экипировка и мотоциклы в одном месте.
          </p>
        </div>
        <span className="tag">Демо-витрина</span>
      </div>
      <div className="shop-demo card">
        <Icon name="shop" />
        <p>
          Все товары вымышлены. Цены и применимость — примеры для проверки
          магазина. Заказы и оплата появятся после подключения продавцов.
        </p>
      </div>
      <ErrorBox message={error} />
      {error && (
        <button
          className="button outline"
          onClick={() => setRetry((x) => x + 1)}
        >
          Повторить загрузку
        </button>
      )}
      {!catalog && !error ? (
        <Loading />
      ) : (
        catalog && (
          <>
            <section
              className="card shop-garage"
              aria-label="Подбор по мотоциклу"
            >
              <div>
                <span className="eyebrow">ВАШ МОТОЦИКЛ</span>
                <h2>Начните с гаража</h2>
                <p className="muted">
                  Сравниваем модель, год, двигатель и исполнение.
                </p>
              </div>
              <div>
                <label>
                  Мотоцикл для подбора
                  <select
                    value={selectedBike}
                    onChange={(e) => {
                      setSelectedBike(e.target.value);
                      setMatchingOnly(false);
                    }}
                  >
                    <option value="">Без подбора</option>
                    {bikes.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.make} {b.model} · {b.year} ·{" "}
                        {b.modification || "исполнение не указано"}
                      </option>
                    ))}
                    <option value="demo">
                      Демо: EZ Trail 250 · 2024 · Standard
                    </option>
                  </select>
                </label>
                <ErrorBox message={garageError} />
                <p className="form-note">
                  {bike
                    ? selectedBike === "demo"
                      ? "Вымышленная модель для проверки подбора. В ваш гараж не добавляется."
                      : "Данные гаража пока не сверены с каталогом производителя. Демо-совпадение не подтверждает реальную совместимость."
                    : session
                      ? "Выберите свой мотоцикл или демо-модель."
                      : "Войдите, чтобы выбирать свои мотоциклы из гаража, или попробуйте демо-модель."}{" "}
                  <a href={session ? "#garage" : "#login"}>
                    {session ? "Открыть гараж" : "Войти"}
                  </a>
                </p>
              </div>
            </section>
            {productId ? (
              <section className="card shop-detail">
                <a className="text-button" href="#shop">
                  ← Вернуться в каталог
                </a>
                {product ? (
                  <>
                    <div className="shop-detail-top">
                      <div className={`shop-visual ${product.category}`}>
                        <Icon name={productIcon(product.category)} size={100} />
                        <span>ДЕМО · EZ</span>
                      </div>
                      <div>
                        <p className="eyebrow">
                          {productCategories[product.category]} ·{" "}
                          {product.section}
                        </p>
                        <h2>{product.title}</h2>
                        <p className="muted">Артикул {product.sku}</p>
                        <p className="shop-price">{money(product.priceRub)}</p>
                        <p className="form-note">
                          Демонстрационная цена · продажи ещё не открыты
                        </p>
                        <span
                          className={`tag ${demoFitmentMatches(product, bike) ? "green" : ""}`}
                        >
                          {fitMessage(product)}
                        </span>
                      </div>
                    </div>
                    <p>{product.description}</p>
                    <dl className="shop-specs">
                      {product.specs.map((s) => (
                        <div key={s.name}>
                          <dt>{s.name}</dt>
                          <dd>{s.value}</dd>
                        </div>
                      ))}
                    </dl>
                    {product.category === "parts" && (
                      <>
                        <h3>Применимость в демонстрационном каталоге</h3>
                        {product.fitments.length ? (
                          <ul>
                            {product.fitments.map((f, i) => (
                              <li key={i}>
                                {f.make} {f.model}, {f.fromYear}–{f.toYear},{" "}
                                {f.engine}, {f.modification}
                              </li>
                            ))}
                          </ul>
                        ) : (
                          <p>
                            Таблица применимости отсутствует. Подбор по названию
                            не выполняется.
                          </p>
                        )}
                        <p className="form-note">
                          Для реальных деталей понадобятся артикулы
                          производителя и подтверждённая таблица применимости
                          продавца.
                        </p>
                      </>
                    )}
                  </>
                ) : (
                  <>
                    <h2>Товар не найден</h2>
                    <p>Вернитесь в каталог и выберите другую карточку.</p>
                  </>
                )}
              </section>
            ) : (
              <>
                <div
                  className="shop-tabs"
                  role="group"
                  aria-label="Категории магазина"
                >
                  {Object.entries(productCategories).map(([key, label]) => (
                    <button
                      key={key}
                      className={`button ${category === key ? "" : "outline"}`}
                      aria-pressed={category === key}
                      onClick={() => {
                        setCategory(key as ProductCategory);
                        setSection("");
                        setMatchingOnly(false);
                      }}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <section
                  className="card shop-filters"
                  aria-label="Фильтры каталога"
                >
                  <label>
                    Поиск
                    <input
                      type="search"
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                      placeholder="Название или артикул"
                      maxLength={100}
                    />
                  </label>
                  <label>
                    Раздел
                    <select
                      value={section}
                      onChange={(e) => setSection(e.target.value)}
                    >
                      <option value="">Все разделы</option>
                      {sections.map((s) => (
                        <option key={s}>{s}</option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Сортировка
                    <select
                      value={sort}
                      onChange={(e) => setSort(e.target.value)}
                    >
                      <option value="default">По умолчанию</option>
                      <option value="price-up">Сначала дешевле</option>
                      <option value="price-down">Сначала дороже</option>
                    </select>
                  </label>
                  {category === "parts" && (
                    <label className="shop-check">
                      <input
                        type="checkbox"
                        disabled={!bike}
                        checked={matchingOnly}
                        onChange={(e) => setMatchingOnly(e.target.checked)}
                      />
                      Только совпадения в демо-каталоге
                    </label>
                  )}
                </section>
                <p className="muted" role="status">
                  Найдено товаров: {filtered.length}
                </p>
                {filtered.length ? (
                  <div className="shop-grid">
                    {filtered.map((p) => (
                      <article className="card shop-product" key={p.id}>
                        <a
                          href={`#shop/${p.id}`}
                          aria-label={`Подробнее: ${p.title}`}
                        >
                          <div className={`shop-visual ${p.category}`}>
                            <Icon name={productIcon(p.category)} size={68} />
                            <span>ДЕМО · EZ</span>
                          </div>
                          <div className="shop-product-body">
                            <span className="eyebrow">{p.section}</span>
                            <h2>{p.title}</h2>
                            <p className="muted">{p.sku}</p>
                            <p className="shop-price">{money(p.priceRub)}</p>
                            <span
                              className={`tag ${demoFitmentMatches(p, bike) ? "green" : ""}`}
                            >
                              {fitMessage(p)}
                            </span>
                            <p className="shop-more">
                              Подробнее <Icon name="arrow" size={16} />
                            </p>
                          </div>
                        </a>
                      </article>
                    ))}
                  </div>
                ) : (
                  <section className="card empty-state">
                    <Icon name="wrench" size={32} />
                    <h2>Под этот запрос товаров пока нет</h2>
                    <p>
                      В демо-каталоге применимость задана только для вымышленных
                      моделей EZ. Для вашего мотоцикла нужны данные поставщика.
                    </p>
                    <button
                      className="button outline"
                      onClick={() => {
                        setQuery("");
                        setSection("");
                        setMatchingOnly(false);
                      }}
                    >
                      Сбросить фильтры
                    </button>
                  </section>
                )}
              </>
            )}
          </>
        )
      )}
    </>
  );
}
