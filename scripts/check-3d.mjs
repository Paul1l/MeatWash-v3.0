// Проверка 3D-режима «Оживить Porsche» (npm run check:3d):
// - dist/js/porsche3d.bundle.js собран из текущего src/porsche3d;
// - модели в dist/assets/3d совпадают с отчётом optimize-3d (не правлены руками),
//   сжаты Meshopt, текстуры WebP не больше заданных размеров, без касательных;
// - у каждой работы «Гаража услуг» есть ракурс или явный отказ (фото);
// - размеры укладываются в бюджет; печатается таблица raw / gzip / brotli.
// Что страница не грузит 3D до нажатия, проверяет npm run check (check.mjs).
import {readFile, mkdtemp, rm} from 'node:fs/promises';
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
const bundle = await readFile(BUNDLE);
sizes('dist/js/porsche3d.bundle.js', bundle);
check(bundle.length <= 700e3, `Бандл ${bundle.length} байт больше 700 КБ`);
check(gzipSync(bundle, {level: 9}).length <= 180e3, 'Бандл больше 180 КБ в gzip');

// 3. Ракурсы и работы гаража.
const views = await import('data:text/javascript;base64,' + Buffer.from(await readFile(resolve(root, 'src/porsche3d/views.js'), 'utf8')).toString('base64'));
const config = await import('data:text/javascript;base64,' + Buffer.from(await readFile(resolve(root, 'dist/js/config.js'), 'utf8')).toString('base64'));
for (const zone of config.ZONES) {
  check(zone.id in views.SERVICE_VIEWS, `Работа гаража ${zone.id} без ракурса (или null — показать фото)`);
  const view = views.SERVICE_VIEWS[zone.id];
  check(view === null || view in views.VIEWS, `Работа ${zone.id} ссылается на несуществующий ракурс ${view}`);
}
for (const id of Object.keys(views.SERVICE_VIEWS)) check(config.ZONES.some(z => z.id === id), `В SERVICE_VIEWS лишняя работа ${id}`);
for (const name of views.PUBLIC_VIEWS) check(name in views.VIEWS, `Нет ракурса ${name}`);
check(views.TOUR.times.length === views.TOUR.keys.length, 'TOUR: times и keys разной длины');
check(views.TOUR.duration >= 6 && views.TOUR.duration <= 8, 'Показ должен длиться 6–8 с');

const pad = (v, n) => String(v).padStart(n);
console.log('Размеры 3D-ресурсов, байт:');
console.log(`${'файл'.padEnd(46)}${pad('raw', 11)}${pad('gzip', 11)}${pad('brotli', 11)}`);
for (const [label, raw, gz, br] of rows) console.log(`${label.padEnd(46)}${pad(raw, 11)}${pad(gz, 11)}${pad(br, 11)}`);

assert.equal(failures.length, 0, failures.join('\n'));
console.log('PASS: бандл собран из src/porsche3d, модели совпадают с отчётом и укладываются в бюджет (Meshopt, WebP, без касательных), у всех работ гаража есть ракурс или фото.');
