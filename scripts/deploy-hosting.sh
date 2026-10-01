#!/usr/bin/env bash
# Выкладка готового dist (после stamp-assets и prune-deploy) на хостинг meatwash.ru (reg.ru).
# Вызывается из .github/workflows/pages.yml, только если в репозитории задан секрет FTP_HOST.
#   FTP_HOST      — сервер: «server123.hosting.reg.ru» (FTP, с TLS, если сервер его поддерживает)
#                   или «sftp://server123.hosting.reg.ru» (SFTP, если на хостинге включён SSH);
#   FTP_USER      — логин FTP-пользователя хостинга (не аккаунта reg.ru);
#   LFTP_PASSWORD — его пароль (секрет FTP_PASSWORD);
#   FTP_DIR       — папка сайта на сервере, по умолчанию www/meatwash.ru (должна существовать).
# Файлы перезаписываются; лишние файлы на сервере не удаляются.
set -euo pipefail
: "${FTP_HOST:?не задан FTP_HOST}" "${FTP_USER:?не задан FTP_USER}" "${LFTP_PASSWORD:?не задан FTP_PASSWORD}"
dir="${FTP_DIR:-www/meatwash.ru}"
cd "$(dirname "$0")/.."
lftp -c "
set cmd:fail-exit yes
set net:max-retries 3
set net:timeout 30
set ftp:ssl-allow yes
set sftp:auto-confirm yes
open --env-password -u '$FTP_USER' '$FTP_HOST'
cd '$dir'
mirror --reverse --verbose --parallel=4 --no-perms dist/ ./
"
