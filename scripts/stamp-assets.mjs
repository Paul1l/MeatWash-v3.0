// Ставит версию к адресам CSS и JS в опубликованной копии dist, чтобы после
// выкладки браузер не смешивал новый HTML со старыми стилями из кэша
// (GitHub Pages отдаёт файлы с max-age=600). Запускается только в pages.yml
// после проверок; в репозиторий результат не коммитится.
// Одна версия на всё: модуль, загруженный по двум разным адресам, браузер
// выполнил бы дважды.
// Запуск: node scripts/stamp-assets.mjs <версия>
import {readFile, writeFile, readdir} from 'node:fs/promises';
import {resolve, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dist = resolve(root, 'dist');
const version = (process.argv[2] || '').replace(/[^\w.-]/g, '').slice(0, 12);
if (!version) { console.error('Нужна версия: node scripts/stamp-assets.mjs <sha>'); process.exit(1); }

let count = 0;
const stamp = (text, re) => text.replace(re, (m, pre, path, post) => { count++; return `${pre}${path}?v=${version}${post}`; });

// Страницы: все *.html в dist (index, services, about, credits) — локальные таблицы
// стилей и скрипты. Общие файлы получают одну версию на всех страницах.
const pages = (await readdir(dist)).filter((name) => name.endsWith('.html'));
for (const page of pages) {
  const file = resolve(dist, page);
  let html = await readFile(file, 'utf8');
  html = stamp(html, /(<link\b[^>]*\bhref=")((?:css|vendor)\/[^"?#]+\.css)(")/g);
  html = stamp(html, /(<script\b[^>]*\bsrc=")((?:js|vendor)\/[^"?#]+\.js)(")/g);
  await writeFile(file, html);
}

// Модули: относительные import и import().
for (const name of await readdir(resolve(dist, 'js'))) {
  if (!name.endsWith('.js')) continue;
  const file = resolve(dist, 'js', name);
  let js = await readFile(file, 'utf8');
  js = stamp(js, /(\bfrom\s*['"])(\.\/[^'"?#]+\.js)(['"])/g);
  js = stamp(js, /(\bimport\(\s*['"])(\.\/[^'"?#]+\.js)(['"]\s*\))/g);
  await writeFile(file, js);
}

console.log(`Версия ${version}: страниц — ${pages.length}, адресов помечено — ${count}.`);
