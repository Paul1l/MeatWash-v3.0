// Отсев файлов, которые опубликованная страница не запрашивает. Работает только на копии
// сайта (preview-pack, pages.yml): в репозитории файлы остаются — это исходники (ttf,
// логобук в PNG и других цветах), старые модули и картинки прошлых версий.
//
// Удаляются только пути из списка ниже и «кандидаты по папке» (кадры assets/shots и файлы
// в корне assets/img — не подпапки страниц), и только если имени файла нет ни в одном
// HTML, CSS, JS, TXT и XML выкладки (комментарии не в счёт; данные страница берёт из
// js/data.js, а не из JSON). Сами кандидаты в этой проверке не участвуют.
// Список Meat Auto (план §6.2 WP7): старые модули main.js и page.js, старые CSS, Arsenal,
// статичный manrope, логотипы Horizontal_* и Main_*, kit.html. 3D-гараж остаётся (решение
// Влада 27.10): garage.js, config.js, porsche3d.bundle.js с LEGAL.txt и assets/3d не трогаем.
//
// Запуск: node scripts/prune-deploy.mjs [папка]   (по умолчанию dist)
// Владелец: WP7.
import {readdir, readFile, stat, rm} from 'node:fs/promises';
import {resolve, dirname, join, relative, basename} from 'node:path';
import {fileURLToPath} from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dist = resolve(process.argv[2] || join(root, 'dist'));

// Исходники и варианты, которые страница не грузит.
const FILES = [
  'assets/img/hero-hq.webp',                // постер прошлой версии; теперь постер из assets/shots
  // Кадры глав и карта клуба прошлой версии: статичный режим берёт assets/shots, клуб — club-card.webp.
  'assets/img/body.webp',
  'assets/img/card-ceramic.webp',
  'assets/img/card-interior.webp',
  'assets/img/card-polish.webp',
  'assets/img/member-card.webp',
  // Логобук прошлой шапки и подвала (Meat Auto берёт быка из assets/brand/sprite.svg).
  'assets/brand/Bull_Logo.png',
  'assets/brand/Bull_Logo.svg',
  'assets/brand/Bull_Logo_black.png',
  'assets/brand/Bull_Logo_black.svg',
  'assets/brand/Bull_Logo_red.png',
  'assets/brand/Bull_Logo_red.svg',
  'assets/brand/Horizontal_Logo.png',
  'assets/brand/Horizontal_Logo_black.png',
  'assets/brand/Horizontal_Logo_black.svg',
  'assets/brand/Horizontal_Logo_red.png',
  'assets/brand/Horizontal_Logo_red.svg',
  'assets/brand/Main_Logo.png',
  'assets/brand/Main_Logo.svg',
  'assets/brand/Main_Logo_black.png',
  'assets/brand/Main_Logo_red.png',
  'assets/brand/Main_Logo_red.svg',
  // Шрифты подключаются в WOFF2; ttf — только исходники.
  'assets/fonts/arsenal-sc-bold.ttf',
  'assets/fonts/arsenal-sc-regular.ttf',
  'assets/fonts/manrope.ttf',
  // Текст набран Arsenal: Manrope и прежний файл Arsenal SC Regular не подключены.
  'assets/fonts/manrope.woff2',
  'assets/fonts/arsenal-sc-regular.woff2',
  'assets/favicon.png',                     // иконка теперь favicon-bull.png
  // Картинки, оставшиеся от прошлых версий макета.
  'assets/img/hero.webp',
  'assets/img/loc-myasnitskaya.webp',
  'assets/img/loc-technopark.webp',
  'assets/img/thumb-body.webp',
  'assets/img/thumb-interior.webp',
  'assets/img/thumb-polish.webp',
  'assets/img/thumb-ceramic.webp',
  // Meat Auto: прежние страницы и их модули — новые страницы их не подключают.
  'js/main.js',
  'js/page.js',
  'css/style.css',
  'css/cinematic.css',
  'css/pages.css',
  'css/catalog.css',
  'css/proof.css',
  // Arsenal заменён Manrope; статичный manrope (400) — вариативным manrope-vf.woff2.
  'assets/fonts/arsenal.woff2',
  'assets/fonts/arsenal-bold.woff2',
  'assets/fonts/arsenal-sc.woff2',
  'assets/fonts/arsenal-sc-bold.woff2',
  'assets/fonts/OFL-ArsenalSC.txt',
  // Логотипы прошлой шапки: шапка и гараж — белый бык из спрайта и вывеска Meat Auto.
  'assets/brand/Horizontal_Logo.svg',
  'assets/brand/Main_Logo_black.svg',
  // Служебная страница компонентов — только локально.
  'kit.html',
];

async function collect(dir) {
  const out = [];
  for (const entry of await readdir(dir, {withFileTypes: true})) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...await collect(full));
    else out.push(full);
  }
  return out;
}

const all = await collect(dist);
const rel = file => relative(dist, file).split(/[\\/]/);
// Кадры бывшей фото-витрины и картинки в корне assets/img: в выкладку идут только те, на
// которые ссылаются страницы и скрипты; остальные — нет (в том числе фото
// Технопарка от «ГЕОмаркетинг», прав на которое нет, — поправка критика 10).
const byFolder = all.filter(file => { const p = rel(file); return p.slice(0, 2).join('/') === 'assets/shots' || p.length === 3 && p[0] === 'assets' && p[1] === 'img'; }).map(file => rel(file).join('/'));
FILES.push(...byFolder.filter(entry => !FILES.includes(entry)));
const candidates = new Set(FILES.map(entry => resolve(dist, entry)));
const readable = all.filter(file => /\.(html|css|js|mjs|txt|xml)$/i.test(file) && !candidates.has(file));
// Комментарии не в счёт: «прежде их обнулял style.css» в garage.css не держит style.css в выкладке.
const uncomment = (file, text) => /\.(css|js|mjs)$/i.test(file)
  ? text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1')
  : /\.html$/i.test(file) ? text.replace(/<!--[\s\S]*?-->/g, '') : text;
const sources = await Promise.all(readable.map(async file => uncomment(file, await readFile(file, 'utf8'))));
const text = sources.join('\n');
// Картинки в корне assets/img ищем по пути (assets/img/og.webp), а не по имени: иначе
// старую og.webp держала бы ссылка на assets/img/services/og.webp.
const mentioned = entry => text.includes(/^assets\/img\/[^/]+$/.test(entry) ? entry : basename(entry));

let removed = 0, bytes = 0;

for (const entry of FILES) {
  const file = resolve(dist, entry);
  let size;
  try { size = (await stat(file)).size; } catch { continue; }
  if (mentioned(entry)) { console.log(`оставлен (есть ссылка): ${entry}`); continue; }
  await rm(file);
  removed++; bytes += size;
  console.log(`удалён ${entry} — ${size} байт`);
}

console.log(`Из выкладки ${relative(root, dist) || dist} убрано ${removed} файлов, ${bytes} байт.`);
