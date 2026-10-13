# Android-приложение Enduro.Zone (TWA)

Оболочка над сайтом со своим **WebView** (`MainActivity`): приложение с иконкой EZ сразу открывает стенд, не спрашивая браузер, и работает без Chrome. При изменениях сайта APK пересобирать не нужно. Нативный клиент — позже, вместе с техническим основателем ([apps/mobile](../mobile/README.md)).

До сборки 4 (13.10.2026) это была Trusted Web Activity через Chrome; на телефонах без подходящего браузера по умолчанию она спрашивала, чем открыть, поэтому заменена на WebView. `deploy/assetlinks.json` больше не обязателен.

Что добавлено поверх голого WebView:
- ссылки за пределы стенда открываются во внешнем приложении, фрейм игры 67МОТО — внутри;
- выбор фото и GPX (несколько файлов), геопозиция с системным запросом разрешения;
- скачивание: обычные ссылки — через системный загрузчик с cookie сессии, `blob:`-файлы (выгрузка аккаунта, исходный GPX) — через мост `EnduroAndroid.save` в «Загрузки»;
- полноэкранный режим (`requestFullscreen`) скрывает системные панели и поворачивает экран горизонтально — для игры;
- «Назад» идёт по истории, страница «Нет связи» с повтором;
- к User-Agent добавляется `EnduroZoneApp/<версия>` — сайт узнаёт приложение.

- Пакет `zone.enduro.app`, версия 0.20.0 (versionCode 4), minSdk 24 (Android 7), targetSdk 34.
- Адрес: `https://enduro.200-165-236-78.sslip.io/#feed`; другой: `-PsiteHost=…`.

## Ключ подписи

Хранится **вне репозитория**: `%USERPROFILE%\.enduro-android\keys\` — `enduro-release.jks` и `keystore.properties` (пароли). Отпечаток SHA-256 публичен и записан в `assetlinks.json`. Без этого ключа обновление не установится поверх прежней версии (придётся удалять приложение). Сделайте копию папки `keys` в надёжное закрытое место; не отправляйте её в Git, чаты и облака без шифрования.

## Сборка (Windows)

Инструменты в `%USERPROFILE%\.enduro-android`: Microsoft OpenJDK 17, Gradle 8.9, Android SDK (platform 34, build-tools 34.0.0). Папка пользователя с кириллицей ломает сборку, поэтому всё запускается через короткий путь `C:\Users\E6C9~1\…`, а временная папка и `GRADLE_USER_HOME` переназначены туда же:

```bat
set T=C:\Users\E6C9~1\.enduro-android
set JAVA_HOME=%T%\jdk\17
set GRADLE_USER_HOME=%T%\gradle-home
set TEMP=%T%\tmp
set TMP=%T%\tmp
set JAVA_TOOL_OPTIONS=-Djava.io.tmpdir=%T%\tmp -Djdk.net.unixdomain.tmpdir=%T%\tmp
cd /d C:\Users\E6C9~1\DOCUME~1\Codex\2026-10-10\new-chat\outputs\enduro-zone\apps\android
gradlew.bat assembleRelease
```

Результат — `app/build/outputs/apk/release/app-release.apk`. Иконки перегенерировать: `node scripts/icons.mjs` из корня. `local.properties` (путь к SDK) не коммитится.

## Установка на телефон

Передайте APK на телефон (кабель, «Избранное» в мессенджере), откройте файл и разрешите установку из этого источника. С 13.10.2026 стенд открыт без общего пароля — приложение сразу показывает сайт.
