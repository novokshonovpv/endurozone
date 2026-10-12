# Android-приложение Enduro.Zone (TWA)

Первая версия — оболочка над сайтом: **Trusted Web Activity**. Приложение с иконкой EZ открывает стенд на весь экран через движок Chrome. Вход, пароль стенда, фото, GPX, карта и геопозиция работают как в браузере; при изменениях сайта APK пересобирать не нужно. Решение пользователя от 13.10.2026; нативный клиент — позже, вместе с техническим основателем ([apps/mobile](../mobile/README.md)).

- Пакет `zone.enduro.app`, версия 0.20.0 (versionCode 1), minSdk 21, targetSdk 34.
- Адрес: `https://enduro.200-165-236-78.sslip.io/#feed`; другой: `-PtwaHost=…`.
- Без Chrome сайт откроется в другом браузере (Custom Tab).
- Полноэкранный режим требует, чтобы сайт отдавал без пароля [`deploy/assetlinks.json`](../../deploy/assetlinks.json) по адресу `/.well-known/assetlinks.json` с отпечатком ключа подписи. Иначе сверху видна адресная строка — работать это не мешает.

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

Передайте APK на телефон (кабель, «Избранное» в мессенджере), откройте файл и разрешите установку из этого источника. Первый запуск спросит пароль стенда — как в браузере.
