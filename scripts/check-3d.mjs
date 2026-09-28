// Проверка 3D-гаража (npm run check:3d):
// - dist/js/porsche3d.bundle.js собран из текущего src/porsche3d;
// - модели в dist/assets/3d совпадают с отчётом optimize-3d (не правлены руками),
//   сжаты Meshopt, текстуры WebP не больше заданных размеров, без касательных;
// - у каждой работы «Гаража услуг» есть ракурс, эффекты — только у известных работ;
// - размеры укладываются в бюджет; печатается таблица raw / gzip / brotli.
// Что страница не грузит 3D до нажатия, проверяет npm run check (check.mjs).
import {readFile, readdir, mkdtemp, rm} from 'node:fs/promises';
import {resolve, join} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {gzipSync, brotliCompressSync, constants} from 'node:zlib';
import assert from 'node:assert/strict';
import {NodeIO, Logger} from '@gltf-transform/core';
import {ALL_EXTENSIONS} from '@gltf-transform/extensions';
import {MeshoptDecoder} from 'meshoptimizer';
import sharp from 'sharp';
import {bundle3d, root, BUNDLE} from './bundle-3d.mjs';
import {importDist} from './dist-module.mjs';

const failures = [];
const check = (ok, message) => { if (!ok) failures.push(message); };

// 1. Бандл свежий.
const dir = await mkdtemp(join(tmpdir(), 'meatwash-3d-'));
try {
  const fresh = join(dir, 'porsche3d.bundle.js');
  const built = await bundle3d(fresh);
  // Бандл самодостаточен: в выходе нет ни одного import — importmap не нужен.
  const output = Object.entries(built.metafile.outputs).find(([name]) => name.endsWith('.bundle.js'))[1];
  check(output.imports.length === 0, 'В бандле остались импорты: ' + output.imports.map(i => i.path).join(', '));
  const [a, b] = await Promise.all([readFile(BUNDLE), readFile(fresh)]);
  check(a.equals(b), `dist/js/porsche3d.bundle.js отстал от src/porsche3d (закоммичено ${a.length} байт, из исходника ${b.length}). Выполните npm run bundle-3d.`);
} finally {
  await rm(dir, {recursive: true, force: true});
}

// 2. Модели.
await MeshoptDecoder.ready;
const io = new NodeIO().setLogger(new Logger(Logger.Verbosity.WARN))
  .registerExtensions(ALL_EXTENSIONS).registerDependencies({'meshopt.decoder': MeshoptDecoder});
const report = JSON.parse(await readFile(resolve(root, 'source/3d/optimize-report.json'), 'utf8'));
const MAX_TEXTURE = {desktop: 1024, mobile: 512};
const BUDGET = {desktop: 2.5e6, mobile: 1.3e6};
const rows = [];
// gzip и brotli — оценка на случай, если хостинг сжимает ответ (GitHub Pages
// сжимает не все типы). Исходник не сжимаем: долго, и он не публикуется.
const sizes = (label, buffer, compress = true) => rows.push([label, buffer.length,
  compress ? gzipSync(buffer, {level: 9}).length : '—',
  compress ? brotliCompressSync(buffer, {params: {[constants.BROTLI_PARAM_QUALITY]: 9}}).length : '—']);

