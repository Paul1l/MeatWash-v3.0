// 3D-режим «Оживить Porsche». Модуль грузится только динамическим import()
// по нажатию кнопки: страница не ссылается на него ни статически, ни через
// preload/prefetch. Собирается в dist/js/porsche3d.bundle.js (npm run bundle-3d),
// three, GLTFLoader и декодер Meshopt — внутри бандла.
//
//   const {mount} = await import('./porsche3d.bundle.js');
//   const scene = await mount({container, signal, onProgress, onFirstFrame, onError});
//   scene.tour(); scene.view('wheel'); scene.showService('polish'); scene.dispose();
//
// Прокрутку страницы сцена не перехватывает: слушателей wheel нет, на canvas
// touch-action: pan-y — вертикальный жест листает страницу. Поворот — мышью
// или горизонтальным жестом (порог 8 px); ракурсы и показ — программно.
import {
  ACESFilmicToneMapping, Color, MathUtils, MeshPhysicalMaterial,
  PerspectiveCamera, Scene, SRGBColorSpace, Vector3, WebGLRenderer, WebGLRenderTarget,
} from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {MeshoptDecoder} from 'three/addons/libs/meshopt_decoder.module.js';
import {buildEnvironment, buildRoom} from './room.js';
import {buildInterior} from './interior.js';
import {createWater} from './water.js';
import {VIEWS, TOUR, SERVICE_VIEWS, SERVICE_FX, SCROLL_STOPS, PUBLIC_VIEWS, REF_ASPECT} from './views.js';
import {MODELS} from './models.js';

export {VIEWS, SERVICE_VIEWS, PUBLIC_VIEWS, MODELS};

// Одна сцена на страницу: повторный mount закрывает предыдущую.
let active = null;
// Скачанная модель остаётся в памяти модуля (1–2 МБ): повторное включение
// после «Обычного вида» не ходит в сеть. Видеопамять при выходе освобождается.
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

