import type { FastifyInstance, FastifyRequest } from "fastify";
import {
  learningSchemas,
  learningResponses,
  responses,
  type LearningCatalog,
} from "@enduro/contracts";
import type { Database, Row } from "./database.ts";
const msf = {
  title: "MSF: DirtBike School — программа и подготовка",
  url: "https://msf-usa.org/start-your-ride/dirtbike-school/",
};
export const learningCatalog: LearningCatalog = {
  title: "Перед первым выездом",
  description:
    "Три вводных урока: подготовка, история техники и план очной тренировки. Читайте в удобном порядке и сохраняйте личный прогресс.",
  level: "beginner",
  lessons: [
    {
      id: "prepare-ride",
      version: 1,
      order: 1,
      title: "Подготовка к выезду",
      summary: "Что согласовать с группой и проверить до старта.",
      sections: [
        {
          title: "Начните с понятного плана",
          body: "Выберите выезд под свой опыт. Заранее обсудите с организатором длительность, сложность, состав группы и возможность сократить маршрут. Если условия изменились, договоритесь заново, а не ориентируйтесь только на старое описание.",
          points: [
            "Уточните доступ к месту и актуальные условия у организатора.",
            "Согласуйте точку встречи, время и способ связи.",
            "Договоритесь, как группа действует при отставании участника или прекращении выезда.",
          ],
        },
        {
          title: "Экипировка и техника",
          body: "MSF относит к базовой подготовке защитный шлем, защиту глаз, перчатки, ботинки и защитную одежду, а также осмотр мотоцикла перед поездкой. Проверяйте комплект по требованиям своей площадки и инструкции производителя. Не отправляйтесь в удалённый маршрут в одиночку.",
          points: [
            "Сверьте состояние и посадку экипировки до выезда.",
            "Осмотрите технику по руководству своей модели; при сомнении обратитесь к механику.",
            "Проверьте заряд средств связи и обсудите запасной способ контакта с группой.",
          ],
        },
        {
          title: "Как использовать Enduro.Zone",
          body: "Посмотрите условия доступа в карточке локации и описание опубликованного трека. Карта и GPX помогают организовать поездку, но сами по себе не подтверждают текущую проходимость или разрешение на въезд. В покатушке точка сбора открывается после принятия заявки; учитывайте изменения и отмену события.",
          points: [],
        },
      ],
      takeaway:
        "До старта у вас должны быть понятные условия выезда, исправная техника и согласованный план группы.",
      action: { label: "Посмотреть покатушки", path: "rides" },
      sources: [msf],
    },
    {
      id: "garage-history",
      version: 1,
      order: 2,
      title: "Гараж и история обслуживания",
      summary: "Как сохранить данные мотоцикла и не терять выполненные работы.",
      sections: [
        {
          title: "Опишите именно свой мотоцикл",
          body: "В гараже укажите производителя, модель, год, двигатель и исполнение. Добавьте заметки о доработках. Две похожие модели могут иметь разные детали; свободное описание владельца пока не сверено со справочником производителя.",
          points: [
            "Проверьте данные по документам и руководству своей техники.",
            "Укажите важные изменения в заметках.",
            "Перед заказом детали сверяйте артикул и подтверждённую применимость продавца.",
          ],
        },
        {
          title: "Свой план ТО",
          body: "Добавьте работу в план обслуживания, укажите ближайший срок в моточасах и интервал из регламента своей модели с учётом условий эксплуатации. Сайт использует введённые вами значения. Статус «Пора обслужить» появляется, когда текущие моточасы достигли указанного срока.",
          points: [
            "Поддерживайте актуальные моточасы в карточке мотоцикла.",
            "После работы запишите дату, моточасы, сумму и использованные детали.",
            "Проверьте ввод перед сохранением: выполненные записи пока не редактируются.",
          ],
        },
        {
          title: "Личная история и публичный бортжурнал",
          body: "План ТО, расходы и заметки об обслуживании видны только владельцу. Выполнение работы пересчитывает следующий срок, а история сохраняется даже после архивирования работы. Если хотите поделиться опытом, создайте отдельную запись в бортжурнале и выберите её видимость.",
          points: [],
        },
      ],
      takeaway:
        "Личный план ТО помогает хранить историю, а бортжурнал — делиться опытом по вашему выбору.",
      action: { label: "Открыть мой гараж", path: "garage" },
      sources: [],
    },
    {
      id: "first-training",
      version: 1,
      order: 3,
      title: "Первая тренировка с инструктором",
      summary:
        "Какие вопросы задать перед очным занятием и как сформулировать цель.",
      sections: [
        {
          title: "Одна понятная цель",
          body: "Запишите, что хотите освоить и какой опыт у вас уже есть. Например: спокойно начинать движение и останавливаться на учебной площадке. Расскажите инструктору о своей технике и прошлых занятиях, чтобы подобрать подходящий формат.",
          points: [
            "Уточните, рассчитано ли занятие на ваш уровень.",
            "Обсудите требования к мотоциклу и экипировке.",
            "Спросите о площадке, числе участников и порядке обратной связи.",
          ],
        },
        {
          title: "Техника осваивается на практике",
          body: "В программе MSF DirtBike School очное обучение проходит на специально выбранных площадках и включает работу с органами управления, начало движения, остановку, положение на мотоцикле и повороты. Используйте этот перечень как ориентир для разговора с инструктором, а упражнения и нагрузку согласуйте на месте.",
          points: [
            "Согласуйте сигналы остановки занятия до начала практики.",
            "Попросите объяснить, по каким признакам оценивается выполнение упражнения.",
            "После занятия запишите обратную связь и следующую цель.",
          ],
        },
        {
          title: "Ваш следующий шаг",
          body: "Материалы этого раздела помогают подготовиться к занятию. Отметка «Прочитано» хранит прогресс чтения и не подтверждает навык езды. Каталог местных тренеров и запись на занятия ещё не подключены; выбирайте и обсуждайте очную тренировку самостоятельно.",
          points: [],
        },
      ],
      takeaway:
        "Подготовьте вопросы инструктору и выберите одну цель для ближайшего занятия.",
      action: { label: "Найти локацию на карте", path: "map" },
      sources: [msf],
    },
  ],
};
const progressOf = (r: Row) => ({
  lessonId: r.lesson_id,
  version: r.version,
  readAt: r.read_at ? new Date(r.read_at).toISOString() : null,
});
export function learningRoutes(
  app: FastifyInstance,
  db: Database,
  guards: {
    requireAuth: (r: FastifyRequest) => { user: Row };
    requireWrite: (r: FastifyRequest) => { user: Row };
    notFound: () => Error;
    HttpError: new (status: number, code: string, message: string) => Error;
  },
) {
  const auth = { security: [{ cookieSession: [] }], tags: ["Learning"] };
  app.get(
    "/api/learning",
    {
      schema: {
        tags: ["Learning"],
        response: { 200: learningResponses.catalog },
      },
    },
    async () => learningCatalog,
  );
  app.get(
    "/api/me/learning",
    {
      schema: {
        ...auth,
        response: { 200: learningResponses.progress, 401: responses.error },
      },
    },
    async (req) => {
      const user = guards.requireAuth(req).user;
      const rows = await db.query(
        "SELECT lesson_id,version,read_at FROM learning_progress WHERE user_id=$1",
        [user.id],
      );
      return {
        items: rows
          .filter((r) =>
            learningCatalog.lessons.some(
              (l) => l.id === r.lesson_id && l.version === r.version,
            ),
          )
          .map(progressOf),
      };
    },
  );
  app.post<{
    Params: { lessonId: string };
    Body: { read: boolean; version: number };
  }>(
    "/api/me/learning/:lessonId/progress",
    {
      schema: {
        ...auth,
        params: learningSchemas.id,
        body: learningSchemas.mark,
        response: {
          200: learningResponses.mark,
          400: responses.error,
          401: responses.error,
          403: responses.error,
          404: responses.error,
          409: responses.error,
        },
      },
    },
    async (req) => {
      const user = guards.requireWrite(req).user;
      const lesson = learningCatalog.lessons.find(
        (l) => l.id === req.params.lessonId,
      );
      if (!lesson) throw guards.notFound();
      if (req.body.version !== lesson.version)
        throw new guards.HttpError(
          409,
          "LESSON_CHANGED",
          "Урок обновлён. Обновите страницу перед сохранением прогресса.",
        );
      const [r] = await db.query(
        "INSERT INTO learning_progress(user_id,lesson_id,version,read_at) VALUES($1,$2,$3,CASE WHEN $4 THEN now() ELSE NULL END) ON CONFLICT(user_id,lesson_id,version) DO UPDATE SET read_at=CASE WHEN $4 THEN COALESCE(learning_progress.read_at,now()) ELSE NULL END,updated_at=now() RETURNING *",
        [user.id, lesson.id, lesson.version, req.body.read],
      );
      return progressOf(r);
    },
  );
}
