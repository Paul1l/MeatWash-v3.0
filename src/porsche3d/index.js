// 3D-гараж услуг. Модуль грузится только динамическим import() по нажатию
// «Открыть 3D-гараж»: страница не ссылается на него ни статически, ни через
// preload/prefetch. Собирается в dist/js/porsche3d.bundle.js (npm run bundle-3d),
// three, GLTFLoader и декодер Meshopt — внутри бандла.
//
//   const {mount} = await import('./porsche3d.bundle.js');
//   const scene = await mount({container, signal, onProgress, onPhase, onError});
//   scene.showService('wheels'); scene.reset(); scene.zoomBy(0.9); scene.dispose();
//
// Сцена живёт в модальном окне: страница за ним неподвижна, поэтому жесты
// принадлежат сцене целиком — у canvas touch-action: none. Поворот — мышью
// или пальцем по обеим осям, приближение — колесом, щипком или zoomBy()
// в ограниченных пределах; ракурсы работ — программно.
import {
  ACESFilmicToneMapping, CatmullRomCurve3, Color, MathUtils, MeshPhysicalMaterial,
  PerspectiveCamera, Scene, SRGBColorSpace, Vector3, WebGLRenderer,
} from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {MeshoptDecoder} from 'three/addons/libs/meshopt_decoder.module.js';
import {buildEnvironment, buildRoom, loadLogo, LOGO} from './room.js';
import {buildInterior} from './interior.js';
import {buildDrops, DROPS} from './drops.js';
import {VIEWS, SERVICE_VIEWS, SERVICE_FX, GLOW, REF_ASPECT} from './views.js';
import {MODELS} from './models.js';

export {VIEWS, SERVICE_VIEWS, MODELS};

// Одна сцена на страницу: повторный mount закрывает предыдущую.
let active = null;
// Скачанная модель остаётся в памяти модуля (1–2 МБ): повторное открытие
// гаража не ходит в сеть. Видеопамять при закрытии освобождается (dispose).
const modelCache = new Map();

export class Porsche3DError extends Error {
  constructor(code, message, cause) { super(message, {cause}); this.name = 'Porsche3DError'; this.code = code; }
}

const abortError = () => new DOMException('Загрузка 3D отменена', 'AbortError');

// Выбор качества, если страница его не передала: сенсорный экран без мыши
// (телефон, планшет), мало памяти или Save-Data — облегчённая модель.
export function pickQuality() {
  const coarse = matchMedia('(pointer: coarse)').matches && !matchMedia('(any-pointer: fine)').matches;
  // Узкое окно с мышью — не телефон: модель для компьютера. Chrome округляет
  // память вниз (6 ГБ → 4), поэтому слабым считаем только ≤ 2 ГБ.
  const weak = (navigator.deviceMemory && navigator.deviceMemory < 4) || navigator.connection?.saveData;
  return coarse || weak ? 'low' : 'high';
}

// Загрузка модели с честным прогрессом. Итог известен из манифеста сборки
// (models.js): поток ответа отдаёт распакованные байты, поэтому процент верен
// и при сжатии на хостинге. Для чужого адреса — Content-Length без сжатия.
// stall мс без новых байт — ошибка timeout.
async function fetchModel(url, known, signal, onProgress, stall) {
  if (modelCache.has(url)) {
    const buffer = modelCache.get(url);
    onProgress?.({loaded: buffer.byteLength, total: buffer.byteLength, ratio: 1, cached: true});
    return buffer;
  }
  const request = new AbortController();
  const forward = () => request.abort();
  signal.addEventListener('abort', forward, {once: true});
  let timer = 0, stalled = false;
  const arm = () => { clearTimeout(timer); timer = setTimeout(() => { stalled = true; request.abort(); }, stall); };
  try {
    arm();
    const response = await fetch(url, {signal: request.signal});
    if (!response.ok) throw new Porsche3DError('load', `Модель не загрузилась: HTTP ${response.status}`);
    const encoding = (response.headers.get('content-encoding') || 'identity').toLowerCase();
    const declared = Number(response.headers.get('content-length')) || 0;
    const total = known || (encoding === 'identity' && declared > 0 ? declared : null);
    const reader = response.body.getReader();
    const chunks = []; let loaded = 0;
    for (;;) {
      arm();
      const {done, value} = await reader.read();
      if (done) break;
      chunks.push(value); loaded += value.byteLength;
      onProgress?.({loaded, total, ratio: total ? Math.min(1, loaded / total) : null});
    }
    const out = new Uint8Array(loaded); let offset = 0;
    for (const chunk of chunks) { out.set(chunk, offset); offset += chunk.byteLength; }
    modelCache.clear();
    modelCache.set(url, out.buffer);
    return out.buffer;
  } catch (error) {
    if (stalled) throw new Porsche3DError('timeout', `Модель не приходит ${Math.round(stall / 1000)} с`, error);
    if (signal.aborted) throw abortError();
    throw error;
  } finally {
    clearTimeout(timer);
    signal.removeEventListener('abort', forward);
  }
}

// Освобождает геометрии, материалы и текстуры объекта (и лишние материалы).
function release(root, extra = []) {
  const geometries = new Set(), materials = new Set(extra), textures = new Set();
  root.traverse(o => {
    if (o.geometry) geometries.add(o.geometry);
    for (const m of [].concat(o.material || [])) materials.add(m);
  });
  for (const m of materials) for (const value of Object.values(m)) if (value?.isTexture) textures.add(value);
  textures.forEach(t => { t.dispose(); t.image?.close?.(); });
  materials.forEach(m => m.dispose());
  geometries.forEach(g => g.dispose());
}

