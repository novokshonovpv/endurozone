#!/usr/bin/env bash
# Тестовый стенд Enduro.Zone на сервере Timeweb (root, по SSH):
#   STAND_HOST=enduro.200-165-236-78.sslip.io bash stand.sh setup  — первичная настройка (повторный запуск безопасен)
#   bash stand.sh update [ветка]                                    — выложить свежую версию ветки
#   bash stand.sh open                                              — снять пароль со стенда (сайт и приложение без входа по паролю)
# Пароль стенда необязателен: STAND_GENERATE_PASSWORD=1 или STAND_PASSWORD_STDIN=1 при setup.
# Отдельный пользователь, своя база PGlite в /opt/endurozone/app/.data, Node.js 24 в /opt/node-v24.
# Другие сайты на сервере (nginx) не затрагиваются: добавляется только свой server-блок.
set -euo pipefail

APP_USER=enduro
BASE=/opt/endurozone
APP="$BASE/app"
NODE_DIR=/opt/node-v24
PNPM="$BASE/tools/bin/pnpm"
ENV_FILE=/etc/endurozone.env
REPO=https://github.com/novokshonovpv/endurozone.git
PORT="${STAND_PORT:-3201}"
BRANCH="${2:-${STAND_BRANCH:-feat/timeweb-stand}}"

as_app() { sudo -u "$APP_USER" -H env PATH="$NODE_DIR/bin:$BASE/tools/bin:/usr/bin:/bin" "$@"; }

install_node() {
  if [ -x "$NODE_DIR/bin/node" ] && "$NODE_DIR/bin/node" -v | grep -q '^v24\.'; then return; fi
  local arch
  case "$(uname -m)" in x86_64) arch=x64 ;; aarch64) arch=arm64 ;; *) echo "Неизвестная архитектура" >&2; exit 1 ;; esac
  local tmp; tmp="$(mktemp -d)"
  curl -fsSL https://nodejs.org/dist/latest-v24.x/SHASUMS256.txt -o "$tmp/SHASUMS256.txt"
  local file; file="$(grep -o "node-v24\.[0-9.]*-linux-$arch\.tar\.xz" "$tmp/SHASUMS256.txt" | head -1)"
  curl -fsSL "https://nodejs.org/dist/latest-v24.x/$file" -o "$tmp/$file"
  (cd "$tmp" && grep " $file\$" SHASUMS256.txt | sha256sum -c -)
  rm -rf "$NODE_DIR" && mkdir -p "$NODE_DIR"
  tar -xJf "$tmp/$file" -C "$NODE_DIR" --strip-components=1
  rm -rf "$tmp"
}

build() {
  as_app git -C "$APP" fetch --quiet origin "$BRANCH"
  as_app git -C "$APP" checkout --quiet -B "$BRANCH" "origin/$BRANCH"
  as_app git -C "$APP" reset --quiet --hard "origin/$BRANCH"
  (cd "$APP" && as_app "$PNPM" install --frozen-lockfile)
  (cd "$APP" && as_app "$PNPM" build)
}

health() {
  for _ in $(seq 1 30); do
    if curl -fsS "http://127.0.0.1:$PORT/api/health"; then echo; return 0; fi
    sleep 2
  done
  echo "Сервер не ответил на /api/health" >&2
  journalctl -u endurozone -n 40 --no-pager >&2
  return 1
}

