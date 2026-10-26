// npm run check — проверка каркаса Meat Auto без браузера, пока WP7 не переписал
// scripts/check.mjs под новую разметку (тогда WP7 переносит эти проверки туда и
// возвращает "check": "node scripts/check.mjs"). Прежняя проверка — npm run check:legacy.
//
// Ошибки (FAIL всегда):
//   - dist/*.html, sitemap.xml и js/data.js совпадают со сборкой (npm run build);
//   - нет оставшихся «{{» / «}}» (поправка критика 7);
//   - ссылки внутри сайта: без .html, главная — ./, страница есть, якорь есть, файл есть;
//     полные адреса https://meatwash.ru/… — так же; kit.html ни откуда не ссылается;
//   - мета: свой title и description ≤ 160, ровно один h1, canonical и og:url, JSON-LD читается;
//   - шрифт: preload и @font-face — один и тот же адрес с ?v= (поправка 28);
//   - контракты check §4.9: href="privacy", блок analytics, mw-metrika, обе ссылки записи
//     студий, «На карте» в подвале, карты студий без <iframe>, поля заявки;
//   - ключи data-price-item / data-yc-items / data-request-services — названия из каталога,
//     без неразрывных пробелов (поправка 16);
//   - sitemap: все страницы реестра с sitemap, без kit.html, без .html.
// Предупреждения (с --release — ошибки, npm run check:release):
//   - пометки «нужно от клиента» (span.todo);
//   - нет файла og:image;
//   - старое имя MEATWASH / Meatwash в тексте, alt, aria-label, title, og и JSON-LD
//     (кроме адреса канала t.me/MEATWASH_Auto и почты MeatWash.detailing@…, поправка 12);
//   - знаки ↗ и ✓ в тексте (их нет в Manrope — только иконки спрайта).
// Владелец: WP0 → WP7.
import {readFile, stat} from 'node:fs/promises';
import {resolve, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {REGISTRY} from '../src/content/pages.mjs';
import {buildPage, renderSitemap, FONT} from './content.mjs';
import {pageSlug, SITE} from './pages.mjs';
import {content as d, renderData} from './catalog.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..'), dist = resolve(root, 'dist');
const release = process.argv.includes('--release');
const errors = [], warnings = [];
const fail = (m) => errors.push(m);
const soft = (m) => (release ? errors : warnings).push(m);
const exists = async (p) => { try { return (await stat(p)).isFile(); } catch { return false; } };

const html = {}, ids = {};
for (const page of REGISTRY) {
  html[page.file] = await readFile(resolve(dist, page.file), 'utf8');
  ids[page.file] = new Set([...html[page.file].matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]));
}
const files = new Set(REGISTRY.map((p) => p.file));

// ── Сборка свежая ────────────────────────────────────────────────────────────
for (const page of REGISTRY) if (html[page.file] !== await buildPage(page)) fail(`${page.file} отстал от src/content, src/partials или данных — выполните npm run build`);
const sitemap = await readFile(resolve(dist, 'sitemap.xml'), 'utf8');
if (sitemap !== renderSitemap()) fail('sitemap.xml отстал — выполните npm run build');
if (await readFile(resolve(dist, 'js/data.js'), 'utf8') !== renderData()) fail('js/data.js отстал от meatwash-content.json — выполните npm run build');

