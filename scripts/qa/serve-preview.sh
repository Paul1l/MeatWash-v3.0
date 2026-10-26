#!/bin/sh
# Пакет превью в локальном Apache — с тем же .htaccess, что поедет на хостинг (план §6.5).
# Нужен httpd с mod_rewrite, mod_headers, mod_deflate (в macOS есть: /usr/sbin/httpd).
# За nginx хостинга https сообщает заголовок X-Forwarded-Proto: без него правила .htaccess
# отправляют http-запрос на https://<host>/…, поэтому проверки шлют его сами:
#   curl -sI -H 'X-Forwarded-Proto: https' http://127.0.0.1:4180/services
#   python3 scripts/qa/run.py --preview http://127.0.0.1:4180 --forwarded-proto https
#
#   sh scripts/qa/serve-preview.sh ../meat-auto-preview [порт]     # запуск
#   sh scripts/qa/serve-preview.sh stop [порт]                     # остановка
# Настройки и журналы — во временной папке вне репозитория. Владелец: WP7.
set -e
PORT=${2:-4180}
RUN="${TMPDIR:-/tmp}/meat-auto-apache-$PORT"
if [ "$1" = "stop" ]; then httpd -f "$RUN/httpd.conf" -k stop; exit 0; fi
DIR=$(cd "${1:?нужна папка пакета превью}" && pwd)
[ -f "$DIR/.htaccess" ] || { echo "В $DIR нет .htaccess — это не пакет preview-pack"; exit 1; }
MODS=/usr/libexec/apache2
[ -d "$MODS" ] || MODS=$(dirname "$(find / -name mod_rewrite.so 2>/dev/null | head -1)")
mkdir -p "$RUN"
cat > "$RUN/httpd.conf" <<EOF
ServerRoot "/usr"
Listen 127.0.0.1:$PORT
ServerName new.meatwash.ru
LoadModule mpm_prefork_module $MODS/mod_mpm_prefork.so
LoadModule authz_core_module $MODS/mod_authz_core.so
LoadModule unixd_module $MODS/mod_unixd.so
LoadModule dir_module $MODS/mod_dir.so
LoadModule mime_module $MODS/mod_mime.so
LoadModule rewrite_module $MODS/mod_rewrite.so
LoadModule headers_module $MODS/mod_headers.so
LoadModule expires_module $MODS/mod_expires.so
LoadModule filter_module $MODS/mod_filter.so
LoadModule deflate_module $MODS/mod_deflate.so
LoadModule log_config_module $MODS/mod_log_config.so
PidFile "$RUN/httpd.pid"
ErrorLog "$RUN/error.log"
LogFormat "%h %r %>s" common
CustomLog "$RUN/access.log" common
TypesConfig /private/etc/apache2/mime.types
# Как на хостинге: JS — application/javascript (его сжимает правило DEFLATE из .htaccess).
AddType application/javascript .js
DocumentRoot "$DIR"
<Directory "$DIR">
  AllowOverride All
  Require all granted
  Options -MultiViews
</Directory>
StartServers 2
MinSpareServers 1
MaxSpareServers 3
EOF
httpd -f "$RUN/httpd.conf" -t
httpd -f "$RUN/httpd.conf" -k start
echo "Превью: http://127.0.0.1:$PORT/ (заголовок X-Forwarded-Proto: https), журналы — $RUN"
