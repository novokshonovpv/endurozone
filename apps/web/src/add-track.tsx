import { useState } from "react";
import type { Session } from "@enduro/contracts";
import { Icon } from "./ui.tsx";
// Маршруты · «Добавь свою трассу»: how to record a ride and share it, plus an invitation text
// for clubs. The map grows from riders' own tracks; nothing is copied from other services.
const steps = [
  {
    title: "Запишите заезд",
    body: "Подойдёт любое приложение или навигатор, который пишет трек: OsmAnd (бесплатно, работает без сети), Strava, Wikiloc, Locus, Garmin. Включите запись перед стартом и остановите на финише.",
  },
  {
    title: "Сохраните трек в формате GPX",
    body: "В карточке записанного заезда найдите «Экспорт», «Поделиться» или «Скачать» и выберите GPX. Выгружайте только свои записи — треки других райдеров принадлежат им.",
  },
  {
    title: "Загрузите на Enduro.Zone",
    body: "Маршруты → Треки → «Загрузить GPX». Укажите название, город, сложность и условия доступа: кто разрешает въезд, когда можно кататься.",
  },
  {
    title: "Проверка модератором",
    body: "Начало и конец каждого отрезка скрываются, чтобы не показать, где вы живёте или храните мотоцикл. Полный файл видите только вы. После проверки трек появится на карте, по нему можно собрать покатушку.",
  },
];
const rules = [
  "Только маршруты, где ездить разрешено: мото-парки, трассы, дороги и земли с согласия владельца.",
  "Не через заповедники, нацпарки и другие охраняемые территории, пашни и посадки.",
  "Не указывайте домашний адрес и место хранения техники.",
];
const invitation = `Привет! Мы собираем карту эндуро-трасс и мест для катания — Enduro.Zone. Это бесплатно и без рекламы: места, GPX-треки, гонки и совместные покатушки в одном месте, в России и Беларуси.

Если у вас есть любимые маршруты, загрузите свои GPX — после проверки они появятся на общей карте, а начало и конец трека скрываются для приватности. Можно отмечать места, где были, и оценивать сложность.

Как добавить трассу: `;
export function AddTrack({ session }: { session: Session | null }) {
  const [copied, setCopied] = useState(false);
  const link = `${window.location.origin}/#add-track`;
  const text = invitation + link;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      window.prompt("Скопируйте текст", text);
    }
  };
  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">КАРТУ ДЕЛАЮТ РАЙДЕРЫ</p>
          <h1>Добавь свою трассу</h1>
          <p className="muted">
            Каждый проверенный трек помогает кому-то не потеряться в лесу и
            найти компанию на выходные. Четыре шага — и ваш маршрут на общей
            карте.
          </p>
        </div>
        <a className="button" href={session ? "#tracks?upload=1" : "#register"}>
          <Icon name="plus" />
          {session ? "Загрузить GPX" : "Создать аккаунт"}
        </a>
      </div>
      <ol className="howto-steps">
        {steps.map((s, i) => (
          <li className="card" key={s.title}>
            <span className="howto-number">{i + 1}</span>
            <div>
              <h2>{s.title}</h2>
              <p>{s.body}</p>
            </div>
          </li>
        ))}
      </ol>
      <section className="card howto-rules">
        <h2>Что можно публиковать</h2>
        <ul>
          {rules.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
        <p className="muted">
          Модератор проверит условия доступа и может отклонить трек с
          объяснением — его можно исправить и отправить снова.
        </p>
      </section>
      <section className="card howto-invite">
        <h2>Позовите свой клуб</h2>
        <p className="muted">
          Готовый текст для чата клуба или группы — скопируйте и отправьте.
        </p>
        <blockquote className="plain-text">{text}</blockquote>
        <button className="button outline" onClick={copy}>
          <Icon name="share" size={16} />
          {copied ? "Текст скопирован" : "Скопировать приглашение"}
        </button>
      </section>
    </>
  );
}
