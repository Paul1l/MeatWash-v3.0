// Логотип MEATWASH на стене за машиной на превью гаража (cf-hero-dirty) — ТЗ от 01.10, п. 6.
// Исходный кадр без знака — source/shots/cf-hero-dirty.webp (не публикуется). Знак — тот же
// горизонтальный логотип, что в шапке и на стене 3D-зала (room.js, LOGO): тёплый светлый тон,
// приглушённый, с лёгким размытием — как надпись на стене, а не наклейка поверх фото.
// Стоит на стене прямо над машиной, ближе к середине кадра: превью во входе в гараж почти
// квадратное (object-fit: cover, по центру) — знак у края кадра оно обрезало. Пишет dist/assets/shots/cf-hero-dirty.webp (1600) и -s.webp (900).
// Запуск: node scripts/hero-logo.mjs [папка вывода]
import {readFile, mkdir} from 'node:fs/promises';
import {resolve, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import sharp from 'sharp';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = resolve(root, process.argv[2] || 'dist/assets/shots');
const SRC = resolve(root, 'source/shots/cf-hero-dirty.webp');
const LOGO_SVG = resolve(root, 'dist/assets/brand/Horizontal_Logo.svg');

// Положение и вид знака в координатах кадра 1600×894.
const LOGO = {cx: 790, cy: 168, width: 430, color: '#f0dcbc', opacity: 0.58, blur: 0.7};

const svg = (await readFile(LOGO_SVG, 'utf8'))
  .replaceAll('fill="white"', `fill="${LOGO.color}"`)
  .replace('<svg ', `<svg opacity="${LOGO.opacity}" `);
const mark = await sharp(Buffer.from(svg), {density: 144})
  .resize({width: LOGO.width})
  .blur(LOGO.blur)
  .png()
  .toBuffer();
const {height} = await sharp(mark).metadata();

const full = await sharp(SRC)
  .composite([{input: mark, left: Math.round(LOGO.cx - LOGO.width / 2), top: Math.round(LOGO.cy - height / 2), blend: 'screen'}])
  .toBuffer();

await mkdir(out, {recursive: true});
await sharp(full).webp({quality: 80, effort: 6}).toFile(resolve(out, 'cf-hero-dirty.webp'));
await sharp(full).resize({width: 900}).webp({quality: 80, effort: 6}).toFile(resolve(out, 'cf-hero-dirty-s.webp'));
console.log('cf-hero-dirty: знак на стене →', out);
