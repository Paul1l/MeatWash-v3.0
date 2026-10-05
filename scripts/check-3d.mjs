// Проверка 3D-гаража (npm run check:3d):
// - dist/js/porsche3d.bundle.js собран из текущего src/porsche3d;
// - модели в dist/assets/3d совпадают с отчётом optimize-3d (не правлены руками),
//   сжаты Meshopt, текстуры WebP не больше заданных размеров, без касательных;
// - у каждой работы «Гаража услуг» есть ракурс, эффекты — только у известных работ
//   и известного вида: блик (glow), очиститель дисков (iron) и бусины керамики (beads) —
//   с путём света для ракурса, капли (rain) — только в ракурсе лобового стекла и лежат
//   на внешней стороне стекла обеих моделей, бусины — только в ракурсе капота и лежат
//   на лаке капота (не ниже него) на обеих моделях;
// - дверь водителя — отдельный узел обеих моделей: петля у передней кромки, дверь
//   открывается наружу, обивка изнутри на месте, кокпит не держит у этого борта
//   неподвижной обивки в проёме; химчистка (cabin) — в ракурсе салона cabin, кожа
//   (leather) — сиденье крупно, ракурс seat; камеры обоих — снаружи открытой двери;
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
const beadsModule = await import(new URL('../src/porsche3d/beads.js', import.meta.url).href);
const doorModule = await import(new URL('../src/porsche3d/door.js', import.meta.url).href);
async function cockpitClearance(gltfDocument) {
  const car = new THREE.Group();
  for (const node of gltfDocument.getRoot().listNodes()) {
    const mesh = node.getMesh(); if (!mesh) continue;
    // Дверь — своей группой с именем узла, как её отдаёт GLTFLoader.
    const parent = node.getName() === doorModule.DOOR.name ? car.add(Object.assign(new THREE.Group(), {name: node.getName()})).children.at(-1) : car;
    const matrix = new THREE.Matrix4().fromArray(node.getWorldMatrix());
    for (const prim of mesh.listPrimitives()) {
      const name = prim.getMaterial()?.getName();
      if (name !== 'glass' && name !== 'paint') continue;
      const geometry = new THREE.BufferGeometry();
      // Позиции квантованы (KHR_mesh_quantization): getElement отдаёт их нормализованными.
      const position = prim.getAttribute('POSITION'), xyz = new Float32Array(position.getCount() * 3), el = [];
      for (let i = 0; i < position.getCount(); i++) xyz.set(position.getElement(i, el), i * 3);
      geometry.setAttribute('position', new THREE.BufferAttribute(xyz, 3));
      if (prim.getIndices()) geometry.setIndex(Array.from(prim.getIndices().getArray()));
      const part = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({name}));
      part.applyMatrix4(matrix); parent.add(part);
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
  // Бусины керамики (итог, без движения): на капоте и верху крыльев, ни одна вершина
  // не ниже лака под ней и не за краем лака.
  const beads = {};
  for (const low of [false, true]) {
    const set = beadsModule.buildBeads(car, {low});
    if (!set) { beads[low ? 'low' : 'high'] = {count: 0, below: 0, off: 0, away: 0}; continue; }
    set.update(0, true);
    const position = set.mesh.geometry.attributes.position;
    let below = 0, off = 0;
    for (let i = 0; i < position.count; i++) {
      const y = set.surface(position.getX(i), position.getZ(i));
      if (y == null) off++; else if (position.getY(i) < y - 1e-4) below++;
    }
    const away = set.sample().filter(b => b.z < -2.0 || b.z > -0.8 || Math.abs(b.x) > 0.65 || b.y < 0.45).length;
    beads[low ? 'low' : 'high'] = {count: set.count, below, off, away};
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
  // Дверь водителя: петля у передней кромки, открытая дверь уходит задней кромкой наружу,
  // обивка — с внутренней стороны в пределах двери; у этого борта в проёме нет
  // неподвижной обивки кокпита (выше пола и ниже пояса, левее −0,63 м).
  const bounds = doorModule.doorBounds(car);
  let door = null;
  if (bounds) {
    const [z0, z1] = bounds.z, [y0, y1] = bounds.y;
    let blocking = 0;
    built.group.traverse(o => {
      if (!o.isMesh) return;
      const position = o.geometry.attributes.position;
      for (let i = 0; i < position.count; i++) {
        v.fromBufferAttribute(position, i).applyMatrix4(o.matrixWorld);
        if (v.x < -0.63 && v.z > z0 + 0.02 && v.z < z1 - 0.02 && v.y > y0 + 0.1 && v.y < y1 - 0.05) blocking++;
      }
    });
    const built2 = doorModule.buildDoor(car, built.materials);
    const card = built2?.pivot.getObjectByName('door-card');
    let cardOut = 0, cardCount = 0;
    card?.updateMatrixWorld(true);
    card?.traverse(o => {
      if (!o.isMesh) return;
      const position = o.geometry.attributes.position;
      for (let i = 0; i < position.count; i++, cardCount++) {
        v.fromBufferAttribute(position, i).applyMatrix4(o.matrixWorld);
        if (v.z < z0 - 0.01 || v.z > z1 + 0.01 || v.y < y0 - 0.01 || v.y > y1 + 0.01 || v.x < bounds.outer - 0.01 || v.x > bounds.inner + 0.1) cardOut++;
      }
    });
    // Задняя кромка у пояса: закрыта и открыта.
    const rear = new THREE.Vector3((bounds.inner + bounds.outer) / 2, (y0 + y1) / 2, z1);
    const local = built2 ? built2.pivot.worldToLocal(rear.clone()) : null;
    built2?.set(1);
    built2?.pivot.updateMatrixWorld(true);
    const open = local ? built2.pivot.localToWorld(local.clone()) : null;
    door = {length: z1 - z0, height: y1 - y0, hinge: bounds.hinge, z0, outer: bounds.outer, inner: bounds.inner,
      cardMeshes: card?.children.length ?? 0, cardCount, cardOut, blocking, rearOpen: open ? [open.x, open.z] : null};
  }
  built.dispose();
  return {min, under, fitted: built.fitted, triangles: glass?.triangles || 0, drops, beads, plaque, door};
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
  clearances.push(`${name}: ${(fit.min * 100).toFixed(1)} см (вершин под стёклами ${fit.under}, подогнано ${fit.fitted}); капель ${fit.drops.high.count} / телефон ${fit.drops.low.count}; бусин ${fit.beads.high.count} / телефон ${fit.beads.low.count}; табличка на торпедо — ${fit.plaque?.count ?? 0} вершин; дверь ${fit.door ? (fit.door.length * 100).toFixed(0) + ' см, задняя кромка открытой — x ' + fit.door.rearOpen?.[0].toFixed(2) : 'нет'}`);
  check(fit.plaque && fit.plaque.count > 0 && !fit.plaque.outside && fit.plaque.facing === fit.plaque.count,
    `${variant.file}: табличка с логотипом на торпедо (dash-logo) не найдена, выходит из-под лобового стекла или смотрит не наружу: ${JSON.stringify(fit.plaque)}`);
  for (const [q, d] of Object.entries(fit.drops)) {
    check(d.count >= (q === 'low' ? 40 : 90), `${variant.file}: капель «Антидождя» (${q}) ${d.count} — лобовое стекло не найдено или слишком мало места`);
    check(!d.below && !d.off && !d.rear, `${variant.file}: капли «Антидождя» (${q}) не на внешней стороне лобового стекла: ниже стекла ${d.below}, вне стекла ${d.off} вершин, на заднем стекле ${d.rear}`);
  }
  for (const [q, b] of Object.entries(fit.beads)) {
    check(b.count >= (q === 'low' ? 80 : 150), `${variant.file}: бусин керамики (${q}) ${b.count} — лак капота не найден или слишком мало места`);
    check(!b.below && !b.off && !b.away, `${variant.file}: бусины керамики (${q}) не на лаке капота: ниже лака ${b.below}, вне лака ${b.off} вершин, вне капота ${b.away}`);
  }
  const d = fit.door;
  check(d, `${variant.file}: нет двери водителя (узел ${doorModule.DOOR.name}) — npm run optimize-3d`);
  if (d) {
    check(d.length > 1.0 && d.length < 1.35 && d.height > 0.45 && d.height < 0.7 && d.inner > d.outer,
      `${variant.file}: размеры двери странные: ${JSON.stringify(d)}`);
    check(Math.abs(d.hinge[1] - d.z0) < 0.06 && d.hinge[0] < d.inner, `${variant.file}: петля двери не у передней кромки: ${JSON.stringify(d.hinge)}`);
    check(d.rearOpen && d.rearOpen[0] < d.outer - 0.6, `${variant.file}: открытая дверь не уходит наружу: задняя кромка ${JSON.stringify(d.rearOpen)}`);
    check(d.cardMeshes >= 5 && d.cardCount > 0 && !d.cardOut, `${variant.file}: обивка двери не построена или выходит за дверь: ${JSON.stringify(d)}`);
    check(!d.blocking, `${variant.file}: в проёме двери водителя осталась неподвижная обивка кокпита (${d.blocking} вершин)`);
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
// 190 КБ: с дверью и химчисткой салона (3 октября 2026) бандл — 181 КБ; дверь и грязь
// готовы к первому кадру, отдельным файлом их не вынести без сборки шейдеров при показе.
check(gzipSync(bundle, {level: 9}).length <= 190e3, 'Бандл больше 190 КБ в gzip');

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
// Эффекты: пена мойки и полировка в материалах (wash, gloss), блик по детали (glow —
// путь света для ракурса работы), очиститель дисков (iron — в ракурсе колеса, в конце
// блик по ободу), бусины керамики (beads — в ракурсе капота, с бликом), капли на лобовом
// стекле (rain — только в его ракурсе), химчистка (cabin — весь салон через открытую
// дверь) и кондиционер кожи (leather — сиденье крупно, ракурс seat), обе с бликом по
// сиденью, полировка фар (lens — мутное жёлтое стекло становится прозрачным) и плёнка на
// фары (tint — тонировка), обе в ракурсе фары с бликом. Другие эффекты модель
// убедительно не показывает.
const FX = ['wash', 'gloss', 'glow', 'rain', 'iron', 'beads', 'cabin', 'leather', 'lens', 'tint'];
const FX_VIEW = {rain: 'windscreen', iron: 'wheel', beads: 'hood', cabin: 'cabin', leather: 'seat', lens: 'headlight', tint: 'headlight'};
for (const [id, fx] of Object.entries(views.SERVICE_FX)) {
  check(FX.includes(fx), `Неизвестный эффект ${fx} у работы ${id}: известны ${FX.join(', ')}`);
  const view = views.SERVICE_VIEWS[id];
  if (['glow', 'iron', 'beads', 'cabin', 'leather', 'lens', 'tint'].includes(fx)) {
    const glow = views.GLOW?.[view];
    check(glow && glow.path?.length >= 2 && glow.path.every(p => p.length === 3 && p.every(Number.isFinite) && p[1] > 0.1)
      && glow.power > 0 && glow.power <= 20 && glow.reach > 0 && glow.reach <= 2,
      `Работа ${id}: блик (glow) без пути света для ракурса ${view} в GLOW, свет ниже пола или сила/дальность вне пределов`);
  }
  if (FX_VIEW[fx]) check(view === FX_VIEW[fx], `Работа ${id}: эффект ${fx} виден только в ракурсе ${FX_VIEW[fx]}, а у работы ${view}`);
}
for (const view of Object.keys(views.GLOW || {})) check(view in views.VIEWS, `GLOW: нет ракурса ${view}`);
// Салон и сиденье смотрят снаружи, через проём открытой двери водителя (левый борт).
for (const name of ['cabin', 'seat']) {
  const c = views.VIEWS[name];
  check(c && c.p[0] < -1.2 && Math.abs(c.t[0]) < 0.6 && c.t[1] > 0.4 && c.t[1] < 1.0, `Ракурс ${name}: камера должна стоять снаружи у левого борта и смотреть в салон`);
}

const pad = (v, n) => String(v).padStart(n);
console.log('Размеры 3D-ресурсов, байт:');
console.log(`${'файл'.padEnd(46)}${pad('raw', 11)}${pad('gzip', 11)}${pad('brotli', 11)}`);
for (const [label, raw, gz, br] of rows) console.log(`${label.padEnd(46)}${pad(raw, 11)}${pad(gz, 11)}${pad(br, 11)}`);

console.log('Наименьший зазор кокпит — стекло: ' + clearances.join('; '));

assert.equal(failures.length, 0, failures.join('\n'));
console.log('PASS: бандл собран из src/porsche3d, модели совпадают с отчётом и укладываются в бюджет (Meshopt, WebP, без касательных), у всех работ гаража есть ракурс модели, эффекты известны (блик — с путём света, капли — на внешней стороне лобового стекла, бусины — на лаке капота, химчистка и кожа — в салоне через открытую дверь), дверь водителя на петле открывается наружу с обивкой изнутри, кокпит не выходит за стёкла.');
