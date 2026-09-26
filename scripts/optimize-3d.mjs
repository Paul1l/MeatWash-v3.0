// Готовит модели Porsche для 3D-режима «Оживить Porsche» из исходника
// source/3d/porsche-930.glb (Karol Miklas, CC BY 4.0 — см. credits.html).
//
// Выход: dist/assets/3d/porsche-930-desktop.glb и porsche-930-mobile.glb,
// отчёт — source/3d/optimize-report.json.
// Страница их не запрашивает: модель грузит модуль porsche3d только после
// нажатия «Оживить Porsche».
//
// Что делается и почему:
// - убираются невидимые и лишние части: второй слой кузова «coat» (копия
//   оболочки для прежнего лака, 43 тыс. треугольников), плоскость пола,
//   ароматизатор в салоне, антенна и номерные знаки с рамками (в кадрах v2
//   их нет). Решётка на крышке двигателя (Object_103, 33 тыс.) остаётся:
//   без неё в спойлере видна дыра;
// - убираются касательные (TANGENT): three строит базис для карт нормалей сам,
//   а лак — без карты нормалей; это ~2,5 МБ несжатых данных;
// - карта нормалей дисков плоская (разброс 1/255) — отключается;
// - текстуры уменьшаются по назначению (диски и шины крупнее, наклейки и хром
//   мельче) и кодируются в WebP: декодер встроен в браузер, KTX2/Basis
//   потребовал бы ~0,5 МБ транскодера на WASM;
// - геометрия сжимается Meshopt (EXT_meshopt_compression + квантование):
//   декодер ~20 КБ JS против ~300 КБ WASM у Draco при близком размере после gzip;
// - одинаковые материалы сливаются в один меш — меньше вызовов отрисовки;
// - для телефона — упрощение мелких деталей и текстуры вдвое меньше.
//
// Модель на выходе — в метрах: длина 4,29 м (как у 930 Turbo), низ шин на y=0,
// центр по x/z в нуле, перед смотрит в −Z, левый борт — в −X.
//
// Запуск: npm run optimize-3d
import {mkdir, readFile, readdir, rename, rm, stat, writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
import {NodeIO, Logger} from '@gltf-transform/core';
import {ALL_EXTENSIONS} from '@gltf-transform/extensions';
import {prune, dedup, weld, flatten, join, meshopt, simplifyPrimitive, getBounds, transformMesh} from '@gltf-transform/functions';
import {MeshoptEncoder, MeshoptDecoder, MeshoptSimplifier} from 'meshoptimizer';
import sharp from 'sharp';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE = resolve(root, 'source/3d/porsche-930.glb');
const OUT = resolve(root, 'dist/assets/3d');

// Узлы исходника, которые не нужны. Имена проверяются: если исходник
// заменят, скрипт упадёт, а не выкинет молча что-то другое.
const REMOVE = {
  Object_32: 'coat: копия оболочки кузова вторым слоем',
  Object_49: 'антенна на переднем крыле — на кадрах v2 её нет',
  Object_140: 'плоскость пола из исходной сцены',
  Object_122: 'ароматизатор в салоне',
  Object_6: 'передний номерной знак',
  Object_80: 'задний номерной знак',
  Object_5: 'наклейка на рамке переднего номера',
  Object_79: 'наклейка на рамке заднего номера',
  Object_4: 'рамка переднего номера',
  Object_78: 'рамка заднего номера',
};

// Наибольшая сторона текстуры по материалам: [компьютер, телефон].
const TEXTURE_SIZE = {
  '930_rim': [1024, 512],
  '930_tire': [1024, 512],
  '930_lights': [1024, 512],
  '930_plastics': [1024, 512],
  paint: [1024, 512],
  '930_chromes': [512, 256],
  '930_stickers': [512, 256],
};
const DEFAULT_SIZE = [512, 256];

// Телефон: какие материалы упрощать и до какой доли треугольников.
// Лак и стёкла не трогаем — на них держатся силуэт и отражения.
const MOBILE_SIMPLIFY = {
  '930_plastics': 0.5,
  '930_rim': 0.5,
  '930_chromes': 0.5,
  '930_tire': 0.6,
  '930_lights': 0.6,
  black: 0.5,
};

const LENGTH_M = 4.29;

const VARIANTS = [
  {name: 'desktop', size: 0, simplify: null},
  {name: 'mobile', size: 1, simplify: MOBILE_SIMPLIFY},
];

await Promise.all([MeshoptEncoder.ready, MeshoptDecoder.ready, MeshoptSimplifier.ready]);
const io = new NodeIO().setLogger(new Logger(Logger.Verbosity.WARN)).registerExtensions(ALL_EXTENSIONS).registerDependencies({
  'meshopt.encoder': MeshoptEncoder,
  'meshopt.decoder': MeshoptDecoder,
});

// Произведение матриц 4×4 по столбцам (как в glTF): a·b.
function multiply(a, b) {
  const out = new Array(16).fill(0);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) out[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k];
  return out;
}

