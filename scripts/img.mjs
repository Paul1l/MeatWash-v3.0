// Обрезка и сжатие картинок в WebP (план §6.1; поправка критика 3).
//
//   node scripts/img.mjs <исходник> <выход> [--aspect 21:9 --focus 0.6,0.5 | --crop x,y,w,h]
//                        [--widths 900,1600] [--quality 78] [--force]
//
//   <исходник>  файл картинки. Для фото с машинами — только уже замаскированные файлы
//               (source/v2-design/img/*: номера и таблички закрыты, см. v2d/img/photos.json):
//               обрезка не открывает того, что закрыто, но новый кадр проверяют глазами.
//   <выход>     путь от dist с {w} на месте ширины: assets/img/services/hero-{w}.webp
//               (без {w} — одна ширина, первая из --widths).
//   --aspect W:H и --focus fx,fy (0…1) — самый большой кадр с этими пропорциями вокруг точки;
//   --crop x,y,w,h — кадр в пикселях исходника. Без них — весь кадр.
//   --widths    ширины в px. Больше кадра не увеличиваем: файл получит ширину кадра,
//               скрипт предупредит — в srcset пишите настоящую ширину.
//   --force     перезаписать существующий файл. Только до первой выкладки: у хостинга
//               кэш картинок 7 дней, новую картинку кладём под новым именем.
// Печатает размер и вес каждого файла; LCP-картинка ≤ 120 КБ на телефоне и ≤ 200 КБ на
// компьютере (поправка 26) — больше — предупреждение.
// Владелец: WP0 → WP7. Пользуются WP1–WP5 для своих папок assets/img/<страница>/.
import sharp from 'sharp';
import {existsSync, mkdirSync, statSync} from 'node:fs';
import {resolve, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const flag = (name, fallback) => { const i = args.indexOf(`--${name}`); return i < 0 ? fallback : args[i + 1]; };
const [input, output] = args.filter((a, i) => !a.startsWith('--') && !args[i - 1]?.startsWith('--'));
if (!input || !output) { console.error('Нужно: node scripts/img.mjs <исходник> <выход-от-dist> [--aspect 21:9 --focus 0.5,0.5 | --crop x,y,w,h] [--widths 900,1600] [--quality 78] [--force]'); process.exit(1); }

const src = sharp(resolve(root, input));
const {width: W, height: H} = await src.metadata();
let box = {left: 0, top: 0, width: W, height: H};
if (flag('crop')) {
  const [left, top, width, height] = flag('crop').split(',').map(Number);
  box = {left, top, width, height};
} else if (flag('aspect')) {
  const [aw, ah] = flag('aspect').split(':').map(Number);
  const [fx, fy] = (flag('focus', '0.5,0.5')).split(',').map(Number);
  const width = Math.min(W, Math.round(H * aw / ah)), height = Math.min(H, Math.round(width * ah / aw));
  const clamp = (v, max) => Math.max(0, Math.min(max, v));
  box = {left: clamp(Math.round(fx * W - width / 2), W - width), top: clamp(Math.round(fy * H - height / 2), H - height), width, height};
}
if (box.left < 0 || box.top < 0 || box.left + box.width > W || box.top + box.height > H) { console.error(`Кадр ${JSON.stringify(box)} выходит за исходник ${W}×${H}`); process.exit(1); }

const widths = flag('widths', String(box.width)).split(',').map(Number);
const quality = Number(flag('quality', '78'));
const force = args.includes('--force');
const targets = output.includes('{w}') ? widths : [widths[0]];
for (const want of targets) {
  const width = Math.min(want, box.width);
  if (width < want) console.warn(`ВНИМАНИЕ: кадр ${box.width} px уже ${want} px — не увеличиваем, файл будет ${width} px.`);
  const out = resolve(root, 'dist', output.replace('{w}', String(want)));
  if (!out.startsWith(resolve(root, 'dist/assets') + '/')) { console.error(`Выход — только внутри dist/assets: ${out}`); process.exit(1); }
  if (existsSync(out) && !force) { console.error(`Уже есть ${out} — новое имя или --force (только до первой выкладки).`); process.exit(1); }
  mkdirSync(dirname(out), {recursive: true});
  const info = await sharp(resolve(root, input)).extract(box).resize({width}).webp({quality, effort: 6}).toFile(out);
  const kb = statSync(out).size / 1024;
  console.log(`${output.replace('{w}', String(want))}: ${info.width}×${info.height}, ${kb.toFixed(1)} КБ (кадр ${box.left},${box.top},${box.width}×${box.height} из ${W}×${H})`);
  if (kb > 200) console.warn(`ВНИМАНИЕ: больше 200 КБ — для героя на компьютере это сверх бюджета (поправка 26).`);
}
