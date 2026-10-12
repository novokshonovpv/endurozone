# ИИ-механик: подключение провайдера

Сервер умеет работать с тремя провайдерами: **YandexGPT**, **GigaChat** и **OpenAI**. Без настроенного провайдера механик выключен и честно об этом пишет — поддельных ответов нет. Ключи хранятся только в переменных окружения сервера: не в Git, не в `VITE_*`, не в чатах и документах.

Всем провайдерам уходят одинаково минимальные данные: текст вопроса и описание выбранного своего мотоцикла (марка, модель, год, двигатель, исполнение) — после явного согласия на каждый вопрос. Профиль, email, координаты, ТО, заметки и прошлые вопросы не передаются. Правила безопасности ответа одинаковы. Текст согласия на сайте называет того провайдера, который подключён.

## Выбор

`MECHANIC_PROVIDER=yandex | gigachat | openai`. Если не задан — используется первый полностью настроенный в порядке OpenAI → YandexGPT → GigaChat. Если задан, но этот провайдер не настроен, механик выключен (без тихой подмены).

| | YandexGPT | GigaChat | OpenAI |
| --- | --- | --- | --- |
| Доступ с сервера в России | да | да | нет |
| Оплата | рубли, Yandex Cloud | рубли, Сбер | валюта |
| Переменные | `YANDEX_API_KEY`, `YANDEX_FOLDER_ID`, `YANDEX_MODEL` | `GIGACHAT_AUTH_KEY`, `GIGACHAT_SCOPE`, `GIGACHAT_MODEL` | `OPENAI_API_KEY`, `OPENAI_MODEL` |
| По умолчанию | `yandexgpt-lite/latest` | `GigaChat`, `GIGACHAT_API_PERS` | — |

Цены, лимиты и доступные модели меняются — сверяйте на сайте провайдера перед подключением и задайте месячный потолок расходов в кабинете провайдера. Лимит сайта — 10 вопросов в день на участника.

## YandexGPT

1. В Yandex Cloud создайте каталог (его ID — `YANDEX_FOLDER_ID`) и сервисный аккаунт с ролью `ai.languageModels.user`.
2. Создайте для сервисного аккаунта API-ключ — это `YANDEX_API_KEY`.
3. `YANDEX_MODEL` — например `yandexgpt-lite/latest` (дешевле) или `yandexgpt/latest`; можно указать полный URI `gpt://<каталог>/<модель>`.

Запрос: `POST https://llm.api.cloud.yandex.net/foundationModels/v1/completion`, заголовки `Authorization: Api-Key …` и `x-folder-id`. Принимается только ответ со статусом `ALTERNATIVE_STATUS_FINAL`; обрезанный или отфильтрованный ответ показывается как неудачная попытка.

## GigaChat

1. В кабинете разработчика Сбера создайте проект GigaChat API и получите **ключ авторизации** — это `GIGACHAT_AUTH_KEY` (строка, которую передают как `Basic`).
2. `GIGACHAT_SCOPE`: `GIGACHAT_API_PERS` для физлица, `GIGACHAT_API_B2B` / `GIGACHAT_API_CORP` для юрлица.
3. `GIGACHAT_MODEL`: `GigaChat` или модель из вашего тарифа.
4. Серверы Сбера используют сертификат **Russian Trusted Root CA** (НУЦ Минцифры). Скачайте его с официального сайта Госуслуг/Минцифры, положите на сервер и укажите путь: `NODE_EXTRA_CA_CERTS=/usr/local/share/ca-certificates/russian_trusted_root_ca.crt`. Отключать проверку TLS нельзя.

Сервер получает токен `POST https://ngw.devices.sberbank.ru:9443/api/v2/oauth` (живёт около 30 минут, переиспользуется и обновляется сам, в том числе после ответа 401), затем `POST https://gigachat.devices.sberbank.ru/api/v1/chat/completions`. Принимается только ответ с `finish_reason: "stop"`.

## OpenAI

`OPENAI_API_KEY` и `OPENAI_MODEL`; Responses API с `store: false`. С серверов в России API OpenAI недоступен. Стенд Timeweb находится в Москве (проверено по IP 12.10.2026), поэтому участникам стенда OpenAI напрямую не подключить; для этого понадобится зарубежный сервер или прокси — отдельное решение.

Проверка качества (50 вопросов) идёт с компьютера разработчика, где API OpenAI доступен. 12.10.2026 с компьютера пользователя запрос к API дошёл до OpenAI (ответ «неверный ключ» на пробный ключ, без блокировки региона).

1. На https://platform.openai.com войдите, в Billing пополните баланс и задайте месячный лимит расходов (Limits). Оплату и лимиты настраивает владелец аккаунта, не ассистент.
2. API keys → Create new secret key, права можно ограничить до Responses и Models (read).
3. В корне проекта создайте файл `.env.mechanic` (он в `.gitignore`, в Git не попадёт) и впишите туда ключ:

   ```sh
   MECHANIC_PROVIDER=openai
   OPENAI_API_KEY=…
   OPENAI_MODEL=
   ```

4. `npm run mechanic:eval -- --models` — бесплатно проверяет ключ и регион и печатает ID доступных моделей. Выберите модель (цены — https://developers.openai.com/api/docs/pricing; для проверки уместна та модель, которую планируется давать участникам) и впишите её в `OPENAI_MODEL`.
5. `npm run mechanic:eval -- --limit 1` — один платный вопрос; затем `npm run mechanic:eval` — все 50.

Файл `.env.mechanic` читает только скрипт проверки; локальный сайт (`.env`) от него не включает реальный ИИ.

## Включить на тестовом стенде

В консоли Timeweb (root) допишите переменные в `/etc/endurozone.env` (пример для YandexGPT):

```sh
cat >> /etc/endurozone.env <<'EOF'
MECHANIC_PROVIDER=yandex
YANDEX_API_KEY=…
YANDEX_FOLDER_ID=…
YANDEX_MODEL=yandexgpt-lite/latest
EOF
systemctl restart endurozone
curl -s http://127.0.0.1:3201/api/mechanic
```

Ответ должен содержать `"available":true` и `"provider":"yandex"`. Ключи переживают обновления стенда и повторную первичную настройку (`deploy/stand.sh` сохраняет строки `MECHANIC_*`, `OPENAI_*`, `YANDEX_*`, `GIGACHAT_*`, `NODE_EXTRA_CA_CERTS`). Не вставляйте ключи в чат и не присылайте их скриншоты.

## Перед открытием участникам

Проверка клиентов в автотестах выполнена на подставных ответах — реальные запросы к провайдерам ещё не проверялись. Перед пилотом: задать бюджет, прогнать проверочный набор вопросов и дать оценить ответы живому механику (особенно тормоза, подвеска, топливо, рама), убедиться, что при неуверенности бот советует сервис.
