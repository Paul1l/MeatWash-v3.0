# porsche3d — 3D-режим «Оживить Porsche»

Исходник модуля. На сайт попадает только бандл `dist/js/porsche3d.bundle.js`
(`npm run bundle-3d`): three r180, GLTFLoader и декодер Meshopt внутри, importmap не нужен.
Страница грузит его **только** `import('./porsche3d.bundle.js')` из `dist/js/live3d.js` по нажатию —
`npm run check` падает на статическом импорте, `<script>`, preload/prefetch или ссылке на `.glb`.

- `index.js` — `mount()`: загрузка модели с прогрессом, отменой и тайм-аутом, материалы, камера,
  поворот рукой, отрисовка по требованию, `dispose()`.
- `views.js` — ракурсы, показ, соответствие работ «Гаража услуг» ракурсам.
- `room.js` — помещение, свет и окружение для отражений (всё рисуется на canvas, без загрузок).
- `interior.js` — кожаный кокпит из v1 (кодом и canvas-текстурами, без загрузок).
- `water.js` — капли на капоте (InstancedMesh, преломление transmission, как в v1).
- `models.js` — манифест моделей (адрес с хешем и размер); создаёт `npm run optimize-3d`.

Модели — `dist/assets/3d/porsche-930-{desktop,mobile}.<хеш>.glb`, собираются `npm run optimize-3d`
из `source/3d/porsche-930.glb` (исходник v1, в `dist` не публикуется). Отчёт с размерами
и sha256 — `source/3d/optimize-report.json`. `npm run check:3d` сверяет бандл, модели и манифест.

## API

```js
const {mount} = await import('./porsche3d.bundle.js');
const scene = await mount({
  container,            // элемент с position: relative/absolute; canvas добавится последним ребёнком
  signal,               // AbortSignal: отмена → промис отклоняется с AbortError
  quality: 'auto',      // 'high' | 'low' | 'auto' (телефон, сенсор без мыши, ≤4 ГБ, Save-Data → low)
  reducedMotion,        // по умолчанию из prefers-reduced-motion: без показа, параллакса и инерции
  startView: 'hero',    // 'hero' совпадает с фото первого экрана; 'overview' — повторный запуск
  fadeIn: true,         // false — проявление делает страница (сайт: #scene[data-p3d="on"])
  interactive: true,    // поворот мышью и горизонтальным жестом
  stallTimeout: 15000,  // мс без новых байт → Porsche3DError('timeout')
  onProgress({loaded, total, ratio}),  // total — из манифеста (верно и при сжатии на хостинге)
  onPhase(name),        // 'download' → 'prepare' (скачано, готовим сцену)
  onFirstFrame(),       // первый кадр нарисован
  onError(error),       // после запуска: потеря контекста WebGL (сцена уже закрыта)
  onViewChange(name),   // ракурс | 'tour' | 'free' (повернули рукой или остановили показ)
  onTourEnd(),
  onInteract(kind),     // 'press' | 'tap' — нажатие на сцену (показ останавливается)
});
scene.tour();                 // показ ~7 с; false при reduced motion (сразу общий вид)
scene.stopTour();             // камера остаётся, где была
scene.touring;                // идёт ли показ
scene.view('overview' | 'body' | 'wheel' | 'wing' | 'front' | 'hood' | 'reflection' | 'headlight' | 'sill' | 'windscreen' | 'hero');
scene.showService(zoneId);    // id из config.js ZONES; false — ракурса нет (салон), показывайте фото
scene.setProgress(p, {camera: true});  // прокрутка сцены 0..1: камера и эффекты глав (как v1.0)
scene.setSafeArea({top, right, bottom, left});  // свободная часть кадра, px (шапка, текст глав, панель гаража)
scene.setSuspended(reason, on);  // пауза по причине страницы (ушли к главам, диалог, 3D скрыт)
scene.setReducedMotion(bool);
scene.stats();                // кадры, вызовы отрисовки, треугольники, память, timings этапов
scene.dispose();              // освобождает видеопамять и удаляет canvas; повторный вызов безопасен
```

Ошибки `mount()` — `Porsche3DError` с `code`: `webgl` (нет WebGL 2), `load` (сеть, HTTP),
`timeout`, `compile` (шейдеры), `context-lost`; отмена — `DOMException` `AbortError`. Во всех
случаях canvas уже удалён, страница показывает обычный фон. Повторный `mount()` закрывает
предыдущую сцену. Скачанная модель остаётся в памяти модуля: после `dispose()` повторный
`mount()` не ходит в сеть.

## Главы (прокрутка)

`setProgress(p)` ведёт камеру по `SCROLL_STOPS` (views.js) и эффекты: 0.095–0.245 грязь смывается
(`uClean` в шейдере лака; пыль — на вертикальных бортах снизу), 0.30–0.50 стекло растворяется
и виден кокпит, 0.47–0.70 риски полировки (`uFinish`) исчезают и по борту идёт свет, 0.72–0.91
капли. На p≈0 остаётся ручной ракурс; к 0.035 камера плавно переходит на путь, а ручной ракурс
сбрасывается на `hero`. Работы гаража (`showService`) играют свой эффект (`SERVICE_FX`).

## Поведение

- Колесо не слушается — всегда листает страницу. У canvas `touch-action: pan-y`: вертикальный
  жест листает, горизонтальный (|dx| > 8 и больше |dy|) поворачивает. Мышь: поворот и наклон
  55°–86°, без сдвига и масштаба, инерция 0.08. Параллакс за мышью ±1,5° / ±0,6°.
- Кадр рисуется только при изменении; неподвижная камера — ноль кадров. Вне экрана
  (IntersectionObserver), на скрытой вкладке и при `setSuspended` цикл стоит, показ на паузе.
- До готовности шейдеров кадр не рисуется, текстуры загружаются на видеокарту по одной,
  Meshopt распаковывается в фоновых потоках: страница прокручивается и во время запуска.
  Синхронные проверки шейдеров выключены (включаются `?p3d-debug`); варианты шейдеров для
  прохода transmission прогреваются в простое.
- Пока камера движется, а кадры идут дольше ~30 мс, разрешение снижается до 60 %; остановилась —
  последний кадр снова в полном разрешении.
- Ракурс `hero` совпадает с кадром `cf-hero-dirty.webp` при `background-size: cover` на любом
  соотношении сторон; остальные ракурсы вписываются в `setSafeArea`.