// Лак с состояниями глав v1: uClean — пыль и разводы (0 — как на фото hero v2,
// 1 — чистая машина), uFinish — риски полировки (0 — «паутинка», 1 — ровное
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
// лаке (большая часть глав) пиксель обходится без них — крупные планы дешевле.
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
  startView = 'hero',
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
  onTourEnd,
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
  let disposed = false, raf = 0, room = null, environment = null, restyled = null, interior = null, water = null;
  let intersection = null, resize = null, firstFrame = null, lost = null, mounted = false;
  let dprScale = 1, slowFrames = 0, prevRenderAt = 0, crispTimer = 0, scaledAt = 0;

  const canvas = document.createElement('canvas');
  canvas.className = 'porsche3d__canvas';
  canvas.setAttribute('aria-hidden', 'true');
  Object.assign(canvas.style, {
    position: 'absolute', inset: '0', width: '100%', height: '100%', display: 'block',
    touchAction: 'pan-y', userSelect: 'none', webkitUserSelect: 'none',
    pointerEvents: interactive ? '' : 'none',
  });
  if (fadeIn) Object.assign(canvas.style, {opacity: '0', transition: `opacity ${reducedMotion ? 250 : 900}ms ease`});

  let renderer;
  try {
    renderer = new WebGLRenderer({canvas, antialias: true, alpha: false, powerPreference: low ? 'default' : 'high-performance'});
  } catch (error) {
    throw new Porsche3DError('webgl', 'Не удалось запустить WebGL', error);
  }
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.35;
  renderer.transmissionResolutionScale = 0.5;
  // Запрос к видеокарте, пока она свободна: позже, после окружения, он ждал
  // её очередь ~150 мс.
  const maxAnisotropy = renderer.capabilities.getMaxAnisotropy();
  // Синхронные проверки шейдеров (getProgramInfoLog) давали длинные задачи
  // при подготовке сцены; включаются для отладки параметром ?p3d-debug.
  renderer.debug.checkShaderErrors = new URLSearchParams(location.search).has('p3d-debug');
  const maxDpr = low ? 1.5 : 1.75;

  const scene = new Scene();
  const camera = new PerspectiveCamera(VIEWS.hero.fov, REF_ASPECT, 0.05, 60);

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
    water?.dispose();
    interior?.dispose();
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
    onPhase?.('download');
    const buffer = await fetchModel(url, model ? 0 : entry.bytes, loading.signal, onProgress, stallTimeout);
    mark('model');
    if (disposed) bail();
    onPhase?.('prepare');

    // Шаги с паузами между ними: страница продолжает прокручиваться.
    await pause(); if (disposed) bail();
    environment = buildEnvironment(scene, renderer);
    await pause(); if (disposed) bail();
    room = buildRoom(scene, {low});
    await pause(); if (disposed) bail();
    // Распаковка Meshopt — в фоновых потоках, чтобы не задерживать прокрутку;
    // после разбора потоки закрываются.
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
    // Салон v1: кожаный кокпит вместо упрощённой «ванны» модели.
    interior = await buildInterior(gltf.scene, pause);
    if (disposed) bail();
    scene.add(interior.group);
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
  // не превращалась в полосу. Свободная часть — контейнер минус inset
  // (шапка, панель гаража); у ракурса hero (span 0) inset не учитывается:
  // он совпадает с фото первого экрана.
  const viewState = name => {
    const v = VIEWS[name];
    return {p: new Vector3(...v.p), t: new Vector3(...v.t), fov: v.fov, focus: [...v.focus], span: v.span, fit: v.span ? 1 : 0};
  };
  const state = viewState(startView);
  const inset = {top: 0, right: 0, bottom: 0, left: 0};
  let width = 0, height = 0, viewName = startView;
  // Кадр рисует tick(): там состояние ручного ракурса смешивается с путём по главам.
  function frame() { invalidate(); }
  function project(state) {
    if (!width || !height) return;
    const k = state.fit;
    const l = inset.left * k, r = inset.right * k, t = inset.top * k, b = inset.bottom * k;
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
    frame(); invalidate();
  }

  // ── Путь по главам (прокрутка, как в v1.0) ─────────────────────────────────
  // setProgress(p, {camera}) — доля прокрутки сцены. camera: true — камера и
  // эффекты глав ведутся прокруткой; на p≈0 остаётся ручной ракурс (показ,
  // «Общий вид / Кузов / Диски»), дальше он плавно передаёт камеру пути.
  const stops = SCROLL_STOPS.map(stop => stop.view ? viewState(stop.view) : {p: new Vector3(...stop.p), t: new Vector3(...stop.t), fov: stop.fov, focus: [...stop.focus], span: stop.span, fit: 1});
  const scroll = {p: 0, camera: false};
  const pathState = {p: new Vector3(), t: new Vector3(), fov: 0, focus: [0.5, 0.5], span: 0, fit: 0};
  const view = {p: new Vector3(), t: new Vector3(), fov: 0, focus: [0.5, 0.5], span: 0, fit: 0};
  const arc = (a, b, k, out) => {
    const pa = polar(a.p), pb = polar(b.p);
    let da = pb.a - pa.a; if (da > Math.PI) da -= 2 * Math.PI; if (da < -Math.PI) da += 2 * Math.PI;
    const angle = pa.a + da * k, r = MathUtils.lerp(pa.r, pb.r, k);
    const lift = Math.sin(Math.PI * k) * Math.min(0.5, Math.abs(da) * 0.25);
    out.p.set(center.x + Math.sin(angle) * r, MathUtils.lerp(pa.y, pb.y, k) + lift, center.z + Math.cos(angle) * r);
    out.t.lerpVectors(a.t, b.t, k);
    out.fov = MathUtils.lerp(a.fov, b.fov, k);
    out.focus = [MathUtils.lerp(a.focus[0], b.focus[0], k), MathUtils.lerp(a.focus[1], b.focus[1], k)];
    const sa = a.span || b.span, sb = b.span || a.span;
    out.span = MathUtils.lerp(sa, sb, k);
    out.fit = MathUtils.lerp(a.fit, b.fit, k);
    return out;
  };
  function pathAt(p) {
    const raw = MathUtils.clamp(p, 0, 1) * (stops.length - 1), i = Math.min(stops.length - 2, Math.floor(raw));
    return arc(stops[i], stops[i + 1], smoothRange(raw - i, 0.13, 0.87), pathState);
  }
  // Доля пути в кадре: 0 — ручной ракурс первого экрана, 1 — путь по главам.
  const pathWeight = () => scroll.camera ? smoothRange(scroll.p, 0, 0.035) : 0;
  function resolveView() {
    const w = pathWeight();
    if (w <= 0) return Object.assign(view, {p: view.p.copy(state.p), t: view.t.copy(state.t), fov: state.fov, focus: [...state.focus], span: state.span, fit: state.fit});
    pathAt(scroll.p);
    if (w >= 1) return Object.assign(view, {p: view.p.copy(pathState.p), t: view.t.copy(pathState.t), fov: pathState.fov, focus: [...pathState.focus], span: pathState.span, fit: pathState.fit});
    view.p.lerpVectors(state.p, pathState.p, w); view.t.lerpVectors(state.t, pathState.t, w);
    view.fov = MathUtils.lerp(state.fov, pathState.fov, w);
    view.focus = [MathUtils.lerp(state.focus[0], pathState.focus[0], w), MathUtils.lerp(state.focus[1], pathState.focus[1], w)];
    view.span = MathUtils.lerp(state.span || pathState.span, pathState.span || state.span, w);
    view.fit = MathUtils.lerp(state.fit, pathState.fit, w);
    return view;
  }

  // ── Эффекты глав и работ гаража ───────────────────────────────────────────
  // По прокрутке — как в v1: 01 грязь смывается, 02 стекло растворяется,
  // 03 риски исчезают и по борту идёт свет, 04 капли. Работа гаража играет
  // свой эффект после того, как камера доехала. Без прокрутки и гаража —
  // пыльная машина, как на фото первого экрана.
  let service = null;
  function effectsAt(p) {
    const polish = smoothRange(p, 0.535, 0.653);
    const polishChapter = smoothRange(p, 0.47, 0.52) * (1 - smoothRange(p, 0.68, 0.70));
    return {
      clean: smoothRange(p, 0.095, 0.245),
      finish: 1 - polishChapter * (1 - polish),
      polish, sweep: polishChapter,
      inside: smoothRange(p, 0.30, 0.37) * (1 - smoothRange(p, 0.44, 0.50)),
      water: p,
    };
  }
  function serviceEffects() {
    const e = reducedMotion ? 1 : smoothRange(service.time / service.duration, 0, 1);
    const base = {clean: 1, finish: 1, polish: 1, sweep: 0, inside: 0, water: 0};
    if (service.kind === 'base') return {...base, clean: 0};
    if (service.kind === 'wash') return {...base, clean: e};
    if (service.kind === 'gloss') return {...base, finish: e, polish: e, sweep: Math.sin(Math.PI * Math.min(1, e * 1.05)) * 0.9 + 0.1};
    if (service.kind === 'water') return {...base, water: 0.72 + e * 0.14};
    if (service.kind === 'interior') return {...base, inside: e};
    return base;
  }
  function applyEffects() {
    if (!restyled) return;
    const f = service ? serviceEffects() : pathWeight() > 0 ? effectsAt(scroll.p) : {clean: 0, finish: 1, polish: 0, sweep: 0, inside: 0, water: 0};
    restyled.fx.clean.value = f.clean;
    restyled.fx.finish.value = f.finish;
    restyled.paint.roughness = MathUtils.lerp(0.26, 0.18, f.polish);
    restyled.paint.clearcoatRoughness = MathUtils.lerp(0.035, 0.018, f.polish);
    restyled.glass.opacity = 0.55 * (1 - f.inside * 0.985);
    if (room?.sweep) {
      room.sweep.intensity = f.sweep * 7;
      room.sweep.position.z = MathUtils.lerp(1.9, -1.9, f.polish);
    }
    // Глава 04: пятно света на капоте приглушается — капли читаются бликами на тёмном лаке.
    if (room?.top) {
      const wet = smoothRange(f.water, 0.7, 0.74) * (1 - smoothRange(f.water, 0.9, 0.93));
      room.top.intensity = 14 * (1 - 0.75 * wet);
    }
    water?.update(warmed ? f.water : 0);
  }
  function stepService(dt) {
    if (!service || move) return false;
    if (service.time >= service.duration) return false;
    service.time = Math.min(service.duration, service.time + dt);
    return true;
  }

  // Параллакс за мышью (±1,5° по горизонтали, ±0,6° по вертикали): отражения
  // на лаке «едут». Только мышь; выключен при reduced motion, в показе и при повороте.
  const fine = matchMedia('(hover: hover) and (pointer: fine)');
  let parallaxOn = !reducedMotion && fine.matches;
  const pointer = {x: 0, y: 0}, lean = {x: 0, y: 0};
  window.addEventListener('pointermove', e => {
    if (!parallaxOn || e.pointerType !== 'mouse') return;
    pointer.x = e.clientX / innerWidth * 2 - 1; pointer.y = e.clientY / innerHeight * 2 - 1;
    invalidate();
  }, {...on, passive: true});

  // Движения камеры: переход к ракурсу по дуге вокруг машины (чтобы не
  // проходить сквозь кузов), показ — цепочка таких переходов с паузами.
  const center = new Vector3(0, 0.5, 0);
  let move = null, tour = null, drift = null, driftNext = null, spin = null;
  const polar = v => {
    const d = v.clone().sub(center);
    return {r: Math.hypot(d.x, d.z), a: Math.atan2(d.x, d.z), y: v.y};
  };
  function startMove(name, duration) {
    const to = viewState(name);
    const from = {p: state.p.clone(), t: state.t.clone(), fov: state.fov, focus: [...state.focus], span: state.span, fit: state.fit};
    const a = polar(from.p), b = polar(to.p);
    let da = b.a - a.a; if (da > Math.PI) da -= 2 * Math.PI; if (da < -Math.PI) da += 2 * Math.PI;
    // span 0 (hero) не интерполируется: берём ширину цели сразу, иначе кадр «дышит».
    if (!from.span) from.span = to.span || 0;
    if (!to.span && from.span) to.span = from.span;
    move = {from, to, a, b, da, time: 0, duration};
  }
  function goTo(name, {instant = reducedMotion, duration = 1.25} = {}) {
    if (!VIEWS[name]) throw new Porsche3DError('view', `Нет ракурса ${name}`);
    tour = null; drift = null; driftNext = null; spin = null; viewName = name; service = null;
    if (instant) { move = null; Object.assign(state, viewState(name)); frame(); }
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
    state.fit = MathUtils.lerp(from.fit, to.fit, k);
    frame();
    if (k >= 1) {
      move = null;
      if (driftNext) { drift = driftNext; driftNext = null; }
    }
    return !!move || !!drift;
  }
  // Показ: крыло → капот → диск → общий вид, с паузами (TOUR в views.js).
  // Идёт из текущего положения камеры, на скрытой вкладке и вне экрана стоит.
  function stepTour(dt) {
    if (!tour) return false;
    if (move) { stepMove(dt); return true; }
    tour.hold -= dt;
    if (tour.hold > 0) return true;
    const step = TOUR.steps[tour.index++];
    if (!step) {
      tour = null; viewName = 'overview';
      onViewChange?.('overview'); onTourEnd?.();
      return false;
    }
    viewName = 'tour';
    startMove(step.view, step.move);
    tour.hold = step.hold;
    stepMove(dt);
    return true;
  }
  // Полировка: камера медленно ведёт вдоль борта — отражения скользят.
  function stepDrift(dt) {
    if (!drift) return false;
    drift.time += dt;
    const u = Math.min(1, drift.time / drift.duration);
    state.p.copy(drift.base).addScaledVector(drift.axis, Math.sin(u * Math.PI) * 0.45);
    frame();
    if (u >= 1) drift = null;
    return !!drift;
  }
  function stepLean(dt) {
    const on = parallaxOn && !tour && !drag && pathWeight() < 0.01;
    const tx = on ? pointer.x : 0, ty = on ? pointer.y : 0;
    const k = 1 - Math.pow(1 - 0.06, dt * 60);
    lean.x += (tx - lean.x) * k; lean.y += (ty - lean.y) * k;
    return Math.abs(tx - lean.x) > 0.003 || Math.abs(ty - lean.y) > 0.003;
  }

  // ── Поворот рукой ─────────────────────────────────────────────────────────
  // Мышь: вокруг машины и наклон 55°–86°, без сдвига и масштаба. Касание:
  // только горизонтальный жест (|dx| > 8 и больше |dy|) — вертикальный листает
  // страницу (touch-action: pan-y). Колесо не слушаем: оно всегда листает.
  const POLAR_MIN = 55 * DEG, POLAR_MAX = 86 * DEG;
  let drag = null;
  const offset = new Vector3();
  function rotate(dAz, dPolar) {
    offset.subVectors(state.p, state.t);
    const r = offset.length();
    let az = Math.atan2(offset.x, offset.z), pol = Math.acos(MathUtils.clamp(offset.y / r, -1, 1));
    az += dAz;
    pol = MathUtils.clamp(pol + dPolar, POLAR_MIN, Math.max(POLAR_MAX, Math.min(pol, 89 * DEG)));
    state.p.set(state.t.x + r * Math.sin(pol) * Math.sin(az), state.t.y + r * Math.cos(pol), state.t.z + r * Math.sin(pol) * Math.cos(az));
    frame();
  }
  // Показ останавливается от нажатия; ракурс сбрасывается, только когда
  // машину действительно повернули.
  function halt() {
    if (!tour) return;
    tour = null; move = null; viewName = 'free'; onViewChange?.('free');
  }
  function takeOver() {
    tour = null; move = null; drift = null; driftNext = null;
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
  if (interactive) {
    canvas.addEventListener('pointerdown', e => {
      if (drag || e.button > 0 || pathWeight() > 0.01) return;
      const mouse = e.pointerType === 'mouse';
      drag = {id: e.pointerId, type: e.pointerType, x: e.clientX, y: e.clientY, lastX: e.clientX, lastY: e.clientY, mode: mouse ? 'rotate' : 'wait', moved: 0, vAz: 0, vPol: 0, taken: false};
      spin = null;
      // Касание пока ничего не решает: может оказаться прокруткой страницы.
      if (mouse) { canvas.setPointerCapture(e.pointerId); container.classList.add('is-dragging'); halt(); onInteract?.('press'); }
    }, on);
    canvas.addEventListener('pointermove', e => {
      if (!drag || e.pointerId !== drag.id) return;
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      if (drag.mode === 'wait') {
        if (Math.abs(dx) > 8 && Math.abs(dx) > Math.abs(dy)) {
          drag.mode = 'rotate'; drag.lastX = e.clientX; drag.lastY = e.clientY;
          canvas.setPointerCapture(e.pointerId); container.classList.add('is-dragging');
          onInteract?.('press');
        } else if (Math.abs(dy) > 8) { drag = null; return; }
        else return;
      }
      if (!drag.taken) {
        if (Math.abs(dx) + Math.abs(dy) < 3) return;
        drag.taken = true; drag.lastX = e.clientX; drag.lastY = e.clientY; takeOver();
      }
      const mx = e.clientX - drag.lastX, my = e.clientY - drag.lastY;
      drag.lastX = e.clientX; drag.lastY = e.clientY;
      const dAz = -mx / Math.max(1, width) * Math.PI * 1.3;
      const dPol = drag.type === 'mouse' ? -my / Math.max(1, height) * Math.PI * 0.5 : 0;
      drag.vAz = dAz; drag.vPol = dPol; drag.moved += Math.abs(mx) + Math.abs(my);
      rotate(dAz, dPol); invalidate();
    }, on);
    const end = e => {
      if (!drag || e.pointerId !== drag.id) return;
      // Короткое касание без движения — как нажатие: показ останавливается.
      if (drag.mode === 'wait' && e.type === 'pointerup') { halt(); onInteract?.('tap'); }
      if (drag.mode === 'rotate' && !reducedMotion && e.type === 'pointerup' && drag.moved > 4) spin = {az: drag.vAz, pol: drag.vPol};
      drag = null;
      container.classList.remove('is-dragging');
      invalidate();
    };
    canvas.addEventListener('pointerup', end, on);
    canvas.addEventListener('pointercancel', end, on);
  }

  // ── Отрисовка по требованию ──────────────────────────────────────────────
  // Кадр рисуется, только когда что-то изменилось; неподвижная камера — ноль
  // кадров. Вне экрана, на скрытой вкладке и по просьбе страницы (setSuspended)
  // цикл стоит, показ на паузе.
  // compiled: до конца компиляции шейдеров не рисуем — первый render() ждал бы
  // сборку всех программ синхронно и блокировал страницу на секунду и больше.
  // inTick: пока идёт кадр, invalidate() не заказывает новый — продолжение
  // решает сам tick(); иначе кадры множились (каждый заказывал по два).
  let onScreen = true, frames = 0, last = 0, compiled = false, inTick = false;
  // Разрешение по нагрузке: пока камера движется, а кадры идут дольше ~30 мс
  // (слабая видеокарта, крупный план лака на весь экран), сцена рисуется в
  // меньшем разрешении (до 60 %); остановилась — последний кадр снова чёткий.
  // Ждёт, пока программы соберутся (KHR_parallel_shader_compile), не блокируя поток.
  // Пока шейдеры капель не собраны, капли не показываем: их первый кадр
  // иначе ждал бы сборку синхронно.
  let warmed = false;
  function waitPrograms(programs) {
    const pending = new Set(programs.filter(Boolean));
    return new Promise(resolve => {
      const check = () => {
        if (disposed) return resolve();
        for (const program of pending) if (program.isReady()) pending.delete(program);
        if (pending.size) setTimeout(check, 32); else resolve();
      };
      check();
    });
  }
  function setScale(next) {
    if (next === dprScale) return;
    dprScale = next;
    renderer.setPixelRatio(Math.min(devicePixelRatio || 1, maxDpr) * dprScale);
    renderer.setSize(width, height, false);
  }
  function adaptResolution(now) {
    const gap = prevRenderAt ? now - prevRenderAt : 0;
    prevRenderAt = now;
    // Только в главах (крупные планы лака на весь экран): на первом экране
    // кадр лёгкий, а смена разрешения сама стоит ~100 мс.
    if (gap > 0 && gap < 120 && pathWeight() > 0.5) {
      slowFrames = gap > 30 ? slowFrames + 1 : Math.max(0, slowFrames - 1);
      // Смена разрешения — перевыделение буфера (~50–100 мс): не чаще раза в 3 с,
      // сразу на 0,7, а полное — после секунды покоя.
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
    // Реальное время: показ длится ~7 с при любом FPS (секунда — предел
    // на случай паузы, например после скрытой вкладки).
    const dt = last ? Math.min(1, (now - last) / 1000) : 1 / 60;
    last = now;
    let busy = stepTour(dt);
    if (!tour) busy = stepMove(dt) || busy;
    busy = stepDrift(dt) || busy;
    busy = stepSpin(dt) || busy;
    busy = stepLean(dt) || busy;
    busy = stepService(dt) || busy;
    // Ушли от первого экрана — ручной ракурс сбрасывается на hero: вернувшись
    // наверх, человек видит общий вид, совпадающий с фото.
    if (pathWeight() >= 1 && viewName !== 'hero') {
      tour = null; move = null; drift = null; driftNext = null; spin = null;
      Object.assign(state, viewState('hero')); viewName = 'hero'; onViewChange?.('hero');
    }
    const cam = resolveView();
    project(cam);
    applyEffects();
    // Параллакс — поворот вокруг точки взгляда на доли градуса.
    offset.subVectors(cam.p, cam.t);
    const r = offset.length();
    const az = Math.atan2(offset.x, offset.z) - lean.x * 1.5 * DEG;
    const pol = Math.acos(MathUtils.clamp(offset.y / r, -1, 1)) + lean.y * 0.6 * DEG;
    eye.set(cam.t.x + r * Math.sin(pol) * Math.sin(az), cam.t.y + r * Math.cos(pol), cam.t.z + r * Math.sin(pol) * Math.cos(az));
    camera.position.copy(eye); camera.lookAt(cam.t);
    adaptResolution(now);
    renderer.render(scene, camera);
    frames++;
    if (firstFrame) { const done = firstFrame; firstFrame = null; done(); }
    if ((busy || drag) && running()) raf = requestAnimationFrame(tick); else last = 0;
  }

  intersection = new IntersectionObserver(([item]) => {
    onScreen = item.isIntersecting;
    if (onScreen) invalidate(); else stop();
  });
  intersection.observe(container);
  resize = new ResizeObserver(measure);
  resize.observe(container);
  document.addEventListener('visibilitychange', () => { if (document.hidden) stop(); else invalidate(); }, on);
  fine.addEventListener('change', () => { parallaxOn = !reducedMotion && fine.matches; invalidate(); }, on);

  await pause(); if (disposed) throw lost || abortError();
  measure();
  project(state);
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
  // проявляем canvas — до этого виден обычный фон страницы. Если сцена вне
  // экрана или вкладка скрыта, кадр нарисуется, когда станет видно.
  compiled = true;
  // Первый кадр рисует все объекты без отсечения по камере: видеодрайвер
  // (ANGLE) доделывает шейдер при первой отрисовке объекта, и без этого
  // показ спотыкался, когда в кадр впервые попадали диск, салон, фары.
  // Canvas в этот момент ещё не виден (проявляет страница после onFirstFrame).
  const culled = [];
  scene.traverse(o => { if ((o.isMesh || o.isLineSegments) && o.frustumCulled && o.name !== 'water-beads') { o.frustumCulled = false; culled.push(o); } });
  await new Promise(resolve => { firstFrame = resolve; last = 0; invalidate(); });
  for (const o of culled) o.frustumCulled = true;
  if (disposed) throw lost || abortError();
  mark('firstFrame');
  const idle = globalThis.requestIdleCallback || (fn => setTimeout(fn, 200));
  idle(async () => {
    if (disposed || !restyled?.paintMesh) return;
    const made = await createWater(scene, restyled.paintMesh, {low, pause, cancelled: () => disposed});
    if (disposed) { made?.dispose(); return; }
    water = made;
    await pause(); if (disposed) return;
    // Шейдеры главы 04 собираются заранее и только параллельно (без кадра):
    // капли на экране и варианты всех материалов для прохода transmission —
    // он рисует сцену в свою цель, без тонмаппинга, это другие программы.
    // compile обходит только видимые объекты — на время сборки капли видимы.
    // Кадр в цель здесь собирал бы их синхронно: на пустом кэше шейдеров это
    // была одна задача на 6–7 с сразу после появления 3D.
    const beads = scene.getObjectByName('water-beads');
    if (beads) {
      // По одному мешу за шаг: сборка программы на стороне JS — 3–5 мс, все
      // сразу давали задачу ~60 мс. Капли видимы только на время своей сборки
      // (кадр между шагами их не нарисует).
      const programs = [];
      const target = new WebGLRenderTarget(4, 4);
      const meshes = [];
      scene.traverseVisible(o => { if (o.isMesh || o.isLineSegments) meshes.push(o); });
      meshes.push(beads);
      const take = set => { for (const m of set) programs.push(renderer.properties.get(m).currentProgram); };
      for (const [i, mesh] of meshes.entries()) {
        const isBeads = mesh === beads;
        if (isBeads) beads.visible = true;
        if (isBeads) take(renderer.compile(mesh, camera, scene));   // капли на экране
        renderer.setRenderTarget(target);
        if (!isBeads) take(renderer.compile(mesh, camera, scene));  // проход transmission
        renderer.setRenderTarget(null);
        if (isBeads) beads.visible = false;
        if (i % 3 === 2) { await pause(); if (disposed) { target.dispose(); return; } }
      }
      target.dispose();
      waitPrograms(programs).then(() => { warmed = true; applyEffects(); invalidate(); });
    }
    applyEffects(); invalidate();
  }, {timeout: 1500});
  if (fadeIn) canvas.style.opacity = '1';
  onFirstFrame?.();

  Object.assign(handle, {
    canvas,
    quality: level,
    views: Object.keys(VIEWS),
    get currentView() { return viewName; },
    get touring() { return !!tour; },
    // Показ ~7 с; при reduced motion автооблёта нет — только общий вид.
    tour() {
      if (disposed) return false;
      if (reducedMotion) { goTo('overview'); onTourEnd?.(); return false; }
      move = null; drift = null; driftNext = null; spin = null;
      tour = {index: 0, hold: 0};
      viewName = 'tour'; onViewChange?.('tour'); invalidate();
      return true;
    },
    // Остановка показа: камера остаётся, где была (ни один ракурс не выбран).
    stopTour() {
      if (!tour) return;
      tour = null; move = null; viewName = 'free';
      onViewChange?.('free'); invalidate();
    },
    view(name, options) { if (!disposed) goTo(name, options); },
    // Работа гаража → ракурс. false — у модели нет убедительной детали,
    // страница оставляет фотографию.
    showService(id) {
      const name = SERVICE_VIEWS[id];
      if (disposed || !name) return false;
      goTo(name);
      service = {kind: SERVICE_FX[id] || 'clean', time: 0, duration: 2.6};
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
    // Прокрутка сцены: p 0..1; camera — вести камеру и эффекты глав прокруткой.
    setProgress(p, {camera = true} = {}) {
      const next = MathUtils.clamp(p, 0, 1);
      if (next === scroll.p && camera === scroll.camera) return;
      if (camera && next > 0 && tour) { tour = null; onViewChange?.('free'); }
      scroll.p = next; scroll.camera = camera;
      invalidate();
    },
    // Гараж без выбранной работы: общий вид, пыльная машина (как в v1).
    showBase() {
      if (disposed) return;
      goTo('overview');
      service = {kind: 'base', time: 0, duration: 0.01};
    },
    // Свободная часть контейнера (px): шапка, панель гаража, нижняя кнопка.
    setSafeArea(next = {}) {
      Object.assign(inset, {top: 0, right: 0, bottom: 0, left: 0}, next);
      frame(); invalidate();
    },
    // Пауза по причине страницы: ушли к главам, открыт диалог и т. п.
    setSuspended(reason, on) {
      if (!!on === suspended.has(reason)) return;
      if (on) { suspended.add(reason); stop(); } else { suspended.delete(reason); invalidate(); }
    },
    setReducedMotion(value) {
      reducedMotion = !!value; parallaxOn = !reducedMotion && fine.matches;
      if (reducedMotion) { drift = null; driftNext = null; spin = null; }
      if (reducedMotion && tour) { tour = null; goTo('overview', {instant: true}); }
      if (fadeIn) canvas.style.transition = `opacity ${reducedMotion ? 250 : 900}ms ease`;
      invalidate();
    },
    invalidate,
    // Только для автоматических проверок (потеря контекста, свет); страница не использует.
    _debug: () => ({scene, camera, renderer}),
    stats() {
      const info = renderer.info;
      return {quality: level, frames, drawCalls: info.render.calls, triangles: info.render.triangles,
        geometries: info.memory.geometries, textures: info.memory.textures, programs: info.programs?.length ?? 0,
        pixelRatio: renderer.getPixelRatio(), width, height, running: !!raf, suspended: [...suspended], timings: {...timings}};
    },
  });
  mounted = true;
  return handle;
}
