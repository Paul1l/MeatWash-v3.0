// 3D-режим «Оживить Porsche». Модуль грузится только динамическим import()
// по нажатию кнопки: страница не ссылается на него ни статически, ни через
// preload/prefetch. Собирается в dist/js/porsche3d.bundle.js (npm run bundle-3d),
// three, GLTFLoader и декодер Meshopt — внутри бандла.
//
//   const {mount} = await import('./porsche3d.bundle.js');
//   const scene = await mount({container, signal, onProgress, onFirstFrame, onError});
//   scene.tour(); scene.view('wheel'); scene.showService('polish'); scene.dispose();
//
// Прокрутку страницы сцена не трогает: canvas с pointer-events:none, слушателей
// wheel/touch нет. Камера двигается только программно (ракурсы, показ) и чуть-чуть
// за мышью (параллакс; выключен при reduced motion и на сенсорных экранах).
import {
  ACESFilmicToneMapping, CatmullRomCurve3, Color, MathUtils, MeshPhysicalMaterial,
  PerspectiveCamera, Scene, SRGBColorSpace, Vector3, WebGLRenderer,
} from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {MeshoptDecoder} from 'three/addons/libs/meshopt_decoder.module.js';
import {buildEnvironment, buildRoom} from './room.js';
import {VIEWS, TOUR, SERVICE_VIEWS, PUBLIC_VIEWS, REF_ASPECT} from './views.js';

export {VIEWS, SERVICE_VIEWS, PUBLIC_VIEWS};

const MODELS = {
  high: 'assets/3d/porsche-930-desktop.glb',
  low: 'assets/3d/porsche-930-mobile.glb',
};

// Одна сцена на страницу: повторный mount закрывает предыдущую.
let active = null;

export class Porsche3DError extends Error {
  constructor(code, message, cause) { super(message, {cause}); this.name = 'Porsche3DError'; this.code = code; }
}

const abortError = () => new DOMException('Загрузка 3D отменена', 'AbortError');

// Выбор качества, если страница его не передала: телефон, сенсорный экран без
// мыши, мало памяти или Save-Data — облегчённая модель.
export function pickQuality() {
  const coarse = matchMedia('(pointer: coarse)').matches && !matchMedia('(any-pointer: fine)').matches;
  const small = Math.min(screen.width, screen.height) < 700 || innerWidth <= 900;
  const weak = (navigator.deviceMemory && navigator.deviceMemory <= 4) || navigator.connection?.saveData;
  return coarse || small || weak ? 'low' : 'high';
}

