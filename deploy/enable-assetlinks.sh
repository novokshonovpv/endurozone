#!/usr/bin/env bash
# One-time step for a stand set up before the Android app existed (root):
#   bash /opt/endurozone/app/deploy/enable-assetlinks.sh
# Adds a public /.well-known/assetlinks.json location to the stand's nginx site; the rest stays behind the password.
set -euo pipefail
CONF=/etc/nginx/sites-available/endurozone.conf
APP=/opt/endurozone/app
if grep -q 'assetlinks.json' "$CONF"; then
  echo "Уже настроено"
else
  cp "$CONF" "/root/endurozone.conf.bak.$(date +%s)"
  # Insert before every "location / {" (HTTP and HTTPS blocks), keeping certbot's lines intact.
  sed -i "s#^\(\s*\)location / {#\1location = /.well-known/assetlinks.json {\n\1    auth_basic off;\n\1    default_type application/json;\n\1    alias $APP/deploy/assetlinks.json;\n\1}\n\1location / {#" "$CONF"
fi
nginx -t
systemctl reload nginx
curl -fsS "https://$(grep -m1 -oP 'server_name \K[^;]+' "$CONF")/.well-known/assetlinks.json" | head -c 200
echo