function stats(document) {
  let triangles = 0, vertices = 0;
  for (const mesh of document.getRoot().listMeshes()) for (const prim of mesh.listPrimitives()) {
    const count = prim.getAttribute('POSITION').getCount();
    vertices += count;
    triangles += (prim.getIndices() ? prim.getIndices().getCount() : count) / 3;
  }
  return {triangles, vertices, meshes: document.getRoot().listMeshes().length, materials: document.getRoot().listMaterials().length, textures: document.getRoot().listTextures().length};
}

async function build(variant) {
  const document = await io.read(SOURCE);
  const docRoot = document.getRoot();
  const scene = docRoot.listScenes()[0];
  const before = stats(document);

  for (const [name, why] of Object.entries(REMOVE)) {
    const node = docRoot.listNodes().find(n => n.getName() === name);
    assert(node && node.getMesh(), `В исходнике нет узла ${name} (${why})`);
    node.dispose();
  }
  for (const mesh of docRoot.listMeshes()) for (const prim of mesh.listPrimitives()) prim.setAttribute('TANGENT', null);
  const rim = docRoot.listMaterials().find(m => m.getName() === '930_rim');
  rim.setNormalTexture(null);
  // Колпачок вентиля в текстуре диска ярко-зелёный (заглушка автора) — перекрашиваем в тёмный.
  const rimMap = rim.getBaseColorTexture();
  if (rimMap) {
    const {data, info} = await sharp(rimMap.getImage()).ensureAlpha().raw().toBuffer({resolveWithObject: true});
    let painted = 0;
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i], g = data[i + 1], b = data[i + 2];
      if (g > 90 && g > r * 1.35 && g > b * 1.35) { data[i] = 10; data[i + 1] = 8; data[i + 2] = 7; painted++; }
    }
    assert(painted < info.width * info.height * 0.02, 'Перекрашено слишком много пикселей диска');
    rimMap.setImage(await sharp(data, {raw: {width: info.width, height: info.height, channels: 4}}).png().toBuffer()).setMimeType('image/png');
  }

  // Все узлы — прямые дети сцены с мировыми матрицами, затем общий меш на материал.
  await document.transform(prune(), dedup(), flatten(), weld(), join({keepNamed: false}), prune());

  if (variant.simplify) {
    for (const mesh of docRoot.listMeshes()) for (const prim of mesh.listPrimitives()) {
      const ratio = variant.simplify[prim.getMaterial()?.getName()];
      if (ratio) simplifyPrimitive(prim, {simplifier: MeshoptSimplifier, ratio, error: 0.0008, lockBorder: true});
    }
    await document.transform(prune());
  }

  // Координаты в метрах: длина 4,29 м, низ шин на нуле, центр по x/z в нуле.
  // В исходнике перед смотрит в +Z — разворачиваем на 180° вокруг Y.
  // Преобразование запекается в вершины: узел с поворотом и масштабом
  // при квантовании сдвигал низ шин на сантиметр.
  const bounds = getBounds(scene);
  const scale = LENGTH_M / (bounds.max[2] - bounds.min[2]);
  const cx = (bounds.min[0] + bounds.max[0]) / 2, cz = (bounds.min[2] + bounds.max[2]) / 2;
  // Столбцы матрицы: x → −x·s, y → y·s, z → −z·s, затем сдвиг.
  const pivot = [-scale, 0, 0, 0, 0, scale, 0, 0, 0, 0, -scale, 0, scale * cx, -scale * bounds.min[1], scale * cz, 1];
  for (const node of scene.listChildren()) {
    assert.equal(node.listChildren().length, 0, 'После flatten узлы должны быть плоскими');
    const mesh = node.getMesh();
    if (mesh) {
      assert.equal(mesh.listParents().filter(p => p.propertyType === 'Node').length, 1, 'Меш используется дважды');
      transformMesh(mesh, multiply(pivot, node.getMatrix()));
    }
    node.setMatrix([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
  }

  // Текстуры: размер — наибольший из тех, что нужны материалам-владельцам.
  for (const texture of docRoot.listTextures()) {
    const owners = texture.listParents().filter(p => p.propertyType === 'Material');
    const maxSide = Math.max(...owners.map(m => (TEXTURE_SIZE[m.getName()] || DEFAULT_SIZE)[variant.size]));
    const isNormal = owners.some(m => m.getNormalTexture() === texture);
    const isColor = owners.some(m => m.getBaseColorTexture() === texture);
    const image = sharp(texture.getImage()).resize(maxSide, maxSide, {fit: 'inside', withoutEnlargement: true, kernel: 'lanczos3'});
    // Карты нормалей: sharpYuv меньше портит направление; альфа фар — 60, она
    // задаёт только прозрачность стекла фары.
    const webp = isNormal ? {quality: 88, smartSubsample: true, effort: 6}
      : isColor ? {quality: 85, alphaQuality: 60, effort: 6}
      : {quality: 85, effort: 6};
    texture.setImage(await image.webp(webp).toBuffer()).setMimeType('image/webp');
  }

  await document.transform(meshopt({
    encoder: MeshoptEncoder,
    level: 'high',
    quantizationVolume: 'scene',
    quantizePosition: 14,
    quantizeTexcoord: 12,
  }));
  document.createExtension(ALL_EXTENSIONS.find(e => e.EXTENSION_NAME === 'EXT_meshopt_compression')).setRequired(true);

  const file = resolve(OUT, `porsche-930-${variant.name}.tmp.glb`);
  await io.write(file, document);
  return {file, before, after: stats(document), bytes: (await stat(file)).size};
}

// Проверка результата: декодируем обратно и сверяем с исходником — границы,
// направление нормалей (ни одна не вывернута), отсутствие NaN.
async function verify(result) {
  const document = await io.read(result.file);
  const docRoot = document.getRoot();
  const bounds = getBounds(docRoot.listScenes()[0]);
  const length = bounds.max[2] - bounds.min[2];
  assert(Math.abs(length - LENGTH_M) < 0.01, `Длина ${length}`);
  assert(Math.abs(bounds.min[1]) < 0.005, `Низ шин ${bounds.min[1]}`);
  assert(Math.abs(bounds.min[0] + bounds.max[0]) < 0.02, 'Модель не по центру по x');
  const names = docRoot.listMaterials().map(m => m.getName());
  // Перед — в −Z: стёкла фар (930_lights_refraction) должны быть у переднего края.
  const lensNode = docRoot.listNodes().find(n => n.getMesh()?.listPrimitives().some(p => p.getMaterial()?.getName() === '930_lights_refraction'));
  assert(getBounds(lensNode).max[2] < -LENGTH_M * 0.35, 'Перед модели смотрит не в −Z');
  for (const needed of ['paint', 'glass', '930_rim', '930_tire', '930_chromes', '930_lights']) assert(names.includes(needed), 'Нет материала ' + needed);
  for (const mesh of docRoot.listMeshes()) for (const prim of mesh.listPrimitives()) {
    assert(!prim.getAttribute('TANGENT'), 'Остались касательные');
    const pos = prim.getAttribute('POSITION'), nor = prim.getAttribute('NORMAL');
    assert(nor, 'Нет нормалей у ' + prim.getMaterial()?.getName());
    const n = [0, 0, 0], p = [0, 0, 0];
    for (let i = 0; i < pos.getCount(); i++) {
      pos.getElement(i, p); nor.getElement(i, n);
      assert(p.every(Number.isFinite) && n.every(Number.isFinite), 'NaN в вершинах');
      const len = Math.hypot(...n);
      assert(len > 0.9 && len < 1.1, `Нормаль длины ${len}`);
    }
  }
  return {length, bounds};
}

await mkdir(OUT, {recursive: true});
const sourceBytes = (await stat(SOURCE)).size;
const report = {source: {file: 'source/3d/porsche-930.glb', bytes: sourceBytes}, variants: {}};
for (const variant of VARIANTS) {
  const result = await build(variant);
  await verify(result);
  // Имя с хешем содержимого: новая модель — новый адрес, старая из кэша
  // браузера или хостинга не подхватится.
  const sha256 = createHash('sha256').update(await readFile(result.file)).digest('hex');
  const name = `porsche-930-${variant.name}.${sha256.slice(0, 10)}.glb`;
  for (const old of await readdir(OUT)) if (old.startsWith(`porsche-930-${variant.name}.`) && old.endsWith('.glb') && old !== name && !old.endsWith('.tmp.glb')) await rm(resolve(OUT, old));
  await rename(result.file, resolve(OUT, name));
  report.variants[variant.name] = {file: `assets/3d/${name}`, bytes: result.bytes, sha256, before: result.before, after: result.after};
  console.log(`${variant.name}: ${sourceBytes} → ${result.bytes} байт; треугольников ${result.before.triangles} → ${result.after.triangles}; мешей ${result.before.meshes} → ${result.after.meshes}; текстур ${result.before.textures} → ${result.after.textures}`);
}
// Отчёт лежит рядом с исходником, а не в dist: странице он не нужен,
// его читает npm run check:3d.
await writeFile(resolve(root, 'source/3d/optimize-report.json'), JSON.stringify({
  title: 'FREE 1975 Porsche 911 (930) Turbo',
  author: 'Karol Miklas / Lionsharp Studios',
  source: 'https://sketchfab.com/3d-models/free-1975-porsche-911-930-turbo-8568d9d14a994b9cae59499f0dbed21e',
  license: 'CC-BY-4.0',
  changes: 'Удалены второй слой кузова, пол, ароматизатор, антенна, номерные знаки с рамками; касательные; текстуры уменьшены и сжаты в WebP; геометрия сжата Meshopt; для телефона упрощены мелкие детали.',
  units: 'метры; низ шин y=0; перед −Z; левый борт −X',
  ...report,
}, null, 2) + '\n');
// Манифест для модуля: адрес и размер каждой модели. Размер нужен для честного
// процента загрузки — даже если хостинг отдаёт файл сжатым.
await writeFile(resolve(root, 'src/porsche3d/models.js'), `// Создаётся npm run optimize-3d — руками не править.
// high — компьютер, low — телефон; bytes — размер файла для процента загрузки.
export const MODELS = ${JSON.stringify({
  high: {file: report.variants.desktop.file, bytes: report.variants.desktop.bytes},
  low: {file: report.variants.mobile.file, bytes: report.variants.mobile.bytes},
}, null, 2)};
`);
console.log('Манифест: src/porsche3d/models.js. Пересоберите бандл: npm run bundle-3d.');
