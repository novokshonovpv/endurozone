#!/usr/bin/env bash
set -euo pipefail
test "$(id -u)" = 0 || { echo 'Run as root on the Linux stand' >&2; exit 1; }
cd -- "$(dirname -- "$0")"
test -f /etc/endurozone.env
test -d /opt/endurozone/app/.data/postgres
systemd-analyze calendar '*-*-* 23:30:00 Europe/Moscow'
systemd-analyze verify "$PWD/endurozone-backup.service" "$PWD/endurozone-backup.timer"
install -d -m 700 /opt/endurozone/ops
if [ "$PWD/backup.py" != /opt/endurozone/ops/backup.py ]; then
  install -m 600 backup.py /opt/endurozone/ops/backup.py
fi
install -m 644 endurozone-backup.service /etc/systemd/system/endurozone-backup.service
install -m 644 endurozone-backup.timer /etc/systemd/system/endurozone-backup.timer
systemctl daemon-reload
systemctl start endurozone-backup.service
systemctl enable --now endurozone-backup.timer
systemctl list-timers endurozone-backup.timer --no-pager
