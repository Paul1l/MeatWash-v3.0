// Ставит версию к адресам CSS и JS в опубликованной копии сайта, чтобы после выкладки
// браузер не смешивал новый HTML со старыми стилями и модулями из кэша: на reg.ru nginx
// отдаёт CSS и JS с max-age=3888000 (45 дней) и .htaccess не смотрит (план §0, §6.5).
// Запускается на копии (preview-pack, pages.yml); в репозиторий результат не коммитится.
//
// Одна версия на всё: модуль, загруженный по двум разным адресам, браузер выполнил бы дважды.
// Что помечается:
//   - во всех *.html папки: <link … href="css/…css"> и <script … src="js/…js">
//     (в том числе от корня — /css/…, как в 404.html);
//   - в js/*.js: относительные import … from './x.js' и import('./x.js');
//   - в css/*.css: url() шрифтов (woff2, woff, ttf) — версия та же (поправка 28).
// Адреса, у которых уже есть «?» (шрифт и спрайт с хешем содержимого из сборки — один и тот
// же адрес в preload и @font-face), не трогаются: иначе шрифт скачался бы дважды.
//
// Запуск: node scripts/stamp-assets.mjs <версия> [папка]   (папка по умолчанию — dist)
// Владелец: WP7.
import {readFile, writeFile, readdir} from 'node:fs/promises';
import {resolve, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const version = (process.argv[2] || '').replace(/[^\w.-]/g, '').slice(0, 12);
const dir = resolve(process.argv[3] || resolve(root, 'dist'));
if (!version) { console.error('Нужна версия: node scripts/stamp-assets.mjs <sha> [папка]'); process.exit(1); }

const counts = {html: 0, js: 0, css: 0};
const stamp = (kind) => (text, re) => text.replace(re, (m, pre, path, post) => { counts[kind]++; return `${pre}${path}?v=${version}${post}`; });
const list = async (sub, ext) => { try { return (await readdir(resolve(dir, sub))).filter((n) => n.endsWith(ext)); } catch { return []; } };

// Страницы: все *.html в корне папки.
const pages = await list('.', '.html');
for (const page of pages) {
  const file = resolve(dir, page), s = stamp('html');
  let html = await readFile(file, 'utf8');
  html = s(html, /(<link\b[^>]*\bhref=")(\/?(?:css|vendor)\/[^"?#]+\.css)(")/g);
  html = s(html, /(<script\b[^>]*\bsrc=")(\/?(?:js|vendor)\/[^"?#]+\.js)(")/g);
  await writeFile(file, html);
}

// Модули: относительные import и import().
for (const name of await list('js', '.js')) {
  const file = resolve(dir, 'js', name), s = stamp('js');
  let js = await readFile(file, 'utf8');
  js = s(js, /(\bfrom\s*['"])(\.\/[^'"?#]+\.js)(['"])/g);
  js = s(js, /(\bimport\s*['"])(\.\/[^'"?#]+\.js)(['"])/g);
  js = s(js, /(\bimport\(\s*['"])(\.\/[^'"?#]+\.js)(['"]\s*\))/g);
  await writeFile(file, js);
}

// Таблицы стилей: url() шрифтов.
for (const name of await list('css', '.css')) {
  const file = resolve(dir, 'css', name), s = stamp('css');
  const css = await readFile(file, 'utf8');
  const out = s(css, /(url\(\s*['"]?)((?!data:|https?:|\/\/)[^'")?#\s]+\.(?:woff2|woff|ttf))(['"]?\s*\))/g);
  if (out !== css) await writeFile(file, out);
}

console.log(`Версия ${version} (${dir}): страниц — ${pages.length}, помечено адресов — в HTML ${counts.html}, в модулях ${counts.js}, в CSS ${counts.css}.`);
