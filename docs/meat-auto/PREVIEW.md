# Meat Auto: превью на new.meatwash.ru — пакет, загрузка, проверка (WP7, 27.10.2026)

План §6.5 и поправки критика 1, 11, 15, 35–37. Загружает Влад после «го»; боевой сайт meatwash.ru
и его папку на хостинге не трогаем. Поддомен уже создан: A 31.31.196.94, сертификат Let's Encrypt,
сейчас там заглушка с noindex и переадресацией с www (поправка 1).

## 1. Собрать пакет

```
npm ci
npm run build && npm run check          # PASS; пометки «нужно от клиента» — только /import и /works
node scripts/preview-pack.mjs --out ../meat-auto-preview
```

`preview-pack` сам `dist` не меняет. Что он делает с копией:

- отсев (`prune-deploy`): старые модули и CSS, Arsenal, статичный manrope, старые логотипы, `kit.html`,
  неиспользуемые картинки в корне `assets/img` (в том числе фото Технопарка от «ГЕОмаркетинг»);
  3D-гараж остаётся;
- CSS сжимается (esbuild) и склеивается в один файл на страницу (`css/b-<хеш>.css`), к CSS и JS —
  `?v=<sha>`; шрифт и спрайт — с хешем содержимого, один адрес на всех страницах и в `404.html`;
- в каждой странице: `<meta name="robots" content="noindex, nofollow">`, в `<head>` адреса
  `https://new.meatwash.ru/` (canonical, og, JSON-LD); номер счётчика Метрики убран (`--no-metrika` по
  умолчанию): уведомления о cookie и Метрики на превью нет (поправка 11). Включить для проверки — `--metrika`;
- удалены `sitemap.xml`, `yandex_*.html`, `api/` (заявки на превью выключены), `kit.html`;
- `robots.txt` — `Disallow: /`; `.htaccess` — правила боевого `server/htaccess.txt` с хостом превью и
  `Header always set X-Robots-Tag "noindex, nofollow"`; `404.html`; `PREVIEW.txt` (хост, sha, время);
- проверка пакета и отчёт: страницы, адреса с `?v=`, пометки, размер, бюджеты (HTML ≤ 20 КБ gz,
  CSS ≤ 30, JS до взаимодействия ≤ 30, шрифт ≤ 60, LCP-картинка ≤ 120 на телефоне и ≤ 200 на компьютере).
  Превышение — код выхода 1;
- список файлов — рядом с папкой: `../meat-auto-preview.manifest.txt` (в загрузку не входит).

## 2. Проверить пакет локально (до загрузки)

```
sh scripts/qa/serve-preview.sh ../meat-auto-preview          # Apache macOS с тем же .htaccess, порт 4180
python3 scripts/qa/run.py --preview http://127.0.0.1:4180 --forwarded-proto https
sh scripts/qa/serve-preview.sh stop
```

`run.py` без `--preview` проверяет `dist` через `npm start`. Только Playwright и его Chromium/WebKit
(системный Chrome не запускается), запросы к `mc.yandex.ru` обрываются. Результаты и снимки — в `--out`
(по умолчанию `../meat-auto-qa`, вне репозитория). Для п. 13 нужен `axe.min.js`: `AXE_PATH=…` или
`--axe …`; Lighthouse — `npx lighthouse@12.8.2` с Chrome for Testing, медиана трёх прогонов.

## 3. Перед загрузкой (Влад)

1. Уточнить корневую папку поддомена в панели reg.ru (ожидаемо `~/www/new.meatwash.ru/`).
2. Скачать с сервера текущие `.htaccess` и `index.html` заглушки и сверить `.htaccess` с пакетным:
   noindex и переадресацию с www там уже кто-то настроил — пакетный файл делает то же самое.
3. Записать состояние боевого сайта (поправка 35):
   ```
   for u in / /services /css/style.css; do curl -sI "https://meatwash.ru$u" | grep -iE 'etag|last-modified'; done
   ```
4. Сверить вручную 9 ссылок с корзиной YCLIENTS (поправка 15): 4 программы × 2 студии для седана и
   «Трёхфазная» в Технопарке — корзина та и цена совпадает с сайтом. Автотесты YCLIENTS не открывают.

## 4. Загрузка

Содержимое `../meat-auto-preview/` — в корень поддомена, вместе со скрытым `.htaccess`. Папку
`~/www/meatwash.ru/` и её `.htaccess` не трогать.

## 5. Проверка после загрузки

```
curl -sI https://new.meatwash.ru/                 # 200, x-robots-tag: noindex, nofollow
curl -sI https://new.meatwash.ru/services         # 200
curl -sI https://new.meatwash.ru/services.html    # 301, location: https://new.meatwash.ru/services
curl -sI http://new.meatwash.ru/import            # 301 → https://new.meatwash.ru/import
curl -sI https://www.new.meatwash.ru/about        # 301 → https://new.meatwash.ru/about
curl -sI https://new.meatwash.ru/nope             # 404 (тело — 404.html)
curl -s  https://new.meatwash.ru/robots.txt       # Disallow: /
curl -s  https://new.meatwash.ru/PREVIEW.txt      # sha пакета
curl -sI https://meatwash.ru/PREVIEW.txt          # 404 — на боевой сайт пакет не попал
curl -sI "https://new.meatwash.ru/css/<файл из пакета>?v=<sha>"   # 200 text/css
python3 scripts/qa/run.py --preview https://new.meatwash.ru --only 4,9,10,11
```

И повторить команду из п. 3.3: `etag` и `last-modified` боевого сайта не изменились.

## 6. Повторные выкладки и откат

- Новый пакет кладётся поверх; `?v=` новый. Картинки, уже выложенные, не перезаписываются — новое имя.
- Файлы прошлой выкладки, которых нет в новой (поправка 37):
  `node scripts/preview-pack.mjs --out ../meat-auto-preview --previous ../meat-auto-preview.manifest.txt`
  — старый список читается до сборки, путь может совпадать. Перечисленные файлы удалить на сервере.
- Откат: удалить содержимое папки поддомена (или вернуть заглушку). Боевой сайт не затронут.

## 7. Путь на meatwash.ru — отдельное «го»

1. Ответы Романа вместо пометок «нужно от клиента»: `npm run check:release` должен быть PASS.
2. Слить `meat-auto` в `v2`, собрать боевой пакет (`stamp-assets` + `prune-deploy`, без шагов превью;
   склейку CSS можно взять из `preview-pack`), выложить по README. `/v2/` — 301 на `/`, не удалять.
