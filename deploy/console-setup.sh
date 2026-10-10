#!/usr/bin/env bash
# Однострочный запуск из веб-консоли Timeweb (root):
#   curl -fsSL https://raw.githubusercontent.com/novokshonovpv/endurozone/feat/timeweb-stand/deploy/console-setup.sh | bash
# Скачивает stand.sh, поднимает стенд и в конце печатает логин и пароль стенда.
set -euo pipefail
main() {
  curl -fsSL https://raw.githubusercontent.com/novokshonovpv/endurozone/feat/timeweb-stand/deploy/stand.sh -o /root/enduro-stand.sh
  STAND_HOST=enduro.200-165-236-78.sslip.io STAND_GENERATE_PASSWORD=1 bash /root/enduro-stand.sh setup </dev/null
}
main