// ── Страницы ─────────────────────────────────────────────────────────────────
const pageOf = (path) => { const name = path.replace(/^\.\//, ''); return name === '' || name === '.' ? 'index.html' : /\.\w+$/.test(name.split('/').pop()) ? null : name + '.html'; };
const strip = (text) => text.replace(/<script\b[\s\S]*?<\/script>/g, '').replace(/<style\b[\s\S]*?<\/style>/g, '').replace(/<!--[\s\S]*?-->/g, '');
const visibleText = (text) => strip(text).replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ');
const itemNames = new Set([...d.groups.flatMap((g) => g.items.map(([n]) => n)), ...d.groups.flatMap((g) => g.sections.map((s) => s.title)), ...d.programs.map(([n]) => n)]);
const titles = new Map(), descriptions = new Map();
const todos = [];
let links = 0;

for (const page of REGISTRY) {
  const file = page.file, text = html[file], body = strip(text);
  // Подстановки и пометки
  const left = body.match(/.{0,40}(\{\{|\}\}).{0,40}/);
  if (left) fail(`${file}: осталась подстановка: …${left[0]}…`);
  for (const [, what] of text.matchAll(/<span class="todo"[^>]*>\[нужно от клиента: ([^\]]*)\]<\/span>/g)) todos.push(`${file}: ${what}`);
  // Мета
  const title = text.match(/<title>([^<]+)<\/title>/)?.[1], description = text.match(/<meta name="description" content="([^"]+)"/)?.[1];
  if (!title || !description) fail(`${file}: нет title или description`);
  else {
    if (titles.has(title)) fail(`${file}: title повторяет ${titles.get(title)}`); titles.set(title, file);
    if (descriptions.has(description)) fail(`${file}: description повторяет ${descriptions.get(description)}`); descriptions.set(description, file);
    const len = description.replace(/&[a-z]+;|&#\d+;/g, 'x').length;
    if (len > 160) fail(`${file}: description длиннее 160 знаков (${len})`);
  }
  const h1 = [...text.matchAll(/<h1\b/g)].length;
  if (h1 !== 1) fail(`${file}: h1 на странице — ${h1}, нужен ровно один`);
  const url = SITE + pageSlug(file);
  if (!text.includes(`<link rel="canonical" href="${url}">`)) fail(`${file}: canonical должен быть ${url}`);
  if (!text.includes(`<meta property="og:url" content="${url}">`)) fail(`${file}: og:url должен быть ${url}`);
  for (const [, json] of text.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) { try { JSON.parse(json); } catch (e) { fail(`${file}: JSON-LD не читается: ${e.message}`); } }
  // Шрифт: один адрес в preload и @font-face
  const pre = text.match(/<link rel="preload" href="([^"]+)" as="font"/)?.[1], face = text.match(/@font-face\{[^}]*src:url\('([^']+)'\)/)?.[1];
  if (!pre || pre !== face || !pre.startsWith(FONT + '?v=')) fail(`${file}: адрес шрифта в preload (${pre}) и @font-face (${face}) должен совпадать и быть ${FONT}?v=…`);
  // Ссылки и файлы
  const urls = [...text.matchAll(/(?:src|href|data-static-src|imagesrcset)="([^"]+)"/g)].map((m) => m[1]);
  for (const [, set] of text.matchAll(/(?:srcset|imagesrcset)="([^"]+)"/g)) urls.push(...set.split(',').map((part) => part.trim().split(/\s+/)[0]));
  for (const raw of urls) {
    if (/^(https?:|tel:|mailto:|data:)/.test(raw) || raw.includes(' ')) continue;
    links++;
    const [path, hash] = raw.split('#');
    if (path === '' && hash !== undefined) { if (hash !== '' && !ids[file].has(hash)) fail(`${file}: нет якоря #${hash}`); continue; }
    const clean = path.split('?')[0];
    if (/\.html$/.test(clean)) { fail(`${file}: ссылка на страницу с .html — нужен адрес без расширения: ${raw}`); continue; }
    if (/^(\.\/)?index$/.test(clean)) { fail(`${file}: ссылка на главную — ./ (не index): ${raw}`); continue; }
    const target = pageOf(clean);
    if (target) {
      if (!files.has(target)) { fail(`${file}: ссылка на несуществующую страницу ${raw}`); continue; }
      if (target === 'kit.html' && file !== 'kit.html') fail(`${file}: ссылка на служебную kit.html`);
      if (hash && !ids[target].has(hash)) fail(`${file}: в ${target} нет якоря #${hash} (${raw})`);
      continue;
    }
    if (!await exists(resolve(dist, clean.replace(/^\.\//, '')))) fail(`${file}: нет файла ${raw}`);
  }
  for (const [address] of text.matchAll(/https?:\/\/(?:www\.)?meatwash\.ru(?:\/[^"'\s<>\\]*)?/g)) {
    const u = address.replace(/[.,;:)]+$/, '');
    if (!u.startsWith(SITE) && u !== SITE.slice(0, -1)) { fail(`${file}: адрес сайта — ${SITE}… (https, без www): ${u}`); continue; }
    const [rest, hash] = u.slice(SITE.length).split('#'), path = rest.split('?')[0];
    if (/\.\w+$/.test(path)) {
      if (/\.html$/.test(path) && !/^yandex_\w+\.html$/.test(path)) { fail(`${file}: адрес страницы с .html: ${u}`); continue; }
      if (!await exists(resolve(dist, path))) (/^assets\/img\/.*(og|og-meat-auto)\.webp$/.test(path) ? soft : fail)(`${file}: нет файла ${u}`);
      continue;
    }
    const target = path === '' ? 'index.html' : path + '.html';
    if (path === 'index' || !files.has(target)) { fail(`${file}: адрес несуществующей страницы ${u}`); continue; }
    if (hash && !ids[target].has(hash)) fail(`${file}: в ${target} нет якоря #${hash} (${u})`);
  }
  // Контракты §4.9
  if (!text.includes('href="privacy"')) fail(`${file}: нет ссылки href="privacy"`);
  if (!text.includes('<!-- SHARED:analytics:START -->') || !/<meta name="mw-metrika" content="\d+">/.test(text) || !text.includes('<meta name="yandex-verification"')) fail(`${file}: нет блока analytics с mw-metrika и yandex-verification`);
  if (/mc\.yandex\.ru/.test(text)) fail(`${file}: код Метрики в разметке — она грузится только после согласия (analytics.js)`);
  for (const l of d.locations) {
    if (!text.includes(`href="${l.booking}"`)) fail(`${file}: нет ссылки записи ${l.name} (${l.booking})`);
    if (!new RegExp(`<a class="footer__map" href="(about|)#map-${l.id}" data-map-link="${l.id}">`).test(text)) fail(`${file}: в подвале нет «На карте» ${l.id} по контракту`);
  }
  for (const [, host] of text.matchAll(/https:\/\/([\w.-]*yclients\.com)\//g)) if (!/^n(975571|1982508)\.yclients\.com$/.test(host)) fail(`${file}: чужой адрес YCLIENTS ${host}`);
  if (page.shared.includes('locations')) {
    for (const l of d.locations) if (!new RegExp(`id="map-${l.id}"[^>]*data-map-embed="${l.id}"`).test(text)) fail(`${file}: карта ${l.id} — id="map-${l.id}" и data-map-embed="${l.id}"`);
    if (/<iframe/.test(text)) fail(`${file}: iframe карты в разметке — его создаёт maps.js`);
  }
  if (page.shared.includes('dialogs')) for (const need of ['<input type="checkbox" name="consent" required', 'href="consent-request"', 'name="mw_extra" tabindex="-1" autocomplete="off"', 'ym-hide-content', 'ym-disable-keys']) if (!text.includes(need)) fail(`${file}: в окне заявки нет ${need}`);
  // Ключи корзины и окна записи — побуквенно из каталога (поправка 16)
  for (const [, attr, value] of text.matchAll(/\b(data-price-item|data-yc-items|data-request-services)="([^"]*)"/g)) {
    if (/ |&nbsp;/.test(value)) { fail(`${file}: неразрывный пробел в ${attr}="${value}"`); continue; }
    for (const name of value.split('|').map((s) => s.replace(/&quot;/g, '"').replace(/&amp;/g, '&'))) if (name && !itemNames.has(name)) fail(`${file}: ${attr}: «${name}» нет в каталоге`);
  }
  // Бренд (поправка 12) и знаки, которых нет в шрифте
  const brandText = text.replace(/<!--[\s\S]*?-->/g, '').replace(/t\.me\/MEATWASH_Auto/g, '').replace(/MeatWash\.detailing@gmail\.com/gi, '');
  const old = brandText.match(/.{0,30}\b(MEATWASH|Meatwash)\b.{0,30}/);
  if (old) soft(`${file}: старое имя: …${old[0].trim()}…`);
  const glyph = visibleText(text).match(/.{0,20}[↗✓].{0,20}/);
  if (glyph) soft(`${file}: знак ↗ или ✓ в тексте (нет в Manrope — иконка спрайта): …${glyph[0].trim()}…`);
}
for (const t of todos) soft(`нужно от клиента — ${t}`);

// ── sitemap ──────────────────────────────────────────────────────────────────
for (const page of REGISTRY) {
  const loc = `<loc>${SITE}${pageSlug(page.file)}</loc>`;
  if (page.sitemap && !sitemap.includes(loc)) fail(`sitemap.xml: нет ${page.file}`);
  if (!page.sitemap && sitemap.includes(loc)) fail(`sitemap.xml: служебной ${page.file} там быть не должно`);
}
if (/\.html<\/loc>/.test(sitemap)) fail('sitemap.xml: адреса страниц — без .html');

// ── Итог ─────────────────────────────────────────────────────────────────────
const pages = REGISTRY.filter((p) => p.sitemap).length;
console.log(`Страниц сайта: ${pages} (+ ${REGISTRY.length - pages} служебная), ссылок проверено: ${links}, пометок «нужно от клиента»: ${todos.length}.`);
if (warnings.length) console.warn(`Предупреждения (${warnings.length}; в check:release — ошибки):\n- ${warnings.join('\n- ')}`);
if (errors.length) { console.error(`FAIL (${errors.length}):\n- ${errors.join('\n- ')}`); process.exit(1); }
console.log(release ? 'PASS (release)' : 'PASS');
