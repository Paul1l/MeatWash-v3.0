// Проверка 3D-гаража (npm run check:3d):
// - dist/js/porsche3d.bundle.js собран из текущего src/porsche3d;
// - модели в dist/assets/3d совпадают с отчётом optimize-3d (не правлены руками),
//   сжаты Meshopt, текстуры WebP не больше заданных размеров, без касательных;
// - у каждой работы «Гаража услуг» есть ракурс, эффекты — только у известных работ
//   и известного вида: блик (glow) — с путём света для ракурса, капли (rain) — только
//   в ракурсе лобового стекла и лежат на внешней стороне стекла обеих моделей;
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
import * as THREE from 'three';
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

// Кокпит (src/porsche3d/interior.js) собирается тем же кодом, что в браузере, поверх
// стёкол модели: ни одна его вершина под стеклом не ближе GLASS_CLEARANCE —
// иначе торпедо видно сквозь лобовое стекло. Холст для текстур кожи — заглушка.
globalThis.document ??= {createElement: () => ({width: 0, height: 0, getContext: () => new Proxy({}, {get: (t, k) => k in t ? t[k] : () => {}})})};
const interior = await import(new URL('../src/porsche3d/interior.js', import.meta.url).href);
const dropsModule = await import(new URL('../src/porsche3d/drops.js', import.meta.url).href);
async function cockpitClearance(gltfDocument) {
  const car = new THREE.Group();
  for (const node of gltfDocument.getRoot().listNodes()) {
    const mesh = node.getMesh(); if (!mesh) continue;
    const matrix = new THREE.Matrix4().fromArray(node.getWorldMatrix());
    for (const prim of mesh.listPrimitives()) {
      if (prim.getMaterial()?.getName() !== 'glass') continue;
      const geometry = new THREE.BufferGeometry();
      // Позиции квантованы (KHR_mesh_quantization): getElement отдаёт их нормализованными.
      const position = prim.getAttribute('POSITION'), xyz = new Float32Array(position.getCount() * 3), el = [];
      for (let i = 0; i < position.getCount(); i++) xyz.set(position.getElement(i, el), i * 3);
      geometry.setAttribute('position', new THREE.BufferAttribute(xyz, 3));
      if (prim.getIndices()) geometry.setIndex(Array.from(prim.getIndices().getArray()));
      const glass = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({name: 'glass'}));
      glass.applyMatrix4(matrix); car.add(glass);
    }
  }
  const built = await interior.buildInterior(car);
  const glass = interior.glassMap(car);
  built.group.updateMatrixWorld(true);
  let min = Infinity, under = 0;
  const v = new THREE.Vector3();
  built.group.traverse(o => {
    if (!o.geometry) return;
    const position = o.geometry.attributes.position;
    for (let i = 0; i < position.count; i++) {
      v.fromBufferAttribute(position, i).applyMatrix4(o.matrixWorld);
      const top = glass?.height(v.x, v.z);
      if (top == null) continue;
      under++; min = Math.min(min, top - v.y);
    }
  });
  // Капли «Антидождя» (бусины без движения): на лобовом стекле, ни одна вершина не
  // ниже его внешней поверхности — иначе капля тонет в стекле или видна изнутри.
  const drops = {};
  for (const low of [false, true]) {
    const set = dropsModule.buildDrops(glass, {low});
    if (!set) { drops[low ? 'low' : 'high'] = {count: 0, below: 0, off: 0}; continue; }
    set.update(0, true);
    const position = set.mesh.geometry.attributes.position;
    let below = 0, off = 0;
    for (let i = 0; i < position.count; i++) {
      const y = glass.height(position.getX(i), position.getZ(i), true);
      if (y == null) off++; else if (position.getY(i) < y - 1e-4) below++;
    }
    // Только лобовое стекло: перед кабиной (заднее — за ней, z > 0).
    const rear = set.sample().filter(d => d.z > -0.1).length;
    drops[low ? 'low' : 'high'] = {count: set.count, below, off, rear};
    set.dispose();
  }
  // Табличка клуба на торпедо: есть, целиком под лобовым стеклом и лицом к нему
  // (наружу) — иначе логотип не виден сквозь стекло.
  let plaque = null;
  const n = new THREE.Vector3(), normalMatrix = new THREE.Matrix3();
  built.group.traverse(o => {
    if (o.name !== 'dash-logo') return;
    const position = o.geometry.attributes.position, normal = o.geometry.attributes.normal;
    normalMatrix.getNormalMatrix(o.matrixWorld);
    let outside = 0, facing = 0;
    for (let i = 0; i < position.count; i++) {
      v.fromBufferAttribute(position, i).applyMatrix4(o.matrixWorld);
      if (glass?.height(v.x, v.z) == null) outside++;
      if (n.fromBufferAttribute(normal, i).applyMatrix3(normalMatrix).normalize().y > 0.3) facing++;
    }
    plaque = {count: position.count, outside, facing};
  });
  built.dispose();
  return {min, under, fitted: built.fitted, triangles: glass?.triangles || 0, drops, plaque};
}
const clearances = [];

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
  const fit = await cockpitClearance(document);
  clearances.push(`${name}: ${(fit.min * 100).toFixed(1)} см (вершин под стёклами ${fit.under}, подогнано ${fit.fitted}); капель ${fit.drops.high.count} / телефон ${fit.drops.low.count}; табличка на торпедо — ${fit.plaque?.count ?? 0} вершин`);
  check(fit.plaque && fit.plaque.count > 0 && !fit.plaque.outside && fit.plaque.facing === fit.plaque.count,
    `${variant.file}: табличка с логотипом на торпедо (dash-logo) не найдена, выходит из-под лобового стекла или смотрит не наружу: ${JSON.stringify(fit.plaque)}`);
  for (const [q, d] of Object.entries(fit.drops)) {
    check(d.count >= (q === 'low' ? 40 : 90), `${variant.file}: капель «Антидождя» (${q}) ${d.count} — лобовое стекло не найдено или слишком мало места`);
    check(!d.below && !d.off && !d.rear, `${variant.file}: капли «Антидождя» (${q}) не на внешней стороне лобового стекла: ниже стекла ${d.below}, вне стекла ${d.off} вершин, на заднем стекле ${d.rear}`);
  }
  check(fit.triangles > 0 && fit.under > 0, `${variant.file}: не найдено стекло над кокпитом (материал glass)`);
  check(fit.min >= interior.GLASS_CLEARANCE - 1e-4, `${variant.file}: кокпит подходит к стеклу на ${(fit.min * 100).toFixed(1)} см (нужно не меньше ${interior.GLASS_CLEARANCE * 100} см) — торпедо видно сквозь лобовое стекло`);
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
// Эффекты: материал лака (wash, gloss), блик по детали (glow — путь света для ракурса
// работы), капли на лобовом стекле (rain — только в его ракурсе). Другие эффекты модель
// убедительно не показывает.
const FX = ['wash', 'gloss', 'glow', 'rain'];
for (const [id, fx] of Object.entries(views.SERVICE_FX)) {
  check(FX.includes(fx), `Неизвестный эффект ${fx} у работы ${id}: известны ${FX.join(', ')}`);
  const view = views.SERVICE_VIEWS[id];
  if (fx === 'glow') {
    const glow = views.GLOW?.[view];
    check(glow && glow.path?.length >= 2 && glow.path.every(p => p.length === 3 && p.every(Number.isFinite) && p[1] > 0.1)
      && glow.power > 0 && glow.power <= 20 && glow.reach > 0 && glow.reach <= 2,
      `Работа ${id}: блик (glow) без пути света для ракурса ${view} в GLOW, свет ниже пола или сила/дальность вне пределов`);
  }
  if (fx === 'rain') check(view === 'windscreen', `Работа ${id}: капли (rain) видны только в ракурсе лобового стекла, а у работы ${view}`);
}
for (const view of Object.keys(views.GLOW || {})) check(view in views.VIEWS, `GLOW: нет ракурса ${view}`);

const pad = (v, n) => String(v).padStart(n);
console.log('Размеры 3D-ресурсов, байт:');
console.log(`${'файл'.padEnd(46)}${pad('raw', 11)}${pad('gzip', 11)}${pad('brotli', 11)}`);
for (const [label, raw, gz, br] of rows) console.log(`${label.padEnd(46)}${pad(raw, 11)}${pad(gz, 11)}${pad(br, 11)}`);

console.log('Наименьший зазор кокпит — стекло: ' + clearances.join('; '));

assert.equal(failures.length, 0, failures.join('\n'));
console.log('PASS: бандл собран из src/porsche3d, модели совпадают с отчётом и укладываются в бюджет (Meshopt, WebP, без касательных), у всех работ гаража есть ракурс модели, эффекты известны (блик — с путём света, капли — на внешней стороне лобового стекла), кокпит не выходит за стёкла.');