// Загрузка модели с честным прогрессом: процент — только если сервер назвал
// размер и не сжимал ответ (иначе Content-Length не совпадает с прочитанным).
async function fetchModel(source, signal, onProgress) {
  const response = await (typeof source === 'string' ? fetch(source, {signal}) : source);
  if (!response.ok) throw new Porsche3DError('load', `Модель не загрузилась: HTTP ${response.status}`);
  const encoding = (response.headers.get('content-encoding') || 'identity').toLowerCase();
  const declared = Number(response.headers.get('content-length')) || 0;
  const total = encoding === 'identity' && declared > 0 ? declared : null;
  if (!response.body) {
    const buffer = await response.arrayBuffer();
    onProgress?.({loaded: buffer.byteLength, total: buffer.byteLength, ratio: 1});
    return buffer;
  }
  const reader = response.body.getReader();
  const chunks = []; let loaded = 0;
  const cancel = () => reader.cancel().catch(() => {});
  signal?.addEventListener('abort', cancel, {once: true});
  try {
    for (;;) {
      const {done, value} = await reader.read();
      if (signal?.aborted) throw abortError();
      if (done) break;
      chunks.push(value); loaded += value.byteLength;
      onProgress?.({loaded, total, ratio: total ? Math.min(1, loaded / total) : null});
    }
  } finally {
    signal?.removeEventListener('abort', cancel);
  }
  const out = new Uint8Array(loaded); let offset = 0;
  for (const chunk of chunks) { out.set(chunk, offset); offset += chunk.byteLength; }
  return out.buffer;
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

const smooth = t => t * t * (3 - 2 * t);
// Отдать главный поток странице между тяжёлыми шагами загрузки.
const pause = () => new Promise(resolve => (globalThis.scheduler?.yield ? scheduler.yield().then(resolve) : setTimeout(resolve, 0)));
const easeInOut = t => t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

// Материалы в духе клуба: глубокий бордовый лак с прозрачным верхним слоем,
// тонированные стёкла без преломления (transmission — лишний проход рендера).
function restyle(car, {anisotropy}) {
  const replaced = [];
  const paint = new MeshPhysicalMaterial({
    name: 'meatwash-oxblood', color: new Color('#420912'), metalness: 0.3, roughness: 0.26,
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
  car.traverse(o => {
    if (!o.isMesh) return;
    const m = o.material;
    if (m.map) m.map.anisotropy = anisotropy;
    switch (m.name) {
      case 'paint':
        paint.aoMap = m.aoMap; paint.aoMapIntensity = 0.8;
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
  return {paint, replaced};
}

export async function mount({
  container,
  signal,
  quality = 'auto',
  reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches,
  model,
  baseUrl = new URL('../', import.meta.url).href,
  onProgress,
  onFirstFrame,
  onError,
  onViewChange,
  onTourEnd,
} = {}) {
  if (!container) throw new TypeError('mount: нужен container');
  if (signal?.aborted) throw abortError();
  active?.dispose();
  if (!webglAvailable()) throw new Porsche3DError('webgl', 'WebGL недоступен на этом устройстве');

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
  let disposed = false, raf = 0, room = null, environment = null, restyled = null;
  let intersection = null, resize = null, firstFrame = null, lost = null, mounted = false;

  const canvas = document.createElement('canvas');
  canvas.className = 'porsche3d__canvas';
  canvas.setAttribute('aria-hidden', 'true');
  Object.assign(canvas.style, {
    position: 'absolute', inset: '0', width: '100%', height: '100%', display: 'block',
    pointerEvents: 'none', opacity: '0', transition: `opacity ${reducedMotion ? 250 : 900}ms ease`,
  });

  let renderer;
  try {
    renderer = new WebGLRenderer({canvas, antialias: true, alpha: false, powerPreference: low ? 'default' : 'high-performance'});
  } catch (error) {
    throw new Porsche3DError('webgl', 'Не удалось запустить WebGL', error);
  }
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.2;
  const maxDpr = low ? 1.5 : 1.75;

  const scene = new Scene();
  const camera = new PerspectiveCamera(VIEWS.hero.fov, REF_ASPECT, 0.05, 60);

  // Всё, что создано до ошибки или отмены, освобождается здесь.
  function dispose() {
    if (disposed) return;
    disposed = true;
    if (active === handle) active = null;
    cancelAnimationFrame(raf); raf = 0;
    loading.abort();
    listeners.abort();
    if (firstFrame) { const done = firstFrame; firstFrame = null; done(); }
    intersection?.disconnect(); resize?.disconnect();
    release(scene, restyled?.replaced);
    room?.dispose();
    environment?.dispose();
    renderer.renderLists.dispose();
    renderer.dispose();
    renderer.forceContextLoss();
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

    const source = model || new URL(MODELS[level], baseUrl).href;
    const buffer = await fetchModel(source, loading.signal, onProgress);
    mark('model');
    if (disposed) bail();

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
      gltf = await Promise.race([loader.parseAsync(buffer, new URL('assets/3d/', baseUrl).href), cancelled]);
    } finally {
      MeshoptDecoder.useWorkers(0);
    }
    if (disposed) { if (gltf) release(gltf.scene); bail(); }
    mark('parse');
    scene.add(gltf.scene);
    restyled = restyle(gltf.scene, {anisotropy: Math.min(low ? 2 : 4, renderer.capabilities.getMaxAnisotropy())});
    container.appendChild(canvas);
  } catch (error) {
    const wasCancelled = disposed || signal?.aborted || error?.name === 'AbortError';
    dispose();
    if (lost) throw lost;
    if (wasCancelled) throw abortError();
    throw error instanceof Porsche3DError ? error : new Porsche3DError('load', 'Не удалось загрузить 3D-сцену', error);
  }

  // ── Камера ────────────────────────────────────────────────────────────────
  // Опорный кадр 16:9 вписывается в контейнер как фото с background-size:cover;
  // на узком экране — не уже доли span, чтобы машина не превращалась в полосу.
  const state = {p: new Vector3(...VIEWS.hero.p), t: new Vector3(...VIEWS.hero.t), fov: VIEWS.hero.fov, focus: [...VIEWS.hero.focus], span: VIEWS.hero.span};
  let width = 0, height = 0, viewName = 'hero';
  function frame() {
    if (!width || !height) return;
    let fullW = Math.max(width, height * REF_ASPECT);
    if (width / fullW < state.span) fullW = width / state.span;
    const fullH = fullW / REF_ASPECT;
    camera.fov = state.fov; camera.aspect = REF_ASPECT;
    camera.setViewOffset(fullW, fullH, (fullW - width) * state.focus[0], (fullH - height) * state.focus[1], width, height);
    camera.updateProjectionMatrix();
  }
  function measure() {
    const rect = container.getBoundingClientRect();
    const w = Math.max(1, Math.round(rect.width)), h = Math.max(1, Math.round(rect.height));
    if (w === width && h === height) return;
    width = w; height = h;
    renderer.setPixelRatio(Math.min(devicePixelRatio || 1, maxDpr));
    renderer.setSize(width, height, false);
    frame(); invalidate();
  }

  // Параллакс: небольшое смещение камеры за мышью — отражения на лаке «едут».
  const fine = matchMedia('(hover: hover) and (pointer: fine)');
  let parallaxOn = !reducedMotion && fine.matches;
  const pointer = {x: 0, y: 0}, lean = {x: 0, y: 0};
  window.addEventListener('pointermove', e => {
    if (!parallaxOn || e.pointerType !== 'mouse') return;
    pointer.x = e.clientX / innerWidth * 2 - 1; pointer.y = e.clientY / innerHeight * 2 - 1;
    invalidate();
  }, {...on, passive: true});

  // Движения камеры: переход к ракурсу (по дуге вокруг машины, чтобы не
  // проходить сквозь кузов) и показ по сплайну.
  const center = new Vector3(0, 0.5, 0);
  let move = null, tour = null, drift = null, driftNext = null;
  const polar = v => {
    const d = v.clone().sub(center);
    return {r: Math.hypot(d.x, d.z), a: Math.atan2(d.x, d.z), y: v.y};
  };
  function goTo(name, {instant = reducedMotion, duration = 1.4} = {}) {
    const view = VIEWS[name];
    if (!view) throw new Porsche3DError('view', `Нет ракурса ${name}`);
    tour = null; drift = null; driftNext = null; viewName = name;
    const to = {p: new Vector3(...view.p), t: new Vector3(...view.t), fov: view.fov, focus: view.focus, span: view.span};
    if (instant) { move = null; apply(to); }
    else {
      const from = {p: state.p.clone(), t: state.t.clone(), fov: state.fov, focus: [...state.focus], span: state.span};
      const a = polar(from.p), b = polar(to.p);
      let da = b.a - a.a; if (da > Math.PI) da -= 2 * Math.PI; if (da < -Math.PI) da += 2 * Math.PI;
      move = {from, to, a, b, da, time: 0, duration};
    }
    onViewChange?.(name);
    invalidate();
  }
  function apply(s) {
    state.p.copy(s.p); state.t.copy(s.t); state.fov = s.fov;
    state.focus = [...s.focus]; state.span = s.span; frame();
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
    frame();
    if (k >= 1) {
      move = null;
      if (driftNext) { drift = driftNext; driftNext = null; }
    }
    return !!move || !!drift;
  }
  // Показ начинается из текущего положения камеры — без скачка, даже если
  // перед этим был открыт другой ракурс.
  function startTour() {
    const keys = TOUR.keys.map((k, i) => i === 0
      ? {p: state.p.clone(), t: state.t.clone(), fov: state.fov}
      : {p: new Vector3(...k.p), t: new Vector3(...k.t), fov: k.fov});
    tour = {
      time: 0, keys, focus: [...state.focus], span: state.span,
      path: new CatmullRomCurve3(keys.map(k => k.p), false, 'centripetal'),
      look: new CatmullRomCurve3(keys.map(k => k.t), false, 'centripetal'),
    };
  }
  function stepTour(dt) {
    if (!tour) return false;
    tour.time += dt;
    const {keys, path, look} = tour, times = TOUR.times, last = keys.length - 1;
    // Мягкий разгон и остановка по всему показу; между точками — по их времени.
    const u = Math.min(1, tour.time / TOUR.duration), eased = smooth(u) * TOUR.duration;
    let i = 0;
    while (i < last - 1 && eased > times[i + 1]) i++;
    const s = MathUtils.clamp((eased - times[i]) / (times[i + 1] - times[i]), 0, 1);
    path.getPoint((i + s) / last, state.p); look.getPoint((i + s) / last, state.t);
    state.fov = MathUtils.lerp(keys[i].fov, keys[i + 1].fov, smooth(s));
    const blend = smooth(Math.min(1, u * 4));
    state.span = MathUtils.lerp(tour.span, TOUR.span, blend);
    state.focus = [MathUtils.lerp(tour.focus[0], TOUR.focus[0], blend), MathUtils.lerp(tour.focus[1], TOUR.focus[1], blend)];
    frame();
    if (u >= 1) {
      tour = null;
      // Показ заканчивается общим видом: на телефоне он шире кадра hero.
      goTo('overview', {duration: 0.6});
      onTourEnd?.();
    }
    return true;
  }
  // Полировка: камера медленно ведёт вдоль борта — отражения скользят.
  function stepDrift(dt) {
    if (!drift) return false;
    drift.time += dt;
    const u = Math.min(1, drift.time / drift.duration);
    const s = Math.sin(u * Math.PI);
    state.p.copy(drift.base).addScaledVector(drift.axis, s * 0.45);
    frame();
    if (u >= 1) drift = null;
    return !!drift;
  }
  function stepLean(dt) {
    const tx = parallaxOn ? pointer.x : 0, ty = parallaxOn ? pointer.y : 0;
    const k = 1 - Math.exp(-dt * 5);
    lean.x += (tx - lean.x) * k; lean.y += (ty - lean.y) * k;
    return Math.abs(tx - lean.x) > 0.003 || Math.abs(ty - lean.y) > 0.003;
  }

  // ── Отрисовка по требованию ──────────────────────────────────────────────
  // Кадр рисуется, только когда что-то изменилось; неподвижная камера — ноль
  // кадров. Вне экрана и на скрытой вкладке цикл стоит.
  // compiled: до конца компиляции шейдеров не рисуем — первый render() ждал бы
  // сборку всех программ синхронно и блокировал страницу на секунду и больше.
  let onScreen = true, frames = 0, last = 0, compiled = false;
  const side = new Vector3(), up = new Vector3(0, 1, 0), eye = new Vector3();
  function running() { return compiled && !disposed && onScreen && !document.hidden; }
  function invalidate() { if (!raf && running()) raf = requestAnimationFrame(tick); }
  function tick(now) {
    raf = 0;
    const dt = last ? Math.min(0.05, (now - last) / 1000) : 1 / 60;
    last = now;
    let busy = stepMove(dt);
    busy = stepTour(dt) || busy;
    busy = stepDrift(dt) || busy;
    busy = stepLean(dt) || busy;
    side.subVectors(state.t, state.p).cross(up).normalize();
    eye.copy(state.p).addScaledVector(side, lean.x * 0.14).addScaledVector(up, -lean.y * 0.07);
    camera.position.copy(eye); camera.lookAt(state.t);
    renderer.render(scene, camera);
    frames++;
    if (firstFrame) { const done = firstFrame; firstFrame = null; done(); }
    if (busy) raf = requestAnimationFrame(tick); else last = 0;
  }

  intersection = new IntersectionObserver(([entry]) => {
    onScreen = entry.isIntersecting;
    if (onScreen) { last = 0; invalidate(); } else { cancelAnimationFrame(raf); raf = 0; last = 0; }
  });
  intersection.observe(container);
  resize = new ResizeObserver(measure);
  resize.observe(container);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { cancelAnimationFrame(raf); raf = 0; } else { last = 0; invalidate(); }
  }, on);
  fine.addEventListener('change', () => { parallaxOn = !reducedMotion && fine.matches; invalidate(); }, on);

  measure();
  apply({p: new Vector3(...VIEWS.hero.p), t: new Vector3(...VIEWS.hero.t), fov: VIEWS.hero.fov, focus: VIEWS.hero.focus, span: VIEWS.hero.span});
  camera.position.copy(state.p); camera.lookAt(state.t);
  try {
    // Шейдеры собираются параллельно (KHR_parallel_shader_compile), готовность
    // проверяем сами: compileAsync из three после dispose() падает в таймере.
    const pending = renderer.compile(scene, camera);
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
  // проявляем canvas — до этого виден обычный фон страницы.
  compiled = true;
  await new Promise(resolve => { firstFrame = resolve; last = 0; if (!raf) raf = requestAnimationFrame(tick); });
  if (disposed) throw lost || abortError();
  mark('firstFrame');
  canvas.style.opacity = '1';
  onFirstFrame?.();

  Object.assign(handle, {
    canvas,
    quality: level,
    views: Object.keys(VIEWS),
    get currentView() { return viewName; },
    // Показ 7,5 с; при reduced motion автооблёта нет — только общий вид.
    tour() {
      if (disposed) return false;
      if (reducedMotion) { goTo('overview'); onTourEnd?.(); return false; }
      move = null; drift = null; viewName = 'tour';
      startTour();
      onViewChange?.('tour'); invalidate();
      return true;
    },
    stopTour() { if (tour) { tour = null; goTo('overview', {duration: 0.6}); } },
    view(name, options) { if (!disposed) goTo(name, options); },
    // Работа гаража → ракурс. false — у модели нет убедительной детали,
    // страница оставляет фотографию.
    showService(id) {
      const name = SERVICE_VIEWS[id];
      if (disposed || !name) return false;
      goTo(name);
      // Полировка: доехав до борта, камера медленно ведёт вдоль него —
      // отражения скользят по лаку.
      if (id === 'polish' && !reducedMotion) {
        const base = new Vector3(...VIEWS[name].p), look = new Vector3(...VIEWS[name].t);
        const axis = new Vector3().subVectors(look, base).cross(up).normalize();
        driftNext = {base, axis, time: 0, duration: 3.2};
        if (!move) { drift = driftNext; driftNext = null; invalidate(); }
      }
      return true;
    },
    setReducedMotion(value) {
      reducedMotion = !!value; parallaxOn = !reducedMotion && fine.matches;
      if (reducedMotion) { drift = null; driftNext = null; }
      if (reducedMotion && tour) { tour = null; goTo('overview', {instant: true}); }
      canvas.style.transition = `opacity ${reducedMotion ? 250 : 900}ms ease`;
      invalidate();
    },
    invalidate,
    // Только для автоматических проверок (потеря контекста, свет); страница не использует.
    _debug: () => ({scene, camera, renderer}),
    stats() {
      const info = renderer.info;
      return {quality: level, frames, drawCalls: info.render.calls, triangles: info.render.triangles,
        geometries: info.memory.geometries, textures: info.memory.textures, programs: info.programs?.length ?? 0,
        pixelRatio: renderer.getPixelRatio(), width, height, running: !!raf, timings: {...timings}};
    },
  });
  mounted = true;
  return handle;
}
