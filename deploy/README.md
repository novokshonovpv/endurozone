# Тестовый стенд на Timeweb

Закрытый стенд для основателей: **https://enduro.200-165-236-78.sslip.io** (адрес sslip.io указывает на IP сервера, сертификат Let's Encrypt). Перед сайтом браузер спрашивает общий логин и пароль стенда — их передают лично, в репозиторий они не попадают. Внутри работает обычная регистрация. Страницы закрыты от индексации.

Это не промышленный запуск: встроенная база PGlite, письма не отправляются (`MAIL_MODE=file`), подтверждение email выключено, резервного копирования нет. Используйте только тестовые данные.

## Устройство

```text
/opt/node-v24                      Node.js 24 (официальная сборка, проверка SHA-256)
/opt/endurozone/app                клон репозитория, ветка стенда
/opt/endurozone/app/.data          база стенда и локальные письма (не трогать при обновлении)
/etc/endurozone.env                переменные окружения (HOST=127.0.0.1, порт 3201, HTTPS-origin)
/etc/systemd/system/endurozone.service   служба под пользователем enduro
/etc/nginx/sites-available/endurozone.conf  свой server-блок; другие сайты не меняются
/etc/nginx/endurozone.htpasswd     хеш общего пароля стенда
```

Сервер слушает только 127.0.0.1; снаружи доступ через nginx с паролем и HTTPS. `TRUST_PROXY=true` — лимиты запросов считаются по реальному IP посетителя из заголовка nginx.

## Обновление

С компьютера с доступом `ssh timeweb` (root):

```sh
ssh timeweb "bash -s -- update feat/timeweb-stand" < deploy/stand.sh
```

Вместо `feat/timeweb-stand` можно указать другую опубликованную ветку. Скрипт берёт её из GitHub, ставит зависимости, собирает сайт, перезапускает службу и проверяет `/api/health`. База сохраняется.

## Полезное

```sh
ssh timeweb "systemctl status endurozone --no-pager"
ssh timeweb "journalctl -u endurozone -n 100 --no-pager"
ssh timeweb "systemctl stop endurozone && cd /opt/endurozone/app && sudo -u enduro env PATH=/opt/node-v24/bin:/opt/endurozone/tools/bin:/usr/bin:/bin pnpm moderator grant <ник> && systemctl start endurozone"
```

Письма подтверждения и восстановления пароля стенд не отправляет — они лежат в `/opt/endurozone/app/.data/mail`.

Первичная настройка (уже выполнена): `STAND_HOST=enduro.200-165-236-78.sslip.io STAND_PASSWORD_STDIN=1 bash stand.sh setup`, на stdin — логин и пароль стенда.