function webglAvailable() {
  try {
    const probe = document.createElement('canvas');
    // three r163+ работает только с WebGL 2.
    const gl = probe.getContext('webgl2');
    gl?.getExtension('WEBGL_lose_context')?.loseContext();
    return !!gl;
  } catch { return false; }
}

// Отдать главный поток странице между тяжёлыми шагами загрузки.
const pause = () => new Promise(resolve => (globalThis.scheduler?.yield ? scheduler.yield().then(resolve) : setTimeout(resolve, 0)));
const easeInOut = t => t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
const smoothRange = (v, a, b) => { const x = MathUtils.clamp((v - a) / (b - a), 0, 1); return x * x * (3 - 2 * x); };

// Лак с состояниями работ: uClean — пыль и разводы (0 — пыльная машина,
// 1 — чистая), uFinish — риски полировки (0 — «паутинка», 1 — ровное
// отражение). Грязь гуще внизу кузова и пятнами; на грязи верхний слой лака
// почти не блестит. Координаты — мировые, в метрах.
const PAINT_VERTEX = [
  ['#include <common>', '#include <common>\nvarying vec3 vSurface;\nvarying float vUp;'],
  ['#include <begin_vertex>', '#include <begin_vertex>\nvSurface = (modelMatrix * vec4(transformed, 1.0)).xyz;\nvUp = normalize(mat3(modelMatrix) * objectNormal).y;'],
];
const PAINT_FRAGMENT = [
  ['#include <common>', `#include <common>
uniform float uClean;
uniform float uFinish;
varying vec3 vSurface;
varying float vUp;
float mwHash(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
float mwNoise(vec3 p) {
  vec3 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(mwHash(i), mwHash(i + vec3(1, 0, 0)), f.x), mix(mwHash(i + vec3(0, 1, 0)), mwHash(i + vec3(1, 1, 0)), f.x), f.y),
             mix(mix(mwHash(i + vec3(0, 0, 1)), mwHash(i + vec3(1, 0, 1)), f.x), mix(mwHash(i + vec3(0, 1, 1)), mwHash(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}`],
  ['#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
// Шум и кольца считаем, только когда они видны: на чистом отполированном
// лаке (почти всё время) пиксель обходится без них — крупные планы дешевле.
if (uFinish < 0.999) {
  float mwRings = pow(max(0.0, sin(length(vSurface.xz * 1.7 - vec2(0.2, 0.9)) * 1650.0)), 24.0);
  roughnessFactor = clamp(roughnessFactor + (1.0 - uFinish) * (0.18 + 0.13 * mwRings), 0.035, 1.0);
}
float mwSpots = uClean < 0.999 ? mwNoise(vSurface * 7.0) * 0.6 + mwNoise(vSurface * 31.0) * 0.4 : 0.0;
// Сверху (капот, крыша) грязи нет: даже немного серого в линейном цвете
// делает насыщенный бордо розовым. Пыль — на вертикальных бортах снизу и сзади.
float mwDirt = (1.0 - smoothstep(0.35, 0.7, vUp)) * (1.0 - uClean) * clamp(smoothstep(0.72, 0.28, vSurface.y) + max(vSurface.z, 0.0) * 0.12 * smoothstep(0.95, 0.6, vSurface.y), 0.0, 1.0) * (0.5 + 0.8 * mwSpots);
mwDirt = clamp(mwDirt, 0.0, 1.0);
diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.2, 0.18, 0.16), mwDirt * 0.7);
roughnessFactor = mix(roughnessFactor, 0.62, mwDirt);`],
  ['#include <lights_physical_fragment>', `#include <lights_physical_fragment>
