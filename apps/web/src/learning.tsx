import { useEffect, useState } from "react";
import {
  type Session,
  type LearningCatalog,
  type LearningProgress,
  type LessonProgress,
} from "@enduro/contracts";
import { api } from "./api.ts";
import { Icon, ErrorBox, Loading } from "./ui.tsx";
export function Learning({
  session,
  lessonId,
}: {
  session: Session | null;
  lessonId?: string;
}) {
  const [catalog, setCatalog] = useState<LearningCatalog | null>(null),
    [progress, setProgress] = useState<LessonProgress[]>([]),
    [error, setError] = useState(""),
    [progressError, setProgressError] = useState(""),
    [busy, setBusy] = useState(false),
    [retry, setRetry] = useState(0),
    [progressReady, setProgressReady] = useState(!session);
  useEffect(() => {
    let alive = true;
    setError("");
    api<LearningCatalog>("/learning")
      .then((c) => {
        if (alive) setCatalog(c);
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
    setProgress([]);
    setProgressError("");
    setProgressReady(!session);
    if (session)
      api<LearningProgress>("/me/learning")
        .then((p) => {
          if (alive) setProgress(p.items);
        })
        .catch((e) => {
          if (alive) setProgressError(e.message);
        })
        .finally(() => {
          if (alive) setProgressReady(true);
        });
    return () => {
      alive = false;
    };
  }, [session?.user.id, retry]);
  const lesson = catalog?.lessons.find((l) => l.id === lessonId);
  const read = (id: string, version: number) =>
    !!progress.find((p) => p.lessonId === id && p.version === version)?.readAt;
  const count =
    catalog?.lessons.filter((l) => read(l.id, l.version)).length ?? 0;
  const next =
    catalog?.lessons.find((l) => !read(l.id, l.version)) ?? catalog?.lessons[0];
  const nextLesson = catalog?.lessons.find(
    (l) => l.order === (lesson?.order ?? 0) + 1,
  );
  const mark = async () => {
    if (!lesson) return;
    setBusy(true);
    setProgressError("");
    try {
      const p = await api<LessonProgress>(
        `/me/learning/${lesson.id}/progress`,
        {
          method: "POST",
          body: {
            read: !read(lesson.id, lesson.version),
            version: lesson.version,
          },
        },
      );
      setProgress((old) => [
        ...old.filter((x) => x.lessonId !== p.lessonId),
        p,
      ]);
    } catch (e) {
      setProgressError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">ОПЫТ НАЧИНАЕТСЯ С ПОДГОТОВКИ</p>
          <h1>{lessonId ? (lesson?.title ?? "Урок") : "Обучение эндуро"}</h1>
          <p className="muted">
            Вводные материалы для первого выезда и очной тренировки.
          </p>
        </div>
        <span className="tag green">Базовый уровень</span>
      </div>
      <ErrorBox message={error} />
      {error && (
        <button
          className="button outline"
          onClick={() => setRetry((x) => x + 1)}
        >
          Повторить загрузку уроков
        </button>
      )}
      {!catalog && !error ? (
        <Loading />
      ) : (
        catalog && (
          <>
            <div className="learning-layout">
              <section>
                {lessonId ? (
                  lesson ? (
                    <article className="card lesson-article">
                      <a className="back-link" href="#learning">
                        ← Все уроки
                      </a>
                      <p className="eyebrow">
                        УРОК {lesson.order} ИЗ {catalog.lessons.length} ·
                        МАТЕРИАЛЫ ENDURO.ZONE
                      </p>
                      <p className="lesson-intro">{lesson.summary}</p>
                      {lesson.sections.map((s) => (
                        <section key={s.title}>
                          <h2>{s.title}</h2>
                          <p>{s.body}</p>
                          {s.points.length > 0 && (
                            <ul>
                              {s.points.map((point) => (
                                <li key={point}>{point}</li>
                              ))}
                            </ul>
                          )}
                        </section>
                      ))}
                      <div className="lesson-takeaway">
                        <Icon name="check" />
                        <p>{lesson.takeaway}</p>
                      </div>
                      {lesson.sources.length > 0 && (
                        <section className="lesson-sources">
                          <h3>Источники и дополнительное чтение</h3>
                          {lesson.sources.map((s) => (
                            <a
                              key={s.url}
                              href={s.url}
                              target="_blank"
                              rel="noreferrer"
                            >
                              {s.title} ↗
                            </a>
                          ))}
                          <p className="form-note">
                            Вводный материал Enduro.Zone с краткими ссылками на
                            источник. Это не официальный курс MSF и не запись в
                            школу.
                          </p>
                        </section>
                      )}
                      <div className="lesson-buttons">
                        {session ? (
                          <button
                            className={`button ${read(lesson.id, lesson.version) ? "outline" : ""}`}
                            disabled={busy || !progressReady || !!progressError}
                            onClick={mark}
                          >
                            {busy
                              ? "Сохраняем…"
                              : read(lesson.id, lesson.version)
                                ? "Вернуть в непрочитанные"
                                : "Отметить прочитанным"}
                            <Icon name="check" />
                          </button>
                        ) : (
                          <a className="button" href="#login">
                            Войти и сохранить прогресс
                          </a>
                        )}
                        <a
                          className="button outline"
                          href={`#${lesson.action.path}`}
                        >
                          {lesson.action.label}
                          <Icon name="arrow" />
                        </a>
                      </div>
                      {read(lesson.id, lesson.version) && (
                        <p className="form-note" role="status">
                          Урок отмечен прочитанным. Прогресс сохранён в вашем
                          аккаунте.
                        </p>
                      )}
                      {nextLesson && (
                        <a
                          className="lesson-next"
                          href={`#learning/${nextLesson.id}`}
                        >
                          Следующий урок: {nextLesson.title}
                          <Icon name="arrow" />
                        </a>
                      )}
                    </article>
                  ) : (
                    <section className="card empty-state">
                      <h2>Урок не найден</h2>
                      <a className="button outline" href="#learning">
                        Вернуться к урокам
                      </a>
                    </section>
                  )
                ) : (
                  <>
                    <section className="card learning-hero">
                      <span className="feature-icon">
                        <Icon name="book" size={36} />
                      </span>
                      <p className="eyebrow">
                        ВВОДНЫЙ МАРШРУТ · {catalog.lessons.length} УРОКА
                      </p>
                      <h2>{catalog.title}</h2>
                      <p>{catalog.description}</p>
                      {next && (
                        <a className="button" href={`#learning/${next.id}`}>
                          {count === 0
                            ? "Начать чтение"
                            : count === catalog.lessons.length
                              ? "Перечитать уроки"
                              : "Продолжить чтение"}
                          <Icon name="arrow" />
                        </a>
                      )}
                    </section>
                    <div className="learning-lessons">
                      {catalog.lessons.map((l) => (
                        <article className="card learning-lesson" key={l.id}>
                          <div className="lesson-number">
                            {String(l.order).padStart(2, "0")}
                          </div>
                          <div>
                            <span
                              className={`tag ${read(l.id, l.version) ? "green" : ""}`}
                            >
                              {read(l.id, l.version)
                                ? "Прочитано"
                                : "Вводный урок"}
                            </span>
                            <a href={`#learning/${l.id}`}>
                              <h2>{l.title}</h2>
                            </a>
                            <p className="muted">{l.summary}</p>
                            <a
                              className="text-button"
                              href={`#learning/${l.id}`}
                            >
                              {read(l.id, l.version)
                                ? "Перечитать"
                                : "Открыть урок"}{" "}
                              <Icon name="arrow" size={16} />
                            </a>
                          </div>
                        </article>
                      ))}
                    </div>
                  </>
                )}
              </section>
              <aside className="learning-aside">
                <section className="card learning-progress">
                  <p className="eyebrow">
                    {session ? "ВАШ ПРОГРЕСС" : "ЧИТАЙТЕ БЕЗ РЕГИСТРАЦИИ"}
                  </p>
                  <h2>
                    {session
                      ? `${count} из ${catalog.lessons.length}`
                      : "В своём темпе"}
                  </h2>
                  {session ? (
                    <>
                      <progress
                        aria-label="Прочитанные уроки"
                        max={catalog.lessons.length}
                        value={count}
                      />
                      <p className="muted">
                        {!progressReady
                          ? "Загружаем прогресс…"
                          : count === catalog.lessons.length
                            ? "Все вводные уроки прочитаны. Следующий шаг — практика с инструктором."
                            : "Прогресс чтения хранится в аккаунте и доступен на других устройствах."}
                      </p>
                    </>
                  ) : (
                    <>
                      <p className="muted">
                        Все уроки открыты гостям. Войдите, чтобы сохранять
                        отметки чтения.
                      </p>
                      <a className="button outline full" href="#login">
                        Войти
                      </a>
                    </>
                  )}
                  <ErrorBox message={progressError} />
                  {progressError && (
                    <button
                      className="text-button"
                      onClick={() => setRetry((x) => x + 1)}
                    >
                      Обновить прогресс
                    </button>
                  )}
                  <p className="form-note">
                    Отметка чтения не подтверждает навык езды. Практические
                    занятия проходят с инструктором.
                  </p>
                </section>
                <section className="card learning-next">
                  <Icon name="mountain" size={30} />
                  <h3>Дальше — очная практика</h3>
                  <p className="muted">
                    Каталог тренеров и запись на занятия появятся после
                    подключения школ. Пока подготовьте вопросы к своему
                    инструктору.
                  </p>
                  <a href="#learning/first-training">
                    Подготовиться к занятию <Icon name="arrow" size={16} />
                  </a>
                </section>
              </aside>
            </div>
          </>
        )
      )}
    </>
  );
}