sizes('source/3d/porsche-930.glb (исходник v1)', await readFile(resolve(root, 'source/3d/porsche-930.glb')), false);
for (const [name, variant] of Object.entries(report.variants)) {
  const file = resolve(root, 'dist', variant.file);
  const buffer = await readFile(file);
  sizes(variant.file, buffer);
  check(createHash('sha256').update(buffer).digest('hex') === variant.sha256, `${variant.file} не совпадает с отчётом optimize-3d. Выполните npm run optimize-3d.`);
  check(buffer.length <= BUDGET[name], `${variant.file}: ${buffer.length} байт больше бюджета ${BUDGET[name]}`);
  const document = await io.read(file);
  const used = document.getRoot().listExtensionsUsed().map(e => e.extensionName);
  for (const ext of ['EXT_meshopt_compression', 'KHR_mesh_quantization', 'EXT_texture_webp']) check(used.includes(ext), `${variant.file}: нет ${ext}`);
  check(!used.includes('KHR_draco_mesh_compression') && !used.includes('KHR_texture_basisu'), `${variant.file}: нужен тяжёлый декодер (Draco/Basis)`);
  for (const texture of document.getRoot().listTextures()) {
    check(texture.getMimeType() === 'image/webp', `${variant.file}: текстура не WebP`);
    const meta = await sharp(texture.getImage()).metadata();
    check(Math.max(meta.width, meta.height) <= MAX_TEXTURE[name], `${variant.file}: текстура ${meta.width}×${meta.height} больше ${MAX_TEXTURE[name]}`);
  }
  for (const mesh of document.getRoot().listMeshes()) for (const prim of mesh.listPrimitives()) {
    check(!prim.getAttribute('TANGENT'), `${variant.file}: остались касательные`);
  }
}
// В dist/assets/3d только текущие модели (имена с хешем), манифест модуля —
// с теми же адресами и размерами.
const expected = Object.values(report.variants).map(v => v.file.replace('assets/3d/', '')).sort();
const present = (await readdir(resolve(root, 'dist/assets/3d'))).sort();
check(JSON.stringify(present) === JSON.stringify(expected), 'В dist/assets/3d лишние или старые файлы: ' + present.join(', '));
const manifest = (await import('data:text/javascript;base64,' + Buffer.from(await readFile(resolve(root, 'src/porsche3d/models.js'), 'utf8')).toString('base64'))).MODELS;
check(manifest.high.file === report.variants.desktop.file && manifest.high.bytes === report.variants.desktop.bytes
  && manifest.low.file === report.variants.mobile.file && manifest.low.bytes === report.variants.mobile.bytes, 'src/porsche3d/models.js не совпадает с отчётом optimize-3d');
for (const variant of Object.values(report.variants)) check(variant.file.endsWith('.' + variant.sha256.slice(0, 10) + '.glb'), 'Имя модели без хеша содержимого: ' + variant.file);

const bundle = await readFile(BUNDLE);
sizes('dist/js/porsche3d.bundle.js', bundle);
check(bundle.length <= 700e3, `Бандл ${bundle.length} байт больше 700 КБ`);
check(gzipSync(bundle, {level: 9}).length <= 180e3, 'Бандл больше 180 КБ в gzip');

// 3. Ракурсы и работы гаража.
const views = await import('data:text/javascript;base64,' + Buffer.from(await readFile(resolve(root, 'src/porsche3d/views.js'), 'utf8')).toString('base64'));
// config.js импортирует data.js — относительные импорты подставляет importDist.
const config = await importDist(resolve(root, 'dist/js/config.js'));
// Внутри гаража машину показывает 3D: у каждой работы — ракурс модели, без фото.
check('overview' in views.VIEWS, 'Нет ракурса «Общий вид» (overview)');
for (const zone of config.ZONES) {
  const view = views.SERVICE_VIEWS[zone.id];
  check(view in views.VIEWS, `Работа гаража ${zone.id} без ракурса или с несуществующим ракурсом ${view}`);
}
for (const id of [...Object.keys(views.SERVICE_VIEWS), ...Object.keys(views.SERVICE_FX)]) check(config.ZONES.some(z => z.id === id), `В SERVICE_VIEWS/SERVICE_FX лишняя работа ${id}`);
for (const fx of Object.values(views.SERVICE_FX)) check(['wash', 'gloss'].includes(fx), `Неизвестный эффект ${fx}: модель убедительно показывает только wash и gloss`);

const pad = (v, n) => String(v).padStart(n);
console.log('Размеры 3D-ресурсов, байт:');
console.log(`${'файл'.padEnd(46)}${pad('raw', 11)}${pad('gzip', 11)}${pad('brotli', 11)}`);
for (const [label, raw, gz, br] of rows) console.log(`${label.padEnd(46)}${pad(raw, 11)}${pad(gz, 11)}${pad(br, 11)}`);

assert.equal(failures.length, 0, failures.join('\n'));
console.log('PASS: бандл собран из src/porsche3d, модели совпадают с отчётом и укладываются в бюджет (Meshopt, WebP, без касательных), у всех работ гаража есть ракурс модели.');