material.clearcoat *= 1.0 - mwDirt * 0.8;
material.clearcoatRoughness = mix(material.clearcoatRoughness, 0.45, mwDirt);`],
];
const DEG = Math.PI / 180;

// Материалы в духе клуба: глубокий бордовый лак с прозрачным верхним слоем,
// тонированные стёкла без преломления (transmission — лишний проход рендера).
function restyle(car, {anisotropy}) {
  const replaced = [];
  const paint = new MeshPhysicalMaterial({
    name: 'meatwash-oxblood', color: new Color('#4a0911'), metalness: 0.1, roughness: 0.24,
    clearcoat: 1, clearcoatRoughness: 0.03, envMapIntensity: 1.25,
  });
  const glass = new MeshPhysicalMaterial({
    name: 'meatwash-glass', color: new Color('#1b1512'), metalness: 0, roughness: 0.03,
    transparent: true, opacity: 0.55, envMapIntensity: 1.1, depthWrite: false,
  });
  const lens = new MeshPhysicalMaterial({
    name: 'meatwash-lens', color: new Color('#ffffff'), metalness: 0, roughness: 0.04,
    transparent: true, opacity: 0.12, envMapIntensity: 1.3, depthWrite: false, clearcoat: 1,
  });
  const fx = {clean: {value: 0}, finish: {value: 1}};
  paint.onBeforeCompile = shader => {
    shader.uniforms.uClean = fx.clean; shader.uniforms.uFinish = fx.finish;
    for (const [a, b] of PAINT_VERTEX) shader.vertexShader = shader.vertexShader.replace(a, b);
    for (const [a, b] of PAINT_FRAGMENT) shader.fragmentShader = shader.fragmentShader.replace(a, b);
  };
  paint.customProgramCacheKey = () => 'meatwash-paint-v3';
  let paintMesh = null;
  car.traverse(o => {
    if (!o.isMesh) return;
    const m = o.material;
    if (m.map) m.map.anisotropy = anisotropy;
    if (m.name === 'paint') paintMesh = o;
    switch (m.name) {
      case 'paint':
        paint.aoMap = m.aoMap; paint.aoMapIntensity = 0.5;
        o.material = paint; replaced.push(m); break;
      case 'glass': o.material = glass; o.renderOrder = 2; replaced.push(m); break;
      case '930_lights_refraction': o.material = lens; o.renderOrder = 2; replaced.push(m); break;
      case 'black': m.color.set('#0a0807'); m.roughness = 0.75; m.metalness = 0; break;
      case '930_lights': m.color.setScalar(1.6); m.roughness = 0.1; m.metalness = 1; m.envMapIntensity = 2.6; break;
      case '930_chromes': m.roughness = 0.35; m.metalness = 1; m.envMapIntensity = 1.2; break;
      case '930_rim': m.envMapIntensity = 1.15; break;
      case '930_tire': m.color.set('#6f655c'); m.metalness = 0; break;
      case '930_plastics': m.color.set('#6b625a'); break;
    }
  });
  return {paint, glass, fx, paintMesh, replaced};
}

export async function mount({
  container,
  signal,
  quality = 'auto',
  reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches,
  startView = 'overview',
  fadeIn = true,
  interactive = true,
  stallTimeout = 15000,
  model,
  baseUrl = new URL('../', import.meta.url).href,
  onProgress,
  onPhase,
  onFirstFrame,
  onError,
  onViewChange,
  onInteract,
} = {}) {
  if (!container) throw new TypeError('mount: нужен container');
  if (signal?.aborted) throw abortError();
  active?.dispose();
  if (!webglAvailable()) throw new Porsche3DError('webgl', 'WebGL недоступен на этом устройстве');
  if (!VIEWS[startView]) throw new Porsche3DError('view', `Нет ракурса ${startView}`);

  const level = quality === 'auto' ? pickQuality() : quality === 'low' ? 'low' : 'high';
  const low = level === 'low';
  // Замеры этапов (мс от вызова mount) — для проверки скорости, см. stats().
  const started = performance.now(), timings = {};
  const mark = name => { timings[name] = Math.round(performance.now() - started); };
  const listeners = new AbortController(), on = {signal: listeners.signal};
  // Своя отмена: срабатывает и от signal страницы, и от dispose() — например,
  // когда повторный mount закрывает незаконченную загрузку.
  const loading = new AbortController();
  // Обещание, которое выполняется при отмене: разбор и компиляцию после
  // dispose() не ждём — они могут не завершиться вовсе.
  const cancelled = new Promise(resolve => loading.signal.addEventListener('abort', () => resolve(null), {once: true}));
  let disposed = false, raf = 0, room = null, environment = null, restyled = null, interior = null, drops = null;
  let intersection = null, resize = null, firstFrame = null, lost = null, mounted = false;
  let dprScale = 1, slowFrames = 0, prevRenderAt = 0, crispTimer = 0, scaledAt = 0;

  const canvas = document.createElement('canvas');
  canvas.className = 'porsche3d__canvas';
  canvas.setAttribute('aria-hidden', 'true');
  Object.assign(canvas.style, {
    position: 'absolute', inset: '0', width: '100%', height: '100%', display: 'block',
    touchAction: 'none', userSelect: 'none', webkitUserSelect: 'none',
    pointerEvents: interactive ? '' : 'none',
  });
  if (fadeIn) Object.assign(canvas.style, {opacity: '0', transition: `opacity ${reducedMotion ? 0 : 600}ms ease`});

  let renderer;
  try {
    renderer = new WebGLRenderer({canvas, antialias: true, alpha: false, powerPreference: low ? 'default' : 'high-performance'});
  } catch (error) {
    throw new Porsche3DError('webgl', 'Не удалось запустить WebGL', error);
  }
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.35;
  // Запрос к видеокарте, пока она свободна: позже, после окружения, он ждал
  // её очередь ~150 мс.
  const maxAnisotropy = renderer.capabilities.getMaxAnisotropy();
  // Синхронные проверки шейдеров (getProgramInfoLog) давали длинные задачи
  // при подготовке сцены; включаются для отладки параметром ?p3d-debug.
  renderer.debug.checkShaderErrors = new URLSearchParams(location.search).has('p3d-debug');
  const maxDpr = low ? 1.5 : 1.75;

  const scene = new Scene();
  const camera = new PerspectiveCamera(VIEWS[startView].fov, REF_ASPECT, 0.05, 60);

  // Всё, что создано до ошибки или отмены, освобождается здесь.
  function dispose() {
    if (disposed) return;
    disposed = true;
    if (active === handle) active = null;
    cancelAnimationFrame(raf); raf = 0;
    clearTimeout(crispTimer);
    loading.abort();
    listeners.abort();
    if (firstFrame) { const done = firstFrame; firstFrame = null; done(); }
    intersection?.disconnect(); resize?.disconnect();
    container.classList.remove('is-dragging');
    interior?.dispose();
    drops?.dispose();
    release(scene, restyled?.replaced);
    room?.dispose();
    environment?.dispose();
    renderer.renderLists.dispose();
    renderer.dispose();
    // Контекст уже потерян — второй раз терять нечего (three предупреждает в консоли).
    if (!lost) renderer.forceContextLoss();
    canvas.remove();
  }
  const handle = {dispose};
  active = handle;
  const bail = () => { dispose(); throw abortError(); };
  signal?.addEventListener('abort', dispose, {once: true, signal: listeners.signal});

  try {
    // Потеря контекста: до готовности — отказ mount(), после — onError.
    canvas.addEventListener('webglcontextlost', () => {
      if (disposed) return;
      lost = new Porsche3DError('context-lost', 'Потерян контекст WebGL');
      dispose();
      if (mounted) onError?.(lost);
    }, on);

    const entry = MODELS[level];
    const url = model || new URL(entry.file, baseUrl).href;
    // Логотип для стены грузится вместе с моделью; это файл шапки сайта — обычно из кэша.
    const logo = loadLogo(new URL(LOGO.file, baseUrl).href);
    onPhase?.('download');
    const buffer = await fetchModel(url, model ? 0 : entry.bytes, loading.signal, onProgress, stallTimeout);
    mark('model');
    if (disposed) bail();
    onPhase?.('prepare');

    // Шаги с паузами между ними: интерфейс гаража отвечает и во время подготовки.
    await pause(); if (disposed) bail();
    environment = buildEnvironment(scene, renderer, {low});
    await pause(); if (disposed) bail();
    room = buildRoom(scene, {low});
    // Не дольше 1,5 с: без логотипа гараж открывается всё равно.
    const logoImage = await Promise.race([logo, cancelled, new Promise(resolve => setTimeout(resolve, 1500, null))]);
    if (disposed) bail();
    room.addLogo(logoImage);
    await pause(); if (disposed) bail();
    // Распаковка Meshopt — в фоновых потоках; после разбора потоки закрываются.
    const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
    MeshoptDecoder.useWorkers(low ? 1 : 2);
    let gltf;
    try {
      // Разбору нужна своя копия: буфер остаётся в кэше модуля.
      gltf = await Promise.race([loader.parseAsync(buffer.slice(0), new URL('assets/3d/', baseUrl).href), cancelled]);
    } finally {
      MeshoptDecoder.useWorkers(0);
    }
    if (disposed) { if (gltf) release(gltf.scene); bail(); }
    mark('parse');
    scene.add(gltf.scene);
    restyled = restyle(gltf.scene, {anisotropy: Math.min(low ? 2 : 4, maxAnisotropy)});
    await pause(); if (disposed) bail();
    // Кокпит из v1 вместо упрощённой «ванны» модели: он виден через стёкла.
    interior = await buildInterior(gltf.scene, pause);
    if (disposed) bail();
    scene.add(interior.group);
    // Капли «Антидождя» на лобовом стекле — по той же карте стекла, что торпедо
    // (расстановка — 2–20 мс, отдельным шагом).
    await pause(); if (disposed) bail();
    drops = buildDrops(interior.glass, {low});
    if (drops) scene.add(drops.mesh);
    container.appendChild(canvas);
  } catch (error) {
    const wasCancelled = disposed || signal?.aborted || error?.name === 'AbortError';
    dispose();
    if (lost) throw lost;
    if (wasCancelled) throw abortError();
    throw error instanceof Porsche3DError ? error : new Porsche3DError('load', 'Не удалось загрузить 3D-сцену', error);
  }

  // ── Камера ────────────────────────────────────────────────────────────────
  // Опорный кадр 16:9 вписывается в свободную часть контейнера как фото с
  // background-size:cover; на узком экране — не уже доли span, чтобы машина
  // не превращалась в полосу. Свободная часть — контейнер минус inset.
  const viewState = name => {
    const v = VIEWS[name];
    return {p: new Vector3(...v.p), t: new Vector3(...v.t), fov: v.fov, focus: [...v.focus], span: v.span};
  };
  const state = viewState(startView);
  const inset = {top: 0, right: 0, bottom: 0, left: 0};
  let width = 0, height = 0, viewName = startView;
  function project() {
    if (!width || !height) return;
    const {left: l, right: r, top: t, bottom: b} = inset;
    const W = Math.max(1, width - l - r), H = Math.max(1, height - t - b);
    let fullW = Math.max(W, H * REF_ASPECT);
    if (state.span && W / fullW < state.span) fullW = W / state.span;
    const fullH = fullW / REF_ASPECT;
    camera.fov = state.fov; camera.aspect = REF_ASPECT;
    camera.setViewOffset(fullW, fullH, (fullW - W) * state.focus[0] - l, (fullH - H) * state.focus[1] - t, width, height);
    camera.updateProjectionMatrix();
  }
  function measure() {
    const rect = container.getBoundingClientRect();
    const w = Math.max(1, Math.round(rect.width)), h = Math.max(1, Math.round(rect.height));
    if (w === width && h === height) return;
    width = w; height = h;
    renderer.setPixelRatio(Math.min(devicePixelRatio || 1, maxDpr) * dprScale);
    renderer.setSize(width, height, false);
    invalidate();
  }

  // ── Эффекты работ ─────────────────────────────────────────────────────────
  // Работа играет свой эффект после того, как камера доехала. Без выбранной
  // работы — пыльная машина: мойка её «смывает». При «уменьшить движение» —
  // сразу итог: чистая или отполированная машина, капли бусинами без движения,
  // без вспышек блика.
  let service = {kind: 'base', time: 0, duration: 0.01};
  const DURATION = {wash: 2.6, gloss: 2.6, glow: 2.1, rain: DROPS.duration};
  // Путь блика по детали (GLOW) — гладкая кривая через точки ракурса.
  const glowCurves = new Map();
  const glowCurve = name => {
    if (!glowCurves.has(name)) glowCurves.set(name, new CatmullRomCurve3(GLOW[name].path.map(p => new Vector3(...p))));
    return glowCurves.get(name);
  };
  const glowAt = new Vector3();
  function serviceEffects() {
    const u = service.time / service.duration;
    const e = reducedMotion ? 1 : smoothRange(u, 0, 1);
    const f = {clean: 1, finish: 1, polish: 1, light: 0, rain: null};
    switch (service.kind) {
      case 'base': f.clean = 0; break;
      case 'wash': f.clean = e; break;
      case 'gloss':
        f.finish = f.polish = e;
        f.light = (Math.sin(Math.PI * Math.min(1, e * 1.05)) * 0.9 + 0.1) * 7;
        glowAt.set(-2.3, 1.45, MathUtils.lerp(1.9, -1.9, e));
        f.reach = 6;
        break;
      case 'glow': {
        // Блик мягко загорается, проходит по детали и гаснет; без движения — не нужен.
        if (reducedMotion || u >= 1) break;
        const glow = GLOW[service.glow];
        glowCurve(service.glow).getPoint(easeInOut(u), glowAt);
        f.light = glow.power * Math.pow(Math.sin(Math.PI * u), 2);
        f.reach = glow.reach;
        break;
      }
      case 'rain': f.rain = reducedMotion ? 'still' : service.time; break;
    }
    return f;
  }
  function applyEffects() {
    if (!restyled) return;
    const f = serviceEffects();
    restyled.fx.clean.value = f.clean;
    restyled.fx.finish.value = f.finish;
    restyled.paint.roughness = MathUtils.lerp(0.26, 0.18, f.polish);
    restyled.paint.clearcoatRoughness = MathUtils.lerp(0.035, 0.018, f.polish);
    // Один подвижный свет на все работы (room.sweep): шейдеры собраны с ним заранее,
    // яркость 0 — его нет; новый источник пересобрал бы программы и удорожил кадр.
    if (room?.sweep) {
      room.sweep.intensity = f.light;
      if (f.light > 0) { room.sweep.position.copy(glowAt); room.sweep.distance = f.reach; }
    }
    // До первого кадра капли (нулевого размера) остаются в сцене: шейдер собирается
    // и прогревается вместе со всеми, после первого кадра они скрыты.
    if (drops && mounted) {
      if (f.rain === null) { if (drops.mesh.visible) drops.hide(); }
      else drops.update(f.rain === 'still' ? 0 : f.rain, f.rain === 'still');
    }
  }
  function stepService(dt) {
    if (move || service.time >= service.duration) return false;
    // Без движения итог показан сразу — кадры ради эффекта не нужны.
    if (reducedMotion) { service.time = service.duration; return false; }
    service.time = Math.min(service.duration, service.time + dt);
    return true;
  }

  // ── Переходы камеры ───────────────────────────────────────────────────────
  // Переход к ракурсу — по дуге вокруг машины (чтобы не проходить сквозь кузов).
  const center = new Vector3(0, 0.5, 0);
  let move = null, drift = null, driftNext = null, spin = null;
  const polar = v => {
    const d = v.clone().sub(center);
    return {r: Math.hypot(d.x, d.z), a: Math.atan2(d.x, d.z), y: v.y};
  };
  function startMove(name, duration) {
    const to = viewState(name);
    const from = {p: state.p.clone(), t: state.t.clone(), fov: state.fov, focus: [...state.focus], span: state.span};
    const a = polar(from.p), b = polar(to.p);
    let da = b.a - a.a; if (da > Math.PI) da -= 2 * Math.PI; if (da < -Math.PI) da += 2 * Math.PI;
    move = {from, to, a, b, da, time: 0, duration};
  }
  // Камера уже стоит в ракурсе (у двух работ он общий): перелёт не нужен —
  // эффект новой работы начинается сразу, а не после 1,25 с пустого перехода.
  const probe = new Vector3();
  const atView = name => {
    const v = VIEWS[name];
    return !move && Math.abs(state.fov - v.fov) < 1e-3
      && state.p.distanceToSquared(probe.fromArray(v.p)) < 1e-6 && state.t.distanceToSquared(probe.fromArray(v.t)) < 1e-6;
  };
  function goTo(name, {instant = reducedMotion, duration = 1.25} = {}) {
    if (!VIEWS[name]) throw new Porsche3DError('view', `Нет ракурса ${name}`);
    drift = null; driftNext = null; spin = null;
    const here = viewName === name && atView(name);
    viewName = name;
    zoomTo(1, instant);
    if (instant || here) { move = null; Object.assign(state, viewState(name)); }
    else startMove(name, duration);
    onViewChange?.(name);
    invalidate();
  }
  function stepMove(dt) {
    if (!move) return false;
    move.time += dt;
    const k = easeInOut(Math.min(1, move.time / move.duration));
    const {from, to, a, b, da} = move;
    const angle = a.a + da * k, r = MathUtils.lerp(a.r, b.r, k);
    // Лёгкий подъём в середине дуги: камера не цепляет крыло на развороте.
    const lift = Math.sin(Math.PI * k) * Math.min(0.5, Math.abs(da) * 0.25);
    state.p.set(center.x + Math.sin(angle) * r, MathUtils.lerp(a.y, b.y, k) + lift, center.z + Math.cos(angle) * r);
    state.t.lerpVectors(from.t, to.t, k);
    state.fov = MathUtils.lerp(from.fov, to.fov, k);
    state.focus = [MathUtils.lerp(from.focus[0], to.focus[0], k), MathUtils.lerp(from.focus[1], to.focus[1], k)];
    state.span = MathUtils.lerp(from.span, to.span, k);
    if (k >= 1) {
      move = null;
      if (driftNext) { drift = driftNext; driftNext = null; }
    }
    return !!move || !!drift;
  }
  // Полировка: камера медленно ведёт вдоль борта — отражения скользят.
  function stepDrift(dt) {
    if (!drift) return false;
    drift.time += dt;
    const u = Math.min(1, drift.time / drift.duration);
    state.p.copy(drift.base).addScaledVector(drift.axis, Math.sin(u * Math.PI) * 0.45);
    if (u >= 1) drift = null;
    return !!drift;
  }

  // ── Приближение ───────────────────────────────────────────────────────────
  // Доля расстояния от камеры до точки взгляда: 0,72 — ближе, 1,3 — дальше.
  // Пределы держат машину в кадре и не пускают камеру в кузов.
  const ZOOM_MIN = 0.72, ZOOM_MAX = 1.3;
  let zoom = 1, zoomTarget = 1;
  function zoomTo(value, instant = reducedMotion) {
    zoomTarget = MathUtils.clamp(value, ZOOM_MIN, ZOOM_MAX);
    if (instant) zoom = zoomTarget;
    invalidate();
  }
  function stepZoom(dt) {
    if (Math.abs(zoomTarget - zoom) < 1e-4) { zoom = zoomTarget; return false; }
    zoom += (zoomTarget - zoom) * (1 - Math.pow(1 - 0.2, dt * 60));
    return true;
  }

  // ── Поворот и приближение рукой ───────────────────────────────────────────
  // Мышь и палец: вокруг машины и наклон 55°–86°, без сдвига. Два пальца —
  // приближение щипком; колесо над сценой — приближение (страница за окном
  // гаража неподвижна, колесу нечего листать).
  const POLAR_MIN = 55 * DEG, POLAR_MAX = 86 * DEG;
  const pointers = new Map();
  let drag = null, pinch = null;
  const offset = new Vector3();
  function rotate(dAz, dPolar) {
    offset.subVectors(state.p, state.t);
    const r = offset.length();
    let az = Math.atan2(offset.x, offset.z), pol = Math.acos(MathUtils.clamp(offset.y / r, -1, 1));
    az += dAz;
    pol = MathUtils.clamp(pol + dPolar, POLAR_MIN, Math.max(POLAR_MAX, Math.min(pol, 89 * DEG)));
    state.p.set(state.t.x + r * Math.sin(pol) * Math.sin(az), state.t.y + r * Math.cos(pol), state.t.z + r * Math.sin(pol) * Math.cos(az));
  }
  // Рука берёт камеру: переход и проезд вдоль борта останавливаются.
  function takeOver() {
    move = null; drift = null; driftNext = null;
    if (viewName !== 'free') { viewName = 'free'; onViewChange?.('free'); }
  }
  function stepSpin(dt) {
    if (!spin || drag) return false;
    const k = Math.pow(1 - 0.08, dt * 60);
    spin.az *= k; spin.pol *= k;
    rotate(spin.az * dt * 60, spin.pol * dt * 60);
    if (Math.abs(spin.az) < 1e-4 && Math.abs(spin.pol) < 1e-4) { spin = null; return false; }
    return true;
  }
  const spread = () => { const [a, b] = [...pointers.values()]; return Math.hypot(a.x - b.x, a.y - b.y); };
  if (interactive) {
    canvas.addEventListener('pointerdown', e => {
      if (e.button > 0) return;
      pointers.set(e.pointerId, {x: e.clientX, y: e.clientY});
      canvas.setPointerCapture(e.pointerId);
      spin = null;
      if (pointers.size === 2) {
        // Второй палец: поворот уступает щипку.
        drag = null; container.classList.remove('is-dragging');
        pinch = {start: spread(), zoom: zoomTarget};
        onInteract?.('pinch');
        return;
      }
      if (pointers.size > 2) return;
      drag = {id: e.pointerId, type: e.pointerType, lastX: e.clientX, lastY: e.clientY, moved: 0, vAz: 0, vPol: 0, taken: false};
      onInteract?.('press');
    }, on);
    canvas.addEventListener('pointermove', e => {
      const point = pointers.get(e.pointerId);
      if (!point) return;
      point.x = e.clientX; point.y = e.clientY;
      if (pinch && pointers.size >= 2) {
        const d = spread();
        if (pinch.start > 0 && d > 0) { takeOver(); zoomTo(pinch.zoom * pinch.start / d, true); }
        return;
      }
      if (!drag || e.pointerId !== drag.id) return;
      const mx = e.clientX - drag.lastX, my = e.clientY - drag.lastY;
      if (!drag.taken) {
        if (Math.abs(mx) + Math.abs(my) < 3) return;
        drag.taken = true; drag.lastX = e.clientX; drag.lastY = e.clientY;
        container.classList.add('is-dragging'); takeOver();
        return;
      }
      drag.lastX = e.clientX; drag.lastY = e.clientY;
      const dAz = -mx / Math.max(1, width) * Math.PI * 1.3;
      const dPol = -my / Math.max(1, height) * Math.PI * 0.5;
      drag.vAz = dAz; drag.vPol = dPol; drag.moved += Math.abs(mx) + Math.abs(my);
      rotate(dAz, dPol); invalidate();
    }, on);
    const end = e => {
      if (!pointers.delete(e.pointerId)) return;
      if (pinch && pointers.size < 2) pinch = null;
      if (drag && e.pointerId === drag.id) {
        if (drag.taken && !reducedMotion && e.type === 'pointerup' && drag.moved > 4) spin = {az: drag.vAz, pol: drag.vPol};
        drag = null;
        container.classList.remove('is-dragging');
      }
      invalidate();
    };
    canvas.addEventListener('pointerup', end, on);
    canvas.addEventListener('pointercancel', end, on);
    canvas.addEventListener('wheel', e => {
      e.preventDefault();
      takeOver();
      // Трекпад со щипком шлёт wheel с ctrlKey и мелким шагом — чувствительнее.
      zoomTo(zoomTarget * Math.exp(e.deltaY * (e.ctrlKey ? 0.01 : 0.0012)));
      onInteract?.('wheel');
    }, {...on, passive: false});
  }

  // ── Отрисовка по требованию ──────────────────────────────────────────────
  // Кадр рисуется, только когда что-то изменилось; неподвижная камера — ноль
  // кадров. Вне экрана, на скрытой вкладке и по просьбе страницы (setSuspended)
  // цикл стоит.
  // compiled: до конца компиляции шейдеров не рисуем — первый render() ждал бы
  // сборку всех программ синхронно и блокировал страницу на секунду и больше.
  // inTick: пока идёт кадр, invalidate() не заказывает новый — продолжение
  // решает сам tick(); иначе кадры множились (каждый заказывал по два).
  let onScreen = true, frames = 0, last = 0, compiled = false, inTick = false;
  function setScale(next) {
    if (next === dprScale) return;
    dprScale = next;
    renderer.setPixelRatio(Math.min(devicePixelRatio || 1, maxDpr) * dprScale);
    renderer.setSize(width, height, false);
  }
  // Разрешение по нагрузке: пока камера движется, а кадры идут дольше ~30 мс
  // (слабая видеокарта, крупный план лака), сцена рисуется в меньшем
  // разрешении (70 %); остановилась — последний кадр снова чёткий.
  function adaptResolution(now, moving) {
    const gap = prevRenderAt ? now - prevRenderAt : 0;
    prevRenderAt = now;
    if (moving && gap > 0 && gap < 120) {
      slowFrames = gap > 30 ? slowFrames + 1 : Math.max(0, slowFrames - 1);
      // Смена разрешения — перевыделение буфера (~50–100 мс): не чаще раза в 3 с.
      if (slowFrames >= 12 && dprScale > 0.7 && now - scaledAt > 3000) { setScale(0.7); scaledAt = now; slowFrames = 0; }
    }
    clearTimeout(crispTimer);
    if (dprScale < 1) crispTimer = setTimeout(() => { if (disposed) return; setScale(1); slowFrames = 0; prevRenderAt = 0; invalidate(); }, 1000);
  }
  const suspended = new Set();
  const eye = new Vector3();
  function running() { return compiled && !disposed && onScreen && !document.hidden && !suspended.size; }
  function stop() { cancelAnimationFrame(raf); raf = 0; last = 0; }
  function invalidate() { if (!raf && !inTick && running()) raf = requestAnimationFrame(tick); }
  function tick(now) {
    raf = 0;
    inTick = true;
    try { render(now); } finally { inTick = false; }
  }
  function render(now) {
    // Реальное время (секунда — предел на случай паузы, например после скрытой вкладки).
    const dt = last ? Math.min(1, (now - last) / 1000) : 1 / 60;
    last = now;
    let busy = stepMove(dt);
    busy = stepDrift(dt) || busy;
    busy = stepSpin(dt) || busy;
    busy = stepZoom(dt) || busy;
    busy = stepService(dt) || busy;
    project();
    applyEffects();
    eye.subVectors(state.p, state.t).multiplyScalar(zoom).add(state.t);
    camera.position.copy(eye); camera.lookAt(state.t);
    adaptResolution(now, busy || !!drag || !!pinch);
    renderer.render(scene, camera);
    frames++;
    if (firstFrame) { const done = firstFrame; firstFrame = null; done(); }
    if ((busy || drag || pinch) && running()) raf = requestAnimationFrame(tick); else last = 0;
  }

  intersection = new IntersectionObserver(([item]) => {
    onScreen = item.isIntersecting;
    if (onScreen) invalidate(); else stop();
  });
  intersection.observe(container);
  resize = new ResizeObserver(measure);
  resize.observe(container);
  document.addEventListener('visibilitychange', () => { if (document.hidden) stop(); else invalidate(); }, on);

  await pause(); if (disposed) throw lost || abortError();
  measure();
  project();
  applyEffects();
  camera.position.copy(state.p); camera.lookAt(state.t);
  try {
    // Шейдеры собираются параллельно (KHR_parallel_shader_compile), готовность
    // проверяем сами: compileAsync из three после dispose() падает в таймере.
    // Программы создаются по нескольку мешей за шаг — на стороне JS это
    // 3–5 мс на программу, все сразу давали задачу ~100 мс.
    const pending = new Set();
    const meshes = [];
    scene.traverseVisible(o => { if (o.isMesh || o.isLineSegments) meshes.push(o); });
    for (const [i, mesh] of meshes.entries()) {
      for (const m of renderer.compile(mesh, camera, scene)) pending.add(m);
      if (i % 4 === 3) { await pause(); if (disposed) throw lost || abortError(); }
    }
    await new Promise(resolve => {
      const check = () => {
        if (disposed) return resolve();
        for (const material of pending) {
          const program = renderer.properties.get(material).currentProgram;
          if (!program || program.isReady()) pending.delete(material);
        }
        if (pending.size) setTimeout(check, 16); else resolve();
      };
      check();
    });
    if (disposed) throw lost || abortError();
    // Текстуры — на видеокарту по одной, иначе первый кадр загружал бы все сразу.
    const textures = new Set();
    scene.traverse(o => { for (const m of [].concat(o.material || [])) for (const v of Object.values(m)) if (v?.isTexture) textures.add(v); });
    for (const texture of textures) {
      if (disposed) break;
      renderer.initTexture(texture);
      await pause();
    }
    mark('compile');
  } catch (error) {
    if (disposed) throw lost || abortError();
    dispose();
    throw new Porsche3DError('compile', 'Не удалось подготовить шейдеры', error);
  }
  if (disposed) throw lost || abortError();

  // Первый кадр: ждём, пока он действительно нарисован, и только потом
  // проявляем canvas. Если вкладка скрыта, кадр нарисуется, когда станет видно.
  compiled = true;
  // Первый кадр рисует все объекты без отсечения по камере: видеодрайвер
  // (ANGLE) доделывает шейдер при первой отрисовке объекта, и без этого
  // переходы спотыкались, когда в кадр впервые попадали диск, салон, фары.
  const culled = [];
  scene.traverse(o => { if ((o.isMesh || o.isLineSegments) && o.frustumCulled) { o.frustumCulled = false; culled.push(o); } });
  await new Promise(resolve => { firstFrame = resolve; last = 0; invalidate(); });
  for (const o of culled) o.frustumCulled = true;
  // Капли нарисованы нулевыми (программа прогрета) — до «Антидождя» их нет.
  drops?.hide();
  if (disposed) throw lost || abortError();
  mark('firstFrame');
  if (fadeIn) canvas.style.opacity = '1';
  onFirstFrame?.();

  Object.assign(handle, {
    canvas,
    quality: level,
    views: Object.keys(VIEWS),
    view(name, options) { if (!disposed) goTo(name, options); },
    // Работа гаража → ракурс и её эффект (SERVICE_FX). false — нет такой работы.
    showService(id) {
      const name = SERVICE_VIEWS[id];
      if (disposed || !name) return false;
      goTo(name);
      // Прежний эффект останавливается сразу: свет гаснет, капли убираются (applyEffects).
      let kind = SERVICE_FX[id] || 'clean';
      if ((kind === 'glow' && !GLOW[name]) || (kind === 'rain' && !drops)) kind = 'clean';
      service = {kind, glow: name, time: 0, duration: DURATION[kind] || 0.01};
      applyEffects();
      // Полировка: доехав до борта, камера медленно ведёт вдоль него —
      // отражения скользят по лаку.
      if (id === 'polish' && !reducedMotion) {
        const base = new Vector3(...VIEWS[name].p), look = new Vector3(...VIEWS[name].t);
        const axis = new Vector3().subVectors(look, base).cross(new Vector3(0, 1, 0)).normalize();
        driftNext = {base, axis, time: 0, duration: 3.2};
        if (!move) { drift = driftNext; driftNext = null; invalidate(); }
      }
      return true;
    },
    // Ничего не выбрано: общий вид, пыльная машина.
    showBase() {
      if (disposed) return;
      goTo('overview');
      service = {kind: 'base', time: 0, duration: 0.01};
      applyEffects();
    },
    // «Общий вид»: исходная камера и приближение, эффект текущей работы остаётся.
    reset() { if (!disposed) goTo('overview'); },
    // Клавиатура и кнопки: поворот в градусах, приближение — множитель.
    rotateBy(azDeg = 0, polarDeg = 0) {
      if (disposed) return;
      takeOver(); spin = null;
      rotate(azDeg * DEG, polarDeg * DEG); invalidate();
    },
    zoomBy(factor) { if (!disposed) { takeOver(); zoomTo(zoomTarget * factor); } },
    // Свободная часть контейнера (px), если сцену что-то перекрывает.
    setSafeArea(next = {}) {
      Object.assign(inset, {top: 0, right: 0, bottom: 0, left: 0}, next);
      invalidate();
    },
    // Пауза по причине страницы: окно скрыто, открыт другой диалог и т. п.
    setSuspended(reason, value) {
      if (!!value === suspended.has(reason)) return;
      if (value) { suspended.add(reason); stop(); } else { suspended.delete(reason); invalidate(); }
    },
    setReducedMotion(value) {
      reducedMotion = !!value;
      if (reducedMotion) { drift = null; driftNext = null; spin = null; zoom = zoomTarget; }
      if (fadeIn) canvas.style.transition = `opacity ${reducedMotion ? 0 : 600}ms ease`;
      invalidate();
    },
    invalidate,
    // Только для автоматических проверок (потеря контекста, свет); страница не использует.
    _debug: () => ({scene, camera, renderer}),
    stats() {
      const info = renderer.info;
      return {quality: level, frames, drawCalls: info.render.calls, triangles: info.render.triangles,
        geometries: info.memory.geometries, textures: info.memory.textures, programs: info.programs?.length ?? 0,
        pixelRatio: renderer.getPixelRatio(), width, height, zoom, view: viewName, running: !!raf, suspended: [...suspended], timings: {...timings},
        effect: {kind: service.kind, progress: Math.min(1, service.time / service.duration), light: room?.sweep.intensity ?? 0, drops: !!drops?.mesh.visible}};
    },
  });
  // Текущий ракурс и приближение — свойствами-геттерами (Object.assign скопировал бы
  // значения на момент запуска).
  Object.defineProperties(handle, {
    currentView: {get: () => viewName, enumerable: true},
    zoom: {get: () => zoomTarget, enumerable: true},
  });
  mounted = true;
  return handle;
}