setup() {
  : "${STAND_HOST:?Укажите STAND_HOST}"
  local stand_user="" stand_password=""
  # Пароль стенда: со stdin (STAND_PASSWORD_STDIN=1) — читается до любых других команд — или генерируется.
  if [ "${STAND_PASSWORD_STDIN:-}" = 1 ]; then
    IFS= read -r stand_user
    IFS= read -r stand_password
  elif [ "${STAND_GENERATE_PASSWORD:-}" = 1 ] && [ ! -s /etc/nginx/endurozone.htpasswd ]; then
    stand_user=enduro
    stand_password="$(openssl rand -base64 18 | tr -d '/+=' | cut -c1-16)"
  fi
  if ss -ltn "sport = :$PORT" | grep -q LISTEN && ! systemctl is-active --quiet endurozone; then
    echo "Порт $PORT занят другим процессом. Укажите STAND_PORT." >&2
    exit 1
  fi
  apt-get update -y
  apt-get install -y nginx certbot python3-certbot-nginx git curl xz-utils openssl sudo
  install_node
  id "$APP_USER" >/dev/null 2>&1 || useradd --system --home-dir "$BASE" --shell /usr/sbin/nologin "$APP_USER"
  install -d -m 755 -o "$APP_USER" -g "$APP_USER" "$BASE" "$BASE/tools"
  [ -x "$PNPM" ] || as_app "$NODE_DIR/bin/npm" install --global --prefix "$BASE/tools" pnpm@11.25.0
  [ -d "$APP/.git" ] || as_app git clone --quiet "$REPO" "$APP"
  install -d -m 700 -o "$APP_USER" -g "$APP_USER" "$APP/.data"
  build

  # AI mechanic keys added by hand survive a repeated setup.
  local kept=""
  [ -f "$ENV_FILE" ] && kept="$(grep -E '^(MECHANIC_|OPENAI_|YANDEX_|GIGACHAT_|NODE_EXTRA_CA_CERTS=)' "$ENV_FILE" || true)"
  cat > "$ENV_FILE" <<EOF
HOST=127.0.0.1
PORT=$PORT
WEB_ORIGIN=https://$STAND_HOST
COOKIE_SECURE=true
TRUST_PROXY=true
MAIL_MODE=file
REQUIRE_VERIFIED_EMAIL=false
EOF
  [ -n "$kept" ] && printf '%s\n' "$kept" >> "$ENV_FILE"
  chmod 640 "$ENV_FILE" && chgrp "$APP_USER" "$ENV_FILE"

  cat > /etc/systemd/system/endurozone.service <<EOF
[Unit]
Description=Enduro.Zone test stand
After=network.target

[Service]
User=$APP_USER
Group=$APP_USER
WorkingDirectory=$APP/apps/api
EnvironmentFile=$ENV_FILE
ExecStart=$NODE_DIR/bin/node $APP/apps/api/node_modules/tsx/dist/cli.mjs src/server.ts
Restart=on-failure
RestartSec=5
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=$APP/.data

[Install]
WantedBy=multi-user.target
EOF
  systemctl daemon-reload
  systemctl enable --now endurozone
  systemctl restart endurozone
  health

  # В файл попадает только хеш; пароль не передаётся в аргументах команд.
  if [ -n "$stand_password" ]; then
    local hash
    hash="$(printf '%s' "$stand_password" | openssl passwd -apr1 -stdin)"
    printf '%s:%s\n' "$stand_user" "$hash" > /etc/nginx/endurozone.htpasswd
    chmod 640 /etc/nginx/endurozone.htpasswd && chgrp www-data /etc/nginx/endurozone.htpasswd
  fi
  # The stand is open by default (decision of 13.10.2026); a password applies only if one was set above.
  local auth=""
  if [ -s /etc/nginx/endurozone.htpasswd ]; then
    auth='        auth_basic "Enduro.Zone";
        auth_basic_user_file /etc/nginx/endurozone.htpasswd;'
  fi

  if [ ! -e /etc/nginx/sites-available/endurozone.conf ]; then
    cat > /etc/nginx/sites-available/endurozone.conf <<EOF
server {
    listen 80;
    listen [::]:80;
    server_name $STAND_HOST;
    add_header X-Robots-Tag "noindex, nofollow" always;
    client_max_body_size 8m;
    # The Android app (Trusted Web Activity) proves site ownership through this public file.
    location = /.well-known/assetlinks.json {
        default_type application/json;
        alias $APP/deploy/assetlinks.json;
    }
    location / {
$auth
        proxy_pass http://127.0.0.1:$PORT;
        proxy_set_header Host \$host;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_read_timeout 60s;
    }
}
EOF
    ln -sfn /etc/nginx/sites-available/endurozone.conf /etc/nginx/sites-enabled/endurozone.conf
  fi
  nginx -t
  systemctl reload nginx
  # Аккаунт Let's Encrypt на сервере уже есть (laminat.sale); без него certbot попросит согласие с условиями.
  certbot --nginx --non-interactive --redirect -d "$STAND_HOST"
  nginx -t && systemctl reload nginx
  echo
  echo "Готово: https://$STAND_HOST"
  if [ "${STAND_GENERATE_PASSWORD:-}" = 1 ] && [ -n "$stand_password" ]; then
    echo "Логин стенда: $stand_user"
    echo "Пароль стенда: $stand_password"
    echo "Сохраните их: повторно пароль не показывается (хранится только хеш)."
  fi
}

update() {
  build
  systemctl restart endurozone
  health
}

# Removes the stand password: drops auth_basic lines from the stand's nginx site and the password file.
open_stand() {
  local conf=/etc/nginx/sites-available/endurozone.conf
  cp "$conf" "/root/endurozone.conf.bak.$(date +%s)"
  sed -i '/auth_basic/d' "$conf"
  nginx -t
  systemctl reload nginx
  rm -f /etc/nginx/endurozone.htpasswd
  echo "Пароль снят: сайт открыт без входа по паролю"
}

case "${1:-}" in
  setup) setup ;;
  update) update ;;
  open) open_stand ;;
  *) echo "Использование: stand.sh setup|update [ветка]|open" >&2; exit 2 ;;
esac
